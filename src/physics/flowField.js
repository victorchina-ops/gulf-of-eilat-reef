import * as THREE from 'three';
import {
  DEFAULT_ENV_STATE,
  WORLD_CONSTANTS,
  getSeabedHeight,
} from '../contracts.js';

// Linear Airy wave dispersion constants matched to surface waves (omega = 1.765 rad/s)
const WAVE_OMEGA = 1.765;
const GRAVITY = 9.81;
const WAVE_K = (WAVE_OMEGA * WAVE_OMEGA) / GRAVITY; // ~0.317556 rad/m (lambda ~ 19.79 m)
const PROP_LEN = Math.hypot(0.86, 0.51);
const PROP_X = 0.86 / PROP_LEN;
const PROP_Z = 0.51 / PROP_LEN;

// Logarithmic benthic boundary layer constants
const ROUGHNESS_Z0 = 0.008;
const BL_THICKNESS = 0.6;
const INV_LOG_BL = 1 / Math.log(BL_THICKNESS / ROUGHNESS_Z0);

// Shared module-level scratch vector to keep sampleFlowField allocation-free
const _waveVelScratch = new THREE.Vector3();

function smoothstep01(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Allocation-free linear Airy wave orbital displacement & velocity sampler.
 * Uses constant omega = 1.765 rad/s deep-water dispersion (k = omega^2 / g) and
 * exponential depth attenuation from water surfaceY = SURFACE_BASE_Y + diveDepth.
 */
export function sampleWaveOrbital(
  x,
  y,
  z,
  elapsedTime = 0,
  envState = DEFAULT_ENV_STATE,
  outDisp = null,
  outVel = null
) {
  if (!outDisp && !outVel) return null;

  const diveDepth = Number.isFinite(envState?.diveDepth)
    ? envState.diveDepth
    : DEFAULT_ENV_STATE.diveDepth;
  const surfaceY = WORLD_CONSTANTS.SURFACE_BASE_Y + diveDepth;
  const uwDepth = Math.max(0, surfaceY - y);

  let amp;
  if (Number.isFinite(envState?.waveAmplitude)) {
    amp = Math.max(0, envState.waveAmplitude);
  } else {
    const wInt = Number.isFinite(envState?.waveIntensity)
      ? Math.max(0, Math.min(1, envState.waveIntensity))
      : DEFAULT_ENV_STATE.waveIntensity;
    amp = 0.42 * wInt;
  }

  if (amp <= 1e-6) {
    if (outDisp) outDisp.set(0, 0, 0);
    if (outVel) outVel.set(0, 0, 0);
    return outVel || outDisp;
  }

  const atten = Math.exp(-WAVE_K * uwDepth);
  const orbAmp = amp * atten;
  const phase = WAVE_K * (PROP_X * x + PROP_Z * z) - WAVE_OMEGA * elapsedTime;
  const cosP = Math.cos(phase);
  const sinP = Math.sin(phase);

  if (outDisp) {
    const horizDisp = -orbAmp * sinP;
    outDisp.set(horizDisp * PROP_X, orbAmp * cosP, horizDisp * PROP_Z);
  }

  if (outVel) {
    const orbSpeed = orbAmp * WAVE_OMEGA;
    const horizVel = orbSpeed * cosP;
    outVel.set(horizVel * PROP_X, orbSpeed * sinP, horizVel * PROP_Z);
  }

  return outVel || outDisp;
}

/**
 * Allocation-free reef flow-field sampler combining:
 * 1) Near-bed logarithmic boundary-layer shear over 0.60 m above getSeabedHeight(x, z),
 * 2) Potential-flow lateral deflection around bommies plus sheltered downstream lee wake
 *    and gentle counter-eddy recirculation,
 * 3) Superposed linear Airy wave orbital velocity damped near the rigid seabed.
 */
export function sampleFlowField(
  x,
  y,
  z,
  elapsedTime = 0,
  envState = DEFAULT_ENV_STATE,
  bommies = [],
  outVec = new THREE.Vector3()
) {
  const rawDir = Number.isFinite(envState?.currentDirection)
    ? envState.currentDirection
    : DEFAULT_ENV_STATE.currentDirection;
  const toRad = (rawDir * Math.PI) / 180;
  const dirX = Math.sin(toRad);
  const dirZ = -Math.cos(toRad);

  const rawSpd = Number.isFinite(envState?.currentSpeed)
    ? envState.currentSpeed
    : DEFAULT_ENV_STATE.currentSpeed;
  const freeSpeed = Math.max(0, Math.min(1.2, rawSpd));

  // Boundary-layer shear above local seabed
  const bedY = getSeabedHeight(x, z);
  const zAbove = Math.max(0, y - bedY);
  let blFactor = 0;
  if (zAbove > ROUGHNESS_Z0) {
    blFactor = zAbove >= BL_THICKNESS
      ? 1
      : Math.max(0, Math.min(1, Math.log(zAbove / ROUGHNESS_Z0) * INV_LOG_BL));
  }

  const baseSpeed = freeSpeed * blFactor;
  let uAlong = baseSpeed;
  let uCross = 0;
  let waveShelter = 1.0;

  if (bommies && bommies.length > 0 && baseSpeed > 1e-6) {
    // Orthogonal left-hand cross vector in XZ: (-dirZ, dirX)
    const crossX = -dirZ;
    const crossZ = dirX;

    for (let i = 0; i < bommies.length; i++) {
      const b = bommies[i];
      if (!b) continue;

      const bx = Number.isFinite(b.x) ? b.x : (b.position ? b.position.x : 0);
      const bz = Number.isFinite(b.z) ? b.z : (b.position ? b.position.z : 0);
      const radius = Number.isFinite(b.radius)
        ? b.radius
        : (Number.isFinite(b.boundingRadius)
          ? b.boundingRadius
          : (Number.isFinite(b.r) ? b.r : 1.5));
      const topY = Number.isFinite(b.topY)
        ? b.topY
        : ((Number.isFinite(b.baseY) ? b.baseY : 0) + (Number.isFinite(b.height) ? b.height : 3.0));

      // Vertical clearance blend so water smoothly clears rock crests
      const vertW = 1 - smoothstep01(topY - 0.15, topY + 0.65, y);
      if (vertW <= 0.001) continue;

      const rx = x - bx;
      const rz = z - bz;
      const rSq = rx * rx + rz * rz;
      const maxRange = radius * 5.0;
      if (rSq > maxRange * maxRange) continue;

      const effR = Math.max(0.45, radius);
      const effR2 = effR * effR;
      const sAlong = rx * dirX + rz * dirZ;
      const sCross = rx * crossX + rz * crossZ;

      // 2D potential-flow dipole around cylinder outer boundary (smoothly capped inside radius)
      const rSqSafe = Math.max(effR2 * 1.04, rSq);
      const invR4 = 1 / (rSqSafe * rSqSafe);
      const dipoleScale = 0.65 * vertW;
      const dipAlong = -baseSpeed * dipoleScale * effR2 * (sAlong * sAlong - sCross * sCross) * invR4;
      const dipCross = -baseSpeed * dipoleScale * effR2 * (2 * sAlong * sCross) * invR4;

      uAlong += dipAlong;
      uCross += dipCross;

      // Downstream sheltered lee wake + gentle counter-eddy behind bommy
      if (sAlong > 0) {
        const downRatio = sAlong / effR;
        const wakeHalfW = effR * (0.95 + 0.12 * downRatio);
        const crossEnv = Math.exp(-(sCross * sCross) / (wakeHalfW * wakeHalfW * 0.92));
        if (crossEnv > 0.005) {
          const wakeEnv = smoothstep01(0.0, 0.45, downRatio) * Math.exp(-Math.max(0, downRatio - 0.5) * 0.42);
          const shelter = 1 - 0.78 * wakeEnv * crossEnv * vertW;
          uAlong *= shelter;
          waveShelter *= 1 - 0.45 * wakeEnv * crossEnv * vertW;

          // Gentle counter-eddy return near centerline + weak lateral Karman swirl
          const eddyBell = Math.exp(-((downRatio - 1.35) * (downRatio - 1.35)) / 0.55);
          const reverseReturn = -0.22 * baseSpeed * eddyBell * crossEnv * vertW;
          const swirlSign = Math.sin(elapsedTime * 1.15 + bx * 0.7 - downRatio * 1.7);
          const lateralEddy = 0.10 * baseSpeed * swirlSign * (sCross / wakeHalfW) * eddyBell * crossEnv * vertW;
          uAlong += reverseReturn;
          uCross += lateralEddy;
        }
      }

      // Smooth interior rock attenuation
      if (rSq < effR2 && y < topY) {
        const coreRatio = Math.sqrt(rSq) / effR;
        const coreMask = smoothstep01(0.35, 1.0, coreRatio);
        uAlong *= coreMask;
        uCross *= coreMask;
      }
    }
  }

  let vx = uAlong * dirX + uCross * (-dirZ);
  let vy = 0;
  let vz = uAlong * dirZ + uCross * dirX;

  // Superpose linear Airy wave orbital motion (vertical velocity damped at rigid seabed)
  sampleWaveOrbital(x, y, z, elapsedTime, envState, null, _waveVelScratch);
  const bedVertMask = Math.min(1, zAbove / 0.25);
  const bedHorizMask = 0.35 + 0.65 * Math.min(1, zAbove / 0.18);
  vx += _waveVelScratch.x * waveShelter * bedHorizMask;
  vy += _waveVelScratch.y * waveShelter * bedVertMask;
  vz += _waveVelScratch.z * waveShelter * bedHorizMask;

  outVec.set(vx, vy, vz);
  return outVec;
}
