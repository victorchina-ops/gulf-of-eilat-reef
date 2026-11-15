import * as THREE from 'three';
import { WORLD_CONSTANTS, getSeabedHeight as defaultGetSeabedHeight } from '../contracts.js';
import { avoidBommiesXZ } from '../entities/utils.js';
import { TOUR_LAP_SECONDS, createReefTourSystem } from './reefTourTrail.js';

const MIN_PITCH = THREE.MathUtils.degToRad(-89);
const MAX_PITCH = THREE.MathUtils.degToRad(89);
const MIN_ROLL = THREE.MathUtils.degToRad(-30);
const MAX_ROLL = THREE.MathUtils.degToRad(30);
const MIN_FOV = 40;
const MAX_FOV = 115;
const MIN_DISTANCE = 1.4;
const MAX_DISTANCE = 36.0;
const DRAG_THRESHOLD_PX = 5;
const PRESET_DURATION_SEC = 0.6;
const BOMMY_CAMERA_MARGIN_M = 0.45;

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _diveVel = new THREE.Vector3();
const _desiredPos = new THREE.Vector3();
const _ndc = new THREE.Vector2();

function isTextInputTarget(el) {
  if (!el || typeof el !== 'object') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const inputType = String(el.type || 'text').toLowerCase();
    return (
      inputType !== 'range' &&
      inputType !== 'button' &&
      inputType !== 'checkbox' &&
      inputType !== 'radio' &&
      inputType !== 'submit' &&
      inputType !== 'reset'
    );
  }
  return false;
}

function blurControlFocus() {
  if (typeof document === 'undefined') return;
  const active = document.activeElement;
  if (!active || active === document.body || isTextInputTarget(active)) return;
  const tag = active.tagName;
  if (tag === 'INPUT' || tag === 'BUTTON') {
    active.blur?.();
  }
}

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
  const getSubstrateHeight = options.getSubstrateHeight || getSeabedHeight;
  const bommies = Array.isArray(options.bommies) ? options.bommies : [];
  const scene = options.scene || null;
  const pickableMeshes = options.pickableMeshes || null;
  const resolvePresetPose = typeof options.resolvePresetPose === 'function' ? options.resolvePresetPose : null;

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
  let shiftHeld = false;
  const raycaster = new THREE.Raycaster();

  // Animated transition & dynamic subject-tracking state
  let transition = null;
  let activeTrackPreset = null;
  let baseFov = THREE.MathUtils.clamp(camera.fov || 60, MIN_FOV, MAX_FOV);
  let manualFovOverride = false;

  // Continuous side-wheel control rates
  let wheelYawRate = 0;
  let wheelPitchRate = 0;
  let wheelVerticalRate = 0;
  let wheelForwardRate = 0;
  let wheelStrafeRate = 0;

  // Free-Ride Reef Tour state
  const TOUR_JOIN_DURATION_SEC = 1.1;
  const tourSystem = createReefTourSystem({ getSeabedHeight, scene });
  let tourActive = false;
  let tourEverStarted = false;
  let tourProgressTouched = false;
  let tourPauseReason = 'idle';
  let tourProgress = 0;
  let tourSpeed = 1.0;
  let tourYawOffset = 0;
  let tourPitchOffset = 0;
  let tourJoinElapsed = TOUR_JOIN_DURATION_SEC;
  const tourJoinStartPos = new THREE.Vector3();
  let tourJoinStartYaw = 0;
  let tourJoinStartPitch = 0;
  let tourJoinStartRoll = 0;
  let lastElapsedTime = 0;
  let tourZoneName = tourSystem.sampleTourPose(0, getVerticalBounds, latestEnvState).zoneName;

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
    const substrateY = getSubstrateHeight(x, z);
    const floorY = Number.isFinite(substrateY) ? Math.max(seabedY, substrateY) : seabedY;
    const minY = floorY + 0.5;
    const surfaceBuffer = 0.5 + waveInt * 0.48;
    const maxY = Math.max(minY + 0.1, surfaceY - surfaceBuffer);
    const swimCeilingY = Math.max(minY + 0.1, Math.min(maxY, seabedY + 8.5));
    return { minY, maxY, seabedY, substrateY: floorY, swimCeilingY };
  }

  function clampVerticalBounds(pos, envState) {
    const { minY, maxY } = getVerticalBounds(pos.x, pos.z, envState);
    pos.y = THREE.MathUtils.clamp(pos.y, minY, maxY);
    return { minY, maxY };
  }

  function startTransition(targetPose, durationSec = PRESET_DURATION_SEC, presetName = null) {
    const startCamPos = getLogicalCamPos(new THREE.Vector3());
    const startOrbitTarget = currentOrbitTarget.clone();
    activeTrackPreset =
      presetName === 'ribbontail-ray' || presetName === 'sea-turtle' ? presetName : null;

    transition = {
      elapsed: 0,
      duration: durationSec,
      presetName,
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

    if (nextMode === 'orbit' && tourActive) {
      pauseTour('manual');
    }

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

  function startTour({ fromStart = false } = {}) {
    const isFirstStart = !tourEverStarted;
    if (mode === 'orbit') {
      const pos = getLogicalCamPos(_desiredPos);
      currentDivePos.copy(pos);
      targetDivePos.copy(pos);
      mode = 'dive';
    }

    transition = null;
    activeTrackPreset = null;
    wheelVerticalRate = 0;
    wheelForwardRate = 0;
    wheelStrafeRate = 0;

    if (fromStart || (!tourEverStarted && !tourProgressTouched)) {
      tourProgress = 0;
    } else {
      const currentPos = getLogicalCamPos(_desiredPos);
      const resumePose = tourSystem.sampleTourPose(
        tourProgress,
        getVerticalBounds,
        latestEnvState
      );
      if (currentPos.distanceTo(resumePose.camPos) > 2.2) {
        const nearest = tourSystem.findNearestTourProgress(currentPos);
        tourProgress = nearest.progress;
      }
    }

    if (isFirstStart) {
      tourSystem.setTrailVisible(true);
    }

    tourEverStarted = true;
    tourProgressTouched = true;
    tourActive = true;
    tourPauseReason = null;
    tourYawOffset = 0;
    tourPitchOffset = 0;

    tourJoinStartPos.copy(currentDivePos);
    tourJoinStartYaw = currentYaw;
    tourJoinStartPitch = currentPitch;
    tourJoinStartRoll = currentRoll;
    tourJoinElapsed = 0;

    const pose = tourSystem.sampleTourPose(tourProgress, getVerticalBounds, latestEnvState);
    tourZoneName = pose.zoneName;
    tourSystem.updateTrailVisual(lastElapsedTime, tourProgress);
  }

  function pauseTour(reason = 'paused') {
    if (!tourActive) return;
    tourActive = false;
    tourPauseReason = reason || 'paused';
    tourYawOffset = 0;
    tourPitchOffset = 0;
    tourJoinElapsed = TOUR_JOIN_DURATION_SEC;
    targetDivePos.copy(currentDivePos);
    targetYaw = currentYaw;
    targetPitch = currentPitch;
    targetRoll = 0;
  }

  function toggleTour() {
    if (tourActive) {
      pauseTour('paused');
    } else {
      startTour();
    }
    return tourActive;
  }

  function restartTour() {
    startTour({ fromStart: true });
  }

  function setTourProgress(u01) {
    if (typeof u01 !== 'number' || !Number.isFinite(u01)) return;
    tourProgress = u01 >= 0 && u01 <= 1 ? u01 : ((u01 % 1) + 1) % 1;
    tourProgressTouched = true;
    const pose = tourSystem.sampleTourPose(tourProgress, getVerticalBounds, latestEnvState);
    tourZoneName = pose.zoneName;
    tourSystem.updateTrailVisual(lastElapsedTime, tourProgress);

    if (!tourActive) {
      if (mode === 'orbit') {
        const pos = getLogicalCamPos(_desiredPos);
        currentDivePos.copy(pos);
        targetDivePos.copy(pos);
        mode = 'dive';
      }
      transition = null;
      activeTrackPreset = null;
      targetDivePos.copy(pose.camPos);
      targetYaw = currentYaw + shortestAngleDiff(currentYaw, pose.yaw);
      targetPitch = pose.pitch;
      targetRoll = 0;
      if (!tourEverStarted) {
        tourPauseReason = 'scrubbed';
      }
    } else {
      tourJoinElapsed = TOUR_JOIN_DURATION_SEC;
    }
  }

  function setTourSpeed(mult) {
    if (typeof mult !== 'number' || !Number.isFinite(mult)) return;
    tourSpeed = THREE.MathUtils.clamp(mult, 0.25, 3.0);
  }

  function setTourTrailVisible(bool) {
    tourSystem.setTrailVisible(Boolean(bool));
  }

  function getTourState() {
    return {
      active: tourActive,
      everStarted: tourEverStarted,
      pauseReason: tourPauseReason,
      progress: tourProgress,
      speed: tourSpeed,
      zoneName: tourZoneName,
      trailVisible: tourSystem.isTrailVisible(),
    };
  }

  function setPreset(name) {
    if (tourActive) pauseTour('manual');
    manualFovOverride = false;
    baseFov = 60;
    let targetPose;
    if (name === 'snells-window') {
      const pitch = THREE.MathUtils.degToRad(88);
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
    } else {
      const resolved = resolvePresetPose ? resolvePresetPose(name) : null;
      if (resolved && resolved.camPos && resolved.lookTarget) {
        targetPose = poseFromPoints(resolved.camPos, resolved.lookTarget);
      } else if (name === 'anemone-closeup') {
        targetPose = poseFromPoints(
          new THREE.Vector3(-0.20, 1.45, 8.95),
          new THREE.Vector3(-1.45, 0.72, 7.25)
        );
      } else if (name === 'sandy-channel' || name === 'ribbontail-ray') {
        targetPose = poseFromPoints(
          new THREE.Vector3(0.45, 1.05, 8.20),
          new THREE.Vector3(1.65, -1.55, 4.20)
        );
      } else if (name === 'sea-turtle') {
        targetPose = poseFromPoints(
          new THREE.Vector3(1.25, 2.35, 7.90),
          new THREE.Vector3(-0.55, 1.65, 5.75)
        );
      } else if (name === 'moray-crevice') {
        targetPose = poseFromPoints(
          new THREE.Vector3(0.45, 1.35, 8.35),
          new THREE.Vector3(-0.95, 0.95, 6.45)
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
        const stFloor = getSeabedHeight(4.15, 4.15);
        const camFloor = getSeabedHeight(2.65, 6.05);
        targetPose = poseFromPoints(
          new THREE.Vector3(2.65, Math.max(camFloor + 0.85, stFloor + 2.35), 6.05),
          new THREE.Vector3(4.15, stFloor + 1.85, 4.15)
        );
      } else {
        // 'reef' default panoramic view
        targetPose = poseFromPoints(
          new THREE.Vector3(0, 2.6, 12.2),
          new THREE.Vector3(0, 0.6, -2.0)
        );
      }
    }

    startTransition(targetPose, PRESET_DURATION_SEC, name);
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
    const hasMoveRate =
      Math.abs(wheelVerticalRate) > 1e-5 ||
      Math.abs(wheelForwardRate) > 1e-5 ||
      Math.abs(wheelStrafeRate) > 1e-5;
    const hasLookRate =
      Math.abs(wheelYawRate) > 1e-5 ||
      Math.abs(wheelPitchRate) > 1e-5;

    if (tourActive && hasMoveRate) {
      pauseTour('manual');
    }
    if (hasMoveRate || hasLookRate) {
      activeTrackPreset = null;
    }
    if (!tourActive && (hasMoveRate || hasLookRate)) {
      transition = null;
    }
  }

  function stepViewAngles(dYawDeg = 0, dPitchDeg = 0) {
    if (tourActive) {
      if (typeof dYawDeg === 'number' && Number.isFinite(dYawDeg)) {
        tourYawOffset += THREE.MathUtils.degToRad(dYawDeg);
      }
      if (typeof dPitchDeg === 'number' && Number.isFinite(dPitchDeg)) {
        tourPitchOffset = THREE.MathUtils.clamp(
          tourPitchOffset + THREE.MathUtils.degToRad(dPitchDeg),
          -1.35,
          1.35
        );
      }
      return;
    }
    activeTrackPreset = null;
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
    if (tourActive) pauseTour('manual');
    activeTrackPreset = null;
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
    if (tourActive) pauseTour('manual');
    activeTrackPreset = null;
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
    if (tourActive) {
      const pose = tourSystem.sampleTourPose(tourProgress, getVerticalBounds, latestEnvState);
      if (typeof yawDeg === 'number' && Number.isFinite(yawDeg)) {
        const desiredYaw = -THREE.MathUtils.degToRad(yawDeg);
        tourYawOffset = shortestAngleDiff(pose.yaw, desiredYaw);
      }
      if (typeof pitchDeg === 'number' && Number.isFinite(pitchDeg)) {
        const desiredPitch = THREE.MathUtils.clamp(
          THREE.MathUtils.degToRad(pitchDeg),
          MIN_PITCH,
          MAX_PITCH
        );
        tourPitchOffset = THREE.MathUtils.clamp(desiredPitch - pose.pitch, -1.35, 1.35);
      }
      return;
    }
    activeTrackPreset = null;
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
    baseFov = clamped;
    manualFovOverride = true;
    if (Math.abs(camera.fov - clamped) > 1e-3) {
      camera.fov = clamped;
      camera.updateProjectionMatrix();
    }
  }

  function nudgePov(right = 0, up = 0, forward = 0) {
    if (tourActive) pauseTour('manual');
    activeTrackPreset = null;
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

  function syncModifierState(e) {
    if (!e || typeof e !== 'object') return;
    const hasShift = Boolean(e.shiftKey);
    shiftHeld = hasShift;
    if (!hasShift) {
      pressedKeys.delete('ShiftLeft');
      pressedKeys.delete('ShiftRight');
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.button !== 2) return;
    blurControlFocus();
    syncModifierState(e);
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
    if (!tourActive) {
      transition = null;
    }
    try {
      domElement.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable
    }
  }

  function onPointerMove(e) {
    syncModifierState(e);
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
    if (maxDragDist > DRAG_THRESHOLD_PX && !tourActive) {
      activeTrackPreset = null;
    }

    const usePan = activePan || (activeButton === 0 && e.shiftKey);
    if (!usePan && activeButton === 0) {
      const sensitivity = 0.0042;
      if (tourActive) {
        tourYawOffset -= dx * sensitivity;
        tourPitchOffset = THREE.MathUtils.clamp(
          tourPitchOffset - dy * sensitivity,
          -1.35,
          1.35
        );
      } else {
        targetYaw -= dx * sensitivity;
        targetPitch = THREE.MathUtils.clamp(
          targetPitch - dy * sensitivity,
          MIN_PITCH,
          MAX_PITCH
        );
      }
    } else if (usePan) {
      if (tourActive) {
        pauseTour('manual');
      }
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
        avoidBommiesXZ(targetDivePos, null, bommies, BOMMY_CAMERA_MARGIN_M, 0.016);
        clampHorizontalRadius(targetDivePos);
        clampVerticalBounds(targetDivePos, latestEnvState);
      }
    }
  }

  function onPointerUp(e) {
    syncModifierState(e);
    if (!isPointerDown) return;
    if (activePointerId !== null && e.pointerId !== activePointerId) return;

    const totalDist = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (totalDist > maxDragDist) {
      maxDragDist = totalDist;
    }
    if (maxDragDist > DRAG_THRESHOLD_PX && !tourActive) {
      activeTrackPreset = null;
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
    if (tourActive) pauseTour('manual');
    activeTrackPreset = null;
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
    if (tourActive) pauseTour('manual');
    activeTrackPreset = null;
    transition = null;
    if (mode === 'orbit') {
      const factor = Math.exp(e.deltaY * 0.0011);
      targetDistance = THREE.MathUtils.clamp(targetDistance * factor, MIN_DISTANCE, MAX_DISTANCE);
    } else {
      computeForward(targetYaw, targetPitch, _forward);
      targetDivePos.addScaledVector(_forward, -e.deltaY * 0.012);
      avoidBommiesXZ(targetDivePos, null, bommies, BOMMY_CAMERA_MARGIN_M, 0.016);
      clampHorizontalRadius(targetDivePos);
      clampVerticalBounds(targetDivePos, latestEnvState);
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    if (isTextInputTarget(e.target) || isTextInputTarget(activeEl)) return;

    const code = e.code;
    if (code === 'Escape') {
      blurControlFocus();
      return;
    }

    const isNavigationKey =
      code === 'Space' ||
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'KeyE' ||
      code === 'KeyQ' ||
      code === 'KeyC' ||
      code === 'KeyR' ||
      code === 'ShiftLeft' ||
      code === 'ShiftRight' ||
      code.startsWith('Arrow');

    if (isNavigationKey) {
      blurControlFocus();
    }

    if (
      code === 'Space' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight'
    ) {
      e.preventDefault();
    }

    syncModifierState(e);

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
      if (tourActive) pauseTour('manual');
      activeTrackPreset = null;
      transition = null;
    }
  }

  function onKeyUp(e) {
    pressedKeys.delete(e.code);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || !e.shiftKey) {
      if (!e.shiftKey) {
        pressedKeys.delete('ShiftLeft');
        pressedKeys.delete('ShiftRight');
      }
    }
    syncModifierState(e);
  }

  function onBlur() {
    pressedKeys.clear();
    shiftHeld = false;
    isPointerDown = false;
    activePointerId = null;
    activePan = false;
    wheelYawRate = 0;
    wheelPitchRate = 0;
    wheelVerticalRate = 0;
    wheelForwardRate = 0;
    wheelStrafeRate = 0;
  }

  function onVisibilityChange() {
    if (typeof document !== 'undefined' && document.hidden) {
      onBlur();
    }
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
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function update(elapsedTime, deltaTime, envState) {
    if (envState) {
      latestEnvState = envState;
    }
    if (Number.isFinite(elapsedTime)) {
      lastElapsedTime = elapsedTime;
    }
    const dt = Math.min(Math.max(deltaTime || 0.016, 0.0001), 0.05);

    if (tourActive) {
      transition = null;
      tourProgress = (tourProgress + (dt * tourSpeed) / TOUR_LAP_SECONDS) % 1;
      const activeEnv = envState || latestEnvState;
      const pose = tourSystem.sampleTourPose(tourProgress, getVerticalBounds, activeEnv);
      tourZoneName = pose.zoneName;

      const isLookDragging = isPointerDown && !activePan && activeButton === 0;
      const hasWheelLook =
        Math.abs(wheelYawRate) > 1e-5 || Math.abs(wheelPitchRate) > 1e-5;

      if (hasWheelLook) {
        tourYawOffset += wheelYawRate * dt;
        tourPitchOffset = THREE.MathUtils.clamp(
          tourPitchOffset + wheelPitchRate * dt,
          -1.35,
          1.35
        );
      } else if (!isLookDragging) {
        const decay = Math.exp(-1.6 * dt);
        tourYawOffset = shortestAngleDiff(0, tourYawOffset) * decay;
        tourPitchOffset *= decay;
      }

      const desiredYaw = pose.yaw + tourYawOffset;
      const desiredPitch = THREE.MathUtils.clamp(
        pose.pitch + tourPitchOffset,
        MIN_PITCH,
        MAX_PITCH
      );
      const desiredRoll = pose.roll;

      if (tourJoinElapsed < TOUR_JOIN_DURATION_SEC) {
        tourJoinElapsed = Math.min(TOUR_JOIN_DURATION_SEC, tourJoinElapsed + dt);
        const joinT = easeInOutCubic(tourJoinElapsed / TOUR_JOIN_DURATION_SEC);
        currentDivePos.lerpVectors(tourJoinStartPos, pose.camPos, joinT);
        currentYaw = lerpAngle(tourJoinStartYaw, desiredYaw, joinT);
        currentPitch = THREE.MathUtils.lerp(tourJoinStartPitch, desiredPitch, joinT);
        currentRoll = THREE.MathUtils.lerp(tourJoinStartRoll, desiredRoll, joinT);
      } else {
        currentDivePos.copy(pose.camPos);
        const rotDamp = 1 - Math.exp(-16.0 * dt);
        currentYaw = lerpAngle(currentYaw, desiredYaw, rotDamp);
        currentPitch = THREE.MathUtils.lerp(currentPitch, desiredPitch, rotDamp);
        currentRoll = THREE.MathUtils.lerp(currentRoll, desiredRoll, rotDamp);
      }

      targetDivePos.copy(currentDivePos);
      targetYaw = currentYaw;
      targetPitch = currentPitch;
      targetRoll = currentRoll;
    } else if (transition) {
      transition.elapsed += dt;
      const rawT = Math.min(1, transition.elapsed / transition.duration);
      const t = easeInOutCubic(rawT);
      if (transition.presetName && resolvePresetPose) {
        const fresh = resolvePresetPose(transition.presetName);
        if (fresh?.camPos && fresh?.lookTarget) {
          transition.endPose = poseFromPoints(fresh.camPos, fresh.lookTarget);
        }
      }
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
      _diveVel.set(0, 0, 0);
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
        pressedKeys.has('ShiftRight') ||
        (shiftHeld && !isPointerDown)
      ) {
        _moveVec.y -= 1;
      }

      if (_moveVec.lengthSq() > 1e-6) {
        activeTrackPreset = null;
        _moveVec.normalize();
        const swimSpeed = 6.5;
        _diveVel.copy(_moveVec).multiplyScalar(swimSpeed);
        if (mode === 'orbit') {
          targetOrbitTarget.addScaledVector(_diveVel, dt);
          clampHorizontalRadius(targetOrbitTarget);
        } else {
          targetDivePos.addScaledVector(_diveVel, dt);
          avoidBommiesXZ(targetDivePos, _diveVel, bommies, BOMMY_CAMERA_MARGIN_M, dt);
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
            avoidBommiesXZ(targetDivePos, _diveVel, bommies, BOMMY_CAMERA_MARGIN_M, dt);
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
          .addScaledVector(_forward, wheelForwardRate)
          .addScaledVector(_right, wheelStrafeRate);
        _diveVel.add(_moveVec);
        if (mode === 'dive') {
          targetDivePos.addScaledVector(_moveVec, dt);
          avoidBommiesXZ(targetDivePos, _diveVel, bommies, BOMMY_CAMERA_MARGIN_M, dt);
          clampHorizontalRadius(targetDivePos);
          clampVerticalBounds(targetDivePos, envState);
        } else {
          targetOrbitTarget.addScaledVector(_moveVec, dt);
          clampHorizontalRadius(targetOrbitTarget);
          clampVerticalBounds(targetOrbitTarget, envState);
        }
      }

      if (
        activeTrackPreset &&
        resolvePresetPose &&
        _moveVec.lengthSq() < 1e-6 &&
        !isPointerDown &&
        Math.abs(wheelYawRate) <= 1e-5 &&
        Math.abs(wheelPitchRate) <= 1e-5 &&
        Math.abs(wheelVerticalRate) <= 1e-5 &&
        Math.abs(wheelForwardRate) <= 1e-5 &&
        Math.abs(wheelStrafeRate) <= 1e-5
      ) {
        const fresh = resolvePresetPose(activeTrackPreset);
        if (fresh?.camPos && fresh?.lookTarget) {
          const fp = poseFromPoints(fresh.camPos, fresh.lookTarget);
          targetDivePos.lerp(fp.camPos, Math.min(1, dt * 6.0));
          targetOrbitTarget.lerp(fp.lookTarget, Math.min(1, dt * 6.0));
          targetYaw = currentYaw + shortestAngleDiff(currentYaw, fp.yaw);
          targetPitch = fp.pitch;
        }
      }

      const damp = 1 - Math.exp(-12.0 * dt);
      currentYaw = lerpAngle(currentYaw, targetYaw, damp);
      currentPitch = THREE.MathUtils.lerp(currentPitch, targetPitch, damp);
      currentRoll = THREE.MathUtils.lerp(currentRoll, targetRoll, damp);
      currentDistance = THREE.MathUtils.lerp(currentDistance, targetDistance, damp);
      currentOrbitTarget.lerp(targetOrbitTarget, damp);
      currentDivePos.lerp(targetDivePos, damp);
      if (mode === 'dive') {
        avoidBommiesXZ(currentDivePos, _diveVel, bommies, BOMMY_CAMERA_MARGIN_M, dt);
      }
    }

    if (tourActive || transition) {
      _diveVel.set(0, 0, 0);
    }

    getLogicalCamPos(_desiredPos);
    if (!tourActive) {
      avoidBommiesXZ(_desiredPos, _diveVel, bommies, BOMMY_CAMERA_MARGIN_M, dt);
    }
    clampHorizontalRadius(_desiredPos);
    clampVerticalBounds(_desiredPos, envState);

    if (mode === 'dive') {
      currentDivePos.x = _desiredPos.x;
      currentDivePos.y = _desiredPos.y;
      currentDivePos.z = _desiredPos.z;
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
    if (!tourActive) {
      avoidBommiesXZ(camera.position, _diveVel, bommies, BOMMY_CAMERA_MARGIN_M, dt);
    }
    clampVerticalBounds(camera.position, envState);

    camera.rotation.set(currentPitch, currentYaw, currentRoll, 'YXZ');
    if (!manualFovOverride) {
      const pitchDegNow = THREE.MathUtils.radToDeg(currentPitch);
      const zenithT = THREE.MathUtils.smoothstep(pitchDegNow, 42, 86);
      const targetZenithFov = THREE.MathUtils.lerp(baseFov, Math.max(baseFov, 108), zenithT);
      if (Math.abs(camera.fov - targetZenithFov) > 0.02) {
        camera.fov = targetZenithFov;
        camera.updateProjectionMatrix();
      }
    }
    tourSystem.updateTrailVisual(lastElapsedTime, tourProgress);
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
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    tourSystem.dispose();
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
    startTour,
    pauseTour,
    toggleTour,
    restartTour,
    setTourProgress,
    setTourSpeed,
    setTourTrailVisible,
    getTourState,
    dispose,
  };
}
