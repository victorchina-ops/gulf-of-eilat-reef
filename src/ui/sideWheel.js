import { WORLD_CONSTANTS } from '../contracts.js';

function cardinalShort(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

/**
 * Dual Semi-Transparent Control Wheels (#side-control-wheel):
 * - Pod 1 (#look-wheel-pod): 360° View Angle wheel with rotating compass bezel,
 *   4 look hold/tap buttons, 2D spring-loaded look puck, angle readout, and flow badge.
 * - Pod 2 (#move-wheel-pod): Move / Swim wheel with FWD/BCK/L/R reticle,
 *   4 move/strafe hold/tap buttons, 2D spring-loaded swim puck, and live speed/coord readout.
 * - Right-side .side-strips-stack:
 *   - Pod 3 (#reef-depth-column): Dedicated Beer-Lambert Reef Depth strip (1m..40m).
 *   - Pod 4 (#vertical-move-column): Semi-transparent Swim Pos strip above seabed.
 */
export function createSideWheel({ root, cameraCtrl, envState, onEnvChange }) {
  const aside = document.createElement('aside');
  aside.id = 'side-control-wheel';
  aside.setAttribute('aria-label', 'Dual Semi-Transparent View & Swim Control Wheels');

  aside.innerHTML = `
    <div class="side-wheels-stack">
      <div class="wheel-pod" id="look-wheel-pod">
        <div class="side-col-label">View Angle</div>
        <div id="look-wheel" class="control-wheel-dial">
          <div class="wheel-bezel" id="look-wheel-bezel" aria-hidden="true">
            <span class="bezel-tick n">N</span>
            <span class="bezel-tick e">E</span>
            <span class="bezel-tick s">S</span>
            <span class="bezel-tick w">W</span>
            <div class="wheel-flow-arrow" id="wheel-flow-arrow" aria-hidden="true"></div>
          </div>
          <button type="button" id="btn-wheel-look-up" class="wheel-dir-btn up" title="Look Up (Hold or Tap)">&#9650;</button>
          <button type="button" id="btn-wheel-look-down" class="wheel-dir-btn down" title="Look Down (Hold or Tap)">&#9660;</button>
          <button type="button" id="btn-wheel-look-left" class="wheel-dir-btn left" title="Turn Left (Hold or Tap)">&#9664;</button>
          <button type="button" id="btn-wheel-look-right" class="wheel-dir-btn right" title="Turn Right (Hold or Tap)">&#9654;</button>
          <div id="look-wheel-puck" title="Drag 2D to steer view angle · Double-click to level pitch"></div>
        </div>
        <div class="wheel-pod-meta">
          <div class="wheel-readout" id="val-wheel-angles">000° N · +00°</div>
          <div class="wheel-flow-badge" id="val-wheel-flow">Flow N→S</div>
        </div>
      </div>

      <div class="wheel-pod" id="move-wheel-pod">
        <div class="side-col-label">Move / Swim</div>
        <div id="move-wheel" class="control-wheel-dial">
          <div class="move-wheel-ring" aria-hidden="true">
            <span class="move-tick fwd">FWD</span>
            <span class="move-tick bck">BCK</span>
            <span class="move-tick lft">L</span>
            <span class="move-tick rgt">R</span>
            <div class="move-crosshair-h"></div>
            <div class="move-crosshair-v"></div>
          </div>
          <button type="button" id="btn-wheel-move-fwd" class="wheel-dir-btn up" title="Swim Forward (Hold or Tap)">&#9650;</button>
          <button type="button" id="btn-wheel-move-back" class="wheel-dir-btn down" title="Swim Backward (Hold or Tap)">&#9660;</button>
          <button type="button" id="btn-wheel-move-left" class="wheel-dir-btn left" title="Strafe Left (Hold or Tap)">&#9664;</button>
          <button type="button" id="btn-wheel-move-right" class="wheel-dir-btn right" title="Strafe Right (Hold or Tap)">&#9654;</button>
          <div id="move-wheel-puck" title="Drag 2D to swim forward/back & strafe · Release to glide to a stop"></div>
        </div>
        <div class="wheel-readout" id="val-wheel-move">X +0.0 · Z +12.2m</div>
      </div>
    </div>

    <div class="side-strips-stack">
      <div class="side-vert-col vert-pod" id="reef-depth-column">
        <div class="side-col-label">Reef Depth</div>
        <button type="button" id="btn-depth-shallow" class="vert-btn" title="Shallower Reef Depth (Tap -1.5m · Hold -6.0 m/s)">&#9650; 1m</button>
        <div id="reef-depth-track" title="Drag to set Reef Depth (1.0m to 40.0m)">
          <span class="track-cap top">1m</span>
          <div class="track-rail"></div>
          <div id="reef-depth-thumb"></div>
          <span class="track-cap bottom">40m</span>
        </div>
        <div class="vert-alt-badge" id="val-side-depth">6.0m</div>
        <button type="button" id="btn-depth-deep" class="vert-btn" title="Deeper Reef Depth (Tap +1.5m · Hold +6.0 m/s)">&#9660; 40m</button>
      </div>

      <div class="side-vert-col vert-pod" id="vertical-move-column">
        <div class="side-col-label">Swim Pos</div>
        <button type="button" id="btn-vert-up" class="vert-btn" title="Ascend (Hold or Tap)">&#9650; UP</button>
        <div id="vert-elevator-track" title="Drag to position diver vertically above reef bed">
          <span class="track-cap top">HIGH</span>
          <div class="track-rail"></div>
          <div id="vert-elevator-thumb"></div>
          <span class="track-cap bottom">BED</span>
        </div>
        <div class="vert-alt-badge" id="val-vert-alt">+2.9m</div>
        <button type="button" id="btn-vert-down" class="vert-btn" title="Descend (Hold or Tap)">&#9660; DN</button>
      </div>
    </div>
  `;

  root.appendChild(aside);

  const lookPod = aside.querySelector('#look-wheel-pod');
  const movePod = aside.querySelector('#move-wheel-pod');
  const depthPod = aside.querySelector('#reef-depth-column');
  const vertPod = aside.querySelector('#vertical-move-column');

  const bezel = aside.querySelector('#look-wheel-bezel');
  const wheelFlowArrow = aside.querySelector('#wheel-flow-arrow');
  const lookWheel = aside.querySelector('#look-wheel');
  const lookPuck = aside.querySelector('#look-wheel-puck');
  const valAngles = aside.querySelector('#val-wheel-angles');
  const valWheelFlow = aside.querySelector('#val-wheel-flow');

  const moveWheel = aside.querySelector('#move-wheel');
  const movePuck = aside.querySelector('#move-wheel-puck');
  const valWheelMove = aside.querySelector('#val-wheel-move');

  const btnLookUp = aside.querySelector('#btn-wheel-look-up');
  const btnLookDown = aside.querySelector('#btn-wheel-look-down');
  const btnLookLeft = aside.querySelector('#btn-wheel-look-left');
  const btnLookRight = aside.querySelector('#btn-wheel-look-right');

  const btnMoveFwd = aside.querySelector('#btn-wheel-move-fwd');
  const btnMoveBack = aside.querySelector('#btn-wheel-move-back');
  const btnMoveLeft = aside.querySelector('#btn-wheel-move-left');
  const btnMoveRight = aside.querySelector('#btn-wheel-move-right');

  const btnDepthShallow = aside.querySelector('#btn-depth-shallow');
  const btnDepthDeep = aside.querySelector('#btn-depth-deep');
  const depthTrack = aside.querySelector('#reef-depth-track');
  const depthThumb = aside.querySelector('#reef-depth-thumb');
  const valSideDepth = aside.querySelector('#val-side-depth');

  const btnVertUp = aside.querySelector('#btn-vert-up');
  const btnVertDown = aside.querySelector('#btn-vert-down');
  const vertTrack = aside.querySelector('#vert-elevator-track');
  const vertThumb = aside.querySelector('#vert-elevator-thumb');
  const valVertAlt = aside.querySelector('#val-vert-alt');

  let latestEnvState = envState || null;
  const minDepth = WORLD_CONSTANTS.MIN_DEPTH ?? 1.0;
  const maxDepth = WORLD_CONSTANTS.MAX_DEPTH ?? 40.0;

  function clampDepth(val) {
    if (!Number.isFinite(val)) return minDepth;
    return Math.max(minDepth, Math.min(maxDepth, val));
  }

  let currentDepth = clampDepth(envState?.diveDepth ?? 6.0);

  function syncDepthUI(depthVal) {
    const clamped = clampDepth(depthVal);
    currentDepth = clamped;
    const span = Math.max(0.01, maxDepth - minDepth);
    const shallowFrac = 1 - (clamped - minDepth) / span;
    depthThumb.style.bottom = `calc(14px + ${(shallowFrac * 100).toFixed(1)}% * 0.66)`;
    valSideDepth.textContent = `${clamped.toFixed(1)}m`;
  }

  function commitDiveDepth(nextDepth) {
    const clamped = clampDepth(nextDepth);
    currentDepth = clamped;
    if (latestEnvState) {
      latestEnvState = { ...latestEnvState, diveDepth: clamped };
    } else {
      latestEnvState = { diveDepth: clamped };
    }
    onEnvChange?.({ diveDepth: clamped });
    syncDepthUI(clamped);
  }

  let depthHoldRaf = null;
  let depthHoldRate = 0;
  let depthHoldLastTs = 0;

  function stopDepthHold() {
    depthHoldRate = 0;
    if (depthHoldRaf !== null) {
      cancelAnimationFrame(depthHoldRaf);
      depthHoldRaf = null;
    }
  }

  function stepDepthHold(now) {
    if (!depthHoldRate) {
      depthHoldRaf = null;
      return;
    }
    const dt = Math.min(0.05, Math.max(0, (now - depthHoldLastTs) / 1000));
    depthHoldLastTs = now;
    if (dt > 0) {
      commitDiveDepth(currentDepth + depthHoldRate * dt);
    }
    depthHoldRaf = requestAnimationFrame(stepDepthHold);
  }

  function startDepthHold(ratePerSec) {
    stopDepthHold();
    depthHoldRate = ratePerSec;
    depthHoldLastTs = performance.now();
    depthHoldRaf = requestAnimationFrame(stepDepthHold);
  }

  function syncPodActive(pod) {
    if (!pod) return;
    const hasActive = Boolean(pod.querySelector('.active, .dragging'));
    pod.classList.toggle('active-pod', hasActive);
  }

  // Helper for hold-to-glide + tap-to-step directional buttons (also supports synthetic .click())
  function bindHoldOrTap(btn, pod, { onHoldStart, onHoldEnd, onTap }) {
    let pointerActive = false;
    let pointerId = null;
    let holdTimer = null;
    let holdTriggered = false;
    let suppressNextClick = false;

    function clearHold() {
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (holdTriggered) {
        onHoldEnd();
      }
      pointerActive = false;
      pointerId = null;
      btn.classList.remove('active');
      syncPodActive(pod);
    }

    function onPointerDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      pointerActive = true;
      pointerId = e.pointerId;
      holdTriggered = false;
      btn.classList.add('active');
      syncPodActive(pod);
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      holdTimer = setTimeout(() => {
        holdTimer = null;
        if (!pointerActive) return;
        holdTriggered = true;
        onHoldStart();
      }, 145);
    }

    function onPointerUp(e) {
      if (!pointerActive || (pointerId !== null && e.pointerId !== pointerId)) return;
      const wasHold = holdTriggered;
      clearHold();
      try {
        if (btn.hasPointerCapture(e.pointerId)) {
          btn.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
      suppressNextClick = true;
      setTimeout(() => {
        suppressNextClick = false;
      }, 60);

      if (!wasHold) {
        onTap();
      }
      btn.blur();
    }

    function onClick() {
      if (suppressNextClick) return;
      onTap();
      btn.blur();
    }

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', onPointerUp);
    btn.addEventListener('click', onClick);

    return () => {
      clearHold();
      btn.removeEventListener('pointerdown', onPointerDown);
      btn.removeEventListener('pointerup', onPointerUp);
      btn.removeEventListener('pointercancel', onPointerUp);
      btn.removeEventListener('click', onClick);
    };
  }

  // Independent 2D spring-loaded puck drag binder
  function bindPuckDrag({ dialEl, puckEl, podEl, maxRadius, onMove, onReset, onDblClick }) {
    let dragging = false;
    let pointerId = null;

    function updateFromEvent(e) {
      const rect = dialEl.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > maxRadius && dist > 1e-4) {
        const s = maxRadius / dist;
        dx *= s;
        dy *= s;
      }
      puckEl.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`;
      onMove(dx / maxRadius, dy / maxRadius);
    }

    function reset() {
      dragging = false;
      pointerId = null;
      puckEl.classList.remove('dragging');
      puckEl.style.transform = 'translate(-50%, -50%)';
      syncPodActive(podEl);
      onReset();
    }

    function onDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      pointerId = e.pointerId;
      puckEl.classList.add('dragging');
      syncPodActive(podEl);
      try {
        puckEl.setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      updateFromEvent(e);
    }

    function onPointerMove(e) {
      if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
      updateFromEvent(e);
    }

    function onUp(e) {
      if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
      try {
        if (puckEl.hasPointerCapture(e.pointerId)) {
          puckEl.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
      reset();
    }

    function handleDblClick(e) {
      e.stopPropagation();
      onDblClick();
    }

    puckEl.addEventListener('pointerdown', onDown);
    puckEl.addEventListener('dblclick', handleDblClick);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      if (dragging) reset();
      puckEl.removeEventListener('pointerdown', onDown);
      puckEl.removeEventListener('dblclick', handleDblClick);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }

  const cleanups = [
    bindHoldOrTap(btnLookUp, lookPod, {
      onHoldStart: () => cameraCtrl?.setWheelRates({ pitchRate: 1.25 }),
      onHoldEnd: () => cameraCtrl?.setWheelRates({ pitchRate: 0 }),
      onTap: () => cameraCtrl?.stepViewAngles(0, 8),
    }),
    bindHoldOrTap(btnLookDown, lookPod, {
      onHoldStart: () => cameraCtrl?.setWheelRates({ pitchRate: -1.25 }),
      onHoldEnd: () => cameraCtrl?.setWheelRates({ pitchRate: 0 }),
      onTap: () => cameraCtrl?.stepViewAngles(0, -8),
    }),
    bindHoldOrTap(btnLookLeft, lookPod, {
      onHoldStart: () => cameraCtrl?.setWheelRates({ yawRate: 1.6 }),
      onHoldEnd: () => cameraCtrl?.setWheelRates({ yawRate: 0 }),
      onTap: () => cameraCtrl?.stepViewAngles(12, 0),
    }),
    bindHoldOrTap(btnLookRight, lookPod, {
      onHoldStart: () => cameraCtrl?.setWheelRates({ yawRate: -1.6 }),
      onHoldEnd: () => cameraCtrl?.setWheelRates({ yawRate: 0 }),
      onTap: () => cameraCtrl?.stepViewAngles(-12, 0),
    }),
    bindHoldOrTap(btnMoveFwd, movePod, {
      onHoldStart: () => cameraCtrl?.setWheelRates({ forwardRate: 5.5 }),
      onHoldEnd: () => cameraCtrl?.setWheelRates({ forwardRate: 0 }),
      onTap: () => (cameraCtrl?.stepMove ? cameraCtrl.stepMove(1.35, 0) : cameraCtrl?.nudgePov?.(0, 0, 1.35)),
    }),
    bindHoldOrTap(btnMoveBack, movePod, {
      onHoldStart: () => cameraCtrl?.setWheelRates({ forwardRate: -5.5 }),
      onHoldEnd: () => cameraCtrl?.setWheelRates({ forwardRate: 0 }),
      onTap: () => (cameraCtrl?.stepMove ? cameraCtrl.stepMove(-1.35, 0) : cameraCtrl?.nudgePov?.(0, 0, -1.35)),
    }),
    bindHoldOrTap(btnMoveLeft, movePod, {
      onHoldStart: () => cameraCtrl?.setWheelRates({ strafeRate: -4.8 }),
      onHoldEnd: () => cameraCtrl?.setWheelRates({ strafeRate: 0 }),
      onTap: () => (cameraCtrl?.stepMove ? cameraCtrl.stepMove(0, -1.15) : cameraCtrl?.nudgePov?.(-1.15, 0, 0)),
    }),
    bindHoldOrTap(btnMoveRight, movePod, {
      onHoldStart: () => cameraCtrl?.setWheelRates({ strafeRate: 4.8 }),
      onHoldEnd: () => cameraCtrl?.setWheelRates({ strafeRate: 0 }),
      onTap: () => (cameraCtrl?.stepMove ? cameraCtrl.stepMove(0, 1.15) : cameraCtrl?.nudgePov?.(1.15, 0, 0)),
    }),
    bindHoldOrTap(btnDepthShallow, depthPod, {
      onHoldStart: () => startDepthHold(-6.0),
      onHoldEnd: () => stopDepthHold(),
      onTap: () => commitDiveDepth(currentDepth - 1.5),
    }),
    bindHoldOrTap(btnDepthDeep, depthPod, {
      onHoldStart: () => startDepthHold(6.0),
      onHoldEnd: () => stopDepthHold(),
      onTap: () => commitDiveDepth(currentDepth + 1.5),
    }),
    bindHoldOrTap(btnVertUp, vertPod, {
      onHoldStart: () => cameraCtrl?.setWheelRates({ verticalRate: 3.2 }),
      onHoldEnd: () => cameraCtrl?.setWheelRates({ verticalRate: 0 }),
      onTap: () => cameraCtrl?.stepVertical(0.65),
    }),
    bindHoldOrTap(btnVertDown, vertPod, {
      onHoldStart: () => cameraCtrl?.setWheelRates({ verticalRate: -3.2 }),
      onHoldEnd: () => cameraCtrl?.setWheelRates({ verticalRate: 0 }),
      onTap: () => cameraCtrl?.stepVertical(-0.65),
    }),
    bindPuckDrag({
      dialEl: lookWheel,
      puckEl: lookPuck,
      podEl: lookPod,
      maxRadius: 28,
      onMove: (nx, ny) => {
        cameraCtrl?.setWheelRates({
          yawRate: -nx * 1.85,
          pitchRate: -ny * 1.35,
        });
      },
      onReset: () => {
        cameraCtrl?.setWheelRates({ yawRate: 0, pitchRate: 0 });
      },
      onDblClick: () => {
        cameraCtrl?.setViewAngles({ pitchDeg: 0 });
      },
    }),
    bindPuckDrag({
      dialEl: moveWheel,
      puckEl: movePuck,
      podEl: movePod,
      maxRadius: 26,
      onMove: (nx, ny) => {
        cameraCtrl?.setWheelRates({
          forwardRate: -ny * 6.2,
          strafeRate: nx * 5.2,
        });
      },
      onReset: () => {
        cameraCtrl?.setWheelRates({ forwardRate: 0, strafeRate: 0 });
      },
      onDblClick: () => {
        cameraCtrl?.setWheelRates({ forwardRate: 0, strafeRate: 0 });
      },
    }),
  ];

  // Shared draggable vertical track binder
  function bindVerticalTrack(trackEl, podEl, onTopFraction) {
    let dragging = false;
    let pointerId = null;

    function applyFromEvent(e) {
      const rect = trackEl.getBoundingClientRect();
      const pad = 12;
      const usableH = Math.max(10, rect.height - pad * 2);
      const relY = e.clientY - (rect.top + pad);
      const topFrac01 = Math.max(0, Math.min(1, relY / usableH));
      onTopFraction(topFrac01);
    }

    function onDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      pointerId = e.pointerId;
      trackEl.classList.add('dragging');
      syncPodActive(podEl);
      try {
        trackEl.setPointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
      applyFromEvent(e);
    }

    function onMove(e) {
      if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
      applyFromEvent(e);
    }

    function onUp(e) {
      if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
      dragging = false;
      pointerId = null;
      trackEl.classList.remove('dragging');
      syncPodActive(podEl);
      try {
        if (trackEl.hasPointerCapture(e.pointerId)) {
          trackEl.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
    }

    trackEl.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      trackEl.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }

  cleanups.push(
    bindVerticalTrack(depthTrack, depthPod, (topFrac01) => {
      commitDiveDepth(minDepth + topFrac01 * (maxDepth - minDepth));
    }),
    bindVerticalTrack(vertTrack, vertPod, (topFrac01) => {
      cameraCtrl?.setVerticalFraction(1 - topFrac01, latestEnvState);
    })
  );

  syncDepthUI(currentDepth);

  function update(nextEnvState) {
    if (nextEnvState) {
      latestEnvState = nextEnvState;
      if (Number.isFinite(nextEnvState.diveDepth)) {
        syncDepthUI(nextEnvState.diveDepth);
      }
    }
    const vf = cameraCtrl?.getViewFrame?.();
    if (!vf) return;

    const yawRounded = Math.round(vf.yawDeg) % 360;
    const pitchRounded = Math.round(vf.pitchDeg);
    bezel.style.transform = `rotate(${(-vf.yawDeg).toFixed(1)}deg)`;
    valAngles.textContent = `${String(yawRounded).padStart(3, '0')}° ${cardinalShort(yawRounded)} · ${pitchRounded >= 0 ? '+' : ''}${pitchRounded}°`;

    const toDeg = latestEnvState?.currentDirection ?? 180;
    const spd = latestEnvState?.currentSpeed ?? 0.45;
    const normTo = ((toDeg % 360) + 360) % 360;
    const normFrom = (normTo + 180) % 360;
    const cardFrom = cardinalShort(normFrom);
    const cardTo = cardinalShort(normTo);
    wheelFlowArrow.style.transform = `translate(-50%, -50%) rotate(${toDeg.toFixed(1)}deg)`;
    wheelFlowArrow.style.opacity = spd < 0.03 ? '0.25' : String(0.55 + Math.min(1, spd) * 0.45);
    valWheelFlow.textContent = spd < 0.03 ? 'Slack Water' : `Flow ${cardFrom}→${cardTo}`;

    const swimSpeed = vf.swimSpeed ?? 0;
    const fwdRate = vf.forwardRate ?? 0;
    const strfRate = vf.strafeRate ?? 0;
    if (swimSpeed > 0.08) {
      if (Math.abs(fwdRate) >= Math.abs(strfRate) * 1.4 && Math.abs(fwdRate) > 0.05) {
        valWheelMove.textContent = fwdRate > 0
          ? `FWD ${fwdRate.toFixed(1)} m/s`
          : `BCK ${Math.abs(fwdRate).toFixed(1)} m/s`;
      } else if (Math.abs(strfRate) >= Math.abs(fwdRate) * 1.4 && Math.abs(strfRate) > 0.05) {
        valWheelMove.textContent = `STRF ${Math.abs(strfRate).toFixed(1)} m/s`;
      } else {
        valWheelMove.textContent = `SWIM ${swimSpeed.toFixed(1)} m/s`;
      }
    } else {
      const px = vf.pos?.x ?? 0;
      const pz = vf.pos?.z ?? 0;
      valWheelMove.textContent = `X ${px >= 0 ? '+' : ''}${px.toFixed(1)} · Z ${pz >= 0 ? '+' : ''}${pz.toFixed(1)}m`;
    }

    const frac = Math.max(0, Math.min(1, vf.verticalFraction ?? 0.5));
    vertThumb.style.bottom = `calc(14px + ${(frac * 100).toFixed(1)}% * 0.66)`;
    valVertAlt.textContent = `+${(vf.altAboveBed ?? 2.9).toFixed(1)}m`;
  }

  function dispose() {
    stopDepthHold();
    for (const fn of cleanups) fn();
    aside.remove();
  }

  return {
    update,
    dispose,
  };
}
