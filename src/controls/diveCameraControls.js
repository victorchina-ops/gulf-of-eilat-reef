import * as THREE from 'three';
import { WORLD_CONSTANTS, getSeabedHeight as defaultGetSeabedHeight } from '../contracts.js';

const MIN_PITCH = THREE.MathUtils.degToRad(-89);
const MAX_PITCH = THREE.MathUtils.degToRad(89);
const MIN_ROLL = THREE.MathUtils.degToRad(-30);
const MAX_ROLL = THREE.MathUtils.degToRad(30);
const MIN_FOV = 40;
const MAX_FOV = 95;
const MIN_DISTANCE = 1.4;
const MAX_DISTANCE = 36.0;
const DRAG_THRESHOLD_PX = 5;
const PRESET_DURATION_SEC = 0.6;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _ndc = new THREE.Vector2();

function computeForward(yaw, pitch, out) {
  const cosP = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cosP, Math.sin(pitch), -Math.cos(yaw) * cosP);
}

function computeRight(yaw, out) {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

function poseFromPoints(camPos, lookTarget) {
  const offset = camPos.clone().sub(lookTarget);
  const distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, offset.length()));
  const safeDist = Math.max(0.001, offset.length());
  const pitch = THREE.MathUtils.clamp(
    Math.asin(THREE.MathUtils.clamp(-offset.y / safeDist, -1, 1)),
    MIN_PITCH,
    MAX_PITCH
  );
  const yaw = Math.atan2(offset.x, offset.z);
  return { camPos: camPos.clone(), lookTarget: lookTarget.clone(), yaw, pitch, roll: 0, distance };
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function shortestAngleDiff(from, to) {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function lerpAngle(a, b, t) {
  return a + shortestAngleDiff(a, b) * t;
}

function normalizeDeg360(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Creates 360° Free-POV Dive + Orbit Camera controls with
 * non-destructive buoyancy drift, seabed/surface clamping,
 * double-click-to-swim raycasting, compass view-frame API, and presets.
 */
export function createDiveCameraControls(camera, domElement, options = {}) {
  const getSeabedHeight = options.getSeabedHeight || defaultGetSeabedHeight;
  const scene = options.scene || null;
  const pickableMeshes = options.pickableMeshes || null;

  let mode = 'dive'; // Default 360° Free-POV mode ('dive' | 'orbit')
  let latestEnvState = { diveDepth: 6.0 };

  const initialPose = poseFromPoints(
    camera.position.clone(),
    new THREE.Vector3(0, 0.6, -2.0)
  );

  // Target vs damped current state
  let targetYaw = initialPose.yaw;
  let targetPitch = initialPose.pitch;
  let targetRoll = 0;
  let currentYaw = initialPose.yaw;
  let currentPitch = initialPose.pitch;
  let currentRoll = 0;

  let targetDistance = initialPose.distance;
  let currentDistance = initialPose.distance;

  const targetOrbitTarget = initialPose.lookTarget.clone();
  const currentOrbitTarget = initialPose.lookTarget.clone();

  const targetDivePos = initialPose.camPos.clone();
  const currentDivePos = initialPose.camPos.clone();

  // Pointer & drag tracking
  let isPointerDown = false;
  let activePointerId = null;
  let activeButton = 0;
  let activePan = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let maxDragDist = 0;
  let lastGestureWasDrag = false;
  let lastPointerUpTime = 0;

  // Keyboard & raycaster
  const pressedKeys = new Set();
  const raycaster = new THREE.Raycaster();

  // Animated transition state
  let transition = null;

  // Continuous side-wheel control rates
  let wheelYawRate = 0;
  let wheelPitchRate = 0;
  let wheelVerticalRate = 0;
  let wheelForwardRate = 0;
  let wheelStrafeRate = 0;

  camera.rotation.order = 'YXZ';
  if (domElement) {
    domElement.style.touchAction = 'none';
  }

  function getLogicalCamPos(out) {
    if (mode === 'orbit') {
      computeForward(currentYaw, currentPitch, _forward);
      return out.copy(currentOrbitTarget).addScaledVector(_forward, -currentDistance);
    }
    return out.copy(currentDivePos);
  }

  function clampHorizontalRadius(pos) {
    const maxR = WORLD_CONSTANTS.REEF_RADIUS + 8.0;
    const rSq = pos.x * pos.x + pos.z * pos.z;
    if (rSq > maxR * maxR) {
      const scale = maxR / Math.sqrt(rSq);
      pos.x *= scale;
      pos.z *= scale;
    }
  }

  function getVerticalBounds(x, z, envState) {
    const depth = envState?.diveDepth ?? latestEnvState?.diveDepth ?? 6.0;
    const waveInt = THREE.MathUtils.clamp(
      envState?.waveIntensity ?? latestEnvState?.waveIntensity ?? 0.28,
      0,
      1
    );
    const surfaceY = WORLD_CONSTANTS.SURFACE_BASE_Y + depth;
    const seabedY = getSeabedHeight(x, z);
    const minY = seabedY + 0.5;
    const surfaceBuffer = 0.5 + waveInt * 0.48;
    const maxY = Math.max(minY + 0.1, surfaceY - surfaceBuffer);
    const swimCeilingY = Math.max(minY + 0.1, Math.min(maxY, seabedY + 8.5));
    return { minY, maxY, seabedY, swimCeilingY };
  }

  function clampVerticalBounds(pos, envState) {
    const { minY, maxY } = getVerticalBounds(pos.x, pos.z, envState);
    pos.y = THREE.MathUtils.clamp(pos.y, minY, maxY);
    return { minY, maxY };
  }

  function startTransition(targetPose, durationSec = PRESET_DURATION_SEC) {
    const startCamPos = getLogicalCamPos(new THREE.Vector3());
    const startOrbitTarget = currentOrbitTarget.clone();

    transition = {
      elapsed: 0,
      duration: durationSec,
      startYaw: currentYaw,
      startPitch: currentPitch,
      startRoll: currentRoll,
      startDistance: currentDistance,
      startCamPos,
      startOrbitTarget,
      endPose: targetPose,
    };
  }

  function setMode(nextMode) {
    if (nextMode !== 'orbit' && nextMode !== 'dive') return;
    if (nextMode === mode) return;

    if (nextMode === 'dive') {
      const pos = getLogicalCamPos(_desiredPos);
      currentDivePos.copy(pos);
      targetDivePos.copy(pos);
    } else {
      computeForward(targetYaw, targetPitch, _forward);
      currentOrbitTarget.copy(currentDivePos).addScaledVector(_forward, currentDistance);
      targetOrbitTarget.copy(targetDivePos).addScaledVector(_forward, targetDistance);
    }
    mode = nextMode;
  }

  function getMode() {
    return mode;
  }

  function setPreset(name) {
    let targetPose;
    if (name === 'snells-window') {
      const pitch = THREE.MathUtils.degToRad(72);
      const yaw = 0.0;
      const camPos = new THREE.Vector3(0, 1.8, 2.5);
      const fwd = computeForward(yaw, pitch, new THREE.Vector3());
      const dist = 8.0;
      targetPose = {
        camPos,
        lookTarget: camPos.clone().addScaledVector(fwd, dist),
        yaw,
        pitch,
        roll: 0,
        distance: dist,
      };
    } else if (name === 'anemone-closeup') {
      targetPose = poseFromPoints(
        new THREE.Vector3(-0.05, 1.45, 7.15),
        new THREE.Vector3(-1.6, 0.55, 5.2)
      );
    } else if (name === 'sandy-channel') {
      targetPose = poseFromPoints(
        new THREE.Vector3(0.6, 1.15, 7.6),
        new THREE.Vector3(0.6, -1.35, 1.5)
      );
    } else if (name === 'blue-water') {
      targetPose = poseFromPoints(
        new THREE.Vector3(0.0, 1.65, -7.8),
        new THREE.Vector3(0.0, 0.1, -16.8)
      );
    } else if (name === 'shallow-corals') {
      targetPose = poseFromPoints(
        new THREE.Vector3(-4.8, 1.85, 5.6),
        new THREE.Vector3(-2.2, 0.55, -1.2)
      );
    } else if (name === 'cleaning-station') {
      const stFloor = getSeabedHeight(1.75, 4.55);
      const camFloor = getSeabedHeight(0.35, 6.85);
      targetPose = poseFromPoints(
        new THREE.Vector3(0.35, Math.max(camFloor + 0.95, stFloor + 1.55), 6.85),
        new THREE.Vector3(1.75, stFloor + 0.90, 4.55)
      );
    } else {
      // 'reef' default panoramic view
      targetPose = poseFromPoints(
        new THREE.Vector3(0, 2.6, 12.2),
        new THREE.Vector3(0, 0.6, -2.0)
      );
    }

    startTransition(targetPose, PRESET_DURATION_SEC);
  }

  function getViewFrame() {
    const yawDeg = normalizeDeg360(-THREE.MathUtils.radToDeg(currentYaw));
    const pitchDeg = THREE.MathUtils.radToDeg(currentPitch);
    const rollDeg = THREE.MathUtils.radToDeg(currentRoll);
    const { minY, maxY, seabedY, swimCeilingY } = getVerticalBounds(
      camera.position.x,
      camera.position.z,
      latestEnvState
    );
    const altAboveBed = Math.max(0.5, camera.position.y - seabedY);
    const span = Math.max(0.01, swimCeilingY - minY);
    const verticalFraction = THREE.MathUtils.clamp((camera.position.y - minY) / span, 0, 1);
    return {
      yawDeg,
      pitchDeg,
      rollDeg,
      fov: camera.fov,
      pos: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      minY,
      maxY,
      swimCeilingY,
      altAboveBed,
      verticalFraction,
      mode,
      swimSpeed: Math.hypot(wheelForwardRate, wheelStrafeRate),
      forwardRate: wheelForwardRate,
      strafeRate: wheelStrafeRate,
    };
  }

  function setWheelRates(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    if ('yawRate' in patch) {
      wheelYawRate = Number.isFinite(patch.yawRate) ? patch.yawRate : 0;
    }
    if ('pitchRate' in patch) {
      wheelPitchRate = Number.isFinite(patch.pitchRate) ? patch.pitchRate : 0;
    }
    if ('verticalRate' in patch) {
      wheelVerticalRate = Number.isFinite(patch.verticalRate) ? patch.verticalRate : 0;
    }
    if ('forwardRate' in patch) {
      wheelForwardRate = Number.isFinite(patch.forwardRate) ? patch.forwardRate : 0;
    }
    if ('strafeRate' in patch) {
      wheelStrafeRate = Number.isFinite(patch.strafeRate) ? patch.strafeRate : 0;
    }
    if (
      Math.abs(wheelYawRate) > 1e-5 ||
      Math.abs(wheelPitchRate) > 1e-5 ||
      Math.abs(wheelVerticalRate) > 1e-5 ||
      Math.abs(wheelForwardRate) > 1e-5 ||
      Math.abs(wheelStrafeRate) > 1e-5
    ) {
      transition = null;
    }
  }

  function stepViewAngles(dYawDeg = 0, dPitchDeg = 0) {
    transition = null;
    if (typeof dYawDeg === 'number' && Number.isFinite(dYawDeg)) {
      targetYaw += THREE.MathUtils.degToRad(dYawDeg);
    }
    if (typeof dPitchDeg === 'number' && Number.isFinite(dPitchDeg)) {
      targetPitch = THREE.MathUtils.clamp(
        targetPitch + THREE.MathUtils.degToRad(dPitchDeg),
        MIN_PITCH,
        MAX_PITCH
      );
    }
  }

  function stepVertical(deltaY = 0) {
    if (typeof deltaY !== 'number' || !Number.isFinite(deltaY)) return;
    transition = null;
    if (mode === 'dive') {
      targetDivePos.y += deltaY;
      clampVerticalBounds(targetDivePos, latestEnvState);
    } else {
      targetOrbitTarget.y += deltaY;
      clampVerticalBounds(targetOrbitTarget, latestEnvState);
    }
  }

  function setVerticalFraction(frac01, envState) {
    if (typeof frac01 !== 'number' || !Number.isFinite(frac01)) return;
    transition = null;
    const f = THREE.MathUtils.clamp(frac01, 0, 1);
    const activeEnv = envState || latestEnvState;
    if (mode === 'dive') {
      const { minY, maxY, swimCeilingY } = getVerticalBounds(
        targetDivePos.x,
        targetDivePos.z,
        activeEnv
      );
      targetDivePos.y = THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(minY, swimCeilingY, f),
        minY,
        maxY
      );
    } else {
      const { minY, maxY, swimCeilingY } = getVerticalBounds(
        targetOrbitTarget.x,
        targetOrbitTarget.z,
        activeEnv
      );
      targetOrbitTarget.y = THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(minY, swimCeilingY, f),
        minY,
        maxY
      );
    }
  }

  function setViewAngles({ yawDeg, pitchDeg, rollDeg } = {}) {
    transition = null;
    if (typeof yawDeg === 'number' && Number.isFinite(yawDeg)) {
      const desiredYaw = -THREE.MathUtils.degToRad(yawDeg);
      targetYaw = currentYaw + shortestAngleDiff(currentYaw, desiredYaw);
    }
    if (typeof pitchDeg === 'number' && Number.isFinite(pitchDeg)) {
      targetPitch = THREE.MathUtils.clamp(
        THREE.MathUtils.degToRad(pitchDeg),
        MIN_PITCH,
        MAX_PITCH
      );
    }
    if (typeof rollDeg === 'number' && Number.isFinite(rollDeg)) {
      targetRoll = THREE.MathUtils.clamp(
        THREE.MathUtils.degToRad(rollDeg),
        MIN_ROLL,
        MAX_ROLL
      );
    }
  }

  function setFov(fovDeg) {
    if (typeof fovDeg !== 'number' || !Number.isFinite(fovDeg)) return;
    const clamped = THREE.MathUtils.clamp(fovDeg, MIN_FOV, MAX_FOV);
    if (Math.abs(camera.fov - clamped) > 1e-3) {
      camera.fov = clamped;
      camera.updateProjectionMatrix();
    }
  }

  function nudgePov(right = 0, up = 0, forward = 0) {
    transition = null;
    computeForward(targetYaw, targetPitch, _forward);
    computeRight(targetYaw, _right);
    _up.crossVectors(_right, _forward).normalize();

    _moveVec
      .set(0, 0, 0)
      .addScaledVector(_right, right)
      .addScaledVector(_up, up)
      .addScaledVector(_forward, forward);

    if (mode === 'dive') {
      targetDivePos.add(_moveVec);
      clampHorizontalRadius(targetDivePos);
      clampVerticalBounds(targetDivePos, latestEnvState);
    } else {
      targetOrbitTarget.add(_moveVec);
      clampHorizontalRadius(targetOrbitTarget);
      clampVerticalBounds(targetOrbitTarget, latestEnvState);
    }
  }

  function stepMove(forwardDelta = 0, strafeDelta = 0) {
    nudgePov(strafeDelta, 0, forwardDelta);
  }

  function isDragging() {
    if (isPointerDown) {
      return maxDragDist > DRAG_THRESHOLD_PX;
    }
    return lastGestureWasDrag && performance.now() - lastPointerUpTime < 300;
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.button !== 2) return;
    isPointerDown = true;
    activePointerId = e.pointerId;
    activeButton = e.button;
    activePan = e.button === 2 || (e.button === 0 && e.shiftKey);
    downX = e.clientX;
    downY = e.clientY;
    lastX = e.clientX;
    lastY = e.clientY;
    maxDragDist = 0;
    lastGestureWasDrag = false;
    transition = null;
    try {
      domElement.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable
    }
  }

  function onPointerMove(e) {
    if (!isPointerDown || (activePointerId !== null && e.pointerId !== activePointerId)) {
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    const totalDist = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (totalDist > maxDragDist) {
      maxDragDist = totalDist;
    }

    const usePan = activePan || (activeButton === 0 && e.shiftKey);
    if (!usePan && activeButton === 0) {
      const sensitivity = 0.0042;
      targetYaw -= dx * sensitivity;
      targetPitch = THREE.MathUtils.clamp(
        targetPitch - dy * sensitivity,
        MIN_PITCH,
        MAX_PITCH
      );
    } else if (usePan) {
      const panScale = mode === 'orbit' ? Math.max(0.004, targetDistance * 0.0011) : 0.012;
      computeForward(targetYaw, targetPitch, _forward);
      computeRight(targetYaw, _right);
      _up.crossVectors(_right, _forward).normalize();

      if (mode === 'orbit') {
        targetOrbitTarget.addScaledVector(_right, -dx * panScale);
        targetOrbitTarget.addScaledVector(_up, dy * panScale);
        clampHorizontalRadius(targetOrbitTarget);
      } else {
        targetDivePos.addScaledVector(_right, -dx * panScale);
        targetDivePos.addScaledVector(_up, dy * panScale);
        clampHorizontalRadius(targetDivePos);
        clampVerticalBounds(targetDivePos, latestEnvState);
      }
    }
  }

  function onPointerUp(e) {
    if (!isPointerDown) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;

    const totalDist = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (totalDist > maxDragDist) {
      maxDragDist = totalDist;
    }
    lastGestureWasDrag = maxDragDist > DRAG_THRESHOLD_PX;
    lastPointerUpTime = performance.now();
    isPointerDown = false;
    activePointerId = null;
    activePan = false;

    try {
      if (domElement.hasPointerCapture(e.pointerId)) {
        domElement.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
  }

  function onDoubleClick(e) {
    if (!domElement) return;
    const rect = domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    _ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(_ndc, camera);

    const surfaceCeiling =
      WORLD_CONSTANTS.SURFACE_BASE_Y + (latestEnvState?.diveDepth ?? 6.0) - 0.15;

    let hitPoint = null;
    const isValidRaycastHit = (h) => {
      if (!h || !h.object || !h.object.visible) return false;
      if (
        h.object.isInstancedMesh &&
        h.instanceId !== undefined &&
        h.instanceId >= h.object.count
      ) {
        return false;
      }
      return true;
    };

    if (pickableMeshes && pickableMeshes.length > 0) {
      const hits = raycaster.intersectObjects(pickableMeshes, true);
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (!isValidRaycastHit(h)) continue;
        if (h.distance > 0.35 && h.distance < 36) {
          hitPoint = h.point.clone();
          break;
        }
      }
    }

    if (!hitPoint && scene) {
      const hits = raycaster.intersectObjects(scene.children, true);
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (!isValidRaycastHit(h)) continue;
        if (
          h.distance > 0.35 &&
          h.distance < 36 &&
          !h.object.isPoints &&
          !h.object.material?.transparent &&
          h.point.y < surfaceCeiling
        ) {
          hitPoint = h.point.clone();
          break;
        }
      }
    }

    const startPos = getLogicalCamPos(new THREE.Vector3());

    if (hitPoint) {
      const toTarget = hitPoint.clone().sub(startPos);
      const dist = toTarget.length();
      if (dist > 1e-4) {
        toTarget.divideScalar(dist);
        const travel = Math.max(0, dist - 2.0);
        const destPos = startPos.clone().addScaledVector(toTarget, travel);
        clampHorizontalRadius(destPos);
        clampVerticalBounds(destPos, latestEnvState);
        const pose = poseFromPoints(destPos, hitPoint);
        pose.roll = currentRoll;
        startTransition(pose, 0.55);
        return;
      }
    }

    // Open water fallback: step 4.5m forward along the click view ray
    const rayDir = raycaster.ray.direction.clone().normalize();
    const destPos = startPos.clone().addScaledVector(rayDir, 4.5);
    clampHorizontalRadius(destPos);
    clampVerticalBounds(destPos, latestEnvState);
    const lookAt = destPos.clone().addScaledVector(rayDir, 8.0);
    const pose = poseFromPoints(destPos, lookAt);
    pose.roll = currentRoll;
    startTransition(pose, 0.5);
  }

  function onWheel(e) {
    e.preventDefault();
    transition = null;
    if (mode === 'orbit') {
      const factor = Math.exp(e.deltaY * 0.0011);
      targetDistance = THREE.MathUtils.clamp(targetDistance * factor, MIN_DISTANCE, MAX_DISTANCE);
    } else {
      computeForward(targetYaw, targetPitch, _forward);
      targetDivePos.addScaledVector(_forward, -e.deltaY * 0.012);
      clampHorizontalRadius(targetDivePos);
      clampVerticalBounds(targetDivePos, latestEnvState);
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  function onKeyDown(e) {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const code = e.code;
    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    if (code === 'KeyR') {
      targetRoll = 0;
      return;
    }

    pressedKeys.add(code);
    if (
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'KeyE' ||
      code === 'KeyQ' ||
      code === 'KeyC' ||
      code === 'Space' ||
      code === 'ShiftLeft' ||
      code === 'ShiftRight' ||
      code.startsWith('Arrow')
    ) {
      transition = null;
    }
  }

  function onKeyUp(e) {
    pressedKeys.delete(e.code);
  }

  function onBlur() {
    pressedKeys.clear();
    isPointerDown = false;
    activePointerId = null;
    activePan = false;
    wheelYawRate = 0;
    wheelPitchRate = 0;
    wheelVerticalRate = 0;
    wheelForwardRate = 0;
    wheelStrafeRate = 0;
  }

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('dblclick', onDoubleClick);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  function update(elapsedTime, deltaTime, envState) {
    if (envState) {
      latestEnvState = envState;
    }
    const dt = Math.min(Math.max(deltaTime || 0.016, 0.0001), 0.05);

    if (transition) {
      transition.elapsed += dt;
      const rawT = Math.min(1, transition.elapsed / transition.duration);
      const t = easeInOutCubic(rawT);
      const end = transition.endPose;

      currentYaw = lerpAngle(transition.startYaw, end.yaw, t);
      currentPitch = THREE.MathUtils.lerp(transition.startPitch, end.pitch, t);
      currentRoll = THREE.MathUtils.lerp(transition.startRoll, end.roll ?? 0, t);
      targetYaw = currentYaw;
      targetPitch = currentPitch;
      targetRoll = currentRoll;

      currentDistance = THREE.MathUtils.lerp(transition.startDistance, end.distance, t);
      targetDistance = currentDistance;

      currentOrbitTarget.lerpVectors(transition.startOrbitTarget, end.lookTarget, t);
      targetOrbitTarget.copy(currentOrbitTarget);

      currentDivePos.lerpVectors(transition.startCamPos, end.camPos, t);
      targetDivePos.copy(currentDivePos);

      if (rawT >= 1) {
        transition = null;
      }
    } else {
      _moveVec.set(0, 0, 0);
      computeForward(targetYaw, targetPitch, _forward);
      computeRight(targetYaw, _right);

      if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) {
        _moveVec.add(_forward);
      }
      if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) {
        _moveVec.sub(_forward);
      }
      if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) {
        _moveVec.add(_right);
      }
      if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) {
        _moveVec.sub(_right);
      }
      if (pressedKeys.has('KeyE') || pressedKeys.has('Space')) {
        _moveVec.y += 1;
      }
      if (
        pressedKeys.has('KeyQ') ||
        pressedKeys.has('KeyC') ||
        pressedKeys.has('ShiftLeft') ||
        pressedKeys.has('ShiftRight')
      ) {
        _moveVec.y -= 1;
      }

      if (_moveVec.lengthSq() > 1e-6) {
        _moveVec.normalize();
        const swimSpeed = 6.5;
        if (mode === 'orbit') {
          targetOrbitTarget.addScaledVector(_moveVec, swimSpeed * dt);
          clampHorizontalRadius(targetOrbitTarget);
        } else {
          targetDivePos.addScaledVector(_moveVec, swimSpeed * dt);
          clampHorizontalRadius(targetDivePos);
          clampVerticalBounds(targetDivePos, envState);
        }
      }

      if (
        Math.abs(wheelYawRate) > 1e-5 ||
        Math.abs(wheelPitchRate) > 1e-5 ||
        Math.abs(wheelVerticalRate) > 1e-5
      ) {
        targetYaw += wheelYawRate * dt;
        targetPitch = THREE.MathUtils.clamp(
          targetPitch + wheelPitchRate * dt,
          MIN_PITCH,
          MAX_PITCH
        );
        if (Math.abs(wheelVerticalRate) > 1e-5) {
          if (mode === 'dive') {
            targetDivePos.y += wheelVerticalRate * dt;
            clampVerticalBounds(targetDivePos, envState);
          } else {
            targetOrbitTarget.y += wheelVerticalRate * dt;
            clampVerticalBounds(targetOrbitTarget, envState);
          }
        }
      }

      if (Math.abs(wheelForwardRate) > 1e-5 || Math.abs(wheelStrafeRate) > 1e-5) {
        computeForward(targetYaw, targetPitch, _forward);
        computeRight(targetYaw, _right);
        _moveVec
          .set(0, 0, 0)
          .addScaledVector(_forward, wheelForwardRate * dt)
          .addScaledVector(_right, wheelStrafeRate * dt);
        if (mode === 'dive') {
          targetDivePos.add(_moveVec);
          clampHorizontalRadius(targetDivePos);
          clampVerticalBounds(targetDivePos, envState);
        } else {
          targetOrbitTarget.add(_moveVec);
          clampHorizontalRadius(targetOrbitTarget);
          clampVerticalBounds(targetOrbitTarget, envState);
        }
      }

      const damp = 1 - Math.exp(-12.0 * dt);
      currentYaw = lerpAngle(currentYaw, targetYaw, damp);
      currentPitch = THREE.MathUtils.lerp(currentPitch, targetPitch, damp);
      currentRoll = THREE.MathUtils.lerp(currentRoll, targetRoll, damp);
      currentDistance = THREE.MathUtils.lerp(currentDistance, targetDistance, damp);
      currentOrbitTarget.lerp(targetOrbitTarget, damp);
      currentDivePos.lerp(targetDivePos, damp);
    }

    getLogicalCamPos(_desiredPos);
    clampHorizontalRadius(_desiredPos);
    clampVerticalBounds(_desiredPos, envState);

    if (mode === 'dive') {
      currentDivePos.y = _desiredPos.y;
      clampVerticalBounds(targetDivePos, envState);
    }

    // Gentle non-destructive Buoyancy Drift + depth-attenuated orbital wave surge
    const waveInt = THREE.MathUtils.clamp(
      envState?.waveIntensity ?? latestEnvState?.waveIntensity ?? 0.28,
      0,
      1
    );
    const camDepth = Math.max(
      0,
      WORLD_CONSTANTS.SURFACE_BASE_Y + (envState?.diveDepth ?? latestEnvState?.diveDepth ?? 6.0) - _desiredPos.y
    );
    const surgeAtten = Math.exp(-camDepth * 0.22) * waveInt;
    const surgePhase = elapsedTime * 1.25;

    const breathY =
      Math.sin(elapsedTime * 0.85) * 0.045 +
      Math.sin(elapsedTime * 1.43 + 0.8) * 0.015 +
      Math.sin(surgePhase) * 0.06 * surgeAtten;
    const swayX =
      Math.sin(elapsedTime * 0.42) * 0.03 +
      Math.cos(elapsedTime * 0.71) * 0.015 +
      Math.sin(elapsedTime * 0.92 + 0.7) * 0.04 * surgeAtten;
    const swayZ =
      Math.cos(elapsedTime * 0.37 + 1.1) * 0.025 +
      Math.cos(surgePhase) * 0.08 * surgeAtten;

    camera.position.set(
      _desiredPos.x + swayX,
      _desiredPos.y + breathY,
      _desiredPos.z + swayZ
    );
    clampVerticalBounds(camera.position, envState);

    camera.rotation.set(currentPitch, currentYaw, currentRoll, 'YXZ');
  }

  function dispose() {
    domElement.removeEventListener('pointerdown', onPointerDown);
    domElement.removeEventListener('dblclick', onDoubleClick);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    domElement.removeEventListener('wheel', onWheel);
    domElement.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  }

  return {
    update,
    setPreset,
    setMode,
    getMode,
    getViewFrame,
    setViewAngles,
    setFov,
    nudgePov,
    setWheelRates,
    stepViewAngles,
    stepVertical,
    stepMove,
    setVerticalFraction,
    isDragging,
    dispose,
  };
}
