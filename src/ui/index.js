import * as THREE from 'three';
import { SPECIES_CATALOG } from '../contracts.js';
import './styles.css';
import { createHUD } from './hud.js';
import { createPOVCompass } from './povCompass.js';
import { createSideWheel } from './sideWheel.js';
import { createSpeciesCard } from './speciesCard.js';
import { createWelcomeScreen } from './welcomeScreen.js';

function findSpeciesIdFromHit(hit) {
  const hitObj = hit?.object;
  if (!hitObj || !hitObj.visible) return null;
  if (
    hitObj.isInstancedMesh &&
    hit.instanceId !== undefined &&
    hit.instanceId >= hitObj.count
  ) {
    return null;
  }
  let obj = hitObj;
  while (obj) {
    if (!obj.visible) return null;
    const id = obj.userData?.speciesId;
    if (id && SPECIES_CATALOG[id]) {
      return id;
    }
    obj = obj.parent;
  }
  return null;
}

/**
 * Creates the full UI overlay: collapsible glassmorphic HUD,
 * top-right 360° POV & Compass panel, hover tooltip, and bottom-right species card.
 */
export function createUI({
  envState,
  onEnvChange,
  cameraCtrl,
  pickableMeshes = [],
  camera,
  domElement,
  getTransmittanceAtDepth,
}) {
  let latestEnvState = envState;

  const root = document.createElement('div');
  root.id = 'reef-ui-root';

  const hint = document.createElement('div');
  hint.className = 'controls-hint';
  hint.textContent =
    'Drag: 360° Look · Double-Click: Swim to Target · Shift/Right-Drag: Pan · Wheel: Move/Zoom · WASD: Swim · E/Space: Up · Q/C/Shift: Down · R: Level · Click Species: Info';

  document.body.appendChild(root);

  let hud = null;
  let povCompass = null;
  const speciesCard = createSpeciesCard({
    root,
    getTransmittanceAtDepth,
    onEnvChange,
    onClose: () => {
      hud?.setActiveSpecies(null);
    },
  });

  function selectSpecies(speciesId) {
    if (!speciesId || !SPECIES_CATALOG[speciesId]) {
      speciesCard.close();
      hud?.setActiveSpecies(null);
      return;
    }
    if (window.innerWidth < 1160) {
      povCompass?.collapse();
    }
    speciesCard.showSpecies(speciesId, latestEnvState);
    hud?.setActiveSpecies(speciesId);
  }

  const welcomeScreen = createWelcomeScreen({ root });

  hud = createHUD({
    root,
    envState: latestEnvState,
    onEnvChange,
    cameraCtrl,
    getTransmittanceAtDepth,
    onSelectSpecies: selectSpecies,
    onOpenWelcome: () => welcomeScreen.open(),
  });

  povCompass = createPOVCompass({
    root,
    cameraCtrl,
  });

  const sideWheel = createSideWheel({
    root,
    cameraCtrl,
    envState: latestEnvState,
    onEnvChange,
  });

  root.appendChild(hint);

  // 3D Raycasting for hover tooltip and click-to-inspect
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  function pickSpeciesAtClientPos(clientX, clientY) {
    if (!domElement || !camera || !pickableMeshes || pickableMeshes.length === 0) {
      return null;
    }
    const rect = domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(pickableMeshes, true);
    for (let i = 0; i < hits.length; i++) {
      const id = findSpeciesIdFromHit(hits[i]);
      if (id) return id;
    }
    return null;
  }

  function onPointerMove(e) {
    if (welcomeScreen.isOpen()) {
      speciesCard.hideTooltip();
      if (domElement) domElement.style.cursor = '';
      return;
    }
    if (cameraCtrl?.isDragging()) {
      speciesCard.hideTooltip();
      if (domElement) domElement.style.cursor = 'grabbing';
      return;
    }
    const speciesId = pickSpeciesAtClientPos(e.clientX, e.clientY);
    if (speciesId) {
      speciesCard.showTooltip(speciesId, e.clientX, e.clientY);
      if (domElement) domElement.style.cursor = 'pointer';
    } else {
      speciesCard.hideTooltip();
      if (domElement) domElement.style.cursor = '';
    }
  }

  function onPointerLeave() {
    speciesCard.hideTooltip();
    if (domElement) domElement.style.cursor = '';
  }

  function onClick(e) {
    if (welcomeScreen.isOpen()) return;
    if (cameraCtrl?.isDragging()) return;
    const speciesId = pickSpeciesAtClientPos(e.clientX, e.clientY);
    if (speciesId) {
      selectSpecies(speciesId);
    }
  }

  if (domElement) {
    domElement.addEventListener('pointermove', onPointerMove);
    domElement.addEventListener('pointerleave', onPointerLeave);
    domElement.addEventListener('click', onClick);
  }

  function update(_elapsedTime, _camera, currentEnvState) {
    if (currentEnvState) {
      latestEnvState = currentEnvState;
    }
    hud.update(latestEnvState);
    povCompass.update(latestEnvState);
    sideWheel.update(latestEnvState);
    speciesCard.update(latestEnvState);
  }

  function dispose() {
    if (domElement) {
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerleave', onPointerLeave);
      domElement.removeEventListener('click', onClick);
      domElement.style.cursor = '';
    }
    welcomeScreen.dispose();
    hud.dispose();
    povCompass.dispose();
    sideWheel.dispose();
    speciesCard.dispose();
    root.remove();
  }

  return {
    update,
    selectSpecies,
    welcomeScreen,
    dispose,
  };
}
