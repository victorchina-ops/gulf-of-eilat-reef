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
            <h2>Underwater Radiative Transfer &amp; ColorChecker</h2>
            <p>
              Wavelength-dependent Beer–Lambert spectral attenuation across 1–40 m with Snell
              slant-path refraction (<code>d(1+0.14t)/cos θₜ</code>), Fresnel air–sea reflectance,
              and live turbidity-coupled R/G/B 10% penetration depths—paired with a real-time
              <strong>24-Patch X-Rite ColorChecker Classic</strong> underwater slate (with D65
              split-reference inspection), Snell's Window (<code>n = 1.3315</code>), 3-way coupled
              Eilat (<code>29.55° N</code>) <strong>Sun Elevation ↔ Time of Day ↔ Time of Year</strong>
              geometry (<code>2°–83.89°</code>), waves, god-rays, and caustics.
            </p>
          </section>

          <section class="welcome-feature-card">
            <h2>Hydrodynamics, Reef Topography &amp; Free-Ride Tour</h2>
            <p>
              Configurable Red Sea current direction and speed (<code>0–1.2 m/s</code>) driving
              plankton drift, soft-coral polyp sway, and upstream planktivore rheotaxis across
              coral bommies, sandy channels, and a fore-reef drop-off—plus an automated
              <strong>Free-Ride Reef Tour</strong> along a 12-zone obstacle-free spline with
              free 360° look-around, speed presets, progress scrubbing, and instant manual handoff.
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

        <section class="welcome-physics-section" aria-labelledby="welcome-physics-heading">
          <div id="welcome-physics-heading" class="welcome-section-label">
            Physics Basis of Underwater Light &amp; Radiative Transfer
          </div>
          <div class="welcome-physics-grid">
            <article class="welcome-physics-card">
              <h3>1. Spherical Solar Geometry</h3>
              <p>
                Evaluated for Eilat latitude <code>φ = 29.55° N</code> and obliquity
                <code>ε = 23.44°</code> (solstice noon peak <code>83.89°</code>) with nearest-solution
                inverse <code>(t, N)</code> branch solving:
              </p>
              <div class="welcome-eq">
                δ(N) = 23.44° sin(2π(N − 81)/365) · H(t) = (π/12)(t − 12)<br />
                sin α = sin φ sin δ + cos φ cos δ cos H &nbsp;(α ≥ 2.0°)
              </div>
            </article>

            <article class="welcome-physics-card">
              <h3>2. Atmospheric Air-Mass Extinction</h3>
              <p>
                Kasten–Young optical air mass drives Rayleigh/aerosol spectral transmission,
                twilight dimming, and cosine irradiance scaling:
              </p>
              <div class="welcome-eq">
                AM(α) = min(11, [max(0.04, sin α) + 0.15(α° + 3.885)<sup>−1.253</sup>]<sup>−1</sup>)<br />
                T<sub>atm</sub>(λ) = exp(−k<sub>atm</sub>·AM), &nbsp;k<sub>atm</sub> = (0.075, 0.135, 0.275)
              </div>
            </article>

            <article class="welcome-physics-card">
              <h3>3. Air–Sea Interface: Snell &amp; Fresnel</h3>
              <p>
                Refraction at <code>n<sub>w</sub> = 1.3315</code> defines the <code>48.66°</code>
                Snell's Window critical cone while wave-moderated Cox–Munk Fresnel blends calm and
                wind-roughened reflectance with diffuse sky entry (<code>T<sub>sky</sub> = 0.934</code>):
              </p>
              <div class="welcome-eq">
                sin θ<sub>t</sub> = (1/n<sub>w</sub>) cos α · θ<sub>c</sub> = arcsin(1/1.3315) = 48.66°<br />
                R = lerp(R<sub>flat</sub>, R<sub>rough</sub>, 0.55w) · T<sub>surf</sub> = w<sub>dir</sub>(1−R) + (1−w<sub>dir</sub>)T<sub>sky</sub>
              </div>
            </article>

            <article class="welcome-physics-card">
              <h3>4. Spectral Beer–Lambert &amp; Turbidity</h3>
              <p>
                Suspended particulate turbidity <code>t ∈ [0, 1]</code> increases attenuation and
                multiple-scattering slant path, with a bi-exponential red tail and live 10% color
                penetration depth <code>z<sub>10%</sub></code>:
              </p>
              <div class="welcome-eq">
                K(t) = (0.24, 0.055, 0.017) + t·(0.26, 0.18, 0.13) m<sup>−1</sup><br />
                ℓ = d(1 + 0.14t)/cos θ<sub>t</sub> · T<sub>R</sub> = T<sub>surf</sub>(0.78e<sup>−K<sub>R</sub>ℓ</sup> + 0.22e<sup>−0.45K<sub>R</sub>ℓ</sup>)
              </div>
            </article>

            <article class="welcome-physics-card">
              <h3>5. View-Path Veil &amp; ColorChecker Photometry</h3>
              <p>
                Both shaders and the 24-patch sRGB slate evaluate horizontal view extinction plus
                turbid backscatter veil (<code>r = 0.9 m</code>), CIE luminance, and exact JS
                ACES Filmic horizon matching:
              </p>
              <div class="welcome-eq">
                L<sub>obs</sub> = E<sub>surf</sub>·T<sub>down</sub>·T<sub>view</sub>·ρ + L<sub>veil</sub>(1 − T<sub>view</sub>)<br />
                Y = 0.2126 R + 0.7152 G + 0.0722 B
              </div>
            </article>

            <article class="welcome-physics-card">
              <h3>6. Caustics, Tyndall Shafts &amp; Biofluorescence</h3>
              <p>
                Dual Voronoi wave-ridge lenses cast chromatically dispersed caustics along
                <code>uRefractedSunDir</code>, 22 Tyndall ray cones scatter sunlight, and below
                <code>10 m</code> ~470 nm blue light excites coral GFP/CFP biofluorescence:
              </p>
              <div class="welcome-eq">
                I<sub>caustic</sub> ∝ waveGain·(1 − 0.68t)·exp(−d(0.042 + 0.135t))<br />
                F<sub>GFP/CFP</sub> ∝ smoothstep(10, 28, d)·T<sub>down,B</sub>·chroma(ρ)
              </div>
            </article>
          </div>
        </section>

        <div class="welcome-controls-strip" aria-label="Simulation Controls Summary">
          <span class="welcome-chip">Drag: 360° Look</span>
          <span class="welcome-chip">WASD / Arrows: Swim</span>
          <span class="welcome-chip">Free-Ride Tour: Auto Trail</span>
          <span class="welcome-chip">ColorChecker: Live D65 Split</span>
          <span class="welcome-chip">Double-Click: Swim To</span>
          <span class="welcome-chip">Click Species: Inspect</span>
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
