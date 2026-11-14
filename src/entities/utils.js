import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const MAX_STATIC_Y = 2.55;

export function createRng(seed = 1337) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function safeNormalize(vec, fallbackX = 0, fallbackY = 0, fallbackZ = 1) {
  const lenSq = vec.lengthSq();
  if (lenSq > 1e-6 && Number.isFinite(lenSq)) {
    vec.divideScalar(Math.sqrt(lenSq));
    return vec;
  }
  vec.set(fallbackX, fallbackY, fallbackZ);
  return vec;
}

export function hash3D(x, y, z) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

export function smoothNoise3D(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const c000 = hash3D(ix, iy, iz);
  const c100 = hash3D(ix + 1, iy, iz);
  const c010 = hash3D(ix, iy + 1, iz);
  const c110 = hash3D(ix + 1, iy + 1, iz);
  const c001 = hash3D(ix, iy, iz + 1);
  const c101 = hash3D(ix + 1, iy, iz + 1);
  const c011 = hash3D(ix, iy + 1, iz + 1);
  const c111 = hash3D(ix + 1, iy + 1, iz + 1);

  const x00 = c000 + (c100 - c000) * ux;
  const x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux;
  const x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy;
  const y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

export function fbm3D(x, y, z, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1.0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise3D(x * freq, y * freq, z * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / norm;
}

/**
 * Normalizes geometry attributes (`position`, `normal`, `color` only, non-indexed)
 * so `mergeGeometries` never encounters mismatched attribute sets, computing smooth
 * vertex normals on indexed/welded topology before expanding to non-indexed.
 */
export function prepareForMerge(geometry, colorSource = null) {
  let working = geometry.clone();

  for (const attrName of Object.keys(working.attributes)) {
    if (attrName !== 'position' && attrName !== 'normal' && attrName !== 'color') {
      working.deleteAttribute(attrName);
    }
  }

  if (!working.attributes.normal) {
    const welded = mergeVertices(working, 1e-4);
    working.dispose();
    working = welded;
    working.computeVertexNormals();
  }

  let geom = working;
  if (working.index) {
    geom = working.toNonIndexed();
    working.dispose();
  }

  const pos = geom.attributes.position;
  const norm = geom.attributes.normal;
  const count = pos.count;

  if (typeof colorSource === 'function') {
    const colors = new Float32Array(count * 3);
    const tmpColor = new THREE.Color();
    for (let i = 0; i < count; i++) {
      colorSource(
        pos.getX(i),
        pos.getY(i),
        pos.getZ(i),
        norm.getX(i),
        norm.getY(i),
        norm.getZ(i),
        tmpColor
      );
      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  } else if (colorSource && colorSource.isColor) {
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = colorSource.r;
      colors[i * 3 + 1] = colorSource.g;
      colors[i * 3 + 2] = colorSource.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  } else if (!geom.attributes.color) {
    const colors = new Float32Array(count * 3);
    colors.fill(1.0);
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  } else if (geom.attributes.color.itemSize !== 3) {
    const src = geom.attributes.color;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = src.getX(i);
      colors[i * 3 + 1] = src.getY(i);
      colors[i * 3 + 2] = src.getZ(i);
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  return geom;
}

export function safeMerge(geometries) {
  const valid = geometries.filter((g) => g && g.attributes.position && g.attributes.position.count > 0);
  if (valid.length === 0) return null;
  const merged = mergeGeometries(valid, false);
  for (const g of valid) {
    g.dispose();
  }
  if (!merged) {
    throw new Error('mergeGeometries returned null — check attribute parity.');
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Ensures every vertex Y is <= maxY (default 2.55m) so static rock or coral
 * never breaks the water surface at minimum diveDepth (1.0m -> uSurfaceY = 3.8).
 */
export function clampGeometryTopY(geometry, maxY = MAX_STATIC_Y) {
  const safeMaxY = maxY - 0.005;
  const pos = geometry.attributes.position;
  let peakY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > peakY) peakY = y;
  }
  if (peakY > safeMaxY) {
    const excess = peakY - safeMaxY;
    const startY = safeMaxY - 0.35;
    const span = peakY - startY + 1e-5;
    const compressRatio = Math.min(1, excess / span);
    const norm = geometry.attributes.normal;

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > startY) {
        const t = Math.min(1, (y - startY) / span);
        pos.setY(i, y - excess * t);
        if (norm) {
          const blend = t * compressRatio * 0.75;
          const nx = norm.getX(i) * (1 - blend);
          const ny = norm.getY(i) * (1 - blend) + blend;
          const nz = norm.getZ(i) * (1 - blend);
          const lenSq = nx * nx + ny * ny + nz * nz;
          if (lenSq > 1e-8 && Number.isFinite(lenSq)) {
            const invLen = 1 / Math.sqrt(lenSq);
            norm.setXYZ(i, nx * invLen, ny * invLen, nz * invLen);
          } else {
            norm.setXYZ(i, 0, 1, 0);
          }
        }
      }
    }
    pos.needsUpdate = true;
    if (norm) {
      norm.needsUpdate = true;
    } else if (geometry.index) {
      geometry.computeVertexNormals();
    } else {
      const welded = mergeVertices(geometry, 1e-4);
      welded.computeVertexNormals();
      const smooth = welded.toNonIndexed();
      welded.dispose();
      geometry.setAttribute('normal', smooth.attributes.normal);
      smooth.dispose();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return geometry;
}

export function configureDynamicMesh(mesh, speciesId) {
  mesh.userData.speciesId = speciesId;
  mesh.frustumCulled = false;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 65);
  return mesh;
}
