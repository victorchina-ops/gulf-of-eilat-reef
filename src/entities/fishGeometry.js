import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { enableShadows, prepareForMerge, safeMerge, safeNormalize } from './utils.js';

export const PART_BODY = 0;
export const PART_PECTORAL_LEFT = -1;
export const PART_PECTORAL_RIGHT = 1;
export const PART_MEDIAN_FIN = 2;
export const PART_CAUDAL = 3;

const FIN_ANIM_DEFAULT = [PART_BODY, 0, 0.5, 0.5];

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function fractSin(v) {
  const s = Math.sin(v) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Computes normalized longitudinal body attachment coordinate uAttach in [0, 1].
 * Exact 0.0 at z = -tailPivotZ (peduncle hinge) and 1.0 at snout (+length * 0.5).
 */
export function computeUAttach(z, bodyLength, tailPivotZ = bodyLength * 0.46) {
  const pivot = tailPivotZ ?? bodyLength * 0.46;
  const denom = Math.max(1e-5, bodyLength * 0.5 + pivot);
  return clamp01((z + pivot) / denom);
}

/**
 * Welds duplicate seam/triangle vertices into a compact indexed BufferGeometry and recomputes
 * smooth vertex normals while preserving sharp normal breaks (e.g., double-sided fin sheets).
 */
export function weldFishGeometry(geometry, tolerance = 1e-4) {
  if (!geometry || !geometry.attributes?.position || geometry.attributes.position.count === 0) {
    return geometry;
  }
  const work = geometry.clone();
  if (work.attributes.uv) work.deleteAttribute('uv');
  const welded = mergeVertices(work, tolerance);
  if (welded !== work) work.dispose();
  if (welded && welded.attributes?.position?.count > 0) {
    welded.computeVertexNormals();
    welded.computeBoundingBox();
    welded.computeBoundingSphere();
    if (welded !== geometry && typeof geometry.dispose === 'function') {
      geometry.dispose();
    }
    return welded;
  }
  return geometry;
}

/**
 * Ensures uniform non-indexed attribute parity: [position(3), normal(3), color(3), aFinAnim(4)].
 */
export function prepareFishPart(geometry, colorSource = null, finAnimFn = null) {
  const geom = prepareForMerge(geometry, colorSource);
  const pos = geom.attributes.position;
  const count = pos.count;
  const finAnim = new Float32Array(count * 4);

  if (typeof finAnimFn === 'function') {
    for (let i = 0; i < count; i++) {
      const v = finAnimFn(pos.getX(i), pos.getY(i), pos.getZ(i), i) || FIN_ANIM_DEFAULT;
      finAnim[i * 4] = v[0];
      finAnim[i * 4 + 1] = v[1];
      finAnim[i * 4 + 2] = v[2];
      finAnim[i * 4 + 3] = v[3];
    }
  } else {
    const c = (Array.isArray(finAnimFn) || ArrayBuffer.isView(finAnimFn)) ? finAnimFn : FIN_ANIM_DEFAULT;
    const c0 = c[0];
    const c1 = c[1];
    const c2 = c[2];
    const c3 = c[3];
    for (let i = 0; i < count; i++) {
      finAnim[i * 4] = c0;
      finAnim[i * 4 + 1] = c1;
      finAnim[i * 4 + 2] = c2;
      finAnim[i * 4 + 3] = c3;
    }
  }

  geom.setAttribute('aFinAnim', new THREE.Float32BufferAttribute(finAnim, 4));
  return geom;
}

/**
 * Deterministic 3D Voronoi cell distance (F1) + F2-F1 edge distance + cellHash.
 * Pure trig/hash math for organic ocellated spots, rosettes, and reticulations.
 */
export function cellularSpotMask(x, y, z, scale = 18.0, jitter = 0.72) {
  const sx = x * scale;
  const sy = y * scale;
  const sz = z * scale;
  const ix = Math.floor(sx);
  const iy = Math.floor(sy);
  const iz = Math.floor(sz);
  const fx = sx - ix;
  const fy = sy - iy;
  const fz = sz - iz;

  let f1Sq = 1e9;
  let f2Sq = 1e9;
  let bestHash = 0;

  for (let dz = -1; dz <= 1; dz++) {
    const cz = iz + dz;
    for (let dy = -1; dy <= 1; dy++) {
      const cy = iy + dy;
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const h1 = fractSin(cx * 127.1 + cy * 311.7 + cz * 74.7);
        const h2 = fractSin(cx * 269.5 + cy * 183.3 + cz * 246.1);
        const h3 = fractSin(cx * 113.5 + cy * 271.9 + cz * 124.6);
        const px = dx + 0.5 + (h1 - 0.5) * jitter - fx;
        const py = dy + 0.5 + (h2 - 0.5) * jitter - fy;
        const pz = dz + 0.5 + (h3 - 0.5) * jitter - fz;
        const dSq = px * px + py * py + pz * pz;
        if (dSq < f1Sq) {
          f2Sq = f1Sq;
          f1Sq = dSq;
          bestHash = h1;
        } else if (dSq < f2Sq) {
          f2Sq = dSq;
        }
      }
    }
  }

  const f1 = Math.sqrt(f1Sq);
  const f2 = Math.sqrt(f2Sq);
  return {
    dist: f1,
    edgeDist: f2 - f1,
    cellHash: bestHash,
  };
}

/**
 * Builds a closed, smooth fish body from parametric longitudinal & asymmetric cross-section profiles.
 * Local coordinates: +Z is snout, -Z is tail peduncle, +Y is dorsal, +X is right flank.
 */
export function buildParametricFishBody({
  length,
  halfHeight,
  halfWidth,
  segsU = 28,
  segsV = 16,
  heightProfile,
  dorsalProfile = heightProfile,
  ventralProfile = heightProfile,
  widthProfile,
  spineYOffset = () => 0,
  dorsalSharpness = 0.0,
  ventralFlatness = 0.0,
  operculumRidge = 0.0,
  tailPivotZ = length * 0.46,
  colorFn,
}) {
  const vertCount = (segsU + 1) * segsV;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const finAnim = new Float32Array(vertCount * 4);
  const indices = [];
  const tmpColor = new THREE.Color();

  for (let iu = 0; iu <= segsU; iu++) {
    const u = iu / segsU; // 0 = tail (-Z), 1 = snout (+Z)
    const zNorm = u * 2 - 1;
    const z = zNorm * (length * 0.5);
    const hDorsal = Math.max(0.002, dorsalProfile(u)) * halfHeight;
    const hVentral = Math.max(0.002, ventralProfile(u)) * halfHeight;
    const opDelta = (u - 0.72) / 0.055;
    const operculumBump = operculumRidge > 0 ? 1.0 + operculumRidge * Math.exp(-opDelta * opDelta) : 1.0;
    const w = Math.max(0.002, widthProfile(u)) * halfWidth * operculumBump;
    const yOff = spineYOffset(u) * halfHeight;
    const uAttach = computeUAttach(z, length, tailPivotZ);
    const chord01 = clamp01(1.0 - u);

    for (let iv = 0; iv < segsV; iv++) {
      const theta = (iv / segsV) * Math.PI * 2;
      const sx = Math.sin(theta);
      const cy = Math.cos(theta);

      let widthFactor = 1.0;
      let y;
      if (cy >= 0) {
        if (dorsalSharpness > 0) {
          widthFactor *= 1.0 - dorsalSharpness * Math.pow(cy, 1.4);
        }
        y = cy * hDorsal + yOff;
      } else {
        const vDown = -cy;
        let ventralYScale = 1.0;
        if (ventralFlatness > 0) {
          ventralYScale = 1.0 - ventralFlatness * 0.42 * Math.pow(vDown, 1.6);
          widthFactor *= 1.0 + ventralFlatness * 0.45 * Math.sin(vDown * Math.PI * 0.85);
        }
        y = cy * hVentral * ventralYScale + yOff;
      }

      const x = sx * w * widthFactor;
      const idx = iu * segsV + iv;
      positions[idx * 3] = x;
      positions[idx * 3 + 1] = y;
      positions[idx * 3 + 2] = z;

      colorFn(zNorm, cy, sx, tmpColor);
      colors[idx * 3] = tmpColor.r;
      colors[idx * 3 + 1] = tmpColor.g;
      colors[idx * 3 + 2] = tmpColor.b;

      finAnim[idx * 4] = PART_BODY;
      finAnim[idx * 4 + 1] = 0.0;
      finAnim[idx * 4 + 2] = uAttach;
      finAnim[idx * 4 + 3] = chord01;
    }
  }

  for (let iu = 0; iu < segsU; iu++) {
    const row0 = iu * segsV;
    const row1 = (iu + 1) * segsV;
    for (let iv = 0; iv < segsV; iv++) {
      const ivNext = (iv + 1) % segsV;
      const a = row0 + iv;
      const b = row1 + iv;
      const c = row1 + ivNext;
      const d = row0 + ivNext;
      indices.push(a, b, c, a, c, d);
    }
  }

  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  indexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  indexed.setAttribute('aFinAnim', new THREE.BufferAttribute(finAnim, 4));
  indexed.setIndex(indices);
  const welded = mergeVertices(indexed, 1e-5);
  if (welded !== indexed) indexed.dispose();
  welded.computeVertexNormals();

  const geom = welded.toNonIndexed();
  welded.dispose();
  return geom;
}

function distToSegment2D(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-10) return Math.hypot(wx, wy);
  const t = clamp01((wx * vx + wy * vy) / lenSq);
  const dx = px - (ax + t * vx);
  const dy = py - (ay + t * vy);
  return Math.hypot(dx, dy);
}

function detectMedianRootEdge(points2D) {
  const n = points2D.length;
  let sumY = 0;
  for (let i = 0; i < n; i++) sumY += points2D[i][1];
  const sign = sumY >= 0 ? 1 : -1;

  let iMin = 0;
  let minVal = sign * points2D[0][1];
  for (let i = 1; i < n; i++) {
    const v = sign * points2D[i][1];
    if (v < minVal) {
      minVal = v;
      iMin = i;
    }
  }

  const iPrev = (iMin - 1 + n) % n;
  const iNext = (iMin + 1) % n;
  const prevVal = sign * points2D[iPrev][1];
  const nextVal = sign * points2D[iNext][1];
  const iOther = prevVal <= nextVal ? iPrev : iNext;
  return [points2D[iMin], points2D[iOther]];
}

function resolveColorFn(colorSource) {
  if (typeof colorSource === 'function') return colorSource;
  const c = (colorSource && colorSource.isColor) ? colorSource : new THREE.Color(0xffffff);
  return (_x, _y, _z, out) => out.copy(c);
}

/**
 * Builds a subdivided, tapered two-sided airfoil fin membrane in the YZ plane centered on X = 0.
 * `points2D` are [z, y] polygon vertices. Preserves full backward compatibility when `finOpts` is omitted.
 */
export function buildFinStrip(points2D, thickness, colorFn, finOpts = {}) {
  const safeColorFn = resolveColorFn(colorFn);
  if (!points2D || points2D.length < 3) {
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('normal', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
    empty.setAttribute('aFinAnim', new THREE.Float32BufferAttribute([], 4));
    return empty;
  }

  const isCaudal = Boolean(finOpts.isCaudal);
  const partCode = isCaudal ? PART_CAUDAL : (finOpts.partCode ?? PART_MEDIAN_FIN);
  const bodyLength = finOpts.bodyLength ?? 0.25;
  const tailPivotZ = finOpts.tailPivotZ ?? bodyLength * 0.46;
  const spanSegs = Math.max(3, finOpts.spanSegs ?? 4);

  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxTailZ = 1e-4;
  for (let i = 0; i < points2D.length; i++) {
    const z = points2D[i][0];
    const y = points2D[i][1];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (-z > maxTailZ) maxTailZ = -z;
  }

  const [rootA, rootB] = detectMedianRootEdge(points2D);
  let maxRootDist = 1e-4;
  if (!isCaudal) {
    for (let i = 0; i < points2D.length; i++) {
      const d = distToSegment2D(points2D[i][0], points2D[i][1], rootA[0], rootA[1], rootB[0], rootB[1]);
      if (d > maxRootDist) maxRootDist = d;
    }
  }

  // Build CCW contour in 2D (z, y) and subdivide perimeter edges for smooth curvature & span resolution
  const rawContour = points2D.map((p) => new THREE.Vector2(p[0], p[1]));
  if (THREE.ShapeUtils.isClockWise(rawContour)) {
    rawContour.reverse();
  }

  const contour = [];
  const edgeSub = Math.max(1, Math.ceil(spanSegs * 0.5));
  for (let i = 0; i < rawContour.length; i++) {
    const a = rawContour[i];
    const b = rawContour[(i + 1) % rawContour.length];
    for (let s = 0; s < edgeSub; s++) {
      const t = s / edgeSub;
      contour.push(new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
    }
  }

  const baseTris = THREE.ShapeUtils.triangulateShape(contour, []);
  const verts2D = contour.map((p) => [p.x, p.y]);
  const vertMap = new Map();
  for (let i = 0; i < verts2D.length; i++) {
    vertMap.set(`${verts2D[i][0].toFixed(6)},${verts2D[i][1].toFixed(6)}`, i);
  }

  function getOrAddVertex(z, y) {
    const key = `${z.toFixed(6)},${y.toFixed(6)}`;
    const existing = vertMap.get(key);
    if (existing !== undefined) return existing;
    const idx = verts2D.length;
    verts2D.push([z, y]);
    vertMap.set(key, idx);
    return idx;
  }

  // Two rounds of 1-to-4 midpoint subdivision -> >= 4 spanwise rings, zero T-junctions
  let tris = baseTris;
  const subRounds = spanSegs >= 4 ? 2 : 1;
  for (let round = 0; round < subRounds; round++) {
    const nextTris = [];
    for (let t = 0; t < tris.length; t++) {
      const [ia, ib, ic] = tris[t];
      const a = verts2D[ia];
      const b = verts2D[ib];
      const c = verts2D[ic];
      const iab = getOrAddVertex((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5);
      const ibc = getOrAddVertex((b[0] + c[0]) * 0.5, (b[1] + c[1]) * 0.5);
      const ica = getOrAddVertex((c[0] + a[0]) * 0.5, (c[1] + a[1]) * 0.5);
      nextTris.push([ia, iab, ica], [iab, ib, ibc], [ica, ibc, ic], [iab, ibc, ica]);
    }
    tris = nextTris;
  }

  // Compute span01, chord01, uAttach, and half-thickness at every 2D vertex
  const vertCount2D = verts2D.length;
  const vSpan = new Float32Array(vertCount2D);
  const vChord = new Float32Array(vertCount2D);
  const vAttach = new Float32Array(vertCount2D);
  const vHalfT = new Float32Array(vertCount2D);

  const zSpan = Math.max(1e-4, maxZ - minZ);
  const ySpan = Math.max(1e-4, maxY - minY);

  for (let i = 0; i < vertCount2D; i++) {
    const z = verts2D[i][0];
    const y = verts2D[i][1];
    let span01;
    let chord01;
    let uAttach;
    if (isCaudal) {
      span01 = clamp01(-z / maxTailZ);
      chord01 = clamp01((y - minY) / ySpan);
      uAttach = 0.0;
    } else {
      const dRoot = distToSegment2D(z, y, rootA[0], rootA[1], rootB[0], rootB[1]);
      span01 = clamp01(dRoot / maxRootDist);
      chord01 = clamp01((maxZ - z) / zSpan);
      uAttach = computeUAttach(z, bodyLength, tailPivotZ);
    }
    vSpan[i] = span01;
    vChord[i] = chord01;
    vAttach[i] = uAttach;
    vHalfT[i] = 0.5 * thickness * (1.0 - 0.78 * Math.pow(span01, 0.9));
  }

  // Compute smooth normals independently for +X sheet and -X sheet via indexed sheets
  function buildSheet(signX) {
    const pos = new Float32Array(vertCount2D * 3);
    const col = new Float32Array(vertCount2D * 3);
    const fa = new Float32Array(vertCount2D * 4);
    const tmp = new THREE.Color();

    for (let i = 0; i < vertCount2D; i++) {
      const x = signX * vHalfT[i];
      const y = verts2D[i][1];
      const z = verts2D[i][0];
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      safeColorFn(x, y, z, tmp);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;

      fa[i * 4] = partCode;
      fa[i * 4 + 1] = vSpan[i];
      fa[i * 4 + 2] = vAttach[i];
      fa[i * 4 + 3] = vChord[i];
    }

    const idx = [];
    for (let t = 0; t < tris.length; t++) {
      const [a, b, c] = tris[t];
      if (signX > 0) idx.push(a, c, b);
      else idx.push(a, b, c);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aFinAnim', new THREE.BufferAttribute(fa, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nonIdx = g.toNonIndexed();
    g.dispose();
    return nonIdx;
  }

  const plusSheet = buildSheet(1);
  const minusSheet = buildSheet(-1);

  // Find directed boundary edges of the subdivided triangle mesh to seal the airfoil rim
  const edgeSet = new Set();
  const directedEdges = [];
  for (let t = 0; t < tris.length; t++) {
    const tri = tris[t];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      edgeSet.add(`${a}:${b}`);
      directedEdges.push([a, b]);
    }
  }

  const rimPos = [];
  const rimNorm = [];
  const rimCol = [];
  const rimFa = [];
  const tmpColor = new THREE.Color();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const fNorm = new THREE.Vector3();

  function pushRimVert(x, y, z, nx, ny, nz, idx2D) {
    rimPos.push(x, y, z);
    rimNorm.push(nx, ny, nz);
    safeColorFn(x, y, z, tmpColor);
    rimCol.push(tmpColor.r, tmpColor.g, tmpColor.b);
    rimFa.push(partCode, vSpan[idx2D], vAttach[idx2D], vChord[idx2D]);
  }

  for (let i = 0; i < directedEdges.length; i++) {
    const [a, b] = directedEdges[i];
    if (edgeSet.has(`${b}:${a}`)) continue;
    const az = verts2D[a][0];
    const ay = verts2D[a][1];
    const at = vHalfT[a];
    const bz = verts2D[b][0];
    const by = verts2D[b][1];
    const bt = vHalfT[b];

    vA.set(at, ay, az);
    vB.set(bt, by, bz);
    vC.set(-bt, by, bz);
    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    fNorm.crossVectors(e1, e2);
    safeNormalize(fNorm, 0, 1, 0);

    pushRimVert(at, ay, az, fNorm.x, fNorm.y, fNorm.z, a);
    pushRimVert(bt, by, bz, fNorm.x, fNorm.y, fNorm.z, b);
    pushRimVert(-bt, by, bz, fNorm.x, fNorm.y, fNorm.z, b);

    pushRimVert(at, ay, az, fNorm.x, fNorm.y, fNorm.z, a);
    pushRimVert(-bt, by, bz, fNorm.x, fNorm.y, fNorm.z, b);
    pushRimVert(-at, ay, az, fNorm.x, fNorm.y, fNorm.z, a);
  }

  const rimGeom = new THREE.BufferGeometry();
  rimGeom.setAttribute('position', new THREE.Float32BufferAttribute(rimPos, 3));
  rimGeom.setAttribute('normal', new THREE.Float32BufferAttribute(rimNorm, 3));
  rimGeom.setAttribute('color', new THREE.Float32BufferAttribute(rimCol, 3));
  rimGeom.setAttribute('aFinAnim', new THREE.Float32BufferAttribute(rimFa, 4));

  return safeMerge([plusSheet, minusSheet, rimGeom]);
}

/**
 * Helper to construct a closed, two-sided subdivided airfoil fin from an (spanSegs+1) x (chordSegs+1)
 * center-surface grid and matching aFinAnim grid.
 */
function buildGridAirfoilFin(gridPoints, finAnimGrid, spanSegs, chordSegs, thickness, colorFn) {
  const safeColorFn = resolveColorFn(colorFn);
  const cols = chordSegs + 1;
  const rows = spanSegs + 1;
  const count = rows * cols;

  // Compute surface normal at each grid point via central finite differences (dU x dV)
  const normals = new Array(count);
  const dU = new THREE.Vector3();
  const dV = new THREE.Vector3();

  for (let iu = 0; iu <= spanSegs; iu++) {
    const iu0 = Math.max(0, iu - 1);
    const iu1 = Math.min(spanSegs, iu + 1);
    for (let iv = 0; iv <= chordSegs; iv++) {
      const iv0 = Math.max(0, iv - 1);
      const iv1 = Math.min(chordSegs, iv + 1);
      dU.subVectors(gridPoints[iu1 * cols + iv], gridPoints[iu0 * cols + iv]);
      dV.subVectors(gridPoints[iu * cols + iv1], gridPoints[iu * cols + iv0]);
      const n = new THREE.Vector3().crossVectors(dU, dV);
      safeNormalize(n, 0, 1, 0);
      normals[iu * cols + iv] = n;
    }
  }

  function buildFace(signN) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const fa = new Float32Array(count * 4);
    const tmp = new THREE.Color();

    for (let iu = 0; iu <= spanSegs; iu++) {
      for (let iv = 0; iv <= chordSegs; iv++) {
        const idx = iu * cols + iv;
        const p = gridPoints[idx];
        const n = normals[idx];
        const anim = finAnimGrid[idx];
        const span01 = anim[1];
        const chord01 = anim[3];
        const chordTaper = 0.35 + 0.65 * Math.sin(chord01 * Math.PI);
        const halfT = 0.5 * thickness * (1.0 - 0.78 * Math.pow(span01, 0.9)) * chordTaper;

        const x = p.x + signN * n.x * halfT;
        const y = p.y + signN * n.y * halfT;
        const z = p.z + signN * n.z * halfT;
        pos[idx * 3] = x;
        pos[idx * 3 + 1] = y;
        pos[idx * 3 + 2] = z;

        safeColorFn(x, y, z, tmp);
        col[idx * 3] = tmp.r;
        col[idx * 3 + 1] = tmp.g;
        col[idx * 3 + 2] = tmp.b;

        fa[idx * 4] = anim[0];
        fa[idx * 4 + 1] = anim[1];
        fa[idx * 4 + 2] = anim[2];
        fa[idx * 4 + 3] = anim[3];
      }
    }

    const indices = [];
    for (let iu = 0; iu < spanSegs; iu++) {
      for (let iv = 0; iv < chordSegs; iv++) {
        const a = iu * cols + iv;
        const b = (iu + 1) * cols + iv;
        const c = (iu + 1) * cols + (iv + 1);
        const d = iu * cols + (iv + 1);
        if (signN > 0) indices.push(a, b, c, a, c, d);
        else indices.push(a, c, b, a, d, c);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aFinAnim', new THREE.BufferAttribute(fa, 4));
    g.setIndex(indices);
    g.computeVertexNormals();
    const nonIdx = g.toNonIndexed();
    g.dispose();
    return nonIdx;
  }

  const plusFace = buildFace(1);
  const minusFace = buildFace(-1);

  // Perimeter rim closing outer edges cleanly
  const rimPos = [];
  const rimNorm = [];
  const rimCol = [];
  const rimFa = [];
  const tmpColor = new THREE.Color();
  const p0Plus = new THREE.Vector3();
  const p0Minus = new THREE.Vector3();
  const p1Plus = new THREE.Vector3();
  const p1Minus = new THREE.Vector3();
  const eA = new THREE.Vector3();
  const eB = new THREE.Vector3();
  const rNorm = new THREE.Vector3();

  function getHalfT(idx) {
    const anim = finAnimGrid[idx];
    const chordTaper = 0.35 + 0.65 * Math.sin(anim[3] * Math.PI);
    return 0.5 * thickness * (1.0 - 0.78 * Math.pow(anim[1], 0.9)) * chordTaper;
  }

  function pushRimVert(v, norm, idx) {
    rimPos.push(v.x, v.y, v.z);
    rimNorm.push(norm.x, norm.y, norm.z);
    safeColorFn(v.x, v.y, v.z, tmpColor);
    rimCol.push(tmpColor.r, tmpColor.g, tmpColor.b);
    const anim = finAnimGrid[idx];
    rimFa.push(anim[0], anim[1], anim[2], anim[3]);
  }

  function addRimQuad(i0, i1) {
    const ht0 = getHalfT(i0);
    const ht1 = getHalfT(i1);
    p0Plus.copy(gridPoints[i0]).addScaledVector(normals[i0], ht0);
    p0Minus.copy(gridPoints[i0]).addScaledVector(normals[i0], -ht0);
    p1Plus.copy(gridPoints[i1]).addScaledVector(normals[i1], ht1);
    p1Minus.copy(gridPoints[i1]).addScaledVector(normals[i1], -ht1);

    eA.subVectors(p0Minus, p0Plus);
    eB.subVectors(p1Minus, p0Plus);
    rNorm.crossVectors(eA, eB);
    safeNormalize(rNorm, 0, 1, 0);

    pushRimVert(p0Plus, rNorm, i0);
    pushRimVert(p0Minus, rNorm, i0);
    pushRimVert(p1Minus, rNorm, i1);

    pushRimVert(p0Plus, rNorm, i0);
    pushRimVert(p1Minus, rNorm, i1);
    pushRimVert(p1Plus, rNorm, i1);
  }

  for (let iv = 0; iv < chordSegs; iv++) {
    addRimQuad(spanSegs * cols + iv, spanSegs * cols + iv + 1); // distal tip edge
    addRimQuad(iv + 1, iv); // root edge
  }
  for (let iu = 0; iu < spanSegs; iu++) {
    addRimQuad(iu * cols, (iu + 1) * cols); // leading edge
    addRimQuad((iu + 1) * cols + chordSegs, iu * cols + chordSegs); // trailing edge
  }

  const rimGeom = new THREE.BufferGeometry();
  rimGeom.setAttribute('position', new THREE.Float32BufferAttribute(rimPos, 3));
  rimGeom.setAttribute('normal', new THREE.Float32BufferAttribute(rimNorm, 3));
  rimGeom.setAttribute('color', new THREE.Float32BufferAttribute(rimCol, 3));
  rimGeom.setAttribute('aFinAnim', new THREE.Float32BufferAttribute(rimFa, 4));

  return safeMerge([plusFace, minusFace, rimGeom]);
}

/**
 * Builds left (PART_PECTORAL_LEFT) and right (PART_PECTORAL_RIGHT) subdivided curved pectoral fins.
 * Silhouette shapes: 'fan' | 'falcate' | 'paddle'.
 */
export function buildPairedPectoralFins({
  zPos,
  yPos,
  xOffset,
  span,
  chord,
  sweep = -0.35,
  dihedral = -0.16,
  flare = 0.85,
  thickness = 0.0024,
  bodyLength = 0.25,
  tailPivotZ = 0.115,
  shape = 'fan',
  colorFn,
}) {
  const spanSegs = 6;
  const chordSegs = 5;
  const cols = chordSegs + 1;
  const uAttach = computeUAttach(zPos, bodyLength, tailPivotZ);
  const parts = [];

  for (const side of [PART_PECTORAL_LEFT, PART_PECTORAL_RIGHT]) {
    const gridPoints = new Array((spanSegs + 1) * cols);
    const finAnimGrid = new Array((spanSegs + 1) * cols);

    for (let iu = 0; iu <= spanSegs; iu++) {
      const u = iu / spanSegs; // span01
      for (let iv = 0; iv <= chordSegs; iv++) {
        const v = iv / chordSegs; // chord01 (0 = leading, 1 = trailing)
        const vCentered = 0.5 - v;

        let localChord;
        let spanScale;
        if (shape === 'falcate') {
          localChord = chord * (0.48 * (1 - u) + 0.62 * Math.sin(u * Math.PI) * (1 - 0.55 * u));
          spanScale = 1.0 - 0.52 * Math.pow(v, 1.35);
        } else if (shape === 'paddle') {
          localChord = chord * (0.50 + 0.60 * Math.pow(Math.sin(u * Math.PI * 0.85), 0.75));
          spanScale = 0.85 + 0.15 * Math.sin(v * Math.PI);
        } else {
          // 'fan'
          localChord = chord * (0.45 + 0.65 * Math.sin(Math.pow(u, 0.65) * Math.PI * 0.88));
          spanScale = 0.78 + 0.22 * Math.sin(v * Math.PI);
        }

        const uEff = u * spanScale;
        const x = side * (xOffset - 0.001 + uEff * span * flare + Math.sin(u * Math.PI) * span * 0.04);
        const y = yPos + uEff * span * dihedral + vCentered * localChord * 0.50;
        const z = zPos + uEff * span * sweep + vCentered * localChord * 0.86;

        const idx = iu * cols + iv;
        gridPoints[idx] = new THREE.Vector3(x, y, z);
        finAnimGrid[idx] = [side, u, uAttach, v];
      }
    }

    parts.push(buildGridAirfoilFin(gridPoints, finAnimGrid, spanSegs, chordSegs, thickness, colorFn));
  }

  return safeMerge(parts);
}

/**
 * Builds left and right subdivided pelvic fins (PART_MEDIAN_FIN).
 */
export function buildPairedPelvicFins({
  zPos,
  yPos,
  xOffset,
  length,
  width,
  splay = 0.34,
  dip = -0.45,
  thickness = 0.0022,
  bodyLength = 0.25,
  tailPivotZ = 0.115,
  colorFn,
}) {
  const spanSegs = 4;
  const chordSegs = 3;
  const cols = chordSegs + 1;
  const uAttach = computeUAttach(zPos, bodyLength, tailPivotZ);
  const parts = [];

  for (const side of [-1, 1]) {
    const gridPoints = new Array((spanSegs + 1) * cols);
    const finAnimGrid = new Array((spanSegs + 1) * cols);

    for (let iu = 0; iu <= spanSegs; iu++) {
      const u = iu / spanSegs; // span01
      const localWidth = width * (0.42 + 0.68 * Math.sin(u * Math.PI * 0.85)) * (1.0 - 0.55 * u * u);
      for (let iv = 0; iv <= chordSegs; iv++) {
        const v = iv / chordSegs; // chord01 (0 = anterior, 1 = trailing)
        const vCentered = 0.5 - v;

        const x = side * (xOffset + u * length * splay + (v - 0.5) * localWidth * 0.45);
        const y = yPos + 0.001 + u * length * dip;
        const z = zPos - u * length * 0.92 + vCentered * localWidth * 0.55;

        const idx = iu * cols + iv;
        gridPoints[idx] = new THREE.Vector3(x, y, z);
        finAnimGrid[idx] = [PART_MEDIAN_FIN, u, uAttach, v];
      }
    }

    parts.push(buildGridAirfoilFin(gridPoints, finAnimGrid, spanSegs, chordSegs, thickness, colorFn));
  }

  return safeMerge(parts);
}

/**
 * Adds two-layer eyes (flattened metallic iris ellipsoid + proud glossy dark pupil sphere).
 * Backward-compatible with existing 5-6 arg calls.
 */
export function addFishEyes(parts, zPos, yPos, xOffset, eyeRadius = 0.0065, irisHex = '#e6c35c', opts = {}) {
  const cIris = new THREE.Color(irisHex);
  const cPupil = new THREE.Color('#07090d');
  const bodyLength = opts.bodyLength ?? Math.max(0.15, Math.abs(zPos) * 2.7);
  const tailPivotZ = opts.tailPivotZ ?? bodyLength * 0.46;
  const uAttach = opts.uAttach ?? computeUAttach(zPos, bodyLength, tailPivotZ);
  const eyeTagY = opts.eyeTagY ?? 0;
  const finAnim = [PART_BODY, eyeTagY, uAttach, 0];

  const irisSegU = opts.irisSegsU ?? 8;
  const irisSegV = opts.irisSegsV ?? 6;
  const pupilSegU = opts.pupilSegsU ?? 6;
  const pupilSegV = opts.pupilSegsV ?? 5;

  for (const side of [-1, 1]) {
    const iris = new THREE.SphereGeometry(eyeRadius, irisSegU, irisSegV);
    iris.scale(0.55, 1.0, 1.0);
    iris.translate(side * xOffset, yPos, zPos);
    parts.push(prepareFishPart(iris, cIris, finAnim));
    iris.dispose();

    const pupil = new THREE.SphereGeometry(eyeRadius * 0.58, pupilSegU, pupilSegV);
    pupil.scale(0.62, 1.0, 1.0);
    pupil.translate(side * (xOffset + eyeRadius * 0.30), yPos, zPos + eyeRadius * 0.08);
    parts.push(prepareFishPart(pupil, cPupil, finAnim));
    pupil.dispose();

    const cGlint = new THREE.Color('#eef7ff');
    const glint = new THREE.SphereGeometry(eyeRadius * 0.22, 4, 4);
    glint.scale(0.55, 1.0, 1.0);
    glint.translate(side * (xOffset + eyeRadius * 0.45), yPos + eyeRadius * 0.24, zPos + eyeRadius * 0.20);
    parts.push(prepareFishPart(glint, cGlint, finAnim));
    glint.dispose();
  }
}

/**
 * Creates a MeshStandardMaterial with GPU vertex-animated fish body, caudal, pectoral,
 * and median fin deformation, chained cleanly into underwater optics.
 */
export function createAnimatedFishMaterial(
  applyUnderwaterMaterial,
  materialOpts = {},
  opticsOpts = { receiveCaustics: true, causticsStrength: 0.80 }
) {
  const {
    cacheKey = 'fish_anim_v2',
    customCommonFragment = '',
    customColorFragment = '',
    ...stdMatOpts
  } = materialOpts;

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.29,
    metalness: 0.14,
    ...stdMatOpts,
  });

  material.customProgramCacheKey = () => cacheKey;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
attribute vec4 aFinAnim;
attribute vec3 aSwimState;
varying vec4 vFishFinAnim;
varying vec3 vFishLocalPos;
vec3 evalFishDeform(vec3 p, vec4 fa, vec3 sw) {
  float partCode = fa.x;
  float span01 = fa.y;
  float uAttach = fa.z;
  float chord01 = fa.w;
  float phase = sw.x;
  float bodyAmp = sw.y;
  float finAmp = sw.z;
  vec3 disp = vec3(0.0);
  if (partCode > 2.5) {
    // Caudal tail blade whip relative to peduncle hinge (span01 = 0 at z=0 -> 1 at tip),
    // matched seamlessly in root slope and posterior amplitude to the body peduncle S-wave
    float spanCurve = 0.52 * span01 + 0.78 * pow(span01, 1.35);
    float whip = -sin(phase - 1.20 * span01) * bodyAmp * spanCurve;
    float cup = sin(phase * 2.0 - 0.8) * finAmp * 0.16 * span01 * (chord01 * 2.0 - 1.0);
    disp.x += whip + cup;
  } else {
    // Smooth body S-wave anchored strictly at 0 at peduncle hinge (u=0) and snout (u=1)
    float u = clamp(uAttach, 0.0, 1.0);
    float flex = sin(u * 3.14159265) * (1.0 - 0.34 * u);
    disp.x += sin(phase + u * 2.8) * bodyAmp * flex;
    if (abs(abs(partCode) - 1.0) < 0.25) {
      // Labriform 3D figure-8 pectoral rowing
      float side = sign(partCode);
      float localPhase = phase + 0.45 * side;
      float scull = sin(localPhase - chord01 * 0.9);
      float lift = cos(localPhase - chord01 * 0.7);
      float w = pow(span01, 1.15);
      disp.z += scull * finAmp * w * 0.72;
      disp.y += lift * finAmp * span01 * w * 0.52;
      disp.x += side * (0.28 + 0.25 * scull) * finAmp * w;
    } else if (abs(partCode - 2.0) < 0.25) {
      // Median (dorsal/anal/pelvic) trailing fin-ray wave
      float wave = sin(phase * 1.15 - chord01 * 2.6 - span01 * 1.4);
      disp.x += wave * finAmp * pow(span01, 1.35) * 0.68;
    }
  }
  return p + disp;
}
`
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
vec3 objectNormal = vec3( normal );
{
  vec3 p0 = evalFishDeform(vec3(position), aFinAnim, aSwimState);
  float eps = 0.02;
  float gradZ = 0.0;
  float gradSpanX = 0.0;
  if (aFinAnim.x > 2.5) {
    float s1 = clamp(aFinAnim.y + eps, 0.0, 1.0);
    float s0 = clamp(aFinAnim.y - eps, 0.0, 1.0);
    vec3 pS1 = evalFishDeform(vec3(position), vec4(aFinAnim.x, s1, aFinAnim.z, aFinAnim.w), aSwimState);
    vec3 pS0 = evalFishDeform(vec3(position), vec4(aFinAnim.x, s0, aFinAnim.z, aFinAnim.w), aSwimState);
    float ds = max(1e-4, s1 - s0);
    float tailLen = max(0.04, -position.z / max(0.08, aFinAnim.y));
    gradZ = -(pS1.x - pS0.x) / (ds * tailLen);
  } else if (abs(aFinAnim.x) < 0.5) {
    float u1 = clamp(aFinAnim.z + eps, 0.0, 1.0);
    float u0 = clamp(aFinAnim.z - eps, 0.0, 1.0);
    vec3 pU1 = evalFishDeform(vec3(position), vec4(aFinAnim.x, aFinAnim.y, u1, aFinAnim.w), aSwimState);
    vec3 pU0 = evalFishDeform(vec3(position), vec4(aFinAnim.x, aFinAnim.y, u0, aFinAnim.w), aSwimState);
    float du = max(1e-4, u1 - u0);
    float bodyLenEst = max(0.16, abs(position.z) * 1.6 + 0.14);
    gradZ = (pU1.x - pU0.x) / (du * bodyLenEst);
  } else if (abs(abs(aFinAnim.x) - 1.0) < 0.25) {
    float s1 = clamp(aFinAnim.y + eps, 0.0, 1.0);
    vec3 pS1 = evalFishDeform(vec3(position), vec4(aFinAnim.x, s1, aFinAnim.z, aFinAnim.w), aSwimState);
    float ds = max(1e-4, s1 - aFinAnim.y);
    gradSpanX = clamp((pS1.y - p0.y) / (ds * 0.08), -0.65, 0.65);
  } else {
    float c1 = clamp(aFinAnim.w + eps, 0.0, 1.0);
    float c0 = clamp(aFinAnim.w - eps, 0.0, 1.0);
    vec3 pC1 = evalFishDeform(vec3(position), vec4(aFinAnim.x, aFinAnim.y, aFinAnim.z, c1), aSwimState);
    vec3 pC0 = evalFishDeform(vec3(position), vec4(aFinAnim.x, aFinAnim.y, aFinAnim.z, c0), aSwimState);
    float dc = max(1e-4, c1 - c0);
    gradZ = -(pC1.x - pC0.x) / (dc * 0.12);
  }
  gradZ = clamp(gradZ, -0.75, 0.75);
  objectNormal.z -= gradZ * objectNormal.x;
  objectNormal.x -= sign(aFinAnim.x) * gradSpanX * objectNormal.y;
  objectNormal = normalize(objectNormal);
}
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
vec3 transformed = evalFishDeform(vec3(position), aFinAnim, aSwimState);
vFishFinAnim = aFinAnim;
vFishLocalPos = position;
`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
varying vec4 vFishFinAnim;
varying vec3 vFishLocalPos;
${customCommonFragment}
`
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
#include <color_fragment>
${customColorFragment}
{
  float fishDistFade = 1.0 - smoothstep(2.2, 8.0, length(vViewPosition));
  if (abs(vFishFinAnim.x) > 0.5) {
    // Delicate radial lepidotrichia fin-ray striations on caudal, median & pectoral membranes
    float rayFreq = vFishFinAnim.x > 2.5 ? 36.0 : 26.0;
    float rayWave = sin(vFishFinAnim.w * rayFreq + vFishFinAnim.y * 4.5);
    float rayRidge = smoothstep(-0.35, 0.72, rayWave);
    float memEdge = smoothstep(0.65, 1.0, vFishFinAnim.y);
    diffuseColor.rgb *= mix(0.92, 1.08, rayRidge * (0.45 + 0.55 * fishDistFade));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12, memEdge * 0.25);
  } else if (fishDistFade > 0.01) {
    // Close-range diamond/rhomboid teleost scale shimmer along lateral flanks
    float sU = (vFishLocalPos.z * 26.0 + vFishLocalPos.y * 22.0) * 3.14159265;
    float sV = (vFishLocalPos.z * 26.0 - vFishLocalPos.y * 22.0) * 3.14159265;
    float scaleCell = sin(sU) * sin(sV);
    float scaleRim = smoothstep(0.0, 0.75, scaleCell);
    diffuseColor.rgb *= 1.0 + (scaleRim - 0.35) * 0.11 * fishDistFade;
  }
}
`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
#include <roughnessmap_fragment>
{
  if (abs(vFishFinAnim.x) > 0.5) {
    roughnessFactor = clamp(roughnessFactor + 0.14 * smoothstep(0.25, 0.95, vFishFinAnim.y), 0.12, 0.85);
  }
}
`
      );
  };

  if (typeof applyUnderwaterMaterial === 'function') {
    applyUnderwaterMaterial(material, opticsOpts);
  }
  return material;
}

/**
 * Allocates and attaches a shared DynamicDrawUsage InstancedBufferAttribute('aSwimState', 3)
 * to both bodyMesh and tailMesh geometries.
 */
export function attachSwimStateAttribute(bodyMesh, tailMesh, maxCount) {
  const buf = new Float32Array(maxCount * 3);
  const attr = new THREE.InstancedBufferAttribute(buf, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  if (bodyMesh?.geometry) {
    bodyMesh.geometry.setAttribute('aSwimState', attr);
  }
  if (tailMesh?.geometry) {
    tailMesh.geometry.setAttribute('aSwimState', attr);
  }
  enableShadows(bodyMesh, true, true);
  enableShadows(tailMesh, true, true);
  return attr;
}

/**
 * Writes per-instance (phase, bodyAmp, finAmp) into the aSwimState buffer.
 * Caller marks `attr.needsUpdate = true` once per species batch.
 */
export function setSwimState(attr, index, phase, bodyAmp, finAmp) {
  const offset = index * 3;
  attr.array[offset] = phase;
  attr.array[offset + 1] = bodyAmp;
  attr.array[offset + 2] = finAmp;
}

export function orientFishMatrix(
  pos,
  forward,
  scale,
  bodyYaw,
  tailYaw,
  pitchOffset,
  tailPivotZ,
  scratch,
  rollOffset = 0
) {
  const { worldUp, vForward, vRight, vUp, vTailPos, vScale, mRot, mYaw, mPitch, mRoll, mComposed, qBody, qTail } = scratch;
  const bodyMatrix = scratch.bodyMatrix || (scratch.bodyMatrix = new THREE.Matrix4());
  const tailMatrix = scratch.tailMatrix || (scratch.tailMatrix = new THREE.Matrix4());
  const result = scratch.result || (scratch.result = { bodyMatrix, tailMatrix });

  vForward.copy(forward);
  safeNormalize(vForward, 0, 0, 1);
  vRight.crossVectors(worldUp, vForward);
  safeNormalize(vRight, 1, 0, 0);
  vUp.crossVectors(vForward, vRight);
  safeNormalize(vUp, 0, 1, 0);

  mRot.makeBasis(vRight, vUp, vForward);
  if (Math.abs(pitchOffset) > 1e-4) {
    mPitch.makeRotationX(pitchOffset);
    mRot.multiply(mPitch);
  }
  if (Math.abs(rollOffset) > 1e-4) {
    const rollMat = mRoll || (scratch.mRoll = new THREE.Matrix4());
    rollMat.makeRotationZ(rollOffset);
    mRot.multiply(rollMat);
  }

  mYaw.makeRotationY(bodyYaw);
  mComposed.copy(mRot).multiply(mYaw);
  qBody.setFromRotationMatrix(mComposed);
  vScale.setScalar(scale);
  bodyMatrix.compose(pos, qBody, vScale);

  vTailPos.set(0, 0, -tailPivotZ * scale).applyQuaternion(qBody).add(pos);
  mYaw.makeRotationY(tailYaw);
  mComposed.copy(mRot).multiply(mYaw);
  qTail.setFromRotationMatrix(mComposed);
  tailMatrix.compose(vTailPos, qTail, vScale);

  result.bodyMatrix = bodyMatrix;
  result.tailMatrix = tailMatrix;
  return result;
}

export function createMatrixScratch() {
  const bodyMatrix = new THREE.Matrix4();
  const tailMatrix = new THREE.Matrix4();
  return {
    worldUp: new THREE.Vector3(0, 1, 0),
    vForward: new THREE.Vector3(),
    vRight: new THREE.Vector3(),
    vUp: new THREE.Vector3(),
    vTailPos: new THREE.Vector3(),
    vScale: new THREE.Vector3(),
    mRot: new THREE.Matrix4(),
    mYaw: new THREE.Matrix4(),
    mPitch: new THREE.Matrix4(),
    mRoll: new THREE.Matrix4(),
    mComposed: new THREE.Matrix4(),
    qBody: new THREE.Quaternion(),
    qTail: new THREE.Quaternion(),
    bodyMatrix,
    tailMatrix,
    result: { bodyMatrix, tailMatrix },
  };
}
