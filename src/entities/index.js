import * as THREE from 'three';
import {
  DEFAULT_ENV_STATE,
  SPECIES_CATALOG,
  SPECIES_POPULATION_SPEC,
  createDefaultSpeciesCounts,
  getSeabedHeight as defaultGetSeabedHeight,
  sanitizeSpeciesCount,
} from '../contracts.js';
import { createReefBommies } from './reefBommies.js';
import { createCorals } from './corals.js';
import { createInvertebrates } from './invertebrates.js';
import { createPredatorsAndRays } from './predatorsAndRays.js';
import { createFish } from './fish.js';
import { createCleaningStations } from './cleaningStations.js';

export function createBiodiversitySystem(scene, options = {}) {
  const {
    applyUnderwaterMaterial = (m) => m,
    getSeabedHeight = defaultGetSeabedHeight,
  } = options;

  const group = new THREE.Group();
  group.name = 'gulf-of-eilat-biodiversity';

  const bommySystem = createReefBommies({
    applyUnderwaterMaterial,
    getSeabedHeight,
  });
  group.add(bommySystem.group);

  const coralSystem = createCorals({
    applyUnderwaterMaterial,
    sampleSubstrate: bommySystem.sampleSubstrate,
  });
  group.add(coralSystem.group);

  const invertSystem = createInvertebrates({
    applyUnderwaterMaterial,
    sampleSubstrate: bommySystem.sampleSubstrate,
    getSeabedHeight,
  });
  group.add(invertSystem.group);

  const cleaningSystem = createCleaningStations({
    applyUnderwaterMaterial,
    getSeabedHeight,
    coralHeads: coralSystem.coralHeads,
  });
  group.add(cleaningSystem.group);

  const predatorSystem = createPredatorsAndRays({
    applyUnderwaterMaterial,
    getSeabedHeight,
    sampleSubstrate: bommySystem.sampleSubstrate,
    coralHeads: coralSystem.coralHeads,
    caves: bommySystem.caves,
    cleaningSystem,
  });
  group.add(predatorSystem.group);

  const fishSystem = createFish({
    applyUnderwaterMaterial,
    getSeabedHeight,
    coralHeads: coralSystem.coralHeads,
    anemoneAnchors: invertSystem.anemoneAnchors,
    bommies: bommySystem.bommies,
    predators: predatorSystem.predators,
    cleaningSystem,
  });
  group.add(fishSystem.group);

  if (scene) {
    scene.add(group);
  }

  const pickableMeshes = [
    ...coralSystem.pickableMeshes,
    ...invertSystem.pickableMeshes,
    ...cleaningSystem.pickableMeshes,
    ...predatorSystem.pickableMeshes,
    ...fishSystem.pickableMeshes,
  ];

  const internalSpeciesCounts = createDefaultSpeciesCounts();

  function applyAllSpeciesCounts(speciesCounts) {
    coralSystem.applySpeciesCounts(speciesCounts);
    invertSystem.applySpeciesCounts(speciesCounts);
    cleaningSystem.applySpeciesCounts(speciesCounts);
    predatorSystem.applySpeciesCounts(speciesCounts);
    fishSystem.applySpeciesCounts(speciesCounts);
  }

  function getActiveSpeciesCounts() {
    const merged = {
      ...coralSystem.getActiveCounts(),
      ...invertSystem.getActiveCounts(),
      ...cleaningSystem.getActiveCounts(),
      ...predatorSystem.getActiveCounts(),
      ...fishSystem.getActiveCounts(),
    };
    const out = {};
    const catalogIds = Array.isArray(SPECIES_CATALOG)
      ? SPECIES_CATALOG.map((s) => s.id)
      : Object.keys(SPECIES_POPULATION_SPEC);
    for (let i = 0; i < catalogIds.length; i++) {
      const id = catalogIds[i];
      const spec = SPECIES_POPULATION_SPEC[id];
      out[id] = merged[id] ?? sanitizeSpeciesCount(id, spec ? spec.defaultCount : 0);
    }
    for (const id of Object.keys(SPECIES_POPULATION_SPEC)) {
      if (!(id in out)) {
        out[id] = merged[id] ?? sanitizeSpeciesCount(id, SPECIES_POPULATION_SPEC[id].defaultCount);
      }
    }
    return out;
  }

  function setSpeciesCount(speciesId, count, envState) {
    if (!SPECIES_POPULATION_SPEC[speciesId]) return 0;
    const sanitized = sanitizeSpeciesCount(speciesId, count);
    internalSpeciesCounts[speciesId] = sanitized;
    let targetCounts = internalSpeciesCounts;
    if (envState && typeof envState === 'object') {
      if (!envState.speciesCounts || envState.speciesCounts === DEFAULT_ENV_STATE.speciesCounts) {
        envState.speciesCounts = {
          ...(envState.speciesCounts || DEFAULT_ENV_STATE.speciesCounts || internalSpeciesCounts),
        };
      }
      envState.speciesCounts[speciesId] = sanitized;
      targetCounts = envState.speciesCounts;
    }
    applyAllSpeciesCounts(targetCounts);
    return sanitized;
  }

  function update(elapsedTime, deltaTime, envState) {
    const effectiveEnv =
      envState && envState.speciesCounts
        ? envState
        : { ...(envState || DEFAULT_ENV_STATE), speciesCounts: internalSpeciesCounts };
    coralSystem.update(elapsedTime, deltaTime, effectiveEnv);
    invertSystem.update(elapsedTime, deltaTime, effectiveEnv);
    predatorSystem.update(elapsedTime, deltaTime, effectiveEnv);
    fishSystem.update(elapsedTime, deltaTime, effectiveEnv);
    cleaningSystem.update(elapsedTime, deltaTime, effectiveEnv);
  }

  return {
    group,
    pickableMeshes,
    anemoneAnchors: invertSystem.anemoneAnchors,
    coralHeads: coralSystem.coralHeads,
    predators: predatorSystem.predators,
    lizardfish: predatorSystem.lizardfish,
    cleaningStations: cleaningSystem.stations,
    cleanerWrasses: cleaningSystem.wrasses,
    getActiveSpeciesCounts,
    setSpeciesCount,
    update,
  };
}
