import * as THREE from 'three';

/**
 * Zero-allocation 3D spatial-hash collider for inter-animal collision avoidance.
 * Covers [-19.2, 19.2] in XZ and [-2.4, 3.6] in Y with 0.80 m x 0.50 m x 0.80 m bins.
 */
export function createAnimalCollider(maxAgents = 1500) {
  const MIN_XZ = -19.2;
  const MAX_XZ = 19.2;
  const CELL_XZ = 0.80;
  const INV_CELL_XZ = 1.0 / CELL_XZ;
  const N_XZ = Math.round((MAX_XZ - MIN_XZ) / CELL_XZ); // 48

  const MIN_Y = -2.4;
  const MAX_Y = 3.6;
  const CELL_Y = 0.50;
  const INV_CELL_Y = 1.0 / CELL_Y;
  const N_Y = Math.round((MAX_Y - MIN_Y) / CELL_Y); // 12

  const STRIDE_Z = N_XZ;
  const STRIDE_Y = N_XZ * N_XZ;
  const GRID_CELLS = N_Y * STRIDE_Y; // 27,648

  const active = new Uint8Array(maxAgents);
  const posX = new Float32Array(maxAgents);
  const posY = new Float32Array(maxAgents);
  const posZ = new Float32Array(maxAgents);
  const radius = new Float32Array(maxAgents);
  const groupId = new Uint16Array(maxAgents);
  const shelterId = new Int32Array(maxAgents);
  const next = new Int32Array(maxAgents);
  const head = new Int32Array(GRID_CELLS);

  shelterId.fill(-1);
  next.fill(-1);
  head.fill(-1);

  let count = 0;

  function allocSlot(agentRadius = 0.12, agentGroupId = 0) {
    if (count >= maxAgents) return -1;
    const slot = count++;
    active[slot] = 1;
    posX[slot] = 0;
    posY[slot] = 0;
    posZ[slot] = 0;
    radius[slot] = Math.max(0.03, agentRadius);
    groupId[slot] = agentGroupId;
    shelterId[slot] = -1;
    return slot;
  }

  function setSlotActive(slot, isActive) {
    if (slot < 0 || slot >= count) return;
    active[slot] = isActive ? 1 : 0;
  }

  function updateSlot(slot, x, y, z, agentRadius = -1, hidingShelterId = -1, agentGroupId = -1) {
    if (slot < 0 || slot >= count) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    posX[slot] = x;
    posY[slot] = y;
    posZ[slot] = z;
    if (agentRadius > 0) radius[slot] = agentRadius;
    shelterId[slot] = hidingShelterId;
    if (agentGroupId >= 0) groupId[slot] = agentGroupId;
  }

  function rebuildGrid() {
    head.fill(-1);
    for (let i = 0; i < count; i++) {
      if (active[i] === 0) {
        next[i] = -1;
        continue;
      }
      const x = posX[i];
      const y = posY[i];
      const z = posZ[i];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        next[i] = -1;
        continue;
      }
      const cx = THREE.MathUtils.clamp(Math.floor((x - MIN_XZ) * INV_CELL_XZ), 0, N_XZ - 1);
      const cz = THREE.MathUtils.clamp(Math.floor((z - MIN_XZ) * INV_CELL_XZ), 0, N_XZ - 1);
      const cy = THREE.MathUtils.clamp(Math.floor((y - MIN_Y) * INV_CELL_Y), 0, N_Y - 1);
      const cell = cy * STRIDE_Y + cz * STRIDE_Z + cx;
      next[i] = head[cell];
      head[cell] = i;
    }
  }

  /**
   * Steers and separates `pos`/`vel` away from nearby active animals in zero-alloc mode.
   * Uses port-to-port tangential deflection for oncoming pairs so swimmers arc cleanly around each other.
   */
  function avoidOtherAnimals(
    slot,
    pos,
    vel = null,
    myRadius = 0.12,
    softness = 1.0,
    ignoreSlot = -1,
    hidingShelterId = -1,
    myGroupId = 0,
    dt = 0.016
  ) {
    if (!pos || slot < 0 || slot >= count || active[slot] === 0) return false;
    const sx = pos.x;
    const sy = pos.y;
    const sz = pos.z;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) return false;

    const effR = myRadius > 0 ? myRadius : radius[slot];
    const cx0 = THREE.MathUtils.clamp(Math.floor((sx - MIN_XZ) * INV_CELL_XZ), 0, N_XZ - 1);
    const cz0 = THREE.MathUtils.clamp(Math.floor((sz - MIN_XZ) * INV_CELL_XZ), 0, N_XZ - 1);
    const cy0 = THREE.MathUtils.clamp(Math.floor((sy - MIN_Y) * INV_CELL_Y), 0, N_Y - 1);

    const xMin = Math.max(0, cx0 - 1);
    const xMax = Math.min(N_XZ - 1, cx0 + 1);
    const zMin = Math.max(0, cz0 - 1);
    const zMax = Math.min(N_XZ - 1, cz0 + 1);
    const yMin = Math.max(0, cy0 - 1);
    const yMax = Math.min(N_Y - 1, cy0 + 1);

    let deflected = false;
    let pushX = 0;
    let pushY = 0;
    let pushZ = 0;
    let steerX = 0;
    let steerY = 0;
    let steerZ = 0;

    for (let cy = yMin; cy <= yMax; cy++) {
      const yBase = cy * STRIDE_Y;
      for (let cz = zMin; cz <= zMax; cz++) {
        const zBase = yBase + cz * STRIDE_Z;
        for (let cx = xMin; cx <= xMax; cx++) {
          let other = head[zBase + cx];
          while (other !== -1) {
            if (other !== slot && other !== ignoreSlot && active[other] !== 0) {
              // Hiding Coral School Exception: skip separation between conspecific shelter-mates inside coral branches
              if (
                hidingShelterId >= 0 &&
                shelterId[other] === hidingShelterId &&
                groupId[other] === myGroupId
              ) {
                other = next[other];
                continue;
              }

              const ox = posX[other];
              const oy = posY[other];
              const oz = posZ[other];
              const otherR = radius[other];
              const dx = sx - ox;
              const dy = sy - oy;
              const dz = sz - oz;

              const minSep = effR + otherR;
              const lookMargin = Math.min(0.55, 0.14 + minSep * 0.55);
              const avoidDist = minSep + lookMargin;
              const distSq = dx * dx + dy * dy + dz * dz;

              if (distSq < avoidDist * avoidDist) {
                let nx = 1;
                let ny = 0;
                let nz = 0;
                let dist = 0;
                if (distSq > 1e-8) {
                  dist = Math.sqrt(distSq);
                  const inv = 1.0 / dist;
                  nx = dx * inv;
                  ny = dy * inv;
                  nz = dz * inv;
                } else {
                  const ang = ((slot * 1.618 + other * 0.754) % 1) * Math.PI * 2;
                  nx = Math.cos(ang);
                  nz = Math.sin(ang);
                }

                // Soft tangential bypass steer when approaching inside lookahead shell
                if (vel) {
                  const vn = vel.x * nx + vel.y * ny + vel.z * nz;
                  if (vn < 0.04) {
                    const proximity = 1.0 - THREE.MathUtils.clamp(dist / avoidDist, 0, 1);
                    // Consistent CCW horizontal bypass (-nz, nx) produces opposite passing tracks for oncoming pairs
                    const hLen = Math.hypot(nx, nz);
                    const tx = hLen > 1e-4 ? -nz / hLen : 0;
                    const tz = hLen > 1e-4 ? nx / hLen : 1;
                    const approachWeight = (0.35 + Math.max(0, -vn) * 1.4) * proximity * softness;
                    steerX += (nx * 0.75 + tx * 0.95) * approachWeight;
                    steerY += ny * 0.45 * approachWeight;
                    steerZ += (nz * 0.75 + tz * 0.95) * approachWeight;
                  }
                }

                // Hard core separation (guarantee zero mesh-through-mesh overlaps)
                if (dist < minSep) {
                  const pen = minSep - dist;
                  const scale = Math.min(0.85, 0.62 * softness);
                  pushX += nx * pen * scale;
                  pushY += ny * pen * scale;
                  pushZ += nz * pen * scale;
                  if (vel) {
                    const vn = vel.x * nx + vel.y * ny + vel.z * nz;
                    if (vn < 0) {
                      const damp = THREE.MathUtils.clamp(softness, 0.4, 1.0);
                      vel.x -= vn * nx * damp;
                      vel.y -= vn * ny * damp;
                      vel.z -= vn * nz * damp;
                    }
                  }
                }
                deflected = true;
              }
            }
            other = next[other];
          }
        }
      }
    }

    if (deflected) {
      // Cap single-step position push to prevent supersonic tunneling pops
      const maxPush = Math.max(0.18, effR * 1.4);
      const pushLen = Math.hypot(pushX, pushY, pushZ);
      if (pushLen > maxPush) {
        const s = maxPush / pushLen;
        pushX *= s;
        pushY *= s;
        pushZ *= s;
      }
      pos.x += pushX;
      pos.y += pushY;
      pos.z += pushZ;

      if (vel) {
        const stepDt = Math.min(0.05, Math.max(0.005, dt));
        vel.x += steerX * stepDt * 3.2;
        vel.y += steerY * stepDt * 2.2;
        vel.z += steerZ * stepDt * 3.2;
        if (!Number.isFinite(vel.x)) vel.x = 0;
        if (!Number.isFinite(vel.y)) vel.y = 0;
        if (!Number.isFinite(vel.z)) vel.z = 0;
      }

      posX[slot] = pos.x;
      posY[slot] = pos.y;
      posZ[slot] = pos.z;
    }

    return deflected;
  }

  return {
    allocSlot,
    setSlotActive,
    updateSlot,
    rebuildGrid,
    avoidOtherAnimals,
    getSlotCount: () => count,
    getStateView: () => ({ active, posX, posY, posZ, radius, groupId, shelterId }),
  };
}
