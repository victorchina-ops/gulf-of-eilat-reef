import * as THREE from 'three';
import { DEFAULT_ENV_STATE } from '../contracts.js';
import {
  computeAttenuationRGB,
  computeSolarWaterTransfer,
  getTransmittanceAtDepth,
} from './waterOptics.js';

const SUN_ELEV_REF_DEG = 83.9;
const DEG_TO_RAD = Math.PI / 180;
const SKY_SPEC = [0.55, 0.76, 1.0];
const SKY_WEIGHT = 0.22; // Consistent with sky-to-direct balance in computeSolarWaterTransfer
const DEEP_SCATTER_FLOOR = [0.0008, 0.005, 0.011];
const DEFAULT_VIEW_DISTANCE_M = 0.9;

const _kVec = new THREE.Vector3();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hexToRgb(hex) {
  const clean = String(hex).replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function rgbToHex(r255, g255, b255) {
  const toByteHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${toByteHex(r255)}${toByteHex(g255)}${toByteHex(b255)}`;
}

function relativeLuminance(rLin, gLin, bLin) {
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/**
 * Exact IEC 61966-2-1 sRGB EOTF converting normalized sRGB [0, 1] to linear light [0, 1].
 */
export function srgbToLinear(c01) {
  const c = clamp(Number.isFinite(c01) ? c01 : 0, 0, 1);
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  const lin = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return clamp(lin, 0, 1);
}

/**
 * Exact IEC 61966-2-1 sRGB OETF converting linear light [0, 1] to normalized sRGB [0, 1].
 */
export function linearToSrgb(c01) {
  const c = clamp(Number.isFinite(c01) ? c01 : 0, 0, 1);
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return clamp(srgb, 0, 1);
}

const RAW_COLORCHECKER_PATCHES = [
  // Row 0
  ['dark-skin', 'Dark Skin', '#735244'],
  ['light-skin', 'Light Skin', '#c29682'],
  ['blue-sky', 'Blue Sky', '#627a9d'],
  ['foliage', 'Foliage', '#576c43'],
  ['blue-flower', 'Blue Flower', '#8580b1'],
  ['bluish-green', 'Bluish Green', '#67bdaa'],
  // Row 1
  ['orange', 'Orange', '#d67e2c'],
  ['purplish-blue', 'Purplish Blue', '#505ba6'],
  ['moderate-red', 'Moderate Red', '#c15a63'],
  ['purple', 'Purple', '#5e3c6c'],
  ['yellow-green', 'Yellow Green', '#9dbc40'],
  ['orange-yellow', 'Orange Yellow', '#e0a32e'],
  // Row 2
  ['blue', 'Blue', '#383d96'],
  ['green', 'Green', '#469449'],
  ['red', 'Red', '#af363c'],
  ['yellow', 'Yellow', '#e7c71f'],
  ['magenta', 'Magenta', '#bb5695'],
  ['cyan', 'Cyan', '#0885a1'],
  // Row 3 (neutral grayscale ramp)
  ['white-95', 'White 9.5', '#f3f3f2'],
  ['neutral-8', 'Neutral 8', '#c8c8c8'],
  ['neutral-65', 'Neutral 6.5', '#a0a0a0'],
  ['neutral-5', 'Neutral 5', '#7a7a79'],
  ['neutral-35', 'Neutral 3.5', '#555555'],
  ['black-2', 'Black 2', '#343434'],
];

/**
 * Standard 24-patch X-Rite ColorChecker Classic reference table (4 rows x 6 cols).
 */
export const COLORCHECKER_CLASSIC_PATCHES = RAW_COLORCHECKER_PATCHES.map(([id, name, surfaceHex], index) => {
  const row = Math.floor(index / 6);
  const col = index % 6;
  const surfaceRGB = hexToRgb(surfaceHex);
  const surfaceLinear = [
    srgbToLinear(surfaceRGB[0] / 255),
    srgbToLinear(surfaceRGB[1] / 255),
    srgbToLinear(surfaceRGB[2] / 255),
  ];
  const surfaceLuminance = relativeLuminance(
    surfaceLinear[0],
    surfaceLinear[1],
    surfaceLinear[2]
  );

  return {
    index,
    id,
    name,
    row,
    col,
    surfaceHex,
    surfaceRGB,
    surfaceLinear,
    surfaceLuminance,
  };
});

function computeRawSurfaceIrradiance(sunElevDeg) {
  const sinElev = Math.sin(sunElevDeg * DEG_TO_RAD);
  const airMass = Math.min(
    11.0,
    1.0 / (Math.max(0.04, sinElev) + 0.15 * Math.pow(sunElevDeg + 3.885, -1.253))
  );
  const tAtmR = Math.exp(-0.075 * airMass);
  const tAtmG = Math.exp(-0.135 * airMass);
  const tAtmB = Math.exp(-0.275 * airMass);
  const skyScale = 0.28 + 0.72 * Math.pow(Math.max(0.02, sinElev), 0.6);

  return [
    tAtmR * sinElev + SKY_WEIGHT * SKY_SPEC[0] * skyScale,
    tAtmG * sinElev + SKY_WEIGHT * SKY_SPEC[1] * skyScale,
    tAtmB * sinElev + SKY_WEIGHT * SKY_SPEC[2] * skyScale,
  ];
}

const E_RAW_REF = computeRawSurfaceIrradiance(SUN_ELEV_REF_DEG);

function resolveEnvState(envState) {
  const safeEnv = envState && typeof envState === 'object' ? envState : DEFAULT_ENV_STATE;
  const diveDepth = Math.max(
    0,
    Number.isFinite(safeEnv.diveDepth) ? safeEnv.diveDepth : DEFAULT_ENV_STATE.diveDepth
  );
  const sunElevation = clamp(
    Number.isFinite(safeEnv.sunElevation) ? safeEnv.sunElevation : DEFAULT_ENV_STATE.sunElevation,
    2,
    89
  );
  const turbidity = clamp(
    Number.isFinite(safeEnv.turbidity) ? safeEnv.turbidity : DEFAULT_ENV_STATE.turbidity,
    0,
    1
  );
  const waveIntensity = clamp(
    Number.isFinite(safeEnv.waveIntensity) ? safeEnv.waveIntensity : DEFAULT_ENV_STATE.waveIntensity,
    0,
    1
  );

  return {
    ...DEFAULT_ENV_STATE,
    ...safeEnv,
    diveDepth,
    sunElevation,
    turbidity,
    waveIntensity,
  };
}

/**
 * Simulate perceived underwater appearance of the 24-patch X-Rite ColorChecker Classic
 * under Gulf of Eilat atmospheric, air-sea Fresnel/Snell, Beer-Lambert downwelling,
 * and diver-to-slate backscatter veil optics.
 */
export function simulateColorChecker(envState = DEFAULT_ENV_STATE, options = {}) {
  const resolvedEnv = resolveEnvState(envState);
  const depthMeters = resolvedEnv.diveDepth;
  const sunElevationDeg = resolvedEnv.sunElevation;
  const turbidity = resolvedEnv.turbidity;
  const rawViewDistance = options?.viewDistance;
  const viewDistance = Math.max(
    0,
    Number.isFinite(rawViewDistance) ? rawViewDistance : DEFAULT_VIEW_DISTANCE_M
  );

  const transfer = computeSolarWaterTransfer(resolvedEnv);
  const k = computeAttenuationRGB(turbidity, _kVec);
  const tDown = getTransmittanceAtDepth(depthMeters, resolvedEnv);

  const rawSurface = computeRawSurfaceIrradiance(sunElevationDeg);
  const eSurf = [
    rawSurface[0] / E_RAW_REF[0],
    rawSurface[1] / E_RAW_REF[1],
    rawSurface[2] / E_RAW_REF[2],
  ];

  const deepStep = smoothstep(8, 28, depthMeters);
  const blueDown = eSurf[2] * tDown.b;
  const iChart = [
    eSurf[0] * tDown.r + blueDown * DEEP_SCATTER_FLOOR[0] * deepStep,
    eSurf[1] * tDown.g + blueDown * DEEP_SCATTER_FLOOR[1] * deepStep,
    eSurf[2] * tDown.b + blueDown * DEEP_SCATTER_FLOOR[2] * deepStep,
  ];

  const kView = [
    k.x * 0.18 + turbidity * 0.095,
    k.y * 0.55 + turbidity * 0.095,
    k.z * 0.80 + turbidity * 0.095,
  ];
  const tView = [
    Math.exp(-kView[0] * viewDistance),
    Math.exp(-kView[1] * viewDistance),
    Math.exp(-kView[2] * viewDistance),
  ];
  const veilAlbedo = [
    lerp(0.015, 0.075, turbidity),
    lerp(0.085, 0.145, turbidity),
    lerp(0.155, 0.135, turbidity),
  ];
  const veilLin = [
    iChart[0] * veilAlbedo[0] * (1 - tView[0]),
    iChart[1] * veilAlbedo[1] * (1 - tView[1]),
    iChart[2] * veilAlbedo[2] * (1 - tView[2]),
  ];

  const patches = COLORCHECKER_CLASSIC_PATCHES.map((patch) => {
    const obsR = clamp(patch.surfaceLinear[0] * iChart[0] * tView[0] + veilLin[0], 0, 1);
    const obsG = clamp(patch.surfaceLinear[1] * iChart[1] * tView[1] + veilLin[1], 0, 1);
    const obsB = clamp(patch.surfaceLinear[2] * iChart[2] * tView[2] + veilLin[2], 0, 1);

    const underwaterRGB = [
      clamp(Math.round(linearToSrgb(obsR) * 255), 0, 255),
      clamp(Math.round(linearToSrgb(obsG) * 255), 0, 255),
      clamp(Math.round(linearToSrgb(obsB) * 255), 0, 255),
    ];
    const underwaterHex = rgbToHex(underwaterRGB[0], underwaterRGB[1], underwaterRGB[2]);
    const underwaterLuminance = relativeLuminance(obsR, obsG, obsB);
    const luminanceRetentionPct =
      (underwaterLuminance / Math.max(1e-5, patch.surfaceLuminance)) * 100;

    return {
      index: patch.index,
      id: patch.id,
      name: patch.name,
      row: patch.row,
      col: patch.col,
      surfaceHex: patch.surfaceHex,
      surfaceRGB: [...patch.surfaceRGB],
      surfaceLinear: [...patch.surfaceLinear],
      surfaceLuminance: patch.surfaceLuminance,
      underwaterLinear: [obsR, obsG, obsB],
      underwaterRGB,
      underwaterHex,
      underwaterLuminance,
      luminanceRetentionPct,
    };
  });

  const whitePatch = patches[18];
  const blackPatch = patches[23];
  let neutralRetentionSum = 0;
  for (let i = 18; i <= 23; i++) {
    neutralRetentionSum += patches[i].luminanceRetentionPct;
  }

  const summary = {
    brightnessPct: whitePatch.luminanceRetentionPct,
    meanBrightnessPct: neutralRetentionSum / 6,
    // Guard against division by zero without clamping above real deep-water black luminance (~1.2e-8 min)
    contrastRatio: whitePatch.underwaterLuminance / Math.max(1e-9, blackPatch.underwaterLuminance),
    effectiveIrradiancePct: {
      r: iChart[0] * 100,
      g: iChart[1] * 100,
      b: iChart[2] * 100,
    },
    surfaceSolarFactorPct: relativeLuminance(eSurf[0], eSurf[1], eSurf[2]) * 100,
    depthMeters,
    slantPathMeters: tDown.slantPath,
    sunElevationDeg,
    thetaTDeg: tDown.thetaTDeg,
    fresnelLossPct: transfer.fresnelReflectance * 100,
    turbidity,
  };

  return { patches, summary };
}
