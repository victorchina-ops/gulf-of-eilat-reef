# Changelog — Gulf of Eilat 3D Coral Reef Ecosystem

> **Optional Read** · [Back to README](./README.md) · [Open Live Simulation](https://victorchina-ops.github.io/gulf-of-eilat-reef/)

---

### 2026-11-15 — Pelagic Eagle Ray, Seamless Ribbontail Ray & Caustic-Occluded Solar Shadows (`873d3f1+`)
- **New Calibrated Species #29 — Spotted Eagle Ray (*Aetobatus ocellatus (Kuhl, 1823)*, `טחן נקוד`)**: Added pelagic Aetobatidae eagle ray with `1.24 m` swept falcate pectoral wings, sculpted cranium & flat duck-bill snout, flush lateral eyes & spiracles, white/ivory dorsal ocelli rings & spots over midnight-indigo skin, white ventral counter-shading, twin caudal spines, `1.26 m` whip tail, continuous GPU Myliobatiform wingbeat/glide strokes, elevated cleaning-station visits, and live-tracking **Eagle Ray** camera preset.
- **Bluespotted Ribbontail Ray Upgrade (*Taeniura lymma (Fabricius, 1775)*, `מחבטן הספירים`)**: Rebuilt the 7-strip wing rig into a single seamless undulating disc (`taeniura_ocelli_v3`) with GPU Rajiform wave deformation, analytical normals, smooth banking turns, warm sandy golden-ochre dorsum, and vibrant sapphire-blue ocelli rings.
- **Caustic-Occluded Solar Shadow Sweep**: Coupled `PCFSoftShadowMap` directional shadows (`uwSunShadow`) into underwater caustic focusing in `underwaterCommon.glsl.js`, so direct-sun wave caustics dim cleanly inside cast shadows as bommy, table coral, turtle, and ray shadows sweep across the seabed with Spencer solar azimuth and Snell-refracted elevation.
- **Optional Changelog Documentation**: Added `CHANGELOG.md` and a collapsed-by-default **Optional Read — Simulation Changelog & Evolution** section inside the Welcome / About guide.

### 2026-11-15 — Bonded Cleaner Wrasse Stations & Taxonomy Refinements (`c53ff10`)
- Upgraded *Labroides dimidiatus* into 5 elevated bommy-summit cleaning stations operated by size-dimorphic bonded pairs (larger terminal-phase male + smaller female), attracting mutualistic client visits from groupers, morays, goatfish, butterflyfish, and green sea turtles.
- Refined foreground *Entacmaea quadricolor* bubble-tip anemones with slender swaying tentacles and full bilingual taxonomy for *Taeniura lymma*.

### 2026-11-15 — Circular Snell's Window, Angular Radiance, >10× Caustics & Megafauna (`e7e3393`)
- **Circular Snell's Window & Angular Water Scatter**: Expanded zenith FOV smoothly toward `108°` so the `48.66°` critical cone frames circularly overhead, and integrated 1-D slab radiative transfer along `sin θᵥ` so upward (`+30°`) water sightlines scatter markedly brighter turquoise than abyssal downward sightlines.
- **Triple-Layer Voronoi Wave Caustics**: Increased caustic cusp-to-trough dynamic range above `10×` while keeping trough floors rich.
- **New & Rebuilt Fauna + Diluted Defaults**: Added **Green Sea Turtle** (*Chelonia mydas*, `צב ים ירוק`), rebuilt *Gymnothorax griseus* geometric moray eel, branching *Acropora* staghorn/table corals, fluted *Tridacna* giant clams, and stratified limestone bommie cliffs with naturalistic default population counts (e.g., 2 turtles, 1 moray, 1 lionfish, 4 anemones).

### 2026-11-15 — Retinal Auto-Exposure & Manual EV Brightness Controls (`4c2e3f3`, `728d1d8`)
- Added smooth logarithmic scene-luminance retinal auto-exposure adaptation (`0.82–1.95×` target range) plus manual Auto-Exposure toggle and `±1.5 EV` brightness trim controls, while tuning midtone Jerlov clear-water scattering and skylight fill.

### 2026-11-14 — 24-Patch ColorChecker, Free-Ride Reef Tour & Hydrodynamics (`0683c7b`, `0489ff5`, `f2e7e01`)
- **24-Patch X-Rite ColorChecker Classic Simulator**: Added toggleable underwater calibration slate at `0.9 m` diver range sharing horizontal `c_rgb` extinction with 3D shaders, diagonal `Split Ref` Surface D65 comparison, per-patch spectral inspection, and 6-dot HUD summary.
- **Free-Ride Tour & Cinema Mode**: Built a 12-zone `CatmullRomCurve3` reef tour baked into 960 circularly Gaussian-smoothed orientation samples with `Trail` toggle, speed presets, progress scrubber, and `H` Cinema Mode (Hide UI).
- **Benthic Hydrodynamics**: Modeled `0.15 m/s` Gulf of Eilat boundary-layer current (`z₀ = 0.008 m`), linear Airy swell orbitals (`ω = 1.765 rad/s`), bommy potential-flow dipole deflection, and downstream lee eddies driving plankton drift, polyps, and fish rheotaxis.

### 2026-11-13 to 2026-11-14 — Solar Calendar Coupling, Optics & Initial Release (`76cf687`–`1a1b17f`)
- Implemented Spencer (1971) solar declination & Equation of Time (`29.55° N, 34.92° E` **Sun Elevation ↔ Time of Day ↔ Time of Year**), Kasten–Young (1989) air mass, Cox–Munk Fresnel reflectance, Jerlov spectral Beer–Lambert attenuation (`1–40 m`), 360° dive controls, bilingual FishBase species guide, welcome guide modal, and automated GitHub Pages deployment.
