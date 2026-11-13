import * as THREE from 'three';
import { WORLD_CONSTANTS, DEFAULT_ENV_STATE, getFlowVectors } from '../contracts.js';

// Spectral attenuation coefficients (m^-1):
// K_rgb = K_clear + turbidity * K_turbid
// Red (620-700nm) attenuates rapidly within 5-15m; green (530nm) and blue (465nm) penetrate 30m+.
const K_CLEAR = new THREE.Vector3(0.24, 0.055, 0.017);
const K_TURBID = new THREE.Vector3(0.26, 0.18, 0.13);

const _tmpVec = new THREE.Vector3();
const _tmpDown = new THREE.Vector3();
const _penKVec = new THREE.Vector3();

/**
 * Exact Three.js ACESFilmicToneMapping curve evaluated on linear RGB in JS
 * so scene.background (which bypasses shader tone mapping) matches the
 * asymptotic horizontal water scatter color at the horizon with zero seam.
 */
function rrtAndOdtFit(x) {
  const a = x * (x + 0.0245786) - 0.000090537;
  const b = x * (0.983729 * x + 0.432951) + 0.238081;
  return a / b;
}

export function applyACESFilmicToColor(linearColor, exposure = 1.05, out = new THREE.Color()) {
  const scale = exposure / 0.6;
  const r = linearColor.r * scale;
  const g = linearColor.g * scale;
  const b = linearColor.b * scale;

  // ACESInputMat (row-major application of column-major GLSL mat3)
  const inR = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const inG = 0.07600 * r + 0.90834 * g + 0.01566 * b;
  const inB = 0.02840 * r + 0.13383 * g + 0.83777 * b;

  const fitR = rrtAndOdtFit(inR);
  const fitG = rrtAndOdtFit(inG);
  const fitB = rrtAndOdtFit(inB);

  // ACESOutputMat
  const outR = Math.max(0, Math.min(1, 1.60475 * fitR - 0.53108 * fitG - 0.07367 * fitB));
  const outG = Math.max(0, Math.min(1, -0.10208 * fitR + 1.10813 * fitG - 0.00605 * fitB));
  const outB = Math.max(0, Math.min(1, -0.00327 * fitR - 0.07276 * fitG + 1.07602 * fitB));

  return out.setRGB(outR, outG, outB);
}

/**
 * Compute Beer-Lambert attenuation coefficient vector K_rgb in m^-1.
 */
export function computeAttenuationRGB(turbidity = DEFAULT_ENV_STATE.turbidity, out = new THREE.Vector3()) {
  const t = THREE.MathUtils.clamp(
    Number.isFinite(turbidity) ? turbidity : DEFAULT_ENV_STATE.turbidity,
    0,
    1
  );
  return out.set(
    K_CLEAR.x + t * K_TURBID.x,
    K_CLEAR.y + t * K_TURBID.y,
    K_CLEAR.z + t * K_TURBID.z
  );
}

/**
 * Compute coupled air-sea solar radiative transfer: Snell's law refraction angle,
 * wave-modulated Fresnel reflectance/transmittance, direct-vs-diffuse sky surface
 * entry, and turbidity-coupled multiple-scattering slant factor.
 */
export function computeSolarWaterTransfer(envState = DEFAULT_ENV_STATE) {
  const rawElev = envState?.sunElevation;
  const sunElevDeg = THREE.MathUtils.clamp(
    Number.isFinite(rawElev) ? rawElev : DEFAULT_ENV_STATE.sunElevation,
    2,
    89
  );
  const elevRad = THREE.MathUtils.degToRad(sunElevDeg);

  const rawTurb = envState?.turbidity;
  const t = THREE.MathUtils.clamp(
    Number.isFinite(rawTurb) ? rawTurb : DEFAULT_ENV_STATE.turbidity,
    0,
    1
  );

  const rawWave = envState?.waveIntensity;
  const w = THREE.MathUtils.clamp(
    Number.isFinite(rawWave) ? rawWave : DEFAULT_ENV_STATE.waveIntensity,
    0,
    1
  );

  const n_w = WORLD_CONSTANTS.IOR_WATER;
  const eta = WORLD_CONSTANTS.IOR_AIR / n_w;

  const sinElev = Math.sin(elevRad);
  const cosElev = Math.cos(elevRad);
  const cosThetaI = sinElev;
  const sinThetaI = cosElev;
  const sinThetaT = eta * sinThetaI;
  const cosThetaT = Math.sqrt(Math.max(0.0001, 1.0 - sinThetaT * sinThetaT));
  const thetaTDeg = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(0, cosThetaT))));

  const rs = (cosThetaI - n_w * cosThetaT) / (cosThetaI + n_w * cosThetaT);
  const rp = (n_w * cosThetaI - cosThetaT) / (n_w * cosThetaI + cosThetaT);
  const R_flat = 0.5 * (rs * rs + rp * rp);
  const R_rough = 0.026 + 0.31 * Math.pow(Math.max(0, 1 - sinElev), 4);
  const fresnelReflectance = THREE.MathUtils.lerp(R_flat, R_rough, 0.55 * w);
  const fresnelTransmittance = 1.0 - fresnelReflectance;

  const T_sky = 0.934;
  const dirWeight = (fresnelTransmittance * sinElev) / (fresnelTransmittance * sinElev + 0.22 * T_sky);
  const surfaceTransmittance = dirWeight * fresnelTransmittance + (1.0 - dirWeight) * T_sky;

  const pathTortuosity = 1.0 + 0.14 * t;
  const slantFactor = pathTortuosity / cosThetaT;

  return {
    elevRad,
    sinElev,
    cosElev,
    cosThetaT,
    thetaTDeg,
    fresnelReflectance,
    fresnelTransmittance,
    surfaceTransmittance,
    pathTortuosity,
    slantFactor,
    turbidity: t,
    waveIntensity: w,
  };
}

/**
 * Compute R/G/B vertical depths (meters) at which spectral transmittance drops to `threshold`.
 */
export function computePenetrationDepths(
  envState = DEFAULT_ENV_STATE,
  threshold = 0.10,
  precomputedTransfer = null,
  precomputedK = null
) {
  const transfer = precomputedTransfer || computeSolarWaterTransfer(envState);
  const k = precomputedK || computeAttenuationRGB(transfer.turbidity, _penKVec);
  const thresh = Number.isFinite(threshold) ? threshold : 0.10;

  if (thresh <= 0) {
    return { r: 120, g: 120, b: 120 };
  }
  if (transfer.surfaceTransmittance <= thresh) {
    return { r: 0, g: 0, b: 0 };
  }

  const logRatio = Math.log(transfer.surfaceTransmittance / thresh);
  const g = logRatio / (k.y * transfer.slantFactor);
  const b = logRatio / (k.z * transfer.slantFactor);

  let lo = 0;
  let hi = 120;
  const kxSlant = k.x * transfer.slantFactor;
  for (let i = 0; i < 24; i++) {
    const mid = 0.5 * (lo + hi);
    const transR = transfer.surfaceTransmittance * (
      0.78 * Math.exp(-kxSlant * mid) + 0.22 * Math.exp(-0.45 * kxSlant * mid)
    );
    if (transR > thresh) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const r = 0.5 * (lo + hi);

  return { r, g, b };
}

/**
 * Compute surface-transmitted Beer-Lambert spectral transmittance along the refracted
 * underwater slant path plus 10% penetration depth milestones.
 */
export function getTransmittanceAtDepth(depthMeters, envState = DEFAULT_ENV_STATE) {
  const d = Math.max(0, Number.isFinite(depthMeters) ? depthMeters : 0);
  const transfer = computeSolarWaterTransfer(envState);
  const k = computeAttenuationRGB(transfer.turbidity, _tmpVec);
  const slantPath = d * transfer.slantFactor;
  const r = transfer.surfaceTransmittance * (
    0.78 * Math.exp(-k.x * slantPath) + 0.22 * Math.exp(-0.45 * k.x * slantPath)
  );
  const g = transfer.surfaceTransmittance * Math.exp(-k.y * slantPath);
  const b = transfer.surfaceTransmittance * Math.exp(-k.z * slantPath);
  const penetration10 = computePenetrationDepths(envState, 0.10, transfer, k);

  return {
    r,
    g,
    b,
    slantPath,
    slantFactor: transfer.slantFactor,
    thetaTDeg: transfer.thetaTDeg,
    fresnelReflectance: transfer.fresnelReflectance,
    surfaceTransmittance: transfer.surfaceTransmittance,
    penetration10,
  };
}

/**
 * Compute solar direction (above water), refracted underwater sun vector (Snell's law),
 * and time-of-day / elevation coupled above-water solar & sky colors.
 */
export function computeAtmosphereAndSun(envState = DEFAULT_ENV_STATE) {
  const transfer = computeSolarWaterTransfer(envState);
  const sunElevDeg = THREE.MathUtils.clamp(
    Number.isFinite(envState?.sunElevation) ? envState.sunElevation : DEFAULT_ENV_STATE.sunElevation,
    2,
    89
  );
  const timeOfDay = THREE.MathUtils.clamp(
    Number.isFinite(envState?.timeOfDay) ? envState.timeOfDay : DEFAULT_ENV_STATE.timeOfDay,
    5.0,
    20.0
  );

  const { elevRad, cosElev, sinElev, cosThetaT } = transfer;

  // Solar azimuth sweeps East -> South -> West across the Gulf of Eilat day.
  // Offset puts noon sun slightly ahead (-Z) for dramatic Snell's window & sun shafts.
  const hourNorm = (timeOfDay - 12.25) / 6.75;
  const azimuth = hourNorm * 1.32 + 0.22;

  const sunAboveDir = new THREE.Vector3(
    Math.sin(azimuth) * cosElev,
    sinElev,
    -Math.cos(azimuth) * cosElev
  ).normalize();

  // Exact Snell's law refraction from air (n1 = 1.0) into seawater (n2 = 1.3315).
  // Vector points UPWARD from underwater toward the refracted sun position.
  const eta = WORLD_CONSTANTS.IOR_AIR / WORLD_CONSTANTS.IOR_WATER;

  const refractedSunDir = new THREE.Vector3(
    eta * sunAboveDir.x,
    cosThetaT,
    eta * sunAboveDir.z
  ).normalize();

  // Kasten-Young atmospheric air mass for Rayleigh & aerosol scattering
  const airMass = 1.0 / (Math.max(0.04, sinElev) + 0.15 * Math.pow(sunElevDeg + 3.885, -1.253));
  const clampedAM = Math.min(airMass, 11.0);

  // Time-of-day twilight / golden hour warmth factor
  const distFromDawn = Math.abs(timeOfDay - 5.5);
  const distFromDusk = Math.abs(19.5 - timeOfDay);
  const minEdge = Math.min(distFromDawn, distFromDusk);
  const twilightFactor = 1.0 - THREE.MathUtils.smoothstep(minEdge, 0.0, 1.5);
  const goldenFactor = Math.max(
    1.0 - THREE.MathUtils.smoothstep(sunElevDeg, 5.0, 26.0),
    (1.0 - THREE.MathUtils.smoothstep(minEdge, 0.3, 2.6)) * 0.75
  );

  // Spectral solar transmittance through atmosphere (stronger blue/green extinction at low sun)
  const sunR = Math.exp(-0.075 * clampedAM);
  const sunG = Math.exp(-0.135 * clampedAM);
  const sunB = Math.exp(-0.275 * clampedAM);

  // Daylight intensity curve from twilight into crisp Red Sea noon
  const elevIntensity = Math.pow(sinElev, 0.48);
  const twilightDim = 1.0 - twilightFactor * 0.65;
  const sunStrength = (0.75 + 2.55 * elevIntensity) * twilightDim;

  const sunAboveColor = new THREE.Color(
    sunR * sunStrength,
    sunG * sunStrength * (1.0 - goldenFactor * 0.08),
    sunB * sunStrength * (1.0 - goldenFactor * 0.18)
  );

  // Above-water sky zenith & horizon colors (linear RGB)
  const noonZenith = new THREE.Color(0.08, 0.31, 0.84);
  const goldenZenith = new THREE.Color(0.09, 0.16, 0.44);
  const twilightZenith = new THREE.Color(0.025, 0.045, 0.15);

  const skyZenithColor = noonZenith
    .clone()
    .lerp(goldenZenith, goldenFactor * 0.85)
    .lerp(twilightZenith, twilightFactor * 0.85);

  const noonHorizon = new THREE.Color(0.46, 0.73, 0.96);
  const goldenHorizon = new THREE.Color(0.95, 0.44, 0.19);
  const twilightHorizon = new THREE.Color(0.16, 0.17, 0.32);

  const skyHorizonColor = noonHorizon
    .clone()
    .lerp(goldenHorizon, goldenFactor * 0.88)
    .lerp(twilightHorizon, twilightFactor * 0.82);

  return {
    elevRad,
    sunAboveDir,
    refractedSunDir,
    sunAboveColor,
    skyZenithColor,
    skyHorizonColor,
    goldenFactor,
    twilightFactor,
    daylightFactor: elevIntensity * twilightDim,
    fresnelReflectance: transfer.fresnelReflectance,
    surfaceTransmittance: transfer.surfaceTransmittance,
  };
}

/**
 * Create shared optical uniforms object passed across all underwater shaders.
 */
export function createWaterOpticsUniforms(initialEnvState = DEFAULT_ENV_STATE) {
  const surfaceY = WORLD_CONSTANTS.SURFACE_BASE_Y + (initialEnvState?.diveDepth ?? DEFAULT_ENV_STATE.diveDepth);
  const uniforms = {
    uTime: { value: 0 },
    uSurfaceY: { value: surfaceY },
    uAttenuationRGB: { value: computeAttenuationRGB(initialEnvState?.turbidity) },
    uSunAboveColor: { value: new THREE.Color(1, 0.95, 0.88) },
    uSunAboveDir: { value: new THREE.Vector3(0.1, 0.88, -0.45).normalize() },
    uRefractedSunDir: { value: new THREE.Vector3(0.08, 0.94, -0.33).normalize() },
    uSunElevationRad: { value: THREE.MathUtils.degToRad(initialEnvState?.sunElevation ?? 62) },
    uTurbidity: { value: initialEnvState?.turbidity ?? DEFAULT_ENV_STATE.turbidity },
    uTimeOfDay: { value: initialEnvState?.timeOfDay ?? DEFAULT_ENV_STATE.timeOfDay },
    uScatterAlbedo: { value: new THREE.Vector3(0.06, 0.28, 0.46) },
    uSkyZenithColor: { value: new THREE.Color(0.08, 0.31, 0.84) },
    uSkyHorizonColor: { value: new THREE.Color(0.46, 0.73, 0.96) },
    uScatterColor: { value: new THREE.Color(0.02, 0.24, 0.42) },
    uDeepScatterColor: { value: new THREE.Color(0.005, 0.08, 0.19) },
    uUpScatterColor: { value: new THREE.Color(0.04, 0.34, 0.52) },
    uBackgroundColor: { value: new THREE.Color(0.02, 0.24, 0.42) },
    uCausticsIntensity: { value: 1.0 },
    uWaveIntensity: { value: THREE.MathUtils.clamp(initialEnvState?.waveIntensity ?? 0.28, 0, 1) },
    uWavePhase: { value: 0 },
    uSurfaceTransmittance: { value: 0.97 },
    uPathTortuosity: { value: 1.025 },
    uCurrentOffset: { value: new THREE.Vector3(0, 0, 0) },
    uCurrentVel: { value: new THREE.Vector3(0, -0.02, 0.45) },
  };

  updateWaterOpticsUniforms(uniforms, 0, WORLD_CONSTANTS.SURFACE_BASE_Y, initialEnvState);
  return uniforms;
}

/**
 * Update all optical uniforms and compute camera-depth-coupled asymptotic water scatter.
 */
export function updateWaterOpticsUniforms(uniforms, elapsedTime, cameraY, envState = DEFAULT_ENV_STATE, exposure = 1.05) {
  const state = { ...DEFAULT_ENV_STATE, ...envState };
  const surfaceY = WORLD_CONSTANTS.SURFACE_BASE_Y + state.diveDepth;

  const dt = Math.max(0, Math.min(0.1, elapsedTime - uniforms.uTime.value));
  const { flowX, flowZ, speed } = getFlowVectors(state);
  uniforms.uCurrentVel.value.set(flowX * speed, -0.032, flowZ * speed);
  const off = uniforms.uCurrentOffset.value;
  off.x += flowX * speed * 1.15 * dt;
  off.y -= 0.038 * dt;
  off.z += flowZ * speed * 1.15 * dt;

  uniforms.uTime.value = elapsedTime;
  uniforms.uSurfaceY.value = surfaceY;
  uniforms.uTurbidity.value = THREE.MathUtils.clamp(state.turbidity, 0, 1);
  uniforms.uTimeOfDay.value = state.timeOfDay;

  const waveInt = THREE.MathUtils.clamp(
    Number.isFinite(state.waveIntensity) ? state.waveIntensity : 0.28,
    0,
    1
  );
  uniforms.uWaveIntensity.value = waveInt;
  uniforms.uWavePhase.value += dt * (0.72 + waveInt * 1.28);

  computeAttenuationRGB(uniforms.uTurbidity.value, uniforms.uAttenuationRGB.value);

  const atmo = computeAtmosphereAndSun(state);
  const transfer = computeSolarWaterTransfer(state);
  uniforms.uSunElevationRad.value = atmo.elevRad;
  uniforms.uSunAboveDir.value.copy(atmo.sunAboveDir);
  uniforms.uRefractedSunDir.value.copy(atmo.refractedSunDir);
  uniforms.uSunAboveColor.value.copy(atmo.sunAboveColor);
  uniforms.uSkyZenithColor.value.copy(atmo.skyZenithColor);
  uniforms.uSkyHorizonColor.value.copy(atmo.skyHorizonColor);
  if (uniforms.uSurfaceTransmittance) {
    uniforms.uSurfaceTransmittance.value = transfer.surfaceTransmittance;
  }
  if (uniforms.uPathTortuosity) {
    uniforms.uPathTortuosity.value = transfer.pathTortuosity;
  }

  // Volume single-scattering albedo shifts from crisp cobalt-cyan (clear water)
  // toward emerald-teal as suspended particles (turbidity) increase.
  const t = uniforms.uTurbidity.value;
  uniforms.uScatterAlbedo.value.set(
    THREE.MathUtils.lerp(0.025, 0.16, t),
    THREE.MathUtils.lerp(0.24, 0.46, t),
    THREE.MathUtils.lerp(0.46, 0.34, t)
  );

  // Downwelling irradiance reaching camera depth shapes ambient in-scattered water color
  const camDepth = Math.max(0.25, (surfaceY - 1.4) - cameraY);
  const cosRef = Math.max(atmo.refractedSunDir.y, 0.2);
  const k = uniforms.uAttenuationRGB.value;
  const downPath = (camDepth * 0.72 * transfer.pathTortuosity) / cosRef;

  // Blend direct solar spectrum with zenith/horizon skylight for ambient water illumination
  const skyAvgR = atmo.skyZenithColor.r * 0.55 + atmo.skyHorizonColor.r * 0.45;
  const skyAvgG = atmo.skyZenithColor.g * 0.55 + atmo.skyHorizonColor.g * 0.45;
  const skyAvgB = atmo.skyZenithColor.b * 0.55 + atmo.skyHorizonColor.b * 0.45;

  const downIrrR = (atmo.sunAboveColor.r * 0.42 * transfer.surfaceTransmittance + skyAvgR * 0.65)
    * Math.exp(-k.x * downPath);
  const downIrrG = (atmo.sunAboveColor.g * 0.42 * transfer.surfaceTransmittance + skyAvgG * 0.65)
    * Math.exp(-k.y * downPath);
  const downIrrB = (atmo.sunAboveColor.b * 0.42 * transfer.surfaceTransmittance + skyAvgB * 0.65)
    * Math.exp(-k.z * downPath)
    + 0.042 * atmo.daylightFactor;

  const sa = uniforms.uScatterAlbedo.value;
  // Horizontal asymptotic scatter radiance L_scatter
  const scatR = Math.max(0.0008, downIrrR * sa.x * 0.85);
  const scatG = Math.max(0.008, downIrrG * sa.y * 0.92);
  const scatB = Math.max(0.018, downIrrB * sa.z * 1.05);

  uniforms.uScatterColor.value.setRGB(scatR, scatG, scatB);
  uniforms.uDeepScatterColor.value.setRGB(scatR * 0.22, scatG * 0.34, scatB * 0.52);
  uniforms.uUpScatterColor.value.setRGB(scatR * 1.35, scatG * 1.28, scatB * 1.18);

  // Caustics soften gradually with turbidity, low daylight, and grazing Fresnel loss
  uniforms.uCausticsIntensity.value =
    (1.0 - t * 0.68) * (0.45 + 0.55 * atmo.daylightFactor) * transfer.fresnelTransmittance;

  // Exact ACES-tonemapped horizontal scatter for zero-seam scene.background
  applyACESFilmicToColor(uniforms.uScatterColor.value, exposure, uniforms.uBackgroundColor.value);
}
