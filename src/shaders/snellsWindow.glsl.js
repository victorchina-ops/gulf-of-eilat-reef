import * as THREE from 'three';
import { WORLD_CONSTANTS } from '../contracts.js';
import { GLSL_RADIATIVE_HELPERS } from './underwaterCommon.glsl.js';

const SNELLS_WINDOW_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uWaveIntensity;
uniform float uWavePhase;

varying vec3 vWorldPos;
varying float vWaveCrest;
varying vec2 vWaveSlope;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  // 5-component non-orthogonal directional ocean gravity swell tapering toward the 300m horizon
  // Max trough amplitude <= 0.44m so minimum uSurfaceY (3.8m) - 0.44m = 3.36m stays clear of MAX_STATIC_Y (2.55m)
  float distXZ = length(position.xz);
  float swellFade = 1.0 - smoothstep(45.0, 180.0, distXZ);
  float wInt = clamp(uWaveIntensity, 0.0, 1.0);
  float ampScale = mix(0.015, 0.44, wInt) * swellFade;

  vec2 xz = worldPosition.xz;
  // Non-orthogonal azimuths spread evenly over 180 deg (11, 49, 83, 119, 153 deg) to avoid square wave lattices
  vec2 d1 = vec2(0.982, 0.191);
  vec2 d2 = vec2(0.656, 0.755);
  vec2 d3 = vec2(0.122, 0.993);
  vec2 d4 = vec2(-0.485, 0.875);
  vec2 d5 = vec2(-0.891, 0.454);

  float k1 = 0.42;
  float k2 = 0.67;
  float k3 = 1.08;
  float k4 = 1.54;
  float k5 = 2.05;

  float p1 = dot(xz, d1) * k1 + uWavePhase * 1.15;
  float p2 = dot(xz, d2) * k2 + uWavePhase * 1.46;
  float p3 = dot(xz, d3) * k3 - uWavePhase * 1.92;
  float p4 = dot(xz, d4) * k4 + uWavePhase * 2.38;
  float p5 = dot(xz, d5) * k5 - uWavePhase * 2.75;

  float a1 = 0.36 * ampScale;
  float a2 = 0.24 * ampScale;
  float a3 = 0.16 * wInt * ampScale;
  float a4 = 0.13 * wInt * ampScale;
  float a5 = 0.11 * wInt * ampScale;

  float h = a1 * sin(p1) + a2 * cos(p2) + a3 * sin(p3) + a4 * cos(p4) + a5 * sin(p5);
  worldPosition.y += h;

  vWaveSlope =
    d1 * (a1 * k1 * cos(p1)) -
    d2 * (a2 * k2 * sin(p2)) +
    d3 * (a3 * k3 * cos(p3)) -
    d4 * (a4 * k4 * sin(p4)) +
    d5 * (a5 * k5 * cos(p5));
  vWaveCrest = clamp(h / max(ampScale, 0.0001), 0.0, 1.0);
  vWorldPos = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const SNELLS_WINDOW_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSurfaceY;
uniform float uCamDepth;
uniform vec3 uAttenuationRGB;
uniform vec3 uViewAttenuationRGB;
uniform vec3 uSunAboveColor;
uniform vec3 uSunAboveDir;
uniform vec3 uRefractedSunDir;
uniform vec3 uSkyZenithColor;
uniform vec3 uSkyHorizonColor;
uniform vec3 uScatterColor;
uniform vec3 uDeepScatterColor;
uniform vec3 uUpScatterColor;
uniform float uTurbidity;
uniform float uWaveIntensity;
uniform float uWavePhase;
uniform float uPathTortuosity;
uniform float uDownPathFactor;
uniform float uSurfaceTransmittance;

varying vec3 vWorldPos;
varying float vWaveCrest;
varying vec2 vWaveSlope;

${GLSL_RADIATIVE_HELPERS}

// Multi-octave non-orthogonal capillary-gravity wave gradient (world XZ -> surface slope dh/dx, dh/dz)
vec2 computeSurfaceRippleGradient(vec2 xz, float wavePhase, float viewDist, float waveIntensity) {
  // Distance anti-aliasing for high-frequency capillary ripples
  float capFade = exp(-viewDist * 0.022);
  float medFade = exp(-viewDist * 0.006);
  float rippleScale = mix(0.14, 2.20, clamp(waveIntensity, 0.0, 1.0));

  vec2 grad = vec2(0.0);

  // 7 wave components evenly distributed at 26 deg spacing (9, 35, 61, 87, 113, 139, 165 deg)
  {
    vec2 d = vec2(0.988, 0.156);
    float p = dot(xz, d) * 0.78 + wavePhase * 1.22;
    grad += d * (0.036 * cos(p));
  }
  {
    vec2 d = vec2(0.819, 0.574);
    float p = dot(xz, d) * 1.32 - wavePhase * 1.68;
    grad += d * (0.034 * cos(p));
  }
  {
    vec2 d = vec2(0.485, 0.875);
    float p = dot(xz, d) * 2.25 + wavePhase * 2.15;
    grad += d * (0.034 * medFade * cos(p));
  }
  {
    vec2 d = vec2(0.052, 0.999);
    float p = dot(xz, d) * 3.45 - wavePhase * 2.74;
    grad += d * (0.032 * medFade * cos(p));
  }
  {
    vec2 d = vec2(-0.391, 0.921);
    float p = dot(xz, d) * 5.20 + wavePhase * 3.40;
    grad += d * (0.030 * medFade * cos(p));
  }
  {
    vec2 d = vec2(-0.755, 0.656);
    float p = dot(xz, d) * 9.60 + wavePhase * 4.35;
    grad += d * (0.032 * capFade * cos(p));
  }
  {
    vec2 d = vec2(-0.966, 0.259);
    float p = dot(xz, d) * 14.80 - wavePhase * 5.25;
    grad += d * (0.028 * capFade * cos(p));
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
  float skyCurve = pow(max(up, 1e-5), 0.48);
  vec3 sky = mix(uSkyHorizonColor, uSkyZenithColor, skyCurve);

  // Solar aureole & Mie forward scattering around solar disc
  float cosSun = max(0.0, dot(dirAir, normalize(uSunAboveDir)));
  float cosSunSafe = max(cosSun, 1e-5);
  float mieAureole = pow(cosSunSafe, 12.0) * 0.35 + pow(cosSunSafe, 96.0) * 0.95;
  sky += uSunAboveColor * mieAureole * 0.42;

  // Crisp solar disc + subtle refractive wave-sparkle halo
  float sunDisc = smoothstep(0.99945, 0.99988, cosSun);
  float sunCorona = pow(cosSunSafe, 520.0) * 1.4;
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
  // Reflected underwater ray points downward into the sunlit upper water layer and reef (dirWater.y < 0)
  float down = clamp(-dirWater.y, 0.0, 1.0);
  // TIR at shallow/mid upward viewing angles reflects the luminous sunlit photic layer right beneath the waves
  vec3 subSurfaceGlow = mix(uUpScatterColor * 1.12, uScatterColor * 1.35, 0.35);
  vec3 deepMirror = mix(uScatterColor * 0.78, uDeepScatterColor * 1.25, 0.55);
  vec3 baseWater = mix(subSurfaceGlow, deepMirror, smoothstep(0.15, 0.92, down));

  // Total Internal Reflection (TIR) reef-bounce radiance: trace downward ray to sunlit sand/coral reef
  float uwDepthSurf = max(1.0, uSurfaceY + 0.6);
  float downCos = max(-dirWater.y, 0.16);
  float bounceDist = clamp(uwDepthSurf / downCos, 1.2, 42.0);
  vec2 hitXZ = vWorldPos.xz + dirWater.xz * bounceDist;
  float hitRadius = length(hitXZ);

  // Isotropic radial carbonate sand & coral-limestone reef bowl (no rectangular Z-band mask)
  float reefBowl = 1.0 - smoothstep(16.0, 34.0, hitRadius);
  float spurPattern = 0.5 + 0.5 * sin(hitXZ.x * 0.34 + cos(hitXZ.y * 0.25) * 0.9) * cos(hitXZ.y * 0.29 - hitXZ.x * 0.18);
  vec3 sandBounceAlbedo = vec3(0.66, 0.58, 0.45);
  vec3 coralBounceAlbedo = vec3(0.42, 0.31, 0.28);
  vec3 reefAlbedo = mix(sandBounceAlbedo, coralBounceAlbedo, smoothstep(0.38, 0.72, spurPattern));

  // Round-trip attenuation: surface -> reef floor -> upward bounce back to surface underside
  vec3 T_downReef = uwDownwellingTransmittanceByFactor(uwDepthSurf, uAttenuationRGB, uDownPathFactor, uSurfaceTransmittance);
  vec3 T_bounceUp = exp(-uAttenuationRGB * bounceDist * uPathTortuosity);
  vec3 reefIrr = (uSunAboveColor * 0.55 + uUpScatterColor * 1.10) * T_downReef;
  vec3 reefBounce = reefAlbedo * reefIrr * T_bounceUp * (0.48 + 0.32 * down) * reefBowl;

  // Shallow-to-deep turquoise-teal TIR column blend
  vec3 tirWater = mix(baseWater, baseWater + reefBounce, 0.85);

  // Upward-bounced reef & caustic shimmer reflected off the rippled underside
  float rippleSparkle = clamp(length(rippleGrad) * 6.5, 0.0, 1.0);
  vec2 waterHoriz = vec2(dirWater.x, dirWater.z);
  vec2 sunHoriz = vec2(uSunAboveDir.x, uSunAboveDir.z);
  float waterHorizLen = length(waterHoriz);
  float sunHorizLen = length(sunHoriz);
  float horizDot = (waterHorizLen > 1e-4 && sunHorizLen > 1e-4)
    ? max(0.0, dot(waterHoriz / waterHorizLen, sunHoriz / sunHorizLen))
    : 0.0;
  float sunAlign = pow(max(horizDot, 1e-5), 4.0);
  vec3 causticShimmer = (uUpScatterColor * 0.55 + uSunAboveColor * 0.14 * T_downReef) * rippleSparkle * (0.35 + 0.65 * sunAlign);

  // Silver-turquoise internal reflection rim highlight near Snell's ~48.7 deg circular critical boundary
  vec3 rimGlow = mix(uUpScatterColor * 1.15, uSkyHorizonColor * 0.75, 0.45) * nearCritical * 0.62;

  return tirWater + causticShimmer * (1.0 - 0.5 * uTurbidity) + rimGlow;
}

float refractSkyChannel(
  int ch,
  float n1,
  float n2,
  float cosThetaI,
  float sin2ThetaI,
  vec3 I,
  vec3 N_up,
  vec2 rippleGrad,
  float reflectedVal
) {
  float eta = n1 / n2;
  float sin2ThetaT = eta * eta * sin2ThetaI;
  if (sin2ThetaT >= 1.0) {
    return reflectedVal;
  }
  float cosThetaT = sqrt(1.0 - sin2ThetaT);
  vec3 R_air = normalize(eta * I - (eta * cosThetaI - cosThetaT) * N_up);

  float rs = (n1 * cosThetaI - n2 * cosThetaT) / max(n1 * cosThetaI + n2 * cosThetaT, 1e-5);
  float rp = (n1 * cosThetaT - n2 * cosThetaI) / max(n1 * cosThetaT + n2 * cosThetaI, 1e-5);
  float F = clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);

  vec3 skyRGB = sampleAboveWaterSky(R_air, rippleGrad);
  float skyVal = (ch == 0) ? skyRGB.r : ((ch == 1) ? skyRGB.g : skyRGB.b);
  return mix(skyVal, reflectedVal, F);
}

void main() {
  vec3 viewVec = vWorldPos - cameraPosition;
  float viewDist = length(viewVec);
  vec3 I = viewVec / max(viewDist, 0.0001);

  vec2 rippleGrad = computeSurfaceRippleGradient(vWorldPos.xz, uWavePhase, viewDist, uWaveIntensity) + vWaveSlope;
  vec3 N_up = normalize(vec3(-rippleGrad.x, 1.0, -rippleGrad.y));

  // Seawater n = 1.3315 (n^2 = 1.773) -> Snell's critical angle ~48.7 deg, with subtle dispersion
  const float N_WATER_SQ = 1.773;
  const float nR = 1.3295;
  const float nG = 1.3315;
  const float nB = 1.3338;
  const float n2 = ${WORLD_CONSTANTS.IOR_AIR.toFixed(4)};
  float etaR = nR / n2;

  float cosThetaI = dot(I, N_up);
  vec3 surfaceRadiance;

  if (cosThetaI <= 0.0001) {
    // Grazing ripple facet facing away -> Total Internal Reflection
    vec3 R_water = reflect(I, -N_up);
    surfaceRadiance = sampleInternalWaterReflection(R_water, rippleGrad, 0.0);
  } else {
    float sin2ThetaI = max(0.0, 1.0 - cosThetaI * cosThetaI);
    float sin2ThetaT_crit = N_WATER_SQ * sin2ThetaI;
    float sin2ThetaT_R = etaR * etaR * sin2ThetaI;
    vec3 R_water = reflect(I, -N_up);
    float nearCritical = smoothstep(0.74, 1.0, sin2ThetaT_crit) * (1.0 - smoothstep(1.0, 1.18, sin2ThetaT_crit));
    vec3 reflectedWater = sampleInternalWaterReflection(R_water, rippleGrad, nearCritical);

    if (sin2ThetaT_R >= 1.0) {
      // Outside Snell's Window (~48.7 deg for n^2 = 1.773): Total Internal Reflection
      surfaceRadiance = reflectedWater;
    } else {
      // Inside Snell's Window cone: dispersive per-channel dielectric Fresnel & refraction
      surfaceRadiance = vec3(
        refractSkyChannel(0, nR, n2, cosThetaI, sin2ThetaI, I, N_up, rippleGrad, reflectedWater.r),
        refractSkyChannel(1, nG, n2, cosThetaI, sin2ThetaI, I, N_up, rippleGrad, reflectedWater.g),
        refractSkyChannel(2, nB, n2, cosThetaI, sin2ThetaI, I, N_up, rippleGrad, reflectedWater.b)
      );
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

  // Unified view-path attenuation + RTE angular water scatter & Mie solar glow
  vec3 T_view = exp(-uViewAttenuationRGB * viewDist);
  vec3 dirScatter = uwComputeAngularWaterScatter(
    I,
    uCamDepth,
    uAttenuationRGB,
    uViewAttenuationRGB,
    uScatterColor,
    uUpScatterColor,
    uDeepScatterColor,
    uRefractedSunDir,
    uTurbidity
  );

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
export function createSnellsWindowMesh(sharedUniforms) {
  const geometry = createRadialDiscGeometry(300, 144, 48);
  const surfaceUniforms = {
    ...(sharedUniforms || {}),
    uCamDepth: sharedUniforms?.uCamDepth || { value: 6.0 },
    uViewAttenuationRGB: sharedUniforms?.uViewAttenuationRGB || { value: new THREE.Vector3(0.304, 0.092, 0.066) },
    uRefractedSunDir: sharedUniforms?.uRefractedSunDir || { value: new THREE.Vector3(0.0, 0.94, 0.34).normalize() },
    uPathTortuosity: sharedUniforms?.uPathTortuosity || { value: 1.025 },
    uDownPathFactor: sharedUniforms?.uDownPathFactor || { value: 1.15 },
    uSurfaceTransmittance: sharedUniforms?.uSurfaceTransmittance || { value: 0.96 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: surfaceUniforms,
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

const WATER_COLUMN_DOME_VERTEX = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vWorldDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WATER_COLUMN_DOME_FRAGMENT = /* glsl */ `
uniform float uCamDepth;
uniform vec3 uAttenuationRGB;
uniform vec3 uViewAttenuationRGB;
uniform vec3 uScatterColor;
uniform vec3 uUpScatterColor;
uniform vec3 uDeepScatterColor;
uniform vec3 uRefractedSunDir;
uniform float uTurbidity;

varying vec3 vWorldDir;

${GLSL_RADIATIVE_HELPERS}

void main() {
  vec3 viewDir = normalize(vWorldDir);
  vec3 col = uwComputeAngularWaterScatter(
    viewDir,
    uCamDepth,
    uAttenuationRGB,
    uViewAttenuationRGB,
    uScatterColor,
    uUpScatterColor,
    uDeepScatterColor,
    uRefractedSunDir,
    uTurbidity
  );
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Create a 360-degree underwater water-column dome centered on the camera so distant
 * viewing angles exhibit physical vertical luminance & spectral gradients with zero seams.
 */
export function createWaterColumnDomeMesh(sharedUniforms) {
  const geometry = new THREE.SphereGeometry(380, 48, 32);
  const domeUniforms = {
    ...(sharedUniforms || {}),
    uCamDepth: sharedUniforms?.uCamDepth || { value: 6.0 },
    uAttenuationRGB: sharedUniforms?.uAttenuationRGB || { value: new THREE.Vector3(0.287, 0.080, 0.051) },
    uViewAttenuationRGB: sharedUniforms?.uViewAttenuationRGB || { value: new THREE.Vector3(0.304, 0.092, 0.066) },
    uScatterColor: sharedUniforms?.uScatterColor || { value: new THREE.Color(0.007, 0.088, 0.195) },
    uUpScatterColor: sharedUniforms?.uUpScatterColor || { value: new THREE.Color(0.015, 0.178, 0.355) },
    uDeepScatterColor: sharedUniforms?.uDeepScatterColor || { value: new THREE.Color(0.0015, 0.031, 0.109) },
    uRefractedSunDir: sharedUniforms?.uRefractedSunDir || { value: new THREE.Vector3(0.0, 0.94, 0.34).normalize() },
    uTurbidity: sharedUniforms?.uTurbidity || { value: 0.18 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: domeUniforms,
    vertexShader: WATER_COLUMN_DOME_VERTEX,
    fragmentShader: WATER_COLUMN_DOME_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'WaterColumnDome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return mesh;
}
