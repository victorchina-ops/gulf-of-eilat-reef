import * as THREE from 'three';
import { WORLD_CONSTANTS, DEFAULT_ENV_STATE, getFlowVectors } from '../contracts.js';
import { computeSolarAzimuthRad, normalizeDayOfYear } from './solarCalendar.js';

// Spectral Jerlov attenuation coefficients (m^-1):
// K_rgb = K_clear + turbidity * K_turbid
// Red (620-700nm) attenuates rapidly within 5-15m; green (530nm) and blue (465nm) penetrate 30m+.
// At high turbidity, CDOM + phytoplankton absorb blue slightly faster than green, shifting murky water teal-emerald.
const K_CLEAR = new THREE.Vector3(0.24, 0.055, 0.017);
const K_TURBID = new THREE.Vector3(0.26, 0.14, 0.19);
const K_VIEW_SCATTER = new THREE.Vector3(0.095, 0.065, 0.085);
const BB_WATER = new THREE.Vector3(0.0008, 0.0016, 0.0032);
const BB_PARTICLE = new THREE.Vector3(0.015, 0.032, 0.030);
const WAVE_DISPERSION_OMEGA = 1.765; // Deep-water swell dispersion angular frequency (rad/s)
const MARINE_SNOW_SETTLING_MPS = 0.0012;

const _tmpVec = new THREE.Vector3();
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
 * Compute Beer-Lambert diffuse attenuation coefficient vector K_rgb in m^-1.
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
 * Compute horizontal / view-path Jerlov beam-attenuation vector c_rgb in m^-1.
 * Clear-water red horizontal attenuation stays >= 0.24 m^-1 (>= 0.22 m^-1).
 */
export function computeViewAttenuationRGB(turbidity = DEFAULT_ENV_STATE.turbidity, out = new THREE.Vector3()) {
  const t = THREE.MathUtils.clamp(
    Number.isFinite(turbidity) ? turbidity : DEFAULT_ENV_STATE.turbidity,
    0,
    1
  );
  computeAttenuationRGB(t, out);
  return out.set(
    out.x + t * K_VIEW_SCATTER.x,
    out.y + t * K_VIEW_SCATTER.y,
    out.z + t * K_VIEW_SCATTER.z
  );
}

/**
 * Kasten-Young (1989) atmospheric relative optical air mass formula.
 */
export function computeKastenYoungAirMass(sunElevDeg) {
  const elev = THREE.MathUtils.clamp(
    Number.isFinite(sunElevDeg) ? sunElevDeg : DEFAULT_ENV_STATE.sunElevation,
    0.5,
    90.0
  );
  const sinElev = Math.sin(THREE.MathUtils.degToRad(elev));
  return 1.0 / (sinElev + 0.50572 * Math.pow(elev + 6.07995, -1.6364));
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

  const n_w = WORLD_CONSTANTS.IOR_WATER; // 1.3315 -> n^2 = 1.773
  const nWaterSq = n_w * n_w;

  const sinElev = Math.sin(elevRad);
  const cosElev = Math.cos(elevRad);
  const cosThetaI = sinElev;
  const sinThetaI = cosElev;
  const sin2ThetaT = (sinThetaI * sinThetaI) / nWaterSq;
  const cosThetaT = Math.sqrt(Math.max(0.0001, 1.0 - sin2ThetaT));
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

  // Solar azimuth from Spencer (1971) spherical solar geometry:
  // East (+X) morning -> South (+Z) noon -> West (-X) evening.
  const dayOfYear = normalizeDayOfYear(envState?.dayOfYear);
  const azimuth = computeSolarAzimuthRad(timeOfDay, dayOfYear);

  const sunAboveDir = new THREE.Vector3(
    Math.sin(azimuth) * cosElev,
    sinElev,
    -Math.cos(azimuth) * cosElev
  ).normalize();

  // Exact Snell's law refraction from air (n1 = 1.0) into seawater (n2 = 1.3315, n^2 = 1.773).
  // Vector points UPWARD from underwater toward the refracted sun position.
  const eta = WORLD_CONSTANTS.IOR_AIR / WORLD_CONSTANTS.IOR_WATER;

  const refractedSunDir = new THREE.Vector3(
    eta * sunAboveDir.x,
    cosThetaT,
    eta * sunAboveDir.z
  ).normalize();

  // Kasten-Young (1989) atmospheric air mass for Rayleigh & aerosol scattering
  const airMass = computeKastenYoungAirMass(sunElevDeg);

  // Twilight & golden hour warmth factors driven strictly by solar elevation angle
  const twilightFactor = 1.0 - THREE.MathUtils.smoothstep(sunElevDeg, 1.5, 9.5);
  const goldenFactor = 1.0 - THREE.MathUtils.smoothstep(sunElevDeg, 5.0, 26.0);

  // Spectral solar transmittance through atmosphere (stronger blue/green extinction at low sun)
  const sunR = Math.exp(-0.075 * airMass);
  const sunG = Math.exp(-0.135 * airMass);
  const sunB = Math.exp(-0.275 * airMass);

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
 * Compute target eye-adaptation exposure for underwater lighting conditions,
 * keeping bright shallow midday surfaces crisp and deep/dusk scenes clear.
 */
export function computeAutoExposure(camDepth, atmo, transfer, k) {
  const depth = Math.max(0.05, Number.isFinite(camDepth) ? camDepth : 6.0);
  const downPath = depth * (transfer?.slantFactor ?? 1.15);
  const surfT = transfer?.surfaceTransmittance ?? 0.95;
  const tG = surfT * Math.exp(-(k?.y ?? 0.08) * downPath);
  const tB = surfT * Math.exp(-(k?.z ?? 0.05) * downPath);

  const sunLum =
    (atmo?.sunAboveColor?.r ?? 1.0) * 0.2126 +
    (atmo?.sunAboveColor?.g ?? 0.95) * 0.7152 +
    (atmo?.sunAboveColor?.b ?? 0.88) * 0.0722;
  const skyLum =
    ((atmo?.skyZenithColor?.g ?? 0.31) * 0.55 + (atmo?.skyHorizonColor?.g ?? 0.73) * 0.45) *
    (0.35 + 0.65 * (atmo?.daylightFactor ?? 1.0));
  const sceneLuminance = Math.max(0.035, (sunLum * 0.38 + skyLum * 0.42) * (0.45 * tG + 0.55 * tB));
  return THREE.MathUtils.clamp(0.96 / Math.pow(sceneLuminance, 0.34), 0.78, 2.25);
}

/**
 * Create shared optical uniforms object passed across all underwater shaders.
 */
export function createWaterOpticsUniforms(initialEnvState = DEFAULT_ENV_STATE) {
  const surfaceY = WORLD_CONSTANTS.SURFACE_BASE_Y + (initialEnvState?.diveDepth ?? DEFAULT_ENV_STATE.diveDepth);
  const initTurb = initialEnvState?.turbidity ?? DEFAULT_ENV_STATE.turbidity;
  const initTransfer = computeSolarWaterTransfer(initialEnvState);
  const uniforms = {
    uTime: { value: 0 },
    uSurfaceY: { value: surfaceY },
    uAttenuationRGB: { value: computeAttenuationRGB(initTurb) },
    uViewAttenuationRGB: { value: computeViewAttenuationRGB(initTurb) },
    uSunAboveColor: { value: new THREE.Color(1, 0.95, 0.88) },
    uSunAboveDir: { value: new THREE.Vector3(0.1, 0.88, 0.45).normalize() },
    uRefractedSunDir: { value: new THREE.Vector3(0.08, 0.94, 0.33).normalize() },
    uSunElevationRad: { value: THREE.MathUtils.degToRad(initialEnvState?.sunElevation ?? 62) },
    uTurbidity: { value: initTurb },
    uTimeOfDay: { value: initialEnvState?.timeOfDay ?? DEFAULT_ENV_STATE.timeOfDay },
    uDayOfYear: { value: normalizeDayOfYear(initialEnvState?.dayOfYear) },
    uScatterAlbedo: { value: new THREE.Vector3(0.014, 0.095, 0.165) },
    uSkyZenithColor: { value: new THREE.Color(0.08, 0.31, 0.84) },
    uSkyHorizonColor: { value: new THREE.Color(0.46, 0.73, 0.96) },
    uScatterColor: { value: new THREE.Color(0.004, 0.055, 0.12) },
    uDeepScatterColor: { value: new THREE.Color(0.001, 0.020, 0.065) },
    uUpScatterColor: { value: new THREE.Color(0.008, 0.080, 0.16) },
    uBackgroundColor: { value: new THREE.Color(0.004, 0.055, 0.12) },
    uCausticsIntensity: { value: 1.0 },
    uWaveIntensity: { value: THREE.MathUtils.clamp(initialEnvState?.waveIntensity ?? 0.28, 0, 1) },
    uWavePhase: { value: 0 },
    uSurfaceTransmittance: { value: initTransfer.surfaceTransmittance },
    uPathTortuosity: { value: initTransfer.pathTortuosity },
    uDownPathFactor: { value: initTransfer.slantFactor },
    uExposure: { value: 1.05 },
    uCurrentOffset: { value: new THREE.Vector3(0, 0, 0) },
    uCurrentVel: { value: new THREE.Vector3(0, -MARINE_SNOW_SETTLING_MPS, 0.45) },
  };

  updateWaterOpticsUniforms(uniforms, 0, WORLD_CONSTANTS.SURFACE_BASE_Y, initialEnvState, null, 0);
  return uniforms;
}

/**
 * Update all optical uniforms and compute camera-depth-coupled asymptotic water scatter.
 */
export function updateWaterOpticsUniforms(
  uniforms,
  elapsedTime,
  cameraY,
  envState = DEFAULT_ENV_STATE,
  exposure = null,
  deltaTime = null
) {
  const state = { ...DEFAULT_ENV_STATE, ...envState };
  const surfaceY = WORLD_CONSTANTS.SURFACE_BASE_Y + state.diveDepth;

  const rawDt = Number.isFinite(deltaTime) && deltaTime >= 0
    ? deltaTime
    : (elapsedTime - uniforms.uTime.value);
  const dt = Math.max(0, Math.min(1.0, Number.isFinite(rawDt) ? rawDt : 0));

  const { flowX, flowZ, speed } = getFlowVectors(state);
  uniforms.uCurrentVel.value.set(flowX * speed, -MARINE_SNOW_SETTLING_MPS, flowZ * speed);
  const off = uniforms.uCurrentOffset.value;
  off.x += flowX * speed * dt;
  off.y -= MARINE_SNOW_SETTLING_MPS * dt;
  off.z += flowZ * speed * dt;

  uniforms.uTime.value = elapsedTime;
  uniforms.uSurfaceY.value = surfaceY;
  uniforms.uTurbidity.value = THREE.MathUtils.clamp(state.turbidity, 0, 1);
  uniforms.uTimeOfDay.value = state.timeOfDay;
  if (uniforms.uDayOfYear) {
    uniforms.uDayOfYear.value = normalizeDayOfYear(state.dayOfYear);
  }

  const waveInt = THREE.MathUtils.clamp(
    Number.isFinite(state.waveIntensity) ? state.waveIntensity : 0.28,
    0,
    1
  );
  uniforms.uWaveIntensity.value = waveInt;
  // Constant deep-water dispersion angular frequency (1.765 rad/s), independent of waveIntensity amplitude
  uniforms.uWavePhase.value += dt * WAVE_DISPERSION_OMEGA;

  const t = uniforms.uTurbidity.value;
  computeAttenuationRGB(t, uniforms.uAttenuationRGB.value);
  if (uniforms.uViewAttenuationRGB) {
    computeViewAttenuationRGB(t, uniforms.uViewAttenuationRGB.value);
  }

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
  if (uniforms.uDownPathFactor) {
    uniforms.uDownPathFactor.value = transfer.slantFactor;
  }

  // Volume single-scattering reflectance R_scatter ~ 1.15 * b_b / (K + b_b)
  // Shifts naturally from deep Red Sea cobalt-azure (clear) to emerald-teal (turbid).
  const k = uniforms.uAttenuationRGB.value;
  const bbR = BB_WATER.x + t * BB_PARTICLE.x;
  const bbG = BB_WATER.y + t * BB_PARTICLE.y;
  const bbB = BB_WATER.z + t * BB_PARTICLE.z;
  uniforms.uScatterAlbedo.value.set(
    (bbR / (k.x + bbR)) * 1.15,
    (bbG / (k.y + bbG)) * 1.15,
    (bbB / (k.z + bbB)) * 1.15
  );

  // Unified depth datum: depth below water surface without arbitrary offset
  const camDepth = Math.max(0.05, surfaceY - cameraY);
  const downPathFactor = uniforms.uDownPathFactor ? uniforms.uDownPathFactor.value : transfer.slantFactor;
  const downPath = camDepth * downPathFactor;

  // Blend direct solar spectrum with zenith/horizon skylight for ambient water illumination
  const skyAvgR = atmo.skyZenithColor.r * 0.55 + atmo.skyHorizonColor.r * 0.45;
  const skyAvgG = atmo.skyZenithColor.g * 0.55 + atmo.skyHorizonColor.g * 0.45;
  const skyAvgB = atmo.skyZenithColor.b * 0.55 + atmo.skyHorizonColor.b * 0.45;

  const downIrrR = (atmo.sunAboveColor.r * 0.42 * transfer.surfaceTransmittance + skyAvgR * 0.65)
    * (0.78 * Math.exp(-k.x * downPath) + 0.22 * Math.exp(-0.45 * k.x * downPath));
  const downIrrG = (atmo.sunAboveColor.g * 0.42 * transfer.surfaceTransmittance + skyAvgG * 0.65)
    * Math.exp(-k.y * downPath);
  const downIrrB = (atmo.sunAboveColor.b * 0.42 * transfer.surfaceTransmittance + skyAvgB * 0.65)
    * Math.exp(-k.z * downPath)
    + 0.015 * atmo.daylightFactor;

  const sa = uniforms.uScatterAlbedo.value;
  // Horizontal asymptotic scatter radiance L_scatter
  const scatR = Math.max(0.0004, downIrrR * sa.x);
  const scatG = Math.max(0.0035, downIrrG * sa.y);
  const scatB = Math.max(0.0085, downIrrB * sa.z);

  uniforms.uScatterColor.value.setRGB(scatR, scatG, scatB);
  uniforms.uDeepScatterColor.value.setRGB(scatR * 0.24, scatG * 0.36, scatB * 0.54);
  uniforms.uUpScatterColor.value.setRGB(scatR * 1.40, scatG * 1.32, scatB * 1.22);

  // Caustics soften gradually with turbidity, low daylight, and grazing Fresnel loss
  uniforms.uCausticsIntensity.value =
    (1.0 - t * 0.68) * (0.45 + 0.55 * atmo.daylightFactor) * transfer.fresnelTransmittance;

  const targetExposure = Number.isFinite(exposure)
    ? THREE.MathUtils.clamp(exposure, 0.5, 3.0)
    : computeAutoExposure(camDepth, atmo, transfer, k);

  if (uniforms.uExposure) {
    if (dt <= 0 || Number.isFinite(exposure)) {
      uniforms.uExposure.value = targetExposure;
    } else {
      const adaptAlpha = 1.0 - Math.exp(-dt * 3.0);
      uniforms.uExposure.value = THREE.MathUtils.lerp(uniforms.uExposure.value, targetExposure, adaptAlpha);
    }
  }
  const activeExposure = uniforms.uExposure ? uniforms.uExposure.value : targetExposure;

  // Exact ACES-tonemapped horizontal scatter for zero-seam scene.background
  applyACESFilmicToColor(uniforms.uScatterColor.value, activeExposure, uniforms.uBackgroundColor.value);
  return activeExposure;
}
