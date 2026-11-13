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
  - Wavelength-dependent spectral depth attenuation (Beer–Lambert red/green/blue absorption across 1–40 m depth) coupled with Snell slant-path refraction (`d / cos θₜ`), Fresnel air–sea reflectance, and live turbidity-coupled R/G/B 10% penetration depths.
  - Snell's Window total internal reflection (`IOR = 1.3315`), solar elevation (`8°–78°`), time-of-day lighting, animated surface waves, volumetric god-rays, seabed caustics, and configurable water turbidity.
  - Configurable Red Sea current direction and speed (`0–1.2 m/s`) driving plankton/particle drift, soft-coral polyp sway, and upstream planktivore rheotaxis.
- **Controls**:
  - **360° Free-POV Dive & Orbit Camera**: Click-drag to look/orbit, `WASD` / Arrow keys to swim, `Space` / `E` to ascend, `Shift` / `C` / `Q` to descend, `R` to level roll, scroll wheel to move/zoom, and double-click to swim toward any reef target.
  - **Dive HUD & Species Guide**: Adjust dive depth (`1–40 m`), sun elevation, time of day, wave intensity, turbidity, current vector, camera presets (`Reef`, `Snell's Window`, `Anemone`, `Sandy Channel`, `Blue Water`, `Cleaning Station`), live per-species population counts, and the `About` button to reopen the welcome overview.

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
