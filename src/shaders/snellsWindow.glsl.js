import * as THREE from 'three';
import { WORLD_CONSTANTS } from '../contracts.js';

const SNELLS_WINDOW_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uWaveIntensity;
uniform float uWavePhase;

varying vec3 vWorldPos;
varying float vWaveCrest;
varying vec2 vWaveSlope;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  // 4-component directional ocean gravity swell + steep chop tapering toward the 300m horizon
  // Max trough amplitude <= 0.44m so minimum uSurfaceY (3.8m) - 0.44m = 3.36m stays clear of MAX_STATIC_Y (2.55m)
  float distXZ = length(position.xz);
  float swellFade = 1.0 - smoothstep(45.0, 180.0, distXZ);
  float wInt = clamp(uWaveIntensity, 0.0, 1.0);
  float ampScale = mix(0.015, 0.44, wInt) * swellFade;

  vec2 xz = worldPosition.xz;
  vec2 d1 = vec2(0.86, 0.51);
  vec2 d2 = vec2(-0.62, 0.78);
  vec2 d3 = vec2(0.35, -0.94);
  vec2 d4 = vec2(-0.92, -0.39);

  float k1 = 0.42;
  float k2 = 0.64;
  float k3 = 1.25;
  float k4 = 1.85;

  float p1 = dot(xz, d1) * k1 + uWavePhase * 1.15;
  float p2 = dot(xz, d2) * k2 + uWavePhase * 1.42;
  float p3 = dot(xz, d3) * k3 - uWavePhase * 2.05;
  float p4 = dot(xz, d4) * k4 + uWavePhase * 2.55;

  float a1 = 0.44 * ampScale;
  float a2 = 0.28 * ampScale;
  float a3 = 0.17 * wInt * ampScale;
  float a4 = 0.11 * wInt * ampScale;

  float h = a1 * sin(p1) + a2 * cos(p2) + a3 * sin(p3) + a4 * cos(p4);
  worldPosition.y += h;

  vWaveSlope =
    d1 * (a1 * k1 * cos(p1)) -
    d2 * (a2 * k2 * sin(p2)) +
    d3 * (a3 * k3 * cos(p3)) -
    d4 * (a4 * k4 * sin(p4));
  vWaveCrest = clamp(h / max(ampScale, 0.0001), 0.0, 1.0);
  vWorldPos = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const SNELLS_WINDOW_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform vec3 uAttenuationRGB;
uniform vec3 uSunAboveColor;
uniform vec3 uSunAboveDir;
uniform vec3 uSkyZenithColor;
uniform vec3 uSkyHorizonColor;
uniform vec3 uScatterColor;
uniform vec3 uDeepScatterColor;
uniform vec3 uUpScatterColor;
uniform float uTurbidity;
uniform float uWaveIntensity;
uniform float uWavePhase;

varying vec3 vWorldPos;
varying float vWaveCrest;
varying vec2 vWaveSlope;

// Multi-octave directional capillary-gravity wave gradient (world XZ -> surface slope dh/dx, dh/dz)
vec2 computeSurfaceRippleGradient(vec2 xz, float wavePhase, float viewDist, float waveIntensity) {
  // Distance anti-aliasing for high-frequency capillary ripples
  float capFade = exp(-viewDist * 0.022);
  float medFade = exp(-viewDist * 0.006);
  float rippleScale = mix(0.16, 2.65, clamp(waveIntensity, 0.0, 1.0));

  vec2 grad = vec2(0.0);

  // Gravity swell octaves
  {
    vec2 d = vec2(0.86, 0.51);
    float p = dot(xz, d) * 0.85 + wavePhase * 1.35;
    grad += d * (0.042 * cos(p));
  }
  {
    vec2 d = vec2(-0.62, 0.78);
    float p = dot(xz, d) * 1.45 + wavePhase * 1.82;
    grad += d * (0.038 * cos(p));
  }
  // Short wind chop
  {
    vec2 d = vec2(0.35, -0.94);
    float p = dot(xz, d) * 3.10 + wavePhase * 2.65;
    grad += d * (0.044 * medFade * cos(p));
  }
  {
    vec2 d = vec2(-0.92, -0.39);
    float p = dot(xz, d) * 4.80 - wavePhase * 3.25;
    grad += d * (0.040 * medFade * cos(p));
  }
  // Capillary ripples (create crisp shimmering Snell's window ring)
  {
    vec2 d = vec2(0.71, -0.70);
    float p = dot(xz, d) * 10.5 + wavePhase * 4.4;
    grad += d * (0.045 * capFade * cos(p));
  }
  {
    vec2 d = vec2(0.24, 0.97);
    float p = dot(xz, d) * 16.5 - wavePhase * 5.6;
    grad += d * (0.036 * capFade * cos(p));
  }

  return grad * rippleScale;
}

// Subtle Gulf of Eilat / Sinai & Edom desert mountain rim profile along the compressed horizon
float mountainSilhouette(float azimuth) {
  float m1 = sin(azimuth * 3.0 + 0.6) * 0.5 + 0.5;
  float m2 = sin(azimuth * 7.0 - 1.3) * 0.5 + 0.5;
  float m3 = sin(azimuth * 17.0 + 2.4) * 0.5 + 0.5;
  float m4 = sin(azimuth * 31.0 - 0.4) * 0.5 + 0.5;
  // Open sea gap toward south-southwest, steeper Sinai & Jordanian Edom peaks east/west
  float bayGap = smoothstep(-0.3, 0.5, cos(azimuth - 2.6));
  float ridge = 0.008 + (0.022 * m1 + 0.013 * m2 + 0.006 * m3 + 0.003 * m4) * (1.0 - 0.55 * bayGap);
  return ridge;
}

vec3 sampleAboveWaterSky(vec3 dirAir, vec2 rippleGrad) {
  float up = clamp(dirAir.y, 0.0, 1.0);

  // Sky zenith-to-horizon Rayleigh gradient
  float skyCurve = pow(up, 0.48);
  vec3 sky = mix(uSkyHorizonColor, uSkyZenithColor, skyCurve);

  // Solar aureole & Mie forward scattering around solar disc
  float cosSun = max(0.0, dot(dirAir, normalize(uSunAboveDir)));
  float mieAureole = pow(cosSun, 12.0) * 0.35 + pow(cosSun, 96.0) * 0.95;
  sky += uSunAboveColor * mieAureole * 0.42;

  // Crisp solar disc + subtle refractive wave-sparkle halo
  float sunDisc = smoothstep(0.99945, 0.99988, cosSun);
  float sunCorona = pow(cosSun, 520.0) * 1.4;
  sky += uSunAboveColor * (sunDisc * 4.5 + sunCorona);

  // Subtle Eilat/Sinai horizon mountain rim silhouette (R_air.y < 0.05)
  if (dirAir.y < 0.055) {
    float az = atan(dirAir.z, dirAir.x);
    float ridgeH = mountainSilhouette(az);
    float mtnMask = 1.0 - smoothstep(ridgeH - 0.004, ridgeH + 0.004, dirAir.y);
    // Warm sunlit desert ridge attenuated by atmospheric haze
    vec3 mtnColor = mix(vec3(0.09, 0.07, 0.08), uSkyHorizonColor * 0.42, 0.55);
    sky = mix(sky, mtnColor, mtnMask * 0.85);
  }

  // Subtle high-altitude cirrus wisps
  float cloudUV = (dirAir.x / (up + 0.25)) * 1.1 + (dirAir.z / (up + 0.25)) * 0.7;
  float cirrus = smoothstep(0.35, 0.85, sin(cloudUV * 2.1 + uTime * 0.02) * cos(cloudUV * 1.3 - 0.8)) * 0.08;
  sky += uSkyHorizonColor * cirrus * smoothstep(0.05, 0.45, up);

  return sky;
}

vec3 sampleInternalWaterReflection(vec3 dirWater, vec2 rippleGrad, float nearCritical) {
  // Reflected underwater ray points downward into the reef/water column (dirWater.y < 0)
  float down = clamp(-dirWater.y, 0.0, 1.0);
  vec3 baseWater = mix(uScatterColor * 0.92, uDeepScatterColor * 1.15, pow(down, 0.65));

  // Upward-bounced reef & caustic shimmer reflected off the rippled underside
  float rippleSparkle = clamp(length(rippleGrad) * 6.5, 0.0, 1.0);
  float sunAlign = pow(max(0.0, dot(normalize(vec3(dirWater.x, 0.0, dirWater.z)), normalize(vec3(uSunAboveDir.x, 0.0, uSunAboveDir.z)))), 4.0);
  vec3 causticShimmer = (uUpScatterColor * 0.65 + uSunAboveColor * 0.14) * rippleSparkle * (0.35 + 0.65 * sunAlign);

  // Silver-mercury internal reflection rim highlight near Snell's critical boundary
  vec3 rimGlow = mix(uUpScatterColor, uSkyHorizonColor * 0.65, 0.45) * nearCritical * 0.45;

  return baseWater + causticShimmer * (1.0 - 0.5 * uTurbidity) + rimGlow;
}

void main() {
  vec3 viewVec = vWorldPos - cameraPosition;
  float viewDist = length(viewVec);
  vec3 I = viewVec / max(viewDist, 0.0001);

  vec2 rippleGrad = computeSurfaceRippleGradient(vWorldPos.xz, uWavePhase, viewDist, uWaveIntensity) + vWaveSlope;
  vec3 N_up = normalize(vec3(-rippleGrad.x, 1.0, -rippleGrad.y));

  // Water-to-air refraction parameters: n1 = IOR_WATER (1.3315), n2 = IOR_AIR (1.0)
  const float n1 = ${WORLD_CONSTANTS.IOR_WATER.toFixed(4)};
  const float n2 = ${WORLD_CONSTANTS.IOR_AIR.toFixed(4)};
  const float eta = n1 / n2;

  float cosThetaI = dot(I, N_up);
  vec3 surfaceRadiance;

  if (cosThetaI <= 0.0001) {
    // Grazing ripple facet facing away -> Total Internal Reflection
    vec3 R_water = reflect(I, -N_up);
    surfaceRadiance = sampleInternalWaterReflection(R_water, rippleGrad, 0.0);
  } else {
    float sin2ThetaI = max(0.0, 1.0 - cosThetaI * cosThetaI);
    float sin2ThetaT = eta * eta * sin2ThetaI;
    vec3 R_water = reflect(I, -N_up);
    float nearCritical = smoothstep(0.72, 1.0, sin2ThetaT) * (1.0 - smoothstep(1.0, 1.18, sin2ThetaT));

    if (sin2ThetaT >= 1.0) {
      // Outside Snell's Window (~48.7 deg critical half-angle): Total Internal Reflection (F = 1.0)
      surfaceRadiance = sampleInternalWaterReflection(R_water, rippleGrad, nearCritical);
    } else {
      // Inside Snell's Window cone: exact unpolarized dielectric Fresnel blend
      float cosThetaT = sqrt(1.0 - sin2ThetaT);
      vec3 R_air = normalize(eta * I - (eta * cosThetaI - cosThetaT) * N_up);

      float rs = (n1 * cosThetaI - n2 * cosThetaT) / max(n1 * cosThetaI + n2 * cosThetaT, 1e-5);
      float rp = (n1 * cosThetaT - n2 * cosThetaI) / max(n1 * cosThetaT + n2 * cosThetaI, 1e-5);
      float F = clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);

      vec3 refractedSky = sampleAboveWaterSky(R_air, rippleGrad);
      vec3 reflectedWater = sampleInternalWaterReflection(R_water, rippleGrad, nearCritical);
      surfaceRadiance = mix(refractedSky, reflectedWater, F);
    }
  }

  // Subtle sunlit aerated wave-crest foam/bubble sheen along steep crests at high wave intensity
  float foamMask = smoothstep(0.45, 1.0, uWaveIntensity)
    * smoothstep(0.35, 0.85, vWaveCrest)
    * (1.0 - smoothstep(45.0, 140.0, viewDist));
  if (foamMask > 0.001) {
    float crestNoise = 0.55 + 0.45
      * sin(vWorldPos.x * 7.3 + vWorldPos.z * 5.9 + uWavePhase * 1.8)
      * cos(vWorldPos.x * 4.1 - vWorldPos.z * 8.7 - uWavePhase * 1.4);
    float slopeBoost = smoothstep(0.06, 0.28, length(vWaveSlope));
    float bubbleSheen = foamMask * (0.45 + 0.55 * slopeBoost) * crestNoise;
    vec3 foamColor = mix(
      uUpScatterColor * 1.15 + uSkyHorizonColor * 0.35,
      uSunAboveColor * 0.55 + uSkyHorizonColor * 0.45,
      0.5
    );
    surfaceRadiance = mix(surfaceRadiance, foamColor, clamp(bubbleSheen * 0.45, 0.0, 0.58));
  }

  // Beer-Lambert attenuation & exponential water scatter along underwater view ray
  vec3 T_view = exp(-uAttenuationRGB * viewDist);
  vec3 dirScatter = mix(uScatterColor, uUpScatterColor, smoothstep(0.0, 0.85, max(0.0, I.y)) * 0.5);
  vec3 finalColor = surfaceRadiance * T_view + dirScatter * (1.0 - T_view);

  gl_FragColor = vec4(finalColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Create a high-density radial disc geometry centered at (0, 0, 0) on the XZ plane
 * with tighter ring spacing near the diver's overhead cone and smooth extension to radius 300m.
 */
function createRadialDiscGeometry(radius = 300, angularSegments = 144, radialSegments = 48) {
  const positions = [0, 0, 0];
  const normals = [0, -1, 0];
  const uvs = [0.5, 0.5];
  const indices = [];

  for (let r = 1; r <= radialSegments; r++) {
    const t = r / radialSegments;
    const dist = radius * Math.pow(t, 1.85);
    for (let a = 0; a <= angularSegments; a++) {
      const theta = (a / angularSegments) * Math.PI * 2;
      const x = Math.cos(theta) * dist;
      const z = Math.sin(theta) * dist;
      positions.push(x, 0, z);
      normals.push(0, -1, 0);
      uvs.push(0.5 + (x / radius) * 0.5, 0.5 + (z / radius) * 0.5);
    }
  }

  const ringStride = angularSegments + 1;
  // Center fan
  for (let a = 0; a < angularSegments; a++) {
    indices.push(0, 1 + a, 1 + a + 1);
  }
  // Concentric quads
  for (let r = 1; r < radialSegments; r++) {
    const ringStart = 1 + (r - 1) * ringStride;
    const nextRingStart = 1 + r * ringStride;
    for (let a = 0; a < angularSegments; a++) {
      const i0 = ringStart + a;
      const i1 = ringStart + a + 1;
      const i2 = nextRingStart + a;
      const i3 = nextRingStart + a + 1;
      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return geom;
}

/**
 * Create the overhead Snell's Window water-surface mesh.
 */
export function createSnellsWindowMesh(uniforms) {
  const geometry = createRadialDiscGeometry(300, 144, 48);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SNELLS_WINDOW_VERTEX,
    fragmentShader: SNELLS_WINDOW_FRAGMENT,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'SnellsWindowSurface';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
