import {
  SPECIES_CATALOG,
  SPECIES_POPULATION_SPEC,
  createDefaultSpeciesCounts,
  sanitizeSpeciesCount,
} from '../contracts.js';

const SPECIES_META = {
  // Corals (7)
  acropora: { color: '#9a9cff', group: 'corals' },
  stylophora: { color: '#ef6ca8', group: 'corals' },
  millepora: { color: '#e8b948', group: 'corals' },
  platygyra: { color: '#58c982', group: 'corals' },
  porites: { color: '#c9a66b', group: 'corals' },
  dendronephthya: { color: '#ff5c8a', group: 'corals' },
  sarcophyton: { color: '#d4b483', group: 'corals' },
  // Invertebrates (6)
  entacmaea: { color: '#9ab86c', group: 'inverts' },
  diadema: { color: '#6d7a8a', group: 'inverts' },
  tridacna: { color: '#38c8ff', group: 'inverts' },
  starfish: { color: '#e64242', group: 'inverts' },
  seacucumber: { color: '#9c7864', group: 'inverts' },
  featherstar: { color: '#d482ff', group: 'inverts' },
  // Fish & Rays (9)
  pseudanthias: { color: '#ff9033', group: 'fish' },
  chromis: { color: '#52e3cc', group: 'fish' },
  abudefduf: { color: '#e8e064', group: 'fish' },
  goatfish: { color: '#f2c89b', group: 'fish' },
  amphiprion: { color: '#ffb43b', group: 'fish' },
  chaetodon: { color: '#f5dc4c', group: 'fish' },
  caesio: { color: '#45b8ff', group: 'fish' },
  cleanerwrasse: { color: '#29b8ff', group: 'fish' },
  taeniura: { color: '#49a6ff', group: 'fish' },
  // Predators (5)
  caranx: { color: '#7ad4ff', group: 'predators' },
  grouper: { color: '#e0533c', group: 'predators' },
  pterois: { color: '#ff4d6d', group: 'predators' },
  moray: { color: '#c8b6a4', group: 'predators' },
  lizardfish: { color: '#c9ab78', group: 'predators' },
};

const GUIDE_TABS = [
  { id: 'all', label: 'All' },
  { id: 'corals', label: 'Corals' },
  { id: 'inverts', label: 'Inverts' },
  { id: 'fish', label: 'Fish & Rays' },
  { id: 'predators', label: 'Predators' },
];

function formatTimeOfDay(hours) {
  const totalMinutes = Math.round(hours * 60);
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function getTimePhaseLabel(hours) {
  if (hours < 6.8) return 'Dawn';
  if (hours < 9.5) return 'Morning';
  if (hours < 15.0) return 'Solar Noon';
  if (hours < 17.5) return 'Afternoon';
  if (hours < 18.8) return 'Golden Hour';
  return 'Dusk';
}

function getOpticalZoneLabel(depth) {
  if (depth <= 3.5) return 'Sunlit Lagoon Crest';
  if (depth <= 10.0) return 'Upper Fore-Reef';
  if (depth <= 22.0) return 'Mid-Slope';
  if (depth <= 32.0) return 'Deep Fore-Reef';
  return 'Mesophotic Twilight';
}

function getTurbidityLabel(turbidity) {
  if (turbidity < 0.15) return 'Crystal Clear';
  if (turbidity < 0.35) return 'Clear Red Sea';
  if (turbidity < 0.65) return 'Moderate Plankton';
  return 'High Particulate';
}

function getWaveStateLabel(waveIntensity) {
  if (waveIntensity < 0.12) return 'Glassy Lagoon';
  if (waveIntensity < 0.38) return 'Gentle Reef Ripple';
  if (waveIntensity < 0.68) return 'Moderate Chop';
  return 'Rolling Red Sea Swell';
}

function formatFlowLabel(toDeg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const normTo = ((toDeg % 360) + 360) % 360;
  const normFrom = (normTo + 180) % 360;
  return `${dirs[Math.round(normFrom / 45) % 8]} → ${dirs[Math.round(normTo / 45) % 8]} (${Math.round(normTo)}°)`;
}

function getCurrentRegimeLabel(speed) {
  if (speed < 0.05) return 'Slack Water';
  if (speed < 0.30) return 'Gentle Drift';
  if (speed < 0.65) return 'Prevailing Red Sea Flow';
  return 'Strong Reef Current';
}

export function computeSolarElevationFromTime(hours) {
  const tNorm = Math.max(0, Math.min(1, (hours - 5.5) / (19.5 - 5.5)));
  const arc = Math.sin(tNorm * Math.PI);
  return Math.round(8 + (78 - 8) * arc);
}

function defaultTransmittance(depthMeters, envState) {
  const turb = envState?.turbidity ?? 0.18;
  const d = Math.max(0, depthMeters);
  const kr = 0.24 + turb * 0.26;
  const kg = 0.055 + turb * 0.18;
  const kb = 0.017 + turb * 0.13;
  return {
    r: 0.78 * Math.exp(-kr * d) + 0.22 * Math.exp(-kr * 0.45 * d),
    g: Math.exp(-kg * d),
    b: Math.exp(-kb * d),
  };
}

/**
 * Builds and manages the collapsible glassmorphic HUD panel.
 */
export function createHUD({
  root,
  envState,
  onEnvChange,
  cameraCtrl,
  getTransmittanceAtDepth,
  onSelectSpecies,
}) {
  const panel = document.createElement('aside');
  panel.id = 'hud-panel';

  const allSpecies = Object.values(SPECIES_CATALOG);
  const lastNonZeroCounts = createDefaultSpeciesCounts();
  let latestState = envState;
  let activeGroup = 'all';

  const guideTabsMarkup = GUIDE_TABS.map(
    (tab, idx) =>
      `<button type="button" class="guide-tab${idx === 0 ? ' active' : ''}" data-group="${tab.id}">${tab.label}</button>`
  ).join('');

  const speciesRowsMarkup = allSpecies
    .map((sp) => {
      const meta = SPECIES_META[sp.id] || { color: '#3cd4e8', group: 'fish' };
      const spec = SPECIES_POPULATION_SPEC[sp.id] || { defaultCount: 1, maxCount: 1, step: 1 };
      const initCount = sanitizeSpeciesCount(sp.id, envState?.speciesCounts?.[sp.id] ?? spec.defaultCount);
      return `<div class="species-row${initCount === 0 ? ' is-off' : ''}" data-species-id="${sp.id}" data-group="${meta.group}">
        <button type="button" class="sp-toggle-btn${initCount > 0 ? ' active' : ''}" data-species-id="${sp.id}" role="checkbox" aria-checked="${initCount > 0}" aria-pressed="${initCount > 0}" aria-label="Include or remove ${sp.commonName} from reef" title="${initCount > 0 ? `Included in reef — click X to remove ${sp.commonName}` : `Removed from reef — click box to include ${sp.commonName}`}">${initCount > 0 ? '✕' : ''}</button>
        <button type="button" class="sp-info-btn" data-species-id="${sp.id}" title="Inspect ${sp.commonName}">
          <span class="pill-dot" style="background:${meta.color}"></span>
          <span class="sp-row-name">${sp.commonName}</span>
        </button>
        <div class="sp-stepper">
          <button type="button" class="sp-step-btn sp-step-dec" data-species-id="${sp.id}" title="Decrease by ${spec.step}" aria-label="Decrease ${sp.commonName}">&minus;</button>
          <span class="sp-count-badge" data-count-for="${sp.id}">${initCount}</span>
          <button type="button" class="sp-step-btn sp-step-inc" data-species-id="${sp.id}" title="Increase by ${spec.step}" aria-label="Increase ${sp.commonName}">+</button>
        </div>
      </div>`;
    })
    .join('');

  panel.innerHTML = `
    <div class="hud-header">
      <div class="hud-title-wrap">
        <h1 class="hud-title">Gulf of Eilat Reef</h1>
        <p class="hud-subtitle">Red Sea Optics &amp; Ecosystem</p>
      </div>
      <button type="button" id="btn-toggle-hud" aria-expanded="true">Hide</button>
    </div>
    <div class="hud-body">
      <div class="control-group">
        <div class="control-header">
          <label class="control-label" for="slider-depth">Reef Depth</label>
          <span class="control-value" id="val-depth"></span>
        </div>
        <input id="slider-depth" class="hud-slider" type="range" min="1" max="40" step="0.5" />
        <div class="depth-preset-row">
          <button type="button" class="depth-chip" data-depth="1.5">1.5m Crest</button>
          <button type="button" class="depth-chip" data-depth="6">6m Garden</button>
          <button type="button" class="depth-chip" data-depth="18">18m Slope</button>
          <button type="button" class="depth-chip" data-depth="36">36m Deep</button>
        </div>
        <div class="control-submeta">
          <span id="val-optical-zone"></span>
          <span>Beer-Lambert Attenuation</span>
        </div>
        <div class="beer-lambert-box">
          <div class="beer-lambert-title">
            <span>Light Reaching Reef (Beer-Lambert)</span>
            <span id="val-depth-path"></span>
          </div>
          <div class="trans-row">
            <span class="trans-channel r">R</span>
            <div class="trans-track"><div class="trans-fill r" id="bar-trans-r"></div></div>
            <span class="trans-pct" id="pct-trans-r"></span>
          </div>
          <div class="trans-row">
            <span class="trans-channel g">G</span>
            <div class="trans-track"><div class="trans-fill g" id="bar-trans-g"></div></div>
            <span class="trans-pct" id="pct-trans-g"></span>
          </div>
          <div class="trans-row">
            <span class="trans-channel b">B</span>
            <div class="trans-track"><div class="trans-fill b" id="bar-trans-b"></div></div>
            <span class="trans-pct" id="pct-trans-b"></span>
          </div>
          <div class="spectrum-preview-row">
            <span>Reef Light</span>
            <div class="spectrum-swatch" id="bar-spectrum-swatch"></div>
            <span id="val-spectrum-note"></span>
          </div>
        </div>
      </div>

      <div class="control-group">
        <div class="control-header">
          <label class="control-label" for="slider-sun-elevation">Sun Elevation Angle</label>
          <span class="control-value" id="val-sun-elevation"></span>
        </div>
        <input id="slider-sun-elevation" class="hud-slider" type="range" min="5" max="88" step="1" />
      </div>

      <div class="control-group">
        <div class="control-header">
          <label class="control-label" for="slider-waves">Surface Waves</label>
          <span class="control-value" id="val-waves"></span>
        </div>
        <input id="slider-waves" class="hud-slider" type="range" min="0" max="1" step="0.02" />
        <div class="control-submeta">
          <span id="val-wave-state"></span>
          <span>Caustics &amp; Terrain Light</span>
        </div>
      </div>

      <div class="control-group">
        <div class="control-header">
          <label class="control-label" for="slider-turbidity">Water Turbidity</label>
          <span class="control-value" id="val-turbidity"></span>
        </div>
        <input id="slider-turbidity" class="hud-slider" type="range" min="0" max="1" step="0.01" />
        <div class="control-submeta">
          <span id="val-turbidity-label"></span>
          <span>Scattering &amp; Particulate</span>
        </div>
      </div>

      <div class="control-group">
        <div class="control-header">
          <label class="control-label" for="slider-time-of-day">Time of Day</label>
          <div class="flow-header-right">
            <span class="control-value" id="val-time-of-day"></span>
            <button type="button" id="btn-sync-sun" class="mini-btn" title="Sync Sun Elevation to Time of Day">Sync Sun</button>
          </div>
        </div>
        <input id="slider-time-of-day" class="hud-slider" type="range" min="5.5" max="19.5" step="0.1" />
        <div class="control-submeta">
          <span id="val-time-phase"></span>
          <span>Solar Azimuth &amp; Sky Warmth</span>
        </div>
      </div>

      <div class="control-group">
        <div class="control-header">
          <label class="control-label" for="slider-current-dir">Reef Current Flow</label>
          <div class="flow-header-right">
            <span class="control-value" id="val-current-dir"></span>
            <button type="button" id="btn-flow-ns" class="mini-btn" title="Reset to prevailing Eilat North-to-South current">N→S</button>
          </div>
        </div>
        <input id="slider-current-dir" class="hud-slider" type="range" min="0" max="360" step="5" />
        <div class="control-header flow-speed-header">
          <label class="control-label" for="slider-current-speed">Current Speed</label>
          <span class="control-value" id="val-current-speed"></span>
        </div>
        <input id="slider-current-speed" class="hud-slider" type="range" min="0" max="1" step="0.05" />
        <div class="control-submeta">
          <span id="val-current-regime"></span>
          <span>Planktivores Face Upstream</span>
        </div>
      </div>

      <div class="section-divider"></div>

      <div class="preset-grid">
        <button type="button" id="btn-preset-reef" class="hud-btn">Reef Panorama</button>
        <button type="button" id="btn-preset-snell" class="hud-btn accent">Snell's Window</button>
        <button type="button" id="btn-preset-anemone" class="hud-btn">Anemone Close-up</button>
        <button type="button" id="btn-preset-sand" class="hud-btn">Sandy Channel</button>
        <button type="button" id="btn-preset-bluewater" class="hud-btn">Blue Water Drop-Off</button>
        <button type="button" id="btn-preset-cleaning" class="hud-btn">Cleaning Station</button>
        <button type="button" id="btn-mode-toggle" class="hud-btn full-span">Camera Mode: Dive (360°)</button>
      </div>

      <div class="section-divider"></div>

      <div class="guide-section" id="reef-guide-section">
        <button type="button" class="guide-toggle" id="btn-toggle-guide" aria-expanded="true">
          <span>Species List &amp; Manager</span>
          <span class="guide-toggle-right">
            <span class="guide-summary" id="val-species-summary">${allSpecies.length}/${allSpecies.length} In Reef</span>
            <span id="guide-chevron">&#9662;</span>
          </span>
        </button>
        <div class="guide-tabs">${guideTabsMarkup}</div>
        <div class="species-bulk-bar">
          <button type="button" id="btn-species-enable-tab" class="bulk-btn" title="Include all species in current tab">✕ Include Tab</button>
          <button type="button" id="btn-species-clear-tab" class="bulk-btn" title="Remove all species in current tab from reef">☐ Remove Tab</button>
          <button type="button" id="btn-species-reset" class="bulk-btn">Reset All</button>
        </div>
        <div class="species-roster-list">${speciesRowsMarkup}</div>
      </div>
    </div>
  `;

  root.appendChild(panel);

  const btnToggleHud = panel.querySelector('#btn-toggle-hud');
  const sliderDepth = panel.querySelector('#slider-depth');
  const depthChips = Array.from(panel.querySelectorAll('.depth-chip'));
  const valDepth = panel.querySelector('#val-depth');
  const valOpticalZone = panel.querySelector('#val-optical-zone');
  const valDepthPath = panel.querySelector('#val-depth-path');
  const barR = panel.querySelector('#bar-trans-r');
  const barG = panel.querySelector('#bar-trans-g');
  const barB = panel.querySelector('#bar-trans-b');
  const pctR = panel.querySelector('#pct-trans-r');
  const pctG = panel.querySelector('#pct-trans-g');
  const pctB = panel.querySelector('#pct-trans-b');
  const barSpectrumSwatch = panel.querySelector('#bar-spectrum-swatch');
  const valSpectrumNote = panel.querySelector('#val-spectrum-note');

  const sliderSunElev = panel.querySelector('#slider-sun-elevation');
  const valSunElev = panel.querySelector('#val-sun-elevation');

  const sliderWaves = panel.querySelector('#slider-waves');
  const valWaves = panel.querySelector('#val-waves');
  const valWaveState = panel.querySelector('#val-wave-state');

  const sliderTurbidity = panel.querySelector('#slider-turbidity');
  const valTurbidity = panel.querySelector('#val-turbidity');
  const valTurbidityLabel = panel.querySelector('#val-turbidity-label');

  const sliderTime = panel.querySelector('#slider-time-of-day');
  const valTime = panel.querySelector('#val-time-of-day');
  const btnSyncSun = panel.querySelector('#btn-sync-sun');
  const valTimePhase = panel.querySelector('#val-time-phase');

  const sliderCurrentDir = panel.querySelector('#slider-current-dir');
  const valCurrentDir = panel.querySelector('#val-current-dir');
  const btnFlowNs = panel.querySelector('#btn-flow-ns');
  const sliderCurrentSpeed = panel.querySelector('#slider-current-speed');
  const valCurrentSpeed = panel.querySelector('#val-current-speed');
  const valCurrentRegime = panel.querySelector('#val-current-regime');

  const btnPresetReef = panel.querySelector('#btn-preset-reef');
  const btnPresetSnell = panel.querySelector('#btn-preset-snell');
  const btnPresetAnemone = panel.querySelector('#btn-preset-anemone');
  const btnPresetSand = panel.querySelector('#btn-preset-sand');
  const btnPresetBlue = panel.querySelector('#btn-preset-bluewater');
  const btnPresetCleaning = panel.querySelector('#btn-preset-cleaning');
  const btnModeToggle = panel.querySelector('#btn-mode-toggle');

  const guideSection = panel.querySelector('#reef-guide-section');
  const btnToggleGuide = panel.querySelector('#btn-toggle-guide');
  const guideChevron = panel.querySelector('#guide-chevron');
  const valSpeciesSummary = panel.querySelector('#val-species-summary');
  const guideTabs = Array.from(panel.querySelectorAll('.guide-tab'));
  const btnSpeciesEnableTab = panel.querySelector('#btn-species-enable-tab');
  const btnSpeciesClearTab = panel.querySelector('#btn-species-clear-tab');
  const btnSpeciesReset = panel.querySelector('#btn-species-reset');
  const rosterList = panel.querySelector('.species-roster-list');

  const speciesRows = Array.from(panel.querySelectorAll('.species-row'));
  const rowEntries = new Map();
  for (const row of speciesRows) {
    const id = row.dataset.speciesId;
    rowEntries.set(id, {
      id,
      name: row.querySelector('.sp-row-name')?.textContent || id,
      group: row.dataset.group,
      row,
      toggleBtn: row.querySelector('.sp-toggle-btn'),
      countBadge: row.querySelector('.sp-count-badge'),
      decBtn: row.querySelector('.sp-step-dec'),
      incBtn: row.querySelector('.sp-step-inc'),
      spec: SPECIES_POPULATION_SPEC[id] || { defaultCount: 1, maxCount: 1, step: 1 },
      lastRenderedCount: -1,
    });
  }

  function getSpeciesCount(state, id) {
    const spec = SPECIES_POPULATION_SPEC[id];
    const fallback = spec ? spec.defaultCount : 0;
    return sanitizeSpeciesCount(id, state?.speciesCounts?.[id] ?? fallback);
  }

  function applySpeciesPatch(patch) {
    const baseCounts = latestState?.speciesCounts || createDefaultSpeciesCounts();
    const nextCounts = { ...baseCounts, ...patch };
    onEnvChange?.({ speciesCounts: patch });
    syncFromState({ ...latestState, speciesCounts: nextCounts });
  }

  function syncSpeciesRoster(state) {
    let activeSpeciesCount = 0;
    for (const [id, entry] of rowEntries.entries()) {
      const count = getSpeciesCount(state, id);
      if (count > 0) {
        activeSpeciesCount += 1;
        lastNonZeroCounts[id] = count;
      }
      if (entry.lastRenderedCount !== count) {
        entry.lastRenderedCount = count;
        const isOn = count > 0;
        entry.row.classList.toggle('is-off', !isOn);
        entry.toggleBtn.classList.toggle('active', isOn);
        entry.toggleBtn.textContent = isOn ? '✕' : '';
        entry.toggleBtn.setAttribute('aria-checked', String(isOn));
        entry.toggleBtn.setAttribute('aria-pressed', String(isOn));
        entry.toggleBtn.title = isOn
          ? `Included in reef — click X to remove ${entry.name}`
          : `Removed from reef — click box to include ${entry.name}`;
        entry.countBadge.textContent = String(count);
        entry.decBtn.disabled = count <= 0;
        entry.incBtn.disabled = count >= entry.spec.maxCount;
      }
    }
    valSpeciesSummary.textContent = `${activeSpeciesCount}/${rowEntries.size} In Reef`;
  }

  function updateTransmittanceUI(state) {
    const depth = state.diveDepth;
    const calc = getTransmittanceAtDepth || defaultTransmittance;
    const trans = calc(depth, state) || { r: 1, g: 1, b: 1 };
    const r = Math.max(0, Math.min(1, trans.r ?? 0));
    const g = Math.max(0, Math.min(1, trans.g ?? 0));
    const b = Math.max(0, Math.min(1, trans.b ?? 0));

    barR.style.width = `${(r * 100).toFixed(1)}%`;
    barG.style.width = `${(g * 100).toFixed(1)}%`;
    barB.style.width = `${(b * 100).toFixed(1)}%`;

    pctR.textContent = `${Math.round(r * 100)}%`;
    pctG.textContent = `${Math.round(g * 100)}%`;
    pctB.textContent = `${Math.round(b * 100)}%`;
    valDepthPath.textContent = `${depth.toFixed(1)} m water column`;

    const swR = Math.round(Math.pow(r, 0.5) * 255);
    const swG = Math.round(Math.pow(g, 0.5) * 255);
    const swB = Math.round(Math.pow(b, 0.5) * 255);
    barSpectrumSwatch.style.background = `rgb(${swR}, ${swG}, ${swB})`;

    if (r >= 0.40) {
      valSpectrumNote.textContent = 'Full Warm Spectrum';
    } else if (r >= 0.12) {
      valSpectrumNote.textContent = 'Reds Fading · Cyan-Teal';
    } else if (g >= 0.16) {
      valSpectrumNote.textContent = 'Reds Gone · Blue-Green';
    } else {
      valSpectrumNote.textContent = 'Sapphire Blue Only';
    }
  }

  function syncFromState(state) {
    if (!state) return;
    latestState = state;
    if (document.activeElement !== sliderDepth) {
      sliderDepth.value = String(state.diveDepth);
    }
    valDepth.textContent = `${Number(state.diveDepth).toFixed(1)} m`;
    valOpticalZone.textContent = getOpticalZoneLabel(state.diveDepth);
    for (const chip of depthChips) {
      const chipDepth = parseFloat(chip.dataset.depth);
      chip.classList.toggle('active', Math.abs(chipDepth - state.diveDepth) < 0.26);
    }

    if (document.activeElement !== sliderSunElev) {
      sliderSunElev.value = String(state.sunElevation);
    }
    valSunElev.textContent = `${Math.round(state.sunElevation)}°`;

    const w = state?.waveIntensity ?? 0.28;
    if (document.activeElement !== sliderWaves) {
      sliderWaves.value = String(w);
    }
    valWaves.textContent = `${Math.round(w * 100)}%`;
    valWaveState.textContent = getWaveStateLabel(w);

    if (document.activeElement !== sliderTurbidity) {
      sliderTurbidity.value = String(state.turbidity);
    }
    valTurbidity.textContent = Number(state.turbidity).toFixed(2);
    valTurbidityLabel.textContent = getTurbidityLabel(state.turbidity);

    if (document.activeElement !== sliderTime) {
      sliderTime.value = String(state.timeOfDay);
    }
    valTime.textContent = formatTimeOfDay(state.timeOfDay);
    valTimePhase.textContent = getTimePhaseLabel(state.timeOfDay);

    const curDir = state?.currentDirection ?? 180;
    const curSpeed = state?.currentSpeed ?? 0.45;
    if (document.activeElement !== sliderCurrentDir) {
      sliderCurrentDir.value = String(curDir);
    }
    valCurrentDir.textContent = formatFlowLabel(curDir);

    if (document.activeElement !== sliderCurrentSpeed) {
      sliderCurrentSpeed.value = String(curSpeed);
    }
    valCurrentSpeed.textContent = `${Number(curSpeed).toFixed(2)} m/s`;
    valCurrentRegime.textContent = getCurrentRegimeLabel(curSpeed);

    updateTransmittanceUI(state);
    syncSpeciesRoster(state);

    if (cameraCtrl) {
      const m = cameraCtrl.getMode();
      btnModeToggle.textContent = `Camera Mode: ${m === 'dive' ? 'Dive (360°)' : 'Orbit'}`;
    }
  }

  function onDepthInput() {
    const val = parseFloat(sliderDepth.value);
    if (!Number.isFinite(val)) return;
    onEnvChange({ diveDepth: val });
    syncFromState({ ...latestState, diveDepth: val });
  }

  function onDepthChipClick(e) {
    const btn = e.currentTarget;
    const val = parseFloat(btn.dataset.depth);
    if (!Number.isFinite(val)) return;
    sliderDepth.value = String(val);
    onEnvChange({ diveDepth: val });
    syncFromState({ ...latestState, diveDepth: val });
    btn.blur();
  }

  function onSunElevInput() {
    const val = parseFloat(sliderSunElev.value);
    if (!Number.isFinite(val)) return;
    onEnvChange({ sunElevation: val });
    syncFromState({ ...latestState, sunElevation: val });
  }

  function onWavesInput() {
    const val = parseFloat(sliderWaves.value);
    if (!Number.isFinite(val)) return;
    onEnvChange({ waveIntensity: val });
    syncFromState({ ...latestState, waveIntensity: val });
  }

  function onTurbidityInput() {
    const val = parseFloat(sliderTurbidity.value);
    if (!Number.isFinite(val)) return;
    onEnvChange({ turbidity: val });
    syncFromState({ ...latestState, turbidity: val });
  }

  function onTimeInput() {
    const val = parseFloat(sliderTime.value);
    if (!Number.isFinite(val)) return;
    onEnvChange({ timeOfDay: val });
    syncFromState({ ...latestState, timeOfDay: val });
  }

  function onSyncSunClick() {
    const parsedTime = parseFloat(sliderTime.value);
    const t = Number.isFinite(parsedTime) ? parsedTime : (latestState?.timeOfDay ?? 12.5);
    const syncedSunElev = computeSolarElevationFromTime(t);
    sliderSunElev.value = String(syncedSunElev);
    onEnvChange({ sunElevation: syncedSunElev });
    syncFromState({ ...latestState, timeOfDay: t, sunElevation: syncedSunElev });
    btnSyncSun.blur();
  }

  function onCurrentDirInput() {
    const val = parseFloat(sliderCurrentDir.value);
    if (!Number.isFinite(val)) return;
    onEnvChange({ currentDirection: val });
    syncFromState({ ...latestState, currentDirection: val });
  }

  function onCurrentSpeedInput() {
    const val = parseFloat(sliderCurrentSpeed.value);
    if (!Number.isFinite(val)) return;
    onEnvChange({ currentSpeed: val });
    syncFromState({ ...latestState, currentSpeed: val });
  }

  function onFlowResetClick() {
    onEnvChange({ currentDirection: 180, currentSpeed: 0.45 });
    syncFromState({ ...latestState, currentDirection: 180, currentSpeed: 0.45 });
    btnFlowNs.blur();
  }

  function onToggleHud() {
    const collapsed = panel.classList.toggle('collapsed');
    btnToggleHud.textContent = collapsed ? 'Controls' : 'Hide';
    btnToggleHud.setAttribute('aria-expanded', String(!collapsed));
    btnToggleHud.blur();
  }

  function onToggleGuide() {
    const collapsed = guideSection.classList.toggle('collapsed');
    btnToggleGuide.setAttribute('aria-expanded', String(!collapsed));
    guideChevron.innerHTML = collapsed ? '&#9656;' : '&#9662;';
    btnToggleGuide.blur();
  }

  function onTabClick(e) {
    const btn = e.currentTarget;
    activeGroup = btn.dataset.group || 'all';
    for (const tab of guideTabs) {
      tab.classList.toggle('active', tab === btn);
    }
    for (const entry of rowEntries.values()) {
      const visible = activeGroup === 'all' || entry.group === activeGroup;
      entry.row.style.display = visible ? '' : 'none';
    }
    btn.blur();
  }

  function onEnableTabClick() {
    const patch = {};
    for (const [id, entry] of rowEntries.entries()) {
      if (activeGroup !== 'all' && entry.group !== activeGroup) continue;
      if (getSpeciesCount(latestState, id) === 0) {
        const remembered = lastNonZeroCounts[id] > 0 ? lastNonZeroCounts[id] : entry.spec.defaultCount;
        patch[id] = sanitizeSpeciesCount(id, remembered);
      }
    }
    if (Object.keys(patch).length > 0) {
      applySpeciesPatch(patch);
    }
    btnSpeciesEnableTab.blur();
  }

  function onClearTabClick() {
    const patch = {};
    for (const [id, entry] of rowEntries.entries()) {
      if (activeGroup !== 'all' && entry.group !== activeGroup) continue;
      const current = getSpeciesCount(latestState, id);
      if (current > 0) {
        lastNonZeroCounts[id] = current;
        patch[id] = 0;
      }
    }
    if (Object.keys(patch).length > 0) {
      applySpeciesPatch(patch);
    }
    btnSpeciesClearTab.blur();
  }

  function onResetAllSpeciesClick() {
    const defaults = createDefaultSpeciesCounts();
    for (const [id, count] of Object.entries(defaults)) {
      if (count > 0) lastNonZeroCounts[id] = count;
    }
    applySpeciesPatch(defaults);
    btnSpeciesReset.blur();
  }

  function onRosterClick(e) {
    const toggleBtn = e.target.closest('.sp-toggle-btn');
    if (toggleBtn) {
      const id = toggleBtn.dataset.speciesId;
      const entry = rowEntries.get(id);
      if (!entry) return;
      const current = getSpeciesCount(latestState, id);
      let next = 0;
      if (current > 0) {
        lastNonZeroCounts[id] = current;
        next = 0;
      } else {
        const remembered = lastNonZeroCounts[id] > 0 ? lastNonZeroCounts[id] : entry.spec.defaultCount;
        next = sanitizeSpeciesCount(id, remembered);
      }
      applySpeciesPatch({ [id]: next });
      toggleBtn.blur();
      return;
    }

    const decBtn = e.target.closest('.sp-step-dec');
    if (decBtn) {
      const id = decBtn.dataset.speciesId;
      const entry = rowEntries.get(id);
      if (!entry) return;
      const current = getSpeciesCount(latestState, id);
      const next = sanitizeSpeciesCount(id, Math.max(0, current - entry.spec.step));
      if (next > 0) lastNonZeroCounts[id] = next;
      applySpeciesPatch({ [id]: next });
      decBtn.blur();
      return;
    }

    const incBtn = e.target.closest('.sp-step-inc');
    if (incBtn) {
      const id = incBtn.dataset.speciesId;
      const entry = rowEntries.get(id);
      if (!entry) return;
      const current = getSpeciesCount(latestState, id);
      const next = sanitizeSpeciesCount(id, Math.min(entry.spec.maxCount, current + entry.spec.step));
      if (next > 0) lastNonZeroCounts[id] = next;
      applySpeciesPatch({ [id]: next });
      incBtn.blur();
      return;
    }

    const infoBtn = e.target.closest('.sp-info-btn');
    if (infoBtn) {
      const id = infoBtn.dataset.speciesId;
      if (id && onSelectSpecies) {
        onSelectSpecies(id);
      }
      infoBtn.blur();
    }
  }

  function onPresetReef() {
    cameraCtrl?.setPreset('reef');
    btnPresetReef.blur();
  }

  function onPresetSnell() {
    cameraCtrl?.setPreset('snells-window');
    btnPresetSnell.blur();
  }

  function onPresetAnemone() {
    cameraCtrl?.setPreset('anemone-closeup');
    btnPresetAnemone.blur();
  }

  function onPresetSand() {
    cameraCtrl?.setPreset('sandy-channel');
    btnPresetSand.blur();
  }

  function onPresetBlue() {
    cameraCtrl?.setPreset('blue-water');
    btnPresetBlue.blur();
  }

  function onPresetCleaning() {
    cameraCtrl?.setPreset('cleaning-station');
    btnPresetCleaning.blur();
  }

  function onModeToggle() {
    if (!cameraCtrl) return;
    const next = cameraCtrl.getMode() === 'orbit' ? 'dive' : 'orbit';
    cameraCtrl.setMode(next);
    btnModeToggle.textContent = `Camera Mode: ${next === 'dive' ? 'Dive (360°)' : 'Orbit'}`;
    btnModeToggle.blur();
  }

  const sliderBindings = [
    [sliderDepth, onDepthInput],
    [sliderSunElev, onSunElevInput],
    [sliderWaves, onWavesInput],
    [sliderTurbidity, onTurbidityInput],
    [sliderTime, onTimeInput],
    [sliderCurrentDir, onCurrentDirInput],
    [sliderCurrentSpeed, onCurrentSpeedInput],
  ];

  for (const [slider, handler] of sliderBindings) {
    slider.addEventListener('input', handler);
    slider.addEventListener('change', handler);
  }
  for (const chip of depthChips) {
    chip.addEventListener('click', onDepthChipClick);
  }
  btnSyncSun.addEventListener('click', onSyncSunClick);
  btnFlowNs.addEventListener('click', onFlowResetClick);
  btnToggleHud.addEventListener('click', onToggleHud);
  btnToggleGuide.addEventListener('click', onToggleGuide);
  btnPresetReef.addEventListener('click', onPresetReef);
  btnPresetSnell.addEventListener('click', onPresetSnell);
  btnPresetAnemone.addEventListener('click', onPresetAnemone);
  btnPresetSand.addEventListener('click', onPresetSand);
  btnPresetBlue.addEventListener('click', onPresetBlue);
  btnPresetCleaning.addEventListener('click', onPresetCleaning);
  btnModeToggle.addEventListener('click', onModeToggle);
  for (const tab of guideTabs) {
    tab.addEventListener('click', onTabClick);
  }
  btnSpeciesEnableTab.addEventListener('click', onEnableTabClick);
  btnSpeciesClearTab.addEventListener('click', onClearTabClick);
  btnSpeciesReset.addEventListener('click', onResetAllSpeciesClick);
  rosterList.addEventListener('click', onRosterClick);

  syncFromState(envState);

  function setActiveSpecies(speciesId) {
    for (const entry of rowEntries.values()) {
      entry.row.classList.toggle('active', entry.id === speciesId);
    }
  }

  function dispose() {
    for (const [slider, handler] of sliderBindings) {
      slider.removeEventListener('input', handler);
      slider.removeEventListener('change', handler);
    }
    for (const chip of depthChips) {
      chip.removeEventListener('click', onDepthChipClick);
    }
    btnSyncSun.removeEventListener('click', onSyncSunClick);
    btnFlowNs.removeEventListener('click', onFlowResetClick);
    btnToggleHud.removeEventListener('click', onToggleHud);
    btnToggleGuide.removeEventListener('click', onToggleGuide);
    btnPresetReef.removeEventListener('click', onPresetReef);
    btnPresetSnell.removeEventListener('click', onPresetSnell);
    btnPresetAnemone.removeEventListener('click', onPresetAnemone);
    btnPresetSand.removeEventListener('click', onPresetSand);
    btnPresetBlue.removeEventListener('click', onPresetBlue);
    btnPresetCleaning.removeEventListener('click', onPresetCleaning);
    btnModeToggle.removeEventListener('click', onModeToggle);
    for (const tab of guideTabs) {
      tab.removeEventListener('click', onTabClick);
    }
    btnSpeciesEnableTab.removeEventListener('click', onEnableTabClick);
    btnSpeciesClearTab.removeEventListener('click', onClearTabClick);
    btnSpeciesReset.removeEventListener('click', onResetAllSpeciesClick);
    rosterList.removeEventListener('click', onRosterClick);
    panel.remove();
  }

  return {
    update: syncFromState,
    setActiveSpecies,
    dispose,
  };
}
