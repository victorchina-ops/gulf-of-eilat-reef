import * as THREE from 'three';
import { SPECIES_CATALOG } from '../contracts.js';
import './styles.css';
import { createHUD } from './hud.js';
import { createPOVCompass } from './povCompass.js';
import { createSideWheel } from './sideWheel.js';
import { createSpeciesCard } from './speciesCard.js';
import { createWelcomeScreen } from './welcomeScreen.js';
import { createColorChartPanel } from './colorChartPanel.js';
import { createTourBar } from './tourBar.js';

function findSpeciesIdFromHit(hit) {
  const hitObj = hit?.object;
  if (!hitObj || !hitObj.visible) return null;
  if (
    hitObj.isInstancedMesh &&
    hit.instanceId !== undefined &&
    hit.instanceId >= hitObj.count
  ) {
    return null;
  }
  let obj = hitObj;
  while (obj) {
    if (!obj.visible) return null;
    const id = obj.userData?.speciesId;
    if (id && SPECIES_CATALOG[id]) {
      return id;
    }
    obj = obj.parent;
  }
  return null;
}

/**
 * Creates the full UI overlay: collapsible glassmorphic HUD,
 * top-right 360° POV & Compass panel, hover tooltip, and bottom-right species card.
 */
export function createUI({
  envState,
  onEnvChange,
  cameraCtrl,
  pickableMeshes = [],
  camera,
  domElement,
  getTransmittanceAtDepth,
}) {
  let latestEnvState = envState;

  const root = document.createElement('div');
  root.id = 'reef-ui-root';

  const rightDock = document.createElement('div');
  rightDock.id = 'right-controls-dock';

  const hint = document.createElement('div');
  hint.className = 'controls-hint';
  hint.textContent =
    'Drag: 360° Look · WASD: Swim · Space/C: Up/Dn · H: Hide UI · V / 1–5: UI Modes · Click Species: Info';

  document.body.appendChild(root);

  const UI_MODES = ['all', 'dashboard', 'controls', 'fine', 'colorchecker', 'hidden'];
  const CYCLE_UI_MODES = ['all', 'dashboard', 'controls', 'fine', 'colorchecker'];
  const UI_MODE_DEFS = [
    { id: 'all', label: 'All', title: 'Show all UI panels (1 / V)' },
    { id: 'dashboard', label: 'Dashboard', title: 'Show left dashboard only (2 / V)' },
    { id: 'controls', label: 'Controls', title: 'Show dive controls & reef tour only (3 / V)' },
    { id: 'fine', label: '360° Fine', title: 'Show 360° Fine controls only (4 / V)' },
    { id: 'colorchecker', label: 'ColorChecker', title: 'Show 24-Patch ColorChecker slate only (5 / V)' },
    { id: 'hidden', label: 'Hide (H)', title: 'Hide all UI — Cinema Mode (H)' },
  ];

  let uiMode = 'all';
  let lastVisibleUiMode = 'all';
  let cinemaMode = false;
  let colorChartAutoOpened = false;

  const uiModeBar = document.createElement('div');
  uiModeBar.id = 'ui-mode-bar';
  uiModeBar.className = 'ui-mode-bar';
  uiModeBar.setAttribute('role', 'toolbar');
  uiModeBar.setAttribute('aria-label', 'Interface Visibility Modes');

  const uiModeButtons = new Map();
  let btnHideUi = null;
  for (const def of UI_MODE_DEFS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-mode-btn';
    if (def.id === 'hidden') {
      btn.id = 'btn-hide-ui';
    }
    btn.dataset.uiMode = def.id;
    btn.title = def.title;
    btn.textContent = def.label;
    btn.setAttribute('aria-pressed', String(def.id === 'all'));
    uiModeBar.appendChild(btn);
    uiModeButtons.set(def.id, btn);
    if (def.id === 'hidden') btnHideUi = btn;
  }

  const restoreChip = document.createElement('button');
  restoreChip.type = 'button';
  restoreChip.id = 'ui-restore-chip';
  restoreChip.className = 'ui-restore-chip';
  restoreChip.setAttribute('aria-hidden', 'true');
  restoreChip.title = 'Restore interface (H)';
  restoreChip.textContent = 'Press H / Show UI';

  let hud = null;
  let povCompass = null;
  let tourBar = null;
  let colorChartPanel = null;
  const speciesCard = createSpeciesCard({
    root,
    getTransmittanceAtDepth,
    onEnvChange,
    onClose: () => {
      hud?.setActiveSpecies(null);
      syncCardSubtitles(null);
    },
  });

  // Inject Hebrew (<bdi lang="he" dir="rtl">) and depth subtitles into species card & tooltip
  const spCommonEl = root.querySelector('#sp-common');
  const spDepthEl = root.querySelector('#sp-depth-range');
  const spHebrewEl = document.createElement('div');
  spHebrewEl.id = 'sp-hebrew';
  spHebrewEl.className = 'species-hebrew-sub';
  if (spCommonEl?.parentElement) {
    spCommonEl.insertAdjacentElement('afterend', spHebrewEl);
  }

  const tooltipCommonEl = root.querySelector('#tooltip-common');
  const tooltipHebrewEl = document.createElement('div');
  tooltipHebrewEl.id = 'tooltip-hebrew';
  tooltipHebrewEl.className = 'tooltip-hebrew-sub';
  if (tooltipCommonEl?.parentElement) {
    tooltipCommonEl.insertAdjacentElement('afterend', tooltipHebrewEl);
  }

  function renderHebrewAndDepth(container, sp, includeDepth) {
    if (!container) return;
    container.textContent = '';
    if (!sp) return;
    if (sp.hebrewName) {
      const bdi = document.createElement('bdi');
      bdi.lang = 'he';
      bdi.dir = 'rtl';
      bdi.textContent = sp.hebrewName;
      container.appendChild(bdi);
    }
    if (includeDepth && sp.depthMin != null && sp.depthMax != null) {
      if (sp.hebrewName) {
        const sep = document.createElement('span');
        sep.className = 'tooltip-sub-sep';
        sep.textContent = ' · ';
        container.appendChild(sep);
      }
      const depthSpan = document.createElement('span');
      depthSpan.className = 'tooltip-sub-depth';
      depthSpan.textContent = `${sp.depthMin}–${sp.depthMax} m`;
      container.appendChild(depthSpan);
    }
  }

  let lastCardSpeciesId = null;
  let lastTooltipSpeciesId = null;

  function syncCardSubtitles(speciesId) {
    if (speciesId === lastCardSpeciesId) return;
    lastCardSpeciesId = speciesId;
    const sp = speciesId ? SPECIES_CATALOG[speciesId] : null;
    renderHebrewAndDepth(spHebrewEl, sp, false);
    if (sp && spDepthEl && sp.depthMin != null && sp.depthMax != null) {
      spDepthEl.textContent = `${sp.depthMin}–${sp.depthMax} m`;
    }
  }

  function syncTooltipSubtitles(speciesId) {
    if (speciesId === lastTooltipSpeciesId) return;
    lastTooltipSpeciesId = speciesId;
    const sp = speciesId ? SPECIES_CATALOG[speciesId] : null;
    renderHebrewAndDepth(tooltipHebrewEl, sp, true);
  }

  function setUiMode(nextMode) {
    const target = UI_MODES.includes(nextMode) ? nextMode : 'all';
    const prevMode = uiMode;
    uiMode = target;
    if (target !== 'hidden') {
      lastVisibleUiMode = target;
    }
    cinemaMode = target === 'hidden';
    root.dataset.uiMode = target;
    for (const m of UI_MODES) {
      root.classList.toggle(`ui-mode-${m}`, m === target);
      const btn = uiModeButtons.get(m);
      if (btn) {
        const active = m === target;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
      }
    }
    root.classList.toggle('cinema-mode', cinemaMode);
    uiModeBar.setAttribute('aria-hidden', String(cinemaMode));
    restoreChip.setAttribute('aria-hidden', String(!cinemaMode));

    if (target === 'fine') {
      povCompass?.expand?.();
    }
    if (target === 'colorchecker' && colorChartPanel && !colorChartPanel.isVisible()) {
      colorChartAutoOpened = true;
      colorChartPanel.show();
    } else if (prevMode === 'colorchecker' && target !== 'colorchecker' && colorChartAutoOpened) {
      colorChartAutoOpened = false;
      colorChartPanel?.hide?.();
    }

    if (cinemaMode || (target !== 'all' && target !== 'dashboard')) {
      speciesCard.hideTooltip();
      if (cinemaMode && domElement) domElement.style.cursor = '';
    }
  }

  function setCinemaMode(nextActive) {
    setUiMode(nextActive ? 'hidden' : (lastVisibleUiMode || 'all'));
  }

  function selectSpecies(speciesId) {
    if (!speciesId || !SPECIES_CATALOG[speciesId]) {
      speciesCard.close();
      syncCardSubtitles(null);
      hud?.setActiveSpecies(null);
      return;
    }
    if (window.innerWidth < 1160) {
      povCompass?.collapse();
    }
    speciesCard.showSpecies(speciesId, latestEnvState);
    syncCardSubtitles(speciesId);
    hud?.setActiveSpecies(speciesId);
  }

  const welcomeScreen = createWelcomeScreen({ root });

  tourBar = createTourBar({
    root,
    cameraCtrl,
    onTourStateChange: () => {
      hud?.syncTourUI?.();
    },
  });

  colorChartPanel = createColorChartPanel({
    root,
    envState: latestEnvState,
    onVisibilityChange: (visible) => {
      hud?.syncColorChartButton?.(visible);
      if (!visible && uiMode === 'colorchecker') {
        colorChartAutoOpened = false;
        setUiMode('all');
      }
    },
  });

  hud = createHUD({
    root,
    envState: latestEnvState,
    onEnvChange,
    cameraCtrl,
    getTransmittanceAtDepth,
    onSelectSpecies: selectSpecies,
    onOpenWelcome: () => welcomeScreen.open(),
    onToggleColorChart: () => colorChartPanel.toggle(),
    isColorChartVisible: () => colorChartPanel.isVisible(),
    onTourChange: () => {
      tourBar?.update?.();
    },
  });

  root.appendChild(rightDock);

  povCompass = createPOVCompass({
    root: rightDock,
    cameraCtrl,
  });

  const sideWheel = createSideWheel({
    root: rightDock,
    cameraCtrl,
    envState: latestEnvState,
    onEnvChange,
  });

  root.appendChild(hint);
  root.appendChild(uiModeBar);
  root.appendChild(restoreChip);
  setUiMode('all');

  function isTextEditingElement(el) {
    if (!el || typeof el !== 'object') return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const t = String(el.type || 'text').toLowerCase();
      return t !== 'range' && t !== 'button' && t !== 'checkbox' && t !== 'radio' && t !== 'submit' && t !== 'reset';
    }
    return false;
  }

  function onUiModeBarClick(e) {
    const btn = e.target?.closest?.('.ui-mode-btn');
    if (!btn) return;
    const mode = btn.dataset.uiMode;
    if (!mode) return;
    setUiMode(mode);
    btn.blur();
  }

  function onRestoreChipClick() {
    setCinemaMode(false);
    restoreChip.blur();
  }

  function onUiModeKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (welcomeScreen.isOpen()) return;
    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    if (isTextEditingElement(e.target) || isTextEditingElement(activeEl)) return;

    if (e.code === 'KeyH') {
      e.preventDefault();
      setCinemaMode(!cinemaMode);
      return;
    }
    if (e.code === 'KeyV') {
      e.preventDefault();
      if (cinemaMode) {
        setUiMode(lastVisibleUiMode || 'all');
      } else {
        const curIdx = CYCLE_UI_MODES.indexOf(uiMode);
        const nextIdx = (curIdx + 1) % CYCLE_UI_MODES.length;
        setUiMode(CYCLE_UI_MODES[nextIdx]);
      }
      return;
    }
    if (
      e.code === 'Digit1' ||
      e.code === 'Digit2' ||
      e.code === 'Digit3' ||
      e.code === 'Digit4' ||
      e.code === 'Digit5'
    ) {
      e.preventDefault();
      const idx = Number(e.code.charAt(5)) - 1;
      if (idx >= 0 && idx < CYCLE_UI_MODES.length) {
        setUiMode(CYCLE_UI_MODES[idx]);
      }
    }
  }

  uiModeBar.addEventListener('click', onUiModeBarClick);
  restoreChip.addEventListener('click', onRestoreChipClick);
  window.addEventListener('keydown', onUiModeKeyDown);

  // 3D Raycasting for hover tooltip and click-to-inspect (75ms hover throttle)
  const HOVER_PICK_INTERVAL_MS = 75;
  let lastHoverPickMs = 0;
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  function pickSpeciesAtClientPos(clientX, clientY) {
    if (!domElement || !camera || !pickableMeshes || pickableMeshes.length === 0) {
      return null;
    }
    const rect = domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(pickableMeshes, true);
    for (let i = 0; i < hits.length; i++) {
      const id = findSpeciesIdFromHit(hits[i]);
      if (id) return id;
    }
    return null;
  }

  function onPointerMove(e) {
    if (welcomeScreen.isOpen() || cinemaMode) {
      speciesCard.hideTooltip();
      if (domElement) domElement.style.cursor = '';
      return;
    }
    if (cameraCtrl?.isDragging()) {
      speciesCard.hideTooltip();
      if (domElement) domElement.style.cursor = 'grabbing';
      return;
    }
    const now = performance.now();
    if (now - lastHoverPickMs < HOVER_PICK_INTERVAL_MS) {
      return;
    }
    lastHoverPickMs = now;

    const speciesId = pickSpeciesAtClientPos(e.clientX, e.clientY);
    if (speciesId) {
      speciesCard.showTooltip(speciesId, e.clientX, e.clientY);
      syncTooltipSubtitles(speciesId);
      if (domElement) domElement.style.cursor = 'pointer';
    } else {
      speciesCard.hideTooltip();
      if (domElement) domElement.style.cursor = '';
    }
  }

  function onPointerLeave() {
    lastHoverPickMs = 0;
    speciesCard.hideTooltip();
    if (domElement) domElement.style.cursor = '';
  }

  function onClick(e) {
    if (welcomeScreen.isOpen()) return;
    if (cameraCtrl?.isDragging()) return;
    lastHoverPickMs = 0;
    const speciesId = pickSpeciesAtClientPos(e.clientX, e.clientY);
    if (speciesId) {
      selectSpecies(speciesId);
    }
  }

  if (domElement) {
    domElement.addEventListener('pointermove', onPointerMove);
    domElement.addEventListener('pointerleave', onPointerLeave);
    domElement.addEventListener('click', onClick);
  }

  function update(_elapsedTime, _camera, currentEnvState) {
    if (currentEnvState) {
      latestEnvState = currentEnvState;
    }
    hud.update(latestEnvState);
    tourBar.update();
    colorChartPanel.update(latestEnvState);
    povCompass.update(latestEnvState);
    sideWheel.update(latestEnvState);
    speciesCard.update(latestEnvState);
  }

  function dispose() {
    uiModeBar.removeEventListener('click', onUiModeBarClick);
    restoreChip.removeEventListener('click', onRestoreChipClick);
    window.removeEventListener('keydown', onUiModeKeyDown);
    if (domElement) {
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerleave', onPointerLeave);
      domElement.removeEventListener('click', onClick);
      domElement.style.cursor = '';
    }
    welcomeScreen.dispose();
    tourBar.dispose();
    colorChartPanel.dispose();
    hud.dispose();
    povCompass.dispose();
    sideWheel.dispose();
    speciesCard.dispose();
    root.remove();
  }

  return {
    update,
    selectSpecies,
    setUiMode,
    getUiMode: () => uiMode,
    setCinemaMode,
    isCinemaMode: () => cinemaMode,
    welcomeScreen,
    colorChartPanel,
    tourBar,
    dispose,
  };
}
