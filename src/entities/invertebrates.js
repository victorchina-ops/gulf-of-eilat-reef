import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DEFAULT_ENV_STATE,
  SPECIES_POPULATION_SPEC,
  WORLD_CONSTANTS,
  sanitizeSpeciesCount,
} from '../contracts.js';
import {
  MAX_STATIC_Y,
  configureDynamicMesh,
  createPlacementRegistry,
  createRng,
  enableShadows,
  prepareForMerge,
  safeMerge,
  safeNormalize,
} from './utils.js';
import { sampleFlowField, sampleWaveOrbital } from '../physics/flowField.js';

const UP_VEC = new THREE.Vector3(0, 1, 0);

// 1. Entacmaea quadricolor (Gulf of Eilat plump curved zooxanthellate tentacles)
function buildBubbleTentacleGeometry() {
  const rings = 10;
  const radialSegs = 8;

  const smooth = (a, b, x) => {
    const u = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
    return u * u * (3 - 2 * u);
  };

  const sampleRadius = (t) => {
    if (t <= 0.20) return THREE.MathUtils.lerp(0.030, 0.032, smooth(0.0, 0.20, t));
    if (t <= 0.62) return THREE.MathUtils.lerp(0.032, 0.035, smooth(0.20, 0.62, t));
    if (t <= 0.76) return THREE.MathUtils.lerp(0.035, 0.040, smooth(0.62, 0.76, t));
    if (t <= 0.90) return THREE.MathUtils.lerp(0.040, 0.030, smooth(0.76, 0.90, t));
    const u = THREE.MathUtils.clamp((t - 0.90) / 0.10, 0, 1);
    return 0.030 * Math.sqrt(Math.max(0, 1 - u * u));
  };

  const cBase = new THREE.Color('#826437');
  const cLower = new THREE.Color('#8e7b44');
  const cShaft = new THREE.Color('#93b464');
  const cShaftHi = cShaft.clone().lerp(new THREE.Color('#e3dfc8'), 0.12);
  const cBand = new THREE.Color('#e3dfc8');
  const cBandTip = cBand.clone().lerp(new THREE.Color('#cfa197'), 0.15);
  const cTip = new THREE.Color('#cfa197');
  const tmpColor = new THREE.Color();

  const sampleColor = (t, out) => {
    if (t <= 0.26) return out.copy(cBase).lerp(cLower, t / 0.26);
    if (t <= 0.46) return out.copy(cLower).lerp(cShaft, (t - 0.26) / 0.20);
    if (t <= 0.66) return out.copy(cShaft).lerp(cShaftHi, (t - 0.46) / 0.20);
    if (t <= 0.77) return out.copy(cShaftHi).lerp(cBand, (t - 0.66) / 0.11);
    if (t <= 0.85) return out.copy(cBand).lerp(cBandTip, (t - 0.77) / 0.08);
    return out.copy(cBandTip).lerp(cTip, (t - 0.85) / 0.15);
  };

  const ringVertCount = rings * radialSegs;
  const vertCount = ringVertCount + 1;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices = [];

  for (let rIdx = 0; rIdx < rings; rIdx++) {
    const t = rIdx / rings;
    const radius = sampleRadius(t);
    const curveX = Math.sin(t * Math.PI * 0.68) * 0.034;
    sampleColor(t, tmpColor);

    for (let sIdx = 0; sIdx < radialSegs; sIdx++) {
      const theta = (sIdx / radialSegs) * Math.PI * 2;
      const v = rIdx * radialSegs + sIdx;
      positions[v * 3] = curveX + Math.cos(theta) * radius;
      positions[v * 3 + 1] = t;
      positions[v * 3 + 2] = Math.sin(theta) * radius;
      colors[v * 3] = tmpColor.r;
      colors[v * 3 + 1] = tmpColor.g;
      colors[v * 3 + 2] = tmpColor.b;
    }
  }

  // Closed smooth rounded dome apex at t = 1.0
  const apexIdx = ringVertCount;
  positions[apexIdx * 3] = Math.sin(Math.PI * 0.68) * 0.034;
  positions[apexIdx * 3 + 1] = 1.0;
  positions[apexIdx * 3 + 2] = 0.0;
  sampleColor(1.0, tmpColor);
  colors[apexIdx * 3] = tmpColor.r;
  colors[apexIdx * 3 + 1] = tmpColor.g;
  colors[apexIdx * 3 + 2] = tmpColor.b;

  for (let rIdx = 0; rIdx < rings - 1; rIdx++) {
    for (let sIdx = 0; sIdx < radialSegs; sIdx++) {
      const nextS = (sIdx + 1) % radialSegs;
      const v00 = rIdx * radialSegs + sIdx;
      const v01 = rIdx * radialSegs + nextS;
      const v10 = (rIdx + 1) * radialSegs + sIdx;
      const v11 = (rIdx + 1) * radialSegs + nextS;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }

  const lastRingOffset = (rings - 1) * radialSegs;
  for (let sIdx = 0; sIdx < radialSegs; sIdx++) {
    const nextS = (sIdx + 1) % radialSegs;
    indices.push(lastRingOffset + sIdx, apexIdx, lastRingOffset + nextS);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setIndex(indices);
  const welded = mergeVertices(geom, 1e-4);
  geom.dispose();
  welded.computeVertexNormals();
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

function buildAnemoneDiscGeometry() {
  const parts = [];
  const cBase = new THREE.Color('#5c4324');
  const cTop = new THREE.Color('#886c3e');
  const cLip = new THREE.Color('#9c7f4e');
  const cStoma = new THREE.Color('#332312');

  const cyl = new THREE.CylinderGeometry(0.32, 0.25, 0.17, 22, 3);
  cyl.translate(0, 0.075, 0);
  const pos = cyl.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const angle = Math.atan2(z, x);
    const edgeWave = Math.sin(angle * 7.0) * 0.026 * (r / 0.32);
    const bowlDip = y > 0.13 && r < 0.14 ? -0.014 * (1.0 - r / 0.14) : 0;
    const radialCrease = y > 0.13 ? Math.cos(angle * 14.0) * 0.004 * (r / 0.32) : 0;
    pos.setY(i, y + edgeWave + bowlDip + radialCrease);
  }
  cyl.computeVertexNormals();
  parts.push(
    prepareForMerge(cyl, (_x, y, _z, _nx, _ny, _nz, out) => {
      out.copy(cBase).lerp(cTop, THREE.MathUtils.clamp(y / 0.17, 0, 1));
    })
  );
  cyl.dispose();

  // Sculpted folded central oral peristome lip ring
  const lip = new THREE.TorusGeometry(0.058, 0.021, 8, 18);
  lip.rotateX(Math.PI * 0.5);
  lip.translate(0, 0.155, 0);
  const lPos = lip.attributes.position;
  for (let i = 0; i < lPos.count; i++) {
    const x = lPos.getX(i);
    const y = lPos.getY(i);
    const z = lPos.getZ(i);
    const theta = Math.atan2(z, x);
    const foldY = Math.sin(theta * 6.0) * 0.008 + Math.cos(theta * 10.0) * 0.005;
    const foldR = 1.0 + Math.sin(theta * 8.0) * 0.14;
    lPos.setXYZ(i, x * foldR, y + foldY, z * foldR);
  }
  lip.computeVertexNormals();
  parts.push(
    prepareForMerge(lip, (_x, y, _z, _nx, _ny, _nz, out) => {
      out.copy(cTop).lerp(cLip, THREE.MathUtils.clamp((y - 0.135) / 0.04, 0, 1));
    })
  );
  lip.dispose();

  // Recessed central oral stoma slit
  const stoma = new THREE.SphereGeometry(0.038, 12, 8);
  stoma.scale(1.15, 0.42, 0.65);
  stoma.translate(0, 0.146, 0);
  parts.push(prepareForMerge(stoma, cStoma));
  stoma.dispose();

  return safeMerge(parts);
}

// 2. Diadema setosum
function buildDiademaTestGeometry() {
  const parts = [];
  const cTest = new THREE.Color('#0c0d11');
  const cAnal = new THREE.Color('#ff5c1a');
  const cBlueDot = new THREE.Color('#1f9bff');

  const test = new THREE.SphereGeometry(0.19, 18, 12);
  test.scale(1.0, 0.72, 1.0);
  parts.push(prepareForMerge(test, cTest));
  test.dispose();

  const analRing = new THREE.TorusGeometry(0.036, 0.011, 8, 16);
  analRing.rotateX(Math.PI * 0.5);
  analRing.translate(0, 0.136, 0);
  parts.push(prepareForMerge(analRing, cAnal));
  analRing.dispose();

  const analCone = new THREE.ConeGeometry(0.022, 0.032, 10);
  analCone.translate(0, 0.144, 0);
  parts.push(prepareForMerge(analCone, new THREE.Color('#281814')));
  analCone.dispose();

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const dot = new THREE.SphereGeometry(0.017, 8, 6);
    dot.scale(1.0, 0.6, 1.0);
    dot.translate(Math.cos(a) * 0.088, 0.123, Math.sin(a) * 0.088);
    parts.push(prepareForMerge(dot, cBlueDot));
    dot.dispose();
  }
  return safeMerge(parts);
}

function buildDiademaSpineGeometry() {
  const cone = new THREE.ConeGeometry(0.012, 1.0, 5, 1);
  cone.translate(0, 0.5, 0);
  const cRoot = new THREE.Color('#171820');
  const cTip = new THREE.Color('#060709');
  const geom = prepareForMerge(cone, (_x, y, _z, _nx, _ny, _nz, out) => {
    out.copy(cRoot).lerp(cTip, THREE.MathUtils.clamp(y, 0, 1));
  });
  cone.dispose();
  return geom;
}

// 3. Tridacna maxima (Maxima Giant Clam: fluted scalloped shell valves + wavy iridescent mantle)
function buildTridacnaShellGeometry() {
  const parts = [];
  const cShell = new THREE.Color('#b5ac98');
  const cCrevice = new THREE.Color('#706a5c');

  for (const side of [-1, 1]) {
    const valve = new THREE.SphereGeometry(0.24, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const pos = valve.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) * 1.35;
      let y = pos.getY(i) * 0.85;
      let z = pos.getZ(i) * 0.42;
      // Scalloped radial flutes
      const angle = Math.atan2(y, x);
      const flute = Math.sin(angle * 7.0) * 0.032 * (y / 0.22);
      z += flute * side;
      pos.setXYZ(i, x, y, z + side * 0.055);
    }
    valve.rotateX(side * -0.34);
    valve.computeVertexNormals();
    parts.push(
      prepareForMerge(valve, (_x, y, _z, _nx, _ny, _nz, out) => {
        out.copy(cCrevice).lerp(cShell, THREE.MathUtils.clamp(y / 0.22, 0, 1));
      })
    );
    valve.dispose();
  }
  return safeMerge(parts);
}

function buildTridacnaMantleGeometry() {
  const mantle = new THREE.BoxGeometry(0.56, 0.09, 0.20, 20, 2, 8);
  mantle.translate(0, 0.16, 0);
  const pos = mantle.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const xNorm = x / 0.28;
    const curve = Math.cos(xNorm * Math.PI * 0.45);
    const ruffle = Math.sin(x * 24.0) * 0.028 * Math.sign(z || 1);
    z = z * (0.55 + 0.55 * curve) + ruffle;
    y += Math.sin(x * 18.0) * 0.014;
    pos.setXYZ(i, x * (0.95 + 0.05 * curve), y, z);
  }
  mantle.computeVertexNormals();
  const cInner = new THREE.Color('#1a3b7a');
  const cEdge = new THREE.Color('#ffffff'); // bright electric cyan/blue via instanceColor
  const geom = prepareForMerge(mantle, (x, _y, z, _nx, _ny, _nz, out) => {
    const edge = THREE.MathUtils.clamp(Math.abs(z) / 0.09 + Math.abs(x) * 0.5, 0, 1);
    out.copy(cInner).lerp(cEdge, edge);
  });
  mantle.dispose();
  return geom;
}

// 4. Fromia ghardaqana (5-armed Red Sea Crimson Starfish)
function buildStarfishGeometry() {
  const parts = [];
  const cCrimson = new THREE.Color('#d4242a');
  const cTip = new THREE.Color('#ff5e3a');
  const cTubercle = new THREE.Color('#ffd6b3');

  const disc = new THREE.SphereGeometry(0.065, 12, 8);
  disc.scale(1.0, 0.42, 1.0);
  parts.push(prepareForMerge(disc, cCrimson));
  disc.dispose();

  for (let a = 0; a < 5; a++) {
    const theta = (a / 5) * Math.PI * 2;
    const arm = new THREE.ConeGeometry(0.036, 0.175, 8, 3);
    arm.rotateZ(-Math.PI * 0.5);
    arm.scale(1.0, 0.48, 0.88);
    arm.translate(0.11, 0.008, 0);
    arm.rotateY(theta);

    parts.push(
      prepareForMerge(arm, (x, y, z, _nx, _ny, _nz, out) => {
        const r = Math.hypot(x, z);
        const dot = Math.sin(r * 95.0) * Math.cos(Math.atan2(z, x) * 18.0);
        if (dot > 0.72 && y > 0.01) out.copy(cTubercle);
        else out.copy(cCrimson).lerp(cTip, THREE.MathUtils.clamp((r - 0.06) / 0.14, 0, 1));
      })
    );
    arm.dispose();
  }
  return safeMerge(parts);
}

// 5. Sea Cucumber (מלפפון ים - Holothuria edulis & Pearsonothuria graeffei)
function buildSeaCucumberGeometry() {
  const parts = [];
  // Elongated cylindrical holothurian body along +Z with dorsal papillae bumps & anterior tentacle crown
  const body = new THREE.CapsuleGeometry(0.062, 0.34, 8, 16);
  body.rotateX(Math.PI * 0.5);
  body.scale(1.05, 0.78, 1.0);
  body.translate(0, 0.048, 0);

  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const bump = Math.max(0, Math.sin(z * 42.0) * Math.cos(x * 38.0)) * 0.009;
    y += y > 0.045 ? bump : 0;
    pos.setXYZ(i, x, y, z);
  }
  body.computeVertexNormals();
  parts.push(
    prepareForMerge(body, (_x, y, z, _nx, _ny, _nz, out) => {
      // Base luminance pattern (tinted by instanceColor for Holothuria rose-black vs Pearsonothuria mottled cream)
      const dorsal = THREE.MathUtils.clamp((y - 0.01) / 0.08, 0, 1);
      const band = Math.sin(z * 26.0) * 0.12;
      out.setRGB(0.68 + dorsal * 0.25 + band, 0.64 + dorsal * 0.22 + band, 0.62 + dorsal * 0.2 + band);
    })
  );
  body.dispose();

  // Anterior peltate oral tentacle crown at +Z
  const cCrown = new THREE.Color('#f0dec2');
  for (let t = 0; t < 8; t++) {
    const a = (t / 8) * Math.PI * 2;
    const tent = new THREE.ConeGeometry(0.010, 0.045, 5);
    tent.rotateX(Math.PI * 0.42);
    tent.rotateZ(a);
    tent.translate(Math.cos(a) * 0.028, 0.045 + Math.sin(a) * 0.022, 0.235);
    parts.push(prepareForMerge(tent, cCrown));
    tent.dispose();
  }

  return safeMerge(parts);
}

// 6. Crinoid Feather Star (continuous curved spline tapered tube + delicate pinnules)
function buildFeatherStarArmGeometry() {
  const parts = [];
  const cStem = new THREE.Color('#e6c24c');
  const cTip = new THREE.Color('#fff2b2');
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.0, 0.0),
    new THREE.Vector3(0, 0.085, 0.018),
    new THREE.Vector3(0, 0.185, 0.068),
    new THREE.Vector3(0, 0.265, 0.142),
    new THREE.Vector3(0, 0.305, 0.225),
  ]);

  // Continuous tapered curved central rachis tube
  const tubularSegs = 16;
  const radialSegs = 6;
  const frames = curve.computeFrenetFrames(tubularSegs, false);
  const vertCount = (tubularSegs + 1) * radialSegs + 1;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices = [];
  const tmpPt = new THREE.Vector3();
  const tmpCol = new THREE.Color();

  for (let i = 0; i <= tubularSegs; i++) {
    const t = i / tubularSegs;
    curve.getPointAt(t, tmpPt);
    const radius = 0.0085 * (1 - t * 0.72);
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    tmpCol.copy(cStem).lerp(cTip, t * 0.85);

    for (let s = 0; s < radialSegs; s++) {
      const ang = (s / radialSegs) * Math.PI * 2;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      const v = i * radialSegs + s;
      positions[v * 3] = tmpPt.x + radius * (cosA * normal.x + sinA * binormal.x);
      positions[v * 3 + 1] = tmpPt.y + radius * (cosA * normal.y + sinA * binormal.y);
      positions[v * 3 + 2] = tmpPt.z + radius * (cosA * normal.z + sinA * binormal.z);
      colors[v * 3] = tmpCol.r;
      colors[v * 3 + 1] = tmpCol.g;
      colors[v * 3 + 2] = tmpCol.b;
    }
  }

  const tipIdx = (tubularSegs + 1) * radialSegs;
  curve.getPointAt(1, tmpPt);
  positions[tipIdx * 3] = tmpPt.x;
  positions[tipIdx * 3 + 1] = tmpPt.y + 0.004;
  positions[tipIdx * 3 + 2] = tmpPt.z + 0.005;
  colors[tipIdx * 3] = cTip.r;
  colors[tipIdx * 3 + 1] = cTip.g;
  colors[tipIdx * 3 + 2] = cTip.b;

  for (let i = 0; i < tubularSegs; i++) {
    for (let s = 0; s < radialSegs; s++) {
      const nextS = (s + 1) % radialSegs;
      const a = i * radialSegs + s;
      const b = i * radialSegs + nextS;
      const c = (i + 1) * radialSegs + s;
      const d = (i + 1) * radialSegs + nextS;
      indices.push(a, c, d, a, d, b);
    }
  }
  const lastRow = tubularSegs * radialSegs;
  for (let s = 0; s < radialSegs; s++) {
    const nextS = (s + 1) % radialSegs;
    indices.push(lastRow + s, tipIdx, lastRow + nextS);
  }

  const rawStem = new THREE.BufferGeometry();
  rawStem.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  rawStem.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  rawStem.setIndex(indices);
  const stem = mergeVertices(rawStem, 1e-4);
  rawStem.dispose();
  stem.computeVertexNormals();
  parts.push(prepareForMerge(stem));
  stem.dispose();

  // Feathery curved V-pinnules along spline tangent
  const pinCount = 14;
  const tanVec = new THREE.Vector3();
  const baseMat = new THREE.Matrix4();
  const qPin = new THREE.Quaternion();
  const scaleOne = new THREE.Vector3(1, 1, 1);
  for (let p = 0; p < pinCount; p++) {
    const t = 0.12 + (p / (pinCount - 1)) * 0.82;
    curve.getPointAt(t, tmpPt);
    curve.getTangentAt(t, tanVec);
    const pinLen = 0.036 * (1 - t * 0.42);
    const pinCol = cStem.clone().lerp(cTip, 0.35 + t * 0.65);

    for (const side of [-1, 1]) {
      const dir = safeNormalize(
        new THREE.Vector3(side * 0.82, tanVec.y * 0.45 + 0.35, tanVec.z * 0.55),
        side,
        0.5,
        0
      );
      const pin = new THREE.ConeGeometry(0.0026 * (1 - t * 0.3), pinLen, 4);
      pin.translate(0, pinLen * 0.5, 0);
      qPin.setFromUnitVectors(UP_VEC, dir);
      baseMat.compose(tmpPt, qPin, scaleOne);
      pin.applyMatrix4(baseMat);
      parts.push(prepareForMerge(pin, pinCol));
      pin.dispose();
    }
  }

  return safeMerge(parts);
}

export function createInvertebrates({
  applyUnderwaterMaterial,
  sampleSubstrate,
  getSeabedHeight,
  placementRegistry = null,
  sampleFootprint = null,
  getSubstrateHeight = null,
  bommies = [],
}) {
  const group = new THREE.Group();
  group.name = 'reef-invertebrates';

  const registry = placementRegistry || createPlacementRegistry();

  function evalFootprint(x, z, radius = 0.32) {
    if (typeof sampleFootprint === 'function') {
      return sampleFootprint(x, z, radius);
    }
    const r = Math.max(0.12, radius * 0.85);
    const readY = typeof getSubstrateHeight === 'function'
      ? (px, pz) => getSubstrateHeight(px, pz)
      : (px, pz) => sampleSubstrate(px, pz).y;
    const cSub = sampleSubstrate(x, z);
    const hC = cSub.y;
    const hE = readY(x + r, z);
    const hW = readY(x - r, z);
    const hN = readY(x, z - r);
    const hS = readY(x, z + r);
    const minY = Math.min(hC, hE, hW, hN, hS);
    const maxY = Math.max(hC, hE, hW, hN, hS);
    const relief = maxY - minY;
    const slope = Math.max(Math.abs(hE - hW) / (2 * r), Math.abs(hN - hS) / (2 * r), relief / (2 * r));
    return {
      minY,
      maxY,
      slope,
      onRock: Boolean(cSub.onRock),
      valid: relief <= Math.max(0.32, radius * 0.95) && slope <= 1.15,
    };
  }

  const pickableMeshes = [];
  const anemoneAnchors = [];

  const commonMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.05,
    }),
    { receiveCaustics: true, causticsStrength: 0.95 }
  );

  const mantleMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.36,
      metalness: 0.12,
    }),
    { receiveCaustics: true, causticsStrength: 1.0 }
  );

  const dummy = new THREE.Object3D();
  const baseQuat = new THREE.Quaternion();
  const localQuat = new THREE.Quaternion();
  const hydroQuat = new THREE.Quaternion();
  const swayQuat = new THREE.Quaternion();
  const swayAxis = new THREE.Vector3();
  const hydroAxis = new THREE.Vector3();
  const armEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const tmpMat = new THREE.Matrix4();
  const tmpScale = new THREE.Vector3();
  const _flowVec = new THREE.Vector3();
  const _waveVel = new THREE.Vector3();

  const bonusRng = createRng(2901);

  const CLEANING_STATION_COORDS = [
    [1.75, 4.55],
    [1.15, -2.5],
    [-4.10, 5.35],
    [-3.2, -5.6],
    [0.35, -8.2],
  ];

  function isClearOf(x, z, list, minSep, clearR = 0.28) {
    if (Math.hypot(x + 2.0, z - 1.8) < 1.20) return false;
    for (let i = 0; i < CLEANING_STATION_COORDS.length; i++) {
      if (Math.hypot(x - CLEANING_STATION_COORDS[i][0], z - CLEANING_STATION_COORDS[i][1]) < 1.35) {
        return false;
      }
    }
    if (!registry.isFree(x, z, clearR, ['canopy', 'benthic'])) return false;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const px = Array.isArray(p) ? p[0] : p.x;
      const pz = Array.isArray(p) ? p[1] : p.z;
      if (Math.hypot(x - px, z - pz) < minSep) return false;
    }
    return true;
  }

  function resolveValidatedInvertSpot(origX, origZ, clearR, footprintR, opts = {}) {
    const preferRock = Boolean(opts.preferRock ?? true);
    const maxYLimit = opts.maxY ?? (MAX_STATIC_Y - 0.35);
    const minYLimit = opts.minY ?? -4.0;
    const initialSub = sampleSubstrate(origX, origZ);

    let bestFallback = null;
    for (let step = 0; step <= 160; step++) {
      let cx = origX;
      let cz = origZ;
      if (step > 0) {
        const ring = 1 + Math.floor((step - 1) / 8);
        const sr = 0.22 * ring;
        const ang = step * 2.399963229728653;
        cx = origX + Math.cos(ang) * sr;
        cz = origZ + Math.sin(ang) * sr;
      }

      if (Math.hypot(cx + 2.0, cz - 1.8) < 1.15) continue;
      if (!registry.isFree(cx, cz, clearR, ['canopy', 'benthic'])) continue;

      const fp = evalFootprint(cx, cz, footprintR);
      const sub = step === 0 ? initialSub : sampleSubstrate(cx, cz);
      if (sub.y < minYLimit || sub.y > maxYLimit) continue;
      if (opts.sandOnly && sub.onRock) continue;

      const candidate = { x: cx, z: cz, sub, fp };
      if (!bestFallback || (fp.slope < bestFallback.fp.slope && (!preferRock || sub.onRock || !bestFallback.sub.onRock))) {
        bestFallback = candidate;
      }

      if (!fp.valid) continue;
      if (preferRock && step < 48 && !sub.onRock) continue;
      return candidate;
    }

    if (bestFallback) return bestFallback;

    // Global clear fallback if local ring is fully occupied
    for (let attempt = 0; attempt < 300; attempt++) {
      const r = 1.4 + Math.sqrt((attempt + 0.5) / 300) * 11.5;
      const a = attempt * 2.399963229728653;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r - 1.0;
      if (Math.hypot(cx + 2.0, cz - 1.8) < 1.15) continue;
      if (!registry.isFree(cx, cz, clearR, ['canopy', 'benthic'])) continue;
      const sub = sampleSubstrate(cx, cz);
      if (sub.y < minYLimit || sub.y > maxYLimit) continue;
      if (opts.sandOnly && sub.onRock) continue;
      const fp = evalFootprint(cx, cz, footprintR);
      if (fp.valid) return { x: cx, z: cz, sub, fp };
    }

    return {
      x: origX,
      z: origZ,
      sub: initialSub,
      fp: evalFootprint(origX, origZ, footprintR),
    };
  }

  function findBonusReefSpot(existingList, minSep, maxY, preferRock = true, clearR = 0.30) {
    for (let attempt = 0; attempt < 450; attempt++) {
      const r = 1.2 + Math.sqrt(bonusRng()) * 11.2;
      const a = bonusRng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 1.0;
      if (!isClearOf(x, z, existingList, minSep, clearR)) continue;
      const fp = evalFootprint(x, z, clearR * 0.9);
      if (!fp.valid) continue;
      const sub = sampleSubstrate(x, z);
      if (preferRock && attempt < 300 && !sub.onRock) continue;
      if (sub.y < -3.8 || sub.y > maxY) continue;
      return { x, z, sub, fp };
    }
    return null;
  }

  function findBonusSandSpot(existingList, minSep, clearR = 0.28) {
    for (let attempt = 0; attempt < 600; attempt++) {
      const r = 0.8 + Math.sqrt(bonusRng()) * 12.5;
      const a = bonusRng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 0.5;
      if (!isClearOf(x, z, existingList, minSep, clearR)) continue;
      const sub = sampleSubstrate(x, z);
      if (sub.onRock) continue;
      const h = getSeabedHeight(x, z);
      if (h >= -0.58 || h < -4.2) continue;
      const slopeX = getSeabedHeight(x + 0.25, z) - getSeabedHeight(x - 0.25, z);
      const slopeZ = getSeabedHeight(x, z + 0.25) - getSeabedHeight(x, z - 0.25);
      if (Math.hypot(slopeX, slopeZ) / 0.5 >= 0.14) continue;
      return { x, z, h };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // 1. Entacmaea quadricolor (8 -> 14 prominent lush anemones, 118 tentacles each)
  // ---------------------------------------------------------------------------
  const anemoneDiscMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.58,
      metalness: 0.03,
    }),
    { receiveCaustics: true, causticsStrength: 0.95 }
  );

  const tentacleMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.44,
      metalness: 0.02,
      emissive: new THREE.Color('#222814'),
      emissiveIntensity: 0.10,
    }),
    { receiveCaustics: true, causticsStrength: 0.98 }
  );

  const tentacleTipPalettes = [
    '#fff6f4', // Morph 0: Classic Eilat Sage + Rose-Blush Tip (Anemone Close-up)
    '#eff7de', // Morph 1: Sunlit Chartreuse-Cream Tip
    '#faf0df', // Morph 2: Warm Honey-Olive + Pearl Tip
    '#f7ecee', // Morph 3: Soft Olive-Green + Mauve-Blush Tip
  ];

  const anemoneSpots = [
    { x: -1.65, z: 5.25, morph: tentacleTipPalettes[0], scale: 1.94, seed: 2101 }, // foreground pinnacle showcase
    { x: -1.15, z: 4.85, morph: tentacleTipPalettes[1], scale: 1.81, seed: 2102 }, // foreground pinnacle #2
    { x: 2.70, z: -1.60, morph: tentacleTipPalettes[2], scale: 2.08, seed: 2103 }, // coral canyon flank
    { x: -0.68, z: 2.02, morph: tentacleTipPalettes[3], scale: 1.88, seed: 2104 }, // east reef arch flank ledge (>=1.20m from swim-through)
    { x: 4.40, z: 3.30, morph: tentacleTipPalettes[0], scale: 1.85, seed: 2105 },
    { x: -5.20, z: -1.80, morph: tentacleTipPalettes[1], scale: 1.94, seed: 2106 },
    { x: -2.40, z: -6.10, morph: tentacleTipPalettes[2], scale: 2.00, seed: 2107 },
    { x: 4.10, z: -10.2, morph: tentacleTipPalettes[3], scale: 2.04, seed: 2108 }, // northern drop-off rim
  ];
  const ANEMONE_MAX = SPECIES_POPULATION_SPEC.entacmaea.maxCount;
  for (let i = 0; i < anemoneSpots.length; i++) {
    const s = anemoneSpots[i];
    const clearR = 0.34;
    const valid = resolveValidatedInvertSpot(s.x, s.z, clearR, 0.26 * s.scale, {
      preferRock: true,
      maxY: MAX_STATIC_Y - 0.72,
    });
    s.x = valid.x;
    s.z = valid.z;
    s._sub = valid.sub;
    s._fp = valid.fp;
    registry.add(s.x, s.z, clearR, 'benthic');
  }
  for (let i = anemoneSpots.length; i < ANEMONE_MAX; i++) {
    const found = findBonusReefSpot(anemoneSpots, 1.05, MAX_STATIC_Y - 0.72, true, 0.34);
    if (!found) break;
    registry.add(found.x, found.z, 0.34, 'benthic');
    anemoneSpots.push({
      x: found.x,
      z: found.z,
      _sub: found.sub,
      _fp: found.fp,
      morph: tentacleTipPalettes[i % tentacleTipPalettes.length],
      scale: 1.72 + bonusRng() * 0.30,
      seed: 2109 + (i - 8),
    });
  }

  const discGeom = buildAnemoneDiscGeometry();
  const discInstanced = new THREE.InstancedMesh(discGeom, anemoneDiscMat, ANEMONE_MAX);
  discInstanced.name = 'entacmaea-discs';
  enableShadows(discInstanced, true, true);
  configureDynamicMesh(discInstanced, 'entacmaea');

  const tentaclePerAnemone = 118;
  const tentacleGeom = buildBubbleTentacleGeometry();
  const tentacleInstanced = new THREE.InstancedMesh(
    tentacleGeom,
    tentacleMat,
    ANEMONE_MAX * tentaclePerAnemone
  );
  tentacleInstanced.name = 'entacmaea-tentacles';
  enableShadows(tentacleInstanced, true, true);
  configureDynamicMesh(tentacleInstanced, 'entacmaea');

  const whorlCounts = [12, 18, 24, 30, 34]; // 5 lush overlapping concentric whorls = 118
  const tentacleData = [];
  const anemoneCenters = [];
  let tIdx = 0;

  for (let a = 0; a < anemoneSpots.length; a++) {
    const spot = anemoneSpots[a];
    const rng = createRng(spot.seed);
    const sub = spot._sub || sampleSubstrate(spot.x, spot.z);
    const fp = spot._fp || evalFootprint(spot.x, spot.z, 0.26 * spot.scale);
    const spotY = Math.min(MAX_STATIC_Y - 0.72, Math.min(sub.y - 0.02, fp.minY + 0.02));
    const discLift = 0.14 * spot.scale;
    anemoneCenters.push({ x: spot.x, y: spotY + discLift + 0.15, z: spot.z });

    dummy.position.set(spot.x, spotY, spot.z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.setScalar(spot.scale);
    dummy.updateMatrix();
    discInstanced.setMatrixAt(a, dummy.matrix);

    anemoneAnchors.push({
      position: new THREE.Vector3(spot.x, spotY + 0.22 * spot.scale, spot.z),
      radius: 0.85 * (spot.scale / 1.5),
      active: a < SPECIES_POPULATION_SPEC.entacmaea.defaultCount,
    });

    const morphColor = new THREE.Color(spot.morph);
    const tentacleTint = new THREE.Color();

    for (let w = 0; w < whorlCounts.length; w++) {
      const count = whorlCounts[w];
      const baseFrac = 0.08 + (w / (whorlCounts.length - 1)) * (0.96 - 0.08);

      for (let j = 0; j < count; j++) {
        const frac = THREE.MathUtils.clamp(baseFrac + (rng() - 0.5) * 0.06, 0.08, 0.96);
        const radial = (0.06 + frac * 0.25) * spot.scale;
        const angle = ((j + w * 0.37) / count) * Math.PI * 2 + (rng() - 0.5) * (0.36 / Math.sqrt(count));
        const tilt = THREE.MathUtils.clamp(0.08 + frac * 0.74 + (rng() - 0.5) * 0.10, 0.08, 0.82);

        const rootPos = new THREE.Vector3(
          spot.x + Math.cos(angle) * radial,
          spotY + discLift,
          spot.z + Math.sin(angle) * radial
        );

        const tentScaleXZ = spot.scale * (0.88 + rng() * 0.28);
        const rawLen = spot.scale * (0.24 + (1.0 - frac * 0.28) * 0.16 + rng() * 0.09);
        // Keep spotY + discLift + maxTentacleWorldReach <= 2.46 so sway never breaches MAX_STATIC_Y (2.55m)
        const maxReachBudget = Math.max(0.12, 2.46 - (spotY + discLift));
        const maxSafeLen = Math.max(0.12, maxReachBudget - 0.02);
        const len = Math.min(rawLen, maxSafeLen);
        const lenRatio = len / Math.max(rawLen, 1e-4);
        const thickness = tentScaleXZ * (0.68 + 0.32 * lenRatio);

        const dir = safeNormalize(
          new THREE.Vector3(Math.cos(angle) * Math.sin(tilt), Math.cos(tilt), Math.sin(angle) * Math.sin(tilt)),
          0,
          1,
          0
        );

        const rollQuat = new THREE.Quaternion().setFromAxisAngle(UP_VEC, rng() * Math.PI * 2);
        const restQuat = new THREE.Quaternion().setFromUnitVectors(UP_VEC, dir).multiply(rollQuat);

        tentacleTint.copy(morphColor).offsetHSL(
          (rng() - 0.5) * 0.03,
          (rng() - 0.5) * 0.03,
          (rng() - 0.5) * 0.05
        );
        tentacleInstanced.setColorAt(tIdx, tentacleTint);

        tentacleData.push({
          anemoneIdx: a,
          rootPos,
          restQuat,
          len,
          thickness,
          phase: rng() * Math.PI * 2,
          speed: 1.2 + rng() * 0.65,
          swayAmp: 0.17 + rng() * 0.15,
          axisAngle: angle + Math.PI * 0.5,
        });

        dummy.position.copy(rootPos);
        dummy.quaternion.copy(restQuat);
        dummy.scale.set(thickness, len, thickness);
        dummy.updateMatrix();
        tentacleInstanced.setMatrixAt(tIdx, dummy.matrix);
        tIdx++;
      }
    }
  }
  discInstanced.instanceMatrix.needsUpdate = true;
  tentacleInstanced.instanceMatrix.needsUpdate = true;
  if (tentacleInstanced.instanceColor) tentacleInstanced.instanceColor.needsUpdate = true;
  group.add(discInstanced, tentacleInstanced);
  pickableMeshes.push(discInstanced, tentacleInstanced);

  // ---------------------------------------------------------------------------
  // 2. Diadema setosum (10 -> 18 Long-Spined Sea Urchins in reef crevices)
  // ---------------------------------------------------------------------------
  const urchinSpots = [
    { x: -0.9, z: 4.3, seed: 3101 },
    { x: -2.9, z: 5.8, seed: 3102 },
    { x: 4.2, z: 4.5, seed: 3103 },
    { x: -3.2, z: 1.1, seed: 3104 },
    { x: 2.8, z: 0.2, seed: 3105 },
    { x: -4.4, z: -1.1, seed: 3106 },
    { x: 5.5, z: -3.1, seed: 3107 },
    { x: -1.6, z: -4.9, seed: 3108 },
    { x: -4.1, z: -9.0, seed: 3109 },
    { x: 3.4, z: -9.4, seed: 3110 },
  ];
  const DIADEMA_MAX = SPECIES_POPULATION_SPEC.diadema.maxCount;
  for (let i = 0; i < urchinSpots.length; i++) {
    const s = urchinSpots[i];
    const clearR = 0.28;
    const valid = resolveValidatedInvertSpot(s.x, s.z, clearR, 0.24, {
      preferRock: true,
      maxY: MAX_STATIC_Y - 0.65,
    });
    s.x = valid.x;
    s.z = valid.z;
    s._sub = valid.sub;
    s._fp = valid.fp;
    registry.add(s.x, s.z, clearR, 'benthic');
  }
  for (let i = urchinSpots.length; i < DIADEMA_MAX; i++) {
    const found = findBonusReefSpot(urchinSpots, 0.9, MAX_STATIC_Y - 0.65, true, 0.28);
    if (!found) break;
    registry.add(found.x, found.z, 0.28, 'benthic');
    urchinSpots.push({
      x: found.x,
      z: found.z,
      _sub: found.sub,
      _fp: found.fp,
      seed: 3111 + (i - 10),
    });
  }

  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const testInstanced = new THREE.InstancedMesh(buildDiademaTestGeometry(), commonMat, DIADEMA_MAX);
  testInstanced.name = 'diadema-tests';
  enableShadows(testInstanced, true, true);
  configureDynamicMesh(testInstanced, 'diadema');

  const proxyInstanced = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), proxyMat, DIADEMA_MAX);
  proxyInstanced.name = 'diadema-pick-proxies';
  enableShadows(proxyInstanced, false, false);
  configureDynamicMesh(proxyInstanced, 'diadema');

  const spinesPerUrchin = 80;
  const spineInstanced = new THREE.InstancedMesh(
    buildDiademaSpineGeometry(),
    commonMat,
    DIADEMA_MAX * spinesPerUrchin
  );
  spineInstanced.name = 'diadema-spines';
  enableShadows(spineInstanced, true, true);
  configureDynamicMesh(spineInstanced, 'diadema');

  const spineData = [];
  const urchinCenters = [];
  let sIdx = 0;

  for (let u = 0; u < urchinSpots.length; u++) {
    const spot = urchinSpots[u];
    const rng = createRng(spot.seed);
    const sub = spot._sub || sampleSubstrate(spot.x, spot.z);
    const fp = spot._fp || evalFootprint(spot.x, spot.z, 0.24);
    const groundY = Math.max(getSeabedHeight(spot.x, spot.z), Math.min(sub.y, fp.minY + 0.03));
    const centerY = Math.min(MAX_STATIC_Y - 0.65, groundY + 0.12);
    const scale = 0.9 + rng() * 0.25;
    urchinCenters.push({ x: spot.x, y: centerY + 0.12 * scale, z: spot.z });

    dummy.position.set(spot.x, centerY, spot.z);
    dummy.rotation.set((rng() - 0.5) * 0.14, rng() * Math.PI * 2, (rng() - 0.5) * 0.14);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    testInstanced.setMatrixAt(u, dummy.matrix);
    proxyInstanced.setMatrixAt(u, dummy.matrix);

    const center = new THREE.Vector3(spot.x, centerY, spot.z);
    for (let k = 0; k < spinesPerUrchin; k++) {
      const t = (k + 0.4) / spinesPerUrchin;
      const cosPhi = 0.96 - t * 1.08;
      const sinPhi = Math.sqrt(Math.max(0.01, 1 - cosPhi * cosPhi));
      const theta = k * 2.399963 + rng() * 0.25;
      const dir = safeNormalize(
        new THREE.Vector3(sinPhi * Math.cos(theta), cosPhi, sinPhi * Math.sin(theta)),
        0,
        1,
        0
      );
      const rootPos = center.clone().add(new THREE.Vector3(dir.x * 0.15 * scale, dir.y * 0.11 * scale, dir.z * 0.15 * scale));
      const spineLen = (0.34 + (1.0 - Math.abs(cosPhi)) * 0.16 + rng() * 0.12) * scale;
      const restQuat = new THREE.Quaternion().setFromUnitVectors(UP_VEC, dir);

      spineData.push({
        urchinIdx: u,
        rootPos,
        restQuat,
        spineLen,
        scale,
        phase: rng() * Math.PI * 2,
        speed: 1.4 + rng() * 0.9,
        amp: 0.055 + rng() * 0.055,
        axisAngle: theta + Math.PI * 0.5,
      });

      dummy.position.copy(rootPos);
      dummy.quaternion.copy(restQuat);
      dummy.scale.set(scale, spineLen, scale);
      dummy.updateMatrix();
      spineInstanced.setMatrixAt(sIdx++, dummy.matrix);
    }
  }
  testInstanced.instanceMatrix.needsUpdate = true;
  proxyInstanced.instanceMatrix.needsUpdate = true;
  spineInstanced.instanceMatrix.needsUpdate = true;
  group.add(testInstanced, proxyInstanced, spineInstanced);
  pickableMeshes.push(testInstanced, proxyInstanced, spineInstanced);

  // ---------------------------------------------------------------------------
  // 3. Tridacna maxima (9 -> 16 Maxima Giant Clams with pulsing electric-blue/turquoise mantles)
  // ---------------------------------------------------------------------------
  const clamSpots = [
    { x: -1.8, z: 5.5, color: '#1488ff', scale: 1.15, rotY: 0.4 },
    { x: 5.3, z: 4.6, color: '#00d4c8', scale: 1.10, rotY: 2.1 },
    { x: -2.4, z: 2.2, color: '#2968ff', scale: 1.25, rotY: 1.2 },
    { x: 3.9, z: -1.8, color: '#1ab8ff', scale: 1.20, rotY: -0.5 },
    { x: -5.5, z: -2.7, color: '#4c5eff', scale: 1.15, rotY: 0.8 },
    { x: -6.9, z: 3.6, color: '#00c8b0', scale: 1.05, rotY: 2.6 },
    { x: 4.1, z: 0.6, color: '#1b8cff', scale: 1.10, rotY: -1.3 },
    { x: -2.6, z: -6.5, color: '#00b4ff', scale: 1.25, rotY: 1.7 },
    { x: 4.6, z: -10.9, color: '#3375ff', scale: 1.30, rotY: 0.2 },
  ];
  const clamPalette = ['#1488ff', '#00d4c8', '#2968ff', '#1ab8ff', '#4c5eff', '#00c8b0', '#1b8cff'];
  const CLAM_MAX = SPECIES_POPULATION_SPEC.tridacna.maxCount;
  for (let i = 0; i < clamSpots.length; i++) {
    const s = clamSpots[i];
    const clearR = 0.26 * s.scale;
    const valid = resolveValidatedInvertSpot(s.x, s.z, clearR, 0.24 * s.scale, {
      preferRock: true,
      maxY: MAX_STATIC_Y - 0.35,
    });
    s.x = valid.x;
    s.z = valid.z;
    s._sub = valid.sub;
    s._fp = valid.fp;
    registry.add(s.x, s.z, clearR, 'benthic');
  }
  for (let i = clamSpots.length; i < CLAM_MAX; i++) {
    const scale = 1.05 + bonusRng() * 0.25;
    const clearR = 0.26 * scale;
    const found = findBonusReefSpot(clamSpots, 0.85, MAX_STATIC_Y - 0.35, true, clearR);
    if (!found) break;
    registry.add(found.x, found.z, clearR, 'benthic');
    clamSpots.push({
      x: found.x,
      z: found.z,
      _sub: found.sub,
      _fp: found.fp,
      color: clamPalette[(i - 9) % clamPalette.length],
      scale,
      rotY: (bonusRng() - 0.5) * Math.PI * 2,
    });
  }

  const clamShellMesh = new THREE.InstancedMesh(buildTridacnaShellGeometry(), commonMat, CLAM_MAX);
  clamShellMesh.name = 'tridacna-shells';
  enableShadows(clamShellMesh, true, true);
  configureDynamicMesh(clamShellMesh, 'tridacna');

  const clamMantleMesh = new THREE.InstancedMesh(buildTridacnaMantleGeometry(), mantleMat, CLAM_MAX);
  clamMantleMesh.name = 'tridacna-mantles';
  enableShadows(clamMantleMesh, true, true);
  configureDynamicMesh(clamMantleMesh, 'tridacna');

  const clamState = [];
  for (let i = 0; i < clamSpots.length; i++) {
    const s = clamSpots[i];
    const sub = s._sub || sampleSubstrate(s.x, s.z);
    const fp = s._fp || evalFootprint(s.x, s.z, 0.24 * s.scale);
    const pos = new THREE.Vector3(s.x, Math.min(MAX_STATIC_Y - 0.35, Math.min(sub.y - 0.02, fp.minY + 0.02)), s.z);
    clamMantleMesh.setColorAt(i, new THREE.Color(s.color));
    clamState.push({ pos, scale: s.scale, rotY: s.rotY, phase: i * 1.13 });

    dummy.position.copy(pos);
    dummy.rotation.set(0, s.rotY, 0);
    dummy.scale.setScalar(s.scale);
    dummy.updateMatrix();
    clamShellMesh.setMatrixAt(i, dummy.matrix);
    clamMantleMesh.setMatrixAt(i, dummy.matrix);
  }
  if (clamMantleMesh.instanceColor) clamMantleMesh.instanceColor.needsUpdate = true;
  clamShellMesh.instanceMatrix.needsUpdate = true;
  clamMantleMesh.instanceMatrix.needsUpdate = true;
  group.add(clamShellMesh, clamMantleMesh);
  pickableMeshes.push(clamShellMesh, clamMantleMesh);

  // ---------------------------------------------------------------------------
  // 4. Fromia ghardaqana (14 -> 26 Crimson Red Sea Starfish on rocks & canyon rims)
  // ---------------------------------------------------------------------------
  const starSpots = [
    [-1.2, 5.1], [-2.1, 4.4], [5.0, 3.8], [-6.2, 3.9], [-1.7, 1.5],
    [-2.8, 2.0], [4.5, -1.2], [3.2, -2.5], [-5.0, -2.1], [-6.1, -3.0],
    [3.5, 1.3], [-1.8, -5.8], [-4.5, -9.8], [3.9, -10.3],
  ];
  const STAR_MAX = SPECIES_POPULATION_SPEC.starfish.maxCount;
  const starSpotSubs = [];
  for (let i = 0; i < starSpots.length; i++) {
    const [ox, oz] = starSpots[i];
    const clearR = 0.20;
    const valid = resolveValidatedInvertSpot(ox, oz, clearR, 0.18, {
      preferRock: true,
      maxY: MAX_STATIC_Y - 0.15,
    });
    starSpots[i] = [valid.x, valid.z];
    starSpotSubs.push(valid.sub);
    registry.add(valid.x, valid.z, clearR, 'benthic');
  }
  for (let i = starSpots.length; i < STAR_MAX; i++) {
    const found = findBonusReefSpot(starSpots, 0.75, MAX_STATIC_Y - 0.15, true, 0.20);
    if (!found) break;
    registry.add(found.x, found.z, 0.20, 'benthic');
    starSpots.push([found.x, found.z]);
    starSpotSubs.push(found.sub);
  }

  const starMesh = new THREE.InstancedMesh(buildStarfishGeometry(), commonMat, STAR_MAX);
  starMesh.name = 'fromia-starfish';
  enableShadows(starMesh, true, true);
  configureDynamicMesh(starMesh, 'starfish');

  for (let i = 0; i < starSpots.length; i++) {
    const [sx, sz] = starSpots[i];
    const sub = starSpotSubs[i] || sampleSubstrate(sx, sz);
    const pos = new THREE.Vector3(sx, Math.min(MAX_STATIC_Y - 0.15, sub.y + 0.01), sz);
    const q = new THREE.Quaternion().setFromUnitVectors(UP_VEC, safeNormalize(sub.normal.clone(), 0, 1, 0));
    const qSpin = new THREE.Quaternion().setFromAxisAngle(UP_VEC, i * 1.25);
    dummy.position.copy(pos);
    dummy.quaternion.multiplyQuaternions(q, qSpin);
    dummy.scale.setScalar(0.95 + (i % 3) * 0.18);
    dummy.updateMatrix();
    starMesh.setMatrixAt(i, dummy.matrix);
  }
  starMesh.instanceMatrix.needsUpdate = true;
  group.add(starMesh);
  pickableMeshes.push(starMesh);

  // ---------------------------------------------------------------------------
  // 5. Sea Cucumber (מלפפון ים — 11 -> 20 gently contracting along flat sandy floor)
  // ---------------------------------------------------------------------------
  const cucumberSpots = [
    { x: 1.9, z: 6.2, species: 'edulis' },
    { x: 2.8, z: 4.1, species: 'graeffei' },
    { x: 1.4, z: 2.3, species: 'edulis' },
    { x: 0.6, z: 0.4, species: 'graeffei' },
    { x: 1.7, z: -1.5, species: 'edulis' },
    { x: 0.9, z: -3.4, species: 'graeffei' },
    { x: -0.6, z: -2.2, species: 'edulis' },
    { x: 2.4, z: -5.1, species: 'graeffei' },
    { x: 0.4, z: -7.2, species: 'edulis' },
    { x: -1.2, z: 3.1, species: 'graeffei' },
    { x: 3.3, z: 5.8, species: 'edulis' },
  ];
  const CUCUMBER_MAX = SPECIES_POPULATION_SPEC.seacucumber.maxCount;
  for (let i = 0; i < cucumberSpots.length; i++) {
    const s = cucumberSpots[i];
    const clearR = 0.26;
    const valid = resolveValidatedInvertSpot(s.x, s.z, clearR, 0.25, {
      preferRock: false,
      sandOnly: true,
      maxY: MAX_STATIC_Y - 0.50,
    });
    s.x = valid.x;
    s.z = valid.z;
    registry.add(s.x, s.z, clearR, 'benthic');
  }
  for (let i = cucumberSpots.length; i < CUCUMBER_MAX; i++) {
    const found = findBonusSandSpot(cucumberSpots, 0.85, 0.26);
    if (!found) break;
    registry.add(found.x, found.z, 0.26, 'benthic');
    cucumberSpots.push({
      x: found.x,
      z: found.z,
      species: i % 2 === 0 ? 'edulis' : 'graeffei',
    });
  }

  const cucumberMesh = new THREE.InstancedMesh(buildSeaCucumberGeometry(), commonMat, CUCUMBER_MAX);
  cucumberMesh.name = 'seacucumbers';
  enableShadows(cucumberMesh, true, true);
  configureDynamicMesh(cucumberMesh, 'seacucumber');

  const cucumberState = [];
  for (let i = 0; i < cucumberSpots.length; i++) {
    const s = cucumberSpots[i];
    const y = getSeabedHeight(s.x, s.z);
    const col = s.species === 'edulis' ? new THREE.Color('#6b2838') : new THREE.Color('#c7b89c');
    cucumberMesh.setColorAt(i, col);
    cucumberState.push({
      baseX: s.x,
      baseZ: s.z,
      yaw: i * 1.15,
      scale: 0.95 + (i % 3) * 0.14,
      phase: i * 0.95,
      y,
    });
  }
  if (cucumberMesh.instanceColor) cucumberMesh.instanceColor.needsUpdate = true;
  group.add(cucumberMesh);
  pickableMeshes.push(cucumberMesh);

  // ---------------------------------------------------------------------------
  // 6. Crinoid Feather Stars (8 -> 14 multi-armed curling feather stars atop reef spurs)
  // ---------------------------------------------------------------------------
  const featherSpots = [
    { x: -1.5, z: 5.4, color: '#2b241d' }, // black & gold
    { x: 5.7, z: 4.1, color: '#b82538' },  // crimson & gold
    { x: -2.2, z: 1.8, color: '#d98a1c' }, // amber
    { x: 4.7, z: -1.9, color: '#26201a' },
    { x: -5.6, z: -2.3, color: '#a82242' },
    { x: -2.1, z: -6.4, color: '#c47b1a' },
    { x: -4.9, z: -10.5, color: '#2b241d' },
    { x: 4.3, z: -11.0, color: '#b82538' },
  ];
  const featherPalette = ['#2b241d', '#b82538', '#d98a1c', '#26201a', '#a82242', '#c47b1a'];
  const FEATHER_MAX = SPECIES_POPULATION_SPEC.featherstar.maxCount;
  for (let i = 0; i < featherSpots.length; i++) {
    const s = featherSpots[i];
    const clearR = 0.24;
    const valid = resolveValidatedInvertSpot(s.x, s.z, clearR, 0.22, {
      preferRock: true,
      maxY: MAX_STATIC_Y - 0.38,
    });
    s.x = valid.x;
    s.z = valid.z;
    s._sub = valid.sub;
    s._fp = valid.fp;
    registry.add(s.x, s.z, clearR, 'benthic');
  }
  for (let i = featherSpots.length; i < FEATHER_MAX; i++) {
    const found = findBonusReefSpot(featherSpots, 0.85, MAX_STATIC_Y - 0.38, true, 0.24);
    if (!found) break;
    registry.add(found.x, found.z, 0.24, 'benthic');
    featherSpots.push({
      x: found.x,
      z: found.z,
      _sub: found.sub,
      _fp: found.fp,
      color: featherPalette[(i - 8) % featherPalette.length],
    });
  }

  const armsPerCrinoid = 12;
  const featherMesh = new THREE.InstancedMesh(
    buildFeatherStarArmGeometry(),
    commonMat,
    FEATHER_MAX * armsPerCrinoid
  );
  featherMesh.name = 'featherstars';
  enableShadows(featherMesh, true, true);
  configureDynamicMesh(featherMesh, 'featherstar');

  const featherData = [];
  const featherCenters = [];
  let fIdx = 0;
  for (let c = 0; c < featherSpots.length; c++) {
    const s = featherSpots[c];
    const sub = s._sub || sampleSubstrate(s.x, s.z);
    const fp = s._fp || evalFootprint(s.x, s.z, 0.22);
    const center = new THREE.Vector3(s.x, Math.min(MAX_STATIC_Y - 0.38, Math.min(sub.y + 0.02, fp.minY + 0.04)), s.z);
    featherCenters.push(center);
    const col = new THREE.Color(s.color);
    for (let k = 0; k < armsPerCrinoid; k++) {
      const yaw = (k / armsPerCrinoid) * Math.PI * 2 + c * 0.4;
      featherMesh.setColorAt(fIdx, col);
      featherData.push({
        featherIdx: c,
        center,
        yaw,
        basePitch: 0.42 + (k % 2) * 0.22,
        scale: 0.9 + (k % 3) * 0.1,
        phase: c * 1.1 + k * 0.45,
      });
      fIdx++;
    }
  }
  if (featherMesh.instanceColor) featherMesh.instanceColor.needsUpdate = true;
  group.add(featherMesh);
  pickableMeshes.push(featherMesh);

  const activeCounts = {
    entacmaea: SPECIES_POPULATION_SPEC.entacmaea.defaultCount,
    diadema: SPECIES_POPULATION_SPEC.diadema.defaultCount,
    tridacna: SPECIES_POPULATION_SPEC.tridacna.defaultCount,
    starfish: SPECIES_POPULATION_SPEC.starfish.defaultCount,
    seacucumber: SPECIES_POPULATION_SPEC.seacucumber.defaultCount,
    featherstar: SPECIES_POPULATION_SPEC.featherstar.defaultCount,
  };

  function applySpeciesCounts(speciesCounts) {
    const nAnemone = Math.min(
      anemoneSpots.length,
      sanitizeSpeciesCount('entacmaea', speciesCounts?.entacmaea ?? SPECIES_POPULATION_SPEC.entacmaea.defaultCount)
    );
    activeCounts.entacmaea = nAnemone;
    discInstanced.count = nAnemone;
    discInstanced.visible = nAnemone > 0;
    tentacleInstanced.count = nAnemone * tentaclePerAnemone;
    tentacleInstanced.visible = nAnemone > 0;
    for (let a = 0; a < anemoneAnchors.length; a++) {
      anemoneAnchors[a].active = a < nAnemone;
    }

    const nDiadema = Math.min(
      urchinSpots.length,
      sanitizeSpeciesCount('diadema', speciesCounts?.diadema ?? SPECIES_POPULATION_SPEC.diadema.defaultCount)
    );
    activeCounts.diadema = nDiadema;
    testInstanced.count = nDiadema;
    testInstanced.visible = nDiadema > 0;
    proxyInstanced.count = nDiadema;
    proxyInstanced.visible = nDiadema > 0;
    spineInstanced.count = nDiadema * spinesPerUrchin;
    spineInstanced.visible = nDiadema > 0;

    const nClam = Math.min(
      clamState.length,
      sanitizeSpeciesCount('tridacna', speciesCounts?.tridacna ?? SPECIES_POPULATION_SPEC.tridacna.defaultCount)
    );
    activeCounts.tridacna = nClam;
    clamShellMesh.count = nClam;
    clamShellMesh.visible = nClam > 0;
    clamMantleMesh.count = nClam;
    clamMantleMesh.visible = nClam > 0;

    const nStar = Math.min(
      starSpots.length,
      sanitizeSpeciesCount('starfish', speciesCounts?.starfish ?? SPECIES_POPULATION_SPEC.starfish.defaultCount)
    );
    activeCounts.starfish = nStar;
    starMesh.count = nStar;
    starMesh.visible = nStar > 0;

    const nCucumber = Math.min(
      cucumberState.length,
      sanitizeSpeciesCount('seacucumber', speciesCounts?.seacucumber ?? SPECIES_POPULATION_SPEC.seacucumber.defaultCount)
    );
    activeCounts.seacucumber = nCucumber;
    cucumberMesh.count = nCucumber;
    cucumberMesh.visible = nCucumber > 0;

    const nFeather = Math.min(
      featherSpots.length,
      sanitizeSpeciesCount('featherstar', speciesCounts?.featherstar ?? SPECIES_POPULATION_SPEC.featherstar.defaultCount)
    );
    activeCounts.featherstar = nFeather;
    featherMesh.count = nFeather * armsPerCrinoid;
    featherMesh.visible = nFeather > 0;
  }

  const anemoneHostFlowX = new Float32Array(ANEMONE_MAX);
  const anemoneHostFlowZ = new Float32Array(ANEMONE_MAX);
  const anemoneHostWave = new Float32Array(ANEMONE_MAX);
  const urchinHostFlowX = new Float32Array(DIADEMA_MAX);
  const urchinHostFlowZ = new Float32Array(DIADEMA_MAX);
  const urchinHostWave = new Float32Array(DIADEMA_MAX);
  const featherHostFlowX = new Float32Array(FEATHER_MAX);
  const featherHostFlowZ = new Float32Array(FEATHER_MAX);
  const featherHostWave = new Float32Array(FEATHER_MAX);

  function update(elapsedTime, _deltaTime, envState) {
    const env = envState || DEFAULT_ENV_STATE;
    applySpeciesCounts(env.speciesCounts);

    // Bubble-Tip Anemone tentacles (per-anemone sampleFlowField + Airy wave orbitals)
    const activeAnemones = Math.min(activeCounts.entacmaea, anemoneCenters.length);
    for (let a = 0; a < activeAnemones; a++) {
      const c = anemoneCenters[a];
      sampleFlowField(c.x, c.y, c.z, elapsedTime, env, bommies, _flowVec);
      sampleWaveOrbital(c.x, c.y, c.z, elapsedTime, env, null, _waveVel);
      anemoneHostFlowX[a] = _flowVec.x;
      anemoneHostFlowZ[a] = _flowVec.z;
      anemoneHostWave[a] = Math.hypot(_waveVel.x, _waveVel.z);
    }

    const activeTentacles = activeAnemones * tentaclePerAnemone;
    if (activeTentacles > 0) {
      for (let i = 0; i < activeTentacles; i++) {
        const td = tentacleData[i];
        const aIdx = td.anemoneIdx;
        const fluidX = anemoneHostFlowX[aIdx];
        const fluidZ = anemoneHostFlowZ[aIdx];
        const waveOrbital = anemoneHostWave[aIdx];
        const fluidMag = Math.hypot(fluidX, fluidZ);
        const hydroAngle = fluidMag > 1e-5 ? 0.65 * Math.tanh(fluidMag * 1.15) : 0;

        const swayScale = 0.72 + fluidMag * 0.45 + waveOrbital * 1.45;
        const wave1 = Math.sin(elapsedTime * td.speed + td.phase);
        const wave2 = Math.cos(elapsedTime * (td.speed * 0.63) + td.phase * 1.4) * 0.45;
        const angle = (wave1 + wave2) * td.swayAmp * swayScale;
        swayAxis.set(Math.cos(td.axisAngle), 0, Math.sin(td.axisAngle));
        swayQuat.setFromAxisAngle(swayAxis, angle);
        localQuat.multiplyQuaternions(swayQuat, td.restQuat);
        if (hydroAngle > 1e-5) {
          hydroAxis.set(fluidZ / fluidMag, 0, -fluidX / fluidMag);
          hydroQuat.setFromAxisAngle(hydroAxis, hydroAngle);
          baseQuat.multiplyQuaternions(hydroQuat, localQuat);
        } else {
          baseQuat.copy(localQuat);
        }

        const pulse = 1.0 + Math.sin(elapsedTime * 1.8 + td.phase) * 0.06;
        const sx = td.thickness * pulse;
        let sy = td.len;

        // Hard vertical cap: keep every anemone tentacle vertex strictly <= 2.46m (< MAX_STATIC_Y = 2.55m)
        const qx = baseQuat.x;
        const qy = baseQuat.y;
        const qz = baseQuat.z;
        const qw = baseQuat.w;
        const r1x = 2 * (qx * qy + qw * qz);
        const r1y = 1 - 2 * (qx * qx + qz * qz);
        const r1z = 2 * (qy * qz - qw * qx);
        const latMax = (Math.abs(r1x) * 0.034 + Math.hypot(r1x, r1z) * 0.040) * sx;
        const upPos = Math.max(0, r1y);
        if (td.rootPos.y + upPos * sy + latMax > 2.455 && upPos > 1e-4) {
          const allowedSy = Math.max(0.08, (2.455 - td.rootPos.y - latMax) / upPos);
          sy = Math.min(sy, allowedSy);
        }

        tmpScale.set(sx, sy, sx);
        tmpMat.compose(td.rootPos, baseQuat, tmpScale);
        tentacleInstanced.setMatrixAt(i, tmpMat);
      }
      tentacleInstanced.instanceMatrix.needsUpdate = true;
    }

    // Diadema spines (per-urchin sampleFlowField + Airy wave oscillation)
    const activeUrchins = Math.min(activeCounts.diadema, urchinCenters.length);
    for (let u = 0; u < activeUrchins; u++) {
      const c = urchinCenters[u];
      sampleFlowField(c.x, c.y, c.z, elapsedTime, env, bommies, _flowVec);
      sampleWaveOrbital(c.x, c.y, c.z, elapsedTime, env, null, _waveVel);
      urchinHostFlowX[u] = _flowVec.x;
      urchinHostFlowZ[u] = _flowVec.z;
      urchinHostWave[u] = Math.hypot(_waveVel.x, _waveVel.z);
    }

    const activeSpines = activeUrchins * spinesPerUrchin;
    if (activeSpines > 0) {
      for (let i = 0; i < activeSpines; i++) {
        const sd = spineData[i];
        const uIdx = sd.urchinIdx;
        const fluidX = urchinHostFlowX[uIdx];
        const fluidZ = urchinHostFlowZ[uIdx];
        const waveOrbital = urchinHostWave[uIdx];
        const fluidMag = Math.hypot(fluidX, fluidZ);
        const hydroAngle = fluidMag > 1e-5 ? 0.12 * Math.tanh(fluidMag * 1.1) : 0;

        const spineGain = 0.78 + fluidMag * 0.45 + waveOrbital * 1.15;
        const tilt = Math.sin(elapsedTime * sd.speed + sd.phase) * sd.amp * spineGain;
        swayAxis.set(Math.cos(sd.axisAngle), 0, Math.sin(sd.axisAngle));
        swayQuat.setFromAxisAngle(swayAxis, tilt);
        localQuat.multiplyQuaternions(swayQuat, sd.restQuat);
        if (hydroAngle > 1e-5) {
          hydroAxis.set(fluidZ / fluidMag, 0, -fluidX / fluidMag);
          hydroQuat.setFromAxisAngle(hydroAxis, hydroAngle);
          baseQuat.multiplyQuaternions(hydroQuat, localQuat);
        } else {
          baseQuat.copy(localQuat);
        }

        const r1y = 1 - 2 * (baseQuat.x * baseQuat.x + baseQuat.z * baseQuat.z);
        let spineSy = sd.spineLen;
        if (r1y > 1e-4 && sd.rootPos.y + r1y * spineSy > MAX_STATIC_Y - 0.01) {
          spineSy = Math.min(spineSy, Math.max(0.08, (MAX_STATIC_Y - 0.01 - sd.rootPos.y) / r1y));
        }

        tmpScale.set(sd.scale, spineSy, sd.scale);
        tmpMat.compose(sd.rootPos, baseQuat, tmpScale);
        spineInstanced.setMatrixAt(i, tmpMat);
      }
      spineInstanced.instanceMatrix.needsUpdate = true;
    }

    // Tridacna pulsing mantles gently modulated by local wave surge
    if (activeCounts.tridacna > 0) {
      for (let i = 0; i < activeCounts.tridacna; i++) {
        const cl = clamState[i];
        sampleWaveOrbital(cl.pos.x, cl.pos.y, cl.pos.z, elapsedTime, env, null, _waveVel);
        const waveOrbital = Math.hypot(_waveVel.x, _waveVel.z);
        const breathe = 1.0 + Math.sin(elapsedTime * 1.15 + cl.phase) * (0.055 + waveOrbital * 0.08);
        dummy.position.copy(cl.pos);
        dummy.rotation.set(0, cl.rotY, 0);
        dummy.scale.set(cl.scale, cl.scale, cl.scale * breathe);
        dummy.updateMatrix();
        clamMantleMesh.setMatrixAt(i, dummy.matrix);
      }
      clamMantleMesh.instanceMatrix.needsUpdate = true;
    }

    // Sea Cucumbers peristaltic contraction along canyon floor
    if (activeCounts.seacucumber > 0) {
      for (let i = 0; i < activeCounts.seacucumber; i++) {
        const c = cucumberState[i];
        const crawl = Math.sin(elapsedTime * 0.18 + c.phase) * 0.25;
        const x = c.baseX + Math.sin(c.yaw) * crawl;
        const z = c.baseZ + Math.cos(c.yaw) * crawl;
        const y = getSeabedHeight(x, z);
        const contract = 1.0 + Math.sin(elapsedTime * 1.4 + c.phase) * 0.08;
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, c.yaw, 0);
        dummy.scale.set(c.scale * (2.0 - contract), c.scale, c.scale * contract);
        dummy.updateMatrix();
        cucumberMesh.setMatrixAt(i, dummy.matrix);
      }
      cucumberMesh.instanceMatrix.needsUpdate = true;
    }

    // Crinoid Feather Stars (per-host sampleFlowField + Airy wave orbitals)
    const activeFeathers = Math.min(activeCounts.featherstar, featherCenters.length);
    for (let c = 0; c < activeFeathers; c++) {
      const center = featherCenters[c];
      sampleFlowField(center.x, center.y + 0.14, center.z, elapsedTime, env, bommies, _flowVec);
      sampleWaveOrbital(center.x, center.y + 0.14, center.z, elapsedTime, env, null, _waveVel);
      featherHostFlowX[c] = _flowVec.x;
      featherHostFlowZ[c] = _flowVec.z;
      featherHostWave[c] = Math.hypot(_waveVel.x, _waveVel.z);
    }

    const activeFeatherArms = activeFeathers * armsPerCrinoid;
    if (activeFeatherArms > 0) {
      for (let i = 0; i < activeFeatherArms; i++) {
        const f = featherData[i];
        const cIdx = f.featherIdx;
        const fluidX = featherHostFlowX[cIdx];
        const fluidZ = featherHostFlowZ[cIdx];
        const waveOrbital = featherHostWave[cIdx];
        const fluidMag = Math.hypot(fluidX, fluidZ);
        const hydroAngle = fluidMag > 1e-5 ? 0.46 * Math.tanh(fluidMag * 1.15) : 0;

        const curlAmp = 0.14 + fluidMag * 0.14 + waveOrbital * 0.36;
        const curl = f.basePitch + Math.sin(elapsedTime * 1.45 + f.phase) * curlAmp;
        const roll = Math.sin(elapsedTime * 1.1 + f.phase) * (0.09 + fluidMag * 0.08 + waveOrbital * 0.22);
        armEuler.set(curl, f.yaw, roll, 'YXZ');
        localQuat.setFromEuler(armEuler);
        if (hydroAngle > 1e-5) {
          hydroAxis.set(fluidZ / fluidMag, 0, -fluidX / fluidMag);
          hydroQuat.setFromAxisAngle(hydroAxis, hydroAngle);
          dummy.quaternion.multiplyQuaternions(hydroQuat, localQuat);
        } else {
          dummy.quaternion.copy(localQuat);
        }

        dummy.position.copy(f.center);
        dummy.scale.setScalar(f.scale);
        dummy.updateMatrix();
        featherMesh.setMatrixAt(i, dummy.matrix);
      }
      featherMesh.instanceMatrix.needsUpdate = true;
    }
  }

  update(0, 0.016, DEFAULT_ENV_STATE);

  return {
    group,
    pickableMeshes,
    anemoneAnchors,
    applySpeciesCounts,
    getActiveCounts: () => ({ ...activeCounts }),
    update,
  };
}
