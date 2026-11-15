import { DEFAULT_ENV_STATE } from '../contracts.js';
import { COLORCHECKER_CLASSIC_PATCHES, simulateColorChecker } from '../physics/colorChartSim.js';

function formatBrightnessPct(pct) {
  const safe = Number.isFinite(pct) ? Math.max(0, pct) : 0;
  return safe >= 10 ? String(Math.round(safe)) : safe.toFixed(1);
}

/**
 * Live 24-Patch X-Rite ColorChecker Classic underwater photometric slate (#color-chart-panel).
 */
export function createColorChartPanel({ root, envState = DEFAULT_ENV_STATE, onVisibilityChange } = {}) {
  let latestEnvState = envState || DEFAULT_ENV_STATE;
  let visible = false;
  let splitMode = false;
  let hoveredIndex = null;
  let pinnedIndex = null;
  let lastRenderSignature = '';
  let lastSimulation = null;

  const panel = document.createElement('section');
  panel.id = 'color-chart-panel';
  panel.className = 'color-chart-panel is-hidden';
  panel.setAttribute('aria-label', '24-Patch Underwater ColorChecker Classic Simulator');
  panel.setAttribute('aria-hidden', 'true');

  const sortedPatches = [...COLORCHECKER_CLASSIC_PATCHES].sort((a, b) => a.index - b.index);
  const gridMarkup = sortedPatches
    .map(
      (patch) =>
        `<button type="button" class="cc-patch" data-patch-id="${patch.id}" data-patch-index="${patch.index}" data-surface-hex="${patch.surfaceHex}" style="background:${patch.surfaceHex}" title="${patch.name}"></button>`
    )
    .join('');

  const rulerTicksMarkup = Array.from({ length: 13 }, (_, idx) => {
    const cls = idx % 5 === 0 ? 'cc-ruler-tick major' : 'cc-ruler-tick';
    return `<span class="${cls}"></span>`;
  }).join('');

  panel.innerHTML = `
    <span class="cc-fiducial tl" aria-hidden="true">+</span>
    <span class="cc-fiducial tr" aria-hidden="true">+</span>
    <span class="cc-fiducial bl" aria-hidden="true">+</span>
    <span class="cc-fiducial br" aria-hidden="true">+</span>

    <div class="cc-header">
      <div class="cc-brand">
        <span class="cc-brand-title">colorchecker</span>
        <span class="cc-classic-pill">CLASSIC</span>
      </div>
      <div class="cc-header-controls">
        <span id="val-chart-brightness" class="cc-lum-badge" title="White 9.5 CIE luminance retention">Lum --%</span>
        <button type="button" id="btn-chart-split" class="cc-ctrl-btn" aria-pressed="false" title="Toggle diagonal split with Surface D65 reference">Split Ref</button>
        <button type="button" id="btn-close-color-chart" class="cc-close-btn" aria-label="Hide ColorChecker panel" title="Hide ColorChecker panel">&times;</button>
      </div>
    </div>

    <div class="cc-grid" role="group" aria-label="24 ColorChecker Classic Patches">${gridMarkup}</div>

    <div class="cc-footer">
      <span class="cc-xrite-mark">x-rite</span>
      <div id="val-chart-footer" class="cc-footer-readout" aria-live="polite"></div>
      <div class="cc-ruler" aria-hidden="true">
        <div class="cc-ruler-ticks">${rulerTicksMarkup}</div>
        <span class="cc-ruler-unit">mm</span>
      </div>
    </div>
  `;

  root.appendChild(panel);

  const valBrightness = panel.querySelector('#val-chart-brightness');
  const btnSplit = panel.querySelector('#btn-chart-split');
  const btnClose = panel.querySelector('#btn-close-color-chart');
  const gridEl = panel.querySelector('.cc-grid');
  const valFooter = panel.querySelector('#val-chart-footer');
  const patchButtons = Array.from(panel.querySelectorAll('.cc-patch'));

  function getInspectedIndex() {
    if (hoveredIndex !== null) return hoveredIndex;
    if (pinnedIndex !== null) return pinnedIndex;
    return null;
  }

  function renderFooter(sim) {
    if (!sim) return;
    const activeIdx = getInspectedIndex();
    if (activeIdx !== null && sim.patches[activeIdx]) {
      const p = sim.patches[activeIdx];
      const lumStr = formatBrightnessPct(p.luminanceRetentionPct);
      valFooter.textContent = `${p.name}: ${p.surfaceHex}→${p.underwaterHex} · ${lumStr}%`;
      valFooter.classList.add('is-inspecting');
      return;
    }

    const s = sim.summary || {};
    const eff = s.effectiveIrradiancePct || { r: 0, g: 0, b: 0 };
    const depthStr = Number(s.depthMeters ?? latestEnvState?.diveDepth ?? 6).toFixed(1);
    const sunStr = Number(s.sunElevationDeg ?? latestEnvState?.sunElevation ?? 61.9).toFixed(1);
    const turbPct = Math.round((s.turbidity ?? latestEnvState?.turbidity ?? 0.18) * 100);
    const rPct = Math.round(eff.r ?? 0);
    const gPct = Math.round(eff.g ?? 0);
    const bPct = Math.round(eff.b ?? 0);

    valFooter.textContent = `d=${depthStr}m · α=${sunStr}° · T ${turbPct}% · R${rPct}/G${gPct}/B${bPct}%`;
    valFooter.classList.remove('is-inspecting');
  }

  function applyPatchVisuals(sim) {
    if (!sim) return;
    const bPct = sim.summary?.brightnessPct ?? 0;
    valBrightness.textContent = `Lum ${formatBrightnessPct(bPct)}%`;

    for (let i = 0; i < patchButtons.length; i++) {
      const btn = patchButtons[i];
      const patch = sim.patches[i];
      if (!patch) continue;

      const lumPct = Number.isFinite(patch.luminanceRetentionPct) ? patch.luminanceRetentionPct : 0;
      const lumText = formatBrightnessPct(lumPct);
      btn.dataset.underwaterHex = patch.underwaterHex;
      btn.dataset.surfaceHex = patch.surfaceHex;
      btn.dataset.luminancePct = lumPct.toFixed(1);
      btn.classList.toggle('is-pinned', pinnedIndex === i);

      if (splitMode) {
        btn.style.background = `linear-gradient(135deg, ${patch.surfaceHex} 0%, ${patch.surfaceHex} 36%, ${patch.underwaterHex} 36.5%, ${patch.underwaterHex} 100%)`;
      } else {
        btn.style.background = patch.underwaterHex;
      }

      const label = `${patch.name}: ${patch.surfaceHex} -> ${patch.underwaterHex} · Brightness ${lumText}%`;
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }

    renderFooter(sim);
  }

  function buildSignature(state) {
    const d = Number(state?.diveDepth ?? DEFAULT_ENV_STATE.diveDepth).toFixed(3);
    const a = Number(state?.sunElevation ?? DEFAULT_ENV_STATE.sunElevation).toFixed(3);
    const t = Number(state?.turbidity ?? DEFAULT_ENV_STATE.turbidity).toFixed(4);
    const w = Number(state?.waveIntensity ?? DEFAULT_ENV_STATE.waveIntensity).toFixed(3);
    return `${d}|${a}|${t}|${w}|${splitMode ? 1 : 0}|${hoveredIndex ?? ''}|${pinnedIndex ?? ''}`;
  }

  function update(nextEnvState = latestEnvState, force = false) {
    if (nextEnvState) {
      latestEnvState = nextEnvState;
    }
    const sig = buildSignature(latestEnvState);
    if (!force && sig === lastRenderSignature && lastSimulation) {
      return;
    }
    lastRenderSignature = sig;
    lastSimulation = simulateColorChecker(latestEnvState);
    applyPatchVisuals(lastSimulation);
  }

  function syncVisibility(nextVisible) {
    visible = Boolean(nextVisible);
    panel.classList.toggle('is-hidden', !visible);
    panel.setAttribute('aria-hidden', visible ? 'false' : 'true');
    root.classList.toggle('color-chart-open', visible);
    if (visible) {
      update(latestEnvState, true);
    }
    onVisibilityChange?.(visible);
  }

  function show() {
    syncVisibility(true);
  }

  function hide() {
    syncVisibility(false);
  }

  function toggle() {
    syncVisibility(!visible);
    return visible;
  }

  function isVisible() {
    return visible;
  }

  function onSplitClick() {
    splitMode = !splitMode;
    btnSplit.classList.toggle('is-active', splitMode);
    btnSplit.setAttribute('aria-pressed', String(splitMode));
    update(latestEnvState, true);
    btnSplit.blur();
  }

  function onCloseClick() {
    hide();
    btnClose.blur();
  }

  function parsePatchIndex(target) {
    const btn = target?.closest?.('.cc-patch');
    if (!btn) return null;
    const idx = parseInt(btn.dataset.patchIndex, 10);
    return Number.isFinite(idx) ? idx : null;
  }

  function onGridMouseOver(e) {
    const idx = parsePatchIndex(e.target);
    if (idx === null || idx === hoveredIndex) return;
    hoveredIndex = idx;
    renderFooter(lastSimulation);
  }

  function onGridMouseLeave() {
    if (hoveredIndex === null) return;
    hoveredIndex = null;
    renderFooter(lastSimulation);
  }

  function onGridFocusIn(e) {
    const idx = parsePatchIndex(e.target);
    if (idx === null) return;
    hoveredIndex = idx;
    renderFooter(lastSimulation);
  }

  function onGridFocusOut(e) {
    if (e.relatedTarget && gridEl.contains(e.relatedTarget)) return;
    if (hoveredIndex !== null) {
      hoveredIndex = null;
      renderFooter(lastSimulation);
    }
  }

  function onGridClick(e) {
    const idx = parsePatchIndex(e.target);
    if (idx === null) return;
    pinnedIndex = pinnedIndex === idx ? null : idx;
    hoveredIndex = idx;
    applyPatchVisuals(lastSimulation);
    e.target?.closest?.('.cc-patch')?.blur?.();
  }

  btnSplit.addEventListener('click', onSplitClick);
  btnClose.addEventListener('click', onCloseClick);
  gridEl.addEventListener('mouseover', onGridMouseOver);
  gridEl.addEventListener('mouseleave', onGridMouseLeave);
  gridEl.addEventListener('focusin', onGridFocusIn);
  gridEl.addEventListener('focusout', onGridFocusOut);
  gridEl.addEventListener('click', onGridClick);

  update(latestEnvState, true);

  function dispose() {
    btnSplit.removeEventListener('click', onSplitClick);
    btnClose.removeEventListener('click', onCloseClick);
    gridEl.removeEventListener('mouseover', onGridMouseOver);
    gridEl.removeEventListener('mouseleave', onGridMouseLeave);
    gridEl.removeEventListener('focusin', onGridFocusIn);
    gridEl.removeEventListener('focusout', onGridFocusOut);
    gridEl.removeEventListener('click', onGridClick);
    root.classList.remove('color-chart-open');
    panel.remove();
  }

  return {
    update,
    show,
    hide,
    toggle,
    isVisible,
    dispose,
  };
}
