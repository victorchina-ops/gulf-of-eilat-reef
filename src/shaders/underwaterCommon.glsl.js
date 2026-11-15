import * as THREE from 'three';

export const GLSL_WAVE_NOISE = /* glsl */ `
vec2 uwHash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}

vec2 uwVoronoiEdge(vec2 uv, float time) {
  vec2 n = floor(uv);
  vec2 f = fract(uv);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = uwHash22(n + g);
      o = 0.5 + 0.42 * sin(time * 1.15 + 6.2831853 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float s1 = sqrt(d1);
  float s2 = sqrt(d2);
  return vec2(s2 - s1, s1);
}

float uwVoronoiRidge(vec2 uv, float time) {
  return uwVoronoiEdge(uv, time).y;
}
`;

export const GLSL_CAUSTICS = /* glsl */ `
${GLSL_WAVE_NOISE}

float uwCausticLayer(vec2 p, float wavePhase, float waveIntensity) {
  vec2 e1 = uwVoronoiEdge(p * 1.05 + vec2(wavePhase * 0.14, -wavePhase * 0.11), wavePhase * 1.05);
  vec2 e2 = uwVoronoiEdge(mat2(0.80, -0.60, 0.60, 0.80) * (p * 1.68) + vec2(-wavePhase * 0.16, wavePhase * 0.13), wavePhase * 1.25);
  vec2 e3 = uwVoronoiEdge(mat2(-0.54, -0.84, 0.84, -0.54) * (p * 2.60) + vec2(wavePhase * 0.11, wavePhase * 0.15), wavePhase * 1.42);
  float c1 = exp(-e1.x * mix(9.5, 16.5, waveIntensity)) * (0.75 + 0.65 * smoothstep(0.35, 0.72, e1.y));
  float c2 = exp(-e2.x * mix(8.5, 14.5, waveIntensity)) * (0.70 + 0.55 * smoothstep(0.35, 0.72, e2.y));
  float c3 = exp(-e3.x * mix(7.5, 12.5, waveIntensity));
  float web = 0.62 * c1 + 0.38 * c2 + 0.18 * c3;
  float cusps = 1.95 * (c1 * c2) + 1.10 * (c2 * c3) + 2.20 * (c1 * c2 * c3);
  return web + cusps;
}

vec3 computeCausticsRGB(vec3 worldPos, float wavePhase, float waveIntensity, vec3 refractedSunDir, float uwDepth, float turbidity) {
  float cosRef = max(refractedSunDir.y, 0.15);
  // Project along refracted sun ray up to the water surface plane
  vec2 surfXZ = worldPos.xz + refractedSunDir.xz * (uwDepth / cosRef);

  // Warp surface projection with overhead non-orthogonal swell refraction displacement (60 deg apart)
  vec2 d1 = vec2(0.927, 0.375);
  vec2 d2 = vec2(0.139, 0.990);
  float warpScale = waveIntensity * clamp(uwDepth * 0.22, 0.1, 1.3);
  vec2 waveWarp = d1 * sin(dot(surfXZ, d1) * 0.42 + wavePhase * 1.15) * 0.55
                + d2 * cos(dot(surfXZ, d2) * 0.64 + wavePhase * 1.42) * 0.40;
  vec2 warpedXZ = surfXZ + waveWarp * warpScale;

  // Depth-dependent chromatic dispersion scaled by wave intensity
  float baseDisp = 0.024 * clamp(uwDepth * 0.14, 0.15, 1.0);
  float disp = baseDisp * mix(0.40, 2.25, waveIntensity);
  float cR = uwCausticLayer(warpedXZ + vec2(disp, disp * 0.4), wavePhase, waveIntensity);
  float cG = uwCausticLayer(warpedXZ, wavePhase, waveIntensity);
  float cB = uwCausticLayer(warpedXZ - vec2(disp, disp * 0.5), wavePhase, waveIntensity);

  // Caustics focus strongly in shallow water and diffuse gradually with depth & turbidity
  float depthFade = exp(-uwDepth * (0.042 + turbidity * 0.135));
  float shallowRamp = smoothstep(0.02, 0.65, uwDepth);
  float turbidFade = 1.0 - 0.68 * turbidity;
  float waveGain = mix(0.45, 2.50, pow(clamp(waveIntensity, 0.0, 1.0), 0.72));

  return vec3(cR, cG, cB) * depthFade * shallowRamp * turbidFade * 2.35 * waveGain;
}
`;

export const GLSL_RADIATIVE_HELPERS = /* glsl */ `
float uwHenyeyGreenstein(float cosTheta, float g) {
  float g2 = g * g;
  float denom = max(0.001, 1.0 + g2 - 2.0 * g * cosTheta);
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(denom, 1.5));
}

vec3 uwDownwellingTransmittance(
  float uwDepth,
  vec3 kRGB,
  vec3 refractedSunDir,
  float pathTortuosity,
  float surfaceTransmittance
) {
  float cosRef = max(refractedSunDir.y, 0.20);
  float downPath = (uwDepth * pathTortuosity) / cosRef;
  float tRed = 0.78 * exp(-kRGB.x * downPath) + 0.22 * exp(-kRGB.x * 0.45 * downPath);
  return vec3(
    tRed,
    exp(-kRGB.y * downPath),
    exp(-kRGB.z * downPath)
  ) * surfaceTransmittance;
}

vec3 uwDownwellingTransmittanceByFactor(
  float uwDepth,
  vec3 kRGB,
  float downPathFactor,
  float surfaceTransmittance
) {
  float downPath = uwDepth * downPathFactor;
  float tRed = 0.78 * exp(-kRGB.x * downPath) + 0.22 * exp(-kRGB.x * 0.45 * downPath);
  return vec3(
    tRed,
    exp(-kRGB.y * downPath),
    exp(-kRGB.z * downPath)
  ) * surfaceTransmittance;
}

float uwExpIntegralRatio(float x) {
  if (abs(x) < 1e-3) {
    return 1.0 - 0.5 * x + (x * x) * (1.0 / 6.0);
  }
  return (1.0 - exp(-x)) / x;
}

vec3 uwComputeAngularWaterScatter(
  vec3 viewDir,
  float camDepth,
  vec3 kDownRGB,
  vec3 kViewRGB,
  vec3 scatterColor,
  vec3 upScatterColor,
  vec3 deepScatterColor,
  vec3 refrSunDir,
  float turbidity
) {
  float vy = clamp(viewDir.y, -1.0, 1.0);
  vec3 kEff = max(kViewRGB, vec3(0.01));

  // 1-D Radiative Transfer slab depth-gradient factor along viewing elevation vy
  vec3 slabRatio;
  if (vy <= 0.0) {
    vec3 alphaDown = kEff - kDownRGB * vy;
    slabRatio = kEff / max(alphaDown, vec3(0.01));
  } else {
    float pathToSurface = clamp(camDepth / max(vy, 0.08), 0.1, 42.0);
    vec3 alphaUp = kEff - kDownRGB * (vy * 0.72);
    vec3 x = alphaUp * pathToSurface;
    vec3 integral = vec3(
      uwExpIntegralRatio(x.x),
      uwExpIntegralRatio(x.y),
      uwExpIntegralRatio(x.z)
    );
    vec3 envRatio = kEff / max(kEff - kDownRGB * min(vy * 0.72, 0.78), kEff * 0.28);
    float longPathMix = smoothstep(0.05, 0.45, vy);
    slabRatio = mix(envRatio, max(envRatio, kEff * pathToSurface * integral), 0.35 * longPathMix);
  }

  // Asymmetric marine volume scattering phase + shallow sunlit dome transition
  float upRamp = smoothstep(0.0, 0.62, vy);
  float zenithRamp = smoothstep(0.25, 0.90, vy);
  float downRamp = smoothstep(0.0, 0.72, -vy);

  vec3 baseCol = scatterColor * slabRatio;
  vec3 upTarget = max(upScatterColor, scatterColor * 1.55);
  vec3 dirCol = mix(baseCol, max(baseCol * 1.32, upTarget), upRamp * 0.88);
  dirCol = mix(dirCol, upTarget * 1.18, zenithRamp * 0.42);
  dirCol = mix(dirCol, deepScatterColor, downRamp * 0.78);

  // Forward-peaked Henyey-Greenstein Mie aureole around refracted sunlight
  vec3 sunDir = normalize(refrSunDir);
  float cosSun = dot(-viewDir, -sunDir);
  float hgPhase = uwHenyeyGreenstein(cosSun, 0.68);
  float mieWeight = clamp(hgPhase * (0.14 + 0.32 * turbidity) * 2.1, 0.0, 0.75);
  float solarScale = clamp(dot(upScatterColor, vec3(0.25, 0.55, 0.45)) * 1.65, 0.05, 1.55);
  vec3 T_cam = exp(-kDownRGB * clamp(camDepth, 0.5, 22.0));
  vec3 mieTurquoise = mix(upScatterColor * 0.95, vec3(0.24, 0.81, 0.90) * solarScale, 0.60) * T_cam;

  return dirCol + mieTurquoise * mieWeight;
}
`;

export const GLSL_UNDERWATER_FRAGMENT_FUNCS = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform float uCamDepth;
uniform vec3 uAttenuationRGB;
uniform vec3 uViewAttenuationRGB;
uniform vec3 uRefractedSunDir;
uniform float uTurbidity;
uniform vec3 uScatterColor;
uniform vec3 uDeepScatterColor;
uniform vec3 uUpScatterColor;
uniform float uCausticsIntensity;
uniform float uWaveIntensity;
uniform float uWavePhase;
uniform float uSurfaceTransmittance;
uniform float uPathTortuosity;
uniform float uDownPathFactor;
uniform float uUwReceiveCaustics;
uniform float uUwCausticsStrength;
uniform vec3 uUwFluorColor;
uniform float uUwHorizonFade;

varying vec3 vUwWorldPos;
varying vec3 vUwWorldNormal;

${GLSL_RADIATIVE_HELPERS}
${GLSL_CAUSTICS}

vec3 applyUnderwaterOptics(vec3 litColor, vec3 worldPos, vec3 worldNormal) {
  float uwDepth = max(0.05, uSurfaceY - worldPos.y);
  float downPath = uwDepth * uDownPathFactor;
  vec3 T_down = uwDownwellingTransmittanceByFactor(uwDepth, uAttenuationRGB, uDownPathFactor, uSurfaceTransmittance);

  vec3 color = litColor;
  float nDotS = dot(normalize(worldNormal), uRefractedSunDir);
  float sunFacing = smoothstep(-0.14, 0.55, nDotS);
  vec2 surfXZ = worldPos.xz + uRefractedSunDir.xz * downPath;
  float swellFocus = 0.62 * sin(dot(surfXZ, vec2(0.927, 0.375)) * 0.42 + uWavePhase * 1.15)
                   + 0.38 * cos(dot(surfXZ, vec2(0.139, 0.990)) * 0.64 + uWavePhase * 1.42);
  color *= max(0.78, 1.0 + swellFocus * (0.14 * uWaveIntensity) * exp(-uwDepth * 0.055) * sunFacing);

  if (uUwReceiveCaustics > 0.5) {
    vec3 caustics = computeCausticsRGB(worldPos, uWavePhase, uWaveIntensity, uRefractedSunDir, uwDepth, uTurbidity);
    float focusStrength = clamp(
      uUwCausticsStrength * uCausticsIntensity * sunFacing * exp(-uwDepth * (0.038 + uTurbidity * 0.14)) * (1.0 - 0.65 * uTurbidity) * smoothstep(0.05, 0.65, uwDepth),
      0.0,
      1.5
    );
    float waveActive = smoothstep(0.0, 0.18, uWaveIntensity);
    float troughFloor = mix(1.0, 0.26, clamp(focusStrength * 1.20 * waveActive, 0.0, 1.0));
    color *= (vec3(troughFloor) + caustics * uUwCausticsStrength * uCausticsIntensity * sunFacing);
  }

  // Downwelling Beer-Lambert attenuation
  color *= T_down;

  // Deep-water blue diffuse scatter fill & per-material coral/anemone biofluorescence
  float deepFactor = smoothstep(4.5, 24.0, uwDepth);
  float litLum = dot(litColor, vec3(0.299, 0.587, 0.114));
  float upBias = 0.28 + 0.42 * clamp(worldNormal.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 deepBlueFill = (uScatterColor * 0.44 + uUpScatterColor * 0.20)
    * (0.08 + 0.92 * deepFactor) * upBias * (0.35 + 0.65 * clamp(litLum, 0.0, 1.0));

  float blueExcite = T_down.b
    * clamp(uUpScatterColor.b * 3.2 + 0.14, 0.08, 1.25)
    * (0.30 + 0.70 * clamp(worldNormal.y * 0.5 + 0.5, 0.0, 1.0));
  float fluorDepthBoost = 0.35 + 0.45 * smoothstep(3.0, 20.0, uwDepth);
  color += deepBlueFill + uUwFluorColor * (blueExcite * fluorDepthBoost);

  // Horizontal / view-path Jerlov Beer-Lambert attenuation + depth/direction-aware water in-scattering
  vec3 viewVec = worldPos - cameraPosition;
  float viewDist = length(viewVec);
  vec3 viewDir = viewVec / max(viewDist, 0.0001);
  float farHaze = smoothstep(32.0, 56.0, viewDist) * 0.045;
  vec3 kView = uViewAttenuationRGB + vec3(farHaze);
  vec3 T_view = exp(-kView * viewDist);

  vec3 dirScatter = uwComputeAngularWaterScatter(
    viewDir,
    uCamDepth,
    uAttenuationRGB,
    kView,
    uScatterColor,
    uUpScatterColor,
    uDeepScatterColor,
    uRefractedSunDir,
    uTurbidity
  );

  vec3 outColor = color * T_view + dirScatter * (1.0 - T_view);
  if (uUwHorizonFade > 0.5) {
    float edgeFade = smoothstep(42.0, 56.0, length(worldPos.xz));
    outColor = mix(outColor, dirScatter, edgeFade);
  }
  return outColor;
}
`;

const _tmpFluorColor = new THREE.Color();

function resolveFluorColor(fluorOpt, out = new THREE.Vector3(0, 0, 0)) {
  if (!fluorOpt) return out.set(0, 0, 0);
  if (fluorOpt === true) return out.set(0.14, 0.52, 0.26);
  if (typeof fluorOpt === 'number') {
    if (!Number.isFinite(fluorOpt) || fluorOpt <= 0) return out.set(0, 0, 0);
    if (fluorOpt <= 1.0) return out.set(0.14 * fluorOpt, 0.52 * fluorOpt, 0.26 * fluorOpt);
    _tmpFluorColor.setHex(fluorOpt);
    return out.set(_tmpFluorColor.r, _tmpFluorColor.g, _tmpFluorColor.b);
  }
  if (typeof fluorOpt === 'string') {
    _tmpFluorColor.set(fluorOpt);
    return out.set(_tmpFluorColor.r, _tmpFluorColor.g, _tmpFluorColor.b);
  }
  if (Array.isArray(fluorOpt)) {
    return out.set(fluorOpt[0] ?? 0, fluorOpt[1] ?? 0, fluorOpt[2] ?? 0);
  }
  if (fluorOpt.isColor) {
    return out.set(fluorOpt.r, fluorOpt.g, fluorOpt.b);
  }
  if (fluorOpt.isVector3 || typeof fluorOpt.x === 'number') {
    return out.set(fluorOpt.x ?? 0, fluorOpt.y ?? 0, fluorOpt.z ?? 0);
  }
  if (typeof fluorOpt === 'object' && fluorOpt.color !== undefined) {
    resolveFluorColor(fluorOpt.color, out);
    const mult = Number.isFinite(fluorOpt.intensity) ? Math.max(0, fluorOpt.intensity) : 1.0;
    return out.multiplyScalar(mult);
  }
  return out.set(0, 0, 0);
}

/**
 * Patch any Three.js material (MeshStandardMaterial, MeshPhysicalMaterial, MeshLambertMaterial, etc.)
 * with Beer-Lambert downwelling & view-path attenuation, refracted caustics, biofluorescence, and scatter.
 */
export function applyUnderwaterMaterial(material, options = {}, sharedUniforms = {}) {
  if (!material) return material;
  if (Array.isArray(material)) {
    material.forEach((m) => applyUnderwaterMaterial(m, options, sharedUniforms));
    return material;
  }

  const receiveCaustics = options.receiveCaustics !== undefined ? Boolean(options.receiveCaustics) : true;
  const causticsStrength = Number.isFinite(options.causticsStrength) ? options.causticsStrength : 1.0;
  const horizonFade = Boolean(options.horizonFade);

  material.userData = material.userData || {};
  if (!material.userData.__uwUniforms) {
    material.userData.__uwUniforms = {
      uUwReceiveCaustics: { value: receiveCaustics ? 1.0 : 0.0 },
      uUwCausticsStrength: { value: causticsStrength },
      uUwFluorColor: { value: new THREE.Vector3(0, 0, 0) },
      uUwHorizonFade: { value: horizonFade ? 1.0 : 0.0 },
    };
  }
  const perMatUniforms = material.userData.__uwUniforms;
  perMatUniforms.uUwReceiveCaustics.value = receiveCaustics ? 1.0 : 0.0;
  perMatUniforms.uUwCausticsStrength.value = causticsStrength;
  resolveFluorColor(options.fluorescence, perMatUniforms.uUwFluorColor.value);
  perMatUniforms.uUwHorizonFade.value = horizonFade ? 1.0 : 0.0;

  material.userData.__uwReceiveCaustics = perMatUniforms.uUwReceiveCaustics.value;
  material.userData.__uwCausticsStrength = causticsStrength;

  if (material.userData.__uwApplied) {
    return material;
  }

  material.userData.__uwApplied = true;

  const hasCustomOnBeforeCompile = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile')
    && typeof material.onBeforeCompile === 'function';
  const prevOnBeforeCompile = hasCustomOnBeforeCompile
    ? material.onBeforeCompile.bind(material)
    : null;
  const hasOwnCacheKey = Object.prototype.hasOwnProperty.call(material, 'customProgramCacheKey')
    && typeof material.customProgramCacheKey === 'function';
  const prevCacheKey = hasOwnCacheKey ? material.customProgramCacheKey.bind(material) : null;

  const customTag = !hasOwnCacheKey && hasCustomOnBeforeCompile
    ? `_c${material.onBeforeCompile.toString().length}`
    : '';
  const uwKey = `uw8_${receiveCaustics ? 1 : 0}_${causticsStrength.toFixed(3)}_${horizonFade ? 1 : 0}${customTag}`;
  material.customProgramCacheKey = () => (prevCacheKey ? `${prevCacheKey()}|${uwKey}` : uwKey);

  material.onBeforeCompile = (shader, renderer) => {
    if (prevOnBeforeCompile) {
      prevOnBeforeCompile(shader, renderer);
    }

    // Bind shared water-optics uniforms by reference so frame updates propagate automatically
    shader.uniforms.uTime = sharedUniforms.uTime || { value: 0.0 };
    shader.uniforms.uSurfaceY = sharedUniforms.uSurfaceY || { value: 8.8 };
    shader.uniforms.uCamDepth = sharedUniforms.uCamDepth || { value: 6.0 };
    shader.uniforms.uAttenuationRGB = sharedUniforms.uAttenuationRGB || { value: new THREE.Vector3(0.287, 0.080, 0.051) };
    shader.uniforms.uViewAttenuationRGB = sharedUniforms.uViewAttenuationRGB || { value: new THREE.Vector3(0.304, 0.092, 0.066) };
    shader.uniforms.uRefractedSunDir = sharedUniforms.uRefractedSunDir || { value: new THREE.Vector3(0.0, 0.94, 0.34).normalize() };
    shader.uniforms.uTurbidity = sharedUniforms.uTurbidity || { value: 0.18 };
    shader.uniforms.uScatterColor = sharedUniforms.uScatterColor || { value: new THREE.Color(0.004, 0.055, 0.12) };
    shader.uniforms.uDeepScatterColor = sharedUniforms.uDeepScatterColor || { value: new THREE.Color(0.001, 0.020, 0.065) };
    shader.uniforms.uUpScatterColor = sharedUniforms.uUpScatterColor || { value: new THREE.Color(0.008, 0.080, 0.16) };
    shader.uniforms.uCausticsIntensity = sharedUniforms.uCausticsIntensity || { value: 1.0 };
    shader.uniforms.uWaveIntensity = sharedUniforms.uWaveIntensity || { value: 0.28 };
    shader.uniforms.uWavePhase = sharedUniforms.uWavePhase || { value: 0.0 };
    shader.uniforms.uSurfaceTransmittance = sharedUniforms.uSurfaceTransmittance || { value: 0.96 };
    shader.uniforms.uPathTortuosity = sharedUniforms.uPathTortuosity || { value: 1.025 };
    shader.uniforms.uDownPathFactor = sharedUniforms.uDownPathFactor || { value: 1.15 };
    shader.uniforms.uUwReceiveCaustics = perMatUniforms.uUwReceiveCaustics;
    shader.uniforms.uUwCausticsStrength = perMatUniforms.uUwCausticsStrength;
    shader.uniforms.uUwFluorColor = perMatUniforms.uUwFluorColor;
    shader.uniforms.uUwHorizonFade = perMatUniforms.uUwHorizonFade;

    // Explicitly declare vUwWorldPos and vUwWorldNormal (never rely on Three.js conditional worldPosition)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
varying vec3 vUwWorldPos;
varying vec3 vUwWorldNormal;
`
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
#include <project_vertex>
vec4 uwWorldPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  uwWorldPosition = batchingMatrix * uwWorldPosition;
#endif
#ifdef USE_INSTANCING
  uwWorldPosition = instanceMatrix * uwWorldPosition;
#endif
uwWorldPosition = modelMatrix * uwWorldPosition;
vUwWorldPos = uwWorldPosition.xyz;

#if defined( USE_ENVMAP ) || defined( USE_SKINNING ) || !defined( IS_BASIC_MATERIAL )
  vec3 uwWorldN = objectNormal;
#else
  vec3 uwWorldN = vec3( 0.0, 1.0, 0.0 );
#endif
#ifdef USE_BATCHING
  mat3 uwBm = mat3( batchingMatrix );
  uwWorldN /= max( vec3( dot( uwBm[0], uwBm[0] ), dot( uwBm[1], uwBm[1] ), dot( uwBm[2], uwBm[2] ) ), vec3( 1e-6 ) );
  uwWorldN = uwBm * uwWorldN;
#endif
#ifdef USE_INSTANCING
  mat3 uwIm = mat3( instanceMatrix );
  uwWorldN /= max( vec3( dot( uwIm[0], uwIm[0] ), dot( uwIm[1], uwIm[1] ), dot( uwIm[2], uwIm[2] ) ), vec3( 1e-6 ) );
  uwWorldN = uwIm * uwWorldN;
#endif
mat3 uwMm = mat3( modelMatrix );
uwWorldN /= max( vec3( dot( uwMm[0], uwMm[0] ), dot( uwMm[1], uwMm[1] ), dot( uwMm[2], uwMm[2] ) ), vec3( 1e-6 ) );
vUwWorldNormal = normalize( uwMm * uwWorldN );
`
      );

    if (material.isMeshBasicMaterial) {
      shader.vertexShader = `#define IS_BASIC_MATERIAL\n` + shader.vertexShader;
    }

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
${GLSL_UNDERWATER_FRAGMENT_FUNCS}
`
      )
      .replace(
        '#include <tonemapping_fragment>',
        /* glsl */ `
gl_FragColor.rgb = applyUnderwaterOptics(gl_FragColor.rgb, vUwWorldPos, vUwWorldNormal);
#include <tonemapping_fragment>
`
      );
  };

  material.needsUpdate = true;
  return material;
}
