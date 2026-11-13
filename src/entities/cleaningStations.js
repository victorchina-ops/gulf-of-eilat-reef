import * as THREE from 'three';
import { SPECIES_POPULATION_SPEC, sanitizeSpeciesCount, WORLD_CONSTANTS } from '../contracts.js';
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
  [-3.2, -5.6],
  [0.35, -8.2],
];

const SLOT_OFFSETS = [
  new THREE.Vector3(0.26, 0.08, 0.16),
  new THREE.Vector3(-0.28, 0.18, -0.18),
  new THREE.Vector3(-0.04, 0.28, 0.28),
];

const ANATOMICAL_ZONES = [
  'gill_operculum',
  'mouth_jaw',
  'pectoral_axil',
  'flank',
  'dorsal_base',
];

const PREDATOR_ZONE_CYCLE = [
  'gill_operculum',
  'mouth_jaw',
  'pectoral_axil',
  'mouth_jaw',
  'flank',
  'dorsal_base',
];

const PREDATOR_SPECIES_SET = new Set(['grouper', 'caranx', 'moray', 'pterois', 'lizardfish']);

function resolveClientDims(dimsOrHalfLen, speciesId = 'fish') {
  if (dimsOrHalfLen && typeof dimsOrHalfLen === 'object') {
    const halfLen = Number.isFinite(dimsOrHalfLen.halfLen)
      ? Math.max(0.04, dimsOrHalfLen.halfLen)
      : 0.12;
    const halfHeight = Number.isFinite(dimsOrHalfLen.halfHeight)
      ? Math.max(0.015, dimsOrHalfLen.halfHeight)
      : halfLen * 0.34;
    const halfWidth = Number.isFinite(dimsOrHalfLen.halfWidth)
      ? Math.max(0.012, dimsOrHalfLen.halfWidth)
      : halfLen * 0.20;
    const isPredator =
      typeof dimsOrHalfLen.isPredator === 'boolean'
        ? dimsOrHalfLen.isPredator
        : PREDATOR_SPECIES_SET.has(speciesId);
    const jawOpen = Boolean(dimsOrHalfLen.jawOpen);
    return { halfLen, halfHeight, halfWidth, isPredator, jawOpen };
  }

  const halfLen =
    typeof dimsOrHalfLen === 'number' && Number.isFinite(dimsOrHalfLen)
      ? Math.max(0.04, dimsOrHalfLen)
      : 0.12;
  const isDeep = speciesId === 'chaetodon' || speciesId === 'abudefduf';
  const halfHeight = halfLen * (isDeep ? 0.52 : 0.34);
  const halfWidth = halfLen * (isDeep ? 0.16 : 0.20);
  const isPredator = PREDATOR_SPECIES_SET.has(speciesId);
  return { halfLen, halfHeight, halfWidth, isPredator, jawOpen: speciesId === 'moray' };
}

/**
 * Labroides dimidiatus (Bluestreak Cleaner Wrasse) — 0.115 m body length (~8.8-12.3 cm TL scaled).
 * Creamy-tan / pale golden-beige anterior dorsum and pearly-ivory throat/belly grading mid-body
 * into electric azure blue posteriorly, bisected by a crisp jet-black lateral stripe widening into
 * a black caudal wedge framed by electric azure-blue borders, plus a diagnostic black pectoral-axil spot.
 */
export function buildCleanerWrassePrototype() {
  const parts = [];
  const length = 0.115;
  const s = length / 0.155;
  const tailPivotZ = 0.052;
  const halfHeight = 0.022 * s;
  const halfWidth = 0.013 * s;

  const cDorsumTan = new THREE.Color('#ccc09c');
  const cDorsumPale = new THREE.Color('#dfd5b4');
  const cThroatIvory = new THREE.Color('#ece7d5');
  const cAzure = new THREE.Color('#1488ff');
  const cAzureBright = new THREE.Color('#18a8ff');
  const cBlack = new THREE.Color('#080a10');
  const cPecMid = new THREE.Color('#78c8ff');
  const cPecTip = new THREE.Color('#e6f4ff');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight,
      halfWidth,
      segsU: 42,
      segsV: 24,
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
      colorFn: (zNorm, yNorm, xNorm, out) => {
        const postT = THREE.MathUtils.smoothstep(-zNorm, -0.18, 0.30);
        const bellyPostT = THREE.MathUtils.smoothstep(-zNorm, -0.10, 0.34);

        if (yNorm >= 0) {
          out.copy(cDorsumPale).lerp(cDorsumTan, THREE.MathUtils.clamp(yNorm * 0.55, 0, 1));
          out.lerp(cAzureBright, postT);
          const ridgeDeep = THREE.MathUtils.clamp((yNorm - 0.35) * 0.95, 0, 1) * postT;
          out.lerp(cAzure, ridgeDeep * 0.75);
        } else {
          out.copy(cThroatIvory).lerp(cAzureBright, bellyPostT);
          const keelDeep = THREE.MathUtils.clamp((-yNorm - 0.35) * 0.95, 0, 1) * bellyPostT;
          out.lerp(cAzure, keelDeep * 0.72);
        }

        // Crisp jet-black lateral stripe from snout tip through eye, widening to caudal peduncle
        const uFromSnout = (1.0 - zNorm) * 0.5;
        const stripeCenter = 0.035 * (1.0 - postT * 0.65);
        const stripeHalf = 0.13 + Math.pow(uFromSnout, 1.15) * 0.39;
        const stripeDist = Math.abs(yNorm - stripeCenter);
        const stripeMask = 1.0 - THREE.MathUtils.smoothstep(stripeDist, stripeHalf - 0.032, stripeHalf + 0.032);
        if (stripeMask > 0) {
          out.lerp(cBlack, stripeMask);
        }

        // Diagnostic jet-black spot right at the pectoral fin base / axil
        const axDz = (zNorm - 0.31) / 0.078;
        const axDy = (yNorm + 0.44) / 0.22;
        const axDist = Math.hypot(axDz, axDy);
        const flankMask = THREE.MathUtils.smoothstep(Math.abs(xNorm), 0.30, 0.55);
        const axMask = (1.0 - THREE.MathUtils.smoothstep(axDist, 0.70, 1.05)) * flankMask;
        if (axMask > 0) {
          out.lerp(cBlack, axMask);
        }
      },
    })
  );

  // Active rowing labriform paddle pectoral fins with dark axil base grading to translucent pale blue
  const pecZ = 0.025 * s;
  parts.push(
    buildPairedPectoralFins({
      zPos: pecZ,
      yPos: -0.004 * s,
      xOffset: 0.0115 * s,
      span: 0.024 * s,
      chord: 0.014 * s,
      sweep: -0.38,
      dihedral: -0.14,
      flare: 0.85,
      thickness: 0.0018 * s,
      bodyLength: length,
      tailPivotZ,
      shape: 'paddle',
      colorFn: (_x, _y, z, out) => {
        const spanT = THREE.MathUtils.clamp((pecZ + 0.002 * s - z) / (0.026 * s), 0, 1);
        if (spanT < 0.18) {
          out.copy(cBlack).lerp(cPecMid, spanT / 0.18);
        } else {
          out.copy(cPecMid).lerp(cPecTip, (spanT - 0.18) / 0.82);
        }
      },
    })
  );

  // Continuous low ribbon dorsal & anal fins in electric azure blue
  parts.push(
    buildFinStrip(
      [
        [-0.060 * s, 0.013 * s],
        [-0.052 * s, 0.029 * s],
        [-0.015 * s, 0.030 * s],
        [0.018 * s, 0.028 * s],
        [0.026 * s, 0.017 * s],
      ],
      0.0024 * s,
      (_x, y, z, out) => {
        const antT = THREE.MathUtils.clamp((z + 0.008 * s) / (0.034 * s), 0, 1);
        out.copy(cAzureBright).lerp(cAzure, THREE.MathUtils.clamp((y - 0.010 * s) * 52, 0, 1));
        if (antT > 0) {
          out.lerp(cDorsumTan, antT * 0.35);
        }
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );
  parts.push(
    buildFinStrip(
      [
        [-0.060 * s, -0.012 * s],
        [-0.050 * s, -0.027 * s],
        [-0.018 * s, -0.026 * s],
        [0.006 * s, -0.024 * s],
        [0.014 * s, -0.014 * s],
      ],
      0.0024 * s,
      (_x, y, _z, out) => {
        out.copy(cAzureBright).lerp(cAzure, THREE.MathUtils.clamp((-y - 0.010 * s) * 48, 0, 1));
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Slender pelvic fins in pale azure-silver
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.020 * s,
      yPos: -0.016 * s,
      xOffset: 0.005 * s,
      length: 0.022 * s,
      width: 0.008 * s,
      splay: 0.30,
      dip: -0.42,
      thickness: 0.0016 * s,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, _y, z, out) => {
        const t = THREE.MathUtils.clamp((0.020 * s - z) / (0.024 * s), 0, 1);
        out.copy(cThroatIvory).lerp(cAzureBright, 0.35 + t * 0.45);
      },
    })
  );

  // Two-layer eyes seated inside the anterior black lateral stripe
  addFishEyes(parts, 0.048 * s, 0.0025 * s, 0.0056 * s, 0.0038 * s, '#6cd8ff', {
    bodyLength: length,
    tailPivotZ,
  });
  const bodyGeom = safeMerge(parts);

  // Rounded-truncate paddle caudal fin: solid black wedge framed by electric azure-blue borders
  const tailGeom = buildFinStrip(
    [
      [0.0, 0.0095 * s],
      [-0.0315 * s, 0.0235 * s],
      [-0.0368 * s, 0.0155 * s],
      [-0.038 * s, 0.0],
      [-0.0368 * s, -0.0155 * s],
      [-0.0315 * s, -0.0235 * s],
      [0.0, -0.0095 * s],
    ],
    0.0026 * s,
    (_x, y, z, out) => {
      const wedgeHalf = 0.0062 * s + Math.max(0, -z) * 0.38;
      const wedgeMask = 1.0 - THREE.MathUtils.smoothstep(Math.abs(y), wedgeHalf - 0.0014 * s, wedgeHalf + 0.0014 * s);
      out.copy(cAzureBright).lerp(cAzure, THREE.MathUtils.clamp(-z / (0.038 * s), 0, 1) * 0.45);
      if (wedgeMask > 0) {
        out.lerp(cBlack, wedgeMask);
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

  const stationCount = Math.max(FALLBACK_STATION_COORDS.length, taggedHeads.length);
  const stations = [];
  const stationById = new Map();

  for (let i = 0; i < stationCount; i++) {
    const head = taggedHeads[i];
    const [fx, fz] = FALLBACK_STATION_COORDS[i % FALLBACK_STATION_COORDS.length];
    const x = head?.position ? head.position.x : fx;
    const z = head?.position ? head.position.z : fz;
    const coralPos = head?.position
      ? head.position.clone()
      : new THREE.Vector3(x, getSeabedHeight(x, z) + 0.24, z);
    const id = head?.stationId ?? i;
    const topY = head?.topWorldY ?? (coralPos.y + (head?.radius ?? 0.6) * 0.5);
    const anchorPos = new THREE.Vector3(
      x,
      Math.max(topY + 0.42, getSeabedHeight(x, z) + 0.90),
      z
    );

    const station = {
      id,
      anchorPos,
      coralPos,
      detectRadius: 2.85,
      maxClients: SLOT_OFFSETS.length,
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
    const r = 0.24 + rng() * 0.12;
    const pos = new THREE.Vector3(
      st.anchorPos.x + Math.cos(a) * r,
      st.anchorPos.y + ((role % 3) - 1) * 0.08,
      st.anchorPos.z + Math.sin(a) * r
    );
    const vel = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(0.36);
    wrasses.push({
      pos,
      vel,
      stationId: st.id,
      role,
      phase: rng() * Math.PI * 2,
      scale: 0.64 + rng() * 0.26, // ~8.8-12.3 cm TL
      servicingClientKey: null,
      ethologyPhase: 'advertising',
      activeZone: null,
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

    let slotIdx = 0;
    for (let s = 0; s < bestStation.maxClients; s++) {
      if (!bestStation.activeClients.some((c) => c.slotIdx === s)) {
        slotIdx = s;
        break;
      }
    }
    const hoverPos = bestStation.anchorPos.clone().add(SLOT_OFFSETS[slotIdx % SLOT_OFFSETS.length]);
    const defaultDims = resolveClientDims(0.12, 'fish');

    bestStation.activeClients.push({
      key: clientKey,
      slotIdx,
      hoverPos: hoverPos.clone(),
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      heading: new THREE.Vector3(0, 0, 1),
      bodyHalfLen: defaultDims.halfLen,
      dims: defaultDims,
      speciesId: 'fish',
      arrivedAt: currentElapsedTime,
      lastSeenTime: currentElapsedTime,
    });

    return {
      stationId: bestStation.id,
      slotIdx,
      hoverPos: hoverPos.clone(),
      stationPos: bestStation.anchorPos.clone(),
    };
  }

  function updateClientPose(clientKey, pos, headingVec3, dimsOrHalfLen = 0.12, speciesId = 'fish') {
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
    const dims = resolveClientDims(dimsOrHalfLen, speciesId);
    client.bodyHalfLen = dims.halfLen;
    client.dims = dims;
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
  const vOutNorm = new THREE.Vector3();
  const vRel = new THREE.Vector3();

  function computeAnatomicalZoneTarget(zoneName, client, w, elapsedTime) {
    const dims = client.dims || resolveClientDims(client.bodyHalfLen, client.speciesId);
    const { halfLen, halfHeight, halfWidth, jawOpen } = dims;
    const isMoray = client.speciesId === 'moray';
    const extraTier = Math.floor(w.role / 3);
    const sideSign = w.role % 2 === 0 ? 1 : -1;
    const zoneProgress = ((elapsedTime * 0.85 + w.phase * 0.4) % 1 + 1) % 1;

    let along = 0;
    let upFrac = 0;
    let rightFrac = sideSign;
    let normFwd = 0;
    let normUp = 0.08;
    let normRight = sideSign;

    if (zoneName === 'gill_operculum') {
      along = (isMoray ? -0.06 : 0.44) * halfLen;
      upFrac = 0.06;
      rightFrac = sideSign * 0.94;
      normFwd = 0.14;
      normUp = 0.10;
      normRight = sideSign;
    } else if (zoneName === 'mouth_jaw') {
      const openWide = jawOpen || isMoray || client.speciesId === 'grouper';
      along = (isMoray ? 0.24 : 0.96) * halfLen;
      upFrac = openWide ? -0.02 : -0.06;
      rightFrac = sideSign * (openWide ? 0.34 : 0.70);
      normFwd = openWide ? 0.88 : 0.55;
      normUp = openWide ? 0.12 : -0.06;
      normRight = sideSign * (openWide ? 0.42 : 0.78);
    } else if (zoneName === 'pectoral_axil') {
      along = (isMoray ? -0.16 : 0.26) * halfLen;
      upFrac = -0.34;
      rightFrac = sideSign * 0.92;
      normFwd = 0.05;
      normUp = -0.28;
      normRight = sideSign * 0.94;
    } else if (zoneName === 'flank') {
      const sweep = Math.sin(zoneProgress * Math.PI * 2);
      along = (isMoray ? -0.35 + sweep * 0.15 : -0.08 + sweep * 0.32) * halfLen;
      upFrac = 0.08 + Math.cos(zoneProgress * Math.PI * 2) * 0.12;
      rightFrac = sideSign * 1.0;
      normFwd = 0.0;
      normUp = 0.08;
      normRight = sideSign;
    } else {
      // 'dorsal_base'
      const sweep = Math.cos(zoneProgress * Math.PI * 2);
      along = (isMoray ? -0.28 + sweep * 0.14 : -0.05 + sweep * 0.30) * halfLen;
      upFrac = 0.96;
      rightFrac = sideSign * 0.38;
      normFwd = 0.0;
      normUp = 0.92;
      normRight = sideSign * 0.38;
    }

    // Surface point on client ellipsoid
    vInspect
      .copy(client.pos)
      .addScaledVector(cFwd, along)
      .addScaledVector(cRight, rightFrac * halfWidth)
      .addScaledVector(cUp, upFrac * halfHeight);

    vOutNorm
      .set(0, 0, 0)
      .addScaledVector(cFwd, normFwd)
      .addScaledVector(cRight, normRight)
      .addScaledVector(cUp, normUp);
    safeNormalize(vOutNorm, cRight.x * sideSign, 0.2, cRight.z * sideSign);

    const nipCycle = Math.sin(elapsedTime * 10.5 + w.phase * 1.7);
    const nipBurst = nipCycle > 0.32 ? Math.pow((nipCycle - 0.32) / 0.68, 1.45) : 0;
    const standoff = 0.058 + extraTier * 0.015 - nipBurst * 0.010;

    vTarget.copy(vInspect).addScaledVector(vOutNorm, standoff);
    return nipBurst;
  }

  function clampOutsideClientBody(pos, client) {
    const dims = client.dims || resolveClientDims(client.bodyHalfLen, client.speciesId);
    const isMoray = client.speciesId === 'moray';
    const centerShift = isMoray ? -0.18 * dims.halfLen : 0;

    vRel.copy(pos).sub(client.pos).addScaledVector(cFwd, -centerShift);
    const rx = vRel.dot(cRight);
    const ry = vRel.dot(cUp);
    const rz = vRel.dot(cFwd);

    const padW = dims.halfWidth + 0.044;
    const padH = dims.halfHeight + 0.040;
    const padL = dims.halfLen + 0.044;
    const eNorm = Math.hypot(rx / padW, ry / padH, rz / padL);
    if (eNorm < 1.0 && eNorm > 1e-5) {
      const push = 1.0 / eNorm;
      pos
        .copy(client.pos)
        .addScaledVector(cFwd, centerShift + rz * push)
        .addScaledVector(cRight, rx * push)
        .addScaledVector(cUp, ry * push);
    }
  }

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
      wrasses[i].ethologyPhase = 'advertising';
      wrasses[i].activeZone = null;
    }

    if (activeWrasseCount === 0) return;

    for (let i = 0; i < activeWrasseCount; i++) {
      const w = wrasses[i];
      const st = stationById.get(w.stationId) ?? stations[0];
      const clients = st.activeClients;

      let pitchOffset = 0;
      let rollOffset = 0;
      let bodyYaw = 0;
      let tailYaw = 0;
      let bodyAmp = 0.008;
      let finAmp = 0.012;

      if (clients.length === 0) {
        // Phase 1: Station Advertising — signature seesaw pitch-bobbing dance + labriform sculling
        w.servicingClientKey = null;
        w.ethologyPhase = 'advertising';
        w.activeZone = null;

        const roleSlot = w.role % 3;
        const angle = elapsedTime * 1.55 + w.phase + roleSlot * 2.094 + Math.floor(w.role / 3) * 1.05;
        const orbitR = 0.28 + Math.sin(elapsedTime * 2.3 + w.phase) * 0.12;
        const heave = Math.sin(elapsedTime * 4.6 + w.phase) * 0.11 + (roleSlot - 1) * 0.06;

        const tx = st.anchorPos.x + Math.cos(angle) * orbitR;
        const tz = st.anchorPos.z + Math.sin(angle) * orbitR;
        const floorY = getSeabedHeight(tx, tz) + 0.22;
        const ty = Math.min(surfaceLimitY, Math.max(floorY, st.anchorPos.y + heave));

        vTarget.set(tx, ty, tz);
        vDiff.subVectors(vTarget, w.pos);
        const dist = vDiff.length();
        if (dist > 1e-4) {
          const desiredSpeed = THREE.MathUtils.clamp(dist * 2.6, 0.22, 0.52);
          vDiff.multiplyScalar(desiredSpeed / dist);
          w.vel.lerp(vDiff, Math.min(1, dt * 5.2));
        }

        w.pos.addScaledVector(w.vel, dt);
        const minWrasseY = Math.min(surfaceLimitY - 0.05, getSeabedHeight(w.pos.x, w.pos.z) + 0.18);
        w.pos.y = THREE.MathUtils.clamp(w.pos.y, minWrasseY, surfaceLimitY);

        vForward.copy(w.vel);
        safeNormalize(vForward, -Math.sin(angle), 0, Math.cos(angle));

        // Signature steep oscillatory seesaw pitch + heightened pectoral rowing
        pitchOffset = Math.sin(elapsedTime * 7.8 + w.phase) * 0.36;
        rollOffset = Math.sin(elapsedTime * 3.9 + w.phase) * 0.12;
        const swim = elapsedTime * 12.5 + w.phase;
        bodyYaw = Math.sin(swim) * 0.08;
        tailYaw = Math.sin(swim - 0.6) * 0.36;
        bodyAmp = 0.008;
        finAmp = 0.017;
      } else {
        const client = clients[w.role % clients.length];
        w.servicingClientKey = client.key;

        cFwd.copy(client.heading);
        safeNormalize(cFwd, 0, 0, 1);
        cRight.crossVectors(worldUp, cFwd);
        safeNormalize(cRight, 1, 0, 0);
        cUp.crossVectors(cFwd, cRight);
        safeNormalize(cUp, 0, 1, 0);

        const dims = client.dims || resolveClientDims(client.bodyHalfLen, client.speciesId);
        const isPredator = dims.isPredator;
        const clientAge = Math.max(0, elapsedTime - (client.arrivedAt ?? elapsedTime));
        const massagePeriod = isPredator ? 4.2 : 5.8;
        const massageWindow = isPredator ? 1.35 : 0.85;
        const cyclePos = (clientAge + w.role * 1.45) % massagePeriod;
        const inMassagePhase = clientAge < (isPredator ? 1.45 : 1.0) || cyclePos < massageWindow;

        if (inMassagePhase) {
          // Phase 2: Tactile Dorsal Massage / Reconciliation along dorsal nape & upper flank
          w.ethologyPhase = 'tactile_massage';
          w.activeZone = 'dorsal_nape';

          const isMoray = client.speciesId === 'moray';
          const extraTier = Math.floor(w.role / 3);
          const strokeT = elapsedTime * 2.6 + w.phase;
          const napeAlong = (isMoray ? -0.08 + Math.sin(strokeT) * 0.18 : 0.28 + Math.sin(strokeT) * 0.24) * dims.halfLen;
          const sideWeave = Math.sin(strokeT * 0.85) * (dims.halfWidth * 0.55 + 0.022);
          const dorsalTouch = dims.halfHeight + 0.026 + extraTier * 0.018 + Math.sin(strokeT * 2.2) * 0.012;

          vTarget
            .copy(client.pos)
            .addScaledVector(cFwd, napeAlong)
            .addScaledVector(cRight, sideWeave)
            .addScaledVector(cUp, dorsalTouch);

          const targetFloor = getSeabedHeight(vTarget.x, vTarget.z) + 0.16;
          vTarget.y = Math.min(surfaceLimitY, Math.max(targetFloor, vTarget.y));

          vDiff.subVectors(vTarget, w.pos);
          const dist = vDiff.length();
          if (dist > 1e-4) {
            const desiredSpeed = THREE.MathUtils.clamp(dist * 5.2, 0.07, 0.78);
            vDiff.multiplyScalar(desiredSpeed / dist);
            w.vel.lerp(vDiff, Math.min(1, dt * 7.5));
          }

          w.pos.addScaledVector(w.vel, dt);
          clampOutsideClientBody(w.pos, client);
          const minWrasseY = Math.min(surfaceLimitY - 0.05, getSeabedHeight(w.pos.x, w.pos.z) + 0.16);
          w.pos.y = THREE.MathUtils.clamp(w.pos.y, minWrasseY, surfaceLimitY);

          // Swim smoothly along dorsal nape while brushing ventral/pelvic fins gently downward
          vForward
            .copy(cFwd)
            .addScaledVector(cRight, Math.cos(strokeT * 0.85) * 0.32)
            .addScaledVector(cUp, -0.10);
          safeNormalize(vForward, cFwd.x, 0, cFwd.z);

          pitchOffset = -0.12 + Math.sin(elapsedTime * 8.5 + w.phase) * 0.15;
          rollOffset = Math.sin(elapsedTime * 5.2 + w.phase) * 0.20;
          const swim = elapsedTime * 11.5 + w.phase;
          bodyYaw = Math.sin(swim) * 0.09;
          tailYaw = Math.sin(swim - 0.6) * 0.26;
          bodyAmp = 0.0095;
          finAmp = 0.0145;
        } else {
          // Phase 3: 5-Zone Anatomical Ectoparasite Nipping
          w.ethologyPhase = 'nipping';
          const zoneList =
            dims.jawOpen || client.speciesId === 'moray' || client.speciesId === 'grouper'
              ? PREDATOR_ZONE_CYCLE
              : ANATOMICAL_ZONES;
          const zoneIdx = Math.floor((elapsedTime * 0.85 + w.role * 1.7 + w.phase * 0.3) % zoneList.length);
          const zoneName = zoneList[zoneIdx];
          w.activeZone = zoneName;

          const nipBurst = computeAnatomicalZoneTarget(zoneName, client, w, elapsedTime);

          const targetFloor = getSeabedHeight(vTarget.x, vTarget.z) + 0.16;
          vTarget.y = Math.min(surfaceLimitY, Math.max(targetFloor, vTarget.y));

          vDiff.subVectors(vTarget, w.pos);
          const dist = vDiff.length();
          if (dist > 1e-4) {
            const desiredSpeed = THREE.MathUtils.clamp(dist * 6.5, 0.08, 0.96);
            vDiff.multiplyScalar(desiredSpeed / dist);
            w.vel.lerp(vDiff, Math.min(1, dt * 8.5));
          }

          w.pos.addScaledVector(w.vel, dt);
          clampOutsideClientBody(w.pos, client);
          const minWrasseY = Math.min(surfaceLimitY - 0.05, getSeabedHeight(w.pos.x, w.pos.z) + 0.16);
          w.pos.y = THREE.MathUtils.clamp(w.pos.y, minWrasseY, surfaceLimitY);

          // Orient snout directly toward the target anatomical zone during inspection & peck bursts
          vForward.subVectors(vInspect, w.pos);
          safeNormalize(vForward, -cRight.x, 0, -cRight.z);

          pitchOffset = Math.sin(elapsedTime * 11.5 + w.phase) * 0.14 - nipBurst * 0.22;
          rollOffset = Math.sin(elapsedTime * 6.2 + w.phase) * 0.10;
          const swim = elapsedTime * 13.5 + w.phase;
          bodyYaw = Math.sin(swim) * 0.06;
          tailYaw = Math.sin(swim - 0.6) * 0.30;
          bodyAmp = 0.0075;
          finAmp = 0.0135;
        }
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
        scratch,
        rollOffset
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
    getStationStates: () =>
      stations.map((st) => ({
        id: st.id,
        anchorPos: st.anchorPos.clone(),
        activeClientCount: st.activeClients.length,
        completedVisits: st.completedVisits,
        isOpen: st.isOpen,
      })),
    update,
  };
}
