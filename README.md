# Gulf of Eilat — 3D Coral Reef Ecosystem

**Live Simulation:** [https://victorchina-ops.github.io/gulf-of-eilat-reef/](https://victorchina-ops.github.io/gulf-of-eilat-reef/)  
**Author:** Victor Rina (China) — [victor.china@gmail.com](mailto:victor.china@gmail.com)

An interactive WebGL/Three.js underwater ecosystem simulation of a Red Sea coral reef in the Gulf of Eilat, featuring **27 FishBase-calibrated Red Sea species**, physically based underwater radiative transfer, and full 360° dive controls.

## Features

- **27 FishBase-Calibrated Red Sea Species across 4 ecological groups**:
  - **Corals (7)**: *Acropora*, *Stylophora*, *Millepora* (fire coral), *Platygyra* (brain coral), *Porites*, *Dendronephthya* (soft coral), and *Sarcophyton* (leather coral) with procedural polyps.
  - **Invertebrates (6)**: *Entacmaea* (bubble-tip anemone), *Diadema* (long-spined urchin), *Tridacna* (giant clam), Red Sea starfish, sea cucumber, and feather star.
  - **Fish & Rays (9)**: *Pseudanthias* (1:10 male-to-female sexual dimorphism), *Chromis*, *Abudefduf* (sergeant major), goatfish, *Amphiprion bicinctus* (Red Sea clownfish with +30% female/male/juvenile anemone hierarchy), *Chaetodon* (paired butterflyfish), *Caesio* (fusiliers), *Labroides dimidiatus* (bluestreak cleaner wrasse), and *Taeniura lymma* (blue-spotted ribbontail ray).
  - **Predators (5)**: *Caranx* (bluefin trevally), *Cephalopholis* (coral grouper), *Pterois* (lionfish), *Gymnothorax griseus* (geometric moray eel), and *Synodus* (lizardfish).
- **Mutualism, Dimorphism & Reef Ethology**:
  - **5 *Labroides dimidiatus* Cleaning Stations**: Seesaw advertising dance, predator tactile massage, 5-zone parasite nipping, and multi-guild client soliciting truce (groupers, morays, goatfish, and butterflyfish).
  - **Predator-Only Fear Responses**: Prey species shelter or evade true predators while maintaining mutualistic cleaning truces at active cleaning stations.
- **Physical Underwater Optics & Hydrodynamics**:
  - Wavelength-dependent spectral depth attenuation (Beer–Lambert red/green/blue absorption across 1–40 m depth) coupled with Snell slant-path refraction (`d(1 + 0.14t) / cos θₜ`), wave-moderated Fresnel air–sea reflectance, and live turbidity-coupled R/G/B 10% penetration depths.
  - **24-Patch X-Rite ColorChecker Classic Simulator**: Real-time matte-black calibration slate computing IEC 61966-2-1 linear/sRGB reflectance, atmospheric air-mass extinction, downwelling spectral attenuation, and diver-to-slate (`0.9 m`) turbid backscatter veil (`Split Ref` diagonal Surface D65 comparison, per-patch hover/click hex & luminance inspector, and live 6-dot HUD preview).
  - Snell's Window total internal reflection (`IOR = 1.3315`, `48.66°` critical cone), 3-way coupled Gulf of Eilat (`29.55° N`) **Sun Elevation ↔ Time of Day ↔ Time of Year** solar geometry (`2°–83.89°` across seasonal equinoxes and solstices), animated surface waves, volumetric god-rays, chromatically dispersed seabed caustics, and configurable water turbidity.
  - Configurable Red Sea current direction and speed (`0–1.2 m/s`) driving plankton/particle drift, soft-coral polyp sway, and upstream planktivore rheotaxis.
- **Controls & Free-Ride Reef Tour**:
  - **Free-Ride Reef Tour**: Top-center `#tour-bar` and HUD tour controls launch a smooth 12-zone `CatmullRomCurve3` reef flythrough (`76 s` nominal lap across Coral Garden, Anemone Pinnacle, Cleaning Station, Fore-Reef Drop-Off Wall, Central Canyon, Limestone Arch, and more) with speed cycling (`1×` → `1.6×` → `0.6×`), progress scrubbing (`0–100%`), toggleable 3D `Trail` spline/waypoint rings, free 360° look-around during flight, and automatic seamless handoff to manual control on any swim, pan, wheel, double-click, or preset input.
  - **360° Free-POV Dive & Orbit Camera**: Click-drag to look/orbit, `WASD` / Arrow keys to swim, `Space` / `E` to ascend, `Shift` / `C` / `Q` to descend, `R` to level roll, scroll wheel to move/zoom, and double-click to swim toward any reef target.
  - **Dive HUD & Species Guide**: Adjust dive depth (`1–40 m`), coupled solar geometry (**Sun Elevation ↔ Time of Day ↔ Time of Year** with equinox/solstice presets), wave intensity, turbidity, current vector, camera presets (`Reef`, `Snell's Window`, `Anemone`, `Sandy Channel`, `Blue Water`, `Cleaning Station`), toggle the 24-patch `ColorChecker`, manage live per-species population counts, and use the `About` button to reopen the welcome overview.

## Physics Basis of Underwater Light & Radiative Transfer

The optical engine couples astronomical solar geometry (`src/physics/solarCalendar.js`), air–sea radiative transfer (`src/physics/waterOptics.js`), 24-patch ColorChecker photometry (`src/physics/colorChartSim.js`), and per-fragment GLSL underwater shaders (`src/shaders/underwaterCommon.glsl.js`, `src/shaders/snellsWindow.glsl.js`, `src/shaders/volumetrics.glsl.js`):

### 1. Spherical Solar Geometry (Gulf of Eilat, $\varphi = 29.55^\circ\text{ N}$)
For calendar day $N \in [1, 365]$, solar time $t \in [5.15, 18.85]\text{ h}$, and Earth axial obliquity $\varepsilon = 23.44^\circ$ (yielding a summer solstice noon peak of $\alpha_{\max} = 83.89^\circ$):

$$\delta(N) = 23.44^\circ \sin\!\left(\frac{2\pi(N - 81)}{365}\right), \qquad H(t) = \frac{\pi}{12}(t - 12)$$

$$\sin\alpha = \sin\varphi\sin\delta + \cos\varphi\cos\delta\cos H \qquad (\alpha \ge \alpha_{\min} = 2.0^\circ)$$

Dragging **Sun Elevation** solves the nearest-solution inverse $(t, N)$ minimizing $\left(\frac{t - t_0}{1.2}\right)^2 + \left(\frac{\Delta N}{12}\right)^2 + p_{\text{half}}$ while preserving the AM/PM branch when reachable on the active calendar day.

### 2. Atmospheric Air-Mass Extinction & Sky Normalization
Optical air mass follows the Kasten–Young formulation, driving Rayleigh/aerosol spectral transmission $T_{\text{atm}}(\lambda)$ and twilight-attenuated surface irradiance:

$$AM(\alpha) = \min\!\left(11,\; \frac{1}{\max(0.04, \sin\alpha) + 0.15(\alpha^\circ + 3.885)^{-1.253}}\right)$$

$$T_{\text{atm}}(\lambda) = \exp\!\left(-k_{\text{atm}}(\lambda)\, AM\right), \qquad k_{\text{atm}} = (0.075,\, 0.135,\, 0.275)$$

For ColorChecker surface calibration, direct solar + diffuse sky irradiance $E_{\text{surf}}(\lambda)$ (`SKY_SPEC = [0.55, 0.76, 1.00]`, weight `0.22`) is normalized to $(1, 1, 1)$ at Eilat summer solstice noon ($\alpha = 83.9^\circ$).

### 3. Air–Sea Interface: Snell Refraction & Wave-Moderated Cox–Munk Fresnel
At the air–seawater boundary ($n_a = 1.0$, $n_w = 1.3315$, $\eta = n_a/n_w$), Snell's law sets the refracted downwelling angle $\theta_t$ and the upward **Snell's Window** total-internal-reflection cone ($\theta_c$):

$$\sin\theta_t = \frac{n_a}{n_w}\cos\alpha, \qquad \theta_c = \arcsin\!\left(\frac{1}{1.3315}\right) = 48.66^\circ$$

Unpolarized dielectric Fresnel reflectance $R_{\text{flat}} = \frac{1}{2}(r_s^2 + r_p^2)$ blends with wave-roughened reflectance $R_{\text{rough}} = 0.026 + 0.31(1 - \sin\alpha)^4$ via wave intensity $w \in [0, 1]$, then mixes with diffuse skylight transmittance ($T_{\text{sky}} = 0.934$):

$$R = \text{lerp}\!\left(R_{\text{flat}},\, R_{\text{rough}},\, 0.55w\right), \qquad T_{\text{surf}} = w_{\text{dir}}(1 - R) + (1 - w_{\text{dir}})T_{\text{sky}}$$

where $w_{\text{dir}} = \frac{(1 - R)\sin\alpha}{(1 - R)\sin\alpha + 0.22\,T_{\text{sky}}}$.

### 4. Spectral Beer–Lambert Absorption, Slant Path & Turbidity
Suspended particulate turbidity $t \in [0, 1]$ elevates diffuse attenuation $K_{\text{RGB}}(t)$ and increases multiple-scattering path tortuosity along the refracted slant path $\ell$:

$$K(t) = K_{\text{clear}} + t\, K_{\text{turbid}} = (0.24,\, 0.055,\, 0.017) + t\,(0.26,\, 0.18,\, 0.13)\;\text{m}^{-1}$$

$$\ell = \frac{d\,(1 + 0.14t)}{\cos\theta_t}$$

$$T_{\text{down}, G/B} = T_{\text{surf}}\exp(-K_{G/B}\,\ell), \qquad T_{\text{down}, R} = T_{\text{surf}}\!\left(0.78\,e^{-K_R \ell} + 0.22\,e^{-0.45 K_R \ell}\right)$$

Live $10\%$ penetration depths $z_{10\%}$ solve $T_{\text{down}}(z_{10\%}) = 0.10$ directly ($z_{10\%, G/B} = \frac{\ln(T_{\text{surf}}/0.10)}{K_{G/B}(1 + 0.14t)/\cos\theta_t}$, with 24-step bisection for the bi-exponential red tail).

### 5. Horizontal View-Path Extinction, Backscatter Veil & ColorChecker Photometry
Along diver viewing distance $r$ (`0.9 m` for the ColorChecker slate, arbitrary fragment range in 3D), the radiative transfer equation combines attenuated target radiance with in-scattered water backscatter veil:

$$L_{\text{obs}}(\lambda) = E_{\text{surf}}(\lambda)\, T_{\text{down}}(\lambda)\, T_{\text{view}}(\lambda)\, \rho(\lambda) + L_{\text{veil}}(\lambda)\!\left(1 - T_{\text{view}}(\lambda)\right), \qquad T_{\text{view}}(\lambda) = \exp\!\left(-k_{\text{view}}(\lambda)\, r\right)$$

In the ColorChecker Classic simulator, all 24 patches convert via the exact IEC 61966-2-1 sRGB EOTF/OETF and report CIE relative luminance $Y = 0.2126R + 0.7152G + 0.0722B$ retention against surface D65, while in 3D the exact JS ACES Filmic RRT/ODT curve matches `scene.background` to asymptotic horizontal shader water scatter with zero horizon seam.

### 6. Chromatic Wave Caustics, Volumetric Tyndall Shafts & Deep Biofluorescence
- **Chromatic Caustics**: Dual rotated Voronoi wave-ridge layers project from seabed/coral points along `uRefractedSunDir` with depth-scaled RGB dispersion and depth/turbidity focus fade $\exp(-d(0.042 + 0.135t))$.
- **Volumetric Sun Shafts**: 22 additive Tyndall ray cones descend along `uRefractedSunDir`, modulated by Beer–Lambert $T_{\text{down}} \cdot T_{\text{view}}$, wave-phase shimmer, and particulate scatter visibility.
- **Deep Biofluorescence ($> 10\text{ m}$)**: Below $10\text{ m}$, penetrating $\sim 470\text{ nm}$ blue irradiance excites subtle cyan-green GFP/CFP biofluorescence on high-chroma stony corals and invertebrates scaled by `smoothstep(10, 28, d)` and $T_{\text{down},B}$.

## Local Development

```bash
npm install && npm run dev
```

Open the local Vite dev server URL (default `http://127.0.0.1:5173/`) in a WebGL-capable browser.

## Standalone Single-File Build

Bundle the application, styles, and Three.js runtime into a single self-contained HTML file (`gulf-of-eilat-reef-standalone.html`):

```bash
npm run build:standalone
```

## Publishing to GitHub Pages

This repository includes [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) to build and deploy `dist/` automatically on pushes to `main`.

1. Authenticate with the GitHub CLI:
   ```bash
   gh auth login
   ```
2. Create the public repository and push `main`:
   ```bash
   gh repo create gulf-of-eilat-reef --public --source=. --remote=origin --push
   ```
3. Enable GitHub Actions as the Pages build source:
   ```bash
   gh api -X POST "repos/$(gh api user -q .login)/gulf-of-eilat-reef/pages" -f build_type=workflow
   ```
   *(If Pages is already enabled on the repo, update it with `-X PUT` instead of `-X POST`, or set **Settings → Pages → Source: GitHub Actions** in the GitHub web UI.)*
