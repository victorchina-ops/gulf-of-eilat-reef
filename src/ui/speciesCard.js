import {
  SPECIES_CATALOG,
  SPECIES_POPULATION_SPEC,
  createDefaultSpeciesCounts,
  sanitizeSpeciesCount,
} from '../contracts.js';
import { defaultTransmittance, resolveTransmittance } from './hud.js';

/**
 * Manages the floating hover tooltip (#species-tooltip) and
 * the detailed Species Info Card (#species-card).
 */
export function createSpeciesCard({ root, getTransmittanceAtDepth, onEnvChange, onClose }) {
  const tooltip = document.createElement('div');
  tooltip.id = 'species-tooltip';
  tooltip.innerHTML = `
    <div class="tooltip-common" id="tooltip-common"></div>
    <div class="tooltip-sci" id="tooltip-sci"></div>
  `;
  root.appendChild(tooltip);

  const tooltipCommon = tooltip.querySelector('#tooltip-common');
  const tooltipSci = tooltip.querySelector('#tooltip-sci');

  const card = document.createElement('section');
  card.id = 'species-card';
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `
    <div class="species-card-header">
      <div>
        <h2 class="species-common-name" id="sp-common"></h2>
        <div class="species-sci-name" id="sp-sci"></div>
      </div>
      <button type="button" id="btn-close-species" aria-label="Close species card">&times;</button>
    </div>

    <div class="sp-card-pop-row" id="sp-card-pop-row">
      <div class="sp-card-pop-label">Reef Population</div>
      <div class="sp-card-pop-controls">
        <button type="button" id="sp-card-toggle" class="sp-card-toggle-btn active" role="checkbox" aria-checked="true" aria-pressed="true"><span class="sp-card-check" id="sp-card-check">✕</span><span id="sp-card-toggle-label">In Reef</span></button>
        <div class="sp-stepper">
          <button type="button" id="sp-card-dec" class="sp-step-btn" aria-label="Decrease population">&minus;</button>
          <span class="sp-count-badge" id="sp-card-count">0</span>
          <button type="button" id="sp-card-inc" class="sp-step-btn" aria-label="Increase population">+</button>
        </div>
      </div>
    </div>

    <div class="species-meta-grid">
      <div class="species-meta-item">
        <div class="meta-label">Category</div>
        <div class="meta-value" id="sp-category"></div>
      </div>
      <div class="species-meta-item">
        <div class="meta-label">Depth Range</div>
        <div class="meta-value" id="sp-depth-range"></div>
      </div>
      <div class="species-meta-item full">
        <div class="meta-label">Red Sea Status</div>
        <div class="meta-value" id="sp-status"></div>
      </div>
      <div class="species-meta-item full">
        <div class="meta-label">Diet &amp; Trophic Role</div>
        <div class="meta-value" id="sp-diet"></div>
      </div>
    </div>

    <div class="species-block" id="sp-description"></div>

    <div class="species-optical-box">
      <div class="optical-depth-badge" id="sp-optical-badge"></div>
      <div id="sp-optical-note"></div>
    </div>
  `;
  root.appendChild(card);

  const btnClose = card.querySelector('#btn-close-species');
  const btnPopToggle = card.querySelector('#sp-card-toggle');
  const elPopCheck = card.querySelector('#sp-card-check');
  const elPopToggleLabel = card.querySelector('#sp-card-toggle-label');
  const btnPopDec = card.querySelector('#sp-card-dec');
  const btnPopInc = card.querySelector('#sp-card-inc');
  const elPopCount = card.querySelector('#sp-card-count');
  const elCommon = card.querySelector('#sp-common');
  const elSci = card.querySelector('#sp-sci');
  const elCategory = card.querySelector('#sp-category');
  const elDepthRange = card.querySelector('#sp-depth-range');
  const elStatus = card.querySelector('#sp-status');
  const elDiet = card.querySelector('#sp-diet');
  const elDesc = card.querySelector('#sp-description');
  const elOpticalBadge = card.querySelector('#sp-optical-badge');
  const elOpticalNote = card.querySelector('#sp-optical-note');

  let activeSpeciesId = null;
  let latestEnvState = null;
  const lastNonZeroCounts = createDefaultSpeciesCounts();

  function showTooltip(speciesId, clientX, clientY) {
    const sp = SPECIES_CATALOG[speciesId];
    if (!sp) {
      hideTooltip();
      return;
    }
    tooltipCommon.textContent = sp.commonName;
    tooltipSci.textContent = sp.scientificName;
    tooltip.classList.add('visible');

    const pad = 14;
    const rect = tooltip.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 10);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 10);
    const left = Math.min(maxLeft, clientX + pad);
    const top = Math.min(maxTop, clientY + pad);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    tooltip.classList.remove('visible');
  }

  function getActiveCount(state) {
    if (!activeSpeciesId) return 0;
    const spec = SPECIES_POPULATION_SPEC[activeSpeciesId];
    const fallback = spec ? spec.defaultCount : 0;
    return sanitizeSpeciesCount(activeSpeciesId, state?.speciesCounts?.[activeSpeciesId] ?? fallback);
  }

  function updatePopulationRow(envState) {
    if (!activeSpeciesId) return;
    const spec = SPECIES_POPULATION_SPEC[activeSpeciesId] || { defaultCount: 1, maxCount: 1, step: 1 };
    const count = getActiveCount(envState);
    if (count > 0) {
      lastNonZeroCounts[activeSpeciesId] = count;
    }
    const isOn = count > 0;
    btnPopToggle.classList.toggle('active', isOn);
    elPopCheck.textContent = isOn ? '✕' : '';
    elPopToggleLabel.textContent = isOn ? 'In Reef' : 'Removed';
    btnPopToggle.setAttribute('aria-checked', String(isOn));
    btnPopToggle.setAttribute('aria-pressed', String(isOn));
    btnPopToggle.title = isOn
      ? 'Included in reef — click X to remove'
      : 'Removed from reef — click box to include';
    elPopCount.textContent = `${count} / ${spec.maxCount}`;
    btnPopDec.disabled = count <= 0;
    btnPopInc.disabled = count >= spec.maxCount;
  }

  function applySpeciesCount(nextCount) {
    if (!activeSpeciesId) return;
    const clamped = sanitizeSpeciesCount(activeSpeciesId, nextCount);
    if (clamped > 0) {
      lastNonZeroCounts[activeSpeciesId] = clamped;
    }
    const baseCounts = latestEnvState?.speciesCounts || createDefaultSpeciesCounts();
    latestEnvState = {
      ...(latestEnvState || {}),
      speciesCounts: { ...baseCounts, [activeSpeciesId]: clamped },
    };
    onEnvChange?.({ speciesCounts: { [activeSpeciesId]: clamped } });
    updatePopulationRow(latestEnvState);
  }

  function updateOpticalContext(envState) {
    if (envState) {
      latestEnvState = envState;
    }
    if (!activeSpeciesId) return;
    const activeEnv = envState || latestEnvState;
    const depth = activeEnv?.diveDepth ?? 6.0;
    const calc = getTransmittanceAtDepth || defaultTransmittance;
    const trans = resolveTransmittance(calc, depth, activeEnv);
    const slantPath = Math.max(0, Number.isFinite(trans.slantPath) ? trans.slantPath : depth);
    const rPct = Math.round(Math.max(0, Math.min(1, trans.r ?? 0)) * 100);
    const gPct = Math.round(Math.max(0, Math.min(1, trans.g ?? 0)) * 100);
    const bPct = Math.round(Math.max(0, Math.min(1, trans.b ?? 0)) * 100);
    elOpticalBadge.textContent = `Optical Note @ ${depth.toFixed(1)} m (${slantPath.toFixed(1)} m slant · R ${rPct}% · G ${gPct}% · B ${bPct}%)`;
    updatePopulationRow(activeEnv);
  }

  function showSpecies(speciesId, envState) {
    const sp = SPECIES_CATALOG[speciesId];
    if (!sp) {
      close();
      return;
    }
    activeSpeciesId = speciesId;
    if (envState) {
      latestEnvState = envState;
    }
    elCommon.textContent = sp.commonName;
    elSci.textContent = sp.scientificName;
    elCategory.textContent = sp.category;
    elDepthRange.textContent = sp.depthRange;
    elStatus.textContent = sp.status;
    elDiet.textContent = sp.diet;
    elDesc.textContent = '';
    const paragraphs = String(sp.description || '')
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const para of paragraphs) {
      const p = document.createElement('p');
      p.className = 'sp-desc-para';
      p.setAttribute('dir', 'auto');
      p.textContent = para;
      elDesc.appendChild(p);
    }
    elOpticalNote.textContent = sp.opticalNote;
    updateOpticalContext(latestEnvState);
    card.classList.add('visible');
  }

  function close() {
    activeSpeciesId = null;
    card.classList.remove('visible');
    if (onClose) onClose();
  }

  function onPopToggleClick() {
    if (!activeSpeciesId) return;
    const spec = SPECIES_POPULATION_SPEC[activeSpeciesId] || { defaultCount: 1, maxCount: 1, step: 1 };
    const current = getActiveCount(latestEnvState);
    if (current > 0) {
      lastNonZeroCounts[activeSpeciesId] = current;
      applySpeciesCount(0);
    } else {
      const remembered = lastNonZeroCounts[activeSpeciesId] > 0 ? lastNonZeroCounts[activeSpeciesId] : spec.defaultCount;
      applySpeciesCount(remembered);
    }
    btnPopToggle.blur();
  }

  function onPopDecClick() {
    if (!activeSpeciesId) return;
    const spec = SPECIES_POPULATION_SPEC[activeSpeciesId] || { defaultCount: 1, maxCount: 1, step: 1 };
    const current = getActiveCount(latestEnvState);
    applySpeciesCount(Math.max(0, current - spec.step));
    btnPopDec.blur();
  }

  function onPopIncClick() {
    if (!activeSpeciesId) return;
    const spec = SPECIES_POPULATION_SPEC[activeSpeciesId] || { defaultCount: 1, maxCount: 1, step: 1 };
    const current = getActiveCount(latestEnvState);
    applySpeciesCount(Math.min(spec.maxCount, current + spec.step));
    btnPopInc.blur();
  }

  function onCloseClick() {
    close();
    btnClose.blur();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && activeSpeciesId) {
      close();
    }
  }

  btnPopToggle.addEventListener('click', onPopToggleClick);
  btnPopDec.addEventListener('click', onPopDecClick);
  btnPopInc.addEventListener('click', onPopIncClick);
  btnClose.addEventListener('click', onCloseClick);
  window.addEventListener('keydown', onKeyDown);

  function dispose() {
    btnPopToggle.removeEventListener('click', onPopToggleClick);
    btnPopDec.removeEventListener('click', onPopDecClick);
    btnPopInc.removeEventListener('click', onPopIncClick);
    btnClose.removeEventListener('click', onCloseClick);
    window.removeEventListener('keydown', onKeyDown);
    tooltip.remove();
    card.remove();
  }

  return {
    showTooltip,
    hideTooltip,
    showSpecies,
    update: updateOpticalContext,
    close,
    getActiveSpeciesId: () => activeSpeciesId,
    dispose,
  };
}
