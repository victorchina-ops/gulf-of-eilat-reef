import * as THREE from 'three';
import {
  MAX_STATIC_Y,
  clampGeometryTopY,
  createRng,
  fbm3D,
  prepareForMerge,
  safeMerge,
} from './utils.js';

const STRUCTURE_SPECS = [
  { id: 'fg-showcase', type: 'pinnacle', x: -1.6, z: 5.2, radius: 2.35, height: 1.85, seed: 101 },
  { id: 'fg-east', type: 'bommy', x: 5.6, z: 4.4, radius: 2.55, height: 1.55, seed: 102 },
  { id: 'fg-west', type: 'bommy', x: -6.8, z: 3.8, radius: 2.85, height: 1.72, seed: 103 },
  { id: 'reef-arch', type: 'arch', x: -2.0, z: 1.8, radius: 3.1, height: 1.95, seed: 104 },
  { id: 'canyon-east-mid', type: 'bommy', x: 4.6, z: -1.7, radius: 3.4, height: 1.95, seed: 105 },
  { id: 'canyon-west-mid', type: 'bommy', x: -5.8, z: -2.5, radius: 3.3, height: 1.92, seed: 106 },
  { id: 'undercut-cave-east', type: 'cave', x: 3.9, z: 0.9, radius: 2.45, height: 1.68, seed: 107 },
  { id: 'canyon-north-spur', type: 'bommy', x: -2.2, z: -6.3, radius: 3.1, height: 1.88, seed: 108 },
  { id: 'dropoff-west', type: 'buttress', x: -4.8, z: -10.6, radius: 3.7, height: 3.1, seed: 109 },
  { id: 'dropoff-east', type: 'buttress', x: 4.4, z: -11.2, radius: 3.8, height: 3.2, seed: 110 },
];

function displaceLimestoneLobe(geom, lx, lz, rx, ry, rz, baseSeabedY, noiseOffset, isCave = false, caveDirX = 1) {
  const pos = geom.attributes.position;
  for (let v = 0; v < pos.count; v++) {
    let vx = pos.getX(v);
    let vy = pos.getY(v);
    let vz = pos.getZ(v);

    // Multi-octave crags + horizontal carbonate reef ledges
    const nLarge = fbm3D(vx * 1.65 + noiseOffset, vy * 2.1, vz * 1.65 - noiseOffset, 4);
    const nFine = fbm3D(vx * 4.4, vy * 4.8 + noiseOffset, vz * 4.4, 2);
    const strata = Math.sin(vy * 8.5 + nLarge * 2.5 + noiseOffset) * 0.085;
    const disp = 0.74 + nLarge * 0.44 + (nFine - 0.5) * 0.14 + strata;

    // Terraced overhang flare on mid-upper shelves
    const shelfFlare = vy > 0.08 && vy < 0.52 ? 1.14 : vy < -0.25 ? 1.08 : 0.98;
    let dx = vx * rx * disp * shelfFlare;
    let dz = vz * rz * disp * shelfFlare;

    // Carve dramatic undercut cave recess on lower canyon-facing flank
    if (isCave && vy < 0.12 && vy > -0.65 && vx * caveDirX > 0.15) {
      const recess = Math.sin(((vy + 0.65) / 0.77) * Math.PI) * 0.52;
      dx *= 1.0 - recess;
      dz *= 1.0 - recess * 0.45;
    }

    const worldY = baseSeabedY - 0.65 + (vy + 1.0) * 0.5 * (ry * 2.05) * (0.86 + nLarge * 0.28);
    pos.setXYZ(v, lx + dx, Math.min(MAX_STATIC_Y - 0.48, worldY), lz + dz);
  }
  geom.computeVertexNormals();
  return geom;
}

function buildArchGeometry(spec, getSeabedHeight) {
  const rng = createRng(spec.seed);
  const parts = [];
  const baseSeabedY = getSeabedHeight(spec.x, spec.z);

  // Left & right craggy pillars flanking the swim-through at (-2.0, 1.8)
  for (const side of [-1, 1]) {
    const px = spec.x + side * 1.62;
    const pz = spec.z + side * 0.22;
    const py = getSeabedHeight(px, pz);
    const pillar = new THREE.IcosahedronGeometry(1, 4);
    displaceLimestoneLobe(pillar, px, pz, 1.12, 1.38, 1.18, py, rng() * 100, false, 1);
    parts.push(prepareForMerge(pillar));
    pillar.dispose();
  }

  // Sculpted overarching limestone bridge spanning the two pillars
  const bridge = new THREE.TorusGeometry(1.62, 0.58, 18, 36, Math.PI * 1.08);
  bridge.rotateZ(-0.04 * Math.PI);
  bridge.rotateY(-0.14);
  const bPos = bridge.attributes.position;
  const off = rng() * 80;
  for (let i = 0; i < bPos.count; i++) {
    let x = bPos.getX(i);
    let y = bPos.getY(i);
    let z = bPos.getZ(i);
    const n = fbm3D(x * 1.4 + off, y * 1.8, z * 1.4, 4);
    const strata = Math.sin(y * 7.5 + n * 2.0) * 0.08;
    const scale = 0.8 + n * 0.44 + strata;
    x *= scale;
    z *= scale * 1.28;
    y = Math.min(MAX_STATIC_Y - 0.52, baseSeabedY + 0.42 + y * 1.08 * scale);
    bPos.setXYZ(i, spec.x + x, y, spec.z + z);
  }
  bridge.computeVertexNormals();
  parts.push(prepareForMerge(bridge));
  bridge.dispose();

  return parts;
}

function buildStructureGeometry(spec, getSeabedHeight) {
  const rng = createRng(spec.seed);
  const baseSeabedY = getSeabedHeight(spec.x, spec.z);
  const parts = [];

  if (spec.type === 'arch') {
    parts.push(...buildArchGeometry(spec, getSeabedHeight));
  } else {
    const lobeCount = spec.type === 'pinnacle' ? 5 : 6;
    for (let i = 0; i < lobeCount; i++) {
      const isMain = i === 0;
      const angle = (i / Math.max(1, lobeCount - 1)) * Math.PI * 2 + rng() * 0.55;
      const dist = isMain ? 0 : spec.radius * (0.34 + rng() * 0.30);
      const lx = spec.x + Math.cos(angle) * dist;
      const lz = spec.z + Math.sin(angle) * dist;
      const localSeabed = getSeabedHeight(lx, lz);

      const rx = isMain ? spec.radius * 0.78 : spec.radius * (0.40 + rng() * 0.24);
      const rz = isMain ? spec.radius * 0.74 : spec.radius * (0.38 + rng() * 0.24);
      const ry = isMain ? spec.height * 0.66 : spec.height * (0.35 + rng() * 0.26);

      const geom = new THREE.IcosahedronGeometry(1, 4);
      displaceLimestoneLobe(
        geom,
        lx,
        lz,
        rx,
        ry,
        rz,
        localSeabed,
        rng() * 120,
        spec.type === 'cave' && isMain,
        spec.x > 0 ? -1 : 1
      );
      parts.push(prepareForMerge(geom));
      geom.dispose();
    }
  }

  // Scattered carbonate reef rubble boulders around base
  for (let r = 0; r < 4; r++) {
    const a = rng() * Math.PI * 2;
    const d = spec.radius * (0.76 + rng() * 0.32);
    const bx = spec.x + Math.cos(a) * d;
    const bz = spec.z + Math.sin(a) * d;
    const by = getSeabedHeight(bx, bz);
    const br = 0.28 + rng() * 0.36;
    const bGeom = new THREE.IcosahedronGeometry(br, 2);
    const bPos = bGeom.attributes.position;
    const off = rng() * 50;
    for (let v = 0; v < bPos.count; v++) {
      const px = bPos.getX(v);
      const py = bPos.getY(v);
      const pz = bPos.getZ(v);
      const n = 0.72 + fbm3D(px * 3.2 + off, py * 3.2, pz * 3.2, 2) * 0.54;
      bPos.setXYZ(v, bx + px * n * 1.2, by - 0.14 + py * n * 0.72, bz + pz * n);
    }
    bGeom.computeVertexNormals();
    parts.push(prepareForMerge(bGeom));
    bGeom.dispose();
  }

  const merged = safeMerge(parts);
  clampGeometryTopY(merged, MAX_STATIC_Y - 0.48);

  // Stratified limestone, crustose coralline pink/violet algae, turf crevices & sand shelves
  const pos = merged.attributes.position;
  const norm = merged.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const cLimestone = new THREE.Color('#807461');
  const cSand = new THREE.Color('#bdb194');
  const cCoralline = new THREE.Color('#a65479');
  const cTurf = new THREE.Color('#4a5838');
  const cCrevice = new THREE.Color('#302c26');
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const ny = norm.getY(i);

    const patch = fbm3D(px * 0.85, py * 1.15, pz * 0.85, 3);
    const strata = Math.sin(py * 9.0 + patch * 3.0) * 0.5 + 0.5;
    const fine = fbm3D(px * 3.4 + 17, py * 3.4, pz * 3.4, 2);

    tmp.copy(cLimestone);
    if (ny > 0.52) {
      tmp.lerp(cSand, Math.min(1, (ny - 0.52) * 1.55) * (0.45 + 0.35 * patch));
    } else if (ny < -0.08) {
      tmp.lerp(cCrevice, 0.62);
    }

    if (patch > 0.54 && py > baseSeabedY + 0.1) {
      tmp.lerp(cCoralline, Math.min(0.75, (patch - 0.54) * 1.9));
    } else if (patch < 0.43) {
      tmp.lerp(cTurf, Math.min(0.7, (0.43 - patch) * 1.5));
    }

    const shade = 0.78 + fine * 0.28 + strata * 0.12;
    tmp.multiplyScalar(shade);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return merged;
}

export function createReefBommies({ applyUnderwaterMaterial, getSeabedHeight }) {
  const group = new THREE.Group();
  group.name = 'reef-bommies';

  const rockMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.91,
      metalness: 0.02,
    }),
    { receiveCaustics: true, causticsStrength: 1.0 }
  );

  const bommies = [];
  const meshes = [];

  for (const spec of STRUCTURE_SPECS) {
    const geom = buildStructureGeometry(spec, getSeabedHeight);
    const mesh = new THREE.Mesh(geom, rockMat);
    mesh.name = `bommy-${spec.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    group.add(mesh);
    meshes.push(mesh);

    bommies.push({
      ...spec,
      mesh,
      baseY: getSeabedHeight(spec.x, spec.z),
    });
  }

  // Exact vertical substrate sampler onto sculpted limestone tops & canyon walls
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);

  function sampleSubstrate(x, z) {
    origin.set(x, 6.0, z);
    raycaster.set(origin, down);
    const hits = raycaster.intersectObjects(meshes, false);
    const seabedY = getSeabedHeight(x, z);
    if (hits.length > 0 && hits[0].point.y > seabedY) {
      return {
        y: hits[0].point.y,
        normal: hits[0].face ? hits[0].face.normal.clone() : new THREE.Vector3(0, 1, 0),
        onRock: true,
      };
    }
    return {
      y: seabedY,
      normal: new THREE.Vector3(0, 1, 0),
      onRock: false,
    };
  }

  const caves = [
    { position: new THREE.Vector3(3.1, getSeabedHeight(3.1, 0.9) + 0.38, 0.9), radius: 1.2 },
    { position: new THREE.Vector3(-2.0, getSeabedHeight(-2.0, 1.8) + 0.45, 1.8), radius: 1.35 },
  ];

  return {
    group,
    bommies,
    caves,
    sampleSubstrate,
  };
}
