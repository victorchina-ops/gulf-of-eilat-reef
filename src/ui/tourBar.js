const SPEED_CYCLE = [1.0, 1.6, 0.6];

function formatSpeedLabel(speed) {
  const safe = Number.isFinite(speed) ? speed : 1.0;
  if (Math.abs(safe - Math.round(safe)) < 0.05) {
    return `${Math.round(safe)}×`;
  }
  return `${Number(safe.toFixed(1))}×`;
}

function getNextSpeed(currentSpeed) {
  let closestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < SPEED_CYCLE.length; i++) {
    const diff = Math.abs((currentSpeed ?? 1.0) - SPEED_CYCLE[i]);
    if (diff < bestDiff) {
      bestDiff = diff;
      closestIdx = i;
    }
  }
  return SPEED_CYCLE[(closestIdx + 1) % SPEED_CYCLE.length];
}

/**
 * Top-center Free-Ride Reef Tour control bar (#tour-bar).
 */
export function createTourBar({ root, cameraCtrl, onTourStateChange } = {}) {
  const bar = document.createElement('div');
  bar.id = 'tour-bar';
  bar.className = 'tour-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Free-Ride Reef Tour Controls');

  bar.innerHTML = `
    <button type="button" id="btn-tour-toggle" class="tour-toggle-btn" aria-pressed="false" title="Start or pause automated Free-Ride Reef Tour">▶ Free-Ride Tour</button>
    <span id="val-tour-status" class="tour-status-text">Reef Trail Ready</span>
    <input id="slider-tour-progress" class="hud-slider tour-progress-slider" type="range" min="0" max="100" step="0.2" value="0" aria-label="Tour Trail Progress" title="Scrub along the 12-zone reef tour loop" />
    <button type="button" id="btn-tour-speed" class="tour-pill-btn" title="Cycle tour glide speed (1× / 1.6× / 0.6×)">1×</button>
    <button type="button" id="btn-tour-trail" class="tour-pill-btn" aria-pressed="false" title="Show or hide 3D tour spline & waypoint rings">Trail</button>
  `;

  root.appendChild(bar);

  const btnToggle = bar.querySelector('#btn-tour-toggle');
  const valStatus = bar.querySelector('#val-tour-status');
  const sliderProgress = bar.querySelector('#slider-tour-progress');
  const btnSpeed = bar.querySelector('#btn-tour-speed');
  const btnTrail = bar.querySelector('#btn-tour-trail');

  let isScrubbing = false;
  let lastToggleText = '';
  let lastToggleActive = null;
  let lastStatusText = '';
  let lastStatusClass = '';
  let lastSpeedText = '';
  let lastTrailPressed = null;

  function readTourState() {
    const st = cameraCtrl?.getTourState?.();
    if (!st) {
      return {
        active: false,
        everStarted: false,
        pauseReason: 'ready',
        progress: 0,
        speed: 1.0,
        zoneName: 'Sunlit Coral Garden',
        trailVisible: false,
      };
    }
    return st;
  }

  function update() {
    const st = readTourState();
    const active = Boolean(st.active);
    const everStarted = Boolean(st.everStarted);

    const toggleText = active ? '⏸ Pause Tour' : '▶ Free-Ride Tour';
    if (toggleText !== lastToggleText) {
      lastToggleText = toggleText;
      btnToggle.textContent = toggleText;
    }
    if (active !== lastToggleActive) {
      lastToggleActive = active;
      btnToggle.classList.toggle('is-active', active);
      btnToggle.setAttribute('aria-pressed', String(active));
    }

    let statusText = 'Reef Trail Ready';
    let statusClass = 'ready';
    if (active) {
      statusText = `Auto Trail · ${st.zoneName || 'Reef Trail'}`;
      statusClass = 'active';
    } else if (everStarted) {
      statusText = 'Paused · Manual Control';
      statusClass = 'paused';
    }

    if (statusText !== lastStatusText) {
      lastStatusText = statusText;
      valStatus.textContent = statusText;
      valStatus.title = statusText;
    }
    if (statusClass !== lastStatusClass) {
      lastStatusClass = statusClass;
      valStatus.classList.toggle('is-active', statusClass === 'active');
      valStatus.classList.toggle('is-paused', statusClass === 'paused');
    }

    const progressPct = Math.max(0, Math.min(100, (Number.isFinite(st.progress) ? st.progress : 0) * 100));
    if (!isScrubbing && document.activeElement !== sliderProgress) {
      const nextVal = progressPct.toFixed(1);
      if (sliderProgress.value !== nextVal) {
        sliderProgress.value = nextVal;
      }
    }

    const speedText = formatSpeedLabel(st.speed);
    if (speedText !== lastSpeedText) {
      lastSpeedText = speedText;
      btnSpeed.textContent = speedText;
    }

    const trailVis = Boolean(st.trailVisible);
    if (trailVis !== lastTrailPressed) {
      lastTrailPressed = trailVis;
      btnTrail.setAttribute('aria-pressed', String(trailVis));
      btnTrail.classList.toggle('is-active', trailVis);
    }
  }

  function onToggleClick() {
    cameraCtrl?.toggleTour?.();
    update();
    onTourStateChange?.();
    btnToggle.blur();
  }

  function onSpeedClick() {
    const st = readTourState();
    const nextSpeed = getNextSpeed(st.speed);
    cameraCtrl?.setTourSpeed?.(nextSpeed);
    update();
    onTourStateChange?.();
    btnSpeed.blur();
  }

  function onTrailClick() {
    const st = readTourState();
    cameraCtrl?.setTourTrailVisible?.(!st.trailVisible);
    update();
    onTourStateChange?.();
    btnTrail.blur();
  }

  function onProgressPointerDown() {
    isScrubbing = true;
  }

  function onProgressPointerUp() {
    if (!isScrubbing) return;
    isScrubbing = false;
    if (document.activeElement === sliderProgress) {
      sliderProgress.blur();
    }
    update();
  }

  function onProgressInput() {
    const val = parseFloat(sliderProgress.value);
    if (!Number.isFinite(val)) return;
    cameraCtrl?.setTourProgress?.(val / 100);
    update();
    onTourStateChange?.();
  }

  function onProgressChange() {
    isScrubbing = false;
    onProgressInput();
  }

  btnToggle.addEventListener('click', onToggleClick);
  btnSpeed.addEventListener('click', onSpeedClick);
  btnTrail.addEventListener('click', onTrailClick);
  sliderProgress.addEventListener('pointerdown', onProgressPointerDown);
  window.addEventListener('pointerup', onProgressPointerUp);
  window.addEventListener('pointercancel', onProgressPointerUp);
  sliderProgress.addEventListener('input', onProgressInput);
  sliderProgress.addEventListener('change', onProgressChange);

  update();

  function dispose() {
    btnToggle.removeEventListener('click', onToggleClick);
    btnSpeed.removeEventListener('click', onSpeedClick);
    btnTrail.removeEventListener('click', onTrailClick);
    sliderProgress.removeEventListener('pointerdown', onProgressPointerDown);
    window.removeEventListener('pointerup', onProgressPointerUp);
    window.removeEventListener('pointercancel', onProgressPointerUp);
    sliderProgress.removeEventListener('input', onProgressInput);
    sliderProgress.removeEventListener('change', onProgressChange);
    bar.remove();
  }

  return {
    update,
    dispose,
  };
}
