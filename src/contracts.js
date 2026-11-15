export const WORLD_CONSTANTS = {
  MIN_DEPTH: 1.0,
  MAX_DEPTH: 40.0,
  SURFACE_BASE_Y: 2.8,
  REEF_RADIUS: 34.0,
  IOR_AIR: 1.0,
  IOR_WATER: 1.3315,
  CURRENT_DIR_X: 0.0,
  CURRENT_DIR_Y: -0.02,
  CURRENT_DIR_Z: 1.0,
  CURRENT_SPEED: 0.15,
};

export const SPECIES_POPULATION_SPEC = {
  // Corals (7)
  acropora: { defaultCount: 16, maxCount: 28, step: 2, group: 'corals' },
  stylophora: { defaultCount: 15, maxCount: 27, step: 2, group: 'corals' },
  millepora: { defaultCount: 7, maxCount: 14, step: 1, group: 'corals' },
  platygyra: { defaultCount: 9, maxCount: 16, step: 1, group: 'corals' },
  porites: { defaultCount: 8, maxCount: 14, step: 1, group: 'corals' },
  dendronephthya: { defaultCount: 6, maxCount: 12, step: 1, group: 'corals' },
  sarcophyton: { defaultCount: 6, maxCount: 12, step: 1, group: 'corals' },

  // Invertebrates (6)
  entacmaea: { defaultCount: 3, maxCount: 14, step: 1, group: 'inverts' },
  diadema: { defaultCount: 6, maxCount: 18, step: 1, group: 'inverts' },
  tridacna: { defaultCount: 5, maxCount: 16, step: 1, group: 'inverts' },
  starfish: { defaultCount: 8, maxCount: 26, step: 2, group: 'inverts' },
  seacucumber: { defaultCount: 6, maxCount: 20, step: 1, group: 'inverts' },
  featherstar: { defaultCount: 4, maxCount: 14, step: 1, group: 'inverts' },

  // Fish, Rays & Sea Turtles (11)
  pseudanthias: { defaultCount: 70, maxCount: 220, step: 10, group: 'fish' },
  chromis: { defaultCount: 60, maxCount: 190, step: 10, group: 'fish' },
  abudefduf: { defaultCount: 30, maxCount: 90, step: 6, group: 'fish' },
  goatfish: { defaultCount: 10, maxCount: 32, step: 2, group: 'fish' },
  amphiprion: { defaultCount: 8, maxCount: 36, step: 2, group: 'fish' },
  chaetodon: { defaultCount: 8, maxCount: 32, step: 2, group: 'fish', pairedOnly: true },
  caesio: { defaultCount: 56, maxCount: 140, step: 14, group: 'fish' },
  cleanerwrasse: { defaultCount: 6, maxCount: 22, step: 2, group: 'fish' },
  taeniura: { defaultCount: 2, maxCount: 8, step: 1, group: 'fish' },
  aetobatus: { defaultCount: 1, maxCount: 5, step: 1, group: 'fish' },
  chelonia: { defaultCount: 2, maxCount: 5, step: 1, group: 'fish' },

  // Predators (5)
  caranx: { defaultCount: 3, maxCount: 12, step: 1, group: 'predators' },
  grouper: { defaultCount: 3, maxCount: 12, step: 1, group: 'predators' },
  pterois: { defaultCount: 1, maxCount: 10, step: 1, group: 'predators' },
  moray: { defaultCount: 1, maxCount: 8, step: 1, group: 'predators' },
  lizardfish: { defaultCount: 4, maxCount: 16, step: 1, group: 'predators' },
};

export function sanitizeSpeciesCount(id, rawCount) {
  const spec = SPECIES_POPULATION_SPEC[id];
  if (!spec) return 0;

  const parsed =
    typeof rawCount === 'number'
      ? rawCount
      : typeof rawCount === 'string' && rawCount.trim() !== ''
        ? Number(rawCount)
        : NaN;
  const rounded = Number.isFinite(parsed) ? Math.round(parsed) : spec.defaultCount;
  let clamped = Math.max(0, Math.min(spec.maxCount, rounded));

  if (spec.pairedOnly) {
    clamped = Math.max(0, Math.min(spec.maxCount, Math.round(clamped / 2) * 2));
  }

  return clamped;
}

export function createDefaultSpeciesCounts() {
  const counts = {};
  for (const [id, spec] of Object.entries(SPECIES_POPULATION_SPEC)) {
    counts[id] = spec.defaultCount;
  }
  return counts;
}

export const DEFAULT_ENV_STATE = {
  diveDepth: 6.0,
  sunElevation: 61.94,
  turbidity: 0.18,
  timeOfDay: 12.5,
  dayOfYear: 87,
  autoExposure: true,
  brightnessEV: 0.0,
  waveIntensity: 0.28, // 0.0 calm glassy lagoon to 1.0 strong rolling Red Sea swell/chop
  currentDirection: 180, // Flowing toward 180 deg South (N -> S prevailing Eilat current)
  currentSpeed: 0.15, // m/s (realistic Gulf of Eilat mean reef current)
  speciesCounts: createDefaultSpeciesCounts(),
};

export function getFlowVectors(envState = DEFAULT_ENV_STATE) {
  const rawDir = Number.isFinite(envState?.currentDirection)
    ? envState.currentDirection
    : DEFAULT_ENV_STATE.currentDirection;
  const rawSpd = Number.isFinite(envState?.currentSpeed)
    ? envState.currentSpeed
    : DEFAULT_ENV_STATE.currentSpeed;
  const toDeg = ((rawDir % 360) + 360) % 360;
  const fromDeg = (toDeg + 180) % 360;
  const speed = Math.max(0, Math.min(1.2, rawSpd));
  const toRad = (toDeg * Math.PI) / 180;
  const flowX = Math.sin(toRad);
  const flowZ = -Math.cos(toRad);
  return {
    toDeg,
    fromDeg,
    speed,
    flowX,
    flowZ,
    upstreamX: -flowX,
    upstreamZ: -flowZ,
  };
}

export function getSeabedHeight(x, z) {
  const canyonCenter = 2.4 * Math.sin(z * 0.19) + 1.1 * Math.cos(z * 0.08);
  const distToCanyon = Math.abs(x - canyonCenter);
  const canyonCarve = -2.05 * Math.exp(-(distToCanyon * distToCanyon) / 7.5);

  const gullyDist = Math.abs((x + z * 0.55 + 4.5) * 0.85);
  const gullyCarve = -1.25 * Math.exp(-(gullyDist * gullyDist) / 5.2);

  const spurs =
    Math.cos(x * 0.28 + Math.sin(z * 0.16) * 0.9) * 0.68 +
    Math.sin(z * 0.24 - x * 0.15) * 0.45 +
    Math.cos(x * 0.62 + z * 0.51) * 0.22;

  const detail =
    Math.sin(x * 1.35 + Math.cos(z * 1.15) * 0.9) * 0.08 +
    Math.cos(z * 1.8 - x * 1.1) * 0.05;

  // Smooth C1 cubic Hermite blend across z = -9.5 (no sharp crease or step discontinuity)
  const northT = Math.max(0, Math.min(1, (-8.0 - z) / 3.0));
  const northBlend = northT * northT * (3 - 2 * northT);
  const northDrop = -3.8 * northBlend * (1 / (1 + Math.exp((z + 13.5) * 0.55)));
  const r = Math.hypot(x, z);
  const outerDrop = r > 17.0 ? -3.4 * Math.min(1, Math.pow((r - 17.0) / 16.0, 1.35)) : 0;

  const h = -0.35 + spurs + detail + canyonCarve + gullyCarve + northDrop + outerDrop;
  return Math.max(-7.8, Math.min(0.65, h));
}

export const SPECIES_CATALOG = {
  // === CORALS (7) ===
  acropora: {
    id: 'acropora',
    commonName: 'Table & Staghorn Coral',
    hebrewName: 'אלמוג שיחני / שולחני',
    scientificName: 'Acropora spp.',
    category: 'Scleractinian Reef-Building Coral',
    status: 'Vulnerable (Northern Red Sea Thermal Refuge)',
    depthRange: '1–22 m',
    depthMin: 1,
    depthMax: 22,
    diet: 'Symbiodiniaceae photosynthesis & nocturnal micro-zooplankton',
    description:
      'Architects of Eilat’s spur-and-groove fore-reef. Tabular canopies and multi-generation staghorn branches create intricate 3D shelter where clouds of Pseudanthias and Abudefduf dart inward whenever predators approach.',
    opticalNote:
      'Pale lavender-blue axial growth tips fluoresce under short-wavelength blue irradiance (~450–490 nm), remaining crisp after Beer-Lambert attenuation strips red light below 8 m.',
  },
  stylophora: {
    id: 'stylophora',
    commonName: 'Hood Coral',
    hebrewName: 'שושנית אלמוג',
    scientificName: 'Stylophora pistillata',
    category: 'Scleractinian Branching Coral',
    status: 'Near Threatened (Eilat Heat-Resilient Model)',
    depthRange: '1–30 m',
    depthMin: 1,
    depthMax: 30,
    diet: 'Zooxanthellate photosynthesis & suspended organic particulates',
    description:
      'Signature Gulf of Eilat coral forming dense, dichotomously bifurcated thickets in rose-pink, violet, and cream-gold morphs. Its tight branch interstices serve as vital daytime refuge for juvenile reef fishes.',
    opticalNote:
      'Shallow pink chromoproteins absorb green-yellow light and glow vibrant magenta near 2–5 m, shifting toward deep plum-violet below 15 m as red wavelengths vanish.',
  },
  millepora: {
    id: 'millepora',
    commonName: 'Net Fire Coral',
    hebrewName: 'אלמוג האש',
    scientificName: 'Millepora dichotoma',
    category: 'Calcifying Hydrozoan Coral',
    status: 'Least Concern',
    depthRange: '1–18 m',
    depthMin: 1,
    depthMax: 18,
    diet: 'Zooxanthellae symbiosis & stinging dactylozooid plankton capture',
    description:
      'Delicate mustard-ochre fan plates and dichotomous lattices tipped in white along sun-drenched Eilat reef crests and canyon rims. Delivers a sharp nematocyst sting on contact, deterring corallivores.',
    opticalNote:
      'Ochre-gold branches carry strong green reflectance (~550 nm) alongside white calcified tips, preserving bright yellow-olive contrast down to 15 m.',
  },
  platygyra: {
    id: 'platygyra',
    commonName: 'Brain Coral',
    hebrewName: 'אלמוג מוח',
    scientificName: 'Platygyra daedalea',
    category: 'Massive Scleractinian Coral',
    status: 'Least Concern',
    depthRange: '2–25 m',
    depthMin: 2,
    depthMax: 25,
    diet: 'Zooxanthellae symbiosis & nocturnal tentacular feeding',
    description:
      'Heavy hemispherical carbonate domes sculpted with meandering valleys and ridges (meandroid corallites) that reinforce Eilat reef spurs and drop-off ledges against wave surge.',
    opticalNote:
      'Green fluorescent proteins (GFP) inside recessed valleys emit ~510 nm green light under downwelling blue rays, producing glowing labyrinth contrast against dark ridges at depth.',
  },
  porites: {
    id: 'porites',
    commonName: 'Hump & Lobe Coral',
    hebrewName: 'פוריטס גושי',
    scientificName: 'Porites lutea / nodifera',
    category: 'Massive Scleractinian Coral',
    status: 'Least Concern',
    depthRange: '1–30 m',
    depthMin: 1,
    depthMax: 30,
    diet: 'Zooxanthellate photosynthesis & mucus-sheet particle trapping',
    description:
      'Centuries-old multi-lobed boulder corals anchoring the Gulf of Eilat reef framework. Their dense, pitted aragonite skeletons host burrowing Christmas tree worms and provide perches for resting hawkfish and starfish.',
    opticalNote:
      'Warm mustard-brown and pale ochre lobes gradually desaturate into olive-slate tones with depth, while sunlit crests catch sharp dual-layer Voronoi caustic ribbons.',
  },
  dendronephthya: {
    id: 'dendronephthya',
    commonName: 'Carnation Soft Tree Coral',
    hebrewName: 'אלמוג רך ענפי',
    scientificName: 'Dendronephthya hemprichi',
    category: 'Azooxanthellate Soft Coral',
    status: 'Least Concern',
    depthRange: '4–40 m',
    depthMin: 4,
    depthMax: 40,
    diet: 'Passive suspension feeding on drifting phytoplankton & detritus',
    description:
      'Ornamental Red Sea soft tree coral lacking zooxanthellae, flourishing beneath reef overhangs, canyon arches, and drop-off walls where currents sweep past translucent stalks topped with crimson and magenta polyp umbels.',
    opticalNote:
      'Rich scarlet and carmine sclerites appear vivid in shallow caves and under dive lamps, darkening rapidly into velvety maroon below 14 m as red wavelengths attenuate.',
  },
  sarcophyton: {
    id: 'sarcophyton',
    commonName: 'Mushroom Leather & Pulsing Soft Coral',
    hebrewName: 'אלמוג עור',
    scientificName: 'Sarcophyton trocheliophorum',
    category: 'Alcyonacean Soft Coral',
    status: 'Least Concern',
    depthRange: '1–25 m',
    depthMin: 1,
    depthMax: 25,
    diet: 'Zooxanthellate photosynthesis & dissolved organic matter',
    description:
      'Fleshy, convoluted leather caps swaying rhythmically in surge along Eilat reef terraces, accompanied by soft pulsing polyps that fold over warm-ochre lobes.',
    opticalNote:
      'Tan-ochre tissue retains subtle chartreuse sheen into moderate depths while recessed folds gather soft blue-cyan ambient scatter.',
  },

  // === INVERTEBRATES (6) ===
  entacmaea: {
    id: 'entacmaea',
    commonName: 'Bubble-Tip Anemone',
    hebrewName: 'שושנת ים בועתית',
    scientificName: 'Entacmaea quadricolor',
    category: 'Hexacoral Sea Anemone',
    status: 'Least Concern',
    depthRange: '2–30 m',
    depthMin: 2,
    depthMax: 30,
    diet: 'Zooxanthellae & nematocyst-captured crustaceans and small fishes',
    description:
      'Natural Gulf of Eilat zooxanthellate morph forming lush colonies of densely packed, supple olive-sage and honey-tan tentacles with frosted cream sub-terminal swellings and soft rose-blush or pale-chartreuse tips. Forms an obligate mutualism with Amphiprion bicinctus, shielding the clownfish inside stinging tentacles when predators patrol nearby.',
    opticalNote:
      'Warm rose-blush tips and honey-tan zooxanthellate tissue shift toward cool olive-sage under Beer-Lambert attenuation, whereas pale-chartreuse tips remain luminous in penetrating blue-green light.',
  },
  diadema: {
    id: 'diadema',
    commonName: 'Long-Spined Sea Urchin',
    hebrewName: 'קיפוד ים שחור',
    scientificName: 'Diadema setosum',
    category: 'Echinoid Grazer',
    status: 'Regionally Vulnerable (2023 Mass Mortality Recovery)',
    depthRange: '1–25 m',
    depthMin: 1,
    depthMax: 25,
    diet: 'Benthic turf algae & coralline-clearing herbivory',
    description:
      'Keystone Gulf of Eilat grazer tucked into limestone crevices, keeping fast-growing turf algae from smothering juvenile corals. Distinguished by brittle black needle spines, five iridescent blue spots, and an orange anal ring.',
    opticalNote:
      'Carbon-black spines absorb nearly all incident light for dramatic silhouettes against carbonate sand, while blue iridophores reflect penetrating ~470 nm light.',
  },
  tridacna: {
    id: 'tridacna',
    commonName: 'Maxima Giant Clam',
    hebrewName: 'צדפת ענק',
    scientificName: 'Tridacna maxima',
    category: 'Symbiotic Bivalve Mollusc',
    status: 'Conservation Dependent (Red Sea Reef Icon)',
    depthRange: '1–18 m',
    depthMin: 1,
    depthMax: 18,
    diet: 'Zooxanthellae farmed inside hypertrophied mantle & filter feeding',
    description:
      'Deeply fluted carbonate shell embedded into Eilat reef ledges, opening to expose a fleshy electric-blue and turquoise mantle dotted with hyaline lens organs that focus sunlight onto symbiotic algae.',
    opticalNote:
      'Structural iridocytes scatter 450–510 nm blue-cyan wavelengths directly, keeping the mantle astonishingly luminous even as red light disappears with depth.',
  },
  starfish: {
    id: 'starfish',
    commonName: 'Red Sea Tile Starfish',
    hebrewName: 'כוכב ים אדום',
    scientificName: 'Fromia ghardaqana',
    category: 'Asteroidea Echinoderm',
    status: 'Least Concern (Red Sea Endemic)',
    depthRange: '2–28 m',
    depthMin: 2,
    depthMax: 28,
    diet: 'Microbial biofilms, detritus & encrusting sponges',
    description:
      'Endemic Red Sea five-armed sea star adorned with crimson-scarlet dermal plates and pale cream ossicle nodes, creeping slowly across fossil limestone spurs and canyon rims.',
    opticalNote:
      'Intense crimson pigmentation shifts toward deep rust and plum-black below 12 m under exponential red-channel absorption, revealing true scarlet only at shallow depths.',
  },
  seacucumber: {
    id: 'seacucumber',
    commonName: 'Sea Cucumber',
    hebrewName: 'מלפפון ים',
    scientificName: 'Holothuria edulis / Pearsonothuria graeffei',
    category: 'Holothurian Deposit Feeder',
    status: 'Least Concern (Protected in Eilat Reserves)',
    depthRange: '1–28 m',
    depthMin: 1,
    depthMax: 28,
    diet: 'Organic detritus & microalgae sifted from carbonate coral sand',
    description:
      'Benthic sand-sweeping holothurians patrolling the sandy canyon floor. Gently contracts its muscular body wall while sweeping peltate feeding tentacles across carbonate grains to recycle nutrients and oxygenate sediment.',
    opticalNote:
      'Dark charcoal dorsal skin contrasts sharply against sunlit rippled carbonate sand, while pinkish-cream ventral bands fade rapidly into cool slate tones below 8 m.',
  },
  featherstar: {
    id: 'featherstar',
    commonName: 'Red Sea Feather Star',
    hebrewName: 'נוצת ים / חבצלת ים',
    scientificName: 'Lamprometra klunzingeri',
    category: 'Crinoid Echinoderm',
    status: 'Least Concern',
    depthRange: '2–35 m',
    depthMin: 2,
    depthMax: 35,
    diet: 'Passive current filtration of drifting plankton via pinnate arms',
    description:
      'Graceful crinoid perched atop elevated limestone spurs and coral pinnacles, unfurling radiating feathery arms in oscillating fans to sieve plankton from Eilat’s currents.',
    opticalNote:
      'Banded burgundy, gold, and ivory pinnules produce high-frequency silhouettes against blue water scatter and catch crisp caustic highlights near the reef crest.',
  },

  // === FISH, PELAGICS, RAYS & PREDATORS (14) ===
  pseudanthias: {
    id: 'pseudanthias',
    commonName: 'Lyretail Anthias',
    hebrewName: 'פזית ים-סוף',
    scientificName: 'Pseudanthias squamipinnis',
    category: 'Planktivorous Reef Fish',
    status: 'Least Concern',
    depthRange: '2–35 m',
    depthMin: 2,
    depthMax: 35,
    diet: 'Diurnal drifting zooplankton (copepods & pelagic larvae)',
    description:
      'Iconic haremic anthias exhibiting marked 1:10 male-to-female protogynous sexual dimorphism: ~91% are golden-tangerine females with sunny yellow bellies, violet-blue cheek streaks, and smooth spineless dorsal fins, led by ~9% larger crimson-magenta territorial males sporting an elongated 3rd dorsal spine banner and bright magenta-red pectoral blotch. In Eilat’s prevailing current, schools hover on the up-current side of Acropora and Stylophora colonies facing into the oncoming plankton flow before darting into coral branches when predators approach.',
    opticalNote:
      'Vivid tangerine female scales and crimson-magenta male flanks glow brilliantly above 6 m, transitioning toward warm bronze-amber and deep plum below 18 m as Beer-Lambert absorption attenuates red wavelengths.',
  },
  chromis: {
    id: 'chromis',
    commonName: 'Blue-Green Chromis',
    hebrewName: 'כרומית ירקרקת',
    scientificName: 'Chromis viridis',
    category: 'Coral-Associated Planktivorous Damselfish',
    status: 'Least Concern',
    depthRange: '1–15 m',
    depthMin: 1,
    depthMax: 15,
    diet: 'Diurnal copepods, zoea larvae & drifting micro-zooplankton',
    description:
      'Dense shimmering clouds of iridescent seafoam-green and sky-blue Chromis viridis hover above dedicated branching Acropora and Stylophora colonies (partitioned onto separate coral heads from Pseudanthias schools), facing into the current to snap plankton and diving synchronously into branch interstices when predators approach.',
    opticalNote:
      'Structural guanine iridophores reflect 480–530 nm cyan-green wavelengths across shallow and mid-reef depths, preserving shimmering teal-turquoise contrast under Beer-Lambert attenuation.',
  },
  abudefduf: {
    id: 'abudefduf',
    commonName: 'Red Sea Sergeant Major',
    hebrewName: 'דפדוף הפסים',
    scientificName: 'Abudefduf vaigiensis',
    category: 'Omnivorous Damselfish',
    status: 'Least Concern',
    depthRange: '1–18 m',
    depthMin: 1,
    depthMax: 18,
    diet: 'Zooplankton, benthic algae & small invertebrates',
    description:
      'Bold silver-and-lemon damselfish marked with five crisp black vertical bars. Travels in cohesive schools swimming and crossing from one side of the reef to the other over coral spurs and canyons, pausing at Labroides cleaning stations when passing by, and darting toward coral shelter when predators approach.',
    opticalNote:
      'High-contrast silver flanks and lemon dorsal saddles reflect green-blue wavelengths efficiently, preserving crisp bar patterning across all recreational dive depths.',
  },
  goatfish: {
    id: 'goatfish',
    commonName: 'Red Sea Goatfish',
    hebrewName: 'ברבוניה אדומה / מולית',
    scientificName: 'Parupeneus forsskali',
    category: 'Benthic Sand Forager',
    status: 'Least Concern (Red Sea Endemic)',
    depthRange: '1–30 m',
    depthMin: 1,
    depthMax: 30,
    diet: 'Polychaetes, crustaceans & molluscs probed from coral sand',
    description:
      'Elongated pale-cream fish with a bold dark lateral stripe and yellow tail, cruising low over the sandy canyon floor while sweeping sensory chin barbels through carbonate sand to uncover hidden invertebrates.',
    opticalNote:
      'Silvery-white body scales match bright sand reflections and pick up rippling caustic bands as the fish weaves through canyon grooves.',
  },
  amphiprion: {
    id: 'amphiprion',
    commonName: 'Red Sea Two-Band Clownfish',
    hebrewName: 'שושנון ים-סופי',
    scientificName: 'Amphiprion bicinctus',
    category: 'Symbiotic Pomacentrid Fish',
    status: 'Least Concern',
    depthRange: '1–28 m',
    depthMin: 1,
    depthMax: 28,
    diet: 'Benthic algae, copepods & anemone-associated detritus',
    description:
      'Endemic Red Sea anemonefish distinguished by two crisp white vertical bands across an amber-gold body. Lives in a strict size-ordered social hierarchy per host Entacmaea quadricolor anemone—a dominant female (~30% larger) paired with a smaller adult male, and frequently a diminutive non-breeding juvenile sheltering close among the tentacles—darting deep inside whenever a predator approaches within ~4 m.',
    opticalNote:
      'Bright white vertical bars scatter blue-green light efficiently at every depth, sustaining pair-recognition contrast even in turbid or deep twilight water.',
  },
  chaetodon: {
    id: 'chaetodon',
    commonName: 'Exquisite Butterflyfish',
    hebrewName: 'פרפרון אילתי',
    scientificName: 'Chaetodon austriacus',
    category: 'Obligate Corallivore Fish',
    status: 'Least Concern (Red Sea Endemic)',
    depthRange: '1–20 m',
    depthMin: 1,
    depthMax: 20,
    diet: 'Scleractinian coral polyps & sea anemone tentacles',
    description:
      'Endemic Red Sea jewel with a compressed golden-yellow disc body, diagonal pinstripes, black eye mask, and dark caudal band; swims in bonded monogamous pairs low near the reef floor, patrolling territorial circuits between coral colonies, pausing in tandem to nip polyps, and tucking beside coral bases when predators pass.',
    opticalNote:
      'Golden-yellow scales reflect green (~540 nm) and red (~600 nm) bands, shifting gracefully toward cool chartreuse-yellow with increasing depth.',
  },
  caesio: {
    id: 'caesio',
    commonName: 'Suez Fusilier',
    hebrewName: 'חפף סואץ / כחלון סואץ',
    scientificName: 'Caesio suevica',
    category: 'Pelagic Schooling Fish',
    status: 'Least Concern (Red Sea Endemic)',
    depthRange: '2–35 m',
    depthMin: 2,
    depthMax: 35,
    diet: 'Open-water zooplankton along drop-off currents',
    description:
      'Endemic Red Sea & Gulf of Eilat fusilier (FishBase #922) featuring an electric-cerulean back, a bright golden-yellow dorso-lateral band, and yellow forked tail lobes tipped in black. Forms fast, tightly polarized schools crossing from side to side high in the open mid-water column well above the reef floor.',
    opticalNote:
      'Metallic cerulean backs tune directly to 470 nm downwelling blue light, making the mid-water ribbons flash like liquid neon against deep pelagic scatter while golden bands retain green-yellow contrast.',
  },
  cleanerwrasse: {
    id: 'cleanerwrasse',
    commonName: 'Bluestreak Cleaner Wrasse',
    hebrewName: 'נקאי אילתי',
    scientificName: 'Labroides dimidiatus',
    category: 'Mutualistic Cleaner Wrasse',
    status: 'Least Concern',
    depthRange: '1–35 m',
    depthMin: 1,
    depthMax: 35,
    diet: 'Gnathiid ectoparasites, mucus & dead tissue gleaned from client fishes',
    description:
      'Slender reef mutualist marked by a vivid electric-blue flank, pale cream throat, and widening black lateral stripe reaching the tail. Operates in size-dimorphic bonded pairs—a noticeably larger dominant partner paired with a smaller companion—anchored around elevated, topographically complex coral pinnacles, advertising their cleaning station with an undulating seesaw dance so client fishes and turtles swim up to hover clean under a strict predation truce.',
    opticalNote:
      'Electric-cyan lateral stripes strongly reflect ~475 nm penetrating blue light, acting as a long-range visual beacon guiding client fishes to cleaning stations across all dive depths.',
  },
  caranx: {
    id: 'caranx',
    commonName: 'Bluefin Trevally',
    hebrewName: 'טרוולי כחול-סנפיר',
    scientificName: 'Caranx melampygus',
    category: 'Pelagic Reef Predator',
    status: 'Least Concern',
    depthRange: '2–60 m',
    depthMin: 2,
    depthMax: 60,
    diet: 'Small schooling reef fishes (anthias, fusiliers, damselfish) & crustaceans',
    description:
      'Muscular, fast-cruising silver-blue apex hunter patrolling from the northern drop-off through the central reef canyon. Its sweeping passes trigger instant defensive diving among anthias and sergeant majors.',
    opticalNote:
      'Counter-shaded silver flanks and electric-blue dorsal fins reflect ambient blue-cyan light cleanly at long range before fading seamlessly into water scatter.',
  },
  taeniura: {
    id: 'taeniura',
    commonName: 'Bluespotted Ribbontail Ray',
    hebrewName: 'מחבטן הספירים',
    scientificName: 'Taeniura lymma (Fabricius, 1775)',
    category: 'Stingray · Family Dasyatidae (משפחת הטריגוניים)',
    status: 'Near Threatened',
    depthRange: '1–30 m',
    depthMin: 1,
    depthMax: 30,
    diet: 'Molluscs, worms, shrimps & crabs excavated from coral sand',
    description:
      'מחבטן הספירים הוא בטאי קטן ממשפחת הטריגוניים (Dasyatidae), הכוללת 108 מינים שונים ברחבי העולם. ביניהם טריגון אטלנטי (Dasyatis marmorata), טריגון חד-אף (Dasyatis pastinaca), וטריגון נקוד (Himantura uarnak) המוכרים גם בישראל. מין זה הוא אחד ממיני הבטאים הנפוצים ביותר בתצפיות בארץ.\n\nIconic Gulf of Eilat stingray gliding gracefully over sandy canyon channels and resting beneath tabular Acropora overhangs. Recognizable by its sandy khaki-ochre rounded oval disc with a pale buff margin, prominent raised golden-amber eyes ahead of crescentic spiracles, vivid electric-blue spots grading finer toward the rim, twin dorsal caudal stingers, and electric-blue tail stripes.',
    opticalNote:
      'Electric-blue ocelli and tail stripes match peak penetrating blue wavelengths (~460 nm), glowing vividly along the dim canyon floor even as sandy khaki-ochre skin dims.',
  },
  aetobatus: {
    id: 'aetobatus',
    commonName: 'Spotted Eagle Ray',
    hebrewName: 'טחן נקוד',
    scientificName: 'Aetobatus ocellatus (Kuhl, 1823)',
    category: 'Pelagic Eagle Ray · Family Aetobatidae (משפחת הטחניים)',
    status: 'Vulnerable',
    depthRange: '1–40 m',
    depthMin: 1,
    depthMax: 40,
    diet: 'Hard-shelled bivalves, gastropods, crustaceans & echinoderms crushed with pavement tooth plates',
    description:
      'טחן נקוד הוא בטאי פלאגי מרשים ממשפחת הטחניים (Aetobatidae), המעופף בגוף המים בתנועות נפנוף רחבות דמויות ציפור לאורך מדרונות השונית וקירות העומק במפרץ אילת. מתאפיין בסנפירי חזה רחבים ומחודדים בצורת יהלום-כנף, חרטום שטוח ובולט דמוי מקור ברווז לחפירת רכיכות בחול, גב כהה בגוון שחור-אינדיגו זרוע טבעות ונקודות לבנות, גחון לבן צחור וזנב שוט ארוך ודק הנושא קוצים ארסיים בבסיסו.\n\nMajestic Indo-Pacific pelagic eagle ray (historically recorded in Red Sea surveys under A. narinari) soaring smoothly across Eilat’s fore-reef drop-offs and sandy canyons with slow, bird-like Myliobatiform wingstrokes. Distinguished by swept-back falcate pectoral wings, an elevated head with lateral eyes and oblique spiracles, a projecting duck-bill snout, ivory ocellated rings and spots over a midnight-indigo dorsum, stark white ventral counter-shading, and a long whip-like tail.',
    opticalNote:
      'High-contrast ivory dorsal ocelli and stark white ventral counter-shading remain crisp across 5–35 m depths, while the midnight-indigo mantle blends into deep pelagic scatter from above.',
  },
  chelonia: {
    id: 'chelonia',
    commonName: 'Green Sea Turtle',
    hebrewName: 'צב ים ירוק',
    scientificName: 'Chelonia mydas',
    category: 'Marine Reptile / Herbivorous Megafauna',
    status: 'Endangered',
    depthRange: '1–35 m',
    depthMin: 1,
    depthMax: 35,
    diet: 'Halophila stipulacea seagrass, turf algae & reef sponges',
    description:
      'Iconic Gulf of Eilat marine reptile featuring a teardrop-domed carapace of 5 vertebral and 8 costal scutes streaked in sunburst amber, olive-bronze, and mahogany, a pale cream plastron, prefrontal head scales, and wing-like fore-flippers. Glides serenely on pelagic figure-8 power strokes between Halophila seagrass pockets, reef ledges, and periodic surface breaths.',
    opticalNote:
      'Warm amber-chestnut carapace streaks glow richly in sunlit shallows under wave caustics, shifting smoothly toward bronze-olive tones at mid-reef depths while pale cream scute seams and plastron reflect ambient cyan scatter.',
  },
  grouper: {
    id: 'grouper',
    commonName: 'Coral Hind / Vermilion Grouper',
    hebrewName: 'לוקוס שונית',
    scientificName: 'Cephalopholis miniata',
    category: 'Demersal Reef Predator',
    status: 'Least Concern',
    depthRange: '3–40 m',
    depthMin: 3,
    depthMax: 40,
    diet: 'Small reef fishes (especially Pseudanthias) & benthic crustaceans',
    description:
      'Heavy-bodied ambush predator patterned in scarlet-vermilion speckled with iridescent blue dots. Patrols canyon walls and limestone ledges, forcing anthias and clownfish into rapid shelter inside corals and anemones.',
    opticalNote:
      'Classic Red Sea camouflage: vermilion skin reads bright red in shallow surge or dive lights, yet turns dark cryptic brown-grey at 15–25 m while blue spots remain faintly visible.',
  },
  pterois: {
    id: 'pterois',
    commonName: 'Red Sea Lionfish',
    hebrewName: 'זהרון הדור',
    scientificName: 'Pterois miles',
    category: 'Venomous Ambush Predator',
    status: 'Least Concern',
    depthRange: '1–50 m',
    depthMin: 1,
    depthMax: 50,
    diet: 'Small reef fishes & crustaceans cornered with flared pectoral fans',
    description:
      'Ornate nocturnal-crepuscular hunter of Eilat overhangs and reef arches, hovering slowly with striped crimson-and-ivory body, venomous dorsal spines, and sweeping feathery pectoral plumes.',
    opticalNote:
      'Alternating ivory and deep maroon bands create disruptive high-contrast outlines in shaded caves and under dappled caustic shafts.',
  },
  moray: {
    id: 'moray',
    commonName: 'Geometric Moray Eel',
    hebrewName: 'מורנה נקודתית / אפורה',
    scientificName: 'Gymnothorax griseus',
    category: 'Crevice Apex Predator',
    status: 'Least Concern',
    depthRange: '2–50 m',
    depthMin: 2,
    depthMax: 50,
    diet: 'Reef fishes, octopuses & crustaceans hunted in reef crevices',
    description:
      'Slender Gulf of Eilat moray anchoring limestone caves and canyon swim-throughs, distinguished by a pale silvery-lilac and warm grey-taupe head, fine tan-ochre flank marbling, a stark chalk-white iris, and signature geometric rows of jet-black sensory-pore dots across the jaws, snout, and temple. Protrudes rhythmically from crevices or undulates with sinusoidal S-waves low across the reef, scattering nearby small fish.',
    opticalNote:
      'Pale silvery-lilac head tones and fine tan-ochre marbling reflect ambient blue-cyan light in shaded crevices, while the stark chalk-white iris and jet-black facial pore rows retain crisp close-range definition.',
  },
  lizardfish: {
    id: 'lizardfish',
    commonName: 'Sand Lizardfish',
    hebrewName: 'לטאנון החול',
    scientificName: 'Synodus variegatus',
    category: 'Sit-and-Wait Benthic Ambush Predator',
    status: 'Least Concern',
    depthRange: '1–35 m',
    depthMin: 1,
    depthMax: 35,
    diet: 'Small reef fishes (anthias, damselfish, gobies) & crustaceans ambushed from sand',
    description:
      'Cryptic carbonate-sand and rust-saddle camouflage, flattened reptilian head with upturned toothy jaws and dorsally perched eyes, resting motionless propped nose-up on pelvic fins across open sandy canyon floors before launching lightning-fast upward ambush strikes at passing prey.',
    opticalNote:
      'Mottled cream-tan scales and rufous saddles match carbonate sand reflectance and rippling caustic focal lines, rendering it nearly invisible until it lunges.',
  },
};
