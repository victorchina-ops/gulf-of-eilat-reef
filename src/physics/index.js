import * as THREE from 'three';
import { WORLD_CONSTANTS, DEFAULT_ENV_STATE } from '../contracts.js';
import {
  createWaterOpticsUniforms,
  updateWaterOpticsUniforms,
  getTransmittanceAtDepth,
  computePenetrationDepths,
} from './waterOptics.js';
import { COLORCHECKER_CLASSIC_PATCHES, simulateColorChecker } from './colorChartSim.js';

export { computePenetrationDepths, getTransmittanceAtDepth, computeSolarWaterTransfer } from './waterOptics.js';
export { COLORCHECKER_CLASSIC_PATCHES, simulateColorChecker };
import { applyUnderwaterMaterial as applyUnderwaterShader } from '../shaders/underwaterCommon.glsl.js';
import { createSnellsWindowMesh } from '../shaders/snellsWindow.glsl.js';
import { createSeabedMesh } from '../shaders/seabed.glsl.js';
import { createSunShaftsMesh, createMarineSnowPoints } from '../shaders/volumetrics.glsl.js';

const _shimmerOffset = new THREE.Vector3();
const _shallowGroundColor = new THREE.Color(0x8c7a5e);
const _deepGroundColor = new THREE.Color(0x123252);

export function createWaterOpticsSystem(scene, initialEnvState = DEFAULT_ENV_STATE) {
  const env = { ...DEFAULT_ENV_STATE, ...initialEnvState };
  const uniforms = createWaterOpticsUniforms(env);

  const applyUnderwaterMaterial = (material, options = { receiveCaustics: true, causticsStrength: 1.0 }) =>
    applyUnderwaterShader(material, options, uniforms);

  // Surface-referenced lighting (downwelling & view-path Beer-Lambert attenuation applied per-fragment)
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.15);
  sunLight.position.copy(uniforms.uRefractedSunDir.value).multiplyScalar(45);
  sunLight.name = 'RefractedSunLight';
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(0x8cd0ff, 0x6c5e4b, 0.72);
  hemiLight.name = 'UnderwaterHemisphereLight';
  scene.add(hemiLight);

  // World environment meshes
  const seabedMesh = createSeabedMesh(applyUnderwaterMaterial, uniforms);
  scene.add(seabedMesh);

  const surfaceMesh = createSnellsWindowMesh(uniforms);
  surfaceMesh.position.set(0, uniforms.uSurfaceY.value, 0);
  scene.add(surfaceMesh);

  const sunShaftsMesh = createSunShaftsMesh(uniforms);
  scene.add(sunShaftsMesh);

  const marineSnowPoints = createMarineSnowPoints(uniforms, 2600);
  scene.add(marineSnowPoints);

  // Match scene.background to ACES-tonemapped asymptotic horizontal water scatter
  scene.background = uniforms.uBackgroundColor.value.clone();

  function update(elapsedTime, _deltaTime, camera, envState = env) {
    const camY = camera?.position?.y ?? WORLD_CONSTANTS.SURFACE_BASE_Y;
    updateWaterOpticsUniforms(uniforms, elapsedTime, camY, envState, 1.05);

    const waveInt = uniforms.uWaveIntensity.value;
    const wavePhase = uniforms.uWavePhase.value;
    const shimmerScale = 0.024 * waveInt;
    sunLight.position.copy(uniforms.uRefractedSunDir.value).multiplyScalar(45);
    sunLight.position.add(
      _shimmerOffset.set(
        Math.sin(wavePhase * 1.15) * shimmerScale * 45,
        0,
        Math.cos(wavePhase * 1.42) * shimmerScale * 45
      )
    );
    sunLight.color.copy(uniforms.uSunAboveColor.value);
    sunLight.intensity = (0.55 + 0.65 * Math.sin(uniforms.uSunElevationRad.value))
      * (1.0 + waveInt * 0.12 * Math.sin(wavePhase * 1.25));

    hemiLight.color
      .copy(uniforms.uSkyHorizonColor.value)
      .lerp(uniforms.uSkyZenithColor.value, 0.35);
    const depth01 = Math.max(0, Math.min(1, ((envState?.diveDepth ?? 6.0) - 1.0) / 30.0));
    hemiLight.groundColor.copy(_shallowGroundColor).lerp(_deepGroundColor, depth01);
    const sunLum = Math.max(0.18, uniforms.uSunAboveColor.value.r * 0.3 + uniforms.uSunAboveColor.value.b * 0.25);
    hemiLight.intensity = Math.min(0.95, 0.42 + sunLum * 0.28);

    if (camera) {
      surfaceMesh.position.set(camera.position.x, uniforms.uSurfaceY.value, camera.position.z);
    } else {
      surfaceMesh.position.y = uniforms.uSurfaceY.value;
    }

    if (marineSnowPoints?.material?.uniforms?.uPixelRatio) {
      marineSnowPoints.material.uniforms.uPixelRatio.value =
        typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    }

    if (scene.background && scene.background.isColor) {
      scene.background.copy(uniforms.uBackgroundColor.value);
    } else {
      scene.background = uniforms.uBackgroundColor.value.clone();
    }
  }

  // Run an initial update so lights, background, and uniforms are synced immediately
  update(0, 0, null, env);

  return {
    uniforms,
    applyUnderwaterMaterial,
    update,
    getTransmittanceAtDepth,
    computePenetrationDepths,
    simulateColorChecker: (state = env, options) => simulateColorChecker(state, options),
    seabedMesh,
    surfaceMesh,
    sunShaftsMesh,
    marineSnowPoints,
  };
}
