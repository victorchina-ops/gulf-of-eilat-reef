import versionInfo from 'virtual:reef-version';
import v1PanoramaUrl from '../assets/evolution/v1-panorama-hud.jpg?inline';
import v1ReefUrl from '../assets/evolution/v1-reef-view.jpg?inline';
import latestPanoramaUrl from '../assets/evolution/latest-panorama-hud.jpg?inline';
import latestReefUrl from '../assets/evolution/latest-reef-view.jpg?inline';

const MOVEMENT_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyC',
  'KeyR',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

const MOVEMENT_KEYS = new Set([
  ' ',
  'Spacebar',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'w',
  'W',
  'a',
  'A',
  's',
  'S',
  'd',
  'D',
  'q',
  'Q',
  'e',
  'E',
  'c',
  'C',
  'r',
  'R',
]);

function shouldSkipWelcomeOnLoad() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('skipWelcome') === '1';
  } catch {
    return false;
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatChangelogInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/[\u0590-\u05FF]+(?:\s+[\u0590-\u05FF]+)*/g, '<bdi lang="he" dir="rtl">$&</bdi>');
  return out;
}

/**
 * Creates the introductory README / Welcome modal overlay with integrated V1 vs. Current
 * visual comparison and auto-synced Git + Changelog version history.
 * Opens on startup unless `?skipWelcome=1` is present in the URL query string.
 */
export function createWelcomeScreen({ root, captureLiveSnapshot } = {}) {
  let openState = false;
  let activeScene = 'panorama';
  let activeLayout = 'split';
  let activeHistoryTab = 'commits';
  let liveSnapshotUrl = null;

  const commits = Array.isArray(versionInfo?.commits) ? versionInfo.commits : [];
  const changelogSections = Array.isArray(versionInfo?.changelogSections)
    ? versionInfo.changelogSections
    : [];
  const versionNum = Number.isFinite(versionInfo?.version) ? versionInfo.version : Math.max(19, commits.length);
  const versionTag = String(versionInfo?.tag || `v${versionNum}`).toUpperCase();
  const latestDate = versionInfo?.latestDate || '2026-11-16';
  const totalCommitsCount = commits.length > 0 ? commits.length : versionNum;

  const commitsMarkup =
    commits.length > 0
      ? commits
          .map((c, idx) => {
            const isLatest = idx === 0;
            const badgeText = isLatest ? `${escapeHtml(c.tag.toUpperCase())} · LATEST` : escapeHtml(c.tag.toUpperCase());
            const hashText = escapeHtml(c.hash);
            return `<div class="version-row${isLatest ? ' is-latest' : ''}">
              <span class="ver-badge">${badgeText}</span>
              <span class="ver-date">${escapeHtml(c.date)}</span>
              <span class="ver-subject">${escapeHtml(c.subject)}</span>
              <a class="ver-hash" href="https://github.com/victorchina-ops/gulf-of-eilat-reef/commit/${encodeURIComponent(c.hash)}" target="_blank" rel="noopener noreferrer" title="View commit ${hashText} on GitHub">${hashText}</a>
            </div>`;
          })
          .join('')
      : `<div class="version-row is-latest">
          <span class="ver-badge">${escapeHtml(versionTag)} · LATEST</span>
          <span class="ver-date">${escapeHtml(latestDate)}</span>
          <span class="ver-subject">Current release build</span>
          <a class="ver-hash" href="https://github.com/victorchina-ops/gulf-of-eilat-reef/commits/main" target="_blank" rel="noopener noreferrer">commits</a>
        </div>`;

  const changelogMarkup =
    changelogSections.length > 0
      ? changelogSections
          .map((sec) => {
            const bulletsHtml = (sec.bullets || [])
              .map((b) => `<li>${formatChangelogInline(b)}</li>`)
              .join('');
            return `<div class="welcome-changelog-item">
              <strong>${formatChangelogInline(sec.heading)}</strong>
              ${bulletsHtml ? `<ul class="welcome-changelog-bullets">${bulletsHtml}</ul>` : ''}
            </div>`;
          })
          .join('')
      : '<div class="welcome-changelog-item"><strong>Changelog unavailable</strong></div>';

  const overlay = document.createElement('div');
  overlay.id = 'welcome-overlay';
  overlay.className = 'welcome-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'welcome-title');
  overlay.setAttribute('aria-hidden', 'true');

  overlay.innerHTML = `
    <div class="welcome-card">
      <header class="welcome-header">
        <span class="welcome-eyebrow">GULF OF EILAT · NORTHERN RED SEA · PHYSICAL REEF SIMULATION · ${escapeHtml(versionTag)}</span>
        <h1 id="welcome-title">Gulf of Eilat — 3D Coral Reef Ecosystem</h1>
        <p class="welcome-intro">
          An interactive real-time 3D physical simulation of a Gulf of Eilat coral reef — coupling
          underwater radiative transfer, surface wave optics, Red Sea hydrodynamics, and
          FishBase-calibrated reef ecology.
        </p>
        <div class="welcome-author-bar">
          <span class="welcome-author-item">
            <span class="welcome-author-label">Author</span>
            <strong class="welcome-author-name">Victor Rina (China)</strong>
          </span>
          <span class="welcome-author-sep" aria-hidden="true">·</span>
          <a id="welcome-email-link" class="welcome-author-link" href="mailto:victor.china@gmail.com">victor.china@gmail.com</a>
          <span class="welcome-author-sep" aria-hidden="true">·</span>
          <a class="welcome-author-link" href="https://github.com/victorchina-ops/gulf-of-eilat-reef" target="_blank" rel="noopener noreferrer">GitHub Repository</a>
          <span class="welcome-author-sep" aria-hidden="true">·</span>
          <button type="button" id="welcome-jump-evolution" class="welcome-author-link welcome-link-btn">V1 → ${escapeHtml(versionTag)} Evolution &amp; History</button>
          <span class="welcome-author-sep" aria-hidden="true">·</span>
          <a id="welcome-changelog-link" class="welcome-author-link" href="https://github.com/victorchina-ops/gulf-of-eilat-reef/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">CHANGELOG.md</a>
        </div>
      </header>

      <div class="welcome-body">
        <div class="welcome-section-label">What Is Simulated</div>
        <div class="welcome-grid">
          <section class="welcome-feature-card">
            <h2>Underwater Radiative Transfer &amp; ColorChecker</h2>
            <p>
              Jerlov Type I–III Beer–Lambert attenuation across 1–40 m with Snell slant-path
              refraction (<code>d(1+0.14t)/cos θₜ</code>), Cox–Munk Fresnel reflectance, dynamic
              eye-adaptation exposure, PCF soft shadows, and a toggleable
              <strong>24-Patch X-Rite ColorChecker Classic</strong> slate sharing horizontal view
              extinction (<code>c<sub>rgb</sub></code>), Snell's Window (<code>n<sup>2</sup> = 1.773</code>)
              with TIR reef bounce, and coupled Eilat (<code>29.55° N, 34.92° E</code>)
              <strong>Sun Elevation ↔ Time ↔ Year</strong> geometry.
            </p>
          </section>

          <section class="welcome-feature-card">
            <h2>Benthic Hydrodynamics &amp; 960-Sample Reef Tour</h2>
            <p>
              Eilat mean reef current (<code>0.15 m/s</code>, <code>0–1.2 m/s</code> range) with
              a benthic logarithmic boundary layer, Airy wave orbitals, and bommy lee wakes driving
              plankton drift, soft corals, and fish rheotaxis—paired with a <strong>960-sample
              Gaussian-smoothed Free-Ride Tour</strong>, bommy-gliding dive camera, Phone Motion 360°, and
              <strong>Cinema Mode</strong> (<code>H</code>).
            </p>
          </section>

          <section class="welcome-feature-card">
            <h2>30 Calibrated Gulf of Eilat Species</h2>
            <p>
              7 stony &amp; soft corals (<em>Acropora</em>, <em>Stylophora</em>, <em>Millepora</em>,
              <em>Platygyra</em>, <em>Porites</em>, <em>Dendronephthya</em>, <em>Sarcophyton</em>
              with procedural polyps), 6 invertebrates (<em>Entacmaea</em> anemone, <em>Diadema</em>
              urchin, <em>Tridacna</em> clam, starfish, sea cucumber, feather star), and 17
              biologically scaled reef fishes, rays, <em>Chelonia mydas</em> green sea turtles,
              and predators with English &amp; Hebrew names.
            </p>
          </section>

          <section class="welcome-feature-card">
            <h2>Mutualism, Dimorphism &amp; Ethology</h2>
            <p>
              5 elevated <em>Labroides dimidiatus</em> cleaning stations staffed by bonded size-dimorphic pairs
              (seesaw advertising dance, predator tactile massage, 5-zone parasite nipping, and multi-guild client
              soliciting truce including green sea turtles),
              <em>Amphiprion bicinctus</em> +30% female/male/juvenile anemone hierarchy, 1:10
              <em>Pseudanthias</em> sexual dimorphism, <em>Taeniura lymma (Fabricius, 1775)</em> (מחבטן הספירים)
              ribbontail ray, <em>Aetobatus ocellatus (Kuhl, 1823)</em> (טחן נקוד) spotted eagle ray,
              <em>Chelonia mydas</em> green sea turtle, <em>Gymnothorax griseus</em> moray, and
              predator-only fear responses.
            </p>
          </section>
        </div>

        <section class="welcome-physics-section" aria-labelledby="welcome-physics-heading">
          <div id="welcome-physics-heading" class="welcome-section-label">
            Physics Basis of Underwater Light &amp; Hydrodynamics
          </div>
          <div class="welcome-physics-grid">
            <article class="welcome-physics-card">
              <h3>1. Spencer (1971) Solar Calendar &amp; EoT</h3>
              <p>
                Evaluated for Eilat (<code>29.55° N, 34.92° E</code>) using Spencer's Fourier solar
                declination <code>δ(N)</code> and Equation of Time <code>EoT(N)</code> to couple clock
                time, sun elevation, and azimuth:
              </p>
              <div class="welcome-eq">
                t<sub>solar</sub> = t<sub>clock</sub> + (EoT(N) + 4(λ − λ<sub>tz</sub>))/60<br />
                sin α = sin φ sin δ + cos φ cos δ cos H &nbsp;(α ≥ 2.0°)
              </div>
            </article>

            <article class="welcome-physics-card">
              <h3>2. Kasten–Young (1989) Air Mass</h3>
              <p>
                Revised Kasten–Young optical air mass drives Rayleigh/aerosol atmospheric transmission,
                twilight dimming, and dynamic retinal auto-exposure adaptation (<code>0.78–2.25×</code>):
              </p>
              <div class="welcome-eq">
                AM(α) = [max(0.015, sin α) + 0.50572(α° + 6.07995)<sup>−1.6364</sup>]<sup>−1</sup><br />
                T<sub>atm</sub>(λ) = exp(−k<sub>atm</sub>·AM), &nbsp;E<sub>adapt</sub> = clamp(0.96·L<sup>−0.34</sup>, 0.78, 2.25)
              </div>
            </article>

            <article class="welcome-physics-card">
              <h3>3. Circular Snell's Window &amp; Wave Caustics</h3>
              <p>
                Refraction at <code>n<sub>w</sub> = 1.3315</code> (<code>n<sup>2</sup> = 1.773</code>)
                forms a circular <code>48.66°</code> sky cone framed cleanly overhead via smooth zenith
                FOV expansion (<code>108°</code>), while triple-layer Voronoi surface focusing creates
                <code>&gt;10×</code> caustic peak-to-trough seabed contrast:
              </p>
              <div class="welcome-eq">
                θ<sub>c</sub> = arcsin(1/n<sub>w</sub>) = 48.66° · ΔI<sub>caustic</sub> &gt; 10× (trough defocus + cusp focus)<br />
                R = lerp(R<sub>flat</sub>, R<sub>rough</sub>, 0.55w) · T<sub>surf</sub> = w<sub>dir</sub>(1−R) + (1−w<sub>dir</sub>)T<sub>sky</sub>
              </div>
            </article>

            <article class="welcome-physics-card">
              <h3>4. Jerlov Optics &amp; Vertical Attenuation</h3>
              <p>
                Jerlov clear-to-turbid diffuse attenuation <code>K(t)</code> increases with suspended
                CDOM/particulates along the refracted slant path with a bi-exponential red tail:
              </p>
              <div class="welcome-eq">
                K(t) = (0.24, 0.055, 0.017) + t·(0.26, 0.14, 0.19) m<sup>−1</sup><br />
                ℓ = d(1 + 0.14t)/cos θ<sub>t</sub> · T<sub>R</sub> = T<sub>surf</sub>(0.78e<sup>−K<sub>R</sub>ℓ</sup> + 0.22e<sup>−0.45K<sub>R</sub>ℓ</sup>)
              </div>
            </article>

            <article class="welcome-physics-card">
              <h3>5. Angular Water Radiance &amp; ColorChecker</h3>
              <p>
                Radiative transfer integration along viewing elevation <code>sin θ<sub>v</sub></code> makes
                upward water columns (<code>+30°</code>) distinctly brighter turquoise than downward depths,
                coupled with the 24-patch sRGB calibration slate at <code>r = 0.9 m</code>:
              </p>
              <div class="welcome-eq">
                L<sub>scat</sub>(θ<sub>v</sub>) ∝ ∫<sub>0</sub><sup>s<sub>max</sub></sup> c·e<sup>−(c − K·sin θ<sub>v</sub>)s</sup> ds · L<sub>obs</sub> = E<sub>s</sub>T<sub>down</sub>e<sup>−cr</sup>ρ + L<sub>veil</sub>(1−e<sup>−cr</sup>)<br />
                Y = 0.2126 R + 0.7152 G + 0.0722 B
              </div>
            </article>

            <article class="welcome-physics-card">
              <h3>6. Log Boundary Layer, Airy Waves &amp; Lee Wakes</h3>
              <p>
                Near-bed flow follows a logarithmic wall profile (<code>z<sub>0</sub> = 0.008 m</code>,
                <code>0.15 m/s</code> mean current), linear Airy wave orbitals
                (<code>ω = 1.765 rad/s</code>), and bommy potential-flow deflection + lee eddies:
              </p>
              <div class="welcome-eq">
                u(z) = u<sub>mean</sub>·ln(max(z, 0.02)/z<sub>0</sub>)/ln(0.60/z<sub>0</sub>)<br />
                u<sub>orb</sub> ∝ w·ω·a·exp(−kz), &nbsp;k = ω<sup>2</sup>/g ≈ 0.318 m<sup>−1</sup>
              </div>
            </article>
          </div>
        </section>

        <div class="welcome-controls-strip" aria-label="Simulation Controls Summary">
          <span class="welcome-chip">Drag: 360° Look</span>
          <span class="welcome-chip">📱 Phone Motion: 360° Tilt &amp; Look</span>
          <span class="welcome-chip">WASD / Arrows: Swim</span>
          <span class="welcome-chip">H / V / 1–5: UI View Modes</span>
          <span class="welcome-chip">Free-Ride Tour: 960-Sample Trail</span>
          <span class="welcome-chip">ColorChecker: Toggle in HUD</span>
          <span class="welcome-chip">Click Species: Inspect</span>
        </div>

        <section id="welcome-evolution" class="welcome-evolution-section" aria-labelledby="welcome-evo-heading">
          <div class="evo-header-row">
            <div>
              <div class="welcome-section-label">Interactive Visual Evolution</div>
              <h2 id="welcome-evo-heading" class="evo-title">Simulation Evolution — V1 Prototype vs. ${escapeHtml(versionTag)} (Current)</h2>
            </div>
            <div class="evo-kpi-strip" aria-label="Development Milestones">
              <span class="evo-kpi-pill">${totalCommitsCount} Git Versions (${escapeHtml(latestDate)})</span>
              <span class="evo-kpi-pill">24 → 30 Calibrated Species</span>
              <span class="evo-kpi-pill">561.5M+ Build &amp; QA Tokens · 66 Agent Sessions</span>
            </div>
          </div>

          <div class="evo-toolbar">
            <div class="evo-btn-group" role="tablist" aria-label="Comparison Scene">
              <button type="button" class="evo-tab-btn evo-scene-btn is-active" data-scene="panorama" role="tab" aria-selected="true">Panorama &amp; HUD</button>
              <button type="button" class="evo-tab-btn evo-scene-btn" data-scene="reef" role="tab" aria-selected="false">Open Reef &amp; Fauna</button>
              <button type="button" class="evo-tab-btn evo-scene-btn" data-scene="live" role="tab" aria-selected="false">Live ${escapeHtml(versionTag)} Canvas</button>
              <button type="button" id="btn-evo-resnap" class="evo-tab-btn evo-resnap-btn" hidden title="Capture a fresh WebGL frame from the live reef scene">↻ Re-Snap</button>
            </div>
            <div class="evo-btn-group" role="group" aria-label="Comparison Layout">
              <button type="button" class="evo-tab-btn evo-layout-btn is-active" data-layout="split" aria-pressed="true">⇔ Split Wipe</button>
              <button type="button" class="evo-tab-btn evo-layout-btn" data-layout="side" aria-pressed="false">▥ Side-by-Side</button>
            </div>
          </div>

          <div id="evo-split-view" class="evo-split-wrap">
            <div id="evo-split-stage" class="evo-split-stage" style="--split-pct: 50%">
              <img id="evo-after-img" class="evo-img" src="${latestPanoramaUrl}" alt="Current Gulf of Eilat reef simulation view" />
              <div class="evo-before-clip">
                <img id="evo-before-img" class="evo-img" src="${v1PanoramaUrl}" alt="Version 1 initial Gulf of Eilat reef prototype view" />
              </div>
              <span id="evo-before-badge" class="evo-corner-badge evo-badge-before">V1 · Initial Prototype (Nov 13, 2026)</span>
              <span id="evo-after-badge" class="evo-corner-badge evo-badge-after">${escapeHtml(versionTag)} · Current Release</span>
              <div class="evo-split-divider" aria-hidden="true">
                <span class="evo-split-handle">↔</span>
              </div>
              <input id="evo-split-slider" class="evo-split-range" type="range" min="0" max="100" value="50" aria-label="Drag to compare Version 1 and current version" />
            </div>
          </div>

          <div id="evo-side-view" class="evo-side-grid" hidden>
            <figure class="evo-side-card">
              <img id="evo-side-before-img" class="evo-side-img" src="${v1PanoramaUrl}" alt="Version 1 initial Gulf of Eilat reef prototype view" />
              <figcaption id="evo-side-before-label" class="evo-side-caption">V1 · Nov 13, 2026</figcaption>
            </figure>
            <figure class="evo-side-card">
              <img id="evo-side-after-img" class="evo-side-img" src="${latestPanoramaUrl}" alt="Current Gulf of Eilat reef simulation view" />
              <figcaption id="evo-side-after-label" class="evo-side-caption">${escapeHtml(versionTag)} · ${escapeHtml(latestDate)}</figcaption>
            </figure>
          </div>

          <p id="evo-scene-caption" class="evo-scene-caption"></p>
        </section>

        <details id="welcome-changelog" class="welcome-changelog">
          <summary class="welcome-changelog-summary">
            <span>Version History &amp; Release Log (V1 → ${escapeHtml(versionTag)} · ${totalCommitsCount} Releases)</span>
            <span class="welcome-changelog-hint">Click to expand</span>
          </summary>
          <div class="welcome-changelog-content">
            <div class="history-tab-bar" role="tablist" aria-label="Version History View">
              <button type="button" class="evo-tab-btn history-tab-btn is-active" data-history-tab="commits" role="tab" aria-selected="true">All Git Versions (${totalCommitsCount})</button>
              <button type="button" class="evo-tab-btn history-tab-btn" data-history-tab="notes" role="tab" aria-selected="false">Release Highlights</button>
            </div>
            <div id="history-panel-commits" class="version-timeline">
              ${commitsMarkup}
            </div>
            <div id="history-panel-notes" class="changelog-notes-list" hidden>
              ${changelogMarkup}
              <div class="changelog-footer-link">
                <a class="welcome-author-link" href="https://github.com/victorchina-ops/gulf-of-eilat-reef/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Full CHANGELOG.md →</a>
              </div>
            </div>
          </div>
        </details>
      </div>

      <footer class="welcome-footer">
        <button type="button" id="btn-enter-simulation" class="welcome-enter-btn">
          Enter Reef Simulation
        </button>
      </footer>
    </div>
  `;

  root.appendChild(overlay);

  const btnEnter = overlay.querySelector('#btn-enter-simulation');
  const btnJumpEvolution = overlay.querySelector('#welcome-jump-evolution');
  const evoSection = overlay.querySelector('#welcome-evolution');
  const sceneButtons = Array.from(overlay.querySelectorAll('.evo-scene-btn'));
  const btnEvoResnap = overlay.querySelector('#btn-evo-resnap');
  const layoutButtons = Array.from(overlay.querySelectorAll('.evo-layout-btn'));
  const splitView = overlay.querySelector('#evo-split-view');
  const sideView = overlay.querySelector('#evo-side-view');
  const splitStage = overlay.querySelector('#evo-split-stage');
  const splitSlider = overlay.querySelector('#evo-split-slider');
  const beforeImg = overlay.querySelector('#evo-before-img');
  const afterImg = overlay.querySelector('#evo-after-img');
  const sideBeforeImg = overlay.querySelector('#evo-side-before-img');
  const sideAfterImg = overlay.querySelector('#evo-side-after-img');
  const beforeBadge = overlay.querySelector('#evo-before-badge');
  const afterBadge = overlay.querySelector('#evo-after-badge');
  const sideBeforeLabel = overlay.querySelector('#evo-side-before-label');
  const sideAfterLabel = overlay.querySelector('#evo-side-after-label');
  const sceneCaption = overlay.querySelector('#evo-scene-caption');
  const changelogDetails = overlay.querySelector('#welcome-changelog');
  const historyTabButtons = Array.from(overlay.querySelectorAll('.history-tab-btn'));
  const panelCommits = overlay.querySelector('#history-panel-commits');
  const panelNotes = overlay.querySelector('#history-panel-notes');

  function getSceneConfig(sceneId) {
    if (sceneId === 'reef') {
      return {
        beforeSrc: v1ReefUrl,
        afterSrc: latestReefUrl,
        beforeBadgeText: 'V1 · Initial Prototype (Nov 13, 2026)',
        afterBadgeText: `${versionTag} · Open Reef & Fauna`,
        sideBeforeText: 'V1 · Nov 13, 2026 (Open Reef)',
        sideAfterText: `${versionTag} · ${latestDate} (Open Reef & Fauna)`,
        caption: `Left (V1, Nov 13): faceted bommie meshes, static silhouettes, and uniform lighting. Right (${versionTag}): solar shadow-occluded Voronoi wave caustics, swaying anemones, green sea turtles, Snell radiance, and 360° dual wheels.`,
      };
    }
    if (sceneId === 'live') {
      const hasLive = Boolean(liveSnapshotUrl);
      return {
        beforeSrc: v1ReefUrl,
        afterSrc: hasLive ? liveSnapshotUrl : latestReefUrl,
        beforeBadgeText: 'V1 · Initial Prototype (Nov 13, 2026)',
        afterBadgeText: hasLive ? `Live ${versionTag} WebGL Canvas` : `${versionTag} · Showcase Fallback`,
        sideBeforeText: 'V1 · Nov 13, 2026 (Initial Prototype)',
        sideAfterText: hasLive ? `Live ${versionTag} Render (Captured Now)` : `${versionTag} · Showcase Render`,
        caption: `Comparing the Nov 13 V1 prototype directly against a live WebGL frame from your active ${versionTag} reef session (drag the wipe bar or click ↻ Re-Snap anytime).`,
      };
    }
    return {
      beforeSrc: v1PanoramaUrl,
      afterSrc: latestPanoramaUrl,
      beforeBadgeText: 'V1 · Initial Prototype (Nov 13, 2026)',
      afterBadgeText: `${versionTag} · Current Release`,
      sideBeforeText: 'V1 · Nov 13, 2026 (Panorama & HUD)',
      sideAfterText: `${versionTag} · ${latestDate} (Panorama & HUD)`,
      caption: `Left (V1, Nov 13): flat-faceted bommies, basic 24-species list, static lighting. Right (${versionTag}): sculpted limestone reefs, >10× Voronoi caustics, hydrodynamic current controls, Phone Motion 360°, Free-Ride Tour, and 30 calibrated species.`,
    };
  }

  function applyComparisonUI() {
    if (activeScene === 'live' && !liveSnapshotUrl && typeof captureLiveSnapshot === 'function') {
      const snap = captureLiveSnapshot();
      if (snap) liveSnapshotUrl = snap;
    }
    const cfg = getSceneConfig(activeScene);
    if (beforeImg) beforeImg.src = cfg.beforeSrc;
    if (afterImg) afterImg.src = cfg.afterSrc;
    if (sideBeforeImg) sideBeforeImg.src = cfg.beforeSrc;
    if (sideAfterImg) sideAfterImg.src = cfg.afterSrc;
    if (beforeBadge) beforeBadge.textContent = cfg.beforeBadgeText;
    if (afterBadge) afterBadge.textContent = cfg.afterBadgeText;
    if (sideBeforeLabel) sideBeforeLabel.textContent = cfg.sideBeforeText;
    if (sideAfterLabel) sideAfterLabel.textContent = cfg.sideAfterText;
    if (sceneCaption) sceneCaption.textContent = cfg.caption;

    for (const btn of sceneButtons) {
      const active = btn.dataset.scene === activeScene;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    if (btnEvoResnap) {
      btnEvoResnap.hidden = activeScene !== 'live';
    }
    for (const btn of layoutButtons) {
      const active = btn.dataset.layout === activeLayout;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    if (splitView) splitView.hidden = activeLayout !== 'split';
    if (sideView) sideView.hidden = activeLayout !== 'side';
  }

  function applyHistoryTabUI() {
    for (const btn of historyTabButtons) {
      const active = btn.dataset.historyTab === activeHistoryTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    if (panelCommits) panelCommits.hidden = activeHistoryTab !== 'commits';
    if (panelNotes) panelNotes.hidden = activeHistoryTab !== 'notes';
  }

  function syncSplitPosition(rawVal) {
    const num = Math.max(0, Math.min(100, Number(rawVal) || 0));
    if (splitStage) {
      splitStage.style.setProperty('--split-pct', `${num}%`);
    }
  }

  function refreshLiveSnapshot() {
    if (typeof captureLiveSnapshot !== 'function') return false;
    const snap = captureLiveSnapshot();
    if (snap) {
      liveSnapshotUrl = snap;
      return true;
    }
    return false;
  }

  function onSceneBtnClick(e) {
    const nextScene = e.currentTarget?.dataset?.scene;
    if (!nextScene) return;
    activeScene = nextScene;
    if (nextScene === 'live') {
      refreshLiveSnapshot();
    }
    applyComparisonUI();
    e.currentTarget.blur();
  }

  function onResnapClick() {
    refreshLiveSnapshot();
    applyComparisonUI();
    btnEvoResnap?.blur?.();
  }

  function onLayoutBtnClick(e) {
    const nextLayout = e.currentTarget?.dataset?.layout;
    if (!nextLayout) return;
    activeLayout = nextLayout;
    applyComparisonUI();
    e.currentTarget.blur();
  }

  function onSplitSliderInput() {
    syncSplitPosition(splitSlider.value);
  }

  function onHistoryTabClick(e) {
    const tab = e.currentTarget?.dataset?.historyTab;
    if (!tab) return;
    activeHistoryTab = tab;
    applyHistoryTabUI();
    e.currentTarget.blur();
  }

  function onJumpEvolutionClick() {
    if (changelogDetails) changelogDetails.open = true;
    evoSection?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    btnJumpEvolution?.blur?.();
  }

  applyComparisonUI();
  applyHistoryTabUI();
  syncSplitPosition(splitSlider?.value ?? 50);

  function syncOpenState(nextOpen) {
    openState = Boolean(nextOpen);
    overlay.classList.toggle('is-open', openState);
    overlay.setAttribute('aria-hidden', openState ? 'false' : 'true');
    root.classList.toggle('welcome-active', openState);
    document.body.dataset.welcomeOpen = openState ? 'true' : 'false';
  }

  function open() {
    if (activeScene === 'live') {
      refreshLiveSnapshot();
      applyComparisonUI();
    }
    syncOpenState(true);
    btnEnter?.focus?.({ preventScroll: true });
  }

  function openToEvolution() {
    if (activeScene === 'live') {
      refreshLiveSnapshot();
      applyComparisonUI();
    }
    syncOpenState(true);
    if (changelogDetails) {
      changelogDetails.open = true;
    }
    requestAnimationFrame(() => {
      evoSection?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  }

  function close() {
    if (!openState) {
      syncOpenState(false);
      return;
    }
    syncOpenState(false);
    btnEnter?.blur?.();
  }

  function isOpen() {
    return openState;
  }

  function onEnterClick() {
    close();
  }

  function onOverlayClick(e) {
    if (e.target === overlay) {
      close();
    }
  }

  function onKeyDown(e) {
    if (!openState) return;

    if (
      e.key === 'Escape' ||
      (e.key === 'Enter' && !e.target?.closest?.('summary, a, button:not(#btn-enter-simulation), input'))
    ) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }

    const code = e.code || '';
    const key = e.key || '';
    const isSpaceOrArrow =
      code === 'Space' ||
      key === ' ' ||
      key === 'Spacebar' ||
      code.startsWith('Arrow') ||
      key.startsWith('Arrow');
    const isRangeInput = e.target?.tagName === 'INPUT';

    if (MOVEMENT_CODES.has(code) || MOVEMENT_KEYS.has(key)) {
      if (isSpaceOrArrow && !isRangeInput) {
        e.preventDefault();
      }
      e.stopPropagation();
    }
  }

  btnEnter.addEventListener('click', onEnterClick);
  overlay.addEventListener('click', onOverlayClick);
  window.addEventListener('keydown', onKeyDown, true);
  btnJumpEvolution?.addEventListener('click', onJumpEvolutionClick);
  btnEvoResnap?.addEventListener('click', onResnapClick);
  splitSlider?.addEventListener('input', onSplitSliderInput);
  for (const btn of sceneButtons) {
    btn.addEventListener('click', onSceneBtnClick);
  }
  for (const btn of layoutButtons) {
    btn.addEventListener('click', onLayoutBtnClick);
  }
  for (const btn of historyTabButtons) {
    btn.addEventListener('click', onHistoryTabClick);
  }

  if (shouldSkipWelcomeOnLoad()) {
    syncOpenState(false);
  } else {
    open();
  }

  function dispose() {
    btnEnter.removeEventListener('click', onEnterClick);
    overlay.removeEventListener('click', onOverlayClick);
    window.removeEventListener('keydown', onKeyDown, true);
    btnJumpEvolution?.removeEventListener('click', onJumpEvolutionClick);
    btnEvoResnap?.removeEventListener('click', onResnapClick);
    splitSlider?.removeEventListener('input', onSplitSliderInput);
    for (const btn of sceneButtons) {
      btn.removeEventListener('click', onSceneBtnClick);
    }
    for (const btn of layoutButtons) {
      btn.removeEventListener('click', onLayoutBtnClick);
    }
    for (const btn of historyTabButtons) {
      btn.removeEventListener('click', onHistoryTabClick);
    }
    root.classList.remove('welcome-active');
    document.body.dataset.welcomeOpen = 'false';
    overlay.remove();
  }

  return {
    open,
    openToEvolution,
    close,
    isOpen,
    dispose,
  };
}
