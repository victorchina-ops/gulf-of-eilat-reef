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
  clampGeometryTopY,
  configureDynamicMesh,
  createPlacementRegistry,
  createRng,
  enableShadows,
  fbm3D,
  prepareForMerge,
  safeMerge,
  safeNormalize,
} from './utils.js';
import { sampleFlowField, sampleWaveOrbital } from '../physics/flowField.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const REEF_ARCH_CENTER = [-2.0, 1.8];
const CLEANING_STATION_COORDS = [
  [4.15, 4.15],
  [2.85, -0.65],
  [-3.55, -3.15],
  [-5.85, 3.85],
  [-2.15, -7.85],
];

// Pre-weld shared icosphere templates once at module load so Platygyra/Porites skip
// dozens of redundant mergeVertices passes during reef initialization.
const _coralIco8Raw = new THREE.IcosahedronGeometry(1, 8);
for (const attr of Object.keys(_coralIco8Raw.attributes)) {
  if (attr !== 'position') _coralIco8Raw.deleteAttribute(attr);
}
const CORAL_ICO_8 = mergeVertices(_coralIco8Raw, 1e-4);
_coralIco8Raw.dispose();

const _coralIco5Raw = new THREE.IcosahedronGeometry(1, 5);
for (const attr of Object.keys(_coralIco5Raw.attributes)) {
  if (attr !== 'position') _coralIco5Raw.deleteAttribute(attr);
}
const CORAL_ICO_5 = mergeVertices(_coralIco5Raw, 1e-4);
_coralIco5Raw.dispose();

const _fDir = new THREE.Vector3();
const _fP1 = new THREE.Vector3();
const _fP2 = new THREE.Vector3();
const _fN = new THREE.Vector3();
const _fCapN = new THREE.Vector3();
const _fCol = new THREE.Color();

function createFastGeometryCollector() {
  const positions = [];
  const normals = [];
  const colors = [];

  function pushVert(x, y, z, nx, ny, nz, r, g, b) {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    colors.push(r, g, b);
  }

  function pushTri(
    ax, ay, az, anx, any, anz, ca,
    bx, by, bz, bnx, bny, bnz, cb,
    cx, cy, cz, cnx, cny, cnz, cc
  ) {
    pushVert(ax, ay, az, anx, any, anz, ca.r, ca.g, ca.b);
    pushVert(bx, by, bz, bnx, bny, bnz, cb.r, cb.g, cb.b);
    pushVert(cx, cy, cz, cnx, cny, cnz, cc.r, cc.g, cc.b);
  }

  function addFrustum(start, end, rBottom, rTop, radialSegs, cStart, cEnd, capRadius = 0, openEnded = false) {
    _fDir.subVectors(end, start);
    const len = _fDir.length();
    if (len < 1e-4) return;
    _fDir.divideScalar(len);

    if (Math.abs(_fDir.y) < 0.9) _fP1.set(0, 1, 0);
    else _fP1.set(1, 0, 0);
    _fP1.crossVectors(_fDir, _fP1);
    safeNormalize(_fP1, 1, 0, 0);
    _fP2.crossVectors(_fDir, _fP1);
    safeNormalize(_fP2, 0, 0, 1);

    const slope = (rBottom - rTop) / len;
    const step = (Math.PI * 2) / radialSegs;

    for (let i = 0; i < radialSegs; i++) {
      const a0 = i * step;
      const a1 = (i + 1) * step;
      const cos0 = Math.cos(a0);
      const sin0 = Math.sin(a0);
      const cos1 = Math.cos(a1);
      const sin1 = Math.sin(a1);

      const rx0 = _fP1.x * cos0 + _fP2.x * sin0;
      const ry0 = _fP1.y * cos0 + _fP2.y * sin0;
      const rz0 = _fP1.z * cos0 + _fP2.z * sin0;

      const rx1 = _fP1.x * cos1 + _fP2.x * sin1;
      const ry1 = _fP1.y * cos1 + _fP2.y * sin1;
      const rz1 = _fP1.z * cos1 + _fP2.z * sin1;

      const bx0 = start.x + rx0 * rBottom;
      const by0 = start.y + ry0 * rBottom;
      const bz0 = start.z + rz0 * rBottom;
      const bx1 = start.x + rx1 * rBottom;
      const by1 = start.y + ry1 * rBottom;
      const bz1 = start.z + rz1 * rBottom;

      const tx0 = end.x + rx0 * rTop;
      const ty0 = end.y + ry0 * rTop;
      const tz0 = end.z + rz0 * rTop;
      const tx1 = end.x + rx1 * rTop;
      const ty1 = end.y + ry1 * rTop;
      const tz1 = end.z + rz1 * rTop;

      _fN.set(rx0 + _fDir.x * slope, ry0 + _fDir.y * slope, rz0 + _fDir.z * slope).normalize();
      const n0x = _fN.x, n0y = _fN.y, n0z = _fN.z;
      _fN.set(rx1 + _fDir.x * slope, ry1 + _fDir.y * slope, rz1 + _fDir.z * slope).normalize();
      const n1x = _fN.x, n1y = _fN.y, n1z = _fN.z;

      // Side quad (CCW facing outward: (p1 x p2) = dir, so b0 -> b1 -> t1, b0 -> t1 -> t0? Let's verify:
      // rx0 = p1, ry = p2 (a1 > a0), (b1 - b0) ~ +p2, (t0 - b0) ~ +dir. p2 x dir = +p1 (outward)!)
      pushTri(
        bx0, by0, bz0, n0x, n0y, n0z, cStart,
        bx1, by1, bz1, n1x, n1y, n1z, cStart,
        tx1, ty1, tz1, n1x, n1y, n1z, cEnd
      );
      pushTri(
        bx0, by0, bz0, n0x, n0y, n0z, cStart,
        tx1, ty1, tz1, n1x, n1y, n1z, cEnd,
        tx0, ty0, tz0, n0x, n0y, n0z, cEnd
      );

      if (!openEnded && rBottom > 1e-4) {
        pushTri(
          start.x, start.y, start.z, -_fDir.x, -_fDir.y, -_fDir.z, cStart,
          bx1, by1, bz1, -_fDir.x, -_fDir.y, -_fDir.z, cStart,
          bx0, by0, bz0, -_fDir.x, -_fDir.y, -_fDir.z, cStart
        );
      }
      if (!openEnded && rTop > 1e-4 && capRadius <= 0) {
        pushTri(
          end.x, end.y, end.z, _fDir.x, _fDir.y, _fDir.z, cEnd,
          tx0, ty0, tz0, _fDir.x, _fDir.y, _fDir.z, cEnd,
          tx1, ty1, tz1, _fDir.x, _fDir.y, _fDir.z, cEnd
        );
      }
    }

    if (capRadius > 0) {
      // Smooth rounded dome cap (2 rings of radialSegs triangles)
      const midR = capRadius * 0.72;
      const midY = capRadius * 0.62;
      const apexX = end.x + _fDir.x * capRadius;
      const apexY = end.y + _fDir.y * capRadius;
      const apexZ = end.z + _fDir.z * capRadius;
      for (let i = 0; i < radialSegs; i++) {
        const a0 = i * step;
        const a1 = (i + 1) * step;
        const rx0 = _fP1.x * Math.cos(a0) + _fP2.x * Math.sin(a0);
        const ry0 = _fP1.y * Math.cos(a0) + _fP2.y * Math.sin(a0);
        const rz0 = _fP1.z * Math.cos(a0) + _fP2.z * Math.sin(a0);
        const rx1 = _fP1.x * Math.cos(a1) + _fP2.x * Math.sin(a1);
        const ry1 = _fP1.y * Math.cos(a1) + _fP2.y * Math.sin(a1);
        const rz1 = _fP1.z * Math.cos(a1) + _fP2.z * Math.sin(a1);

        const bx0 = end.x + rx0 * rTop;
        const by0 = end.y + ry0 * rTop;
        const bz0 = end.z + rz0 * rTop;
        const bx1 = end.x + rx1 * rTop;
        const by1 = end.y + ry1 * rTop;
        const bz1 = end.z + rz1 * rTop;

        const mx0 = end.x + rx0 * midR + _fDir.x * midY;
        const my0 = end.y + ry0 * midR + _fDir.y * midY;
        const mz0 = end.z + rz0 * midR + _fDir.z * midY;
        const mx1 = end.x + rx1 * midR + _fDir.x * midY;
        const my1 = end.y + ry1 * midR + _fDir.y * midY;
        const mz1 = end.z + rz1 * midR + _fDir.z * midY;

        _fCapN.set(rx0 * 0.65 + _fDir.x * 0.75, ry0 * 0.65 + _fDir.y * 0.75, rz0 * 0.65 + _fDir.z * 0.75).normalize();
        const m0x = _fCapN.x, m0y = _fCapN.y, m0z = _fCapN.z;
        _fCapN.set(rx1 * 0.65 + _fDir.x * 0.75, ry1 * 0.65 + _fDir.y * 0.75, rz1 * 0.65 + _fDir.z * 0.75).normalize();
        const m1x = _fCapN.x, m1y = _fCapN.y, m1z = _fCapN.z;

        pushTri(
          bx0, by0, bz0, rx0, ry0, rz0, cEnd,
          bx1, by1, bz1, rx1, ry1, rz1, cEnd,
          mx1, my1, mz1, m1x, m1y, m1z, cEnd
        );
        pushTri(
          bx0, by0, bz0, rx0, ry0, rz0, cEnd,
          mx1, my1, mz1, m1x, m1y, m1z, cEnd,
          mx0, my0, mz0, m0x, m0y, m0z, cEnd
        );
        pushTri(
          mx0, my0, mz0, m0x, m0y, m0z, cEnd,
          mx1, my1, mz1, m1x, m1y, m1z, cEnd,
          apexX, apexY, apexZ, _fDir.x, _fDir.y, _fDir.z, cEnd
        );
      }
    }
  }

  function addCone(basePos, dir, baseRadius, height, radialSegs, cBase, cTip) {
    _fDir.copy(dir);
    safeNormalize(_fDir, 0, 1, 0);
    if (Math.abs(_fDir.y) < 0.9) _fP1.set(0, 1, 0);
    else _fP1.set(1, 0, 0);
    _fP1.crossVectors(_fDir, _fP1);
    safeNormalize(_fP1, 1, 0, 0);
    _fP2.crossVectors(_fDir, _fP1);
    safeNormalize(_fP2, 0, 0, 1);

    const apexX = basePos.x + _fDir.x * height;
    const apexY = basePos.y + _fDir.y * height;
    const apexZ = basePos.z + _fDir.z * height;
    const slope = baseRadius / Math.max(1e-4, height);
    const step = (Math.PI * 2) / radialSegs;

    for (let i = 0; i < radialSegs; i++) {
      const a0 = i * step;
      const a1 = (i + 1) * step;
      const rx0 = _fP1.x * Math.cos(a0) + _fP2.x * Math.sin(a0);
      const ry0 = _fP1.y * Math.cos(a0) + _fP2.y * Math.sin(a0);
      const rz0 = _fP1.z * Math.cos(a0) + _fP2.z * Math.sin(a0);
      const rx1 = _fP1.x * Math.cos(a1) + _fP2.x * Math.sin(a1);
      const ry1 = _fP1.y * Math.cos(a1) + _fP2.y * Math.sin(a1);
      const rz1 = _fP1.z * Math.cos(a1) + _fP2.z * Math.sin(a1);

      const bx0 = basePos.x + rx0 * baseRadius;
      const by0 = basePos.y + ry0 * baseRadius;
      const bz0 = basePos.z + rz0 * baseRadius;
      const bx1 = basePos.x + rx1 * baseRadius;
      const by1 = basePos.y + ry1 * baseRadius;
      const bz1 = basePos.z + rz1 * baseRadius;

      _fN.set(rx0 + _fDir.x * slope, ry0 + _fDir.y * slope, rz0 + _fDir.z * slope).normalize();
      const n0x = _fN.x, n0y = _fN.y, n0z = _fN.z;
      _fN.set(rx1 + _fDir.x * slope, ry1 + _fDir.y * slope, rz1 + _fDir.z * slope).normalize();
      const n1x = _fN.x, n1y = _fN.y, n1z = _fN.z;

      pushTri(
        bx0, by0, bz0, n0x, n0y, n0z, cBase,
        bx1, by1, bz1, n1x, n1y, n1z, cBase,
        apexX, apexY, apexZ, _fDir.x, _fDir.y, _fDir.z, cTip
      );
    }
  }

  function addBox(center, right, up, fwd, wBottom, wTop, h, d, cBottom, cTop) {
    const hwB = wBottom * 0.5;
    const hwT = wTop * 0.5;
    const hh = h * 0.5;
    const hd = d * 0.5;

    function corner(sx, sy, sz) {
      const hw = sy > 0 ? hwT : hwB;
      return [
        center.x + right.x * sx * hw + up.x * sy * hh + fwd.x * sz * hd,
        center.y + right.y * sx * hw + up.y * sy * hh + fwd.y * sz * hd,
        center.z + right.z * sx * hw + up.z * sy * hh + fwd.z * sz * hd,
      ];
    }

    const p000 = corner(-1, -1, -1), p100 = corner(1, -1, -1);
    const p110 = corner(1, 1, -1), p010 = corner(-1, 1, -1);
    const p001 = corner(-1, -1, 1), p101 = corner(1, -1, 1);
    const p111 = corner(1, 1, 1), p011 = corner(-1, 1, 1);

    function quad(a, b, c, dPt, n, ca, cb, cc, cd) {
      pushTri(a[0], a[1], a[2], n.x, n.y, n.z, ca, b[0], b[1], b[2], n.x, n.y, n.z, cb, c[0], c[1], c[2], n.x, n.y, n.z, cc);
      pushTri(a[0], a[1], a[2], n.x, n.y, n.z, ca, c[0], c[1], c[2], n.x, n.y, n.z, cc, dPt[0], dPt[1], dPt[2], n.x, n.y, n.z, cd);
    }

    const negFwd = _fN.copy(fwd).negate().clone();
    const negRight = _fP1.copy(right).negate().clone();
    const negUp = _fP2.copy(up).negate().clone();

    quad(p001, p101, p111, p011, fwd, cBottom, cBottom, cTop, cTop);
    quad(p100, p000, p010, p110, negFwd, cBottom, cBottom, cTop, cTop);
    quad(p101, p100, p110, p111, right, cBottom, cBottom, cTop, cTop);
    quad(p000, p001, p011, p010, negRight, cBottom, cBottom, cTop, cTop);
    quad(p011, p111, p110, p010, up, cTop, cTop, cTop, cTop);
    quad(p000, p100, p101, p001, negUp, cBottom, cBottom, cBottom, cBottom);
  }

  function appendGeometry(geom, colorSource) {
    const prepped = prepareForMerge(geom, colorSource);
    const p = prepped.attributes.position.array;
    const n = prepped.attributes.normal.array;
    const c = prepped.attributes.color.array;
    for (let i = 0; i < p.length; i++) {
      positions.push(p[i]);
      normals.push(n[i]);
      colors.push(c[i]);
    }
    prepped.dispose();
  }

  function toGeometry() {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    return geom;
  }

  return { addFrustum, addCone, addBox, appendGeometry, toGeometry };
}

function addBranchSegment(
  parts,
  start,
  end,
  rBottom,
  rTop,
  radialSegs,
  cStart,
  cEnd,
  capRadius = 0,
  openEnded = false
) {
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = dir.length();
  if (len < 1e-4) return;

  const cyl = new THREE.CylinderGeometry(rTop, rBottom, len, radialSegs, 1, openEnded);
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const normDir = safeNormalize(dir.clone(), 0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, normDir);
  cyl.applyMatrix4(new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1)));

  const halfLen = len * 0.5;
  parts.push(
    prepareForMerge(cyl, (x, y, z, _nx, _ny, _nz, out) => {
      const relX = x - mid.x;
      const relY = y - mid.y;
      const relZ = z - mid.z;
      const proj = relX * normDir.x + relY * normDir.y + relZ * normDir.z;
      const t = THREE.MathUtils.clamp((proj + halfLen) / len, 0, 1);
      out.copy(cStart).lerp(cEnd, t);
    })
  );
  cyl.dispose();

  if (capRadius > 0) {
    const cap = new THREE.IcosahedronGeometry(capRadius, 0);
    cap.translate(end.x, end.y, end.z);
    parts.push(prepareForMerge(cap, cEnd));
    cap.dispose();
  }
}

function pushPolypAnchor(list, pos, normal, scale, color) {
  list.push({
    pos: pos.clone(),
    normal: safeNormalize(normal.clone(), 0, 1, 0),
    scale,
    color: color.clone(),
  });
}

function selectTargetPolypCount(candidates, minCount, maxCount, rng, minSpacing = 0) {
  if (candidates.length === 0) return [];
  const target = Math.min(
    candidates.length,
    Math.round(minCount + rng() * Math.max(0, maxCount - minCount))
  );
  // Deterministic Fisher-Yates shuffle on index list so spacing & sampling are unbiased
  const order = new Array(candidates.length);
  for (let i = 0; i < candidates.length; i++) order[i] = i;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }

  const chosen = [];
  if (minSpacing > 0) {
    const minSq = minSpacing * minSpacing;
    for (let k = 0; k < order.length && chosen.length < target; k++) {
      const c = candidates[order[k]];
      let ok = true;
      for (let m = 0; m < chosen.length; m++) {
        if (c.pos.distanceToSquared(chosen[m].pos) < minSq) {
          ok = false;
          break;
        }
      }
      if (ok) chosen.push(c);
    }
    // Top up if spatial constraint was too strict to reach minCount
    if (chosen.length < Math.min(minCount, candidates.length)) {
      const used = new Set(chosen);
      for (let k = 0; k < order.length && chosen.length < Math.min(minCount, candidates.length); k++) {
        const c = candidates[order[k]];
        if (!used.has(c)) {
          chosen.push(c);
          used.add(c);
        }
      }
    }
  } else {
    for (let k = 0; k < target; k++) {
      chosen.push(candidates[order[k]]);
    }
  }
  return chosen;
}

function clampPolypsTopY(polyps, peakY, maxY = MAX_STATIC_Y) {
  const safeMaxY = maxY - 0.02;
  let effectivePeak = peakY;
  for (let i = 0; i < polyps.length; i++) {
    if (polyps[i].pos.y > effectivePeak) effectivePeak = polyps[i].pos.y;
  }
  if (effectivePeak <= safeMaxY) return;
  const excess = effectivePeak - safeMaxY;
  const zoneStart = safeMaxY - 0.35;
  const denom = effectivePeak - zoneStart + 1e-5;
  for (let i = 0; i < polyps.length; i++) {
    const y = polyps[i].pos.y;
    if (y > zoneStart) {
      const t = Math.min(1, (y - zoneStart) / denom);
      polyps[i].pos.y = Math.min(safeMaxY, y - excess * t);
    }
  }
}

/**
 * 3 Low-Poly +Y-oriented polyp prototypes (normalized height 0..1, base strictly at y=0).
 */
function buildBranchingPolypGeometry() {
  const parts = [];
  // Calyx cup rising from y=0 to y=0.38
  const cup = new THREE.CylinderGeometry(0.16, 0.11, 0.38, 6, 1, true);
  cup.translate(0, 0.19, 0);
  parts.push(
    prepareForMerge(cup, (_x, y, _z, _nx, _ny, _nz, out) => {
      const b = 0.56 + 0.30 * THREE.MathUtils.clamp(y / 0.38, 0, 1);
      out.setRGB(b, b, b);
    })
  );
  cup.dispose();

  // 8 splayed tentacles
  for (let t = 0; t < 8; t++) {
    const a = (t / 8) * Math.PI * 2;
    const tilt = 0.62 + (t % 2) * 0.12;
    const dir = safeNormalize(
      new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)),
      0,
      1,
      0
    );
    const base = new THREE.Vector3(Math.cos(a) * 0.13, 0.34, Math.sin(a) * 0.13);
    const len = 0.72;
    const cone = new THREE.ConeGeometry(0.052, len, 4, 1, true);
    cone.translate(0, len * 0.5, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, dir);
    cone.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
    parts.push(
      prepareForMerge(cone, (_x, y, _z, _nx, _ny, _nz, out) => {
        const tip = THREE.MathUtils.clamp((y - 0.34) / 0.64, 0, 1);
        const b = 0.78 + 0.22 * tip;
        out.setRGB(b, b, b);
      })
    );
    cone.dispose();
  }
  return safeMerge(parts);
}

function buildDactylozoidTuftGeometry() {
  const parts = [];
  const pore = new THREE.CylinderGeometry(0.10, 0.14, 0.14, 5, 1, true);
  pore.translate(0, 0.07, 0);
  parts.push(
    prepareForMerge(pore, (_x, y, _z, _nx, _ny, _nz, out) => {
      const b = 0.62 + 0.22 * THREE.MathUtils.clamp(y / 0.14, 0, 1);
      out.setRGB(b, b, b);
    })
  );
  pore.dispose();

  // 6 fine stinging dactylozooid hairs
  for (let h = 0; h < 6; h++) {
    const a = (h / 6) * Math.PI * 2 + 0.25;
    const tilt = 0.22 + (h % 3) * 0.11;
    const dir = safeNormalize(
      new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)),
      0,
      1,
      0
    );
    const base = new THREE.Vector3(Math.cos(a) * 0.06, 0.08, Math.sin(a) * 0.06);
    const len = 0.94;
    const hair = new THREE.ConeGeometry(0.032, len, 3, 1, true);
    hair.translate(0, len * 0.5, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, dir);
    hair.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
    parts.push(
      prepareForMerge(hair, (_x, y, _z, _nx, _ny, _nz, out) => {
        const tip = THREE.MathUtils.clamp((y - 0.08) / 0.90, 0, 1);
        const b = 0.76 + 0.24 * tip;
        out.setRGB(b, b, b);
      })
    );
    hair.dispose();
  }
  return safeMerge(parts);
}

function buildMassivePolypGeometry() {
  const parts = [];
  // Short column + oral disc
  const disc = new THREE.CylinderGeometry(0.24, 0.14, 0.34, 8, 1, false);
  disc.translate(0, 0.17, 0);
  parts.push(
    prepareForMerge(disc, (x, y, z, _nx, _ny, _nz, out) => {
      const r = Math.hypot(x, z);
      const top = THREE.MathUtils.clamp(y / 0.34, 0, 1);
      const mouthShade = y > 0.32 && r < 0.11 ? 0.55 : 0.85;
      const b = (0.58 + 0.30 * top) * (mouthShade / 0.85);
      out.setRGB(b, b, b);
    })
  );
  disc.dispose();

  // 10 splayed oral-disc tentacles
  for (let t = 0; t < 10; t++) {
    const a = (t / 10) * Math.PI * 2;
    const tilt = 0.72 + (t % 2) * 0.12;
    const dir = safeNormalize(
      new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)),
      0,
      1,
      0
    );
    const base = new THREE.Vector3(Math.cos(a) * 0.20, 0.29, Math.sin(a) * 0.20);
    const len = 0.75;
    const cone = new THREE.ConeGeometry(0.050, len, 4, 1, true);
    cone.translate(0, len * 0.5, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, dir);
    cone.applyMatrix4(new THREE.Matrix4().compose(base, q, new THREE.Vector3(1, 1, 1)));
    parts.push(
      prepareForMerge(cone, (_x, y, _z, _nx, _ny, _nz, out) => {
        const tip = THREE.MathUtils.clamp((y - 0.29) / 0.68, 0, 1);
        const b = 0.78 + 0.22 * tip;
        out.setRGB(b, b, b);
      })
    );
    cone.dispose();
  }
  return safeMerge(parts);
}

/**
 * 1. Recursive Staghorn Acropora: lobed encrusting holdfast + 5 trunks + 4-5 tiers
 * + cross-bracing spurs + imbricated radial corallites + pale axial growth tips.
 */
function buildRecursiveStaghorn(radius, rng) {
  const col = createFastGeometryCollector();
  const polypCandidates = [];

  const morphPick = rng();
  const palette =
    morphPick < 0.42
      ? { base: '#5f462d', mid: '#9c7d4d', tip: '#b8d0ff', pRad: '#f5d9ae', pAx: '#dce8ff' }
      : morphPick < 0.74
      ? { base: '#694437', mid: '#a8715d', tip: '#f0cde2', pRad: '#f7d6c6', pAx: '#ffe4f2' }
      : { base: '#545130', mid: '#8e8c4c', tip: '#e3f0b6', pRad: '#f0eab8', pAx: '#f8ffd9' };

  const cBase = new THREE.Color(palette.base);
  const cMid = new THREE.Color(palette.mid);
  const cTip = new THREE.Color(palette.tip);
  const cPolypRadial = new THREE.Color(palette.pRad);
  const cPolypAxial = new THREE.Color(palette.pAx);
  const _colTmp0 = new THREE.Color();
  const _colTmp1 = new THREE.Color();

  // Fused crustose limestone-overgrowing holdfast
  for (let h = 0; h < 5; h++) {
    const a = (h / 5) * Math.PI * 2 + rng() * 0.45;
    const lobe = new THREE.IcosahedronGeometry(radius * (h === 0 ? 0.19 : 0.13), 1);
    lobe.scale(1.42, 0.36, 1.42);
    lobe.translate(
      h === 0 ? 0 : Math.cos(a) * radius * 0.135,
      -0.015,
      h === 0 ? 0 : Math.sin(a) * radius * 0.135
    );
    col.appendGeometry(lobe, cBase);
    lobe.dispose();
  }

  const midNodes = [];
  const cSub = new THREE.Color();
  const _sMid = new THREE.Vector3();
  const _sEnd = new THREE.Vector3();
  const _sCorTip = new THREE.Vector3();
  const _sCupTip = new THREE.Vector3();

  function growCurvedBranch(origin, dir, len, r, depth) {
    const t0 = depth / 4.2;
    const t1 = (depth + 1) / 4.2;
    _colTmp0.copy(cBase).lerp(cMid, Math.min(1, t0 * 1.4)).lerp(cTip, Math.max(0, t0 - 0.55) * 1.65);
    _colTmp1.copy(cBase).lerp(cMid, Math.min(1, t1 * 1.4)).lerp(cTip, Math.max(0, t1 - 0.55) * 1.65);
    const rNext = r * 0.72;

    // Gentle upward phototropic curvature in 2 sub-segments per generation
    const midDir = dir.clone();
    midDir.y += 0.11 + rng() * 0.08;
    midDir.x += (rng() - 0.5) * 0.08;
    midDir.z += (rng() - 0.5) * 0.08;
    safeNormalize(midDir, 0, 1, 0);

    _sMid.copy(origin).addScaledVector(dir, len * 0.54);
    const end = _sMid.clone().addScaledVector(midDir, len * 0.50);
    const rMid = (r + rNext) * 0.5;
    cSub.copy(_colTmp0).lerp(_colTmp1, 0.5);

    const segs = depth < 2 ? 5 : 4;
    col.addFrustum(origin, _sMid, r, rMid, segs, _colTmp0, cSub, 0, depth > 0);
    col.addFrustum(_sMid, end, rMid, rNext, segs, cSub, _colTmp1, 0, false);

    if (depth === 1 || depth === 2) {
      midNodes.push({ pos: end.clone(), r: rNext, depth });
    }

    // Imbricated tubular radial corallites along mid and distal antler tines
    if (depth >= 1) {
      const refAxis = Math.abs(midDir.y) < 0.9 ? WORLD_UP : new THREE.Vector3(1, 0, 0);
      const p1 = safeNormalize(new THREE.Vector3().crossVectors(midDir, refAxis), 1, 0, 0);
      const p2 = safeNormalize(new THREE.Vector3().crossVectors(midDir, p1), 0, 0, 1);
      const bumpCount = depth === 1 ? 2 : depth === 2 ? 3 : 2;
      for (let b = 0; b < bumpCount; b++) {
        const f = 0.22 + (b / Math.max(1, bumpCount)) * 0.62 + rng() * 0.12;
        const bPos = origin.clone().lerp(end, Math.min(0.92, f));
        const phi = b * 2.15 + rng() * 1.4;
        const radDir = safeNormalize(
          p1.clone().multiplyScalar(Math.cos(phi)).addScaledVector(p2, Math.sin(phi)),
          1,
          0,
          0
        );
        const corDir = safeNormalize(radDir.clone().multiplyScalar(0.76).addScaledVector(midDir, 0.65), 0, 1, 0);
        const surfPos = bPos.clone().addScaledVector(radDir, THREE.MathUtils.lerp(r, rNext, f) * 0.78);
        _sCorTip.copy(surfPos).addScaledVector(corDir, rNext * 0.72);
        col.addFrustum(surfPos, _sCorTip, rNext * 0.34, rNext * 0.24, 4, _colTmp0, _colTmp1, 0, false);
        pushPolypAnchor(polypCandidates, _sCorTip, corDir, 0.76 + rng() * 0.24, cPolypRadial);
      }
    }

    const isLeaf = depth >= 4 || (depth === 3 && rng() < 0.44);
    if (isLeaf) {
      // Flared pale axial corallite calyx cup at tip
      _sCupTip.copy(end).addScaledVector(midDir, rNext * 2.15);
      col.addFrustum(end, _sCupTip, rNext * 0.98, rNext * 0.54, 5, _colTmp1, cTip, 0, false);
      pushPolypAnchor(polypCandidates, _sCupTip, midDir, 0.98 + rng() * 0.22, cPolypAxial);
      return;
    }

    const refAxis = Math.abs(midDir.y) < 0.9 ? WORLD_UP : new THREE.Vector3(1, 0, 0);
    const perp1 = safeNormalize(new THREE.Vector3().crossVectors(midDir, refAxis), 1, 0, 0);
    const perp2 = safeNormalize(new THREE.Vector3().crossVectors(midDir, perp1), 0, 0, 1);
    const basePhi = rng() * Math.PI * 2;

    // Asymmetric antler bifurcation: dominant leader + lateral fork
    for (let c = 0; c < 2; c++) {
      const phi = basePhi + (c === 0 ? 0 : Math.PI * (0.78 + rng() * 0.44)) + (rng() - 0.5) * 0.36;
      const spread = (c === 0 ? 0.24 : 0.48) + rng() * 0.16;
      const childDir = midDir
        .clone()
        .addScaledVector(perp1, Math.cos(phi) * spread)
        .addScaledVector(perp2, Math.sin(phi) * spread);
      childDir.y += 0.22 + depth * 0.07;
      safeNormalize(childDir, 0, 1, 0);
      const lenScale = (c === 0 ? 0.76 : 0.64) + rng() * 0.10;
      growCurvedBranch(end, childDir, len * lenScale, rNext * (c === 0 ? 1.02 : 0.92), depth + 1);
    }
  }

  // 7 radiating curved primary trunks forming a rich 3D antler thicket
  const trunkCount = 7;
  for (let i = 0; i < trunkCount; i++) {
    const a = (i / trunkCount) * Math.PI * 2 + (rng() - 0.5) * 0.28;
    const inner = i % 3 === 0;
    const tilt = inner ? 0.16 + rng() * 0.12 : 0.36 + rng() * 0.18;
    const dir = safeNormalize(
      new THREE.Vector3(Math.cos(a) * tilt, 0.92, Math.sin(a) * tilt),
      0,
      1,
      0
    );
    const startR = inner ? radius * 0.045 : radius * 0.105;
    const start = new THREE.Vector3(Math.cos(a) * startR, -0.015, Math.sin(a) * startR);
    growCurvedBranch(start, dir, radius * (0.26 + rng() * 0.06), radius * 0.056, 0);
  }

  // Anastomosing cross-braces welding dense thicket
  let braces = 0;
  for (let i = 0; i < midNodes.length && braces < 14; i++) {
    const nA = midNodes[i];
    for (let j = i + 1; j < midNodes.length && braces < 14; j++) {
      const nB = midNodes[j];
      if (nA.depth !== nB.depth) continue;
      const d = nA.pos.distanceTo(nB.pos);
      if (d > radius * 0.12 && d < radius * 0.34 && rng() < 0.58) {
        const rBrace = Math.min(nA.r, nB.r) * 0.54;
        col.addFrustum(nA.pos, nB.pos, rBrace, rBrace, 4, cMid, cMid, 0, true);
        const midBrace = nA.pos.clone().lerp(nB.pos, 0.5);
        pushPolypAnchor(polypCandidates, midBrace, WORLD_UP, 0.80, cPolypRadial);
        braces++;
        break;
      }
    }
  }

  const geom = col.toGeometry();
  const polyps = selectTargetPolypCount(polypCandidates, 125, 150, rng, radius * 0.042);
  return { geom, polyps };
}

/**
 * 2. Tiered Tabular Acropora (Acropora hyacinthus / A. cytherea):
 * Fluted 5-rib buttressed holdfast, 1-2 scalloped overlapping tabular canopy plates
 * with underside fenestrated honeycomb lattice ribs + 380-480 dense upturned corymbose
 * branchlets tipped with pale axial corallite cups in 3 Eilat color morphs.
 */
function buildFractalAcroporaTable(radius, rng) {
  const col = createFastGeometryCollector();
  const polypCandidates = [];

  const morphPick = rng();
  const palette =
    morphPick < 0.42
      ? {
          base: '#5c462b',
          mid: '#8e7348',
          branchlet: '#aa8e5b',
          tip: '#b6cfff',
          pCream: '#f6deb6',
          pRim: '#dce7ff',
        }
      : morphPick < 0.74
      ? {
          base: '#684438',
          mid: '#a67364',
          branchlet: '#c48f7e',
          tip: '#f4cce6',
          pCream: '#f9d8cf',
          pRim: '#ffe5f4',
        }
      : {
          base: '#4e5432',
          mid: '#828a52',
          branchlet: '#a4ac6b',
          tip: '#e2f4b8',
          pCream: '#f1f0c2',
          pRim: '#f7ffda',
        };

  const cBase = new THREE.Color(palette.base);
  const cMid = new THREE.Color(palette.mid);
  const cBranch = new THREE.Color(palette.branchlet);
  const cTip = new THREE.Color(palette.tip);
  const cPolypCream = new THREE.Color(palette.pCream);
  const cPolypRim = new THREE.Color(palette.pRim);
  const _col0 = new THREE.Color();
  const _col1 = new THREE.Color();

  // Fluted 5-rib buttressed pedestal with flared attachment foot
  const mainTrunkH = 0.22 + rng() * 0.05;
  const trunkTop = new THREE.Vector3((rng() - 0.5) * 0.04, mainTrunkH, (rng() - 0.5) * 0.04);
  col.addFrustum(
    new THREE.Vector3(0, -0.16, 0),
    trunkTop,
    radius * 0.14,
    radius * 0.115,
    8,
    cBase,
    cBase
  );
  for (let r = 0; r < 5; r++) {
    const ra = (r / 5) * Math.PI * 2 + rng() * 0.28;
    const foot = new THREE.Vector3(Math.cos(ra) * radius * 0.24, -0.155, Math.sin(ra) * radius * 0.24);
    const join = trunkTop.clone().add(new THREE.Vector3(Math.cos(ra) * 0.045, -0.04, Math.sin(ra) * 0.045));
    col.addFrustum(foot, join, radius * 0.062, radius * 0.042, 5, cBase, cBase, 0, true);
  }

  function buildTabularTier(centerPt, tierRadius, boughCount, branchletsTarget, isUpperTier) {
    const tierNodes = [];
    const _acBase = new THREE.Vector3();
    const _acMid = new THREE.Vector3();
    const _acTip = new THREE.Vector3();
    const _acLDir = new THREE.Vector3();
    const _acUDir = new THREE.Vector3();

    function growUndersideRib(origin, dir, len, r, depth) {
      const end = origin.clone().addScaledVector(dir, len);
      const t0 = depth / 3.2;
      const t1 = (depth + 1) / 3.2;
      _col0.copy(cBase).lerp(cMid, Math.min(1, t0 * 1.45));
      _col1.copy(cMid).lerp(cTip, Math.max(0, t1 - 0.55));
      const rNext = r * 0.72;

      col.addFrustum(origin, end, r, rNext, 4, _col0, _col1, 0, true);

      if (depth === 1 || depth === 2 || depth === 3) {
        tierNodes.push({
          pos: end.clone(),
          angle: Math.atan2(end.z - centerPt.z, end.x - centerPt.x),
          r: rNext,
          depth,
        });
      }
      if (depth === 3) return;

      const yaw = Math.atan2(dir.z, dir.x);
      const fan = depth === 0 ? 0.44 : depth === 1 ? 0.33 : 0.24;
      for (let b = 0; b < 2; b++) {
        const sign = b === 0 ? -1 : 1;
        const nextYaw = yaw + sign * (fan + (rng() - 0.5) * 0.11);
        const radialDist = Math.hypot(end.x - centerPt.x, end.z - centerPt.z);
        const cupRise = 0.032 + Math.pow(THREE.MathUtils.clamp(radialDist / Math.max(0.15, tierRadius), 0, 1.15), 1.4) * 0.085;
        const nextDir = safeNormalize(
          new THREE.Vector3(Math.cos(nextYaw), cupRise + (rng() - 0.5) * 0.02, Math.sin(nextYaw)),
          1,
          0,
          0
        );
        growUndersideRib(end, nextDir, len * (0.76 + rng() * 0.10), rNext, depth + 1);
      }
    }

    const startAngle = rng() * Math.PI * 2;
    const petalFreq = 5 + Math.floor(rng() * 3);
    const petalPhase = rng() * Math.PI * 2;

    // Fused anastomosing calcareous plate lamina across the inner 78% of table radius
    // (gives true Acropora table silhouette with laced fenestrated margin rather than sparse wireframe spokes)
    const plateDisc = new THREE.CylinderGeometry(tierRadius * 0.78, tierRadius * 0.20, 0.022, 20, 2);
    const pdPos = plateDisc.attributes.position;
    for (let iv = 0; iv < pdPos.count; iv++) {
      const px = pdPos.getX(iv);
      const py = pdPos.getY(iv);
      const pz = pdPos.getZ(iv);
      const pr = Math.hypot(px, pz);
      const pAng = Math.atan2(pz, px);
      const prNorm = THREE.MathUtils.clamp(pr / Math.max(0.15, tierRadius), 0, 1);
      const scallop = 0.90 + 0.13 * Math.sin(pAng * petalFreq + petalPhase) + 0.05 * Math.cos(pAng * 17.0);
      const saucerY = Math.pow(prNorm, 1.55) * tierRadius * 0.072;
      pdPos.setXYZ(iv, px * scallop, py + saucerY + 0.012, pz * scallop);
    }
    plateDisc.translate(centerPt.x, centerPt.y, centerPt.z);
    plateDisc.computeVertexNormals();
    col.appendGeometry(plateDisc, (x, _y, z, _nx, _ny, _nz, out) => {
      const prNorm = THREE.MathUtils.clamp(
        Math.hypot(x - centerPt.x, z - centerPt.z) / Math.max(0.15, tierRadius * 0.85),
        0,
        1
      );
      out.copy(cBase).lerp(cMid, prNorm * 0.92);
    });
    plateDisc.dispose();

    for (let i = 0; i < boughCount; i++) {
      const a = startAngle + (i / boughCount) * Math.PI * 2 + (rng() - 0.5) * 0.08;
      const petalGain = 0.91 + 0.14 * Math.sin(a * petalFreq + petalPhase);
      const limbDir = safeNormalize(new THREE.Vector3(Math.cos(a), 0.045, Math.sin(a)), 1, 0, 0);
      growUndersideRib(centerPt, limbDir, tierRadius * 0.27 * petalGain, tierRadius * 0.052, 0);
    }

    // Anastomosing circumferential cross-bridges welding the outer lacy tabular rim
    for (const targetDepth of [1, 2, 3]) {
      const ring = tierNodes
        .filter((n) => n.depth === targetDepth)
        .sort((a, b) => a.angle - b.angle);
      for (let i = 0; i < ring.length; i++) {
        const nA = ring[i];
        const nB = ring[(i + 1) % ring.length];
        const d = nA.pos.distanceTo(nB.pos);
        const maxGap = targetDepth === 3 ? tierRadius * 0.36 : tierRadius * 0.44;
        if (d > tierRadius * 0.04 && d < maxGap && (targetDepth >= 2 || rng() < 0.88)) {
          const rb = Math.min(nA.r, nB.r) * (targetDepth === 3 ? 0.92 : 0.78);
          const colBridge = targetDepth === 3 ? cTip : cMid;
          col.addFrustum(nA.pos, nB.pos, rb, rb, 4, cMid, colBridge, 0, true);
        }
      }
    }

    // Dense phyllotactic carpet of upward-curving corymbose branchlets across the tabular plate
    const bCount = branchletsTarget;
    for (let k = 0; k < bCount; k++) {
      const uFrac = (k + 0.5) / bCount;
      const angle = k * 2.3999632 + rng() * 0.22;
      const petalMod = 0.90 + 0.13 * Math.sin(angle * petalFreq + petalPhase);
      const rad = Math.sqrt(uFrac) * tierRadius * 0.94 * petalMod;
      const lx = Math.cos(angle) * rad;
      const lz = Math.sin(angle) * rad;
      const rNorm = THREE.MathUtils.clamp(rad / Math.max(0.15, tierRadius), 0, 1);

      const plateY = centerPt.y + 0.015 + Math.pow(rNorm, 1.65) * tierRadius * 0.085;
      _acBase.set(centerPt.x + lx, plateY, centerPt.z + lz);

      const outWeight = Math.pow(rNorm, 1.35) * 0.72;
      const radOutX = rad > 1e-4 ? lx / rad : Math.cos(angle);
      const radOutZ = rad > 1e-4 ? lz / rad : Math.sin(angle);

      _acLDir.set(
        radOutX * outWeight + (rng() - 0.5) * 0.14,
        1.0 - outWeight * 0.32,
        radOutZ * outWeight + (rng() - 0.5) * 0.14
      );
      safeNormalize(_acLDir, 0, 1, 0);

      _acUDir.set(
        radOutX * (outWeight * 0.24) + (rng() - 0.5) * 0.08,
        1.0,
        radOutZ * (outWeight * 0.24) + (rng() - 0.5) * 0.08
      );
      safeNormalize(_acUDir, 0, 1, 0);

      const stemH = (isUpperTier ? 0.042 : 0.052) * (1.0 - 0.25 * rNorm * rNorm) + rng() * 0.018;
      const rBase = 0.0125 + (1.0 - rNorm) * 0.0055;
      const rCup = rBase * 0.64;

      _acMid.copy(_acBase).addScaledVector(_acLDir, stemH * 0.68);
      _acTip.copy(_acMid).addScaledVector(_acUDir, stemH * 0.42);

      _col0.copy(cMid).lerp(cBranch, 0.55 + rNorm * 0.35);
      _col1.copy(cBranch).lerp(cTip, rNorm * 0.65);

      col.addFrustum(_acBase, _acMid, rBase, rCup, 3, cMid, _col0, 0, true);
      col.addFrustum(_acMid, _acTip, rCup * 1.05, rCup * 0.54, 3, _col0, cTip, 0, false);

      if (k % 2 === 0 || rNorm > 0.80) {
        pushPolypAnchor(
          polypCandidates,
          _acTip,
          _acUDir,
          0.74 + rng() * 0.24,
          rNorm > 0.72 ? cPolypRim : cPolypCream
        );
      }
    }
  }

  // Primary wide scalloped tabular canopy + optional staggered secondary sub-plate
  const hasUpperTier = rng() < 0.58;
  if (hasUpperTier) {
    buildTabularTier(trunkTop, radius * 0.98, 9, 210, false);
    const upperOffsetAngle = rng() * Math.PI * 2;
    const upperOrigin = trunkTop
      .clone()
      .add(new THREE.Vector3(Math.cos(upperOffsetAngle) * radius * 0.14, 0.115, Math.sin(upperOffsetAngle) * radius * 0.14));
    col.addFrustum(trunkTop, upperOrigin, radius * 0.068, radius * 0.052, 5, cBase, cMid, 0, true);
    buildTabularTier(upperOrigin, radius * 0.60, 7, 100, true);
  } else {
    buildTabularTier(trunkTop, radius * 1.02, 10, 280, false);
  }

  const geom = col.toGeometry();
  const polyps = selectTargetPolypCount(polypCandidates, 145, 175, rng, radius * 0.04);
  return { geom, polyps };
}

/**
 * 3. Stylophora pistillata: encrusting base + 8 basal stems x 4 dichotomous Y-bifurcations
 * (120 thick clubbed branches) with verrucose corallite micro-relief.
 */
function buildFractalStylophora(radius, morph, rng) {
  const col = createFastGeometryCollector();
  const polypCandidates = [];
  const palette =
    morph === 'pink'
      ? { base: '#8c2254', mid: '#e24c93', tip: '#ffb5d9', polyp: '#ffd6eb' }
      : morph === 'violet'
      ? { base: '#572880', mid: '#9e5be3', tip: '#e3c4ff', polyp: '#eed9ff' }
      : { base: '#8f692a', mid: '#dba84f', tip: '#fff0c4', polyp: '#fff5d4' };

  const cBase = new THREE.Color(palette.base);
  const cMid = new THREE.Color(palette.mid);
  const cTip = new THREE.Color(palette.tip);
  const cPolyp = new THREE.Color(palette.polyp);

  // Encrusting holdfast base
  for (let h = 0; h < 3; h++) {
    const a = (h / 3) * Math.PI * 2 + rng() * 0.4;
    const baseLobe = new THREE.IcosahedronGeometry(radius * (h === 0 ? 0.16 : 0.11), 1);
    baseLobe.scale(1.3, 0.38, 1.3);
    baseLobe.translate(
      h === 0 ? 0 : Math.cos(a) * radius * 0.1,
      -0.015,
      h === 0 ? 0 : Math.sin(a) * radius * 0.1
    );
    col.appendGeometry(baseLobe, cBase);
    baseLobe.dispose();
  }

  let phylloIdx = 0;

  function bifurcate(origin, dir, len, r, depth) {
    const end = origin.clone().addScaledVector(dir, len);
    const t0 = depth / 4;
    const t1 = (depth + 1) / 4;
    const col0 = cBase.clone().lerp(cMid, Math.min(1, t0 * 1.5)).lerp(cTip, Math.max(0, t0 - 0.4) * 1.7);
    const col1 = cBase.clone().lerp(cMid, Math.min(1, t1 * 1.5)).lerp(cTip, Math.max(0, t1 - 0.4) * 1.7);
    const rNext = r * 0.78; // thick blunt Stylophora club taper

    col.addFrustum(
      origin,
      end,
      r,
      rNext,
      depth < 2 ? 6 : 5,
      col0,
      col1,
      0,
      depth > 0
    );

    // Verrucose corallite micro-relief & phyllotactic polyp anchors
    if (depth >= 1) {
      const refAxis = Math.abs(dir.y) < 0.88 ? WORLD_UP : new THREE.Vector3(1, 0, 0);
      const p1 = safeNormalize(new THREE.Vector3().crossVectors(dir, refAxis), 1, 0, 0);
      const p2 = safeNormalize(new THREE.Vector3().crossVectors(dir, p1), 0, 0, 1);
      const verrucaCount = depth === 3 ? 2 : 1;
      for (let v = 0; v < verrucaCount; v++) {
        const phi = phylloIdx * 2.39996 + rng() * 0.35;
        phylloIdx++;
        const f = 0.28 + (v + rng() * 0.45) * 0.34;
        const bPt = origin.clone().lerp(end, Math.min(0.9, f));
        const radDir = safeNormalize(
          p1.clone().multiplyScalar(Math.cos(phi)).addScaledVector(p2, Math.sin(phi)),
          1,
          0,
          0
        );
        const surf = bPt.clone().addScaledVector(radDir, THREE.MathUtils.lerp(r, rNext, f) * 0.84);
        const outDir = safeNormalize(radDir.clone().multiplyScalar(0.84).addScaledVector(dir, 0.54), 0, 1, 0);
        col.addCone(surf, outDir, rNext * 0.38, rNext * 0.56, 4, col0, col1);
        pushPolypAnchor(
          polypCandidates,
          surf.clone().addScaledVector(outDir, rNext * 0.46),
          outDir,
          0.78 + rng() * 0.22,
          cPolyp
        );
      }
    }

    if (depth >= 3) {
      // Smooth rounded clubbed Stylophora hood dome on every branch terminal (zero heavy cap spheres)
      const domeMid = end.clone().addScaledVector(dir, rNext * 0.52);
      const domeTip = end.clone().addScaledVector(dir, rNext * 1.15);
      col.addFrustum(end, domeMid, rNext, rNext * 0.90, 5, col1, cTip, 0, true);
      col.addFrustum(domeMid, domeTip, rNext * 0.90, rNext * 0.32, 5, cTip, cTip, 0, false);
      pushPolypAnchor(polypCandidates, domeTip, dir, 0.92 + rng() * 0.18, cPolyp);
      return;
    }

    const refAxis = Math.abs(dir.y) < 0.88 ? WORLD_UP : new THREE.Vector3(1, 0, 0);
    const tangent = safeNormalize(new THREE.Vector3().crossVectors(dir, refAxis), 1, 0, 0);
    const bitangent = safeNormalize(new THREE.Vector3().crossVectors(dir, tangent), 0, 0, 1);
    const rotPhi = rng() * Math.PI;
    const splitAxis = tangent.clone().multiplyScalar(Math.cos(rotPhi)).addScaledVector(bitangent, Math.sin(rotPhi));
    const spread = 0.44 + rng() * 0.14;

    for (const side of [-1, 1]) {
      const childDir = dir.clone().addScaledVector(splitAxis, side * spread);
      childDir.y += 0.15;
      safeNormalize(childDir, 0, 1, 0);
      bifurcate(end, childDir, len * (0.76 + rng() * 0.10), rNext, depth + 1);
    }
  }

  // 8 basal stems -> 8 * (1 + 2 + 4 + 8 = 15) = 120 thick dichotomous clubbed branches
  const stemCount = 8;
  for (let i = 0; i < stemCount; i++) {
    const theta = (i / stemCount) * Math.PI * 2 + rng() * 0.32;
    const tilt = i === 0 ? 0.14 : 0.54 + rng() * 0.24;
    const dir = safeNormalize(
      new THREE.Vector3(Math.sin(tilt) * Math.cos(theta), Math.cos(tilt), Math.sin(tilt) * Math.sin(theta)),
      0,
      1,
      0
    );
    const start = new THREE.Vector3(Math.cos(theta) * 0.035, -0.015, Math.sin(theta) * 0.035);
    bifurcate(start, dir, radius * 0.28, radius * 0.064, 0);
  }

  const geom = col.toGeometry();
  const polyps = selectTargetPolypCount(polypCandidates, 110, 130, rng, radius * 0.04);
  return { geom, polyps };
}

/**
 * 4. Millepora dichotoma (Net Fire Coral): 4 intersecting/sub-parallel flabellate dichotomous blade fans
 * + anastomosing honeycomb cross-bars + ivory tips.
 */
function buildMilleporaFan(radius, rng) {
  const col = createFastGeometryCollector();
  const polypCandidates = [];
  const cBase = new THREE.Color('#8c5d19');
  const cMid = new THREE.Color('#d69c31');
  const cTip = new THREE.Color('#fff6db');
  const cDactylo = new THREE.Color('#fff7d6');
  const cSub = new THREE.Color();

  const sheetNodes = [];

  function growBlade(origin, dir, fanRight, len, width, depth, sheetIdx) {
    const col0 = depth < 2 ? cBase.clone().lerp(cMid, depth * 0.5) : cMid;
    const col1 = depth >= 2 ? cTip : cMid;
    cSub.copy(col0).lerp(col1, 0.5);

    const up1 = safeNormalize(dir.clone(), 0, 1, 0);
    const rightBase = safeNormalize(fanRight.clone(), 1, 0, 0);
    const fwd1 = safeNormalize(new THREE.Vector3().crossVectors(rightBase, up1), 0, 0, 1);
    const right1 = safeNormalize(new THREE.Vector3().crossVectors(up1, fwd1), 1, 0, 0);

    // Subtle sinusoidal roll / undulation across 2 curved plate segments
    const mid = origin.clone().addScaledVector(up1, len * 0.52);
    const bendDir = safeNormalize(
      up1.clone().addScaledVector(fwd1, (rng() - 0.5) * 0.24 + ((sheetIdx + depth) % 2 === 0 ? 0.12 : -0.12)),
      0,
      1,
      0
    );
    const end = mid.clone().addScaledVector(bendDir, len * 0.48);

    const seg1Mid = origin.clone().lerp(mid, 0.5);
    const seg2Mid = mid.clone().lerp(end, 0.5);
    const fwd2 = safeNormalize(new THREE.Vector3().crossVectors(right1, bendDir), 0, 0, 1);
    const right2 = safeNormalize(new THREE.Vector3().crossVectors(bendDir, fwd2), 1, 0, 0);

    const wMid = width * 0.96;
    const wEnd = width * 1.14;
    col.addBox(seg1Mid, right1, up1, fwd1, width * 0.78, wMid, len * 0.54, 0.021, col0, cSub.clone());
    col.addBox(seg2Mid, right2, bendDir, fwd2, wMid, wEnd, len * 0.50, 0.017, cSub.clone(), col1);

    if (depth >= 1) {
      sheetNodes.push({ pos: mid.clone(), end: end.clone(), depth, sheetIdx });
    }

    // Dactylozoid stinging hair anchors on both blade faces & upper growing edges
    const faceCount = depth === 0 ? 1 : 2;
    for (let f = 0; f < faceCount; f++) {
      const sideSign = f % 2 === 0 ? 1 : -1;
      const along = (rng() - 0.5) * 0.48 * len;
      const across = (rng() - 0.5) * 0.55 * width;
      const facePos = seg2Mid
        .clone()
        .addScaledVector(bendDir, along)
        .addScaledVector(right2, across)
        .addScaledVector(fwd2, sideSign * 0.011);
      const faceNorm = fwd2.clone().multiplyScalar(sideSign);
      pushPolypAnchor(polypCandidates, facePos, faceNorm, 0.85 + rng() * 0.25, cDactylo);
    }

    if (depth >= 3) {
      // Digitate ivory growing crests along blade top margin
      const crestCount = 3;
      for (let c = 0; c < crestCount; c++) {
        const cf = (c - 1) * 0.32;
        const cBasePt = end.clone().addScaledVector(right2, cf * wEnd);
        const cTopPt = cBasePt.clone().addScaledVector(bendDir, 0.022 + rng() * 0.016);
        col.addFrustum(cBasePt, cTopPt, 0.011, 0.006, 4, col1, cTip, 0.005, true);
        pushPolypAnchor(polypCandidates, cTopPt, bendDir, 0.94 + rng() * 0.22, cDactylo);
      }
      return;
    }

    for (const side of [-1, 1]) {
      const nextDir = bendDir.clone().addScaledVector(right2, side * (0.38 + rng() * 0.16));
      nextDir.y += 0.24;
      safeNormalize(nextDir, 0, 1, 0);
      growBlade(end, nextDir, right2, len * 0.78, width * 0.77, depth + 1, sheetIdx);
    }
  }

  // 4 intersecting / sub-parallel flabellate blade fans
  const sheetConfigs = [
    { angle: rng() * Math.PI, offsetX: -0.03, offsetZ: -0.02 },
    { angle: 1.05 + rng() * 0.35, offsetX: 0.04, offsetZ: 0.03 },
    { angle: 2.15 + rng() * 0.35, offsetX: -0.05, offsetZ: 0.06 },
    { angle: 0.32 + rng() * 0.30, offsetX: 0.08, offsetZ: -0.07 },
  ];
  for (let s = 0; s < sheetConfigs.length; s++) {
    const cfg = sheetConfigs[s];
    const fanRight = new THREE.Vector3(Math.cos(cfg.angle), 0, Math.sin(cfg.angle));
    const start = new THREE.Vector3(cfg.offsetX, -0.02, cfg.offsetZ);
    const dir = safeNormalize(
      new THREE.Vector3((rng() - 0.5) * 0.12, 1, (rng() - 0.5) * 0.12),
      0,
      1,
      0
    );
    growBlade(start, dir, fanRight, radius * 0.28, radius * 0.165, 0, s);
  }

  // Anastomosing honeycomb cross-bars linking nearby blade nodes
  let bars = 0;
  for (let i = 0; i < sheetNodes.length && bars < 30; i++) {
    const a = sheetNodes[i];
    for (let j = i + 1; j < sheetNodes.length && bars < 30; j++) {
      const b = sheetNodes[j];
      const d = a.pos.distanceTo(b.pos);
      if (d > radius * 0.09 && d < radius * 0.33 && (a.sheetIdx !== b.sheetIdx || rng() < 0.52)) {
        col.addFrustum(a.pos, b.pos, 0.012, 0.012, 4, cMid, cMid, 0, true);
        const midBar = a.pos.clone().lerp(b.pos, 0.5);
        pushPolypAnchor(polypCandidates, midBar, WORLD_UP, 0.85, cDactylo);
        bars++;
        break;
      }
    }
  }

  const geom = col.toGeometry();
  const polyps = selectTargetPolypCount(polypCandidates, 100, 120, rng, radius * 0.04);
  return { geom, polyps };
}

/**
 * 5. Platygyra Brain Coral (detail = 5): scalloped basal margin, deep sinuous meandroid valleys,
 * transverse septocostal striations along valley walls, emerald/mint valleys & warm terracotta ridges.
 */
function buildPlatygyraDome(radius, rng) {
  const geom = CORAL_ICO_8.clone();

  const pos = geom.attributes.position;
  const seedX = rng() * 25;
  const seedZ = rng() * 25;
  const scallopPhase = rng() * Math.PI * 2;
  const freq = 6.2 / Math.max(0.35, radius);
  const septaFreq = 26.0 / Math.max(0.35, radius);

  const vertRidge = new Float32Array(pos.count);
  const vertSepta = new Float32Array(pos.count);
  const vertWallMask = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) * radius;
    let y = pos.getY(i) * radius;
    let z = pos.getZ(i) * radius;

    if (y < 0) y *= 0.46;
    else y *= 0.84;

    if (y < radius * 0.16) {
      const ang = Math.atan2(z, x);
      const skirt = 1.0 - THREE.MathUtils.clamp(y / (radius * 0.16), 0, 1);
      const scallop = 1.0 + Math.sin(ang * 7.0 + scallopPhase) * 0.08 * skirt;
      x *= scallop;
      z *= scallop;
    }

    const warpX = x + (fbm3D(x * 2.3 + seedX, y * 2.3, z * 2.3, 2) - 0.5) * 0.34;
    const warpZ = z + (fbm3D(x * 2.3, y * 2.3 + seedZ, z * 2.3, 2) - 0.5) * 0.34;
    const warpY = y + (fbm3D(x * 2.3, y * 2.3, z * 2.3 + seedX, 2) - 0.5) * 0.22;

    const labyrinth =
      Math.sin(warpX * freq + Math.cos(warpZ * freq * 0.82 + warpY * freq * 0.5) * 2.35) *
      Math.cos(warpZ * freq * 0.94 + Math.sin(warpX * freq * 0.76 - warpY * freq * 0.42) * 2.25);

    const ridge = THREE.MathUtils.clamp(Math.abs(labyrinth) * 1.72, 0, 1);
    const septa = Math.sin(warpX * septaFreq + warpZ * septaFreq * 0.85 + warpY * septaFreq * 0.4);
    const wallMask =
      THREE.MathUtils.smoothstep(ridge, 0.20, 0.48) * (1.0 - THREE.MathUtils.smoothstep(ridge, 0.72, 0.96));

    vertRidge[i] = ridge;
    vertSepta[i] = septa;
    vertWallMask[i] = wallMask;

    const valleyCurve = Math.pow(ridge, 0.85);
    const disp = (valleyCurve - 0.42) * 0.135 * radius + septa * wallMask * 0.014 * radius;

    const invLen = 1.0 / Math.max(1e-5, Math.hypot(x, y, z));
    pos.setXYZ(i, x + x * invLen * disp, y + y * invLen * disp, z + z * invLen * disp);
  }

  pos.needsUpdate = true;
  geom.computeVertexNormals();

  const niPos = geom.attributes.position;
  const niNorm = geom.attributes.normal;
  const idxAttr = geom.index;
  const colors = new Float32Array(niPos.count * 3);
  const cValley = new THREE.Color('#229650');
  const cValleyGlow = new THREE.Color('#6bf291');
  const cWallWarm = new THREE.Color('#9e5234');
  const cRidgeTop = new THREE.Color('#cc8856');
  const cPolypValley = new THREE.Color('#80ffba');
  const tmp = new THREE.Color();

  for (let i = 0; i < niPos.count; i++) {
    const ridge = vertRidge[i];
    const septa = vertSepta[i];
    const wallMask = vertWallMask[i];

    if (ridge < 0.46) {
      tmp.copy(cValley).lerp(cValleyGlow, (1 - ridge / 0.46) * 0.82);
    } else {
      tmp.copy(cWallWarm).lerp(cRidgeTop, (ridge - 0.46) / 0.54);
      if (wallMask > 0.02) {
        tmp.offsetHSL(0, 0, septa * wallMask * 0.065);
      }
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  const polypCandidates = [];
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const n0 = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  const n2 = new THREE.Vector3();
  const samplePt = new THREE.Vector3();
  const sampleNorm = new THREE.Vector3();
  const baryWeights = [
    [1 / 3, 1 / 3, 1 / 3],
    [0.5, 0.5, 0.0],
    [0.0, 0.5, 0.5],
    [0.5, 0.0, 0.5],
  ];

  const triCount = idxAttr ? idxAttr.count : niPos.count;
  for (let t = 0; t + 2 < triCount; t += 3) {
    const i0 = idxAttr ? idxAttr.getX(t) : t;
    const i1 = idxAttr ? idxAttr.getX(t + 1) : t + 1;
    const i2 = idxAttr ? idxAttr.getX(t + 2) : t + 2;

    v0.fromBufferAttribute(niPos, i0);
    v1.fromBufferAttribute(niPos, i1);
    v2.fromBufferAttribute(niPos, i2);
    n0.fromBufferAttribute(niNorm, i0);
    n1.fromBufferAttribute(niNorm, i1);
    n2.fromBufferAttribute(niNorm, i2);
    const r0 = vertRidge[i0];
    const r1 = vertRidge[i1];
    const r2 = vertRidge[i2];

    for (let b = 0; b < baryWeights.length; b++) {
      const [w0, w1, w2] = baryWeights[b];
      const ridge = r0 * w0 + r1 * w1 + r2 * w2;
      if (ridge >= 0.34) continue;

      samplePt.set(
        v0.x * w0 + v1.x * w1 + v2.x * w2,
        v0.y * w0 + v1.y * w1 + v2.y * w2,
        v0.z * w0 + v1.z * w1 + v2.z * w2
      );
      if (samplePt.y <= radius * 0.04) continue;
      sampleNorm.set(
        n0.x * w0 + n1.x * w1 + n2.x * w2,
        n0.y * w0 + n1.y * w1 + n2.y * w2,
        n0.z * w0 + n1.z * w1 + n2.z * w2
      );
      if (sampleNorm.y <= 0.05) continue;

      const col = cPolypValley.clone().lerp(cValleyGlow, rng() * 0.45);
      pushPolypAnchor(polypCandidates, samplePt, sampleNorm, 0.82 + rng() * 0.32, col);
    }
  }

  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const polyps = selectTargetPolypCount(polypCandidates, 130, 150, rng, radius * 0.068);
  return { geom, polyps };
}

/**
 * 6. Porites Massive Boulder Coral: 7 coalescing hummocky nodular lobes (IcosahedronGeometry(r, 4))
 * with multi-octave nodular relief, cellular calice shading & surface-carpeting polyp anchors.
 */
function buildPoritesDome(radius, morph, rng) {
  const parts = [];
  const polypCandidates = [];
  const baseHex = morph === 'lilac' ? '#9c83a6' : morph === 'ochre' ? '#b89448' : '#a8965c';
  const hiHex = morph === 'lilac' ? '#cbb6d6' : morph === 'ochre' ? '#dec074' : '#d4c588';
  const polypHex = morph === 'lilac' ? '#e7d5f5' : morph === 'ochre' ? '#f7e19c' : '#f2e6ba';
  const cBase = new THREE.Color(baseHex);
  const cHi = new THREE.Color(hiHex);
  const cPolyp = new THREE.Color(polypHex);
  const tmpCol = new THREE.Color();

  const lobes = [];
  for (let l = 0; l < 7; l++) {
    const isMain = l === 0;
    const r = radius * (isMain ? 0.72 : 0.36 + rng() * 0.14);
    const a = ((l - 1) / 6) * Math.PI * 2 + (rng() - 0.5) * 0.45;
    const dist = isMain ? 0 : radius * (0.36 + rng() * 0.16);
    const ox = isMain ? 0 : Math.cos(a) * dist;
    const oz = isMain ? 0 : Math.sin(a) * dist;
    const oy = isMain ? 0.04 * radius : (-0.04 + rng() * 0.15) * radius;
    lobes.push({ ox, oy, oz, r, seed: rng() * 45 });
  }

  for (let l = 0; l < lobes.length; l++) {
    const lobe = lobes[l];
    const sph = CORAL_ICO_5.clone();

    const pos = sph.attributes.position;
    const n1Cache = new Float32Array(pos.count);

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) * lobe.r;
      let y = pos.getY(i) * lobe.r;
      let z = pos.getZ(i) * lobe.r;
      if (y < 0) y *= 0.46;
      const n1 = fbm3D(x * 5.2 + lobe.seed, y * 5.2, z * 5.2, 3);
      const n2 = fbm3D(x * 12.5, y * 12.5 + lobe.seed, z * 12.5, 2);
      n1Cache[i] = n1;
      const bumps = n1 * 0.18 + (n2 - 0.5) * 0.08 + Math.sin(x * 15 + z * 13) * 0.02;
      const s = 0.90 + bumps;
      pos.setXYZ(i, lobe.ox + x * s, lobe.oy + y * s * 0.92, lobe.oz + z * s);
    }
    pos.needsUpdate = true;
    sph.computeVertexNormals();

    const pNorm = sph.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = pNorm.getY(i);
      const n = n1Cache[i];
      const calice = Math.abs(Math.sin(x * 36.0 + n * 3.0) * Math.sin(z * 36.0 + y * 24.0));
      tmpCol.copy(cBase).lerp(cHi, THREE.MathUtils.clamp(ny * 0.55 + n * 0.45, 0, 1));
      tmpCol.multiplyScalar(0.88 + calice * 0.18);
      colors[i * 3] = tmpCol.r;
      colors[i * 3 + 1] = tmpCol.g;
      colors[i * 3 + 2] = tmpCol.b;
    }
    sph.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(prepareForMerge(sph));

    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const n0 = new THREE.Vector3();
    const n1 = new THREE.Vector3();
    const n2 = new THREE.Vector3();
    const cPt = new THREE.Vector3();
    const cN = new THREE.Vector3();

    const idxAttr = sph.index;
    const triCount = idxAttr ? idxAttr.count : pos.count;
    for (let t = 0; t + 2 < triCount; t += 3) {
      const i0 = idxAttr ? idxAttr.getX(t) : t;
      const i1 = idxAttr ? idxAttr.getX(t + 1) : t + 1;
      const i2 = idxAttr ? idxAttr.getX(t + 2) : t + 2;

      v0.fromBufferAttribute(pos, i0);
      v1.fromBufferAttribute(pos, i1);
      v2.fromBufferAttribute(pos, i2);
      n0.fromBufferAttribute(pNorm, i0);
      n1.fromBufferAttribute(pNorm, i1);
      n2.fromBufferAttribute(pNorm, i2);

      cPt.copy(v0).add(v1).add(v2).multiplyScalar(1 / 3);
      cN.copy(n0).add(n1).add(n2).multiplyScalar(1 / 3);
      if (cN.y <= -0.05 || cPt.y < -radius * 0.06) continue;

      let buried = false;
      for (let o = 0; o < lobes.length; o++) {
        if (o === l) continue;
        const ob = lobes[o];
        const dx = cPt.x - ob.ox;
        const dy = (cPt.y - ob.oy) / 0.92;
        const dz = cPt.z - ob.oz;
        if (dx * dx + dy * dy + dz * dz < ob.r * ob.r * 0.78) {
          buried = true;
          break;
        }
      }
      if (!buried) {
        const col = cPolyp.clone().offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.06);
        pushPolypAnchor(polypCandidates, cPt, cN, 0.76 + rng() * 0.30, col);
      }
    }
    sph.dispose();
  }

  const geom = safeMerge(parts);
  const polyps = selectTargetPolypCount(polypCandidates, 140, 170, rng, radius * 0.072);
  return { geom, polyps };
}

/**
 * 7a. Dendronephthya (Carnation Soft Tree Coral): diagonal white sclerite striping + rich 8-rayed floret umbels.
 */
function buildDendronephthyaPrototype() {
  const parts = [];
  const cStalk = new THREE.Color('#d9c7cc');
  const cSclerite = new THREE.Color('#ffffff');
  const cPolyp = new THREE.Color('#ffffff'); // tinted brightly by instanceColor!

  function addStripedStalk(start, end, rB, rT) {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    if (len < 1e-4) return;
    const cyl = new THREE.CylinderGeometry(rT, rB, len, 6, 2, false);
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const normDir = safeNormalize(dir.clone(), 0, 1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, normDir);
    cyl.applyMatrix4(new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1)));
    parts.push(
      prepareForMerge(cyl, (x, y, z, _nx, _ny, _nz, out) => {
        const relX = x - start.x;
        const relY = y - start.y;
        const relZ = z - start.z;
        const proj = relX * normDir.x + relY * normDir.y + relZ * normDir.z;
        const ang = Math.atan2(z - mid.z, x - mid.x);
        const stripe = Math.sin(proj * 95.0 + ang * 3.0);
        out.copy(cStalk).lerp(cSclerite, THREE.MathUtils.smoothstep(stripe, 0.25, 0.75) * 0.92);
      })
    );
    cyl.dispose();
  }

  const floretParts = [];
  const budTemplate = new THREE.IcosahedronGeometry(0.013, 0);
  floretParts.push(prepareForMerge(budTemplate, cPolyp));
  budTemplate.dispose();
  const originZero = new THREE.Vector3(0, 0, 0);
  const unitScale = new THREE.Vector3(1, 1, 1);
  for (let r = 0; r < 8; r++) {
    const a = (r / 8) * Math.PI * 2;
    const ray = new THREE.ConeGeometry(0.0055, 0.022, 3, 1, true);
    ray.translate(0, 0.011, 0);
    const rayDir = safeNormalize(new THREE.Vector3(Math.cos(a) * 0.85, 0.55, Math.sin(a) * 0.85), 0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, rayDir);
    ray.applyMatrix4(new THREE.Matrix4().compose(originZero, q, unitScale));
    floretParts.push(prepareForMerge(ray, cPolyp));
    ray.dispose();
  }
  const floretTemplate = safeMerge(floretParts);

  function addEightRayedFloret(center) {
    parts.push(floretTemplate.clone().translate(center.x, center.y, center.z));
  }

  function growSoftBranch(origin, dir, len, r, depth) {
    const end = origin.clone().addScaledVector(dir, len);
    addStripedStalk(origin, end, r, r * 0.72);
    if (depth >= 2) {
      // Richer 8-rayed floret umbels at branchlet apex
      for (let p = 0; p < 6; p++) {
        const phi = (p / 6) * Math.PI * 2;
        const rad = p === 0 ? 0 : 0.032;
        const pPos = end.clone().add(
          new THREE.Vector3(Math.cos(phi) * rad, 0.014 + (p % 2) * 0.015, Math.sin(phi) * rad)
        );
        addEightRayedFloret(pPos);
      }
      return;
    }

    const forks = 3;
    for (let f = 0; f < forks; f++) {
      const a = (f / forks) * Math.PI * 2 + depth * 0.7;
      const childDir = safeNormalize(
        new THREE.Vector3(dir.x + Math.cos(a) * 0.6, dir.y + 0.45, dir.z + Math.sin(a) * 0.6),
        0,
        1,
        0
      );
      growSoftBranch(end, childDir, len * 0.7, r * 0.68, depth + 1);
    }
  }

  growSoftBranch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 0.14, 0.034, 0);
  floretTemplate.dispose();
  return safeMerge(parts);
}

/**
 * 7b. Sarcophyton Leather & Pulsing Xenia Soft Corals prototype:
 * Deeply ruffled 9+17-wave cap + 52 explicit 3D 8-tentacle autozooid polyps + pulsing Xenia tufts.
 */
function buildSarcophytonPrototype() {
  const parts = [];
  const cStalk = new THREE.Color('#9c8b70');
  const cCap = new THREE.Color('#c7b07b');
  const cPolypTip = new THREE.Color('#ebd9ad');
  const cAutozooid = new THREE.Color('#fff1cc');

  // Thick fleshy pedestal stalk
  addBranchSegment(parts, new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0, 0.14, 0), 0.078, 0.10, 12, cStalk, cCap);

  function evalCapRuffle(x, z) {
    const r = Math.hypot(x, z);
    const angle = Math.atan2(z, x);
    const edgeFrac = THREE.MathUtils.clamp(r / 0.29, 0, 1);
    const primary = Math.sin(angle * 7.0) * 0.068 + Math.cos(angle * 13.0 + 0.6) * 0.036;
    const micro = Math.sin(angle * 21.0) * 0.014;
    const cupCurl = Math.pow(edgeFrac, 3.2) * 0.032 - Math.exp(-r * r * 95.0) * 0.018;
    return (primary + micro) * Math.pow(edgeFrac, 1.8) + cupCurl;
  }

  // Deeply involute ruffled toadstool leather cap with curled lip
  const cap = new THREE.CylinderGeometry(0.29, 0.115, 0.058, 46, 4);
  cap.translate(0, 0.17, 0);
  const pos = cap.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const angle = Math.atan2(z, x);
    const edgeFrac = THREE.MathUtils.clamp(r / 0.29, 0, 1);
    const radialFold = 1.0 + Math.sin(angle * 7.0) * 0.075 * edgeFrac + Math.cos(angle * 13.0 + 0.6) * 0.042 * edgeFrac;
    const nx = x * radialFold;
    const nz = z * radialFold;
    pos.setXYZ(i, nx, y + evalCapRuffle(nx, nz), nz);
  }
  cap.computeVertexNormals();
  parts.push(
    prepareForMerge(cap, (x, y, z, _nx, _ny, _nz, out) => {
      const r = THREE.MathUtils.clamp(Math.hypot(x, z) / 0.29, 0, 1);
      const foldTint = y > 0.18 ? 0.12 : -0.10;
      out.copy(cCap).lerp(cPolypTip, THREE.MathUtils.clamp(r * 0.68 + foldTint, 0, 1));
    })
  );
  cap.dispose();

  // 52 explicit 3D 8-tentacle autozooid polyps carpeting the ruffled leather cap
  const autozooidParts = [];
  const azStalk = new THREE.CylinderGeometry(0.0032, 0.0042, 0.015, 4, 1, true);
  azStalk.translate(0, 0.007, 0);
  autozooidParts.push(prepareForMerge(azStalk, cPolypTip));
  azStalk.dispose();

  const azCrownCenter = new THREE.Vector3(0, 0.014, 0);
  const azScale = new THREE.Vector3(1, 1, 1);
  for (let t = 0; t < 8; t++) {
    const ta = (t / 8) * Math.PI * 2;
    const tDir = safeNormalize(
      new THREE.Vector3(Math.cos(ta) * 0.78, 0.62, Math.sin(ta) * 0.78),
      0,
      1,
      0
    );
    const tent = new THREE.ConeGeometry(0.0026, 0.014, 3, 1, true);
    tent.translate(0, 0.007, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, tDir);
    tent.applyMatrix4(new THREE.Matrix4().compose(azCrownCenter, q, azScale));
    autozooidParts.push(prepareForMerge(tent, cAutozooid));
    tent.dispose();
  }
  const autozooidTemplate = safeMerge(autozooidParts);

  for (let p = 0; p < 52; p++) {
    const frac = (p + 0.5) / 52;
    const rad = 0.032 + Math.sqrt(frac) * 0.225;
    const ang = p * 2.39996;
    const px = Math.cos(ang) * rad;
    const pz = Math.sin(ang) * rad;
    const py = 0.197 + evalCapRuffle(px, pz);
    parts.push(autozooidTemplate.clone().rotateY(-p * 0.3).translate(px, py, pz));
  }
  autozooidTemplate.dispose();

  // Adjacent pulsing Xenia floret tufts beside leather cap
  const xeniaClusters = [
    { cx: 0.22, cz: 0.14 },
    { cx: -0.20, cz: 0.16 },
  ];
  for (const cl of xeniaClusters) {
    for (let t = 0; t < 5; t++) {
      const a = (t / 5) * Math.PI * 2;
      const sx = cl.cx + Math.cos(a) * 0.05;
      const sz = cl.cz + Math.sin(a) * 0.05;
      const top = new THREE.Vector3(sx, 0.08, sz);
      addBranchSegment(parts, new THREE.Vector3(sx, 0, sz), top, 0.012, 0.009, 5, cStalk, cPolypTip, 0, true);
      for (let rayIdx = 0; rayIdx < 8; rayIdx++) {
        const ra = (rayIdx / 8) * Math.PI * 2;
        const rDir = safeNormalize(new THREE.Vector3(Math.cos(ra) * 0.85, 0.52, Math.sin(ra) * 0.85), 0, 1, 0);
        const rCone = new THREE.ConeGeometry(0.004, 0.019, 3, 1, true);
        rCone.translate(0, 0.0095, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, rDir);
        rCone.applyMatrix4(new THREE.Matrix4().compose(top, q, new THREE.Vector3(1, 1, 1)));
        parts.push(prepareForMerge(rCone, cAutozooid));
        rCone.dispose();
      }
    }
  }

  return safeMerge(parts);
}

export function createCorals({
  applyUnderwaterMaterial,
  sampleSubstrate,
  placementRegistry = null,
  sampleFootprint = null,
  getSubstrateHeight = null,
  bommies = [],
}) {
  const group = new THREE.Group();
  group.name = 'reef-corals';

  const registry = placementRegistry || createPlacementRegistry();

  function evalFootprint(x, z, radius = 0.45) {
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
  const coralHeads = [];

  const hardCoralMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.04,
    }),
    { receiveCaustics: true, causticsStrength: 1.0, fluorescence: 0.35 }
  );
  const prevHardOnBeforeCompile =
    typeof hardCoralMat.onBeforeCompile === 'function'
      ? hardCoralMat.onBeforeCompile.bind(hardCoralMat)
      : null;
  const prevHardCacheKey =
    typeof hardCoralMat.customProgramCacheKey === 'function'
      ? hardCoralMat.customProgramCacheKey.bind(hardCoralMat)
      : null;

  hardCoralMat.customProgramCacheKey = () =>
    prevHardCacheKey ? `${prevHardCacheKey()}|hard_coral_calice_v1` : 'hard_coral_calice_v1';
  hardCoralMat.onBeforeCompile = (shader, renderer) => {
    if (prevHardOnBeforeCompile) {
      prevHardOnBeforeCompile(shader, renderer);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
#include <color_fragment>
{
  // Close-range corallite calice pore contrast + zooxanthellae skeleton translucency at grazing angles
  vec3 cP = vUwWorldPos * 72.0;
  vec3 cellA = abs(fract(cP) - 0.5);
  float poreA = smoothstep(0.42, 0.16, max(cellA.x, max(cellA.y, cellA.z)));
  float poreB = sin(vUwWorldPos.x * 115.0 + cos(vUwWorldPos.z * 98.0)) * cos(vUwWorldPos.y * 107.0);
  float calicePore = clamp(poreA * 0.65 + (0.5 + 0.5 * poreB) * 0.35, 0.0, 1.0);
  float microShade = mix(0.84, 1.11, calicePore);
  diffuseColor.rgb *= microShade;
  float tipUp = clamp(vUwWorldNormal.y * 0.5 + 0.5, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.04, 1.09), tipUp * 0.24);
}
`
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
#include <normal_fragment_maps>
{
  float hcDistFade = 1.0 - smoothstep(3.5, 11.0, length(vViewPosition));
  if (hcDistFade > 0.01) {
    vec3 hcPos = vUwWorldPos * 82.0;
    float hcCalice = sin(hcPos.x) * sin(hcPos.y + hcPos.z * 0.7) * cos(hcPos.z - hcPos.x * 0.6);
    float hcRough = sin(hcPos.x * 2.1 + 1.3) * cos(hcPos.y * 2.3 + hcPos.z * 1.9);
    float hcH = (hcCalice + 0.45 * hcRough) * hcDistFade;
    vec3 hcDpdx = dFdx(vViewPosition);
    vec3 hcDpdy = dFdy(vViewPosition);
    vec3 hcR1 = cross(hcDpdy, normal);
    vec3 hcR2 = cross(normal, hcDpdx);
    float hcDet = dot(hcDpdx, hcR1);
    if (abs(hcDet) > 1e-6) {
      vec3 hcSurfGrad = sign(hcDet) * (dFdx(hcH) * hcR1 + dFdy(hcH) * hcR2);
      normal = normalize(abs(hcDet) * normal - 0.0018 * hcSurfGrad);
    }
  }
}
`
      );
  };
  hardCoralMat.needsUpdate = true;

  const softCoralMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.56,
      metalness: 0.03,
    }),
    { receiveCaustics: true, causticsStrength: 0.92, fluorescence: 0.55 }
  );

  // Polyp material chained cleanly AFTER applyUnderwaterMaterial
  const polypUniforms = {
    uPolypTime: { value: 0 },
    uPolypFlow: { value: new THREE.Vector3(0, 0, DEFAULT_ENV_STATE.currentSpeed) },
  };
  const polypMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.52,
      metalness: 0.04,
    }),
    { receiveCaustics: true, causticsStrength: 1.0, fluorescence: 0.85 }
  );
  const prevPolypOnBeforeCompile =
    typeof polypMat.onBeforeCompile === 'function' ? polypMat.onBeforeCompile.bind(polypMat) : null;
  const prevPolypCacheKey =
    typeof polypMat.customProgramCacheKey === 'function' ? polypMat.customProgramCacheKey.bind(polypMat) : null;

  polypMat.customProgramCacheKey = () =>
    prevPolypCacheKey ? `${prevPolypCacheKey()}|polyp_sway_v1` : 'polyp_sway_v1';
  polypMat.onBeforeCompile = (shader, renderer) => {
    if (prevPolypOnBeforeCompile) {
      prevPolypOnBeforeCompile(shader, renderer);
    }
    shader.uniforms.uPolypTime = polypUniforms.uPolypTime;
    shader.uniforms.uPolypFlow = polypUniforms.uPolypFlow;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
uniform float uPolypTime;
uniform vec3 uPolypFlow;
`
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
#include <begin_vertex>
{
  float polyp_bend = pow(clamp(position.y, 0.0, 1.0), 2.0);
  float polyp_phase = 0.0;
  float polyp_flowMag = clamp(length(uPolypFlow), 0.0, 1.5);
  vec3 polyp_flowDir = polyp_flowMag > 1e-4 ? (uPolypFlow / polyp_flowMag) : vec3(0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
    polyp_phase = dot(instanceMatrix[3].xyz, vec3(7.31, 11.17, 5.83));
    vec3 polyp_localFlow = transpose(mat3(instanceMatrix)) * polyp_flowDir;
    float polyp_lfLen = length(polyp_localFlow);
    if (polyp_lfLen > 1e-4) {
      polyp_flowDir = polyp_localFlow / polyp_lfLen;
    }
  #endif
  float polyp_wave1 = sin(uPolypTime * 2.4 + polyp_phase + position.x * 3.1 + position.z * 2.7);
  float polyp_wave2 = cos(uPolypTime * 1.65 + polyp_phase * 1.37);
  vec3 polyp_clampedFlow = polyp_flowMag > 1e-4 ? (polyp_flowDir * polyp_flowMag) : vec3(0.0);
  float polyp_flutterWeight = smoothstep(0.02, 0.25, polyp_flowMag);
  transformed += (0.12 * polyp_clampedFlow + polyp_flowDir * (0.14 * polyp_wave1 * polyp_flutterWeight)) * polyp_bend;
  transformed.x += polyp_wave2 * 0.10 * polyp_bend;
  transformed.z += sin(uPolypTime * 1.9 + polyp_phase * 0.83) * 0.10 * polyp_bend;
}
`
      );
  };
  polypMat.needsUpdate = true;

  // Reef-scale static hard coral colonies across foreground pinnacle, arch, canyon walls & drop-off rim
  const staticPlacements = [
    // Acropora Table (0.98m-1.34m) & Staghorn (0.86m-1.12m) on wall/pinnacle/rim
    { speciesId: 'acropora', variant: 'table', x: -1.4, z: 5.0, radius: 0.98, seed: 1101 }, // foreground pinnacle showcase
    { speciesId: 'acropora', variant: 'staghorn', x: -2.2, z: 5.5, radius: 0.86, seed: 1102 },
    { speciesId: 'acropora', variant: 'table', x: -2.0, z: 1.9, radius: 1.12, seed: 1103 }, // atop reef arch
    { speciesId: 'acropora', variant: 'table', x: 4.1, z: -1.4, radius: 1.24, seed: 1104 },
    { speciesId: 'acropora', variant: 'staghorn', x: 5.2, z: -2.3, radius: 1.02, seed: 1105 },
    { speciesId: 'acropora', variant: 'table', x: -5.3, z: -2.2, radius: 1.20, seed: 1106 },
    { speciesId: 'acropora', variant: 'staghorn', x: -6.2, z: -3.2, radius: 0.98, seed: 1107 },
    { speciesId: 'acropora', variant: 'table', x: 5.1, z: 4.1, radius: 1.04, seed: 1108 },
    { speciesId: 'acropora', variant: 'staghorn', x: -6.3, z: 3.4, radius: 0.92, seed: 1109 },
    { speciesId: 'acropora', variant: 'table', x: -2.0, z: -6.0, radius: 1.26, seed: 1110 },
    { speciesId: 'acropora', variant: 'table', x: -4.4, z: -10.0, radius: 1.34, seed: 1111 }, // northern drop-off rim
    { speciesId: 'acropora', variant: 'staghorn', x: 4.1, z: -10.5, radius: 1.12, seed: 1112 },

    // Stylophora pistillata (0.58m-0.76m on wall/pinnacle/rim)
    { speciesId: 'stylophora', morph: 'pink', x: -1.9, z: 4.6, radius: 0.58, seed: 1201 },
    { speciesId: 'stylophora', morph: 'gold', x: 5.9, z: 4.8, radius: 0.62, seed: 1202 },
    { speciesId: 'stylophora', morph: 'violet', x: -3.3, z: 1.7, radius: 0.66, seed: 1203 },
    { speciesId: 'stylophora', morph: 'pink', x: 3.4, z: -2.3, radius: 0.71, seed: 1204 },
    { speciesId: 'stylophora', morph: 'gold', x: -4.9, z: -1.3, radius: 0.66, seed: 1205 },
    { speciesId: 'stylophora', morph: 'pink', x: -7.1, z: 4.3, radius: 0.62, seed: 1206 },
    { speciesId: 'stylophora', morph: 'violet', x: 4.5, z: 1.3, radius: 0.58, seed: 1207 },
    { speciesId: 'stylophora', morph: 'gold', x: -2.9, z: -6.8, radius: 0.71, seed: 1208 },
    { speciesId: 'stylophora', morph: 'pink', x: -5.4, z: -10.8, radius: 0.76, seed: 1209 },
    { speciesId: 'stylophora', morph: 'gold', x: 3.6, z: -11.3, radius: 0.66, seed: 1210 },

    // Millepora dichotoma Fire Coral (0.64m-0.84m on wall/pinnacle/rim)
    { speciesId: 'millepora', x: -0.9, z: 5.6, radius: 0.64, seed: 1301 },
    { speciesId: 'millepora', x: -0.7, z: 1.7, radius: 0.70, seed: 1302 },
    { speciesId: 'millepora', x: 5.4, z: -1.1, radius: 0.78, seed: 1303 },
    { speciesId: 'millepora', x: -6.3, z: -1.8, radius: 0.74, seed: 1304 },
    { speciesId: 'millepora', x: -1.3, z: -6.7, radius: 0.78, seed: 1305 },
    { speciesId: 'millepora', x: 4.9, z: -10.8, radius: 0.84, seed: 1306 },

    // Platygyra Brain Coral (0.64m-0.86m on wall/pinnacle/rim)
    { speciesId: 'platygyra', x: -2.3, z: 4.9, radius: 0.64, seed: 1401 },
    { speciesId: 'platygyra', x: 4.9, z: 3.6, radius: 0.74, seed: 1402 },
    { speciesId: 'platygyra', x: 4.8, z: -2.8, radius: 0.83, seed: 1403 },
    { speciesId: 'platygyra', x: -5.2, z: -3.2, radius: 0.80, seed: 1404 },
    { speciesId: 'platygyra', x: -6.2, z: 4.5, radius: 0.70, seed: 1405 },
    { speciesId: 'platygyra', x: 3.4, z: -9.8, radius: 0.86, seed: 1406 },

    // Porites Massive Boulder Coral (0.80m-1.08m on wall/pinnacle/rim)
    { speciesId: 'porites', morph: 'ochre', x: 6.2, z: 5.1, radius: 0.86, seed: 1501 },
    { speciesId: 'porites', morph: 'lilac', x: -7.5, z: 3.2, radius: 0.98, seed: 1502 },
    { speciesId: 'porites', morph: 'tan', x: 3.75, z: 0.25, radius: 0.72, seed: 1503 },
    { speciesId: 'porites', morph: 'ochre', x: -5.85, z: 3.85, radius: 0.76, seed: 1504, isCleaningStation: true, stationId: 3 },
    { speciesId: 'porites', morph: 'lilac', x: -5.8, z: -11.4, radius: 1.08, seed: 1505 },
    { speciesId: 'porites', morph: 'tan', x: 5.4, z: -11.8, radius: 1.02, seed: 1506 },

    // Reef-floor corridor colonies (seed 1601-1615, cleared >=1.35m from cleaning stations)
    { speciesId: 'stylophora', morph: 'pink', x: 0.95, z: 6.8, radius: 0.58, seed: 1601 },
    { speciesId: 'acropora', variant: 'staghorn', x: 2.10, z: 6.05, radius: 0.84, seed: 1602 },
    { speciesId: 'platygyra', x: 0.55, z: 3.8, radius: 0.62, seed: 1603 },
    { speciesId: 'stylophora', morph: 'gold', x: -4.85, z: 6.55, radius: 0.60, seed: 1604 },
    { speciesId: 'acropora', variant: 'staghorn', x: -6.60, z: 1.0, radius: 0.82, seed: 1605 },
    { speciesId: 'stylophora', morph: 'violet', x: 1.95, z: 2.85, radius: 0.58, seed: 1606 },
    { speciesId: 'acropora', variant: 'table', x: 0.65, z: -0.15, radius: 0.96, seed: 1607 },
    { speciesId: 'stylophora', morph: 'pink', x: -1.85, z: -1.4, radius: 0.64, seed: 1608 },
    { speciesId: 'porites', morph: 'ochre', x: 2.85, z: -0.65, radius: 0.74, seed: 1609, isCleaningStation: true, stationId: 1 },
    { speciesId: 'millepora', x: -2.15, z: -2.95, radius: 0.62, seed: 1610 },
    { speciesId: 'acropora', variant: 'staghorn', x: 1.10, z: -5.8, radius: 0.88, seed: 1611 },
    { speciesId: 'platygyra', x: -2.15, z: -7.85, radius: 0.66, seed: 1612, isCleaningStation: true, stationId: 4 },

    // Dedicated Elevated Cleaning Station coral heads + complex branching pinnacle accents
    { speciesId: 'porites', morph: 'ochre', x: 4.15, z: 4.15, radius: 0.74, seed: 1613, isCleaningStation: true, stationId: 0 },
    { speciesId: 'stylophora', morph: 'pink', x: 3.15, z: 5.85, radius: 0.54, seed: 1614 },
    { speciesId: 'platygyra', x: -3.55, z: -3.15, radius: 0.70, seed: 1615, isCleaningStation: true, stationId: 2 },
    { speciesId: 'stylophora', morph: 'pink', x: 3.55, z: 4.85, radius: 0.44, seed: 1616 },
    { speciesId: 'stylophora', morph: 'pink', x: 2.25, z: 0.05, radius: 0.42, seed: 1617 },
    { speciesId: 'stylophora', morph: 'pink', x: -2.85, z: -2.45, radius: 0.42, seed: 1618 },
  ];

  // Sort cleaning-station corals first so prime well-lit perches are allocated first
  staticPlacements.sort((a, b) => {
    const aCS = a.isCleaningStation ? 0 : 1;
    const bCS = b.isCleaningStation ? 0 : 1;
    if (aCS !== bCS) return aCS - bCS;
    if (a.isCleaningStation && b.isCleaningStation) {
      return (a.stationId ?? 99) - (b.stationId ?? 99);
    }
    return 0;
  });

  const HARD_CORAL_IDS = ['acropora', 'stylophora', 'millepora', 'platygyra', 'porites'];
  const hardMeshesBySpecies = Object.fromEntries(HARD_CORAL_IDS.map((id) => [id, []]));
  const hardHeadsBySpecies = Object.fromEntries(HARD_CORAL_IDS.map((id) => [id, []]));
  const templatesBySpecies = Object.fromEntries(HARD_CORAL_IDS.map((id) => [id, []]));
  const colonyPolypEntriesBySpecies = Object.fromEntries(HARD_CORAL_IDS.map((id) => [id, []]));
  const occupiedSpots = [];
  const resolvedStationCoords = CLEANING_STATION_COORDS.map((c) => [...c]);

  function findValidatedCoralSpot(origX, origZ, clearR, footprintR, opts = {}) {
    const archClear = opts.archClear ?? 1.0;
    const maxYLimit = opts.maxBaseY ?? (MAX_STATIC_Y - 0.35);
    const initialHit = sampleSubstrate(origX, origZ);
    const preferRock = Boolean(opts.preferRock ?? initialHit.onRock);

    let bestFallback = null;
    for (let step = 0; step <= 140; step++) {
      let cx = origX;
      let cz = origZ;
      if (step > 0) {
        const ring = 1 + Math.floor((step - 1) / 8);
        const sr = 0.24 * ring;
        const ang = step * 2.399963229728653;
        cx = origX + Math.cos(ang) * sr;
        cz = origZ + Math.sin(ang) * sr;
      }

      if (Math.hypot(cx - REEF_ARCH_CENTER[0], cz - REEF_ARCH_CENTER[1]) < archClear) continue;
      if (!registry.isFree(cx, cz, clearR, 'canopy')) continue;

      const fp = evalFootprint(cx, cz, footprintR);
      const hit = step === 0 ? initialHit : sampleSubstrate(cx, cz);
      if (hit.y < -4.2) continue;
      const ny = hit.normal ? hit.normal.y : 1.0;
      if (ny < 0.72) continue;
      if (bommies?.rockCollider?.isInsideRock(cx, hit.y + 0.14, cz, 0.03)) continue;

      const baseY = Math.max(hit.y - 0.05, Math.min(hit.y - 0.02, fp.minY + 0.02));
      if (baseY > maxYLimit) continue;

      const candidate = { x: cx, z: cz, hit, fp, baseY };
      if (!bestFallback || (fp.slope < bestFallback.fp.slope && (!preferRock || hit.onRock || !bestFallback.hit.onRock))) {
        bestFallback = candidate;
      }

      if (!fp.valid) continue;
      if (preferRock && step < 40 && !hit.onRock) continue;
      return candidate;
    }

    return bestFallback || {
      x: origX,
      z: origZ,
      hit: initialHit,
      fp: evalFootprint(origX, origZ, footprintR),
      baseY: initialHit.y - 0.04,
    };
  }

  for (const p of staticPlacements) {
    const rng = createRng(p.seed);
    const clearR = Math.max(0.24, p.radius * 0.58);
    const spot = findValidatedCoralSpot(p.x, p.z, clearR, p.radius * 0.55, {
      archClear: p.seed === 1103 ? 0.0 : 1.0,
      preferRock: Boolean(p.isCleaningStation || p.seed < 1600),
      maxBaseY: p.isCleaningStation ? MAX_STATIC_Y - 0.92 : MAX_STATIC_Y - 0.35,
    });
    registry.add(spot.x, spot.z, clearR, 'canopy');
    if (p.isCleaningStation && Number.isInteger(p.stationId) && p.stationId >= 0 && p.stationId < resolvedStationCoords.length) {
      resolvedStationCoords[p.stationId] = [spot.x, spot.z];
    }

    const hit = spot.hit;
    const baseY = spot.baseY;

    let built;
    if (p.speciesId === 'acropora') {
      built =
        p.variant === 'table'
          ? buildFractalAcroporaTable(p.radius, rng)
          : buildRecursiveStaghorn(p.radius, rng);
    } else if (p.speciesId === 'stylophora') {
      built = buildFractalStylophora(p.radius, p.morph, rng);
    } else if (p.speciesId === 'millepora') {
      built = buildMilleporaFan(p.radius, rng);
    } else if (p.speciesId === 'platygyra') {
      built = buildPlatygyraDome(p.radius, rng);
    } else {
      built = buildPoritesDome(p.radius, p.morph, rng);
    }

    const { geom, polyps } = built;
    if (!geom.boundingBox) geom.computeBoundingBox();
    const rawPeakY = geom.boundingBox ? geom.boundingBox.max.y : p.radius * 0.85;
    const maxLocalY = MAX_STATIC_Y - baseY;
    clampPolypsTopY(polyps, rawPeakY, maxLocalY);
    clampGeometryTopY(geom, maxLocalY);
    if (!geom.boundingBox) geom.computeBoundingBox();

    const actualTopLocalY = geom.boundingBox ? geom.boundingBox.max.y : p.radius * 0.85;
    const rotY = rng() * Math.PI * 2;
    const mesh = new THREE.Mesh(geom, hardCoralMat);
    mesh.position.set(spot.x, baseY, spot.z);
    mesh.rotation.y = rotY;
    enableShadows(mesh, true, true);
    mesh.userData.speciesId = p.speciesId;
    mesh.name = `${p.speciesId}-${p.seed}`;

    group.add(mesh);
    pickableMeshes.push(mesh);

    const isBranching = p.speciesId === 'acropora' || p.speciesId === 'stylophora' || p.speciesId === 'millepora';
    const topWorldY = Math.min(MAX_STATIC_Y - 0.02, baseY + actualTopLocalY);
    const crownCenterY = Math.min(MAX_STATIC_Y - 0.12, baseY + actualTopLocalY * 0.58);
    const head = {
      position: new THREE.Vector3(spot.x, crownCenterY, spot.z),
      radius: p.radius,
      speciesId: p.speciesId,
      isBranching,
      isSoftCoral: false,
      baseY,
      topWorldY,
      crownCenterY,
      onReefFloor: !hit.onRock,
      isCleaningStation: Boolean(p.isCleaningStation),
      stationId: p.stationId ?? null,
      active: true,
    };
    coralHeads.push(head);
    hardMeshesBySpecies[p.speciesId].push(mesh);
    hardHeadsBySpecies[p.speciesId].push(head);
    templatesBySpecies[p.speciesId].push({
      geom,
      polyps,
      radius: p.radius,
      isBranching,
      topY: actualTopLocalY,
    });
    colonyPolypEntriesBySpecies[p.speciesId].push({
      mesh,
      scale: 1.0,
      polyps,
    });
    occupiedSpots.push({ x: spot.x, z: spot.z });
  }

  function isSpotClear(x, z, minSep = 1.05, clearR = 0.45) {
    // Keep clear of reef arch swim-through center (-2.0, 1.8)
    if (Math.hypot(x - REEF_ARCH_CENTER[0], z - REEF_ARCH_CENTER[1]) < 1.20) return false;
    // Reserve flat rocky terrace (-1.85, 6.85) for the foreground showcase anemone
    if (Math.hypot(x + 1.85, z - 6.85) < 0.85) return false;
    // Keep clear of all 5 cleaning stations (>= 1.35m)
    for (let i = 0; i < resolvedStationCoords.length; i++) {
      if (Math.hypot(x - resolvedStationCoords[i][0], z - resolvedStationCoords[i][1]) < 1.35) {
        return false;
      }
    }
    if (!registry.isFree(x, z, clearR, 'canopy')) return false;
    for (let i = 0; i < occupiedSpots.length; i++) {
      const s = occupiedSpots[i];
      if (Math.hypot(x - s.x, z - s.z) < minSep) return false;
    }
    return true;
  }

  function findBonusHardSpot(template, rng) {
    const scale = 0.88 + rng() * 0.20;
    const rotY = rng() * Math.PI * 2;
    const topHeight = template.topY * scale;
    const scaledRadius = template.radius * scale;
    const clearR = Math.max(0.28, scaledRadius * 0.60);

    for (let attempt = 0; attempt < 600; attempt++) {
      const preferRock = attempt < 360;
      const r = 1.1 + Math.sqrt(rng()) * 11.8;
      const a = rng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 1.0;

      if (!isSpotClear(x, z, 1.05, clearR)) continue;
      const fp = evalFootprint(x, z, scaledRadius * 0.55);
      if (!fp.valid) continue;

      const hit = sampleSubstrate(x, z);
      if (preferRock && !hit.onRock) continue;
      if (hit.y < -3.6) continue;
      if ((hit.normal ? hit.normal.y : 1.0) < 0.76) continue;
      if (bommies?.rockCollider?.isInsideRock(x, hit.y + 0.14, z, 0.04)) continue;
      const baseY = Math.max(hit.y - 0.05, Math.min(hit.y - 0.02, fp.minY + 0.02));
      if (baseY + topHeight > MAX_STATIC_Y - 0.02) continue;

      registry.add(x, z, clearR, 'canopy');
      occupiedSpots.push({ x, z });
      return { x, z, baseY, hit, scale, rotY };
    }
    return null;
  }

  // Pre-allocate bonus hard coral colonies up to maxCount by reusing existing BufferGeometry & polyp templates
  const bonusRng = createRng(1901);
  for (const speciesId of HARD_CORAL_IDS) {
    const spec = SPECIES_POPULATION_SPEC[speciesId];
    const templates = templatesBySpecies[speciesId];
    const existingCount = hardMeshesBySpecies[speciesId].length;

    for (let idx = existingCount; idx < spec.maxCount; idx++) {
      const template = templates[(idx - existingCount) % templates.length];
      const spot = findBonusHardSpot(template, bonusRng);
      if (!spot) break;

      const mesh = new THREE.Mesh(template.geom, hardCoralMat);
      mesh.position.set(spot.x, spot.baseY, spot.z);
      mesh.rotation.y = spot.rotY;
      mesh.scale.setScalar(spot.scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.userData.speciesId = speciesId;
      mesh.name = `${speciesId}-bonus-${idx}`;

      group.add(mesh);
      pickableMeshes.push(mesh);

      const scaledRadius = template.radius * spot.scale;
      const scaledTop = template.topY * spot.scale;
      const topWorldY = Math.min(MAX_STATIC_Y - 0.02, spot.baseY + scaledTop);
      const crownCenterY = Math.min(MAX_STATIC_Y - 0.12, spot.baseY + scaledTop * 0.58);
      const head = {
        position: new THREE.Vector3(spot.x, crownCenterY, spot.z),
        radius: scaledRadius,
        speciesId,
        isBranching: template.isBranching,
        isSoftCoral: false,
        baseY: spot.baseY,
        topWorldY,
        crownCenterY,
        onReefFloor: !spot.hit.onRock,
        isCleaningStation: false,
        stationId: null,
        active: false,
      };
      coralHeads.push(head);
      hardMeshesBySpecies[speciesId].push(mesh);
      hardHeadsBySpecies[speciesId].push(head);
      colonyPolypEntriesBySpecies[speciesId].push({
        mesh,
        scale: spot.scale,
        polyps: template.polyps,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GPU-Instanced 3D Tentaculate Polyps across ALL 5 Hard Coral Species
  // ---------------------------------------------------------------------------
  const branchingPolypGeom = buildBranchingPolypGeometry();
  const dactylozoidPolypGeom = buildDactylozoidTuftGeometry();
  const massivePolypGeom = buildMassivePolypGeometry();

  const polypGeomBySpecies = {
    acropora: branchingPolypGeom,
    stylophora: branchingPolypGeom,
    millepora: dactylozoidPolypGeom,
    platygyra: massivePolypGeom,
    porites: massivePolypGeom,
  };

  const polypBaseSizeBySpecies = {
    acropora: 0.021,
    stylophora: 0.020,
    millepora: 0.022,
    platygyra: 0.022,
    porites: 0.019,
  };

  const polypMeshesBySpecies = {};
  const polypEndCountByColony = Object.fromEntries(HARD_CORAL_IDS.map((id) => [id, []]));

  const tmpColonyMat = new THREE.Matrix4();
  const tmpPolypMat = new THREE.Matrix4();
  const tmpPolypPos = new THREE.Vector3();
  const tmpPolypNorm = new THREE.Vector3();
  const tmpPolypQuat = new THREE.Quaternion();
  const tmpPolypScale = new THREE.Vector3();
  const tmpSpinQuat = new THREE.Quaternion();

  for (const speciesId of HARD_CORAL_IDS) {
    const entries = colonyPolypEntriesBySpecies[speciesId];
    let totalCount = 0;
    for (let e = 0; e < entries.length; e++) {
      totalCount += entries[e].polyps.length;
    }

    const polypMesh = new THREE.InstancedMesh(
      polypGeomBySpecies[speciesId],
      polypMat,
      Math.max(1, totalCount)
    );
    polypMesh.name = `${speciesId}-polyps`;
    configureDynamicMesh(polypMesh, speciesId);

    const baseSize = polypBaseSizeBySpecies[speciesId];
    let cursor = 0;
    for (let c = 0; c < entries.length; c++) {
      const entry = entries[c];
      entry.mesh.updateMatrix();
      tmpColonyMat.copy(entry.mesh.matrix);
      const colonyQuat = entry.mesh.quaternion;
      const polyps = entry.polyps;

      for (let p = 0; p < polyps.length; p++) {
        const pl = polyps[p];
        tmpPolypPos.copy(pl.pos).applyMatrix4(tmpColonyMat);
        tmpPolypPos.y = Math.min(MAX_STATIC_Y - 0.045, tmpPolypPos.y);

        tmpPolypNorm.copy(pl.normal).applyQuaternion(colonyQuat);
        safeNormalize(tmpPolypNorm, 0, 1, 0);

        tmpPolypQuat.setFromUnitVectors(WORLD_UP, tmpPolypNorm);
        tmpSpinQuat.setFromAxisAngle(WORLD_UP, (p * 2.39996 + c * 1.1) % (Math.PI * 2));
        tmpPolypQuat.multiply(tmpSpinQuat);

        const s = baseSize * pl.scale * Math.pow(entry.scale, 0.7);
        tmpPolypScale.set(s, s, s);
        tmpPolypMat.compose(tmpPolypPos, tmpPolypQuat, tmpPolypScale);

        polypMesh.setMatrixAt(cursor, tmpPolypMat);
        polypMesh.setColorAt(cursor, pl.color);
        cursor++;
      }
      polypEndCountByColony[speciesId].push(cursor);
    }

    polypMesh.instanceMatrix.needsUpdate = true;
    if (polypMesh.instanceColor) polypMesh.instanceColor.needsUpdate = true;
    enableShadows(polypMesh, false, true);
    group.add(polypMesh);
    pickableMeshes.push(polypMesh);
    polypMeshesBySpecies[speciesId] = polypMesh;
  }

  // ---------------------------------------------------------------------------
  // Soft Corals: Dendronephthya (6 -> 12 swaying colonies) & Sarcophyton (6 -> 12 colonies)
  // ---------------------------------------------------------------------------
  const dendroSpots = [
    { x: -3.2, z: 2.2, color: '#ff2b5e', scale: 1.44, tilt: 0.42, rotY: 0.5 },
    { x: 3.1, z: 1.2, color: '#ff4d94', scale: 1.56, tilt: 0.48, rotY: 2.2 },
    { x: -0.65, z: 2.35, color: '#ff5d2e', scale: 1.38, tilt: 0.36, rotY: -1.1 },
    { x: 4.8, z: -0.6, color: '#e6296f', scale: 1.62, tilt: 0.44, rotY: 1.6 },
    { x: -4.4, z: -2.9, color: '#ff3b78', scale: 1.52, tilt: 0.40, rotY: 0.2 },
    { x: -4.0, z: -9.5, color: '#ff5533', scale: 1.68, tilt: 0.45, rotY: 2.9 },
  ];
  for (let i = 0; i < dendroSpots.length; i++) {
    const s = dendroSpots[i];
    const clearR = 0.32 * s.scale;
    const spot = findValidatedCoralSpot(s.x, s.z, clearR, 0.26 * s.scale, {
      archClear: 1.0,
      maxBaseY: MAX_STATIC_Y - 0.68,
    });
    s.x = spot.x;
    s.z = spot.z;
    s._hit = spot.hit;
    s._fp = spot.fp;
    registry.add(s.x, s.z, clearR, 'canopy');
    occupiedSpots.push({ x: s.x, z: s.z });
  }

  const dendroBonusPalette = ['#ff2b5e', '#ff4d94', '#ff5d2e', '#e6296f', '#ff3b78', '#ff5533'];
  const dendroMax = SPECIES_POPULATION_SPEC.dendronephthya.maxCount;
  for (let i = dendroSpots.length; i < dendroMax; i++) {
    let placed = null;
    const scale = 1.38 + bonusRng() * 0.30;
    const clearR = 0.32 * scale;
    for (let attempt = 0; attempt < 450; attempt++) {
      const r = 1.4 + Math.sqrt(bonusRng()) * 10.5;
      const a = bonusRng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 1.0;
      if (!isSpotClear(x, z, 1.05, clearR)) continue;
      const fp = evalFootprint(x, z, 0.26 * scale);
      if (!fp.valid) continue;
      const hit = sampleSubstrate(x, z);
      if (attempt < 280 && !hit.onRock) continue;
      if ((hit.normal ? hit.normal.y : 1.0) < 0.74) continue;
      if (bommies?.rockCollider?.isInsideRock(x, hit.y + 0.14, z, 0.04)) continue;
      if (hit.y < -3.6 || hit.y - 0.03 > MAX_STATIC_Y - 0.68) continue;
      registry.add(x, z, clearR, 'canopy');
      occupiedSpots.push({ x, z });
      placed = {
        x,
        z,
        _hit: hit,
        _fp: fp,
        color: dendroBonusPalette[(i - 6) % dendroBonusPalette.length],
        scale,
        tilt: 0.36 + bonusRng() * 0.14,
        rotY: (bonusRng() - 0.5) * Math.PI * 2,
      };
      break;
    }
    if (placed) dendroSpots.push(placed);
  }

  const dendroGeom = buildDendronephthyaPrototype();
  const dendroMesh = new THREE.InstancedMesh(dendroGeom, softCoralMat, dendroMax);
  dendroMesh.name = 'dendronephthya-colonies';
  enableShadows(dendroMesh, true, true);
  configureDynamicMesh(dendroMesh, 'dendronephthya');

  const dendroState = [];
  const dendroHeads = [];
  const dummy = new THREE.Object3D();

  for (let i = 0; i < dendroSpots.length; i++) {
    const s = dendroSpots[i];
    const sub = s._hit || sampleSubstrate(s.x, s.z);
    const fp = s._fp || evalFootprint(s.x, s.z, 0.26 * s.scale);
    const baseY = Math.min(MAX_STATIC_Y - 0.68, Math.max(sub.y - 0.05, Math.min(sub.y - 0.02, fp.minY + 0.02)));
    const pos = new THREE.Vector3(s.x, baseY, s.z);
    dendroMesh.setColorAt(i, new THREE.Color(s.color));
    dendroState.push({
      pos,
      scale: s.scale,
      baseTilt: s.tilt,
      rotY: s.rotY,
      phase: i * 1.17,
    });
    dummy.position.copy(pos);
    dummy.rotation.set(s.tilt, s.rotY, 0);
    dummy.scale.setScalar(s.scale);
    dummy.updateMatrix();
    dendroMesh.setMatrixAt(i, dummy.matrix);

    const topWorldY = Math.min(MAX_STATIC_Y - 0.04, pos.y + 0.42 * s.scale);
    const crownCenterY = Math.min(MAX_STATIC_Y - 0.12, pos.y + 0.42 * s.scale * 0.58);
    const head = {
      position: new THREE.Vector3(s.x, crownCenterY, s.z),
      radius: 0.34 * s.scale,
      speciesId: 'dendronephthya',
      isBranching: false,
      isSoftCoral: true,
      baseY: pos.y,
      topWorldY,
      crownCenterY,
      isCleaningStation: false,
      stationId: null,
      active: i < SPECIES_POPULATION_SPEC.dendronephthya.defaultCount,
    };
    dendroHeads.push(head);
    coralHeads.push(head);
  }
  if (dendroMesh.instanceColor) dendroMesh.instanceColor.needsUpdate = true;
  dendroMesh.instanceMatrix.needsUpdate = true;
  group.add(dendroMesh);
  pickableMeshes.push(dendroMesh);

  const sarcoSpots = [
    { x: -1.2, z: 4.5, scale: 1.35, rotY: 0.4 },
    { x: 5.4, z: 3.1, scale: 1.50, rotY: 1.9 },
    { x: -6.6, z: 2.8, scale: 1.42, rotY: 2.7 },
    { x: 3.8, z: -2.4, scale: 1.65, rotY: 0.9 },
    { x: -5.6, z: -1.6, scale: 1.54, rotY: -0.7 },
    { x: -1.7, z: -5.5, scale: 1.58, rotY: 1.3 },
  ];
  for (let i = 0; i < sarcoSpots.length; i++) {
    const s = sarcoSpots[i];
    const clearR = 0.34 * s.scale;
    const spot = findValidatedCoralSpot(s.x, s.z, clearR, 0.28 * s.scale, {
      archClear: 1.0,
      maxBaseY: MAX_STATIC_Y - 0.48,
    });
    s.x = spot.x;
    s.z = spot.z;
    s._hit = spot.hit;
    s._fp = spot.fp;
    registry.add(s.x, s.z, clearR, 'canopy');
    occupiedSpots.push({ x: s.x, z: s.z });
  }

  const sarcoMax = SPECIES_POPULATION_SPEC.sarcophyton.maxCount;
  for (let i = sarcoSpots.length; i < sarcoMax; i++) {
    let placed = null;
    const scale = 1.35 + bonusRng() * 0.30;
    const clearR = 0.34 * scale;
    for (let attempt = 0; attempt < 450; attempt++) {
      const r = 1.4 + Math.sqrt(bonusRng()) * 10.5;
      const a = bonusRng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 1.0;
      if (!isSpotClear(x, z, 1.05, clearR)) continue;
      const fp = evalFootprint(x, z, 0.28 * scale);
      if (!fp.valid) continue;
      const hit = sampleSubstrate(x, z);
      if (attempt < 280 && !hit.onRock) continue;
      if ((hit.normal ? hit.normal.y : 1.0) < 0.74) continue;
      if (bommies?.rockCollider?.isInsideRock(x, hit.y + 0.14, z, 0.04)) continue;
      if (hit.y < -3.6 || hit.y - 0.02 > MAX_STATIC_Y - 0.48) continue;
      registry.add(x, z, clearR, 'canopy');
      occupiedSpots.push({ x, z });
      placed = {
        x,
        z,
        _hit: hit,
        _fp: fp,
        scale,
        rotY: (bonusRng() - 0.5) * Math.PI * 2,
      };
      break;
    }
    if (placed) sarcoSpots.push(placed);
  }

  const sarcoGeom = buildSarcophytonPrototype();
  const sarcoMesh = new THREE.InstancedMesh(sarcoGeom, softCoralMat, sarcoMax);
  sarcoMesh.name = 'sarcophyton-colonies';
  enableShadows(sarcoMesh, true, true);
  configureDynamicMesh(sarcoMesh, 'sarcophyton');

  const sarcoState = [];
  const sarcoHeads = [];
  for (let i = 0; i < sarcoSpots.length; i++) {
    const s = sarcoSpots[i];
    const sub = s._hit || sampleSubstrate(s.x, s.z);
    const fp = s._fp || evalFootprint(s.x, s.z, 0.28 * s.scale);
    const baseY = Math.min(MAX_STATIC_Y - 0.48, Math.max(sub.y - 0.05, Math.min(sub.y - 0.02, fp.minY + 0.02)));
    const pos = new THREE.Vector3(s.x, baseY, s.z);
    sarcoState.push({
      pos,
      scale: s.scale,
      rotY: s.rotY,
      phase: i * 1.43,
    });
    dummy.position.copy(pos);
    dummy.rotation.set(0, s.rotY, 0);
    dummy.scale.setScalar(s.scale);
    dummy.updateMatrix();
    sarcoMesh.setMatrixAt(i, dummy.matrix);

    const topWorldY = Math.min(MAX_STATIC_Y - 0.04, pos.y + 0.28 * s.scale);
    const crownCenterY = Math.min(MAX_STATIC_Y - 0.12, pos.y + 0.28 * s.scale * 0.58);
    const head = {
      position: new THREE.Vector3(s.x, crownCenterY, s.z),
      radius: 0.38 * s.scale,
      speciesId: 'sarcophyton',
      isBranching: false,
      isSoftCoral: true,
      baseY: pos.y,
      topWorldY,
      crownCenterY,
      isCleaningStation: false,
      stationId: null,
      active: i < SPECIES_POPULATION_SPEC.sarcophyton.defaultCount,
    };
    sarcoHeads.push(head);
    coralHeads.push(head);
  }
  sarcoMesh.instanceMatrix.needsUpdate = true;
  group.add(sarcoMesh);
  pickableMeshes.push(sarcoMesh);

  const leanEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  const localEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  const qLean = new THREE.Quaternion();
  const qLocal = new THREE.Quaternion();
  const _flowVec = new THREE.Vector3();
  const _polypFlowAcc = new THREE.Vector3();
  const _waveVel = new THREE.Vector3();
  let smoothedPolypFlowX = 0;
  let smoothedPolypFlowZ = DEFAULT_ENV_STATE.currentSpeed;

  const activeCounts = {
    acropora: SPECIES_POPULATION_SPEC.acropora.defaultCount,
    stylophora: SPECIES_POPULATION_SPEC.stylophora.defaultCount,
    millepora: SPECIES_POPULATION_SPEC.millepora.defaultCount,
    platygyra: SPECIES_POPULATION_SPEC.platygyra.defaultCount,
    porites: SPECIES_POPULATION_SPEC.porites.defaultCount,
    dendronephthya: SPECIES_POPULATION_SPEC.dendronephthya.defaultCount,
    sarcophyton: SPECIES_POPULATION_SPEC.sarcophyton.defaultCount,
  };

  function applySpeciesCounts(speciesCounts) {
    for (const id of HARD_CORAL_IDS) {
      const spec = SPECIES_POPULATION_SPEC[id];
      const meshes = hardMeshesBySpecies[id];
      const heads = hardHeadsBySpecies[id];
      const n = Math.min(meshes.length, sanitizeSpeciesCount(id, speciesCounts?.[id] ?? spec.defaultCount));
      activeCounts[id] = n;
      for (let idx = 0; idx < meshes.length; idx++) {
        const isActive = idx < n;
        meshes[idx].visible = isActive;
        heads[idx].active = isActive;
      }

      const polypMesh = polypMeshesBySpecies[id];
      const endCounts = polypEndCountByColony[id];
      if (polypMesh) {
        const pCount = n > 0 && endCounts.length > 0 ? endCounts[Math.min(n, endCounts.length) - 1] : 0;
        polypMesh.count = pCount;
        polypMesh.visible = pCount > 0;
      }
    }

    const nDendro = Math.min(
      dendroState.length,
      sanitizeSpeciesCount(
        'dendronephthya',
        speciesCounts?.dendronephthya ?? SPECIES_POPULATION_SPEC.dendronephthya.defaultCount
      )
    );
    activeCounts.dendronephthya = nDendro;
    dendroMesh.count = nDendro;
    dendroMesh.visible = nDendro > 0;
    for (let i = 0; i < dendroHeads.length; i++) {
      dendroHeads[i].active = i < nDendro;
    }

    const nSarco = Math.min(
      sarcoState.length,
      sanitizeSpeciesCount(
        'sarcophyton',
        speciesCounts?.sarcophyton ?? SPECIES_POPULATION_SPEC.sarcophyton.defaultCount
      )
    );
    activeCounts.sarcophyton = nSarco;
    sarcoMesh.count = nSarco;
    sarcoMesh.visible = nSarco > 0;
    for (let i = 0; i < sarcoHeads.length; i++) {
      sarcoHeads[i].active = i < nSarco;
    }
  }

  function update(elapsedTime, _deltaTime, envState) {
    const env = envState || DEFAULT_ENV_STATE;
    applySpeciesCounts(env.speciesCounts);

    const alpha = Number.isFinite(_deltaTime) && _deltaTime > 0 ? Math.min(1, _deltaTime * 4.0) : 1.0;

    // Mean hard-coral canopy flow via unified flowField + Airy wave orbitals
    _polypFlowAcc.set(0, 0, 0);
    let polypColonyCount = 0;
    for (const id of HARD_CORAL_IDS) {
      const heads = hardHeadsBySpecies[id];
      for (let i = 0; i < heads.length; i++) {
        const head = heads[i];
        if (head.active === false) continue;
        sampleFlowField(
          head.position.x,
          head.crownCenterY ?? head.position.y,
          head.position.z,
          elapsedTime,
          env,
          bommies,
          _flowVec
        );
        _polypFlowAcc.add(_flowVec);
        polypColonyCount++;
      }
    }
    if (polypColonyCount > 0) {
      _polypFlowAcc.multiplyScalar(1 / polypColonyCount);
    } else {
      sampleFlowField(0, 0.5, 0, elapsedTime, env, bommies, _polypFlowAcc);
    }
    smoothedPolypFlowX = THREE.MathUtils.lerp(smoothedPolypFlowX, _polypFlowAcc.x, alpha);
    smoothedPolypFlowZ = THREE.MathUtils.lerp(smoothedPolypFlowZ, _polypFlowAcc.z, alpha);

    polypUniforms.uPolypTime.value = elapsedTime;
    polypUniforms.uPolypFlow.value.set(smoothedPolypFlowX, 0, smoothedPolypFlowZ);

    const nDendro = activeCounts.dendronephthya;
    if (nDendro > 0) {
      for (let i = 0; i < nDendro; i++) {
        const d = dendroState[i];
        sampleFlowField(d.pos.x, d.pos.y + 0.25 * d.scale, d.pos.z, elapsedTime, env, bommies, _flowVec);
        sampleWaveOrbital(d.pos.x, d.pos.y + 0.25 * d.scale, d.pos.z, elapsedTime, env, null, _waveVel);
        const flowSpeedLocal = Math.hypot(_flowVec.x, _flowVec.z);
        const waveOrbital = Math.hypot(_waveVel.x, _waveVel.z);
        const swayScale = 0.65 + flowSpeedLocal * 0.45 + waveOrbital * 1.45;

        leanEuler.set(
          THREE.MathUtils.clamp(_flowVec.z * 0.72, -0.55, 0.55),
          0,
          THREE.MathUtils.clamp(-_flowVec.x * 0.72, -0.55, 0.55),
          'XYZ'
        );
        qLean.setFromEuler(leanEuler);

        const swayX = Math.sin(elapsedTime * 1.35 + d.phase) * 0.14 * swayScale;
        const swayZ = Math.cos(elapsedTime * 1.05 + d.phase * 1.3) * 0.12 * swayScale;
        dummy.position.copy(d.pos);
        localEuler.set(d.baseTilt + swayX, d.rotY, swayZ, 'XYZ');
        qLocal.setFromEuler(localEuler);
        dummy.quaternion.copy(qLean).multiply(qLocal);
        dummy.scale.setScalar(d.scale);
        dummy.updateMatrix();
        dendroMesh.setMatrixAt(i, dummy.matrix);
      }
      dendroMesh.instanceMatrix.needsUpdate = true;
    }

    const nSarco = activeCounts.sarcophyton;
    if (nSarco > 0) {
      for (let i = 0; i < nSarco; i++) {
        const s = sarcoState[i];
        sampleFlowField(s.pos.x, s.pos.y + 0.18 * s.scale, s.pos.z, elapsedTime, env, bommies, _flowVec);
        sampleWaveOrbital(s.pos.x, s.pos.y + 0.18 * s.scale, s.pos.z, elapsedTime, env, null, _waveVel);
        const flowSpeedLocal = Math.hypot(_flowVec.x, _flowVec.z);
        const waveOrbital = Math.hypot(_waveVel.x, _waveVel.z);
        const swayScale = 0.62 + flowSpeedLocal * 0.40 + waveOrbital * 1.35;

        leanEuler.set(
          THREE.MathUtils.clamp(_flowVec.z * 0.48, -0.40, 0.40),
          0,
          THREE.MathUtils.clamp(-_flowVec.x * 0.48, -0.40, 0.40),
          'XYZ'
        );
        qLean.setFromEuler(leanEuler);

        const pulse = 1.0 + Math.sin(elapsedTime * 1.6 + s.phase) * (0.040 + waveOrbital * 0.08);
        const sway = Math.sin(elapsedTime * 0.85 + s.phase) * 0.05 * swayScale;
        dummy.position.copy(s.pos);
        localEuler.set(sway, s.rotY, sway * 0.7, 'XYZ');
        qLocal.setFromEuler(localEuler);
        dummy.quaternion.copy(qLean).multiply(qLocal);
        dummy.scale.set(s.scale * pulse, s.scale * (2.0 - pulse), s.scale * pulse);
        dummy.updateMatrix();
        sarcoMesh.setMatrixAt(i, dummy.matrix);
      }
      sarcoMesh.instanceMatrix.needsUpdate = true;
    }
  }

  update(0, undefined, DEFAULT_ENV_STATE);

  return {
    group,
    pickableMeshes,
    coralHeads,
    applySpeciesCounts,
    getActiveCounts: () => ({ ...activeCounts }),
    update,
  };
}
