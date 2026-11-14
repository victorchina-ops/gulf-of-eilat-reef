import * as THREE from 'three';
import { getSeabedHeight as defaultGetSeabedHeight } from '../contracts.js';

export const TOUR_LAP_SECONDS = 76;

export const TOUR_WAYPOINTS = [
  { x: 0.4, yOffset: 2.55, z: 11.2, lookX: -0.6, lookYOffset: 1.05, lookZ: 5.2, zone: 'Sunlit Coral Garden' },
  { x: 1.2, yOffset: 1.55, z: 7.6, lookX: -1.6, lookYOffset: 1.10, lookZ: 5.2, zone: 'Anemone & Clownfish Pinnacle' },
  { x: 2.55, yOffset: 1.40, z: 6.65, lookX: 1.75, lookYOffset: 0.85, lookZ: 4.55, zone: 'Labroides Cleaning Station' },
  { x: 8.9, yOffset: 1.95, z: 2.8, lookX: 4.8, lookYOffset: 0.95, lookZ: 1.8, zone: 'Eastern Acropora Terrace' },
  { x: 9.2, yOffset: 1.75, z: -1.8, lookX: 4.2, lookYOffset: 0.80, lookZ: 0.2, zone: 'Undercut Moray Ledge' },
  { x: 8.8, yOffset: 2.35, z: -7.2, lookX: 2.0, lookYOffset: 0.65, lookZ: -11.2, zone: 'Eastern Spur & Fusiliers' },
  { x: 0.4, yOffset: 2.65, z: -14.8, lookX: -0.4, lookYOffset: 0.45, lookZ: -21.5, zone: 'Fore-Reef Drop-Off Wall' },
  { x: 1.45, yOffset: 1.80, z: -7.8, lookX: 0.5, lookYOffset: 1.40, lookZ: -2.5, zone: 'Central Reef Canyon' },
  { x: 0.65, yOffset: 1.45, z: -3.4, lookX: -1.2, lookYOffset: 0.75, lookZ: 1.2, zone: 'Sandy Ray Channel' },
  { x: 0.95, yOffset: 2.50, z: 1.35, lookX: -2.0, lookYOffset: 1.05, lookZ: 1.8, zone: 'Natural Limestone Arch' },
  { x: -6.2, yOffset: 2.25, z: 7.6, lookX: -3.8, lookYOffset: 1.05, lookZ: 4.5, zone: 'Western Soft-Coral Slope' },
  { x: -3.2, yOffset: 2.15, z: 10.4, lookX: -1.4, lookYOffset: 1.05, lookZ: 5.4, zone: 'Foreground Table Corals' },
];

// Matches all 10 STRUCTURE_SPECS footprints in src/entities/reefBommies.js
export const BOMMY_OBSTACLES = [
  { id: 'fg-showcase', x: -1.6, z: 5.2, radius: 2.35, height: 1.85 },
  { id: 'fg-east', x: 5.6, z: 4.4, radius: 2.55, height: 1.55 },
  { id: 'fg-west', x: -6.8, z: 3.8, radius: 2.85, height: 1.72 },
  { id: 'reef-arch', x: -2.0, z: 1.8, radius: 3.1, height: 1.95 },
  { id: 'canyon-east-mid', x: 4.6, z: -1.7, radius: 3.4, height: 1.95 },
  { id: 'canyon-west-mid', x: -5.8, z: -2.5, radius: 3.3, height: 1.92 },
  { id: 'undercut-cave-east', x: 3.9, z: 0.9, radius: 2.45, height: 1.68 },
  { id: 'canyon-north-spur', x: -2.2, z: -6.3, radius: 3.1, height: 1.88 },
  { id: 'dropoff-west', x: -4.8, z: -10.6, radius: 3.7, height: 3.1 },
  { id: 'dropoff-east', x: 4.4, z: -11.2, radius: 3.8, height: 3.2 },
];

const SEABED_CLEARANCE = 0.85;
const BOMMY_HORIZ_BUFFER = 0.75;
const BOMMY_VERT_BUFFER = 0.65;
const SAMPLE_COUNT = 240;
const MAX_BANK_ROLL_RAD = Math.min(0.105, THREE.MathUtils.degToRad(6));
const MIN_PITCH = THREE.MathUtils.degToRad(-89);
const MAX_PITCH = THREE.MathUtils.degToRad(89);

const _zAxis = new THREE.Vector3(0, 0, 1);
const _tangentTmp = new THREE.Vector3();
const _tanPrev = new THREE.Vector3();
const _tanNext = new THREE.Vector3();
const _offsetTmp = new THREE.Vector3();

function wrap01(u) {
  if (typeof u !== 'number' || !Number.isFinite(u)) return 0;
  return ((u % 1) + 1) % 1;
}

function circularDist01(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 1 - d);
}

function noopRaycast() {}

/**
 * Resolves seabed and bommy obstacle clearance for a trail point in-place.
 */
function resolvePointClearance(p, obstacles, seabedFn, margin = 0.14) {
  for (let pass = 0; pass < 5; pass++) {
    const minBed = seabedFn(p.x, p.z) + SEABED_CLEARANCE + margin;
    if (p.y < minBed) {
      p.y = minBed;
    }

    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const reqD = o.radius + BOMMY_HORIZ_BUFFER + margin;
      const reqY = o.baseSeabed + o.height + BOMMY_VERT_BUFFER + margin;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const d = Math.hypot(dx, dz);

      if (d < reqD && p.y < reqY) {
        const pushH = reqD - d;
        const pushV = reqY - p.y;
        // Prefer horizontal skirting on early passes, then fall back to monotonic vertical lift
        // so overlapping obstacle footprints never ping-pong.
        if (pass < 3 && pushH <= pushV * 1.15 && d > 0.05) {
          const scale = reqD / d;
          p.x = o.x + dx * scale;
          p.z = o.z + dz * scale;
        } else {
          p.y = reqY;
        }
      }
    }
  }

  const finalBed = seabedFn(p.x, p.z) + SEABED_CLEARANCE + margin;
  if (p.y < finalBed) {
    p.y = finalBed;
  }
}

/**
 * Builds an obstacle-free closed centripetal Catmull-Rom reef tour spline,
 * baked samples, and optional non-pickable 3D trail visualization.
 */
export function createReefTourSystem({ getSeabedHeight, scene } = {}) {
  const seabedFn =
    typeof getSeabedHeight === 'function' ? getSeabedHeight : defaultGetSeabedHeight;

  const obstacles = BOMMY_OBSTACLES.map((o) => ({
    ...o,
    baseSeabed: seabedFn(o.x, o.z),
  }));

  const wpPositions = TOUR_WAYPOINTS.map(
    (w) => new THREE.Vector3(w.x, seabedFn(w.x, w.z) + w.yOffset, w.z)
  );
  const lookPositions = TOUR_WAYPOINTS.map(
    (w) => new THREE.Vector3(w.lookX, seabedFn(w.lookX, w.lookZ) + w.lookYOffset, w.lookZ)
  );

  const basePosCurve = new THREE.CatmullRomCurve3(wpPositions, true, 'centripetal');
  const lookCurve = new THREE.CatmullRomCurve3(lookPositions, true, 'centripetal');

  let pts = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const p = basePosCurve.getPointAt(i / SAMPLE_COUNT);
    resolvePointClearance(p, obstacles, seabedFn, 0.16);
    pts.push(p);
  }

  // Smooth the obstacle-cleared control loop while strictly preserving clearance
  for (let iter = 0; iter < 18; iter++) {
    pts = pts.map((p, i) => {
      const prev = pts[(i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT];
      const nxt = pts[(i + 1) % SAMPLE_COUNT];
      const avg = new THREE.Vector3().addVectors(prev, nxt).multiplyScalar(0.5);
      const blended = p.clone().lerp(avg, 0.35);
      resolvePointClearance(blended, obstacles, seabedFn, 0.16);
      return blended;
    });
  }

  // Upward-only vertical smoothing eases ramps without reducing clearance
  for (let iter = 0; iter < 16; iter++) {
    const nextY = new Float64Array(SAMPLE_COUNT);
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const prevY = pts[(i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT].y;
      const nxtY = pts[(i + 1) % SAMPLE_COUNT].y;
      nextY[i] = Math.max(pts[i].y, 0.5 * (prevY + nxtY));
    }
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      pts[i].y = nextY[i];
    }
  }

  // Verify and refine across 960 dense arc-length samples so spline chords stay 100% clear
  let posCurve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  const CHECK_SAMPLES = 960;
  for (let fix = 0; fix < 12; fix++) {
    let fixedAny = false;
    const nextPts = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      nextPts.push(posCurve.getPointAt(i / SAMPLE_COUNT));
    }
    for (let s = 0; s < CHECK_SAMPLES; s++) {
      const u = s / CHECK_SAMPLES;
      const p = posCurve.getPointAt(u);
      let viol = p.y < seabedFn(p.x, p.z) + SEABED_CLEARANCE + 0.02;
      if (!viol) {
        for (let oi = 0; oi < obstacles.length; oi++) {
          const o = obstacles[oi];
          const d = Math.hypot(p.x - o.x, p.z - o.z);
          const reqY = o.baseSeabed + o.height + BOMMY_VERT_BUFFER;
          if (d < o.radius + BOMMY_HORIZ_BUFFER + 0.02 && p.y < reqY + 0.02) {
            viol = true;
            break;
          }
        }
      }
      if (viol) {
        fixedAny = true;
        const i0 = Math.floor(u * SAMPLE_COUNT) % SAMPLE_COUNT;
        const i1 = (i0 + 1) % SAMPLE_COUNT;
        resolvePointClearance(nextPts[i0], obstacles, seabedFn, 0.18);
        resolvePointClearance(nextPts[i1], obstacles, seabedFn, 0.18);
      }
    }
    pts = nextPts;
    posCurve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    if (!fixedAny) break;
  }

  // Align u = 0 to the closest point to Waypoint 1 (Sunlit Coral Garden)
  let startIdx = 0;
  let bestStartDistSq = Infinity;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const dSq = pts[i].distanceToSquared(wpPositions[0]);
    if (dSq < bestStartDistSq) {
      bestStartDistSq = dSq;
      startIdx = i;
    }
  }
  if (startIdx !== 0) {
    pts = [...pts.slice(startIdx), ...pts.slice(0, startIdx)];
    posCurve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  }

  // Map each of the 12 waypoints monotonically onto arc-length u in [0, 1)
  const waypointCount = TOUR_WAYPOINTS.length;
  const wpUs = [0];
  const MAP_SAMPLES = 480;
  for (let k = 1; k < waypointCount; k++) {
    const prevU = wpUs[k - 1];
    let bestU = Math.min(0.99, prevU + 0.01);
    let bestDSq = Infinity;
    for (let s = 1; s < MAP_SAMPLES; s++) {
      const u = s / MAP_SAMPLES;
      if (u <= prevU + 0.005) continue;
      const dSq = posCurve.getPointAt(u).distanceToSquared(wpPositions[k]);
      if (dSq < bestDSq) {
        bestDSq = dSq;
        bestU = u;
      }
    }
    wpUs.push(bestU);
  }

  function resolveZoneAndLookParam(wrappedU) {
    let segIdx = waypointCount - 1;
    for (let k = 0; k < waypointCount - 1; k++) {
      if (wrappedU >= wpUs[k] && wrappedU < wpUs[k + 1]) {
        segIdx = k;
        break;
      }
    }
    if (wrappedU < wpUs[1]) {
      segIdx = 0;
    }

    const uStart = wpUs[segIdx];
    const uEnd = segIdx < waypointCount - 1 ? wpUs[segIdx + 1] : 1.0;
    const span = Math.max(1e-5, uEnd - uStart);
    const localFrac = THREE.MathUtils.clamp((wrappedU - uStart) / span, 0, 1);
    const lookT = wrap01((segIdx + localFrac) / waypointCount);

    let nearestWp = 0;
    let bestCircular = Infinity;
    for (let k = 0; k < waypointCount; k++) {
      const d = circularDist01(wrappedU, wpUs[k]);
      if (d < bestCircular) {
        bestCircular = d;
        nearestWp = k;
      }
    }

    return {
      lookT,
      waypointIndex: nearestWp,
      zoneName: TOUR_WAYPOINTS[nearestWp].zone,
    };
  }

  function computeYawPitch(camPos, lookTarget) {
    _offsetTmp.copy(camPos).sub(lookTarget);
    const safeDist = Math.max(0.001, _offsetTmp.length());
    const pitch = THREE.MathUtils.clamp(
      Math.asin(THREE.MathUtils.clamp(-_offsetTmp.y / safeDist, -1, 1)),
      MIN_PITCH,
      MAX_PITCH
    );
    const yaw = Math.atan2(_offsetTmp.x, _offsetTmp.z);
    return { yaw, pitch };
  }

  function computeBankRoll(wrappedU) {
    const du = 0.012;
    posCurve.getTangentAt(wrap01(wrappedU - du), _tanPrev);
    posCurve.getTangentAt(wrap01(wrappedU + du), _tanNext);
    const crossY = _tanPrev.z * _tanNext.x - _tanPrev.x * _tanNext.z;
    const dotXZ = _tanPrev.x * _tanNext.x + _tanPrev.z * _tanNext.z;
    const turnRad = Math.atan2(crossY, dotXZ);
    return THREE.MathUtils.clamp(turnRad * 0.42, -MAX_BANK_ROLL_RAD, MAX_BANK_ROLL_RAD);
  }

  function sampleTourPose(u, getVerticalBoundsFn, envState) {
    const progress = wrap01(u);
    const camPos = posCurve.getPointAt(progress);
    const { lookT, waypointIndex, zoneName } = resolveZoneAndLookParam(progress);
    const lookTarget = lookCurve.getPoint(lookT);

    if (typeof getVerticalBoundsFn === 'function') {
      const bounds = getVerticalBoundsFn(camPos.x, camPos.z, envState);
      if (bounds && Number.isFinite(bounds.minY)) {
        const ceiling = Number.isFinite(bounds.swimCeilingY)
          ? bounds.swimCeilingY
          : bounds.maxY;
        if (Number.isFinite(ceiling)) {
          camPos.y = THREE.MathUtils.clamp(
            camPos.y,
            bounds.minY,
            Math.max(bounds.minY, ceiling)
          );
        } else {
          camPos.y = Math.max(bounds.minY, camPos.y);
        }
      }
    }

    const { yaw, pitch } = computeYawPitch(camPos, lookTarget);
    const roll = computeBankRoll(progress);

    return {
      camPos,
      lookTarget,
      yaw,
      pitch,
      roll,
      zoneName,
      waypointIndex,
      progress,
    };
  }

  // Bake 240 trail samples along u in [0, 1)
  const bakedSamples = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const u = i / SAMPLE_COUNT;
    const pose = sampleTourPose(u);
    bakedSamples.push({
      u,
      pos: pose.camPos,
      lookTarget: pose.lookTarget,
      yaw: pose.yaw,
      pitch: pose.pitch,
      roll: pose.roll,
      zoneName: pose.zoneName,
      waypointIndex: pose.waypointIndex,
    });
  }

  function findNearestTourProgress(worldPos) {
    const wx = worldPos?.x ?? 0;
    const wy = worldPos?.y ?? 0;
    const wz = worldPos?.z ?? 0;

    let bestProgress = 0;
    let bestDistSq = Infinity;

    for (let i = 0; i < bakedSamples.length; i++) {
      const s = bakedSamples[i];
      const dx = s.pos.x - wx;
      const dy = s.pos.y - wy;
      const dz = s.pos.z - wz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestProgress = s.u;
      }
    }

    return {
      progress: bestProgress,
      distance: Math.sqrt(bestDistSq),
    };
  }

  // Build subtle 3D trail visualization along a floor-guide curve below camera eye level (non-pickable)
  const visualPts = pts.map(
    (p) => new THREE.Vector3(p.x, Math.max(seabedFn(p.x, p.z) + 0.35, p.y - 0.72), p.z)
  );
  const visualCurve = new THREE.CatmullRomCurve3(visualPts, true, 'centripetal');

  const trailGroup = new THREE.Group();
  trailGroup.name = 'ReefTourTrailGroup';
  trailGroup.visible = false;

  const tubeGeometry = new THREE.TubeGeometry(visualCurve, 220, 0.013, 6, true);
  const tubeMaterial = new THREE.MeshBasicMaterial({
    color: 0x38e8ff,
    transparent: true,
    opacity: 0.30,
    depthWrite: false,
  });
  const tubeMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
  tubeMesh.name = 'ReefTourSplineTube';
  tubeMesh.raycast = noopRaycast;
  trailGroup.add(tubeMesh);

  const ringGeometry = new THREE.TorusGeometry(0.11, 0.012, 8, 24);
  const waypointRings = [];
  for (let k = 0; k < waypointCount; k++) {
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7df5ff,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeometry, ringMat);
    ringMesh.name = `ReefTourWaypointRing_${k}`;
    ringMesh.raycast = noopRaycast;

    const u = wpUs[k];
    ringMesh.position.copy(visualCurve.getPointAt(u));
    visualCurve.getTangentAt(u, _tangentTmp).normalize();
    ringMesh.quaternion.setFromUnitVectors(_zAxis, _tangentTmp);

    trailGroup.add(ringMesh);
    waypointRings.push({ mesh: ringMesh, material: ringMat, u });
  }

  const beaconGeometry = new THREE.TorusGeometry(0.14, 0.015, 8, 28);
  const beaconMaterial = new THREE.MeshBasicMaterial({
    color: 0xb8fcff,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const beaconMesh = new THREE.Mesh(beaconGeometry, beaconMaterial);
  beaconMesh.name = 'ReefTourActiveBeacon';
  beaconMesh.raycast = noopRaycast;
  const initialAheadU = wrap01(0.022);
  beaconMesh.position.copy(visualCurve.getPointAt(initialAheadU));
  visualCurve.getTangentAt(initialAheadU, _tangentTmp).normalize();
  beaconMesh.quaternion.setFromUnitVectors(_zAxis, _tangentTmp);
  trailGroup.add(beaconMesh);

  if (scene && typeof scene.add === 'function') {
    scene.add(trailGroup);
  }

  function setTrailVisible(visible) {
    trailGroup.visible = Boolean(visible);
  }

  function isTrailVisible() {
    return trailGroup.visible;
  }

  function updateTrailVisual(elapsedTime = 0, progress = 0) {
    const u = wrap01(progress);
    const aheadU = wrap01(u + 0.022);
    const t = Number.isFinite(elapsedTime) ? elapsedTime : 0;

    beaconMesh.position.copy(visualCurve.getPointAt(aheadU));
    visualCurve.getTangentAt(aheadU, _tangentTmp).normalize();
    beaconMesh.quaternion.setFromUnitVectors(_zAxis, _tangentTmp);
    const beaconPulse = 0.5 + 0.5 * Math.sin(t * 3.4);
    beaconMesh.scale.setScalar(0.95 + 0.16 * beaconPulse);
    beaconMaterial.opacity = 0.72 + 0.24 * beaconPulse;

    for (let k = 0; k < waypointRings.length; k++) {
      const item = waypointRings[k];
      const prox = Math.max(0, 1 - circularDist01(u, item.u) * 14);
      const idleWave = 0.5 + 0.5 * Math.sin(t * 2.0 + k * 0.55);
      item.material.opacity = 0.28 + 0.16 * idleWave + 0.42 * prox;
      item.mesh.scale.setScalar(1.0 + 0.22 * prox);
    }
  }

  function dispose() {
    if (trailGroup.parent) {
      trailGroup.parent.remove(trailGroup);
    }
    tubeGeometry.dispose();
    tubeMaterial.dispose();
    ringGeometry.dispose();
    for (let k = 0; k < waypointRings.length; k++) {
      waypointRings[k].material.dispose();
    }
    beaconGeometry.dispose();
    beaconMaterial.dispose();
  }

  return {
    curve: posCurve,
    lookCurve,
    trailGroup,
    bakedSamples,
    waypointUs: wpUs.slice(),
    sampleTourPose,
    findNearestTourProgress,
    setTrailVisible,
    isTrailVisible,
    updateTrailVisual,
    dispose,
  };
}
