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

/**
 * Creates the introductory README / Welcome modal overlay.
 * Opens on startup unless `?skipWelcome=1` is present in the URL query string.
 */
export function createWelcomeScreen({ root }) {
  let openState = false;

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
        <span class="welcome-eyebrow">GULF OF EILAT · NORTHERN RED SEA · PHYSICAL REEF SIMULATION</span>
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
        </div>
      </header>

      <div class="welcome-body">
        <div class="welcome-section-label">What Is Simulated</div>
        <div class="welcome-grid">
          <section class="welcome-feature-card">
            <h2>Underwater Radiative Transfer &amp; Optics</h2>
            <p>
              Wavelength-dependent Beer–Lambert spectral attenuation across 1–40 m with Snell
              slant-path refraction (<code>d / cos θₜ</code>), Fresnel air–sea reflectance, and
              turbidity-coupled R/G/B 10% penetration depths—paired with Snell's Window
              (<code>n = 1.3315</code>), 3-way coupled Gulf of Eilat (<code>29.6° N</code>)
              <strong>Sun Elevation ↔ Time of Day ↔ Time of Year</strong> solar geometry
              (<code>2°–83.9°</code>), animated surface waves, volumetric god-rays, seabed
              caustics, and water turbidity scattering.
            </p>
          </section>

          <section class="welcome-feature-card">
            <h2>Hydrodynamics &amp; Reef Topography</h2>
            <p>
              Configurable Red Sea current direction and speed (<code>0–1.2 m/s</code>) driving
              plankton drift, soft-coral polyp sway, and upstream planktivore rheotaxis across
              coral bommies, sandy channels, and a fore-reef drop-off.
            </p>
          </section>

          <section class="welcome-feature-card">
            <h2>27 Calibrated Gulf of Eilat Species</h2>
            <p>
              7 stony &amp; soft corals (<em>Acropora</em>, <em>Stylophora</em>, <em>Millepora</em>,
              <em>Platygyra</em>, <em>Porites</em>, <em>Dendronephthya</em>, <em>Sarcophyton</em>
              with procedural polyps), 6 invertebrates (<em>Entacmaea</em> anemone, <em>Diadema</em>
              urchin, <em>Tridacna</em> clam, starfish, sea cucumber, feather star), and 14
              biologically scaled fish, rays, and predators.
            </p>
          </section>

          <section class="welcome-feature-card">
            <h2>Mutualism, Dimorphism &amp; Ethology</h2>
            <p>
              5 <em>Labroides dimidiatus</em> cleaning stations (seesaw advertising dance, predator
              tactile massage, 5-zone parasite nipping, and multi-guild client soliciting truce),
              <em>Amphiprion bicinctus</em> +30% female/male/juvenile anemone hierarchy, 1:10
              <em>Pseudanthias</em> sexual dimorphism, <em>Taeniura lymma</em> ribbontail ray,
              <em>Gymnothorax griseus</em> moray, and predator-only fear responses.
            </p>
          </section>
        </div>

        <div class="welcome-controls-strip" aria-label="Simulation Controls Summary">
          <span class="welcome-chip">Drag: 360° Look</span>
          <span class="welcome-chip">WASD / Arrows: Swim</span>
          <span class="welcome-chip">Double-Click: Swim To</span>
          <span class="welcome-chip">Click Species: Inspect</span>
          <span class="welcome-chip">HUD: Depth, Coupled Solar Geometry, Flow &amp; Roster</span>
        </div>
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

  function syncOpenState(nextOpen) {
    openState = Boolean(nextOpen);
    overlay.classList.toggle('is-open', openState);
    overlay.setAttribute('aria-hidden', openState ? 'false' : 'true');
    root.classList.toggle('welcome-active', openState);
    document.body.dataset.welcomeOpen = openState ? 'true' : 'false';
  }

  function open() {
    syncOpenState(true);
    btnEnter?.focus?.({ preventScroll: true });
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

    if (e.key === 'Enter' || e.key === 'Escape') {
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

    if (MOVEMENT_CODES.has(code) || MOVEMENT_KEYS.has(key)) {
      if (isSpaceOrArrow) {
        e.preventDefault();
      }
      e.stopPropagation();
    }
  }

  btnEnter.addEventListener('click', onEnterClick);
  overlay.addEventListener('click', onOverlayClick);
  window.addEventListener('keydown', onKeyDown, true);

  if (shouldSkipWelcomeOnLoad()) {
    syncOpenState(false);
  } else {
    open();
  }

  function dispose() {
    btnEnter.removeEventListener('click', onEnterClick);
    overlay.removeEventListener('click', onOverlayClick);
    window.removeEventListener('keydown', onKeyDown, true);
    root.classList.remove('welcome-active');
    document.body.dataset.welcomeOpen = 'false';
    overlay.remove();
  }

  return {
    open,
    close,
    isOpen,
    dispose,
  };
}
