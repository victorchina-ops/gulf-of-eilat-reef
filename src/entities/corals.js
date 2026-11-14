import * as THREE from 'three';
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
  createRng,
  fbm3D,
  prepareForMerge,
  safeMerge,
  safeNormalize,
} from './utils.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const REEF_ARCH_CENTER = [-2.0, 1.8];
const CLEANING_STATION_COORDS = [
  [1.75, 4.55],
  [1.15, -2.5],
  [-4.10, 5.35],
  [-3.2, -5.6],
  [0.35, -8.2],
];

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
 * + cross-bracing spurs + radial corallite bumps + conical lavender/blue axial tips.
 */
function buildRecursiveStaghorn(radius, rng) {
  const col = createFastGeometryCollector();
  const polypCandidates = [];
  const cBase = new THREE.Color('#694f33');
  const cMid = new THREE.Color('#967a4e');
  const cTip = new THREE.Color('#b0c6ff');
  const cPolypRadial = new THREE.Color('#f4d8ad');
  const cPolypAxial = new THREE.Color('#d9e6ff');

  // Lobed encrusting holdfast
  for (let h = 0; h < 4; h++) {
    const a = (h / 4) * Math.PI * 2 + rng() * 0.5;
    const lobe = new THREE.IcosahedronGeometry(radius * (h === 0 ? 0.16 : 0.115), 1);
    lobe.scale(1.35, 0.42, 1.35);
    lobe.translate(
      h === 0 ? 0 : Math.cos(a) * radius * 0.12,
      -0.015,
      h === 0 ? 0 : Math.sin(a) * radius * 0.12
    );
    col.appendGeometry(lobe, cBase);
    lobe.dispose();
  }

  const midNodes = [];

  function grow(origin, dir, len, r, depth) {
    const end = origin.clone().addScaledVector(dir, len);
    const t0 = depth / 4.5;
    const t1 = (depth + 1) / 4.5;
    const col0 = cBase.clone().lerp(cMid, Math.min(1, t0 * 1.45)).lerp(cTip, Math.max(0, t0 - 0.5) * 1.7);
    const col1 = cBase.clone().lerp(cMid, Math.min(1, t1 * 1.45)).lerp(cTip, Math.max(0, t1 - 0.5) * 1.7);
    const rNext = r * 0.72;

    col.addFrustum(origin, end, r, rNext, depth < 2 ? 6 : 5, col0, col1, 0, depth > 0);

    if (depth === 1 || depth === 2) {
      midNodes.push({ pos: end.clone(), r: rNext, depth });
    }

    // Radial corallite bumps & radial polyp anchors along mid/upper branches
    if (depth >= 1) {
      const refAxis = Math.abs(dir.y) < 0.9 ? WORLD_UP : new THREE.Vector3(1, 0, 0);
      const p1 = safeNormalize(new THREE.Vector3().crossVectors(dir, refAxis), 1, 0, 0);
      const p2 = safeNormalize(new THREE.Vector3().crossVectors(dir, p1), 0, 0, 1);
      const bumpCount = depth === 1 ? 2 : depth === 2 ? 2 : 1;
      for (let b = 0; b < bumpCount; b++) {
        const f = 0.3 + (b / Math.max(1, bumpCount)) * 0.5 + rng() * 0.15;
        const bPos = origin.clone().lerp(end, Math.min(0.92, f));
        const phi = rng() * Math.PI * 2;
        const radDir = safeNormalize(
          p1.clone().multiplyScalar(Math.cos(phi)).addScaledVector(p2, Math.sin(phi)),
          1,
          0,
          0
        );
        const corDir = safeNormalize(radDir.clone().multiplyScalar(0.85).addScaledVector(dir, 0.55), 0, 1, 0);
        const surfPos = bPos.clone().addScaledVector(radDir, THREE.MathUtils.lerp(r, rNext, f) * 0.85);
        col.addCone(surfPos, corDir, rNext * 0.42, rNext * 0.82, 4, col0, col1);
        const tipPos = surfPos.clone().addScaledVector(corDir, rNext * 0.75);
        pushPolypAnchor(polypCandidates, tipPos, corDir, 0.78 + rng() * 0.25, cPolypRadial);
      }
    }

    const isLeaf = depth >= 4 || (depth === 3 && rng() < 0.52);
    if (isLeaf) {
      col.addCone(end, dir, rNext * 1.04, rNext * 2.25, 5, col1, cTip);
      const tipApex = end.clone().addScaledVector(dir, rNext * 2.05);
      pushPolypAnchor(polypCandidates, tipApex, dir, 0.98 + rng() * 0.2, cPolypAxial);
      return;
    }

    const refAxis = Math.abs(dir.y) < 0.9 ? WORLD_UP : new THREE.Vector3(1, 0, 0);
    const perp1 = safeNormalize(new THREE.Vector3().crossVectors(dir, refAxis), 1, 0, 0);
    const perp2 = safeNormalize(new THREE.Vector3().crossVectors(dir, perp1), 0, 0, 1);
    const basePhi = rng() * Math.PI * 2;

    for (let c = 0; c < 2; c++) {
      const phi = basePhi + (c / 2) * Math.PI * 2 + (rng() - 0.5) * 0.48;
      const spread = depth === 3 ? 0.34 + rng() * 0.18 : 0.44 + rng() * 0.22;
      const childDir = dir
        .clone()
        .addScaledVector(perp1, Math.cos(phi) * spread)
        .addScaledVector(perp2, Math.sin(phi) * spread);
      childDir.y += 0.26 + depth * 0.08;
      safeNormalize(childDir, 0, 1, 0);
      const lenScale = depth === 3 ? 0.58 + rng() * 0.14 : 0.72 + rng() * 0.14;
      grow(end, childDir, len * lenScale, rNext, depth + 1);
    }
  }

  // 5 primary trunks
  const trunkCount = 5;
  for (let i = 0; i < trunkCount; i++) {
    const a = (i / trunkCount) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const tilt = i === 0 ? 0.18 : 0.34 + rng() * 0.16;
    const dir = safeNormalize(
      new THREE.Vector3(Math.cos(a) * tilt, 0.92, Math.sin(a) * tilt),
      0,
      1,
      0
    );
    const start = new THREE.Vector3(Math.cos(a) * radius * 0.07, -0.015, Math.sin(a) * radius * 0.07);
    grow(start, dir, radius * (0.30 + rng() * 0.06), radius * 0.062, 0);
  }

  // Cross-bracing anastomosing spurs between adjacent branches
  let braces = 0;
  for (let i = 0; i < midNodes.length && braces < 10; i++) {
    const nA = midNodes[i];
    for (let j = i + 1; j < midNodes.length && braces < 10; j++) {
      const nB = midNodes[j];
      if (nA.depth !== nB.depth) continue;
      const d = nA.pos.distanceTo(nB.pos);
      if (d > radius * 0.14 && d < radius * 0.38 && rng() < 0.55) {
        const rBrace = Math.min(nA.r, nB.r) * 0.52;
        col.addFrustum(nA.pos, nB.pos, rBrace, rBrace, 4, cMid, cMid, 0, true);
        const midBrace = nA.pos.clone().lerp(nB.pos, 0.5);
        pushPolypAnchor(polypCandidates, midBrace, WORLD_UP, 0.82, cPolypRadial);
        braces++;
        break;
      }
    }
  }

  const geom = col.toGeometry();
  const polyps = selectTargetPolypCount(polypCandidates, 105, 125, rng, radius * 0.045);
  return { geom, polyps };
}

/**
 * 2. Fractal Acropora Table: 3-rib buttressed pedestal + 9 primary radiating boughs x 4 fractal generations
 * + anastomosing cross-bridges + 220+ upturned branchlets.
 */
function buildFractalAcroporaTable(radius, rng) {
  const col = createFastGeometryCollector();
  const polypCandidates = [];
  const cBase = new THREE.Color('#6b5235');
  const cMid = new THREE.Color('#987b50');
  const cTip = new THREE.Color('#a4bfff');
  const cPolypCream = new THREE.Color('#f5dcb2');
  const cPolypRim = new THREE.Color('#d8e4ff');

  // 3-rib buttressed pedestal anchoring onto rock
  const trunkTop = new THREE.Vector3((rng() - 0.5) * 0.05, 0.24, (rng() - 0.5) * 0.05);
  col.addFrustum(new THREE.Vector3(0, -0.16, 0), trunkTop, radius * 0.13, radius * 0.10, 7, cBase, cBase);
  for (let r = 0; r < 3; r++) {
    const ra = (r / 3) * Math.PI * 2 + rng() * 0.35;
    const foot = new THREE.Vector3(Math.cos(ra) * radius * 0.22, -0.15, Math.sin(ra) * radius * 0.22);
    const join = trunkTop.clone().add(new THREE.Vector3(Math.cos(ra) * 0.04, -0.05, Math.sin(ra) * 0.04));
    col.addFrustum(foot, join, radius * 0.065, radius * 0.045, 5, cBase, cBase, 0, true);
  }

  const latticeNodes = [];

  function growHorizontalPlate(origin, dir, len, r, depth) {
    const end = origin.clone().addScaledVector(dir, len);
    const t0 = depth / 3.5;
    const t1 = (depth + 1) / 3.5;
    const col0 = cBase.clone().lerp(cMid, Math.min(1, t0 * 1.4));
    const col1 = cMid.clone().lerp(cTip, Math.max(0, t1 - 0.45));
    const rNext = r * 0.72;

    col.addFrustum(origin, end, r, rNext, 4, col0, col1, 0, true);

    if (depth === 1 || depth === 2) {
      latticeNodes.push({ pos: end.clone(), angle: Math.atan2(end.z, end.x), r: rNext, depth });
    }

    // 9 * (1 + 2*2 + 4*2 + 8*2) = 261 upturned vertical corallite branchlets across the open canopy
    const numTips = depth === 0 ? 1 : 2;
    for (let k = 0; k < numTips; k++) {
      const f = (k + 0.3 + rng() * 0.4) / numTips;
      const basePt = origin.clone().lerp(end, f);
      const tipH = 0.042 + rng() * 0.036 + depth * 0.008;
      const tipDir = safeNormalize(
        new THREE.Vector3(dir.x * 0.16 + (rng() - 0.5) * 0.16, 1.0, dir.z * 0.16 + (rng() - 0.5) * 0.16),
        0,
        1,
        0
      );
      const tipMid = basePt.clone().addScaledVector(tipDir, tipH * 0.72);
      col.addFrustum(basePt, tipMid, 0.011, 0.0065, 3, cMid, col1, 0, true);
      col.addCone(tipMid, tipDir, 0.007, tipH * 0.36, 3, col1, cTip);

      const tipApex = basePt.clone().addScaledVector(tipDir, tipH * 1.04);
      pushPolypAnchor(
        polypCandidates,
        tipApex,
        tipDir,
        0.78 + rng() * 0.25,
        depth >= 2 ? cPolypRim : cPolypCream
      );
    }

    if (depth >= 3) return;

    const yaw = Math.atan2(dir.z, dir.x);
    const fan = depth === 0 ? 0.48 : depth === 1 ? 0.35 : 0.25;
    for (let b = 0; b < 2; b++) {
      const sign = b === 0 ? -1 : 1;
      const nextYaw = yaw + sign * (fan + (rng() - 0.5) * 0.12);
      const nextDir = safeNormalize(
        new THREE.Vector3(Math.cos(nextYaw), 0.045 + depth * 0.038 + (rng() - 0.5) * 0.03, Math.sin(nextYaw)),
        1,
        0,
        0
      );
      growHorizontalPlate(end, nextDir, len * (0.76 + rng() * 0.11), rNext, depth + 1);
    }
  }

  // 9 primary radiating horizontal boughs x 4 fractal generations
  const limbCount = 9;
  const startAngle = rng() * Math.PI * 2;
  for (let i = 0; i < limbCount; i++) {
    const a = startAngle + (i / limbCount) * Math.PI * 2 + (rng() - 0.5) * 0.12;
    const limbDir = safeNormalize(new THREE.Vector3(Math.cos(a), 0.055, Math.sin(a)), 1, 0, 0);
    growHorizontalPlate(trunkTop, limbDir, radius * 0.29, radius * 0.048, 0);
  }

  // Anastomosing horizontal cross-bridges between angular neighbors
  for (const targetDepth of [1, 2]) {
    const ring = latticeNodes
      .filter((n) => n.depth === targetDepth)
      .sort((a, b) => a.angle - b.angle);
    for (let i = 0; i < ring.length; i++) {
      const nA = ring[i];
      const nB = ring[(i + 1) % ring.length];
      const d = nA.pos.distanceTo(nB.pos);
      if (d > radius * 0.08 && d < radius * 0.42 && rng() < 0.72) {
        const rb = Math.min(nA.r, nB.r) * 0.65;
        col.addFrustum(nA.pos, nB.pos, rb, rb, 4, cMid, cMid, 0, true);
      }
    }
  }

  const geom = col.toGeometry();
  const polyps = selectTargetPolypCount(polypCandidates, 120, 140, rng, radius * 0.05);
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
      depth < 2 ? 5 : 4,
      col0,
      col1,
      depth === 3 ? rNext * 1.12 : 0,
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
        const surf = bPt.clone().addScaledVector(radDir, THREE.MathUtils.lerp(r, rNext, f) * 0.85);
        const outDir = safeNormalize(radDir.clone().multiplyScalar(0.85).addScaledVector(dir, 0.5), 0, 1, 0);
        col.addCone(surf, outDir, rNext * 0.34, rNext * 0.52, 4, col0, col1);
        pushPolypAnchor(
          polypCandidates,
          surf.clone().addScaledVector(outDir, rNext * 0.42),
          outDir,
          0.78 + rng() * 0.22,
          cPolyp
        );
      }
    }

    if (depth >= 3) {
      // Tip polyps on blunt clubbed apices
      const clubTip = end.clone().addScaledVector(dir, rNext * 1.05);
      pushPolypAnchor(polypCandidates, clubTip, dir, 0.92 + rng() * 0.18, cPolyp);
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
  const cMid = new THREE.Color('#d1982e');
  const cTip = new THREE.Color('#fff5d9');
  const cDactylo = new THREE.Color('#fff7d6');

  const sheetNodes = [];

  function growBlade(origin, dir, fanRight, len, width, depth, sheetIdx) {
    const end = origin.clone().addScaledVector(dir, len);
    const col0 = depth < 2 ? cBase.clone().lerp(cMid, depth * 0.5) : cMid;
    const col1 = depth >= 2 ? cTip : cMid;

    const mid = origin.clone().addScaledVector(dir, len * 0.5);
    const up = safeNormalize(dir.clone(), 0, 1, 0);
    const right = safeNormalize(fanRight.clone(), 1, 0, 0);
    const fwd = safeNormalize(new THREE.Vector3().crossVectors(right, up), 0, 0, 1);
    right.crossVectors(up, fwd).normalize();

    col.addBox(mid, right, up, fwd, width * 0.78, width * 1.12, len, 0.019, col0, col1);

    if (depth >= 1) {
      sheetNodes.push({ pos: mid.clone(), end: end.clone(), depth, sheetIdx });
    }

    // Dactylozoid stinging hair anchors on both blade faces & upper growing edges
    const faceCount = depth === 0 ? 1 : 2;
    for (let f = 0; f < faceCount; f++) {
      const sideSign = f % 2 === 0 ? 1 : -1;
      const along = (rng() - 0.5) * 0.5 * len;
      const across = (rng() - 0.5) * 0.55 * width;
      const facePos = mid
        .clone()
        .addScaledVector(up, along)
        .addScaledVector(right, across)
        .addScaledVector(fwd, sideSign * 0.01);
      const faceNorm = fwd.clone().multiplyScalar(sideSign);
      pushPolypAnchor(polypCandidates, facePos, faceNorm, 0.85 + rng() * 0.25, cDactylo);
    }

    if (depth >= 3) {
      for (const eOff of [-0.28, 0.28]) {
        const edgePos = end.clone().addScaledVector(right, eOff * width);
        pushPolypAnchor(polypCandidates, edgePos, up, 0.92 + rng() * 0.22, cDactylo);
      }
      return;
    }

    for (const side of [-1, 1]) {
      const nextDir = dir.clone().addScaledVector(right, side * (0.40 + rng() * 0.16));
      nextDir.y += 0.25;
      safeNormalize(nextDir, 0, 1, 0);
      growBlade(end, nextDir, right, len * 0.78, width * 0.76, depth + 1, sheetIdx);
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
    growBlade(start, dir, fanRight, radius * 0.28, radius * 0.16, 0, s);
  }

  // Anastomosing honeycomb cross-bars linking nearby blade nodes
  let bars = 0;
  for (let i = 0; i < sheetNodes.length && bars < 22; i++) {
    const a = sheetNodes[i];
    for (let j = i + 1; j < sheetNodes.length && bars < 22; j++) {
      const b = sheetNodes[j];
      const d = a.pos.distanceTo(b.pos);
      if (d > radius * 0.10 && d < radius * 0.32 && (a.sheetIdx !== b.sheetIdx || rng() < 0.45)) {
        col.addFrustum(a.pos, b.pos, 0.011, 0.011, 4, cMid, cMid, 0, true);
        const midBar = a.pos.clone().lerp(b.pos, 0.5);
        pushPolypAnchor(polypCandidates, midBar, WORLD_UP, 0.85, cDactylo);
        bars++;
        break;
      }
    }
  }

  const geom = col.toGeometry();
  const polyps = selectTargetPolypCount(polypCandidates, 95, 115, rng, radius * 0.04);
  return { geom, polyps };
}

/**
 * 5. Platygyra Brain Coral (detail = 5): scalloped basal margin, deep sinuous meandroid valleys,
 * transverse septocostal striations along valley walls, emerald/mint valleys & warm terracotta ridges.
 */
function buildPlatygyraDome(radius, rng) {
  const geom = new THREE.IcosahedronGeometry(radius, 5);
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
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);

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

  geom.computeVertexNormals();
  for (const attr of Object.keys(geom.attributes)) {
    if (attr !== 'position' && attr !== 'normal') geom.deleteAttribute(attr);
  }

  const niPos = geom.attributes.position;
  const niNorm = geom.attributes.normal;
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

  for (let i = 0; i + 2 < niPos.count; i += 3) {
    v0.fromBufferAttribute(niPos, i);
    v1.fromBufferAttribute(niPos, i + 1);
    v2.fromBufferAttribute(niPos, i + 2);
    n0.fromBufferAttribute(niNorm, i);
    n1.fromBufferAttribute(niNorm, i + 1);
    n2.fromBufferAttribute(niNorm, i + 2);
    const r0 = vertRidge[i];
    const r1 = vertRidge[i + 1];
    const r2 = vertRidge[i + 2];

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
    const sph = new THREE.IcosahedronGeometry(lobe.r, 4);
    for (const attr of Object.keys(sph.attributes)) {
      if (attr !== 'position' && attr !== 'normal') sph.deleteAttribute(attr);
    }
    const pos = sph.attributes.position;
    const n1Cache = new Float32Array(pos.count);

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      if (y < 0) y *= 0.46;
      const n1 = fbm3D(x * 5.2 + lobe.seed, y * 5.2, z * 5.2, 3);
      const n2 = fbm3D(x * 12.5, y * 12.5 + lobe.seed, z * 12.5, 2);
      n1Cache[i] = n1;
      const bumps = n1 * 0.18 + (n2 - 0.5) * 0.08 + Math.sin(x * 15 + z * 13) * 0.02;
      const s = 0.90 + bumps;
      pos.setXYZ(i, lobe.ox + x * s, lobe.oy + y * s * 0.92, lobe.oz + z * s);
    }
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
    parts.push(sph);

    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();
    const v2 = new THREE.Vector3();
    const n0 = new THREE.Vector3();
    const n1 = new THREE.Vector3();
    const n2 = new THREE.Vector3();
    const cPt = new THREE.Vector3();
    const cN = new THREE.Vector3();

    for (let i = 0; i + 2 < pos.count; i += 3) {
      v0.fromBufferAttribute(pos, i);
      v1.fromBufferAttribute(pos, i + 1);
      v2.fromBufferAttribute(pos, i + 2);
      n0.fromBufferAttribute(pNorm, i);
      n1.fromBufferAttribute(pNorm, i + 1);
      n2.fromBufferAttribute(pNorm, i + 2);

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

  function addEightRayedFloret(center) {
    const bud = new THREE.IcosahedronGeometry(0.013, 0);
    bud.translate(center.x, center.y, center.z);
    parts.push(prepareForMerge(bud, cPolyp));
    bud.dispose();
    for (let r = 0; r < 8; r++) {
      const a = (r / 8) * Math.PI * 2;
      const ray = new THREE.ConeGeometry(0.0055, 0.022, 3, 1, true);
      ray.translate(0, 0.011, 0);
      const rayDir = safeNormalize(new THREE.Vector3(Math.cos(a) * 0.85, 0.55, Math.sin(a) * 0.85), 0, 1, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, rayDir);
      ray.applyMatrix4(new THREE.Matrix4().compose(center, q, new THREE.Vector3(1, 1, 1)));
      parts.push(prepareForMerge(ray, cPolyp));
      ray.dispose();
    }
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
    const ruffle = Math.sin(angle * 9.0) * 0.052 + Math.cos(angle * 17.0) * 0.024;
    const edgeFrac = THREE.MathUtils.clamp(r / 0.28, 0, 1);
    return ruffle * edgeFrac * edgeFrac;
  }

  // Deeply ruffled 9+17-wave toadstool leather cap
  const cap = new THREE.CylinderGeometry(0.28, 0.11, 0.055, 42, 3);
  cap.translate(0, 0.17, 0);
  const pos = cap.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setY(i, y + evalCapRuffle(x, z));
  }
  cap.computeVertexNormals();
  parts.push(
    prepareForMerge(cap, (x, _y, z, _nx, _ny, _nz, out) => {
      const r = THREE.MathUtils.clamp(Math.hypot(x, z) / 0.28, 0, 1);
      out.copy(cCap).lerp(cPolypTip, r * 0.65);
    })
  );
  cap.dispose();

  // 52 explicit 3D 8-tentacle autozooid polyps carpeting the ruffled leather cap
  for (let p = 0; p < 52; p++) {
    const frac = (p + 0.5) / 52;
    const rad = 0.032 + Math.sqrt(frac) * 0.225;
    const ang = p * 2.39996;
    const px = Math.cos(ang) * rad;
    const pz = Math.sin(ang) * rad;
    const py = 0.197 + evalCapRuffle(px, pz);

    const stalk = new THREE.CylinderGeometry(0.0032, 0.0042, 0.015, 4, 1, true);
    stalk.translate(px, py + 0.007, pz);
    parts.push(prepareForMerge(stalk, cPolypTip));
    stalk.dispose();

    const crownCenter = new THREE.Vector3(px, py + 0.014, pz);
    for (let t = 0; t < 8; t++) {
      const ta = (t / 8) * Math.PI * 2 + p * 0.3;
      const tDir = safeNormalize(
        new THREE.Vector3(Math.cos(ta) * 0.78, 0.62, Math.sin(ta) * 0.78),
        0,
        1,
        0
      );
      const tent = new THREE.ConeGeometry(0.0026, 0.014, 3, 1, true);
      tent.translate(0, 0.007, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, tDir);
      tent.applyMatrix4(new THREE.Matrix4().compose(crownCenter, q, new THREE.Vector3(1, 1, 1)));
      parts.push(prepareForMerge(tent, cAutozooid));
      tent.dispose();
    }
  }

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

export function createCorals({ applyUnderwaterMaterial, sampleSubstrate }) {
  const group = new THREE.Group();
  group.name = 'reef-corals';

  const pickableMeshes = [];
  const coralHeads = [];

  const hardCoralMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.74,
      metalness: 0.04,
    }),
    { receiveCaustics: true, causticsStrength: 1.0 }
  );

  const softCoralMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.56,
      metalness: 0.03,
    }),
    { receiveCaustics: true, causticsStrength: 0.92 }
  );

  // Polyp material chained cleanly AFTER applyUnderwaterMaterial
  const polypUniforms = {
    uPolypTime: { value: 0 },
    uPolypFlow: { value: new THREE.Vector3(0, 0, 0.45) },
  };
  const polypMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.52,
      metalness: 0.04,
    }),
    { receiveCaustics: true, causticsStrength: 1.0 }
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
    { speciesId: 'porites', morph: 'tan', x: 3.2, z: -0.7, radius: 0.80, seed: 1503 },
    { speciesId: 'porites', morph: 'ochre', x: -3.2, z: -5.6, radius: 0.94, seed: 1504, isCleaningStation: true, stationId: 3 },
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
    { speciesId: 'porites', morph: 'ochre', x: 1.15, z: -2.5, radius: 0.78, seed: 1609, isCleaningStation: true, stationId: 1 },
    { speciesId: 'millepora', x: -2.15, z: -2.95, radius: 0.62, seed: 1610 },
    { speciesId: 'acropora', variant: 'staghorn', x: 1.10, z: -5.8, radius: 0.88, seed: 1611 },
    { speciesId: 'platygyra', x: 0.35, z: -8.2, radius: 0.66, seed: 1612, isCleaningStation: true, stationId: 4 },

    // Dedicated Cleaning Station coral heads (+ relocated accent coral 1614)
    { speciesId: 'porites', morph: 'ochre', x: 1.75, z: 4.55, radius: 0.82, seed: 1613, isCleaningStation: true, stationId: 0 },
    { speciesId: 'stylophora', morph: 'pink', x: 3.15, z: 5.85, radius: 0.54, seed: 1614 },
    { speciesId: 'platygyra', x: -4.10, z: 5.35, radius: 0.72, seed: 1615, isCleaningStation: true, stationId: 2 },
  ];

  const HARD_CORAL_IDS = ['acropora', 'stylophora', 'millepora', 'platygyra', 'porites'];
  const hardMeshesBySpecies = Object.fromEntries(HARD_CORAL_IDS.map((id) => [id, []]));
  const hardHeadsBySpecies = Object.fromEntries(HARD_CORAL_IDS.map((id) => [id, []]));
  const templatesBySpecies = Object.fromEntries(HARD_CORAL_IDS.map((id) => [id, []]));
  const colonyPolypEntriesBySpecies = Object.fromEntries(HARD_CORAL_IDS.map((id) => [id, []]));
  const occupiedSpots = [];

  for (const p of staticPlacements) {
    const rng = createRng(p.seed);
    const hit = sampleSubstrate(p.x, p.z);
    const baseY = hit.y - 0.04;

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
    mesh.position.set(p.x, baseY, p.z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.speciesId = p.speciesId;
    mesh.name = `${p.speciesId}-${p.seed}`;

    group.add(mesh);
    pickableMeshes.push(mesh);

    const isBranching = p.speciesId === 'acropora' || p.speciesId === 'stylophora' || p.speciesId === 'millepora';
    const topWorldY = Math.min(MAX_STATIC_Y - 0.02, baseY + actualTopLocalY);
    const crownCenterY = Math.min(MAX_STATIC_Y - 0.12, baseY + actualTopLocalY * 0.58);
    const head = {
      position: new THREE.Vector3(p.x, crownCenterY, p.z),
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
    occupiedSpots.push({ x: p.x, z: p.z });
  }

  function isSpotClear(x, z, minSep = 1.05) {
    // Keep clear of reef arch swim-through center (-2.0, 1.8)
    if (Math.hypot(x - REEF_ARCH_CENTER[0], z - REEF_ARCH_CENTER[1]) < 1.20) return false;
    // Keep clear of all 5 cleaning stations (>= 1.35m)
    for (let i = 0; i < CLEANING_STATION_COORDS.length; i++) {
      if (Math.hypot(x - CLEANING_STATION_COORDS[i][0], z - CLEANING_STATION_COORDS[i][1]) < 1.35) {
        return false;
      }
    }
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

    for (let attempt = 0; attempt < 600; attempt++) {
      const preferRock = attempt < 360;
      const r = 1.1 + Math.sqrt(rng()) * 11.8;
      const a = rng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 1.0;

      if (!isSpotClear(x, z, 1.05)) continue;
      const hit = sampleSubstrate(x, z);
      if (preferRock && !hit.onRock) continue;
      if (hit.y < -3.6) continue;
      const baseY = hit.y - 0.04;
      if (baseY + topHeight > MAX_STATIC_Y - 0.02) continue;

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
  for (const s of dendroSpots) occupiedSpots.push({ x: s.x, z: s.z });

  const dendroBonusPalette = ['#ff2b5e', '#ff4d94', '#ff5d2e', '#e6296f', '#ff3b78', '#ff5533'];
  const dendroMax = SPECIES_POPULATION_SPEC.dendronephthya.maxCount;
  for (let i = dendroSpots.length; i < dendroMax; i++) {
    let placed = null;
    for (let attempt = 0; attempt < 450; attempt++) {
      const r = 1.4 + Math.sqrt(bonusRng()) * 10.5;
      const a = bonusRng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 1.0;
      if (!isSpotClear(x, z, 1.05)) continue;
      const hit = sampleSubstrate(x, z);
      if (attempt < 280 && !hit.onRock) continue;
      if (hit.y < -3.6 || hit.y - 0.03 > MAX_STATIC_Y - 0.68) continue;
      occupiedSpots.push({ x, z });
      placed = {
        x,
        z,
        color: dendroBonusPalette[(i - 6) % dendroBonusPalette.length],
        scale: 1.38 + bonusRng() * 0.30,
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
  configureDynamicMesh(dendroMesh, 'dendronephthya');

  const dendroState = [];
  const dendroHeads = [];
  const dummy = new THREE.Object3D();

  for (let i = 0; i < dendroSpots.length; i++) {
    const s = dendroSpots[i];
    const sub = sampleSubstrate(s.x, s.z);
    const pos = new THREE.Vector3(s.x, Math.min(MAX_STATIC_Y - 0.68, sub.y - 0.03), s.z);
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
  for (const s of sarcoSpots) occupiedSpots.push({ x: s.x, z: s.z });

  const sarcoMax = SPECIES_POPULATION_SPEC.sarcophyton.maxCount;
  for (let i = sarcoSpots.length; i < sarcoMax; i++) {
    let placed = null;
    for (let attempt = 0; attempt < 450; attempt++) {
      const r = 1.4 + Math.sqrt(bonusRng()) * 10.5;
      const a = bonusRng() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 1.0;
      if (!isSpotClear(x, z, 1.05)) continue;
      const hit = sampleSubstrate(x, z);
      if (attempt < 280 && !hit.onRock) continue;
      if (hit.y < -3.6 || hit.y - 0.02 > MAX_STATIC_Y - 0.48) continue;
      occupiedSpots.push({ x, z });
      placed = {
        x,
        z,
        scale: 1.35 + bonusRng() * 0.30,
        rotY: (bonusRng() - 0.5) * Math.PI * 2,
      };
      break;
    }
    if (placed) sarcoSpots.push(placed);
  }

  const sarcoGeom = buildSarcophytonPrototype();
  const sarcoMesh = new THREE.InstancedMesh(sarcoGeom, softCoralMat, sarcoMax);
  sarcoMesh.name = 'sarcophyton-colonies';
  configureDynamicMesh(sarcoMesh, 'sarcophyton');

  const sarcoState = [];
  const sarcoHeads = [];
  for (let i = 0; i < sarcoSpots.length; i++) {
    const s = sarcoSpots[i];
    const sub = sampleSubstrate(s.x, s.z);
    const pos = new THREE.Vector3(s.x, Math.min(MAX_STATIC_Y - 0.48, sub.y - 0.02), s.z);
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
  const WAVE_DIR_X = 0.86;
  const WAVE_DIR_Z = 0.51;
  const WAVE_K = 0.42;
  const WAVE_OMEGA = 1.45;
  const colonyWaveScratch = { waveOrbital: 0, orbitalOsc: 0 };
  let smoothedLeanPitchX = 0.45 * 0.24;
  let smoothedLeanRollZ = 0;

  function evalColonyWave(pos, elapsedTime, surfaceHeight, waveInt, out = colonyWaveScratch) {
    const uwDepth = Math.max(0, surfaceHeight - pos.y);
    const waveOrbital = waveInt * Math.exp(-uwDepth * 0.20);
    const wavePhase = WAVE_OMEGA * elapsedTime - (pos.x * WAVE_DIR_X + pos.z * WAVE_DIR_Z) * WAVE_K;
    out.waveOrbital = waveOrbital;
    out.orbitalOsc = waveOrbital * Math.sin(wavePhase);
    return out;
  }

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
    applySpeciesCounts(envState?.speciesCounts);

    const rawDir = Number.isFinite(envState?.currentDirection)
      ? envState.currentDirection
      : DEFAULT_ENV_STATE.currentDirection;
    const rawSpd = Number.isFinite(envState?.currentSpeed)
      ? envState.currentSpeed
      : DEFAULT_ENV_STATE.currentSpeed;
    const waveInt = THREE.MathUtils.clamp(
      Number.isFinite(envState?.waveIntensity) ? envState.waveIntensity : DEFAULT_ENV_STATE.waveIntensity,
      0,
      1
    );
    const diveDepth = THREE.MathUtils.clamp(
      Number.isFinite(envState?.diveDepth) ? envState.diveDepth : DEFAULT_ENV_STATE.diveDepth,
      WORLD_CONSTANTS.MIN_DEPTH,
      WORLD_CONSTANTS.MAX_DEPTH
    );
    const surfaceHeight = WORLD_CONSTANTS.SURFACE_BASE_Y + diveDepth;

    const toRad = (rawDir * Math.PI) / 180;
    const flowX = Math.sin(toRad);
    const flowZ = -Math.cos(toRad);
    const speed = THREE.MathUtils.clamp(rawSpd, 0, 1.2);

    // Depth-weighted oscillatory wave-orbital component along wave propagation vector (0.86, 0.51)
    let polypAttenSum = 0;
    let polypColonyCount = 0;
    for (const id of HARD_CORAL_IDS) {
      const heads = hardHeadsBySpecies[id];
      for (let i = 0; i < heads.length; i++) {
        const head = heads[i];
        if (head.active === false) continue;
        const uwDepth = Math.max(0, surfaceHeight - (head.crownCenterY ?? head.position.y));
        polypAttenSum += Math.exp(-uwDepth * 0.20);
        polypColonyCount++;
      }
    }
    const meanPolypAtten =
      polypColonyCount > 0
        ? polypAttenSum / polypColonyCount
        : Math.exp(-Math.max(0, surfaceHeight - 0.5) * 0.20);
    const polypOrbitalOsc = waveInt * meanPolypAtten * Math.sin(WAVE_OMEGA * elapsedTime) * 0.62;

    polypUniforms.uPolypTime.value = elapsedTime;
    polypUniforms.uPolypFlow.value.set(
      flowX * speed + WAVE_DIR_X * polypOrbitalOsc,
      0,
      flowZ * speed + WAVE_DIR_Z * polypOrbitalOsc
    );

    const targetPitchX = flowZ * speed * 0.24;
    const targetRollZ = -flowX * speed * 0.24;
    const alpha = Number.isFinite(_deltaTime) && _deltaTime > 0 ? Math.min(1, _deltaTime * 3.2) : 1.0;
    smoothedLeanPitchX = THREE.MathUtils.lerp(smoothedLeanPitchX, targetPitchX, alpha);
    smoothedLeanRollZ = THREE.MathUtils.lerp(smoothedLeanRollZ, targetRollZ, alpha);

    const nDendro = activeCounts.dendronephthya;
    if (nDendro > 0) {
      for (let i = 0; i < nDendro; i++) {
        const d = dendroState[i];
        const { waveOrbital, orbitalOsc } = evalColonyWave(d.pos, elapsedTime, surfaceHeight, waveInt, colonyWaveScratch);
        const swayScale = 0.65 + speed * 0.20 + waveOrbital * 1.55;

        leanEuler.set(
          smoothedLeanPitchX + WAVE_DIR_Z * orbitalOsc * 0.22,
          0,
          smoothedLeanRollZ - WAVE_DIR_X * orbitalOsc * 0.22,
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
        const { waveOrbital, orbitalOsc } = evalColonyWave(s.pos, elapsedTime, surfaceHeight, waveInt, colonyWaveScratch);
        const swayScale = 0.65 + speed * 0.18 + waveOrbital * 1.55;

        leanEuler.set(
          smoothedLeanPitchX + WAVE_DIR_Z * orbitalOsc * 0.14,
          0,
          smoothedLeanRollZ - WAVE_DIR_X * orbitalOsc * 0.14,
          'XYZ'
        );
        qLean.setFromEuler(leanEuler);

        const pulse = 1.0 + Math.sin(elapsedTime * 1.6 + s.phase) * (0.040 + waveOrbital * 0.025);
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

  update(0, undefined, { currentDirection: 180, currentSpeed: 0.45 });

  return {
    group,
    pickableMeshes,
    coralHeads,
    applySpeciesCounts,
    getActiveCounts: () => ({ ...activeCounts }),
    update,
  };
}
