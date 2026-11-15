import * as THREE from 'three';
import { GLSL_RADIATIVE_HELPERS } from './underwaterCommon.glsl.js';

const SUN_SHAFT_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform vec3 uRefractedSunDir;
uniform float uWaveIntensity;
uniform float uWavePhase;

attribute vec4 aShaftParams; // x: cellX in [-22,22], y: cellZ in [-22,22], z: radiusScale, w: phase

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vHeightT;
varying float vPhase;
varying float vWrapFade;
varying vec2 vSurfOriginXZ;

void main() {
  // position.y is in [-1.0, 0.0], where 0 is at the water surface
  float t = clamp(-position.y, 0.0, 1.0);
  vHeightT = t;
  vPhase = aShaftParams.w;

  vec3 sunDir = normalize(uRefractedSunDir);
  float cosRef = max(sunDir.y, 0.20);
  float shaftLen = max(8.0, uSurfaceY + 8.5);
  float depthFromSurface = t * shaftLen;

  // Toroidal camera-wrapped surface lattice (44m x 44m) centered on the refracted ray above camera
  float wrapSize = 44.0;
  float camDepth = max(0.05, uSurfaceY - cameraPosition.y);
  vec2 camSurfCenter = cameraPosition.xz + sunDir.xz * (camDepth / cosRef);
  vec2 wrappedXZ = camSurfCenter + mod(aShaftParams.xy - camSurfCenter + 0.5 * wrapSize, wrapSize) - 0.5 * wrapSize;
  vWrapFade = 1.0 - smoothstep(14.5, 21.5, length(wrappedXZ - camSurfCenter));

  // Tapered cone expansion orthogonal to refracted sun vector
  float spread = (1.0 + t * 2.15) * aShaftParams.z;
  vec3 upHint = abs(sunDir.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 basisX = normalize(cross(upHint, sunDir));
  vec3 basisZ = cross(sunDir, basisX);
  vec3 radialDir = position.x * basisX + position.z * basisZ;
  vec3 localOffset = radialDir * spread;

  // Horizontal ray sway synchronized to constant 1.765 rad/s uWavePhase dispersion
  float swayAmp = mix(0.05, 0.62, clamp(uWaveIntensity, 0.0, 1.0));
  float sway = sin(uWavePhase * 1.15 + dot(wrappedXZ, vec2(0.86, 0.51)) * 0.42) * swayAmp * (1.0 - t * 0.45);
  vec3 surfaceOrigin = vec3(wrappedXZ.x + sway * 0.86, uSurfaceY, wrappedXZ.y + sway * 0.51);
  vec3 rayShift = -(sunDir / cosRef) * depthFromSurface;

  vec3 worldPos = surfaceOrigin + rayShift + localOffset;
  vWorldPos = worldPos;
  vWorldNormal = normalize(radialDir);
  vSurfOriginXZ = surfaceOrigin.xz;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const SUN_SHAFT_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform vec3 uAttenuationRGB;
uniform vec3 uViewAttenuationRGB;
uniform vec3 uSunAboveColor;
uniform vec3 uRefractedSunDir;
uniform float uTurbidity;
uniform float uCausticsIntensity;
uniform float uWaveIntensity;
uniform float uWavePhase;
uniform float uSurfaceTransmittance;
uniform float uPathTortuosity;
uniform float uDownPathFactor;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vHeightT;
varying float vPhase;
varying float vWrapFade;
varying vec2 vSurfOriginXZ;

${GLSL_RADIATIVE_HELPERS}

void main() {
  if (vWrapFade < 0.005) discard;

  vec3 viewVec = vWorldPos - cameraPosition;
  float viewDist = length(viewVec);
  vec3 viewDir = viewVec / max(viewDist, 0.0001);
  vec3 sunDir = normalize(uRefractedSunDir);

  // Soft cylinder rim falloff (gentle axial fade only right on the bore axis so sunward look stays bright)
  float rim = abs(dot(viewDir, normalize(vWorldNormal)));
  float axialFade = 1.0 - 0.22 * pow(abs(dot(viewDir, sunDir)), 6.0);
  float radialFade = pow(clamp(rim, 0.0, 1.0), 1.85) * axialFade;

  float uwDepth = max(0.05, uSurfaceY - vWorldPos.y);
  float topFade = smoothstep(0.0, 1.0, uwDepth);
  float bottomFade = 1.0 - smoothstep(0.55, 1.0, vHeightT);
  float nearFade = smoothstep(1.2, 4.5, viewDist);
  float farFade = 1.0 - smoothstep(26.0, 46.0, viewDist);

  // Wave-focused shimmer synchronized with overhead swell ripples & caustics
  float wInt = clamp(uWaveIntensity, 0.0, 1.0);
  float w1 = 0.5 + 0.5 * sin(dot(vSurfOriginXZ, vec2(0.86, 0.51)) * 0.42 + uWavePhase * 1.15);
  float w2 = 0.5 + 0.5 * cos(dot(vSurfOriginXZ, vec2(-0.62, 0.78)) * 0.64 + uWavePhase * 1.42 + vPhase * 3.14159);
  float shimmerMod = mix(0.20, 0.78, wInt);
  float shimmer = (1.0 - shimmerMod * 0.50) + shimmerMod * (w1 * w2);

  // Beer-Lambert attenuation along downwelling (uDownPathFactor) & view paths (uViewAttenuationRGB)
  vec3 T_down = uwDownwellingTransmittanceByFactor(uwDepth, uAttenuationRGB, uDownPathFactor, uSurfaceTransmittance);
  vec3 T_view = exp(-uViewAttenuationRGB * viewDist);

  // Henyey-Greenstein forward-scatter glow: brightest when looking toward the refracted sun
  float cosSun = dot(-viewDir, -sunDir);
  float hgPhase = uwHenyeyGreenstein(cosSun, 0.68);
  float forwardGain = 0.22 + 1.45 * clamp(hgPhase, 0.0, 1.35);

  // Tyndall scattering visibility in clear-to-moderate turbidity
  float scatterVis = (0.20 + 0.72 * uTurbidity) * (1.0 - 0.32 * uTurbidity);
  float intensity = radialFade * topFade * bottomFade * nearFade * farFade * vWrapFade * shimmer * scatterVis;

  vec3 shaftColor = uSunAboveColor * T_down * T_view * intensity * forwardGain * (0.050 + 0.036 * uCausticsIntensity) * (1.0 + 0.42 * wInt);

  gl_FragColor = vec4(shaftColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MARINE_SNOW_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform float uPixelRatio;
uniform vec3 uCurrentOffset;
uniform vec3 uCurrentVel;
uniform float uWaveIntensity;
uniform float uWavePhase;

attribute vec3 aSeed;

varying vec3 vWorldPos;
varying vec3 vSeedVec;
varying float vAlpha;
varying float vViewDist;

void main() {
  vec3 boxSize = vec3(36.0, 20.0, 36.0);

  // 1.0x coherent current advection + realistic -0.0012 m/s gravitational settling
  vec3 currentFlow = vec3(
    uCurrentOffset.x * (0.95 + 0.10 * aSeed.y),
    uCurrentOffset.y * (0.90 + 0.20 * aSeed.z),
    uCurrentOffset.z * (0.95 + 0.10 * aSeed.y)
  );
  vec3 baseRel = mod((position + currentFlow) - cameraPosition + 0.5 * boxSize, boxSize) - 0.5 * boxSize;
  vec3 baseWorld = cameraPosition + baseRel;

  // Spatially coherent linear wave orbital motion synchronized to surface swell components & unified depth datum
  float uwDepth = max(0.05, uSurfaceY - baseWorld.y);
  float wInt = clamp(uWaveIntensity, 0.0, 1.0);
  float amp1 = wInt * 0.34 * exp(-uwDepth * 0.42);
  float amp2 = wInt * 0.20 * exp(-uwDepth * 0.64);
  vec2 d1 = vec2(0.86, 0.51);
  vec2 d2 = vec2(-0.62, 0.78);
  float p1 = dot(baseWorld.xz, d1) * 0.42 + uWavePhase * 1.15;
  float p2 = dot(baseWorld.xz, d2) * 0.64 + uWavePhase * 1.42;

  vec3 surgeOsc = vec3(
    d1.x * cos(p1) * amp1 - d2.x * sin(p2) * amp2,
    sin(p1) * amp1 * 0.55 + cos(p2) * amp2 * 0.55,
    d1.y * cos(p1) * amp1 - d2.y * sin(p2) * amp2
  );

  // Toroidally wrap around cameraPosition so marine snow follows the diver seamlessly
  vec3 rel = mod((position + currentFlow + surgeOsc) - cameraPosition + 0.5 * boxSize, boxSize) - 0.5 * boxSize;
  vec3 worldPos = cameraPosition + rel;
  vWorldPos = worldPos;
  vSeedVec = aSeed;

  vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
  float viewDist = max(0.1, -mvPosition.z);
  vViewDist = viewDist;

  // Hide particles above the water surface or deep below the drop-off seabed
  float belowSurface = smoothstep(uSurfaceY - 0.1, uSurfaceY - 0.9, worldPos.y);
  float aboveFloor = smoothstep(-8.2, -6.5, worldPos.y);
  float nearFade = smoothstep(0.45, 1.15, viewDist);
  float edgeFade = 1.0 - smoothstep(11.0, 17.5, length(rel.xz));

  vAlpha = belowSurface * aboveFloor * nearFade * edgeFade * (0.35 + 0.65 * aSeed.y);

  // Subtle near-lens circle-of-confusion expansion for soft depth-of-field bokeh
  float nearBokeh = 1.0 + 0.90 * smoothstep(2.6, 0.85, viewDist);
  float baseSize = (11.5 + 16.5 * aSeed.z) * uPixelRatio * nearBokeh;
  gl_PointSize = clamp(baseSize / viewDist, 1.5, 15.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const MARINE_SNOW_FRAGMENT = /* glsl */ `
uniform vec3 uAttenuationRGB;
uniform vec3 uViewAttenuationRGB;
uniform vec3 uSunAboveColor;
uniform vec3 uRefractedSunDir;
uniform vec3 uScatterColor;
uniform float uSurfaceY;
uniform float uTurbidity;
uniform float uWavePhase;
uniform float uSurfaceTransmittance;
uniform float uDownPathFactor;

varying vec3 vWorldPos;
varying vec3 vSeedVec;
varying float vAlpha;
varying float vViewDist;

${GLSL_RADIATIVE_HELPERS}

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;

  // Focused organic floccule disc blending smoothly into soft near-lens depth-of-field bokeh
  float bokehMix = smoothstep(2.4, 0.85, vViewDist);
  float sharpDisc = smoothstep(0.5, 0.06, d);
  sharpDisc *= sharpDisc;
  float bokehDisc = smoothstep(0.5, 0.34, d) * (0.62 + 0.38 * smoothstep(0.16, 0.38, d));
  float soft = mix(sharpDisc, bokehDisc, bokehMix);

  float uwDepth = max(0.05, uSurfaceY - vWorldPos.y);
  vec3 T_down = uwDownwellingTransmittanceByFactor(uwDepth, uAttenuationRGB, uDownPathFactor, uSurfaceTransmittance);

  vec3 viewVec = vWorldPos - cameraPosition;
  float viewDist = length(viewVec);
  vec3 viewDir = viewVec / max(viewDist, 0.0001);
  vec3 T_view = exp(-uViewAttenuationRGB * viewDist);

  float cosSun = dot(-viewDir, -normalize(uRefractedSunDir));
  float hgPhase = uwHenyeyGreenstein(cosSun, 0.68);
  float forwardGain = 0.70 + 1.25 * clamp(hgPhase, 0.0, 1.35);

  // Subtle backlit plankton/aragonite sparkle when looking toward sunbeams
  float glintOsc = 0.5 + 0.5 * sin(uWavePhase * 2.2 + vSeedVec.x * 37.0 + vSeedVec.y * 19.0);
  float backlitSparkle = pow(max(0.0, cosSun), 6.0) * pow(glintOsc, 3.0) * (0.45 + 0.55 * vSeedVec.z);

  // Sunlit forward-scattered particles + backlit sparkle + ambient water scatter
  vec3 litParticle = uSunAboveColor * (0.28 * forwardGain + 0.85 * backlitSparkle) * T_down
    + vec3(0.42, 0.60, 0.72) * 0.34 * T_down;
  vec3 particleColor = litParticle * T_view + uScatterColor * (1.0 - T_view);

  float turbidScale = mix(0.20, 0.78, uTurbidity);
  float bokehAlphaFade = mix(1.0, 0.42, bokehMix);
  float alpha = soft * vAlpha * turbidScale * bokehAlphaFade * (0.45 + 0.55 * T_view.b);

  if (alpha < 0.004) discard;
  gl_FragColor = vec4(particleColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Create 38 camera-wrapped translucent volumetric sun-ray shafts descending along uRefractedSunDir.
 */
export function createSunShaftsMesh(sharedUniforms) {
  const shaftCount = 38;
  const baseGeom = new THREE.CylinderGeometry(0.40, 1.15, 1.0, 14, 1, true);
  // Shift cylinder so y spans [-1.0, 0.0] (top at water surface y=0)
  baseGeom.translate(0, -0.5, 0);

  const instGeom = new THREE.InstancedBufferGeometry();
  instGeom.index = baseGeom.index;
  instGeom.attributes.position = baseGeom.attributes.position;
  instGeom.attributes.normal = baseGeom.attributes.normal;
  instGeom.attributes.uv = baseGeom.attributes.uv;
  instGeom.instanceCount = shaftCount;

  const params = new Float32Array(shaftCount * 4);
  // Stratified low-discrepancy Halton-like distribution over [-22m, +22m] tile for seamless camera wrapping
  for (let i = 0; i < shaftCount; i++) {
    const u = ((i + 0.5) / shaftCount);
    const v = ((i * 0.6180339887) % 1.0);
    params[i * 4 + 0] = (u - 0.5) * 44.0;
    params[i * 4 + 1] = (v - 0.5) * 44.0;
    params[i * 4 + 2] = 0.72 + ((i * 37) % 11) * 0.085;
    params[i * 4 + 3] = (i * 0.3819660113) % 1.0;
  }

  instGeom.setAttribute('aShaftParams', new THREE.InstancedBufferAttribute(params, 4));
  baseGeom.dispose();

  const shaftUniforms = {
    ...(sharedUniforms || {}),
    uViewAttenuationRGB: sharedUniforms?.uViewAttenuationRGB || { value: new THREE.Vector3(0.304, 0.092, 0.066) },
    uDownPathFactor: sharedUniforms?.uDownPathFactor || { value: 1.15 },
    uSurfaceTransmittance: sharedUniforms?.uSurfaceTransmittance || { value: 0.96 },
    uPathTortuosity: sharedUniforms?.uPathTortuosity || { value: 1.025 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: shaftUniforms,
    vertexShader: SUN_SHAFT_VERTEX,
    fragmentShader: SUN_SHAFT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(instGeom, material);
  mesh.name = 'VolumetricSunShafts';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * Create ~2600 soft suspended marine snow particles wrapping smoothly around the camera.
 */
export function createMarineSnowPoints(uniforms, count = 2600) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);

  // Deterministic pseudo-random distribution so layout is clean and repeatable
  let s = 1337;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };

  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (rand() - 0.5) * 36.0;
    positions[i * 3 + 1] = (rand() - 0.5) * 20.0;
    positions[i * 3 + 2] = (rand() - 0.5) * 36.0;

    seeds[i * 3 + 0] = rand();
    seeds[i * 3 + 1] = rand();
    seeds[i * 3 + 2] = rand();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));

  const snowUniforms = {
    ...(uniforms || {}),
    uViewAttenuationRGB: uniforms?.uViewAttenuationRGB || { value: new THREE.Vector3(0.304, 0.092, 0.066) },
    uDownPathFactor: uniforms?.uDownPathFactor || { value: 1.15 },
    uSurfaceTransmittance: uniforms?.uSurfaceTransmittance || { value: 0.96 },
    uPathTortuosity: uniforms?.uPathTortuosity || { value: 1.025 },
    uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms: snowUniforms,
    vertexShader: MARINE_SNOW_VERTEX,
    fragmentShader: MARINE_SNOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'MarineSnow';
  points.frustumCulled = false;
  points.renderOrder = 3;
  return points;
}
