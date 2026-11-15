import * as THREE from 'three';
import { WORLD_CONSTANTS } from '../contracts.js';

function describeFovSector(cx, cy, r, headingDeg, fovDeg) {
  const half = THREE.MathUtils.degToRad(fovDeg * 0.5);
  const center = THREE.MathUtils.degToRad(headingDeg);
  const a1 = center - half;
  const a2 = center + half;
  // 0 deg = North (up: -Y), 90 deg = East (right: +X)
  const x1 = cx + Math.sin(a1) * r;
  const y1 = cy - Math.cos(a1) * r;
  const x2 = cx + Math.sin(a2) * r;
  const y2 = cy - Math.cos(a2) * r;
  const largeArc = fovDeg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

function cardinalLabel(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

/**
 * Builds and manages the top-right 360° Viewing Frame & POV Compass panel.
 */
export function createPOVCompass({ root, cameraCtrl }) {
  const panel = document.createElement('aside');
  panel.id = 'pov-compass-panel';
  panel.className = 'collapsed';

  panel.innerHTML = `
    <div class="pov-header">
      <div class="pov-title-wrap">
        <div class="pov-title">360° Fine Controls</div>
        <div class="pov-coords" id="val-pov-coords">X 0.0 · Z 12.2 · 6.2 m</div>
      </div>
      <button type="button" id="btn-toggle-pov" aria-expanded="false">360° Fine</button>
    </div>

    <div class="pov-body">
      <div class="compass-row">
        <div id="compass-dial" title="Click or drag anywhere around circle to aim 360° heading">
          <svg viewBox="0 0 120 120" class="compass-svg" aria-hidden="true">
            <defs>
              <radialGradient id="compass-fov-grad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="rgba(60, 212, 232, 0.55)" />
                <stop offset="100%" stop-color="rgba(60, 212, 232, 0.06)" />
              </radialGradient>
            </defs>
            <circle cx="60" cy="60" r="52" class="compass-ring-outer" />
            <circle cx="60" cy="60" r="34" class="compass-ring-inner" />
            <path id="compass-fov-wedge" fill="url(#compass-fov-grad)" d="" />
            <g id="compass-flow-vec" aria-hidden="true">
              <line x1="60" y1="88" x2="60" y2="32" class="compass-flow-line" />
              <polygon points="60,26 55.5,34.5 64.5,34.5" class="compass-flow-head" />
            </g>
            <line id="compass-needle" x1="60" y1="60" x2="60" y2="12" class="compass-needle" />
            <circle cx="60" cy="60" r="4" class="compass-center-dot" />
            <text x="60" y="14" class="compass-cardinal north">N</text>
            <text x="108" y="63.5" class="compass-cardinal">E</text>
            <text x="60" y="113" class="compass-cardinal">S</text>
            <text x="12" y="63.5" class="compass-cardinal">W</text>
          </svg>
          <div class="compass-readout" id="val-compass-heading">000° N</div>
        </div>

        <div class="pov-dpad" aria-label="POV Move Pad">
          <button type="button" id="btn-pov-up" class="dpad-btn dpad-vert" title="Swim Up (E / Space)">Up</button>
          <button type="button" id="btn-pov-fwd" class="dpad-btn" title="Swim Forward (W)">&#9650;</button>
          <button type="button" id="btn-pov-down" class="dpad-btn dpad-vert" title="Swim Down (Q / C)">Dn</button>
          <button type="button" id="btn-pov-left" class="dpad-btn" title="Strafe Left (A)">&#9664;</button>
          <div class="dpad-center">POV</div>
          <button type="button" id="btn-pov-right" class="dpad-btn" title="Strafe Right (D)">&#9654;</button>
          <span></span>
          <button type="button" id="btn-pov-back" class="dpad-btn" title="Swim Back (S)">&#9660;</button>
          <span></span>
        </div>
      </div>

      <div class="pov-sliders">
        <div class="pov-slider-row">
          <div class="control-header">
            <label class="control-label" for="slider-yaw">Yaw (Azimuth)</label>
            <span class="control-value" id="val-yaw">0°</span>
          </div>
          <input id="slider-yaw" class="hud-slider" type="range" min="0" max="360" step="1" />
        </div>

        <div class="pov-slider-row">
          <div class="control-header">
            <label class="control-label" for="slider-pitch">Pitch (Tilt)</label>
            <span class="control-value" id="val-pitch">0°</span>
          </div>
          <input id="slider-pitch" class="hud-slider" type="range" min="-89" max="89" step="1" />
        </div>

        <div class="pov-slider-row">
          <div class="control-header">
            <label class="control-label" for="slider-roll">Horizon Roll</label>
            <div class="roll-right">
              <span class="control-value" id="val-roll">0°</span>
              <button type="button" id="btn-level-frame" class="mini-btn" title="Reset roll to 0° (R)">Level</button>
            </div>
          </div>
          <input id="slider-roll" class="hud-slider" type="range" min="-30" max="30" step="1" />
        </div>

        <div class="pov-slider-row">
          <div class="control-header">
            <label class="control-label" for="slider-fov">Camera FOV</label>
            <span class="control-value" id="val-fov">60°</span>
          </div>
          <input id="slider-fov" class="hud-slider" type="range" min="40" max="115" step="1" />
        </div>
      </div>
    </div>
  `;

  root.appendChild(panel);

  const btnToggle = panel.querySelector('#btn-toggle-pov');
  const valCoords = panel.querySelector('#val-pov-coords');
  const compassDial = panel.querySelector('#compass-dial');
  const compassFovWedge = panel.querySelector('#compass-fov-wedge');
  const compassFlowVec = panel.querySelector('#compass-flow-vec');
  const compassNeedle = panel.querySelector('#compass-needle');
  const valHeading = panel.querySelector('#val-compass-heading');

  const sliderYaw = panel.querySelector('#slider-yaw');
  const valYaw = panel.querySelector('#val-yaw');
  const sliderPitch = panel.querySelector('#slider-pitch');
  const valPitch = panel.querySelector('#val-pitch');
  const sliderRoll = panel.querySelector('#slider-roll');
  const valRoll = panel.querySelector('#val-roll');
  const btnLevel = panel.querySelector('#btn-level-frame');
  const sliderFov = panel.querySelector('#slider-fov');
  const valFov = panel.querySelector('#val-fov');

  const btnFwd = panel.querySelector('#btn-pov-fwd');
  const btnBack = panel.querySelector('#btn-pov-back');
  const btnLeft = panel.querySelector('#btn-pov-left');
  const btnRight = panel.querySelector('#btn-pov-right');
  const btnUp = panel.querySelector('#btn-pov-up');
  const btnDown = panel.querySelector('#btn-pov-down');

  let dialPointerDown = false;
  let dialPointerId = null;

  function aimCompassFromEvent(e) {
    const rect = compassDial.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    if (dx * dx + dy * dy < 9) return;
    const deg = ((THREE.MathUtils.radToDeg(Math.atan2(dx, -dy)) % 360) + 360) % 360;
    cameraCtrl?.setViewAngles({ yawDeg: deg });
  }

  function onDialDown(e) {
    e.preventDefault();
    dialPointerDown = true;
    dialPointerId = e.pointerId;
    try {
      compassDial.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }
    aimCompassFromEvent(e);
  }

  function onDialMove(e) {
    if (!dialPointerDown || (dialPointerId !== null && e.pointerId !== dialPointerId)) return;
    aimCompassFromEvent(e);
  }

  function onDialUp(e) {
    if (!dialPointerDown) return;
    if (dialPointerId !== null && e.pointerId !== dialPointerId) return;
    dialPointerDown = false;
    dialPointerId = null;
    try {
      if (compassDial.hasPointerCapture(e.pointerId)) {
        compassDial.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
  }

  function onYawInput() {
    cameraCtrl?.setViewAngles({ yawDeg: parseFloat(sliderYaw.value) });
  }

  function onPitchInput() {
    cameraCtrl?.setViewAngles({ pitchDeg: parseFloat(sliderPitch.value) });
  }

  function onRollInput() {
    cameraCtrl?.setViewAngles({ rollDeg: parseFloat(sliderRoll.value) });
  }

  function onLevelClick() {
    cameraCtrl?.setViewAngles({ rollDeg: 0 });
    sliderRoll.value = '0';
    btnLevel.blur();
  }

  function onFovInput() {
    cameraCtrl?.setFov(parseFloat(sliderFov.value));
  }

  function onToggleClick() {
    const collapsed = panel.classList.toggle('collapsed');
    btnToggle.textContent = collapsed ? '360° Fine' : 'Hide';
    btnToggle.setAttribute('aria-expanded', String(!collapsed));
    btnToggle.blur();
  }

  function collapse() {
    panel.classList.add('collapsed');
    btnToggle.textContent = '360° Fine';
    btnToggle.setAttribute('aria-expanded', 'false');
  }

  function expand() {
    panel.classList.remove('collapsed');
    btnToggle.textContent = 'Hide';
    btnToggle.setAttribute('aria-expanded', 'true');
  }

  const nudgeBindings = [
    [btnFwd, [0, 0, 0.9]],
    [btnBack, [0, 0, -0.9]],
    [btnLeft, [-0.9, 0, 0]],
    [btnRight, [0.9, 0, 0]],
    [btnUp, [0, 0.75, 0]],
    [btnDown, [0, -0.75, 0]],
  ];

  const nudgeHandlers = nudgeBindings.map(([btn, vec]) => {
    const fn = () => {
      cameraCtrl?.nudgePov(vec[0], vec[1], vec[2]);
      btn.blur();
    };
    btn.addEventListener('click', fn);
    return [btn, fn];
  });

  compassDial.addEventListener('pointerdown', onDialDown);
  window.addEventListener('pointermove', onDialMove);
  window.addEventListener('pointerup', onDialUp);
  window.addEventListener('pointercancel', onDialUp);
  sliderYaw.addEventListener('input', onYawInput);
  sliderPitch.addEventListener('input', onPitchInput);
  sliderRoll.addEventListener('input', onRollInput);
  btnLevel.addEventListener('click', onLevelClick);
  sliderFov.addEventListener('input', onFovInput);
  btnToggle.addEventListener('click', onToggleClick);

  function update(envState) {
    const vf = cameraCtrl?.getViewFrame?.();
    if (!vf) return;

    const yawRounded = Math.round(vf.yawDeg) % 360;
    const pitchRounded = Math.round(vf.pitchDeg);
    const rollRounded = Math.round(vf.rollDeg);
    const fovRounded = Math.round(vf.fov);

    if (document.activeElement !== sliderYaw) {
      sliderYaw.value = String(yawRounded);
    }
    if (document.activeElement !== sliderPitch) {
      sliderPitch.value = String(pitchRounded);
    }
    if (document.activeElement !== sliderRoll) {
      sliderRoll.value = String(rollRounded);
    }
    if (document.activeElement !== sliderFov) {
      sliderFov.value = String(fovRounded);
    }

    valYaw.textContent = `${yawRounded}°`;
    valPitch.textContent = `${pitchRounded >= 0 ? '+' : ''}${pitchRounded}°`;
    valRoll.textContent = `${rollRounded >= 0 ? '+' : ''}${rollRounded}°`;
    valFov.textContent = `${fovRounded}°`;

    const surfaceY = WORLD_CONSTANTS.SURFACE_BASE_Y + (envState?.diveDepth ?? 6.0);
    const povDepth = Math.max(0, surfaceY - vf.pos.y);
    valCoords.textContent = `X ${vf.pos.x.toFixed(1)} · Z ${vf.pos.z.toFixed(1)} · ${povDepth.toFixed(1)}m`;

    // Update SVG compass FOV sector & heading needle
    compassFovWedge.setAttribute('d', describeFovSector(60, 60, 50, vf.yawDeg, vf.fov));
    const toDeg = envState?.currentDirection ?? 180;
    const spd = envState?.currentSpeed ?? 0.45;
    compassFlowVec.setAttribute('transform', `rotate(${toDeg.toFixed(1)} 60 60)`);
    compassFlowVec.style.opacity = spd < 0.03 ? '0.25' : String(0.55 + Math.min(1, spd) * 0.45);
    const rad = THREE.MathUtils.degToRad(vf.yawDeg);
    compassNeedle.setAttribute('x2', (60 + Math.sin(rad) * 48).toFixed(2));
    compassNeedle.setAttribute('y2', (60 - Math.cos(rad) * 48).toFixed(2));
    valHeading.textContent = `${String(yawRounded).padStart(3, '0')}° ${cardinalLabel(yawRounded)}`;
  }

  function dispose() {
    compassDial.removeEventListener('pointerdown', onDialDown);
    window.removeEventListener('pointermove', onDialMove);
    window.removeEventListener('pointerup', onDialUp);
    window.removeEventListener('pointercancel', onDialUp);
    sliderYaw.removeEventListener('input', onYawInput);
    sliderPitch.removeEventListener('input', onPitchInput);
    sliderRoll.removeEventListener('input', onRollInput);
    btnLevel.removeEventListener('click', onLevelClick);
    sliderFov.removeEventListener('input', onFovInput);
    btnToggle.removeEventListener('click', onToggleClick);
    for (const [btn, fn] of nudgeHandlers) {
      btn.removeEventListener('click', fn);
    }
    panel.remove();
  }

  return {
    update,
    collapse,
    expand,
    dispose,
  };
}
