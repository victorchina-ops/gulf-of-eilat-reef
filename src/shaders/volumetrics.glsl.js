import * as THREE from 'three';
import { GLSL_RADIATIVE_HELPERS } from './underwaterCommon.glsl.js';

const SUN_SHAFT_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform vec3 uRefractedSunDir;
uniform float uWaveIntensity;
uniform float uWavePhase;

attribute vec4 aShaftParams; // x: baseX, y: baseZ, z: radiusScale, w: phase

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vHeightT;
varying float vPhase;
varying float vSurfSeed;

void main() {
  // position.y is in [-1.0, 0.0], where 0 is at the water surface
  float t = clamp(-position.y, 0.0, 1.0);
  vHeightT = t;
  vPhase = aShaftParams.w;

  float shaftLen = max(8.0, uSurfaceY + 7.5);
  float depthFromSurface = t * shaftLen;
  float cosRef = max(uRefractedSunDir.y, 0.2);

  // Tapered cone expansion descending along refracted sun vector
  float spread = (1.0 + t * 2.2) * aShaftParams.z;
  vec3 localOffset = vec3(position.x * spread, 0.0, position.z * spread);

  // Horizontal ray sway scaled by wave intensity using unwrapped uWavePhase
  float swayAmp = mix(0.10, 0.68, clamp(uWaveIntensity, 0.0, 1.0));
  float sway = sin(uWavePhase * 0.72 + aShaftParams.w * 6.2831) * swayAmp * (1.0 - t * 0.5);
  vec3 surfaceOrigin = vec3(aShaftParams.x + sway * 0.86, uSurfaceY, aShaftParams.y + sway * 0.51);
  vec3 rayShift = -(uRefractedSunDir / cosRef) * depthFromSurface;

  vec3 worldPos = surfaceOrigin + rayShift + localOffset;
  vWorldPos = worldPos;
  vWorldNormal = normalize(vec3(position.x, 0.0, position.z));
  vSurfSeed = aShaftParams.x * 0.37 + aShaftParams.y * 0.53;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const SUN_SHAFT_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform vec3 uAttenuationRGB;
uniform vec3 uSunAboveColor;
uniform vec3 uRefractedSunDir;
uniform float uTurbidity;
uniform float uCausticsIntensity;
uniform float uWaveIntensity;
uniform float uWavePhase;
uniform float uSurfaceTransmittance;
uniform float uPathTortuosity;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vHeightT;
varying float vPhase;
varying float vSurfSeed;

${GLSL_RADIATIVE_HELPERS}

void main() {
  vec3 viewVec = vWorldPos - cameraPosition;
  float viewDist = length(viewVec);
  vec3 viewDir = viewVec / max(viewDist, 0.0001);

  // Soft cylinder edge falloff & axial bore fade so shafts stay volumetric from every angle
  float rim = abs(dot(viewDir, normalize(vWorldNormal)));
  float axialFade = 1.0 - 0.65 * pow(abs(dot(viewDir, normalize(uRefractedSunDir))), 3.0);
  float radialFade = pow(clamp(rim, 0.0, 1.0), 2.1) * axialFade;

  float uwDepth = max(0.0, uSurfaceY - vWorldPos.y);
  float topFade = smoothstep(0.0, 1.1, uwDepth);
  float bottomFade = 1.0 - smoothstep(0.55, 1.0, vHeightT);
  float nearFade = smoothstep(1.2, 4.8, viewDist);
  float farFade = 1.0 - smoothstep(26.0, 48.0, viewDist);

  // Animated wave-focused shimmer synchronized with surface ripples
  float wInt = clamp(uWaveIntensity, 0.0, 1.0);
  float w1 = 0.5 + 0.5 * sin(vSurfSeed * 2.7 + uWavePhase * 1.35 + vPhase * 6.2831);
  float w2 = 0.5 + 0.5 * cos(vSurfSeed * 4.1 - uWavePhase * 1.05 + vHeightT * 2.5);
  float shimmerMod = mix(0.22, 0.78, wInt);
  float shimmer = (1.0 - shimmerMod * 0.55) + shimmerMod * (w1 * w2);

  // Beer-Lambert attenuation along downwelling (bi-exponential Red + tortuosity) & view paths
  vec3 T_down = uwDownwellingTransmittance(uwDepth, uAttenuationRGB, uRefractedSunDir, uPathTortuosity, uSurfaceTransmittance);
  vec3 T_view = exp(-uAttenuationRGB * viewDist * uPathTortuosity);

  // Henyey-Greenstein forward-scatter glow toward -uRefractedSunDir
  float cosSun = dot(-viewDir, -normalize(uRefractedSunDir));
  float hgPhase = uwHenyeyGreenstein(cosSun, 0.68);
  float forwardGain = 0.85 + 1.15 * clamp(hgPhase, 0.0, 1.35);

  // Visibility peaks in clear-to-moderate turbidity (Tyndall scattering) and softens in murky water
  float scatterVis = (0.18 + 0.72 * uTurbidity) * (1.0 - 0.35 * uTurbidity);
  float intensity = radialFade * topFade * bottomFade * nearFade * farFade * shimmer * scatterVis;

  vec3 shaftColor = uSunAboveColor * T_down * T_view * intensity * forwardGain * (0.048 + 0.032 * uCausticsIntensity) * (1.0 + 0.45 * wInt);

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
varying float vAlpha;
varying float vSeed;

void main() {
  vec3 boxSize = vec3(36.0, 20.0, 36.0);

  // Along-reef current advection + wave-intensity-coupled orbital wave surge
  vec3 currentFlow = vec3(
    uCurrentOffset.x * (0.82 + 0.36 * aSeed.y),
    uCurrentOffset.y * (0.75 + 0.50 * aSeed.z),
    uCurrentOffset.z * (0.82 + 0.36 * aSeed.y)
  );
  float surgeAmp = mix(0.08, 0.65, clamp(uWaveIntensity, 0.0, 1.0));
  float orbitPhase = uWavePhase * 0.85 + aSeed.x * 6.2831;
  vec3 surgeOsc = vec3(
    sin(orbitPhase) * surgeAmp,
    cos(orbitPhase + aSeed.z * 1.5708) * surgeAmp * 0.32,
    cos(uWavePhase * 0.85 + aSeed.z * 6.2831) * surgeAmp * 0.85
  );
  vec3 baseRel = mod((position + currentFlow) - cameraPosition + 0.5 * boxSize, boxSize) - 0.5 * boxSize;
  vec3 worldPos = cameraPosition + baseRel;
  float waveDepthDecay = exp(-max(0.0, (uSurfaceY - 1.4) - worldPos.y) * 0.20);
  vec3 drift = currentFlow + surgeOsc * waveDepthDecay;

  // Toroidally wrap around cameraPosition so marine snow follows the diver seamlessly
  vec3 rel = mod((position + drift) - cameraPosition + 0.5 * boxSize, boxSize) - 0.5 * boxSize;
  worldPos = cameraPosition + rel;
  vWorldPos = worldPos;
  vSeed = aSeed.x;

  vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
  float viewDist = max(0.1, -mvPosition.z);

  // Hide particles above the water surface or deep below the drop-off seabed
  float belowSurface = smoothstep(uSurfaceY - 0.1, uSurfaceY - 0.9, worldPos.y);
  float aboveFloor = smoothstep(-8.2, -6.5, worldPos.y);
  float nearFade = smoothstep(0.65, 2.2, viewDist);
  float edgeFade = 1.0 - smoothstep(11.0, 17.5, length(rel.xz));

  vAlpha = belowSurface * aboveFloor * nearFade * edgeFade * (0.35 + 0.65 * aSeed.y);

  float baseSize = (13.0 + 18.0 * aSeed.z) * uPixelRatio;
  gl_PointSize = clamp(baseSize / viewDist, 1.5, 8.5);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const MARINE_SNOW_FRAGMENT = /* glsl */ `
uniform vec3 uAttenuationRGB;
uniform vec3 uSunAboveColor;
uniform vec3 uRefractedSunDir;
uniform vec3 uScatterColor;
uniform float uSurfaceY;
uniform float uTurbidity;
uniform float uSurfaceTransmittance;
uniform float uPathTortuosity;

varying vec3 vWorldPos;
varying float vAlpha;
varying float vSeed;

${GLSL_RADIATIVE_HELPERS}

void main() {
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv);
  if (d > 0.5) discard;

  // Soft blurry organic floccule disc
  float soft = smoothstep(0.5, 0.06, d);
  soft *= soft;

  float uwDepth = max(0.0, uSurfaceY - vWorldPos.y);
  vec3 T_down = uwDownwellingTransmittance(uwDepth, uAttenuationRGB, uRefractedSunDir, uPathTortuosity, uSurfaceTransmittance);

  vec3 viewVec = vWorldPos - cameraPosition;
  float viewDist = length(viewVec);
  vec3 viewDir = viewVec / max(viewDist, 0.0001);
  vec3 T_view = exp(-uAttenuationRGB * viewDist * uPathTortuosity);

  float cosSun = dot(-viewDir, -normalize(uRefractedSunDir));
  float hgPhase = uwHenyeyGreenstein(cosSun, 0.68);
  float forwardGain = 0.70 + 1.20 * clamp(hgPhase, 0.0, 1.35);

  // Sunlit forward-scattered particles + ambient water scatter
  vec3 particleColor = (uSunAboveColor * 0.28 * forwardGain * T_down + vec3(0.45, 0.62, 0.72) * 0.35 * T_down) * T_view
    + uScatterColor * (1.0 - T_view);

  float turbidScale = mix(0.20, 0.78, uTurbidity);
  float alpha = soft * vAlpha * turbidScale * (0.45 + 0.55 * T_view.b);

  if (alpha < 0.004) discard;
  gl_FragColor = vec4(particleColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Create subtle translucent volumetric sun-ray shafts descending along uRefractedSunDir.
 */
export function createSunShaftsMesh(sharedUniforms) {
  const shaftCount = 22;
  const baseGeom = new THREE.CylinderGeometry(0.42, 1.15, 1.0, 14, 1, true);
  // Shift cylinder so y spans [-1.0, 0.0] (top at water surface y=0)
  baseGeom.translate(0, -0.5, 0);

  const instGeom = new THREE.InstancedBufferGeometry();
  instGeom.index = baseGeom.index;
  instGeom.attributes.position = baseGeom.attributes.position;
  instGeom.attributes.normal = baseGeom.attributes.normal;
  instGeom.attributes.uv = baseGeom.attributes.uv;
  instGeom.instanceCount = shaftCount;

  const params = new Float32Array(shaftCount * 4);
  // Deterministic golden-angle reef distribution over [-22m, +22m]
  for (let i = 0; i < shaftCount; i++) {
    const angle = i * 2.39996323;
    const radius = 2.5 + Math.sqrt((i + 0.5) / shaftCount) * 20.5;
    params[i * 4 + 0] = Math.cos(angle) * radius;
    params[i * 4 + 1] = Math.sin(angle) * radius;
    params[i * 4 + 2] = 0.75 + ((i * 37) % 11) * 0.09;
    params[i * 4 + 3] = (i * 0.6180339) % 1.0;
  }

  instGeom.setAttribute('aShaftParams', new THREE.InstancedBufferAttribute(params, 4));
  baseGeom.dispose();

  const shaftUniforms = {
    ...(sharedUniforms || {}),
    uSurfaceTransmittance: sharedUniforms?.uSurfaceTransmittance || { value: 0.97 },
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
    uSurfaceTransmittance: uniforms?.uSurfaceTransmittance || { value: 0.97 },
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
