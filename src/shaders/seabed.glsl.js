import * as THREE from 'three';
import { getSeabedHeight } from '../contracts.js';

/**
 * Create the 116x116m, 240x240-segment Gulf of Eilat spur-and-groove coral-sand canyon
 * and fore-reef drop-off seabed displaced by getSeabedHeight(x, z), with current-rippled
 * carbonate sand, stratified fossil reef limestone, crevice shading, coralline crusts,
 * and seamless horizon scatter fade.
 */
export function createSeabedMesh(applyUnderwaterMaterial, sharedUniforms) {
  const size = 116;
  const segments = 240;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    posAttr.setY(i, getSeabedHeight(x, z));
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.02,
  });

  material.customProgramCacheKey = () => 'eilat_seabed_v3';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSeabedScatterColor = sharedUniforms.uScatterColor;
    shader.uniforms.uSeabedWaveIntensity = sharedUniforms.uWaveIntensity || { value: 0.28 };
    shader.uniforms.uSeabedWavePhase = sharedUniforms.uWavePhase || { value: 0.0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
varying vec3 vSeabedWorldPos;
varying vec3 vSeabedWorldNormal;
varying vec3 vSeabedViewX;
varying vec3 vSeabedViewY;
varying vec3 vSeabedViewZ;
`
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
#include <project_vertex>
vSeabedWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vSeabedWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
vSeabedViewX = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
vSeabedViewY = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
vSeabedViewZ = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
uniform vec3 uSeabedScatterColor;
uniform float uSeabedWaveIntensity;
uniform float uSeabedWavePhase;
varying vec3 vSeabedWorldPos;
varying vec3 vSeabedWorldNormal;
varying vec3 vSeabedViewX;
varying vec3 vSeabedViewY;
varying vec3 vSeabedViewZ;

float sbHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float sbNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = sbHash(i);
  float b = sbHash(i + vec2(1.0, 0.0));
  float c = sbHash(i + vec2(0.0, 1.0));
  float d = sbHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float sbFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * sbNoise(p);
    p = mat2(0.8, -0.6, 0.6, 0.8) * p * 2.05;
    a *= 0.5;
  }
  return v;
}
`
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
#include <color_fragment>
{
  vec2 xz = vSeabedWorldPos.xz;
  float y = vSeabedWorldPos.y;
  float nCoarse = sbFbm(xz * 0.22);
  float nMed = sbFbm(xz * 1.15 + 4.3);
  float nRubble = sbNoise(xz * 7.8);
  float nGrain = sbNoise(xz * 18.0);

  // Current-sculpted carbonate coral sand ripples blended with wave-driven cross-ripples
  float waveInt = clamp(uSeabedWaveIntensity, 0.0, 1.0);
  float ripplePhase = xz.x * 3.2 + sin(xz.y * 0.85) * 1.45 + nMed * 2.1;
  float currentRipple = sin(ripplePhase) * 0.5 + 0.5;
  float waveRipplePhase = dot(xz, vec2(0.86, 0.51)) * 5.4 + sin(xz.y * 1.3) * 0.7 + uSeabedWavePhase * 0.28;
  float waveRipple = sin(waveRipplePhase) * 0.5 + 0.5;
  float sandRipple = mix(currentRipple, waveRipple, waveInt * 0.55);

  // Warm Gulf of Eilat carbonate coral sand with fine rubble & shell grain
  vec3 sandLight = vec3(0.79, 0.72, 0.59);
  vec3 sandDark  = vec3(0.55, 0.49, 0.40);
  float rippleContrast = mix(0.30, 0.68, waveInt);
  vec3 sandColor = mix(sandDark, sandLight, mix(nCoarse, sandRipple, rippleContrast));
  float rubbleFlecks = smoothstep(0.76, 0.96, nRubble);
  sandColor = mix(sandColor, vec3(0.85, 0.79, 0.67), rubbleFlecks * 0.28);
  sandColor *= 0.90 + 0.16 * nGrain;

  // Slope & elevation rockMask:
  // Flat canyon bottoms (slope < 0.18, y < -0.6) stay crisp sand;
  // Steep canyon cliffs, spurs & drop-off wall (slope >= 0.18 or y > -0.25) render fossil limestone & coralline crusts
  float slope = 1.0 - clamp(vSeabedWorldNormal.y, 0.0, 1.0);
  float elevRock = smoothstep(-0.60, -0.22, y + (nCoarse - 0.5) * 0.16);
  float cliffRock = smoothstep(0.11, 0.20, slope + (nMed - 0.5) * 0.035);
  float rockMask = clamp(max(elevRock, cliffRock), 0.0, 1.0);

  // Stratified fossil reef limestone layers
  float strata = sin(y * 13.5 + nCoarse * 4.2 + nMed * 1.4) * 0.5 + 0.5;
  vec3 limeWarm = vec3(0.36, 0.32, 0.27);
  vec3 limeDark = vec3(0.19, 0.17, 0.15);
  vec3 limestone = mix(limeDark, limeWarm, mix(strata, nMed, 0.45));

  // Dark crevice & fissure shading on steep faces and canyon grooves
  float fissure = pow(1.0 - abs(sbNoise(xz * 2.2 + vec2(y * 1.6, -y * 1.2)) * 2.0 - 1.0), 3.0);
  float creviceShade = clamp(smoothstep(0.16, 0.44, slope) * 0.42 + fissure * 0.38, 0.0, 0.72);
  limestone *= (1.0 - creviceShade);

  // Pink & violet crustose coralline algae on rocky outcrops & cliff ledges
  float corallineNoise = sbFbm(xz * 1.85 - 2.1);
  float corallineMask = smoothstep(0.46, 0.76, corallineNoise) * smoothstep(-3.6, 0.15, y) * (1.0 - creviceShade * 0.65);
  vec3 corallinePink = vec3(0.54, 0.21, 0.30);
  vec3 corallineViolet = vec3(0.34, 0.16, 0.33);
  vec3 corallineColor = mix(corallineViolet, corallinePink, smoothstep(0.35, 0.75, nCoarse));
  vec3 rockColor = mix(limestone, corallineColor, corallineMask * 0.62);

  // Subtle wave-orbital carbonate shimmer along sandy ripple crests & shallow rocky spur tops
  float orbitalPulse = 0.5 + 0.5 * sin(dot(xz, vec2(0.86, 0.51)) * 0.42 + uSeabedWavePhase * 1.15);
  float microGlint = 0.5 + 0.5 * sin(xz.x * 9.5 - xz.y * 7.2 + uSeabedWavePhase * 2.1);
  float sandCrestMask = smoothstep(0.60, 0.98, sandRipple) * (1.0 - rockMask);
  float spurTopMask = rockMask * smoothstep(-0.85, 0.25, y) * (1.0 - smoothstep(0.08, 0.32, slope));
  float shimmerMask = (sandCrestMask * 0.15 + spurTopMask * 0.10)
    * waveInt * (0.45 + 0.55 * orbitalPulse) * (0.65 + 0.35 * microGlint)
    * (1.0 - smoothstep(35.0, 50.0, length(xz)));

  vec3 seabedAlbedo = mix(sandColor, rockColor, rockMask) + vec3(0.82, 0.90, 0.92) * shimmerMask;
  diffuseColor.rgb *= seabedAlbedo;
}
`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
#include <roughnessmap_fragment>
{
  vec2 xzR = vSeabedWorldPos.xz;
  float nCoarseR = sbFbm(xzR * 0.22);
  float nMedR = sbFbm(xzR * 1.15 + 4.3);
  float slopeR = 1.0 - clamp(vSeabedWorldNormal.y, 0.0, 1.0);
  float elevRockR = smoothstep(-0.60, -0.22, vSeabedWorldPos.y + (nCoarseR - 0.5) * 0.16);
  float cliffRockR = smoothstep(0.11, 0.20, slopeR + (nMedR - 0.5) * 0.035);
  float rockRough = clamp(max(elevRockR, cliffRockR), 0.0, 1.0);
  roughnessFactor = mix(0.92, 0.80, rockRough);
}
`
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
#include <normal_fragment_maps>
{
  vec2 xz = vSeabedWorldPos.xz;
  float y = vSeabedWorldPos.y;
  float nCoarse = sbFbm(xz * 0.22);
  float nMed = sbFbm(xz * 1.15 + 4.3);
  float slope = 1.0 - clamp(vSeabedWorldNormal.y, 0.0, 1.0);
  float elevRock = smoothstep(-0.60, -0.22, y + (nCoarse - 0.5) * 0.16);
  float cliffRock = smoothstep(0.11, 0.20, slope + (nMed - 0.5) * 0.035);
  float rockMask = clamp(max(elevRock, cliffRock), 0.0, 1.0);

  // Sand ripple bump on sandy canyon floors (current-sculpted + wave-driven cross-ripple)
  float waveInt = clamp(uSeabedWaveIntensity, 0.0, 1.0);
  float waveBlend = waveInt * 0.55;
  float ripplePhase = xz.x * 3.2 + sin(xz.y * 0.85) * 1.45 + nMed * 2.1;
  float dRipple = cos(ripplePhase);
  float dCurrDx = dRipple * 3.2;
  float dCurrDz = dRipple * 1.2325 * cos(xz.y * 0.85);

  float waveRipplePhase = dot(xz, vec2(0.86, 0.51)) * 5.4 + sin(xz.y * 1.3) * 0.7 + uSeabedWavePhase * 0.28;
  float dWaveRipple = cos(waveRipplePhase);
  float dWaveDx = dWaveRipple * 4.644;
  float dWaveDz = dWaveRipple * (2.754 + 0.91 * cos(xz.y * 1.3));

  float sandBump = mix(0.10, 0.34, waveInt) * (1.0 - rockMask);
  float dhdx = mix(dCurrDx, dWaveDx, waveBlend) * sandBump * 0.24;
  float dhdz = mix(dCurrDz, dWaveDz, waveBlend) * sandBump * 0.24;

  // Limestone strata micro-ledge bump on cliffs & spurs
  float dStrata = cos(y * 13.5 + nCoarse * 4.2 + nMed * 1.4) * 0.18 * rockMask;

  normal = normalize(normal - vSeabedViewX * dhdx - vSeabedViewZ * dhdz - vSeabedViewY * dStrata);
}
`
      )
      .replace(
        '#include <tonemapping_fragment>',
        /* glsl */ `
{
  // Smooth radial blend into horizontal asymptotic scatter at the 58m outer rim
  float edgeFade = smoothstep(43.0, 56.0, length(vSeabedWorldPos.xz));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uSeabedScatterColor, edgeFade);
}
#include <tonemapping_fragment>
`
      );
  };

  applyUnderwaterMaterial(material, { receiveCaustics: true, causticsStrength: 1.35 });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'ReefSeabed';
  mesh.receiveShadow = true;
  return mesh;
}
