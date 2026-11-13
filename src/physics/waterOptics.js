import * as THREE from 'three';
import { WORLD_CONSTANTS, DEFAULT_ENV_STATE, getFlowVectors } from '../contracts.js';

// Spectral attenuation coefficients (m^-1):
// K_rgb = K_clear + turbidity * K_turbid
// Red (620-700nm) attenuates rapidly within 5-15m; green (530nm) and blue (465nm) penetrate 30m+.
const K_CLEAR = new THREE.Vector3(0.24, 0.055, 0.017);
const K_TURBID = new THREE.Vector3(0.26, 0.18, 0.13);

const _tmpVec = new THREE.Vector3();
const _tmpDown = new THREE.Vector3();

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
 * Compute Beer-Lambert spectral transmittance T(d) = exp(-K_rgb * d) in [0, 1].
 */
export function getTransmittanceAtDepth(depthMeters, envState = DEFAULT_ENV_STATE) {
  const d = Math.max(0, Number.isFinite(depthMeters) ? depthMeters : 0);
  const k = computeAttenuationRGB(envState?.turbidity, _tmpVec);
  return {
    r: 0.78 * Math.exp(-k.x * d) + 0.22 * Math.exp(-k.x * 0.45 * d),
    g: Math.exp(-k.y * d),
    b: Math.exp(-k.z * d),
  };
}

/**
 * Compute solar direction (above water), refracted underwater sun vector (Snell's law),
 * and time-of-day / elevation coupled above-water solar & sky colors.
 */
export function computeAtmosphereAndSun(envState = DEFAULT_ENV_STATE) {
  const sunElevDeg = THREE.MathUtils.clamp(
    envState?.sunElevation ?? DEFAULT_ENV_STATE.sunElevation,
    2,
    89
  );
  const timeOfDay = THREE.MathUtils.clamp(
    envState?.timeOfDay ?? DEFAULT_ENV_STATE.timeOfDay,
    5.0,
    20.0
  );

  const elevRad = THREE.MathUtils.degToRad(sunElevDeg);
  const cosElev = Math.cos(elevRad);
  const sinElev = Math.sin(elevRad);

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
  const sinThetaI = cosElev;
  const sinThetaT = eta * sinThetaI;
  const cosThetaT = Math.sqrt(Math.max(0.0001, 1.0 - sinThetaT * sinThetaT));

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
  const elevIntensity = THREE.MathUtils.smoothstep(sunElevDeg, 3.0, 32.0) * 0.72 + 0.28;
  const twilightDim = 1.0 - twilightFactor * 0.65;
  const sunStrength = (2.15 + 1.15 * elevIntensity) * twilightDim;

  const sunAboveColor = new THREE.Color(
    sunR * sunStrength,
    sunG * sunStrength * (1.0 - goldenFactor * 0.12),
    sunB * sunStrength * (1.0 - goldenFactor * 0.26)
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
  uniforms.uSunElevationRad.value = atmo.elevRad;
  uniforms.uSunAboveDir.value.copy(atmo.sunAboveDir);
  uniforms.uRefractedSunDir.value.copy(atmo.refractedSunDir);
  uniforms.uSunAboveColor.value.copy(atmo.sunAboveColor);
  uniforms.uSkyZenithColor.value.copy(atmo.skyZenithColor);
  uniforms.uSkyHorizonColor.value.copy(atmo.skyHorizonColor);

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

  // Blend direct solar spectrum with zenith/horizon skylight for ambient water illumination
  const skyAvgR = atmo.skyZenithColor.r * 0.55 + atmo.skyHorizonColor.r * 0.45;
  const skyAvgG = atmo.skyZenithColor.g * 0.55 + atmo.skyHorizonColor.g * 0.45;
  const skyAvgB = atmo.skyZenithColor.b * 0.55 + atmo.skyHorizonColor.b * 0.45;

  const downIrrR = (atmo.sunAboveColor.r * 0.42 + skyAvgR * 0.65) * Math.exp(-k.x * (camDepth * 0.72 / cosRef));
  const downIrrG = (atmo.sunAboveColor.g * 0.42 + skyAvgG * 0.65) * Math.exp(-k.y * (camDepth * 0.72 / cosRef));
  const downIrrB = (atmo.sunAboveColor.b * 0.42 + skyAvgB * 0.65) * Math.exp(-k.z * (camDepth * 0.72 / cosRef))
    + 0.042 * atmo.daylightFactor;

  const sa = uniforms.uScatterAlbedo.value;
  // Horizontal asymptotic scatter radiance L_scatter
  const scatR = Math.max(0.0008, downIrrR * sa.x * 0.85);
  const scatG = Math.max(0.008, downIrrG * sa.y * 0.92);
  const scatB = Math.max(0.018, downIrrB * sa.z * 1.05);

  uniforms.uScatterColor.value.setRGB(scatR, scatG, scatB);
  uniforms.uDeepScatterColor.value.setRGB(scatR * 0.22, scatG * 0.34, scatB * 0.52);
  uniforms.uUpScatterColor.value.setRGB(scatR * 1.35, scatG * 1.28, scatB * 1.18);

  // Caustics soften gradually with turbidity and very deep water
  uniforms.uCausticsIntensity.value = (1.0 - t * 0.68) * (0.45 + 0.55 * atmo.daylightFactor);

  // Exact ACES-tonemapped horizontal scatter for zero-seam scene.background
  applyACESFilmicToColor(uniforms.uScatterColor.value, exposure, uniforms.uBackgroundColor.value);
}
