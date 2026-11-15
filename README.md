# Gulf of Eilat — 3D Coral Reef Ecosystem

**Live Simulation:** [https://victorchina-ops.github.io/gulf-of-eilat-reef/](https://victorchina-ops.github.io/gulf-of-eilat-reef/)  
**Author:** Victor Rina (China) — [victor.china@gmail.com](mailto:victor.china@gmail.com)

An interactive WebGL/Three.js underwater ecosystem simulation of a Red Sea coral reef in the Gulf of Eilat, featuring **28 FishBase-calibrated Red Sea species**, physically based underwater radiative transfer, and full 360° dive controls.

## Features

- **28 FishBase-Calibrated Red Sea Species across 4 ecological groups**:
  - **Corals (7)**: *Acropora*, *Stylophora*, *Millepora* (fire coral), *Platygyra* (brain coral), *Porites*, *Dendronephthya* (soft coral), and *Sarcophyton* (leather coral) with procedural polyps.
  - **Invertebrates (6)**: *Entacmaea* (bubble-tip anemone), *Diadema* (long-spined urchin), *Tridacna* (giant clam), Red Sea starfish, sea cucumber, and feather star.
  - **Fish, Rays & Sea Turtles (10)**: *Pseudanthias* (1:10 male-to-female sexual dimorphism), *Chromis*, *Abudefduf* (sergeant major), goatfish, *Amphiprion bicinctus* (Red Sea clownfish with +30% female/male/juvenile anemone hierarchy), *Chaetodon* (paired butterflyfish), *Caesio* (fusiliers), *Labroides dimidiatus* (size-dimorphic bonded cleaner wrasse pairs), *Taeniura lymma (Fabricius, 1775)* (`מחבטן הספירים`, bluespotted ribbontail ray — Family Dasyatidae), and *Chelonia mydas* (Green Sea Turtle).
  - **Predators (5)**: *Caranx* (bluefin trevally), *Cephalopholis* (coral grouper), *Pterois* (lionfish), *Gymnothorax griseus* (geometric moray eel), and *Synodus* (lizardfish).
- **Mutualism, Dimorphism & Reef Ethology**:
  - **5 Elevated *Labroides dimidiatus* Cleaning Stations**: Anchored on topographically complex bommy summits with bonded terminal-phase male / smaller female pairs, seesaw advertising dance, predator tactile massage, 5-zone parasite nipping, and multi-guild client soliciting truce (groupers, morays, goatfish, butterflyfish, and green sea turtles).
  - **Predator-Only Fear Responses**: Prey species shelter or evade true predators while maintaining mutualistic cleaning truces at active cleaning stations.
- **Physical Underwater Optics & Benthic Hydrodynamics**:
  - **Jerlov Optical Types & Spectral Beer–Lambert Attenuation**: Clear-to-turbid Gulf of Eilat water optics (`1–40 m` depth) combining Spencer (1971) solar calendar + Equation of Time (`29.55° N, 34.92° E`), Kasten–Young (1989) atmospheric air mass, Snell slant-path refraction (`d(1 + 0.14t) / cos θₜ`), wave-moderated Cox–Munk Fresnel reflectance, dynamic eye-adaptation exposure (`0.78–2.25×`), `PCFSoftShadowMap` directional sunlight + PMREM environment lighting, and live R/G/B 10% penetration depths.
  - **24-Patch X-Rite ColorChecker Classic Simulator** (toggleable from the HUD `ColorChecker` button; hidden by default): Real-time matte-black calibration slate computing IEC 61966-2-1 linear/sRGB reflectance, atmospheric air-mass extinction, downwelling spectral attenuation, and matching horizontal beam attenuation `c_rgb = K(t) + t·(0.095, 0.065, 0.085)` across the `0.9 m` diver viewing distance (`Split Ref` diagonal Surface D65 comparison, per-patch inspector, and live 6-dot HUD preview).
  - **Snell's Window & TIR Reef Bounce**: Total internal reflection at the seawater boundary (`n_w = 1.3315`, `n² = 1.773`, `48.66°` critical cone) with subsurface TIR reef bounce outside the window, animated waves, volumetric Tyndall sun shafts, chromatic wave caustics, and deep coral biofluorescence.
  - **Benthic Boundary Layer, Airy Wave Orbitals & Bommy Lee Wakes**: Mean Gulf of Eilat current (`0.15 m/s`, configurable `0–1.2 m/s`) modeled with a logarithmic near-bed boundary layer (`z₀ = 0.008 m`, `0.60 m` shear layer), linear Airy dispersion wave orbitals (`ω = 1.765 rad/s`), potential-flow bommy deflection, and sheltered downstream lee wakes/eddies driving plankton drift, soft-coral polyp sway, and upstream rheotaxis.
- **Controls, Cinema Mode & 960-Sample Smoothed Reef Tour**:
  - **Free-Ride Reef Tour**: Top-center `#tour-bar` and HUD tour controls launch a 12-zone centripetal `CatmullRomCurve3` flythrough (`2400` arc-length divisions, `76 s` nominal lap) baked into **960 unwrapped, circularly Gaussian-smoothed camera orientation samples** (`yaw`, `pitch`, `roll`) for zero-snap gimbal transitions, speed presets (`1×` → `1.6×` → `0.6×`), progress scrubbing (`0–100%`), toggleable 3D `Trail` spline/waypoint rings, free 360° look-around during flight, and instant manual handoff.
  - **360° Free-POV Dive & Orbit Camera**: Click-drag to look/orbit, `WASD` / Arrow keys to swim, `Space` / `E` to ascend, `Shift` / `C` / `Q` to descend, `R` to level roll, scroll wheel to move/zoom, double-click to swim toward a target, and smooth substrate/bommy obstacle gliding around coral structures.
  - **Cinema Mode (`H` / Hide UI)**: Press `H` (or click **Hide UI**) to clear all HUD chrome for an unobstructed viewport view, displaying a compact **Press H / Show UI** restore pill (`#ui-restore-chip`).
  - **Dive HUD & Bilingual Species Guide**: Adjust dive depth (`1–40 m`), coupled solar geometry (**Sun Elevation ↔ Time of Day ↔ Time of Year**), wave intensity, turbidity, current vector, camera presets (`Reef`, `Snell's Window`, `Anemone`, `Sandy Channel`, `Blue Water`, `Cleaning Station`), toggle `ColorChecker`, manage per-species counts with English & Hebrew (`<bdi lang="he" dir="rtl">`) labels + depth ranges, and reopen the welcome guide via `About`.

## Physics Basis of Underwater Light & Hydrodynamics

The simulation couples astronomical solar geometry (`src/physics/solarCalendar.js`), air–sea radiative transfer (`src/physics/waterOptics.js`), 24-patch ColorChecker photometry (`src/physics/colorChartSim.js`), benthic hydrodynamics (`src/physics/flowField.js`), and per-fragment GLSL underwater shaders (`src/shaders/underwaterCommon.glsl.js`, `src/shaders/snellsWindow.glsl.js`, `src/shaders/volumetrics.glsl.js`, `src/shaders/seabed.glsl.js`):

### 1. Spencer (1971) Solar Calendar & Equation of Time (Gulf of Eilat, $\varphi = 29.55^\circ\text{ N},\; \lambda = 34.92^\circ\text{ E}$)
For calendar day $N \in [1, 365]$, fractional year $\gamma = \frac{2\pi(N - 1)}{365}$ feeds Spencer's (1971) Fourier series for solar declination $\delta(N)$ and Equation of Time $\text{EoT}(N)$ (minutes), converting clock time $t_{\text{clock}}$ to true local solar time $t_{\text{solar}}$ and computing true solar elevation $\alpha$ and compass azimuth:

$$t_{\text{solar}} = t_{\text{clock}} + \frac{\text{EoT}(N) + 4(\lambda - \lambda_{\text{tz}})}{60}, \qquad H = \frac{\pi}{12}(t_{\text{solar}} - 12)$$

$$\sin\alpha = \sin\varphi\sin\delta + \cos\varphi\cos\delta\cos H \qquad (\alpha \ge \alpha_{\min} = 2.0^\circ)$$

Dragging **Sun Elevation** solves the nearest-solution inverse $(t, N)$ while preserving the active AM/PM branch and calendar day whenever reachable.

### 2. Kasten–Young (1989) Air-Mass Extinction & Dynamic Auto-Exposure
Optical air mass follows Kasten & Young (1989), driving Rayleigh/aerosol atmospheric transmission $T_{\text{atm}}(\lambda)$ and twilight irradiance scaling, paired with dynamic eye-adaptation exposure (`uExposure` adapted smoothly at $3.0\;\text{s}^{-1}$):

$$AM(\alpha) = \frac{1}{\max(0.015, \sin\alpha) + 0.50572(\alpha^\circ + 6.07995)^{-1.6364}}$$

$$T_{\text{atm}}(\lambda) = \exp\!\left(-k_{\text{atm}}(\lambda)\, AM\right), \qquad E_{\text{adapt}} = \text{clamp}\!\left(0.96\,L_{\text{scene}}^{-0.34},\; 0.78,\; 2.25\right)$$

For ColorChecker surface calibration, direct solar + diffuse sky irradiance $E_{\text{surf}}(\lambda)$ (`SKY_SPEC = [0.55, 0.76, 1.00]`, weight `0.22`) is normalized to $(1, 1, 1)$ at Eilat summer solstice noon.

### 3. Air–Sea Interface: Snell's Window ($n^2 = 1.773$), TIR Reef Bounce & Cox–Munk Fresnel
At the air–seawater boundary ($n_a = 1.0$, $n_w = 1.3315$, $n_w^2 = 1.773$), Snell's law sets the refracted downwelling angle $\theta_t$ and the upward **Snell's Window** critical cone ($\theta_c$); rays outside $\theta_c$ undergo total internal reflection (TIR), bouncing subsurface reef radiance across the outer mirror region:

$$\sin\theta_t = \frac{n_a}{n_w}\cos\alpha, \qquad \theta_c = \arcsin\!\left(\frac{1}{1.3315}\right) = 48.66^\circ$$

Unpolarized dielectric Fresnel reflectance $R_{\text{flat}} = \frac{1}{2}(r_s^2 + r_p^2)$ blends with wave-roughened reflectance $R_{\text{rough}} = 0.026 + 0.31(1 - \sin\alpha)^4$ via wave intensity $w \in [0, 1]$, then mixes with diffuse skylight transmittance ($T_{\text{sky}} = 0.934$):

$$R = \text{lerp}\!\left(R_{\text{flat}},\, R_{\text{rough}},\, 0.55w\right), \qquad T_{\text{surf}} = w_{\text{dir}}(1 - R) + (1 - w_{\text{dir}})T_{\text{sky}}$$

### 4. Jerlov Optical Attenuation, Slant Path & Matching Horizontal ColorChecker Physics
Jerlov clear-to-turbid diffuse attenuation $K(t)$ and matching horizontal beam attenuation $c_{\text{rgb}}(t)$ increase with suspended particulates $t \in [0, 1]$ along the refracted slant path $\ell$:

$$K(t) = (0.24,\, 0.055,\, 0.017) + t\,(0.26,\, 0.14,\, 0.19)\;\text{m}^{-1}, \qquad c_{\text{rgb}}(t) = K(t) + t\,(0.095,\, 0.065,\, 0.085)\;\text{m}^{-1}$$

$$\ell = \frac{d\,(1 + 0.14t)}{\cos\theta_t}, \qquad T_{\text{down}, R} = T_{\text{surf}}\!\left(0.78\,e^{-K_R \ell} + 0.22\,e^{-0.45 K_R \ell}\right)$$

Both 3D fragments and the 24-patch ColorChecker Classic slate ($r = 0.9\text{ m}$, IEC 61966-2-1 sRGB EOTF/OETF, CIE $Y = 0.2126R + 0.7152G + 0.0722B$) integrate identical horizontal extinction $T_{\text{view}} = \exp(-c_{\text{rgb}} r)$ and turbid backscatter veil, with JS ACES Filmic matching `scene.background` to asymptotic shader water scatter.

### 5. Benthic Logarithmic Boundary Layer, Airy Wave Orbitals & Bommy Lee Wakes
- **Logarithmic Wall Shear**: Within the bottom $0.60\text{ m}$ boundary layer ($z_0 = 0.008\text{ m}$), mean Eilat current ($0.15\text{ m/s}$ default) follows $u(z) = u_{\text{mean}} \ln(\max(z, 0.02)/z_0) / \ln(0.60/z_0)$.
- **Airy Wave Orbitals & Lee Wakes**: Depth-attenuated linear wave orbitals ($\omega = 1.765\text{ rad/s}$, $k = \omega^2/g \approx 0.3176\text{ m}^{-1}$) superpose with potential-flow dipole deflection around coral bommies and sheltered downstream lee wakes with counter-rotating eddies.
- **Chromatic Wave Caustics, Tyndall Shafts & Biofluorescence**: Dual Voronoi wave-ridge lenses cast dispersed caustics with `PCFSoftShadowMap` directional sunlight, 22 volumetric sun shafts scatter downwelling light, and below $10\text{ m}$ penetrating $\sim 470\text{ nm}$ light excites coral GFP/CFP biofluorescence.

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
