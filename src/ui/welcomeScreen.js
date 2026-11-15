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
          <span class="welcome-author-sep" aria-hidden="true">·</span>
          <a id="welcome-changelog-link" class="welcome-author-link" href="https://github.com/victorchina-ops/gulf-of-eilat-reef/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Changelog (Optional Read)</a>
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
              Gaussian-smoothed Free-Ride Tour</strong>, bommy-gliding dive camera, and
              <strong>Cinema Mode</strong> (<code>H</code>).
            </p>
          </section>

          <section class="welcome-feature-card">
            <h2>29 Calibrated Gulf of Eilat Species</h2>
            <p>
              7 stony &amp; soft corals (<em>Acropora</em>, <em>Stylophora</em>, <em>Millepora</em>,
              <em>Platygyra</em>, <em>Porites</em>, <em>Dendronephthya</em>, <em>Sarcophyton</em>
              with procedural polyps), 6 invertebrates (<em>Entacmaea</em> anemone, <em>Diadema</em>
              urchin, <em>Tridacna</em> clam, starfish, sea cucumber, feather star), and 16
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
          <span class="welcome-chip">WASD / Arrows: Swim</span>
          <span class="welcome-chip">H: Cinema Mode (Hide UI)</span>
          <span class="welcome-chip">Free-Ride Tour: 960-Sample Trail</span>
          <span class="welcome-chip">ColorChecker: Toggle in HUD</span>
          <span class="welcome-chip">Click Species: Inspect</span>
        </div>

        <details id="welcome-changelog" class="welcome-changelog">
          <summary class="welcome-changelog-summary">
            <span>Optional Read — Simulation Changelog &amp; Evolution</span>
            <span class="welcome-changelog-hint">Click to expand</span>
          </summary>
          <div class="welcome-changelog-content">
            <div class="welcome-changelog-item">
              <strong>Latest — Crown Butterflyfish (<em>Chaetodon paucifasciatus</em>, <bdi lang="he" dir="rtl">פרפרון האודם</bdi>):</strong>
              Replaced <em>C. austriacus</em> with a <code>&lt;= 14 cm</code> pearlescent-ivory Crown Butterflyfish featuring a white-bordered black forehead crown, golden eyebar, six charcoal chevrons, posterior pepper-dots, ruby-vermilion to orange-brown rear saddle, omnivorous <code>1–60 m</code> paired/small-group reef foraging, and a <code>Crown Butterflyfish</code> camera preset.
            </div>
            <div class="welcome-changelog-item">
              <strong>Eagle Ray, Seamless Ribbontail Ray &amp; Solar Shadow Sweep:</strong>
              Added <em>Aetobatus ocellatus</em> (טחן נקוד) as the 29th species with Myliobatiform wingbeat/glide physics and <code>Eagle Ray</code> preset; rebuilt <em>Taeniura lymma</em> as a seamless GPU-undulating disc; coupled <code>PCFSoftShadowMap</code> directional shadows to occlude wave caustics as shadows sweep with Snell-refracted sun azimuth &amp; elevation.
            </div>
            <div class="welcome-changelog-item">
              <strong>Cleaning Stations &amp; Reef Fauna Overhaul:</strong>
              5 elevated <em>Labroides dimidiatus</em> bommy stations with size-dimorphic bonded pairs, <em>Chelonia mydas</em> green sea turtles, sculpted <em>Gymnothorax griseus</em> moray, slender <em>Entacmaea</em> tentacles, branching <em>Acropora</em>, fluted <em>Tridacna</em> mantles, stratified limestone topography, and realistic diluted wildlife defaults.
            </div>
            <div class="welcome-changelog-item">
              <strong>Snell's Window, Angular Radiance, &gt;10× Caustics &amp; Exposure:</strong>
              Circular <code>48.66°</code> Snell's Window (<code>108°</code> zenith FOV), viewing-angle water-column radiance (<code>+30°</code> upward brightening), triple-layer Voronoi caustics (<code>&gt;10×</code> peak-to-trough intensity), retinal auto-exposure, and manual <code>±1.5 EV</code> trim.
            </div>
            <div class="welcome-changelog-item">
              <strong>ColorChecker, 960-Sample Tour, Hydrodynamics &amp; Solar Optics:</strong>
              24-patch X-Rite ColorChecker Classic slate, 960-sample Gaussian-smoothed Free-Ride Tour, Cinema Mode (<code>H</code>), Spencer (1971) coupled Eilat solar calendar (<code>29.55° N, 34.92° E</code>), Jerlov Beer–Lambert optics, and logarithmic benthic boundary-layer flow.
              <a class="welcome-author-link" href="https://github.com/victorchina-ops/gulf-of-eilat-reef/blob/main/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Full CHANGELOG.md →</a>
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

    if (e.key === 'Escape' || (e.key === 'Enter' && !e.target?.closest?.('summary, a'))) {
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
