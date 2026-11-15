import {
  DEFAULT_ENV_STATE,
  SPECIES_CATALOG,
  SPECIES_POPULATION_SPEC,
  WORLD_CONSTANTS,
  createDefaultSpeciesCounts,
  sanitizeSpeciesCount,
} from '../contracts.js';
import {
  solveFromSunElevation,
  solveFromTimeOfDay,
  solveFromDayOfYear,
  computeDaylightWindow,
  formatDayOfYear,
  getSeasonLabel,
} from '../physics/solarCalendar.js';
import { simulateColorChecker } from '../physics/colorChartSim.js';

const HUD_COLORCHART_DOT_IDS = ['red', 'orange', 'yellow', 'green', 'cyan', 'white-95'];

const domCache = new WeakMap();

function getElCache(el) {
  let entry = domCache.get(el);
  if (!entry) {
    entry = { text: undefined, val: undefined, style: Object.create(null), attr: Object.create(null), cls: Object.create(null) };
    domCache.set(el, entry);
  }
  return entry;
}

function setTextDirty(el, text) {
  if (!el) return;
  const cache = getElCache(el);
  const str = String(text);
  if (cache.text === str) return;
  cache.text = str;
  el.textContent = str;
}

function setValueDirty(el, value) {
  if (!el) return;
  const str = String(value);
  const cache = getElCache(el);
  if (cache.val === str && el.value === str) return;
  cache.val = str;
  el.value = str;
}

function setStyleDirty(el, prop, value) {
  if (!el) return;
  const cache = getElCache(el);
  const str = String(value);
  if (cache.style[prop] === str) return;
  cache.style[prop] = str;
  el.style[prop] = str;
}

function setAttrDirty(el, name, value) {
  if (!el) return;
  const cache = getElCache(el);
  const str = String(value);
  if (cache.attr[name] === str) return;
  cache.attr[name] = str;
  el.setAttribute(name, str);
}

function setClassDirty(el, className, active) {
  if (!el) return;
  const flag = Boolean(active);
  const cache = getElCache(el);
  if (cache.cls[className] === flag) return;
  cache.cls[className] = flag;
  el.classList.toggle(className, flag);
}

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
  // Fish, Rays & Turtles (11)
  pseudanthias: { color: '#ff9033', group: 'fish' },
  chromis: { color: '#52e3cc', group: 'fish' },
  abudefduf: { color: '#e8e064', group: 'fish' },
  goatfish: { color: '#f2c89b', group: 'fish' },
  amphiprion: { color: '#ffb43b', group: 'fish' },
  chaetodon: { color: '#e43c22', group: 'fish' },
  chaetodonaustriacus: { color: '#f5c424', group: 'fish' },
  caesio: { color: '#45b8ff', group: 'fish' },
  cleanerwrasse: { color: '#29b8ff', group: 'fish' },
  taeniura: { color: '#49a6ff', group: 'fish' },
  aetobatus: { color: '#3b6df2', group: 'fish' },
  chelonia: { color: '#6dbf67', group: 'fish' },
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
  { id: 'fish', label: 'Fish & Fauna' },
  { id: 'predators', label: 'Predators' },
];

function formatTimeOfDay(hours) {
  const safeHours = Number.isFinite(hours) ? Math.max(0, hours) : 12.5;
  const totalMinutes = Math.round(safeHours * 60);
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

function circularDayDiff(dayA, dayB) {
  const diff = Math.abs(dayA - dayB);
  return Math.min(diff, 365 - diff);
}

export function computeSolarElevationFromTime(hours, dayOfYear = 87) {
  return solveFromTimeOfDay(hours, dayOfYear).sunElevation;
}

function clampNumber(value, min, max, fallback) {
  const num = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, num));
}

/**
 * Fallback Beer-Lambert + Snell + Fresnel + tortuosity transmittance model
 * matching `src/physics/waterOptics.js` when no external calculator is supplied.
 */
export function defaultTransmittance(depthMeters, envState = DEFAULT_ENV_STATE) {
  const sunElevDeg = clampNumber(envState?.sunElevation, 2, 89, DEFAULT_ENV_STATE.sunElevation);
  const t = clampNumber(envState?.turbidity, 0, 1, DEFAULT_ENV_STATE.turbidity);
  const w = clampNumber(envState?.waveIntensity, 0, 1, DEFAULT_ENV_STATE.waveIntensity);

  const nWater = WORLD_CONSTANTS.IOR_WATER;
  const eta = WORLD_CONSTANTS.IOR_AIR / nWater;
  const elevRad = (sunElevDeg * Math.PI) / 180;
  const sinElev = Math.sin(elevRad);
  const cosElev = Math.cos(elevRad);
  const cosThetaI = sinElev;
  const sinThetaI = cosElev;
  const sinThetaT = eta * sinThetaI;
  const cosThetaT = Math.sqrt(Math.max(0.0001, 1.0 - sinThetaT * sinThetaT));
  const thetaTDeg = (Math.acos(Math.min(1, Math.max(0, cosThetaT))) * 180) / Math.PI;

  const rs = (cosThetaI - nWater * cosThetaT) / (cosThetaI + nWater * cosThetaT);
  const rp = (nWater * cosThetaI - cosThetaT) / (nWater * cosThetaI + cosThetaT);
  const rFlat = 0.5 * (rs * rs + rp * rp);
  const rRough = 0.026 + 0.31 * Math.pow(Math.max(0, 1 - sinElev), 4);
  const fresnelReflectance = rFlat + (rRough - rFlat) * (0.55 * w);
  const fresnelTransmittance = 1.0 - fresnelReflectance;

  const dirWeight = (fresnelTransmittance * sinElev) / (fresnelTransmittance * sinElev + 0.22 * 0.934);
  const surfaceTransmittance = dirWeight * fresnelTransmittance + (1.0 - dirWeight) * 0.934;

  const pathTortuosity = 1.0 + 0.14 * t;
  const slantFactor = pathTortuosity / cosThetaT;

  const kr = 0.24 + t * 0.26;
  const kg = 0.055 + t * 0.18;
  const kb = 0.017 + t * 0.13;

  const d = Math.max(0, Number.isFinite(depthMeters) ? depthMeters : 0);
  const slantPath = d * slantFactor;
  const r = surfaceTransmittance * (0.78 * Math.exp(-kr * slantPath) + 0.22 * Math.exp(-0.45 * kr * slantPath));
  const g = surfaceTransmittance * Math.exp(-kg * slantPath);
  const b = surfaceTransmittance * Math.exp(-kb * slantPath);

  const threshold = 0.10;
  let penetration10 = { r: 0, g: 0, b: 0 };
  if (surfaceTransmittance > threshold) {
    const logRatio = Math.log(surfaceTransmittance / threshold);
    let lo = 0;
    let hi = 120;
    for (let i = 0; i < 24; i++) {
      const mid = 0.5 * (lo + hi);
      const midSlant = mid * slantFactor;
      const val = surfaceTransmittance * (0.78 * Math.exp(-kr * midSlant) + 0.22 * Math.exp(-0.45 * kr * midSlant));
      if (val > threshold) lo = mid;
      else hi = mid;
    }
    penetration10 = {
      r: 0.5 * (lo + hi),
      g: logRatio / (kg * slantFactor),
      b: logRatio / (kb * slantFactor),
    };
  }

  return {
    r,
    g,
    b,
    slantPath,
    slantFactor,
    thetaTDeg,
    fresnelReflectance,
    surfaceTransmittance,
    penetration10,
  };
}

/**
 * Evaluates transmittance using `calcFn` and backfills any missing optical fields
 * from `defaultTransmittance` so callers always receive the full contract.
 */
export function resolveTransmittance(calcFn, depthMeters, envState) {
  const depth = Math.max(0, Number.isFinite(depthMeters) ? depthMeters : DEFAULT_ENV_STATE.diveDepth);
  const raw = typeof calcFn === 'function' ? calcFn(depth, envState) : null;
  if (
    raw &&
    raw.penetration10 &&
    Number.isFinite(raw.slantPath) &&
    Number.isFinite(raw.slantFactor) &&
    Number.isFinite(raw.thetaTDeg) &&
    Number.isFinite(raw.fresnelReflectance) &&
    Number.isFinite(raw.surfaceTransmittance)
  ) {
    return raw;
  }
  const fb = defaultTransmittance(depth, envState);
  if (!raw) return fb;
  return {
    r: Number.isFinite(raw.r) ? raw.r : fb.r,
    g: Number.isFinite(raw.g) ? raw.g : fb.g,
    b: Number.isFinite(raw.b) ? raw.b : fb.b,
    slantPath: Number.isFinite(raw.slantPath) ? raw.slantPath : fb.slantPath,
    slantFactor: Number.isFinite(raw.slantFactor) ? raw.slantFactor : fb.slantFactor,
    thetaTDeg: Number.isFinite(raw.thetaTDeg) ? raw.thetaTDeg : fb.thetaTDeg,
    fresnelReflectance: Number.isFinite(raw.fresnelReflectance) ? raw.fresnelReflectance : fb.fresnelReflectance,
    surfaceTransmittance: Number.isFinite(raw.surfaceTransmittance) ? raw.surfaceTransmittance : fb.surfaceTransmittance,
    penetration10: raw.penetration10 || fb.penetration10,
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
  onOpenWelcome,
  onToggleColorChart,
  isColorChartVisible,
  onTourChange,
}) {
  const panel = document.createElement('aside');
  panel.id = 'hud-panel';

  const allSpecies = Object.values(SPECIES_CATALOG);
  const lastNonZeroCounts = createDefaultSpeciesCounts();
  let latestState = envState;
  let preferredHalfDay = (envState?.timeOfDay ?? 12.5) < 12 ? 'am' : 'pm';
  let activeGroup = 'all';
  let lastCcDotSig = '';

  const guideTabsMarkup = GUIDE_TABS.map(
    (tab, idx) =>
      `<button type="button" class="guide-tab${idx === 0 ? ' active' : ''}" data-group="${tab.id}">${tab.label}</button>`
  ).join('');

  const speciesRowsMarkup = allSpecies
    .map((sp) => {
      const meta = SPECIES_META[sp.id] || { color: '#3cd4e8', group: 'fish' };
      const spec = SPECIES_POPULATION_SPEC[sp.id] || { defaultCount: 1, maxCount: 1, step: 1 };
      const initCount = sanitizeSpeciesCount(sp.id, envState?.speciesCounts?.[sp.id] ?? spec.defaultCount);
      const depthLabel = `${sp.depthMin ?? 0}–${sp.depthMax ?? 40} m`;
      return `<div class="species-row${initCount === 0 ? ' is-off' : ''}" data-species-id="${sp.id}" data-group="${meta.group}">
        <button type="button" class="sp-toggle-btn${initCount > 0 ? ' active' : ''}" data-species-id="${sp.id}" role="checkbox" aria-checked="${initCount > 0}" aria-pressed="${initCount > 0}" aria-label="Include or remove ${sp.commonName} from reef" title="${initCount > 0 ? `Included in reef — click X to remove ${sp.commonName}` : `Removed from reef — click box to include ${sp.commonName}`}">${initCount > 0 ? '✕' : ''}</button>
        <button type="button" class="sp-info-btn" data-species-id="${sp.id}" title="Inspect ${sp.commonName} (${depthLabel})">
          <span class="pill-dot" style="background:${meta.color}"></span>
          <span class="sp-row-labels">
            <span class="sp-row-name">${sp.commonName}</span>
            <span class="sp-row-sub">${sp.hebrewName ? `<bdi lang="he" dir="rtl" class="sp-row-hebrew">${sp.hebrewName}</bdi><span class="sp-row-sep"> · </span>` : ''}<span class="sp-row-depth">${depthLabel}</span></span>
          </span>
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
      <div class="hud-header-actions">
        <button type="button" id="btn-open-welcome" title="About &amp; Simulation README">About</button>
        <button type="button" id="btn-toggle-hud" aria-expanded="true">Hide</button>
      </div>
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
          <div class="penetration-section">
            <div class="penetration-title">
              <span>10% Color Penetration Depth</span>
              <span id="val-pen-meta"></span>
            </div>
            <div class="pen-row">
              <span class="trans-channel r">R</span>
              <div class="pen-track">
                <div class="pen-fill r" id="bar-pen-r"></div>
                <div class="pen-depth-tick" id="tick-pen-r" title="Current Reef Depth"></div>
              </div>
              <span class="pen-val" id="val-pen-r"></span>
            </div>
            <div class="pen-row">
              <span class="trans-channel g">G</span>
              <div class="pen-track">
                <div class="pen-fill g" id="bar-pen-g"></div>
                <div class="pen-depth-tick" id="tick-pen-g" title="Current Reef Depth"></div>
              </div>
              <span class="pen-val" id="val-pen-g"></span>
            </div>
            <div class="pen-row">
              <span class="trans-channel b">B</span>
              <div class="pen-track">
                <div class="pen-fill b" id="bar-pen-b"></div>
                <div class="pen-depth-tick" id="tick-pen-b" title="Current Reef Depth"></div>
              </div>
              <span class="pen-val" id="val-pen-b"></span>
            </div>
          </div>
          <div class="spectrum-preview-row">
            <span>Reef Light</span>
            <div class="spectrum-swatch" id="bar-spectrum-swatch"></div>
            <span id="val-spectrum-note"></span>
          </div>
          <div class="hud-colorchart-bar">
            <div class="hud-cc-dots" id="hud-cc-dots" title="Live underwater ColorChecker swatches (Red, Orange, Yellow, Green, Cyan, White)">
              <span class="hud-cc-dot" data-patch-id="red"></span>
              <span class="hud-cc-dot" data-patch-id="orange"></span>
              <span class="hud-cc-dot" data-patch-id="yellow"></span>
              <span class="hud-cc-dot" data-patch-id="green"></span>
              <span class="hud-cc-dot" data-patch-id="cyan"></span>
              <span class="hud-cc-dot" data-patch-id="white-95"></span>
            </div>
            <button type="button" id="btn-toggle-color-chart" class="mini-btn hud-cc-toggle" aria-pressed="false" title="Toggle 24-Patch ColorChecker Classic chart">ColorChecker</button>
          </div>
          <div class="hud-exposure-bar">
            <div class="hud-exposure-top">
              <span class="hud-exposure-label">Exposure &amp; Brightness</span>
              <span class="control-value hud-exposure-readout" id="val-brightness-ev"></span>
            </div>
            <div class="hud-exposure-controls">
              <button type="button" id="btn-auto-exposure" class="mini-btn hud-auto-exp-btn" aria-pressed="true" title="Toggle depth/sun eye-adaptation auto-exposure">Auto</button>
              <button type="button" id="btn-brightness-dec" class="mini-btn hud-ev-step-btn" title="Darker (-0.15 EV)" aria-label="Decrease brightness">&minus;</button>
              <input id="slider-brightness-ev" class="hud-slider hud-ev-slider" type="range" min="-1.5" max="1.5" step="0.05" aria-label="Brightness offset in EV" />
              <button type="button" id="btn-brightness-inc" class="mini-btn hud-ev-step-btn" title="Brighter (+0.15 EV)" aria-label="Increase brightness">+</button>
              <button type="button" id="btn-brightness-reset" class="mini-btn hud-ev-reset-btn" title="Reset brightness offset to 0 EV">0 EV</button>
            </div>
          </div>
        </div>
      </div>

      <div class="control-group solar-coupled-group">
        <div class="solar-group-kicker">
          <span>Coupled Solar Geometry</span>
          <span>Eilat 29.6° N</span>
        </div>

        <div class="control-header">
          <label class="control-label" for="slider-sun-elevation">Sun Elevation Angle</label>
          <span class="control-value" id="val-sun-elevation"></span>
        </div>
        <input id="slider-sun-elevation" class="hud-slider" type="range" min="2" max="83.9" step="0.2" />
        <div class="control-submeta">
          <span id="val-sun-refraction"></span>
          <span id="val-sun-fresnel"></span>
        </div>

        <div class="solar-sub-block">
          <div class="control-header">
            <label class="control-label" for="slider-time-of-day">Time of Day</label>
            <span class="control-value" id="val-time-of-day"></span>
          </div>
          <input id="slider-time-of-day" class="hud-slider" type="range" min="5.2" max="18.8" step="0.05" />
          <div class="control-submeta">
            <span id="val-time-phase"></span>
            <span id="val-daylight-span"></span>
          </div>
        </div>

        <div class="solar-sub-block">
          <div class="control-header">
            <label class="control-label" for="slider-day-of-year">Time of Year</label>
            <span class="control-value" id="val-day-of-year"></span>
          </div>
          <input id="slider-day-of-year" class="hud-slider" type="range" min="1" max="365" step="1" />
          <div class="season-preset-row">
            <button type="button" class="season-chip" data-doy="80">Mar 21</button>
            <button type="button" class="season-chip" data-doy="172">Jun 21</button>
            <button type="button" class="season-chip" data-doy="265">Sep 22</button>
            <button type="button" class="season-chip" data-doy="355">Dec 21</button>
          </div>
          <div class="control-submeta">
            <span id="val-season-label"></span>
            <span id="val-noon-peak"></span>
          </div>
        </div>
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

      <div class="hud-tour-row">
        <button type="button" id="btn-hud-tour-toggle" class="hud-btn accent hud-tour-btn" aria-pressed="false">&#9654; Activate Free-Ride Tour</button>
        <button type="button" id="btn-hud-tour-restart" class="hud-btn hud-tour-restart-btn" title="Restart Free-Ride Tour from start" aria-label="Restart Reef Tour">&#8634;</button>
      </div>

      <div class="preset-grid">
        <button type="button" id="btn-preset-reef" class="hud-btn">Reef Panorama</button>
        <button type="button" id="btn-preset-snell" class="hud-btn accent">Snell's Window</button>
        <button type="button" id="btn-preset-cleaning" class="hud-btn">Cleaning Station</button>
        <button type="button" id="btn-preset-anemone" class="hud-btn">Anemone Close-up</button>
        <button type="button" id="btn-preset-ray" class="hud-btn">Bluespotted Ray</button>
        <button type="button" id="btn-preset-eagleray" class="hud-btn">Eagle Ray</button>
        <button type="button" id="btn-preset-turtle" class="hud-btn">Sea Turtle</button>
        <button type="button" id="btn-preset-moray" class="hud-btn">Moray Crevice</button>
        <button type="button" id="btn-preset-sand" class="hud-btn">Sandy Channel</button>
        <button type="button" id="btn-preset-bluewater" class="hud-btn">Blue Water Drop-Off</button>
        <button type="button" id="btn-preset-butterfly" class="hud-btn full-span">Crown Butterflyfish</button>
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

  const btnOpenWelcome = panel.querySelector('#btn-open-welcome');
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
  const valPenMeta = panel.querySelector('#val-pen-meta');
  const penChannels = [
    {
      key: 'r',
      bar: panel.querySelector('#bar-pen-r'),
      tick: panel.querySelector('#tick-pen-r'),
      val: panel.querySelector('#val-pen-r'),
    },
    {
      key: 'g',
      bar: panel.querySelector('#bar-pen-g'),
      tick: panel.querySelector('#tick-pen-g'),
      val: panel.querySelector('#val-pen-g'),
    },
    {
      key: 'b',
      bar: panel.querySelector('#bar-pen-b'),
      tick: panel.querySelector('#tick-pen-b'),
      val: panel.querySelector('#val-pen-b'),
    },
  ];
  const barSpectrumSwatch = panel.querySelector('#bar-spectrum-swatch');
  const valSpectrumNote = panel.querySelector('#val-spectrum-note');
  const ccDots = Array.from(panel.querySelectorAll('.hud-cc-dot'));
  const btnToggleColorChart = panel.querySelector('#btn-toggle-color-chart');
  const btnAutoExposure = panel.querySelector('#btn-auto-exposure');
  const btnBrightnessDec = panel.querySelector('#btn-brightness-dec');
  const sliderBrightnessEV = panel.querySelector('#slider-brightness-ev');
  const btnBrightnessInc = panel.querySelector('#btn-brightness-inc');
  const btnBrightnessReset = panel.querySelector('#btn-brightness-reset');
  const valBrightnessEV = panel.querySelector('#val-brightness-ev');

  const sliderSunElev = panel.querySelector('#slider-sun-elevation');
  const valSunElev = panel.querySelector('#val-sun-elevation');
  const valSunRefraction = panel.querySelector('#val-sun-refraction');
  const valSunFresnel = panel.querySelector('#val-sun-fresnel');

  const sliderWaves = panel.querySelector('#slider-waves');
  const valWaves = panel.querySelector('#val-waves');
  const valWaveState = panel.querySelector('#val-wave-state');

  const sliderTurbidity = panel.querySelector('#slider-turbidity');
  const valTurbidity = panel.querySelector('#val-turbidity');
  const valTurbidityLabel = panel.querySelector('#val-turbidity-label');

  const sliderTime = panel.querySelector('#slider-time-of-day');
  const valTime = panel.querySelector('#val-time-of-day');
  const valTimePhase = panel.querySelector('#val-time-phase');
  const valDaylightSpan = panel.querySelector('#val-daylight-span');

  const sliderDayOfYear = panel.querySelector('#slider-day-of-year');
  const valDayOfYear = panel.querySelector('#val-day-of-year');
  const seasonChips = Array.from(panel.querySelectorAll('.season-chip'));
  const valSeasonLabel = panel.querySelector('#val-season-label');
  const valNoonPeak = panel.querySelector('#val-noon-peak');

  const sliderCurrentDir = panel.querySelector('#slider-current-dir');
  const valCurrentDir = panel.querySelector('#val-current-dir');
  const btnFlowNs = panel.querySelector('#btn-flow-ns');
  const sliderCurrentSpeed = panel.querySelector('#slider-current-speed');
  const valCurrentSpeed = panel.querySelector('#val-current-speed');
  const valCurrentRegime = panel.querySelector('#val-current-regime');

  const btnHudTourToggle = panel.querySelector('#btn-hud-tour-toggle');
  const btnHudTourRestart = panel.querySelector('#btn-hud-tour-restart');

  const btnPresetReef = panel.querySelector('#btn-preset-reef');
  const btnPresetSnell = panel.querySelector('#btn-preset-snell');
  const btnPresetCleaning = panel.querySelector('#btn-preset-cleaning');
  const btnPresetAnemone = panel.querySelector('#btn-preset-anemone');
  const btnPresetRay = panel.querySelector('#btn-preset-ray');
  const btnPresetEagleRay = panel.querySelector('#btn-preset-eagleray');
  const btnPresetTurtle = panel.querySelector('#btn-preset-turtle');
  const btnPresetMoray = panel.querySelector('#btn-preset-moray');
  const btnPresetSand = panel.querySelector('#btn-preset-sand');
  const btnPresetBlue = panel.querySelector('#btn-preset-bluewater');
  const btnPresetButterfly = panel.querySelector('#btn-preset-butterfly');
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

  let lastTransSig = '';
  let lastSummaryCount = -1;

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
    if (lastSummaryCount !== activeSpeciesCount) {
      lastSummaryCount = activeSpeciesCount;
      setTextDirty(valSpeciesSummary, `${activeSpeciesCount}/${rowEntries.size} In Reef`);
    }
  }

  function updateTransmittanceUI(state) {
    const depth = Math.max(0, Number.isFinite(state?.diveDepth) ? state.diveDepth : DEFAULT_ENV_STATE.diveDepth);
    const sunElev = Number.isFinite(state?.sunElevation) ? state.sunElevation : DEFAULT_ENV_STATE.sunElevation;
    const turbidity = Number.isFinite(state?.turbidity) ? state.turbidity : DEFAULT_ENV_STATE.turbidity;
    const waveInt = Number.isFinite(state?.waveIntensity) ? state.waveIntensity : DEFAULT_ENV_STATE.waveIntensity;
    const transSig = `${depth.toFixed(3)}|${sunElev.toFixed(3)}|${turbidity.toFixed(4)}|${waveInt.toFixed(3)}`;
    if (transSig === lastTransSig) return;
    lastTransSig = transSig;

    const calc = getTransmittanceAtDepth || defaultTransmittance;
    const trans = resolveTransmittance(calc, depth, state);
    const r = Math.max(0, Math.min(1, trans.r ?? 0));
    const g = Math.max(0, Math.min(1, trans.g ?? 0));
    const b = Math.max(0, Math.min(1, trans.b ?? 0));
    const {
      slantPath,
      slantFactor,
      thetaTDeg,
      fresnelReflectance,
      surfaceTransmittance,
      penetration10: pen,
    } = trans;

    setStyleDirty(barR, 'width', `${(r * 100).toFixed(1)}%`);
    setStyleDirty(barG, 'width', `${(g * 100).toFixed(1)}%`);
    setStyleDirty(barB, 'width', `${(b * 100).toFixed(1)}%`);

    setTextDirty(pctR, `${Math.round(r * 100)}%`);
    setTextDirty(pctG, `${Math.round(g * 100)}%`);
    setTextDirty(pctB, `${Math.round(b * 100)}%`);
    setTextDirty(valDepthPath, `${slantPath.toFixed(1)}m slant · θₜ ${Math.round(thetaTDeg)}°`);
    setTextDirty(valSunRefraction, `Snell θₜ ${thetaTDeg.toFixed(1)}° (${slantFactor.toFixed(2)}× path)`);
    setTextDirty(valSunFresnel, `Air→Sea ${Math.round(surfaceTransmittance * 100)}% (${Math.round(fresnelReflectance * 100)}% refl)`);

    const toScalePct = (m) => Math.max(0, Math.min(100, Math.sqrt(Math.max(0, m) / 100) * 100));
    const diverTickLeft = `${toScalePct(depth).toFixed(1)}%`;
    for (const ch of penChannels) {
      const meters = Math.max(0, Number.isFinite(pen?.[ch.key]) ? pen[ch.key] : 0);
      setStyleDirty(ch.bar, 'width', `${toScalePct(meters).toFixed(1)}%`);
      setStyleDirty(ch.tick, 'left', diverTickLeft);
      setTextDirty(ch.val, `${meters.toFixed(1)}m`);
    }
    setTextDirty(valPenMeta, `Reef Floor @ ${depth.toFixed(1)}m (+${depth.toFixed(1)}m water)`);

    const swR = Math.round(Math.pow(r, 0.5) * 255);
    const swG = Math.round(Math.pow(g, 0.5) * 255);
    const swB = Math.round(Math.pow(b, 0.5) * 255);
    setStyleDirty(barSpectrumSwatch, 'background', `rgb(${swR}, ${swG}, ${swB})`);

    if (r >= 0.40) {
      setTextDirty(valSpectrumNote, 'Full Warm Spectrum');
    } else if (r >= 0.12) {
      setTextDirty(valSpectrumNote, 'Reds Fading · Cyan-Teal');
    } else if (g >= 0.16) {
      setTextDirty(valSpectrumNote, 'Reds Gone · Blue-Green');
    } else {
      setTextDirty(valSpectrumNote, 'Sapphire Blue Only');
    }

    updateColorCheckerDots(state);
  }

  function updateColorCheckerDots(state) {
    if (ccDots.length === 0) return;
    const d = Number(state?.diveDepth ?? DEFAULT_ENV_STATE.diveDepth).toFixed(3);
    const a = Number(state?.sunElevation ?? DEFAULT_ENV_STATE.sunElevation).toFixed(3);
    const t = Number(state?.turbidity ?? DEFAULT_ENV_STATE.turbidity).toFixed(4);
    const w = Number(state?.waveIntensity ?? DEFAULT_ENV_STATE.waveIntensity).toFixed(3);
    const sig = `${d}|${a}|${t}|${w}`;
    if (sig === lastCcDotSig) return;
    lastCcDotSig = sig;

    const sim = simulateColorChecker(state || DEFAULT_ENV_STATE);
    const byId = new Map();
    for (const p of sim?.patches || []) {
      byId.set(p.id, p);
    }

    for (let i = 0; i < ccDots.length; i++) {
      const dot = ccDots[i];
      const id = dot.dataset.patchId || HUD_COLORCHART_DOT_IDS[i];
      const patch = byId.get(id);
      if (!patch) continue;
      setStyleDirty(dot, 'backgroundColor', patch.underwaterHex);
      setAttrDirty(dot, 'title', `${patch.name}: ${patch.surfaceHex} -> ${patch.underwaterHex}`);
    }
  }

  function syncColorChartButton(explicitVisible) {
    if (!btnToggleColorChart) return;
    const vis = typeof explicitVisible === 'boolean'
      ? explicitVisible
      : Boolean(isColorChartVisible ? isColorChartVisible() : false);
    setAttrDirty(btnToggleColorChart, 'aria-pressed', String(vis));
    setClassDirty(btnToggleColorChart, 'is-active', vis);
  }

  function syncTourUI() {
    if (!btnHudTourToggle) return;
    const active = Boolean(cameraCtrl?.getTourState?.()?.active);
    const label = active ? '⏸ Pause Tour (Manual)' : '▶ Activate Free-Ride Tour';
    setTextDirty(btnHudTourToggle, label);
    setClassDirty(btnHudTourToggle, 'is-active', active);
    setAttrDirty(btnHudTourToggle, 'aria-pressed', String(active));
  }

  function syncFromState(state) {
    if (!state) return;
    latestState = state;
    if (document.activeElement !== sliderDepth) {
      setValueDirty(sliderDepth, state.diveDepth);
    }
    setTextDirty(valDepth, `${Number(state.diveDepth).toFixed(1)} m`);
    setTextDirty(valOpticalZone, getOpticalZoneLabel(state.diveDepth));
    for (const chip of depthChips) {
      const chipDepth = parseFloat(chip.dataset.depth);
      setClassDirty(chip, 'active', Math.abs(chipDepth - state.diveDepth) < 0.26);
    }

    const sunElev = Number.isFinite(state.sunElevation)
      ? state.sunElevation
      : (DEFAULT_ENV_STATE.sunElevation ?? 61.94);
    const timeOfDay = Number.isFinite(state.timeOfDay)
      ? state.timeOfDay
      : (DEFAULT_ENV_STATE.timeOfDay ?? 12.5);
    const rawDoy = Number.isFinite(state.dayOfYear)
      ? state.dayOfYear
      : (DEFAULT_ENV_STATE.dayOfYear ?? 87);
    const doy = Math.max(1, Math.min(365, Math.round(rawDoy)));

    if (Math.abs(timeOfDay - 12.0) > 0.02) {
      preferredHalfDay = timeOfDay < 12.0 ? 'am' : 'pm';
    }

    if (document.activeElement !== sliderSunElev) {
      setValueDirty(sliderSunElev, sunElev);
    }
    setTextDirty(valSunElev, `${Number(sunElev).toFixed(1)}°`);

    const w = state?.waveIntensity ?? DEFAULT_ENV_STATE.waveIntensity ?? 0.28;
    if (document.activeElement !== sliderWaves) {
      setValueDirty(sliderWaves, w);
    }
    setTextDirty(valWaves, `${Math.round(w * 100)}%`);
    setTextDirty(valWaveState, getWaveStateLabel(w));

    if (document.activeElement !== sliderTurbidity) {
      setValueDirty(sliderTurbidity, state.turbidity);
    }
    setTextDirty(valTurbidity, Number(state.turbidity).toFixed(2));
    setTextDirty(valTurbidityLabel, getTurbidityLabel(state.turbidity));

    if (document.activeElement !== sliderTime) {
      setValueDirty(sliderTime, timeOfDay);
    }
    setTextDirty(valTime, formatTimeOfDay(timeOfDay));
    setTextDirty(valTimePhase, getTimePhaseLabel(timeOfDay));

    if (document.activeElement !== sliderDayOfYear) {
      setValueDirty(sliderDayOfYear, doy);
    }
    setTextDirty(valDayOfYear, formatDayOfYear(doy));
    for (const chip of seasonChips) {
      const chipDoy = parseInt(chip.dataset.doy, 10);
      setClassDirty(chip, 'active', Number.isFinite(chipDoy) && circularDayDiff(chipDoy, doy) <= 3);
    }

    const daylight = computeDaylightWindow(doy, 2.0);
    setTextDirty(valDaylightSpan, `Daylight ${formatTimeOfDay(daylight.sunrise)}–${formatTimeOfDay(daylight.sunset)}`);
    setTextDirty(valSeasonLabel, getSeasonLabel(doy));
    setTextDirty(valNoonPeak, `Noon Peak ${daylight.maxElevDeg.toFixed(1)}°`);

    const curDir = state?.currentDirection ?? DEFAULT_ENV_STATE.currentDirection ?? 180;
    const curSpeed = state?.currentSpeed ?? DEFAULT_ENV_STATE.currentSpeed ?? 0.15;
    if (document.activeElement !== sliderCurrentDir) {
      setValueDirty(sliderCurrentDir, curDir);
    }
    setTextDirty(valCurrentDir, formatFlowLabel(curDir));

    if (document.activeElement !== sliderCurrentSpeed) {
      setValueDirty(sliderCurrentSpeed, curSpeed);
    }
    setTextDirty(valCurrentSpeed, `${Number(curSpeed).toFixed(2)} m/s`);
    setTextDirty(valCurrentRegime, getCurrentRegimeLabel(curSpeed));

    const autoExp = state?.autoExposure !== false;
    const rawEV = Number.isFinite(state?.brightnessEV)
      ? state.brightnessEV
      : (DEFAULT_ENV_STATE.brightnessEV ?? 0);
    const brightnessEV = clampNumber(rawEV, -1.5, 1.5, 0);
    const roundedEV = Math.abs(brightnessEV) < 0.005 ? 0 : brightnessEV;
    const evStr = `${roundedEV >= 0 ? '+' : ''}${roundedEV.toFixed(2)} EV`;
    if (document.activeElement !== sliderBrightnessEV) {
      setValueDirty(sliderBrightnessEV, roundedEV.toFixed(2));
    }
    setTextDirty(valBrightnessEV, `${autoExp ? 'Auto' : 'Manual'} · ${evStr}`);
    setClassDirty(btnAutoExposure, 'is-active', autoExp);
    setAttrDirty(btnAutoExposure, 'aria-pressed', String(autoExp));
    setClassDirty(btnBrightnessReset, 'is-active', Math.abs(roundedEV) < 0.025);

    updateTransmittanceUI(state);
    syncSpeciesRoster(state);

    if (cameraCtrl) {
      const m = cameraCtrl.getMode();
      setTextDirty(btnModeToggle, `Camera Mode: ${m === 'dive' ? 'Dive (360°)' : 'Orbit'}`);
    }
    syncTourUI();
    syncColorChartButton();
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
    const solved = solveFromSunElevation(
      val,
      latestState?.timeOfDay ?? 12.5,
      latestState?.dayOfYear ?? 87,
      preferredHalfDay
    );
    preferredHalfDay = solved.halfDay;
    onEnvChange({
      sunElevation: solved.sunElevation,
      timeOfDay: solved.timeOfDay,
      dayOfYear: solved.dayOfYear,
    });
    syncFromState({ ...latestState, ...solved });
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
    const solved = solveFromTimeOfDay(val, latestState?.dayOfYear ?? 87);
    preferredHalfDay = solved.halfDay;
    onEnvChange({
      sunElevation: solved.sunElevation,
      timeOfDay: solved.timeOfDay,
      dayOfYear: solved.dayOfYear,
    });
    syncFromState({ ...latestState, ...solved });
  }

  function onDayOfYearInput() {
    const val = parseInt(sliderDayOfYear.value, 10);
    if (!Number.isFinite(val)) return;
    const solved = solveFromDayOfYear(val, latestState?.timeOfDay ?? 12.5);
    preferredHalfDay = solved.halfDay;
    onEnvChange({
      sunElevation: solved.sunElevation,
      timeOfDay: solved.timeOfDay,
      dayOfYear: solved.dayOfYear,
    });
    syncFromState({ ...latestState, ...solved });
  }

  function onSeasonChipClick(e) {
    const btn = e.currentTarget;
    const doy = parseInt(btn.dataset.doy, 10);
    if (!Number.isFinite(doy)) return;
    const solved = solveFromDayOfYear(doy, latestState?.timeOfDay ?? 12.5);
    preferredHalfDay = solved.halfDay;
    sliderDayOfYear.value = String(solved.dayOfYear);
    onEnvChange({
      sunElevation: solved.sunElevation,
      timeOfDay: solved.timeOfDay,
      dayOfYear: solved.dayOfYear,
    });
    syncFromState({ ...latestState, ...solved });
    btn.blur();
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
    const defaultSpeed = DEFAULT_ENV_STATE.currentSpeed ?? 0.15;
    const defaultDir = DEFAULT_ENV_STATE.currentDirection ?? 180;
    onEnvChange({ currentDirection: defaultDir, currentSpeed: defaultSpeed });
    syncFromState({ ...latestState, currentDirection: defaultDir, currentSpeed: defaultSpeed });
    btnFlowNs.blur();
  }

  function onOpenWelcomeClick() {
    onOpenWelcome?.();
    btnOpenWelcome.blur();
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

  function stepBrightnessEV(delta) {
    const cur = clampNumber(
      latestState?.brightnessEV,
      -1.5,
      1.5,
      DEFAULT_ENV_STATE.brightnessEV ?? 0
    );
    const next = Math.round(clampNumber(cur + delta, -1.5, 1.5, 0) * 100) / 100;
    onEnvChange({ brightnessEV: next });
    syncFromState({ ...latestState, brightnessEV: next });
  }

  function onAutoExposureClick() {
    const next = !(latestState?.autoExposure !== false);
    onEnvChange({ autoExposure: next });
    syncFromState({ ...latestState, autoExposure: next });
    btnAutoExposure.blur();
  }

  function onBrightnessDecClick() {
    stepBrightnessEV(-0.15);
    btnBrightnessDec.blur();
  }

  function onBrightnessIncClick() {
    stepBrightnessEV(0.15);
    btnBrightnessInc.blur();
  }

  function onBrightnessResetClick() {
    onEnvChange({ brightnessEV: 0.0 });
    syncFromState({ ...latestState, brightnessEV: 0.0 });
    btnBrightnessReset.blur();
  }

  function onBrightnessEVInput() {
    const val = parseFloat(sliderBrightnessEV.value);
    if (!Number.isFinite(val)) return;
    const clamped = clampNumber(val, -1.5, 1.5, 0);
    onEnvChange({ brightnessEV: clamped });
    syncFromState({ ...latestState, brightnessEV: clamped });
  }

  function onToggleColorChartClick() {
    const nextVis = onToggleColorChart?.();
    if (typeof nextVis === 'boolean') {
      syncColorChartButton(nextVis);
    } else {
      syncColorChartButton();
    }
    btnToggleColorChart.blur();
  }

  function onHudTourToggleClick() {
    cameraCtrl?.toggleTour?.();
    syncTourUI();
    onTourChange?.();
    btnHudTourToggle.blur();
  }

  function onHudTourRestartClick() {
    cameraCtrl?.restartTour?.();
    syncTourUI();
    onTourChange?.();
    btnHudTourRestart.blur();
  }

  function onPresetReef() {
    cameraCtrl?.setPreset('reef');
    syncTourUI();
    onTourChange?.();
    btnPresetReef.blur();
  }

  function onPresetSnell() {
    cameraCtrl?.setPreset('snells-window');
    syncTourUI();
    onTourChange?.();
    btnPresetSnell.blur();
  }

  function onPresetAnemone() {
    cameraCtrl?.setPreset('anemone-closeup');
    syncTourUI();
    onTourChange?.();
    btnPresetAnemone.blur();
  }

  function onPresetSand() {
    cameraCtrl?.setPreset('sandy-channel');
    syncTourUI();
    onTourChange?.();
    btnPresetSand.blur();
  }

  function onPresetBlue() {
    cameraCtrl?.setPreset('blue-water');
    syncTourUI();
    onTourChange?.();
    btnPresetBlue.blur();
  }

  function onPresetButterfly() {
    cameraCtrl?.setPreset('crown-butterfly');
    syncTourUI();
    onTourChange?.();
    btnPresetButterfly.blur();
  }

  function onPresetCleaning() {
    cameraCtrl?.setPreset('cleaning-station');
    syncTourUI();
    onTourChange?.();
    btnPresetCleaning.blur();
  }

  function onPresetRay() {
    cameraCtrl?.setPreset('ribbontail-ray');
    syncTourUI();
    onTourChange?.();
    btnPresetRay.blur();
  }
  function onPresetEagleRay() {
    cameraCtrl?.setPreset('eagle-ray');
    syncTourUI();
    onTourChange?.();
    btnPresetEagleRay.blur();
  }

  function onPresetTurtle() {
    cameraCtrl?.setPreset('sea-turtle');
    syncTourUI();
    onTourChange?.();
    btnPresetTurtle.blur();
  }

  function onPresetMoray() {
    cameraCtrl?.setPreset('moray-crevice');
    syncTourUI();
    onTourChange?.();
    btnPresetMoray.blur();
  }

  function onModeToggle() {
    if (!cameraCtrl) return;
    const next = cameraCtrl.getMode() === 'orbit' ? 'dive' : 'orbit';
    cameraCtrl.setMode(next);
    btnModeToggle.textContent = `Camera Mode: ${next === 'dive' ? 'Dive (360°)' : 'Orbit'}`;
    syncTourUI();
    onTourChange?.();
    btnModeToggle.blur();
  }

  function onSliderCommitBlur(e) {
    e.currentTarget?.blur?.();
  }

  function onSliderKeyDown(e) {
    if (e.code === 'Escape') {
      e.currentTarget?.blur?.();
    }
  }

  function onPanelPointerClickBlur(e) {
    if (e.detail > 0) {
      e.target?.closest?.('button')?.blur?.();
    }
  }

  const sliderBindings = [
    [sliderDepth, onDepthInput],
    [sliderBrightnessEV, onBrightnessEVInput],
    [sliderSunElev, onSunElevInput],
    [sliderWaves, onWavesInput],
    [sliderTurbidity, onTurbidityInput],
    [sliderTime, onTimeInput],
    [sliderDayOfYear, onDayOfYearInput],
    [sliderCurrentDir, onCurrentDirInput],
    [sliderCurrentSpeed, onCurrentSpeedInput],
  ];

  for (const [slider, handler] of sliderBindings) {
    slider.addEventListener('input', handler);
    slider.addEventListener('change', handler);
    slider.addEventListener('change', onSliderCommitBlur);
    slider.addEventListener('pointerup', onSliderCommitBlur);
    slider.addEventListener('keydown', onSliderKeyDown);
  }
  panel.addEventListener('click', onPanelPointerClickBlur);
  for (const chip of depthChips) {
    chip.addEventListener('click', onDepthChipClick);
  }
  for (const chip of seasonChips) {
    chip.addEventListener('click', onSeasonChipClick);
  }
  btnAutoExposure.addEventListener('click', onAutoExposureClick);
  btnBrightnessDec.addEventListener('click', onBrightnessDecClick);
  btnBrightnessInc.addEventListener('click', onBrightnessIncClick);
  btnBrightnessReset.addEventListener('click', onBrightnessResetClick);
  btnFlowNs.addEventListener('click', onFlowResetClick);
  btnOpenWelcome.addEventListener('click', onOpenWelcomeClick);
  btnToggleHud.addEventListener('click', onToggleHud);
  btnToggleGuide.addEventListener('click', onToggleGuide);
  btnToggleColorChart.addEventListener('click', onToggleColorChartClick);
  btnHudTourToggle.addEventListener('click', onHudTourToggleClick);
  btnHudTourRestart.addEventListener('click', onHudTourRestartClick);
  btnPresetReef.addEventListener('click', onPresetReef);
  btnPresetSnell.addEventListener('click', onPresetSnell);
  btnPresetCleaning.addEventListener('click', onPresetCleaning);
  btnPresetAnemone.addEventListener('click', onPresetAnemone);
  btnPresetRay.addEventListener('click', onPresetRay);
  btnPresetEagleRay.addEventListener('click', onPresetEagleRay);
  btnPresetTurtle.addEventListener('click', onPresetTurtle);
  btnPresetMoray.addEventListener('click', onPresetMoray);
  btnPresetSand.addEventListener('click', onPresetSand);
  btnPresetBlue.addEventListener('click', onPresetBlue);
  btnPresetButterfly.addEventListener('click', onPresetButterfly);
  btnModeToggle.addEventListener('click', onModeToggle);
  for (const tab of guideTabs) {
    tab.addEventListener('click', onTabClick);
  }
  btnSpeciesEnableTab.addEventListener('click', onEnableTabClick);
  btnSpeciesClearTab.addEventListener('click', onClearTabClick);
  btnSpeciesReset.addEventListener('click', onResetAllSpeciesClick);
  rosterList.addEventListener('click', onRosterClick);

  syncFromState(envState);

  if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 780px)').matches) {
    panel.classList.add('collapsed');
    setTextDirty(btnToggleHud, 'Controls');
    setAttrDirty(btnToggleHud, 'aria-expanded', 'false');
  }

  function setActiveSpecies(speciesId) {
    for (const entry of rowEntries.values()) {
      entry.row.classList.toggle('active', entry.id === speciesId);
    }
  }

  function dispose() {
    for (const [slider, handler] of sliderBindings) {
      slider.removeEventListener('input', handler);
      slider.removeEventListener('change', handler);
      slider.removeEventListener('change', onSliderCommitBlur);
      slider.removeEventListener('pointerup', onSliderCommitBlur);
      slider.removeEventListener('keydown', onSliderKeyDown);
    }
    panel.removeEventListener('click', onPanelPointerClickBlur);
    for (const chip of depthChips) {
      chip.removeEventListener('click', onDepthChipClick);
    }
    for (const chip of seasonChips) {
      chip.removeEventListener('click', onSeasonChipClick);
    }
    btnAutoExposure.removeEventListener('click', onAutoExposureClick);
    btnBrightnessDec.removeEventListener('click', onBrightnessDecClick);
    btnBrightnessInc.removeEventListener('click', onBrightnessIncClick);
    btnBrightnessReset.removeEventListener('click', onBrightnessResetClick);
    btnFlowNs.removeEventListener('click', onFlowResetClick);
    btnOpenWelcome.removeEventListener('click', onOpenWelcomeClick);
    btnToggleHud.removeEventListener('click', onToggleHud);
    btnToggleGuide.removeEventListener('click', onToggleGuide);
    btnToggleColorChart.removeEventListener('click', onToggleColorChartClick);
    btnHudTourToggle.removeEventListener('click', onHudTourToggleClick);
    btnHudTourRestart.removeEventListener('click', onHudTourRestartClick);
    btnPresetReef.removeEventListener('click', onPresetReef);
    btnPresetSnell.removeEventListener('click', onPresetSnell);
    btnPresetCleaning.removeEventListener('click', onPresetCleaning);
    btnPresetAnemone.removeEventListener('click', onPresetAnemone);
    btnPresetRay.removeEventListener('click', onPresetRay);
    btnPresetEagleRay.removeEventListener('click', onPresetEagleRay);
    btnPresetTurtle.removeEventListener('click', onPresetTurtle);
    btnPresetMoray.removeEventListener('click', onPresetMoray);
    btnPresetSand.removeEventListener('click', onPresetSand);
    btnPresetBlue.removeEventListener('click', onPresetBlue);
    btnPresetButterfly.removeEventListener('click', onPresetButterfly);
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
    syncTourUI,
    syncColorChartButton,
    setActiveSpecies,
    dispose,
  };
}
