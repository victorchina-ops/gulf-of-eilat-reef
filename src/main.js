import * as THREE from 'three';
import {
  DEFAULT_ENV_STATE,
  WORLD_CONSTANTS,
  createDefaultSpeciesCounts,
  getSeabedHeight,
  sanitizeSpeciesCount,
} from './contracts.js';
import { createWaterOpticsSystem } from './physics/index.js';
import { reconcileSolarState } from './physics/solarCalendar.js';
import { createBiodiversitySystem } from './entities/index.js';
import { createDiveCameraControls } from './controls/diveCameraControls.js';
import { createUI } from './ui/index.js';

const appContainer = document.getElementById('app') || document.body;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
appContainer.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  500
);
camera.position.set(0, 2.6, 12.2);

const envState = {
  ...DEFAULT_ENV_STATE,
  speciesCounts: createDefaultSpeciesCounts(),
};

let preferredHalfDay = envState.timeOfDay < 12 ? 'am' : 'pm';

function onEnvChange(patch) {
  if (!patch || typeof patch !== 'object') return;

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'speciesCounts') continue;
    if (key === 'sunElevation' || key === 'timeOfDay' || key === 'dayOfYear') continue;
    if (key === 'diveDepth') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        envState.diveDepth = Math.max(
          WORLD_CONSTANTS.MIN_DEPTH,
          Math.min(WORLD_CONSTANTS.MAX_DEPTH, value)
        );
      }
      continue;
    }
    envState[key] = value;
  }

  const touchesSolar =
    Object.prototype.hasOwnProperty.call(patch, 'sunElevation') ||
    Object.prototype.hasOwnProperty.call(patch, 'timeOfDay') ||
    Object.prototype.hasOwnProperty.call(patch, 'dayOfYear');

  if (touchesSolar) {
    const solved = reconcileSolarState(envState, patch, preferredHalfDay);
    preferredHalfDay = solved.halfDay;
    envState.sunElevation = solved.sunElevation;
    envState.timeOfDay = solved.timeOfDay;
    envState.dayOfYear = solved.dayOfYear;
  }

  if (
    patch.speciesCounts &&
    typeof patch.speciesCounts === 'object' &&
    !Array.isArray(patch.speciesCounts)
  ) {
    const sanitized = {};
    for (const [id, rawCount] of Object.entries(patch.speciesCounts)) {
      if (Object.prototype.hasOwnProperty.call(envState.speciesCounts, id)) {
        sanitized[id] = sanitizeSpeciesCount(id, rawCount);
      }
    }
    envState.speciesCounts = {
      ...envState.speciesCounts,
      ...sanitized,
    };
  }
}

const optics = createWaterOpticsSystem(scene, envState);
const ecosystem = createBiodiversitySystem(scene, {
  applyUnderwaterMaterial: optics.applyUnderwaterMaterial,
  getSeabedHeight,
});
const cameraCtrl = createDiveCameraControls(camera, renderer.domElement, {
  getSeabedHeight,
  scene,
  pickableMeshes: ecosystem.pickableMeshes,
});
const ui = createUI({
  envState,
  onEnvChange,
  cameraCtrl,
  pickableMeshes: ecosystem.pickableMeshes,
  camera,
  domElement: renderer.domElement,
  getTransmittanceAtDepth: optics.getTransmittanceAtDepth,
});

window.__REEF_SIM__ = {
  scene,
  camera,
  renderer,
  envState,
  setEnvState: onEnvChange,
  cameraCtrl,
  optics,
  ecosystem,
  ui,
};

function handleResize() {
  const width = window.innerWidth;
  const height = window.innerHeight || 1;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
}

window.addEventListener('resize', handleResize);

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  cameraCtrl.update(elapsed, dt, envState);
  optics.update(elapsed, dt, camera, envState);
  ecosystem.update(elapsed, dt, envState);
  ui.update(elapsed, camera, envState);

  renderer.render(scene, camera);
}

animate();
