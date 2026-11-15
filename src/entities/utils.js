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
 * Ensures every vertex Y is <= maxY (default 2.55m) using a C2-smooth soft-knee
 * curve so static rock or coral never forms flat artificial plateaus or breaks
 * the water surface at minimum diveDepth (1.0m -> uSurfaceY = 3.8).
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
    const kneeSpan = 0.52;
    const startY = safeMaxY - kneeSpan;
    const norm = geometry.attributes.normal;

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > startY) {
        const u = (y - startY) / kneeSpan;
        const th = Math.tanh(u);
        const compressedY = startY + kneeSpan * th;
        pos.setY(i, compressedY);
        if (norm) {
          // Derivative of y'(y) is sech^2(u) = 1 - tanh^2(u); normal scales by (nx, ny / y'(y), nz)
          const dydy = Math.max(0.14, 1 - th * th);
          const nx = norm.getX(i);
          const ny = norm.getY(i) / dydy;
          const nz = norm.getZ(i);
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

/**
 * Spatial XZ disc registry per ecological layer to prevent overlapping benthic
 * and canopy placements.
 */
export function createPlacementRegistry() {
  const items = [];

  function layersOverlap(reqLayer, itemLayer) {
    if (reqLayer === 'all' || reqLayer === '*' || itemLayer === 'all' || itemLayer === '*') {
      return true;
    }
    if (Array.isArray(reqLayer)) {
      return reqLayer.includes(itemLayer);
    }
    return reqLayer === itemLayer;
  }

  function isFree(x, z, radius = 0, layer = 'canopy') {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius)) {
      return false;
    }
    const r = Math.max(0, radius);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!layersOverlap(layer, it.layer)) continue;
      const minSep = r + it.radius;
      const dx = x - it.x;
      const dz = z - it.z;
      if (dx * dx + dz * dz < minSep * minSep) {
        return false;
      }
    }
    return true;
  }

  function add(x, z, radius = 0, layer = 'canopy') {
    const entry = {
      x,
      z,
      radius: Math.max(0, radius),
      layer,
    };
    items.push(entry);
    return entry;
  }

  return {
    add,
    isFree,
    items,
  };
}

const _sdfGradScratch = new THREE.Vector3(1, 0, 0);

/**
 * Smoothly steers a 3D swimming heading vector toward velocity while preventing
 * vertical "lawn-dart" pitch flips when horizontal speed nears zero during hovering,
 * flow station-keeping, or sand foraging. Zero allocations.
 */
export function steerSwimmerHeading(
  heading,
  vx,
  vy,
  vz,
  lerpAlpha,
  maxAbsY = 0.40,
  fallbackX = 1,
  fallbackZ = 0
) {
  if (!heading) return heading;
  const hx = Number.isFinite(heading.x) ? heading.x : fallbackX;
  const hz = Number.isFinite(heading.z) ? heading.z : fallbackZ;
  const hHoriz = Math.hypot(hx, hz);
  const safeFbX = hHoriz > 1e-4 ? hx / hHoriz : fallbackX;
  const safeFbZ = hHoriz > 1e-4 ? hz / hHoriz : fallbackZ;

  const sVx = Number.isFinite(vx) ? vx : 0;
  const sVy = Number.isFinite(vy) ? vy : 0;
  const sVz = Number.isFinite(vz) ? vz : 0;
  const horiz = Math.hypot(sVx, sVz);

  let tx;
  let ty;
  let tz;
  if (horiz < 0.032) {
    tx = safeFbX;
    tz = safeFbZ;
    const minBandY = Math.min(0.14, maxAbsY * 0.45);
    ty = THREE.MathUtils.clamp(sVy * 0.35, -minBandY, minBandY);
  } else {
    const clampedAbsMax = THREE.MathUtils.clamp(maxAbsY, 0.05, 0.85);
    const maxTan = clampedAbsMax / Math.sqrt(Math.max(0.04, 1 - clampedAbsMax * clampedAbsMax));
    const clampedVy = THREE.MathUtils.clamp(sVy, -horiz * maxTan, horiz * maxTan);
    const invLen = 1 / Math.hypot(sVx, clampedVy, sVz);
    tx = sVx * invLen;
    ty = clampedVy * invLen;
    tz = sVz * invLen;
  }

  const alpha = THREE.MathUtils.clamp(lerpAlpha, 0, 1);
  heading.x += (tx - heading.x) * alpha;
  heading.y += (ty - heading.y) * alpha;
  heading.z += (tz - heading.z) * alpha;
  heading.y = THREE.MathUtils.clamp(heading.y, -maxAbsY, maxAbsY);

  const fHoriz = Math.hypot(heading.x, heading.z);
  if (fHoriz < 1e-4) {
    heading.x = safeFbX * Math.sqrt(Math.max(0, 1 - heading.y * heading.y));
    heading.z = safeFbZ * Math.sqrt(Math.max(0, 1 - heading.y * heading.y));
  }
  return safeNormalize(heading, safeFbX, 0, safeFbZ);
}

/**
 * Allocation-free 3D rock avoidance using the baked 3D SDF collider when present
 * (falling back to cylindrical bommy hulls). Deflects pos and adds smooth tangential
 * sliding so swimmers never clip overhangs or get pinned against curved rock faces.
 */
export function avoidBommiesXZ(pos, vel, bommies = [], margin = 0.25, dt = 0.016, tangentSign = 1) {
  if (!pos || !bommies) return false;

  const collider = bommies.rockCollider;
  if (collider) {
    const sd = collider.sampleHorizontalSDF(pos.x, pos.y, pos.z, _sdfGradScratch);
    if (sd < margin) {
      const gx = _sdfGradScratch.x;
      const gz = _sdfGradScratch.z;
      const pen = margin - sd;
      pos.x += gx * pen;
      pos.z += gz * pen;

      if (vel) {
        const vn = vel.x * gx + vel.z * gz;
        if (vn < 0) {
          vel.x -= vn * gx;
          vel.z -= vn * gz;
        }
        const tx = -gz * tangentSign;
        const tz = gx * tangentSign;
        const vt = vel.x * tx + vel.z * tz;
        if (Math.abs(vt) < 0.16 && (vn < -0.02 || pen > 0.02)) {
          const slide = 0.22;
          vel.x += tx * slide;
          vel.z += tz * slide;
        }
        if (!Number.isFinite(vel.x)) vel.x = 0;
        if (!Number.isFinite(vel.z)) vel.z = 0;
      }
      return true;
    }
    return false;
  }

  if (bommies.length === 0) return false;
  let deflected = false;

  for (let i = 0; i < bommies.length; i++) {
    const b = bommies[i];
    if (!b) continue;

    const bx = Number.isFinite(b.x) ? b.x : (b.position ? b.position.x : 0);
    const bz = Number.isFinite(b.z) ? b.z : (b.position ? b.position.z : 0);
    const baseR = Number.isFinite(b.boundingRadius)
      ? Math.max(b.radius || 0, b.boundingRadius * 0.90)
      : (Number.isFinite(b.radius)
        ? b.radius
        : (Number.isFinite(b.r) ? b.r : 1.5));
    const r = baseR + margin;
    const topY = Number.isFinite(b.topY)
      ? b.topY
      : ((Number.isFinite(b.baseY) ? b.baseY : 0) + (Number.isFinite(b.height) ? b.height : 3.0));

    if (pos.y >= topY + margin) continue;

    const dx = pos.x - bx;
    const dz = pos.z - bz;
    const distSq = dx * dx + dz * dz;
    if (distSq >= r * r) continue;

    let nx = 1;
    let nz = 0;
    if (distSq > 1e-10) {
      const invDist = 1 / Math.sqrt(distSq);
      nx = dx * invDist;
      nz = dz * invDist;
    } else if (vel && (vel.x * vel.x + vel.z * vel.z) > 1e-10) {
      const invV = 1 / Math.hypot(vel.x, vel.z);
      nx = -vel.x * invV;
      nz = -vel.z * invV;
    }

    pos.x = bx + nx * r;
    pos.z = bz + nz * r;

    if (vel) {
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) {
        vel.x -= vn * nx;
        vel.z -= vn * nz;
        const tanSq = vel.x * vel.x + vel.z * vel.z;
        if (tanSq < 1e-6 && Math.abs(vn) > 1e-4) {
          const slide = Math.min(Math.abs(vn), 0.35);
          const sign = ((i & 1) === 0 ? 1 : -1) * tangentSign;
          vel.x += -nz * slide * sign;
          vel.z += nx * slide * sign;
        }
      }
      if (!Number.isFinite(vel.x)) vel.x = 0;
      if (!Number.isFinite(vel.z)) vel.z = 0;
    }

    deflected = true;
  }

  return deflected;
}

/**
 * Enforces both 3D rock clearance (horizontal SDF + overhead arch/overhang ceilings)
 * and local seabed/rock floor clearance. Zero allocations.
 */
export function resolveFloorAndCeiling(
  pos,
  vel,
  bommies,
  getSeabedHeightFn,
  getSubstrateHeightFn,
  bottomClear,
  topClear,
  surfaceLimitY,
  tangentSign = 1
) {
  if (!pos) return;
  const xzMargin = Math.max(0.16, bottomClear * 0.85);
  avoidBommiesXZ(pos, vel, bommies, xzMargin, 0.016, tangentSign);

  const collider = bommies?.rockCollider;
  const seabedY = getSeabedHeightFn ? getSeabedHeightFn(pos.x, pos.z) : -1.0;
  let floorY = collider
    ? collider.getFloorHeightAt(pos.x, pos.y, pos.z, 0.42)
    : Math.max(seabedY, getSubstrateHeightFn ? getSubstrateHeightFn(pos.x, pos.z) : seabedY);
  const rawCeilY = collider ? collider.getCeilingHeightAt(pos.x, pos.y, pos.z) : Infinity;

  let minY = Math.max(seabedY + bottomClear * 0.85, floorY + bottomClear);
  let maxY = Math.min(surfaceLimitY, rawCeilY - topClear);

  if (maxY < minY && collider) {
    avoidBommiesXZ(pos, vel, bommies, xzMargin + 0.30, 0.016, tangentSign);
    const seabedY2 = getSeabedHeightFn ? getSeabedHeightFn(pos.x, pos.z) : seabedY;
    floorY = collider.getFloorHeightAt(pos.x, pos.y, pos.z, 0.42);
    const rawCeil2 = collider.getCeilingHeightAt(pos.x, pos.y, pos.z);
    minY = Math.max(seabedY2 + bottomClear * 0.85, floorY + bottomClear);
    maxY = Math.min(surfaceLimitY, rawCeil2 - topClear);
  }

  const clampedMin = Math.min(minY, surfaceLimitY - 0.06);
  const clampedMax = Math.max(clampedMin, maxY);

  if (pos.y < clampedMin) {
    pos.y = clampedMin;
    if (vel && vel.y < 0) vel.y = 0;
  } else if (pos.y > clampedMax) {
    pos.y = clampedMax;
    if (vel && vel.y > 0) vel.y = 0;
  }
}

/**
 * Enables castShadow / receiveShadow across a mesh or object hierarchy.
 */
export function enableShadows(object3D, cast = true, receive = true) {
  if (!object3D) return object3D;
  const c = Boolean(cast);
  const r = Boolean(receive);
  if (typeof object3D.traverse === 'function') {
    object3D.traverse((child) => {
      if (child && child.isMesh) {
        child.castShadow = c;
        child.receiveShadow = r;
      }
    });
  } else if (object3D.isMesh) {
    object3D.castShadow = c;
    object3D.receiveShadow = r;
  }
  return object3D;
}
