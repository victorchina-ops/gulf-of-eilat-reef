import * as THREE from 'three';
import { WORLD_CONSTANTS, DEFAULT_ENV_STATE } from '../contracts.js';
import {
  createWaterOpticsUniforms,
  updateWaterOpticsUniforms,
  getTransmittanceAtDepth,
  computePenetrationDepths,
} from './waterOptics.js';
import { COLORCHECKER_CLASSIC_PATCHES, simulateColorChecker } from './colorChartSim.js';

export {
  computePenetrationDepths,
  getTransmittanceAtDepth,
  computeSolarWaterTransfer,
  computeAttenuationRGB,
  computeViewAttenuationRGB,
} from './waterOptics.js';
export { COLORCHECKER_CLASSIC_PATCHES, simulateColorChecker };
import { applyUnderwaterMaterial as applyUnderwaterShader } from '../shaders/underwaterCommon.glsl.js';
import { createSnellsWindowMesh } from '../shaders/snellsWindow.glsl.js';
import { createSeabedMesh } from '../shaders/seabed.glsl.js';
import { createSunShaftsMesh, createMarineSnowPoints } from '../shaders/volumetrics.glsl.js';

const _shimmerOffset = new THREE.Vector3();
const _shallowGroundColor = new THREE.Color(0x98866a);
const _deepGroundColor = new THREE.Color(0x1a4468);
const SHADOW_HALF_EXTENT = 26;
const SHADOW_MAP_SIZE = 2048;
const SHADOW_TEXEL_STEP = (SHADOW_HALF_EXTENT * 2) / SHADOW_MAP_SIZE;

export function createWaterOpticsSystem(scene, initialEnvState = DEFAULT_ENV_STATE, options = {}) {
  const env = { ...DEFAULT_ENV_STATE, ...initialEnvState };
  const uniforms = createWaterOpticsUniforms(env);

  const applyUnderwaterMaterial = (material, matOptions = { receiveCaustics: true, causticsStrength: 1.0 }) =>
    applyUnderwaterShader(material, matOptions, uniforms);

  // Surface-referenced lighting (downwelling & view-path Beer-Lambert attenuation applied per-fragment)
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.15);
  sunLight.name = 'RefractedSunLight';
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sunLight.shadow.camera.left = -SHADOW_HALF_EXTENT;
  sunLight.shadow.camera.right = SHADOW_HALF_EXTENT;
  sunLight.shadow.camera.top = SHADOW_HALF_EXTENT;
  sunLight.shadow.camera.bottom = -SHADOW_HALF_EXTENT;
  sunLight.shadow.camera.near = 1.0;
  sunLight.shadow.camera.far = 120.0;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.035;
  sunLight.shadow.radius = 2.5;
  sunLight.shadow.camera.updateProjectionMatrix();
  sunLight.target.position.set(0, -1.0, 0);
  sunLight.position.copy(sunLight.target.position).addScaledVector(uniforms.uRefractedSunDir.value, 52);
  scene.add(sunLight);
  scene.add(sunLight.target);

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

  let envRenderTarget = null;

  /**
   * Generate an underwater PMREM radiance environment map on `scene.environment`
   * when a real WebGLRenderer is supplied (safe no-op in headless Node).
   */
  function initEnvironment(renderer) {
    if (!renderer || typeof renderer.render !== 'function' || typeof renderer.getContext !== 'function') {
      return null;
    }

    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader?.();

    const envScene = new THREE.Scene();
    const envGeom = new THREE.SphereGeometry(10, 24, 16);
    const envMat = new THREE.ShaderMaterial({
      uniforms: {
        uScatterColor: uniforms.uScatterColor,
        uDeepScatterColor: uniforms.uDeepScatterColor,
        uUpScatterColor: uniforms.uUpScatterColor,
        uSkyZenithColor: uniforms.uSkyZenithColor,
        uSunAboveColor: uniforms.uSunAboveColor,
        uRefractedSunDir: uniforms.uRefractedSunDir,
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uScatterColor;
        uniform vec3 uDeepScatterColor;
        uniform vec3 uUpScatterColor;
        uniform vec3 uSkyZenithColor;
        uniform vec3 uSunAboveColor;
        uniform vec3 uRefractedSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float snellMask = smoothstep(0.60, 0.72, d.y);
          vec3 waterCol = d.y >= 0.0
            ? mix(uScatterColor * 1.08, uUpScatterColor * 1.52, smoothstep(0.0, 0.7, d.y))
            : mix(uScatterColor * 1.08, uDeepScatterColor * 1.15, smoothstep(0.0, 0.85, -d.y));
          vec3 windowCol = mix(uUpScatterColor * 1.72, uSkyZenithColor * 0.68 + uUpScatterColor * 1.05, 0.45);
          float sunDot = max(0.0, dot(d, normalize(uRefractedSunDir)));
          vec3 col = mix(waterCol, windowCol, snellMask) + uSunAboveColor * pow(sunDot, 18.0) * 0.45;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });

    const dome = new THREE.Mesh(envGeom, envMat);
    envScene.add(dome);

    if (envRenderTarget) {
      envRenderTarget.dispose();
    }
    envRenderTarget = pmrem.fromScene(envScene, 0.04);
    scene.environment = envRenderTarget.texture;
    if ('environmentIntensity' in scene) {
      scene.environmentIntensity = 0.78;
    }

    envGeom.dispose();
    envMat.dispose();
    pmrem.dispose();
    return envRenderTarget.texture;
  }

  if (options && options.renderer) {
    initEnvironment(options.renderer);
  }

  function update(elapsedTime, deltaTime, camera, envState = env) {
    const camY = camera?.position?.y ?? WORLD_CONSTANTS.SURFACE_BASE_Y;
    const effectiveDt =
      Number.isFinite(deltaTime) && deltaTime > 0
        ? deltaTime
        : (Number.isFinite(elapsedTime) ? Math.max(0, elapsedTime - uniforms.uTime.value) : 0);

    updateWaterOpticsUniforms(uniforms, elapsedTime, camY, envState, null, effectiveDt);

    const waveInt = uniforms.uWaveIntensity.value;
    const wavePhase = uniforms.uWavePhase.value;
    const shimmerScale = 0.024 * waveInt;

    // Snap directional shadow target to texel grid within reef radius to prevent shadow swimming
    const rawTx = camera ? THREE.MathUtils.clamp(camera.position.x, -12, 12) : 0;
    const rawTz = camera ? THREE.MathUtils.clamp(camera.position.z, -12, 12) : 0;
    const snappedTx = Math.round(rawTx / SHADOW_TEXEL_STEP) * SHADOW_TEXEL_STEP;
    const snappedTz = Math.round(rawTz / SHADOW_TEXEL_STEP) * SHADOW_TEXEL_STEP;
    sunLight.target.position.set(snappedTx, -1.0, snappedTz);
    sunLight.target.updateMatrixWorld();

    sunLight.position
      .copy(sunLight.target.position)
      .addScaledVector(uniforms.uRefractedSunDir.value, 52);
    sunLight.position.add(
      _shimmerOffset.set(
        Math.sin(wavePhase * 1.15) * shimmerScale * 52,
        0,
        Math.cos(wavePhase * 1.42) * shimmerScale * 52
      )
    );
    sunLight.color.copy(uniforms.uSunAboveColor.value);
    sunLight.intensity = (0.68 + 0.78 * Math.sin(uniforms.uSunElevationRad.value))
      * (1.0 + waveInt * 0.12 * Math.sin(wavePhase * 1.25));

    hemiLight.color
      .copy(uniforms.uSkyHorizonColor.value)
      .lerp(uniforms.uSkyZenithColor.value, 0.35);
    const depth01 = Math.max(0, Math.min(1, ((envState?.diveDepth ?? 6.0) - 1.0) / 30.0));
    hemiLight.groundColor.copy(_shallowGroundColor).lerp(_deepGroundColor, depth01);
    const sunLum = Math.max(0.18, uniforms.uSunAboveColor.value.r * 0.3 + uniforms.uSunAboveColor.value.b * 0.25);
    hemiLight.intensity = Math.min(1.08, 0.52 + sunLum * 0.34);

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
    initEnvironment,
    get exposure() {
      return uniforms.uExposure.value;
    },
    getTransmittanceAtDepth,
    computePenetrationDepths,
    simulateColorChecker: (state = env, simOptions) => simulateColorChecker(state, simOptions),
    sunLight,
    hemiLight,
    seabedMesh,
    surfaceMesh,
    sunShaftsMesh,
    marineSnowPoints,
  };
}
