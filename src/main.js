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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    if (key === 'autoExposure') {
      envState.autoExposure = Boolean(value);
      continue;
    }
    if (key === 'brightnessEV') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        envState.brightnessEV = Math.max(-1.5, Math.min(1.5, value));
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
optics.initEnvironment?.(renderer);
const ecosystem = createBiodiversitySystem(scene, {
  applyUnderwaterMaterial: optics.applyUnderwaterMaterial,
  getSeabedHeight,
  observer: camera,
});
const cameraCtrl = createDiveCameraControls(camera, renderer.domElement, {
  getSeabedHeight,
  getSubstrateHeight: ecosystem.getSubstrateHeight || getSeabedHeight,
  bommies: ecosystem.bommies || [],
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
let rafId = null;
let contextLost = false;
let contextBadgeEl = null;

function setContextLostBadge(show) {
  if (show) {
    if (!contextBadgeEl) {
      contextBadgeEl = document.createElement('div');
      contextBadgeEl.id = 'webgl-context-badge';
      contextBadgeEl.className = 'webgl-status-badge';
      contextBadgeEl.setAttribute('role', 'status');
      contextBadgeEl.textContent = 'WebGL context paused — waiting to restore GPU…';
      appContainer.appendChild(contextBadgeEl);
    }
    contextBadgeEl.classList.add('visible');
  } else if (contextBadgeEl) {
    contextBadgeEl.classList.remove('visible');
  }
}

function scheduleFrame() {
  if (contextLost || rafId !== null) return;
  rafId = requestAnimationFrame(animate);
}

function onWebGLContextLost(event) {
  event.preventDefault();
  contextLost = true;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  setContextLostBadge(true);
  console.warn('[reef-sim] WebGL context lost; animation loop paused cleanly.');
}

function onWebGLContextRestored() {
  contextLost = false;
  setContextLostBadge(false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  optics.initEnvironment?.(renderer);
  clock.getDelta();
  console.info('[reef-sim] WebGL context restored; environment rebuilt and render resumed.');
  scheduleFrame();
}

renderer.domElement.addEventListener('webglcontextlost', onWebGLContextLost, false);
renderer.domElement.addEventListener('webglcontextrestored', onWebGLContextRestored, false);

function animate() {
  rafId = null;
  if (contextLost) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  cameraCtrl.update(elapsed, dt, envState);
  optics.update(elapsed, dt, camera, envState);
  renderer.toneMappingExposure = optics.exposure ?? 1.05;
  ecosystem.update(elapsed, dt, envState);
  ui.update(elapsed, camera, envState);

  renderer.render(scene, camera);
  scheduleFrame();
}

scheduleFrame();
