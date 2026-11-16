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
const resolvePresetPose = (name) => {
  const counts = ecosystem.getActiveSpeciesCounts?.() || {};
  const subFn = ecosystem.getSubstrateHeight || getSeabedHeight;
  const surfaceCap = WORLD_CONSTANTS.SURFACE_BASE_Y + (envState?.diveDepth ?? 6.0) - 0.32;
  const clampPose = (camPos, lookTarget, minClear = 0.48) => {
    const floorY = subFn(camPos.x, camPos.z) + minClear;
    if (floorY < surfaceCap) {
      camPos.y = THREE.MathUtils.clamp(camPos.y, floorY, surfaceCap);
    }
    return { camPos, lookTarget };
  };

  if (name === 'cleaning-station') {
    const st =
      ecosystem.cleaningStations?.find((s) => s.isOpen) ||
      ecosystem.cleaningStations?.[0];
    if (st?.anchorPos) {
      const target = st.anchorPos.clone();
      const lookTarget = target.clone().add(new THREE.Vector3(0, -0.05, 0));
      const camPos = new THREE.Vector3(target.x - 0.76, target.y + 0.16, target.z + 0.94);
      return clampPose(camPos, lookTarget, 0.36);
    }
  } else if (name === 'anemone-closeup') {
    const anc =
      ecosystem.anemoneAnchors?.find((a) => a.active !== false) ||
      ecosystem.anemoneAnchors?.[0];
    if (anc?.position) {
      const target = anc.position.clone().add(new THREE.Vector3(0, 0.08, 0));
      const camPos = target.clone().add(new THREE.Vector3(1.12, 0.36, 1.45));
      return clampPose(camPos, target, 0.42);
    }
  } else if (name === 'ribbontail-ray') {
    if ((counts.taeniura ?? 0) > 0 && ecosystem.rays?.length) {
      const r = ecosystem.rays[0];
      const fwd = (r.heading ? r.heading.clone() : new THREE.Vector3(0, 0, 1)).setY(0);
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
      fwd.normalize();
      const flankRight = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const target = r.pos.clone();
      const buildCand = (sideSign) =>
        target
          .clone()
          .addScaledVector(fwd, 0.36)
          .addScaledVector(flankRight, sideSign * 1.12)
          .add(new THREE.Vector3(0, 0.56, 0));
      const sightClearance = (cand) => {
        let minClear = Infinity;
        for (const t of [0, 0.35, 0.65]) {
          const sx = THREE.MathUtils.lerp(cand.x, target.x, t);
          const sy = THREE.MathUtils.lerp(cand.y, target.y, t);
          const sz = THREE.MathUtils.lerp(cand.z, target.z, t);
          minClear = Math.min(minClear, sy - subFn(sx, sz));
        }
        return minClear;
      };
      const candPosA = buildCand(1);
      const candPosB = buildCand(-1);
      const camPos = sightClearance(candPosA) >= sightClearance(candPosB) ? candPosA : candPosB;
      const viewXZ = new THREE.Vector3(target.x - camPos.x, 0, target.z - camPos.z);
      if (viewXZ.lengthSq() < 1e-4) viewXZ.set(0, 0, -1);
      viewXZ.normalize();
      const screenRight = new THREE.Vector3(-viewXZ.z, 0, viewXZ.x);
      const lookTarget = target
        .clone()
        .addScaledVector(screenRight, -0.34)
        .add(new THREE.Vector3(0, -0.02, 0));
      return clampPose(camPos, lookTarget, 0.42);
    }
  } else if (name === 'eagle-ray') {
    if ((counts.aetobatus ?? 0) > 0 && ecosystem.eagleRays?.length) {
      const er = ecosystem.eagleRays[0];
      const target = er.pos.clone();
      const fwd = new THREE.Vector3(er.heading.x, 0, er.heading.z);
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
      fwd.normalize();
      const flankRight = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const makeCand = (sideSign) =>
        target
          .clone()
          .addScaledVector(fwd, 0.78)
          .addScaledVector(flankRight, sideSign * 1.48)
          .add(new THREE.Vector3(0, 0.46, 0));
      const sightClearance = (cand) => {
        let minClear = cand.y - subFn(cand.x, cand.z);
        for (let t = 0.25; t <= 0.75; t += 0.25) {
          const sx = THREE.MathUtils.lerp(cand.x, target.x, t);
          const sy = THREE.MathUtils.lerp(cand.y, target.y, t);
          const sz = THREE.MathUtils.lerp(cand.z, target.z, t);
          minClear = Math.min(minClear, sy - subFn(sx, sz));
        }
        return minClear;
      };
      const candPosA = makeCand(1);
      const candPosB = makeCand(-1);
      const camPos = sightClearance(candPosA) >= sightClearance(candPosB) ? candPosA : candPosB;
      const viewXZ = new THREE.Vector3(target.x - camPos.x, 0, target.z - camPos.z);
      if (viewXZ.lengthSq() < 1e-4) viewXZ.set(0, 0, -1);
      viewXZ.normalize();
      const screenRight = new THREE.Vector3(-viewXZ.z, 0, viewXZ.x);
      const lookTarget = target
        .clone()
        .addScaledVector(screenRight, -0.38)
        .add(new THREE.Vector3(0, -0.03, 0));
      return clampPose(camPos, lookTarget, 0.48);
    }
  } else if (name === 'sea-turtle') {
    if ((counts.chelonia ?? 0) > 0 && ecosystem.turtles?.length) {
      const t = ecosystem.turtles[0];
      const fwd = (t.heading ? t.heading.clone() : new THREE.Vector3(0, 0, 1)).setY(0);
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
      fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const target = t.pos.clone();
      const camPos = target
        .clone()
        .addScaledVector(fwd, 0.92)
        .addScaledVector(right, 1.52)
        .add(new THREE.Vector3(0, 0.44, 0));
      return clampPose(camPos, target, 0.52);
    }
  } else if (name === 'moray-crevice') {
    if ((counts.moray ?? 0) > 0 && ecosystem.morays?.length) {
      const m = ecosystem.morays[0];
      const outDir = ((m.outDir || m.heading) ? (m.outDir || m.heading).clone() : new THREE.Vector3(0.55, 0, 0.83)).setY(0);
      if (outDir.lengthSq() < 1e-4) outDir.set(0.55, 0, 0.83);
      outDir.normalize();
      const right = new THREE.Vector3(-outDir.z, 0, outDir.x);
      const basePos = (m.anchor || m.pos).clone();
      const target = basePos.clone().addScaledVector(outDir, 0.16).add(new THREE.Vector3(0, 0.04, 0));
      const camPos = basePos
        .clone()
        .addScaledVector(outDir, 0.92)
        .addScaledVector(right, 0.28)
        .add(new THREE.Vector3(0, 0.24, 0));
      return clampPose(camPos, target, 0.28);
    }
  } else if (name === 'crown-butterfly') {
    if ((counts.chaetodon ?? 0) > 0 && ecosystem.butterflies?.length >= 2) {
      const b0 = ecosystem.butterflies[0];
      const b1 = ecosystem.butterflies[1];
      const target = b0.pos.clone().add(b1.pos).multiplyScalar(0.5);
      const fwd = (b0.heading ? b0.heading.clone() : new THREE.Vector3(0, 0, 1)).setY(0);
      if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
      fwd.normalize();
      const flankRight = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const bommies = ecosystem.bommies || [];
      const makeCand = (sideSign) =>
        target
          .clone()
          .addScaledVector(fwd, 0.16)
          .addScaledVector(flankRight, sideSign * 0.78)
          .add(new THREE.Vector3(0, 0.14, 0));
      const sightClearance = (cand) => {
        let minClear = Infinity;
        for (let t = 0; t <= 1.0; t += 0.25) {
          const sx = THREE.MathUtils.lerp(cand.x, target.x, t);
          const sy = THREE.MathUtils.lerp(cand.y, target.y, t);
          const sz = THREE.MathUtils.lerp(cand.z, target.z, t);
          minClear = Math.min(minClear, sy - subFn(sx, sz));
          for (let bi = 0; bi < bommies.length; bi++) {
            const bm = bommies[bi];
            const topY = bm.topY ?? (subFn(bm.x, bm.z) + (bm.height ?? 1.5));
            if (sy < topY + 0.15) {
              const distBommy = Math.hypot(sx - bm.x, sz - bm.z) - ((bm.radius ?? 0.5) + 0.35);
              minClear = Math.min(minClear, distBommy);
            }
          }
        }
        return minClear;
      };
      const candA = makeCand(1);
      const candB = makeCand(-1);
      const camPos = sightClearance(candA) >= sightClearance(candB) ? candA : candB;
      const viewXZ = new THREE.Vector3(target.x - camPos.x, 0, target.z - camPos.z);
      if (viewXZ.lengthSq() < 1e-4) viewXZ.set(0, 0, -1);
      viewXZ.normalize();
      const screenRight = new THREE.Vector3(-viewXZ.z, 0, viewXZ.x);
      const lookTarget = target.clone().addScaledVector(screenRight, -0.15);
      return clampPose(camPos, lookTarget, 0.44);
    }
  }
  return null;
};

const cameraCtrl = createDiveCameraControls(camera, renderer.domElement, {
  getSeabedHeight,
  getSubstrateHeight: ecosystem.getSubstrateHeight || getSeabedHeight,
  bommies: ecosystem.bommies || [],
  scene,
  pickableMeshes: ecosystem.pickableMeshes,
  resolvePresetPose,
});
function captureLiveSnapshot() {
  if (contextLost) return null;
  try {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', 0.86);
  } catch {
    return null;
  }
}

const ui = createUI({
  envState,
  onEnvChange,
  cameraCtrl,
  pickableMeshes: ecosystem.pickableMeshes,
  camera,
  domElement: renderer.domElement,
  getTransmittanceAtDepth: optics.getTransmittanceAtDepth,
  captureLiveSnapshot,
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
