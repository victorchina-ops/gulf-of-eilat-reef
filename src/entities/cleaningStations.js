import * as THREE from 'three';
import { SPECIES_POPULATION_SPEC, WORLD_CONSTANTS, sanitizeSpeciesCount } from '../contracts.js';
import {
  PART_MEDIAN_FIN,
  addFishEyes,
  attachSwimStateAttribute,
  buildFinStrip,
  buildPairedPectoralFins,
  buildPairedPelvicFins,
  buildParametricFishBody,
  createAnimatedFishMaterial,
  createMatrixScratch,
  orientFishMatrix,
  setSwimState,
} from './fishGeometry.js';
import { configureDynamicMesh, createRng, safeMerge, safeNormalize } from './utils.js';

const FALLBACK_STATION_COORDS = [
  [1.75, 4.55],
  [1.15, -2.5],
  [-4.10, 5.35],
];

const SLOT_OFFSETS = [
  new THREE.Vector3(0.20, 0.08, 0.12),
  new THREE.Vector3(-0.24, 0.16, -0.14),
];

/**
 * Labroides dimidiatus (Bluestreak Cleaner Wrasse) — 0.155 m slender labrid.
 * Pearlescent ivory-white throat/snout grading posteriorly to electric cyan and deep cobalt,
 * bisected from snout tip through eye by a jet-black lateral stripe widening to a paddle tail wedge.
 */
export function buildCleanerWrassePrototype() {
  const parts = [];
  const length = 0.155;
  const tailPivotZ = 0.070;
  const cPearl = new THREE.Color('#f2f9ff');
  const cCyan = new THREE.Color('#18a8ff');
  const cDeepBlue = new THREE.Color('#0b6eff');
  const cStripe = new THREE.Color('#0c0f16');
  const cPecBase = new THREE.Color('#78d8ff');
  const cPecTip = new THREE.Color('#eef8ff');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight: 0.022,
      halfWidth: 0.013,
      segsU: 36,
      segsV: 20,
      operculumRidge: 0.06,
      tailPivotZ,
      dorsalProfile: (u) => {
        if (u < 0.14) return 0.40 + (u / 0.14) * 0.34;
        if (u > 0.72) {
          const t = (u - 0.72) / 0.28;
          return 0.98 * Math.cos(t * Math.PI * 0.48);
        }
        return 0.74 + 0.24 * Math.sin(((u - 0.14) / 0.58) * Math.PI * 0.5);
      },
      ventralProfile: (u) => {
        if (u < 0.14) return 0.38 + (u / 0.14) * 0.34;
        if (u > 0.72) {
          const t = (u - 0.72) / 0.28;
          return 0.94 * Math.cos(t * Math.PI * 0.48);
        }
        return 0.72 + 0.22 * Math.sin(((u - 0.14) / 0.58) * Math.PI * 0.5);
      },
      widthProfile: (u) =>
        Math.pow(Math.sin(Math.pow(u, 0.64) * Math.PI), 0.72) * 0.95 + (1 - u) * (1 - u) * 0.18,
      colorFn: (zNorm, yNorm, _xNorm, out) => {
        const stripeHalf = 0.25 - zNorm * 0.14;
        const stripeDist = Math.abs(yNorm - 0.03);
        const postT = THREE.MathUtils.clamp((0.48 - zNorm) * 0.74, 0, 1);

        out.copy(cPearl).lerp(cCyan, postT);
        if (postT > 0.28) {
          const edgeT = THREE.MathUtils.clamp((Math.abs(yNorm) - 0.18) * 1.15, 0, 1) * postT;
          out.lerp(cDeepBlue, edgeT * 0.80);
        }
        if (zNorm > 0.15 && yNorm < -0.10) {
          out.lerp(cPearl, THREE.MathUtils.clamp((zNorm - 0.15) * 1.15, 0, 1) * 0.75);
        }

        const stripeMask = 1.0 - THREE.MathUtils.smoothstep(stripeDist, stripeHalf - 0.035, stripeHalf + 0.035);
        if (stripeMask > 0) {
          out.lerp(cStripe, stripeMask);
        }
      },
    })
  );

  // Active rowing labriform paddle pectoral fins
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.025,
      yPos: -0.004,
      xOffset: 0.0115,
      span: 0.024,
      chord: 0.014,
      sweep: -0.38,
      dihedral: -0.14,
      flare: 0.85,
      thickness: 0.0018,
      bodyLength: length,
      tailPivotZ,
      shape: 'paddle',
      colorFn: (_x, _y, z, out) => {
        const t = THREE.MathUtils.clamp((0.028 - z) / 0.028, 0, 1);
        out.copy(cPecBase).lerp(cPecTip, t);
      },
    })
  );

  // Continuous low ribbon dorsal & anal fins in glowing electric cyan-cobalt
  parts.push(
    buildFinStrip(
      [[-0.060, 0.013], [-0.052, 0.029], [-0.015, 0.030], [0.018, 0.028], [0.026, 0.017]],
      0.0024,
      (_x, y, z, out) => {
        const t = THREE.MathUtils.clamp((-z + 0.026) / 0.086, 0, 1);
        out.copy(cCyan).lerp(cDeepBlue, THREE.MathUtils.clamp((y - 0.014) * 38 + t * 0.42, 0, 1));
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );
  parts.push(
    buildFinStrip(
      [[-0.060, -0.012], [-0.050, -0.027], [-0.018, -0.026], [0.006, -0.024], [0.014, -0.014]],
      0.0024,
      (_x, y, z, out) => {
        const t = THREE.MathUtils.clamp((-z + 0.014) / 0.074, 0, 1);
        out.copy(cCyan).lerp(cDeepBlue, THREE.MathUtils.clamp((-y - 0.013) * 32 + t * 0.50, 0, 1));
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Slender pelvic fins in electric cyan-cobalt
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.020,
      yPos: -0.016,
      xOffset: 0.005,
      length: 0.022,
      width: 0.008,
      splay: 0.30,
      dip: -0.42,
      thickness: 0.0016,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, _y, z, out) => {
        const t = THREE.MathUtils.clamp((0.020 - z) / 0.024, 0, 1);
        out.copy(cCyan).lerp(cDeepBlue, t * 0.65);
      },
    })
  );

  // Two-layer eyes: cyan-silver iris + glossy dark pupil
  addFishEyes(parts, 0.048, 0.0025, 0.0056, 0.0038, '#6cd8ff', {
    bodyLength: length,
    tailPivotZ,
  });
  const bodyGeom = safeMerge(parts);

  // Spatulate truncate paddle caudal fin with widening jet-black central wedge & neon cyan borders
  const tailGeom = buildFinStrip(
    [
      [0.0, 0.0095],
      [-0.032, 0.0235],
      [-0.037, 0.011],
      [-0.038, 0.0],
      [-0.037, -0.011],
      [-0.032, -0.0235],
      [0.0, -0.0095],
    ],
    0.0026,
    (_x, y, z, out) => {
      const wedgeHalf = 0.0075 + Math.max(0, -z) * 0.28;
      const wedgeMask = 1.0 - THREE.MathUtils.smoothstep(Math.abs(y), wedgeHalf - 0.0018, wedgeHalf + 0.0018);
      out.copy(cCyan).lerp(cDeepBlue, THREE.MathUtils.clamp(-z / 0.038, 0, 1) * 0.55);
      if (wedgeMask > 0) {
        out.lerp(cStripe, wedgeMask);
      }
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 5 }
  );

  return { bodyGeom, tailGeom, tailPivotZ };
}

export function createCleaningStations({
  applyUnderwaterMaterial,
  getSeabedHeight,
  coralHeads = [],
}) {
  const group = new THREE.Group();
  group.name = 'reef-cleaning-stations';

  const pickableMeshes = [];
  const mat = createAnimatedFishMaterial(
    applyUnderwaterMaterial,
    { roughness: 0.26, metalness: 0.14 },
    { receiveCaustics: true, causticsStrength: 0.85 }
  );

  const taggedHeads = (coralHeads || [])
    .filter((c) => c && c.isCleaningStation)
    .sort((a, b) => (a.stationId ?? 0) - (b.stationId ?? 0));

  const stations = [];
  const stationById = new Map();

  for (let i = 0; i < 3; i++) {
    const head = taggedHeads[i];
    const [fx, fz] = FALLBACK_STATION_COORDS[i];
    const x = head?.position ? head.position.x : fx;
    const z = head?.position ? head.position.z : fz;
    const coralPos = head?.position
      ? head.position.clone()
      : new THREE.Vector3(x, getSeabedHeight(x, z) + 0.24, z);
    const id = head?.stationId ?? i;
    const topY = head?.topWorldY ?? (coralPos.y + (head?.radius ?? 0.6) * 0.5);
    const anchorPos = new THREE.Vector3(
      x,
      Math.max(topY + 0.44, getSeabedHeight(x, z) + 0.92),
      z
    );

    const station = {
      id,
      anchorPos,
      coralPos,
      detectRadius: 2.85,
      maxClients: 2,
      activeClients: [],
      completedVisits: 0,
      isOpen: true,
    };
    stations.push(station);
    stationById.set(id, station);
  }

  const MAX_WRASSE = SPECIES_POPULATION_SPEC.cleanerwrasse.maxCount;
  const proto = buildCleanerWrassePrototype();

  const bodyMesh = new THREE.InstancedMesh(proto.bodyGeom, mat, MAX_WRASSE);
  bodyMesh.name = 'cleanerwrasse-bodies';
  configureDynamicMesh(bodyMesh, 'cleanerwrasse');

  const tailMesh = new THREE.InstancedMesh(proto.tailGeom, mat, MAX_WRASSE);
  tailMesh.name = 'cleanerwrasse-tails';
  configureDynamicMesh(tailMesh, 'cleanerwrasse');

  const swimAttr = attachSwimStateAttribute(bodyMesh, tailMesh, MAX_WRASSE);

  group.add(bodyMesh, tailMesh);
  pickableMeshes.push(bodyMesh, tailMesh);

  const rng = createRng(8401);
  const wrasses = [];

  for (let w = 0; w < MAX_WRASSE; w++) {
    const sIdx = w % stations.length;
    const role = Math.floor(w / stations.length);
    const st = stations[sIdx];
    const a = ((role % 3) / 3) * Math.PI * 2 + Math.floor(role / 3) * 1.05 + rng() * 0.5;
    const r = 0.28 + rng() * 0.12;
    const pos = new THREE.Vector3(
      st.anchorPos.x + Math.cos(a) * r,
      st.anchorPos.y + ((role % 3) - 1) * 0.08,
      st.anchorPos.z + Math.sin(a) * r
    );
    const vel = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.38);
    wrasses.push({
      pos,
      vel,
      stationId: st.id,
      role,
      phase: rng() * Math.PI * 2,
      scale: 1.0 + rng() * 0.22,
      servicingClientKey: null,
    });
  }

  let currentElapsedTime = 0;
  let activeWrasseCount = SPECIES_POPULATION_SPEC.cleanerwrasse.defaultCount;

  function applySpeciesCounts(speciesCounts) {
    const n = Math.min(
      wrasses.length,
      sanitizeSpeciesCount(
        'cleanerwrasse',
        speciesCounts?.cleanerwrasse ?? SPECIES_POPULATION_SPEC.cleanerwrasse.defaultCount
      )
    );
    activeWrasseCount = n;
    bodyMesh.count = n;
    tailMesh.count = n;
    bodyMesh.visible = n > 0;
    tailMesh.visible = n > 0;

    for (let sIdx = 0; sIdx < stations.length; sIdx++) {
      const st = stations[sIdx];
      st.isOpen = n > sIdx;
      if (!st.isOpen) {
        st.activeClients.length = 0;
      }
    }
  }

  function findClient(clientKey) {
    for (let s = 0; s < stations.length; s++) {
      const st = stations[s];
      for (let c = 0; c < st.activeClients.length; c++) {
        if (st.activeClients[c].key === clientKey) {
          return { station: st, client: st.activeClients[c], index: c };
        }
      }
    }
    return null;
  }

  function tryAcquireStation(clientKey, pos, detectRadiusOverride = null) {
    if (!clientKey || !pos) return null;

    const existing = findClient(clientKey);
    if (existing) {
      return {
        stationId: existing.station.id,
        slotIdx: existing.client.slotIdx,
        hoverPos: existing.client.hoverPos.clone(),
        stationPos: existing.station.anchorPos.clone(),
      };
    }

    let bestStation = null;
    let bestDist = Infinity;

    for (let s = 0; s < stations.length; s++) {
      const st = stations[s];
      if (st.isOpen === false || st.activeClients.length >= st.maxClients) continue;
      const maxR = detectRadiusOverride ?? st.detectRadius;
      const dx = pos.x - st.anchorPos.x;
      const dy = pos.y - st.anchorPos.y;
      const dz = pos.z - st.anchorPos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist <= maxR && dist < bestDist) {
        bestDist = dist;
        bestStation = st;
      }
    }

    if (!bestStation) return null;

    const slot0Taken = bestStation.activeClients.some((c) => c.slotIdx === 0);
    const slotIdx = slot0Taken ? 1 : 0;
    const hoverPos = bestStation.anchorPos.clone().add(SLOT_OFFSETS[slotIdx]);

    bestStation.activeClients.push({
      key: clientKey,
      slotIdx,
      hoverPos: hoverPos.clone(),
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      heading: new THREE.Vector3(0, 0, 1),
      bodyHalfLen: 0.12,
      speciesId: 'fish',
      lastSeenTime: currentElapsedTime,
    });

    return {
      stationId: bestStation.id,
      slotIdx,
      hoverPos: hoverPos.clone(),
      stationPos: bestStation.anchorPos.clone(),
    };
  }

  function updateClientPose(clientKey, pos, headingVec3, bodyHalfLen = 0.12, speciesId = 'fish') {
    const found = findClient(clientKey);
    if (!found) return false;
    const { client } = found;
    if (pos) {
      client.pos.set(pos.x, pos.y, pos.z);
    }
    if (headingVec3) {
      client.heading.set(headingVec3.x, headingVec3.y, headingVec3.z);
    }
    safeNormalize(client.heading, 0, 0, 1);
    client.bodyHalfLen = bodyHalfLen;
    client.speciesId = speciesId;
    client.lastSeenTime = currentElapsedTime;
    return true;
  }

  function releaseStation(clientKey) {
    const found = findClient(clientKey);
    if (!found) return false;
    found.station.activeClients.splice(found.index, 1);
    found.station.completedVisits += 1;
    return true;
  }

  const scratch = createMatrixScratch();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const vTarget = new THREE.Vector3();
  const vDiff = new THREE.Vector3();
  const vForward = new THREE.Vector3();
  const cFwd = new THREE.Vector3();
  const cRight = new THREE.Vector3();
  const cUp = new THREE.Vector3();
  const vInspect = new THREE.Vector3();

  function update(elapsedTime, deltaTime, envState) {
    currentElapsedTime = elapsedTime;
    applySpeciesCounts(envState?.speciesCounts);
    const dt = Math.min(Math.max(deltaTime || 0.016, 0.001), 0.05);
    const surfaceLimitY = WORLD_CONSTANTS.SURFACE_BASE_Y + (envState?.diveDepth ?? 6.0) - 0.30;

    // Expire stale client claims whose pose hasn't been refreshed recently
    for (let s = 0; s < stations.length; s++) {
      const clients = stations[s].activeClients;
      for (let c = clients.length - 1; c >= 0; c--) {
        if (elapsedTime - clients[c].lastSeenTime > 0.35) {
          clients.splice(c, 1);
        }
      }
    }

    for (let i = activeWrasseCount; i < wrasses.length; i++) {
      wrasses[i].servicingClientKey = null;
    }

    if (activeWrasseCount === 0) return;

    for (let i = 0; i < activeWrasseCount; i++) {
      const w = wrasses[i];
      const st = stationById.get(w.stationId) ?? stations[0];
      const clients = st.activeClients;

      let pitchOffset = 0;
      let bodyYaw = 0;
      let tailYaw = 0;
      let bodyAmp = 0.0085;
      let finAmp = 0.011;

      if (clients.length === 0) {
        // Advertising Dance: undulating seesaw figure-8 / orbit around station anchor
        w.servicingClientKey = null;

        const roleSlot = w.role % 3;
        const angle = elapsedTime * 1.45 + w.phase + roleSlot * 2.094 + Math.floor(w.role / 3) * 1.05;
        const orbitR = 0.34 + Math.sin(elapsedTime * 2.1 + w.phase) * 0.14; // 0.20..0.48m
        const bobY = Math.sin(elapsedTime * 4.4 + w.phase) * 0.09 + (roleSlot - 1) * 0.07;

        const tx = st.anchorPos.x + Math.cos(angle) * orbitR;
        const tz = st.anchorPos.z + Math.sin(angle) * orbitR;
        const floorY = getSeabedHeight(tx, tz) + 0.22;
        const ty = Math.min(surfaceLimitY, Math.max(floorY, st.anchorPos.y + bobY));

        vTarget.set(tx, ty, tz);
        vDiff.subVectors(vTarget, w.pos);
        const dist = vDiff.length();
        if (dist > 1e-4) {
          const desiredSpeed = THREE.MathUtils.clamp(dist * 2.4, 0.24, 0.54);
          vDiff.multiplyScalar(desiredSpeed / dist);
          w.vel.lerp(vDiff, Math.min(1, dt * 5.0));
        }

        w.pos.addScaledVector(w.vel, dt);
        const minWrasseY = Math.min(surfaceLimitY - 0.05, getSeabedHeight(w.pos.x, w.pos.z) + 0.18);
        w.pos.y = THREE.MathUtils.clamp(w.pos.y, minWrasseY, surfaceLimitY);

        vForward.copy(w.vel);
        safeNormalize(vForward, -Math.sin(angle), 0, Math.cos(angle));

        pitchOffset = Math.sin(elapsedTime * 6.8 + w.phase) * 0.22;
        const swim = elapsedTime * 12.0 + w.phase;
        bodyYaw = Math.sin(swim) * 0.08;
        tailYaw = Math.sin(swim - 0.6) * 0.34;
      } else {
        // Active Cleaning: sweep along client flanks & gills with rapid nipping pitch
        const client = clients[w.role % clients.length];
        w.servicingClientKey = client.key;

        cFwd.copy(client.heading);
        safeNormalize(cFwd, 0, 0, 1);
        cRight.crossVectors(worldUp, cFwd);
        safeNormalize(cRight, 1, 0, 0);
        cUp.crossVectors(cFwd, cRight);
        safeNormalize(cUp, 0, 1, 0);

        const roleSlot = w.role % 3;
        const extraTier = Math.floor(w.role / 3);
        let flankSide = 1;
        let lateralDist = 0.155 + extraTier * 0.035;
        let dorsalLift = 0.02 + extraTier * 0.02;
        if (roleSlot === 1) {
          flankSide = -1;
          dorsalLift = 0.03 + extraTier * 0.02;
        } else if (roleSlot === 2) {
          flankSide = Math.sin(elapsedTime * 0.9 + w.phase) >= 0 ? 0.65 : -0.65;
          lateralDist = 0.12 + extraTier * 0.03;
          dorsalLift = 0.13 + extraTier * 0.02;
        }

        const along = Math.sin(elapsedTime * 1.9 + w.phase) * client.bodyHalfLen * 0.75;
        vTarget
          .copy(client.pos)
          .addScaledVector(cFwd, along)
          .addScaledVector(cRight, flankSide * lateralDist)
          .addScaledVector(cUp, dorsalLift);

        const targetFloor = getSeabedHeight(vTarget.x, vTarget.z) + 0.16;
        vTarget.y = Math.min(surfaceLimitY, Math.max(targetFloor, vTarget.y));

        vDiff.subVectors(vTarget, w.pos);
        const dist = vDiff.length();
        if (dist > 1e-4) {
          const desiredSpeed = THREE.MathUtils.clamp(dist * 6.0, 0.08, 0.95);
          vDiff.multiplyScalar(desiredSpeed / dist);
          w.vel.lerp(vDiff, Math.min(1, dt * 8.0));
        }

        w.pos.addScaledVector(w.vel, dt);
        const minWrasseY = Math.min(surfaceLimitY - 0.05, getSeabedHeight(w.pos.x, w.pos.z) + 0.16);
        w.pos.y = THREE.MathUtils.clamp(w.pos.y, minWrasseY, surfaceLimitY);

        // Orient snout toward the client's body/gill area
        vInspect
          .copy(client.pos)
          .addScaledVector(cFwd, along * 0.85 + client.bodyHalfLen * 0.15);
        vForward.subVectors(vInspect, w.pos);
        safeNormalize(vForward, -cRight.x * flankSide, 0, -cRight.z * flankSide);

        pitchOffset = Math.sin(elapsedTime * 11.0 + w.phase) * 0.14;
        const swim = elapsedTime * 13.5 + w.phase;
        bodyYaw = Math.sin(swim) * 0.06;
        tailYaw = Math.sin(swim - 0.6) * 0.30;
        bodyAmp = 0.0075;
        finAmp = 0.0125;
      }

      setSwimState(swimAttr, i, elapsedTime * 13.0 + w.phase, bodyAmp, finAmp);

      const { bodyMatrix, tailMatrix } = orientFishMatrix(
        w.pos,
        vForward,
        w.scale,
        bodyYaw,
        tailYaw,
        pitchOffset,
        proto.tailPivotZ,
        scratch
      );
      bodyMesh.setMatrixAt(i, bodyMatrix);
      tailMesh.setMatrixAt(i, tailMatrix);
    }

    bodyMesh.instanceMatrix.needsUpdate = true;
    tailMesh.instanceMatrix.needsUpdate = true;
    if (activeWrasseCount > 0) {
      swimAttr.needsUpdate = true;
    }
  }

  update(0, 0.016, { diveDepth: 6.0 });

  return {
    group,
    pickableMeshes,
    stations,
    wrasses,
    tryAcquireStation,
    updateClientPose,
    releaseStation,
    applySpeciesCounts,
    getActiveCounts: () => ({ cleanerwrasse: activeWrasseCount }),
    update,
  };
}
