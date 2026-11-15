import * as THREE from 'three';
import {
  DEFAULT_ENV_STATE,
  SPECIES_POPULATION_SPEC,
  WORLD_CONSTANTS,
  getSeabedHeight as defaultGetSeabedHeight,
  sanitizeSpeciesCount,
} from '../contracts.js';
import { sampleFlowField } from '../physics/flowField.js';
import {
  PART_BODY,
  PART_MEDIAN_FIN,
  PART_PECTORAL_LEFT,
  PART_PECTORAL_RIGHT,
  addFishEyes,
  attachSwimStateAttribute,
  buildFinStrip,
  buildPairedPectoralFins,
  buildPairedPelvicFins,
  buildParametricFishBody,
  cellularSpotMask,
  computeUAttach,
  createAnimatedFishMaterial,
  createMatrixScratch,
  orientFishMatrix,
  prepareFishPart,
  setSwimState,
} from './fishGeometry.js';
import {
  avoidBommiesXZ,
  configureDynamicMesh,
  createRng,
  enableShadows,
  prepareForMerge,
  safeMerge,
  safeNormalize,
} from './utils.js';

// -----------------------------------------------------------------------------
// 1. Red Sea Coral Grouper (Cephalopholis miniata) — ~34.3-41.3 cm TL vermilion + cyan ocelli
// -----------------------------------------------------------------------------
function buildGrouperPrototype() {
  const parts = [];
  const S = 0.565;
  const length = 0.52 * S;
  const halfHeight = 0.118 * S;
  const halfWidth = 0.068 * S;
  const tailPivotZ = 0.245 * S;

  const cVermilion = new THREE.Color('#d63022');
  const cBelly = new THREE.Color('#f06430');
  const cCyanSpot = new THREE.Color('#20b8ff');
  const cSpotRing = new THREE.Color('#1c2a48');
  const cMargin = new THREE.Color('#20b8ff');
  const cJawShade = new THREE.Color('#7a1812');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight,
      halfWidth,
      segsU: 40,
      segsV: 24,
      dorsalSharpness: 0.18,
      operculumRidge: 0.11,
      tailPivotZ,
      heightProfile: (u) => {
        if (u < 0.14) return 0.36 + (u / 0.14) * 0.34;
        if (u <= 0.80) return 0.70 + Math.sin(((u - 0.14) / 0.66) * Math.PI) * 0.30;
        return 0.70 * Math.pow((1 - u) / 0.20, 0.68);
      },
      dorsalProfile: (u) => {
        if (u < 0.14) return 0.36 + (u / 0.14) * 0.34;
        if (u <= 0.80) return 0.70 + Math.sin(((u - 0.14) / 0.66) * Math.PI) * 0.30;
        return 0.70 * Math.pow((1 - u) / 0.20, 0.74);
      },
      ventralProfile: (u) => {
        if (u < 0.14) return 0.34 + (u / 0.14) * 0.34;
        if (u <= 0.76) return 0.68 + Math.sin(((u - 0.14) / 0.62) * Math.PI) * 0.28;
        // Heavy convex lower jaw / stout serranid chin
        return 0.68 * Math.pow((1 - u) / 0.24, 0.50);
      },
      widthProfile: (u) => {
        const cheekBoost = 1.0 + 0.10 * Math.exp(-Math.pow((u - 0.76) / 0.13, 2));
        return Math.sin(Math.pow(u, 0.64) * Math.PI) * 0.94 * cheekBoost;
      },
      spineYOffset: (u) => (u > 0.78 ? Math.pow((u - 0.78) / 0.22, 1.15) * 0.07 : 0),
      colorFn: (zNorm, yNorm, xNorm, out) => {
        const bellyMix = THREE.MathUtils.clamp(-yNorm * 0.48 + 0.22, 0, 1);
        out.copy(cVermilion).lerp(cBelly, bellyMix);

        // Isotropic 3D Voronoi electric-cyan circular spots with dark outer rings
        const px = (xNorm * halfWidth) / S;
        const py = (yNorm * halfHeight) / S;
        const pz = (zNorm * (length * 0.5)) / S;
        const cell = cellularSpotMask(px, py, pz, 28.0, 0.64);
        if (cell.dist < 0.19) {
          out.copy(cCyanSpot);
        } else if (cell.dist < 0.265) {
          const ringMix = 1.0 - (cell.dist - 0.19) / 0.075;
          out.lerp(cSpotRing, 0.78 * ringMix);
        }

        // Subtle grouper mouth cleft shading
        if (zNorm > 0.86 && Math.abs(yNorm - 0.05) < 0.16) {
          out.lerp(cJawShade, 0.65);
        }
      },
    })
  );

  // Spiny anterior + rounded soft posterior dorsal fin with spots & thin electric-blue margin
  parts.push(
    buildFinStrip(
      [
        [-0.185 * S, 0.042 * S],
        [-0.165 * S, 0.128 * S],
        [-0.115 * S, 0.148 * S],
        [-0.065 * S, 0.138 * S],
        [-0.015 * S, 0.120 * S],
        [0.050 * S, 0.114 * S],
        [0.095 * S, 0.104 * S],
        [0.105 * S, 0.045 * S],
      ],
      0.0065 * S,
      (x, y, z, out) => {
        const sx = x / S;
        const sy = y / S;
        const sz = z / S;
        out.copy(cVermilion);
        const cell = cellularSpotMask(sx, sy, sz, 30.0, 0.64);
        if (cell.dist < 0.19) out.copy(cCyanSpot);
        else if (cell.dist < 0.26) out.lerp(cSpotRing, 0.72);
        // Thin electric-blue soft-fin margin along posterior rounded lobe
        if (sz < -0.025 && (sy > 0.132 || (sz < -0.148 && sy > 0.075))) {
          out.lerp(cMargin, 0.85);
        }
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 5 }
    )
  );

  // Rounded anal fin with spots & thin electric-blue margin
  parts.push(
    buildFinStrip(
      [
        [-0.175 * S, -0.040 * S],
        [-0.155 * S, -0.115 * S],
        [-0.105 * S, -0.142 * S],
        [-0.045 * S, -0.130 * S],
        [0.010 * S, -0.055 * S],
      ],
      0.0065 * S,
      (x, y, z, out) => {
        const sx = x / S;
        const sy = y / S;
        const sz = z / S;
        out.copy(cVermilion).lerp(cBelly, 0.35);
        const cell = cellularSpotMask(sx, sy, sz, 30.0, 0.64);
        if (cell.dist < 0.19) out.copy(cCyanSpot);
        else if (cell.dist < 0.26) out.lerp(cSpotRing, 0.72);
        if (sy < -0.124 || (sz < -0.142 && sy < -0.070)) {
          out.lerp(cMargin, 0.85);
        }
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 5 }
    )
  );

  // Pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.085 * S,
      yPos: -0.076 * S,
      xOffset: 0.018 * S,
      length: 0.092 * S,
      width: 0.050 * S,
      splay: 0.34,
      dip: -0.44,
      thickness: 0.0040 * S,
      bodyLength: length,
      tailPivotZ,
      colorFn: (x, y, z, out) => {
        out.copy(cBelly).lerp(cVermilion, 0.45);
        const cell = cellularSpotMask(x / S, y / S, z / S, 32.0, 0.64);
        if (cell.dist < 0.17) out.copy(cCyanSpot);
      },
    })
  );

  // Broad rounded paddle pectoral fins (scull noticeably at cleaning stations)
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.095 * S,
      yPos: -0.025 * S,
      xOffset: 0.056 * S,
      span: 0.115 * S,
      chord: 0.088 * S,
      sweep: -0.42,
      dihedral: -0.12,
      flare: 0.88,
      thickness: 0.0046 * S,
      bodyLength: length,
      tailPivotZ,
      shape: 'paddle',
      colorFn: (x, y, z, out) => {
        const sx = x / S;
        const sy = y / S;
        const sz = z / S;
        const spanApprox = THREE.MathUtils.clamp((Math.abs(sx) - 0.055) / 0.10, 0, 1);
        out.copy(cVermilion).lerp(cBelly, spanApprox * 0.55);
        if (spanApprox > 0.88) out.lerp(cMargin, 0.65);
        const cell = cellularSpotMask(sx, sy, sz, 34.0, 0.64);
        if (cell.dist < 0.16 && spanApprox < 0.72) out.copy(cCyanSpot);
      },
    })
  );

  addFishEyes(parts, 0.190 * S, 0.030 * S, 0.042 * S, 0.0155 * S, '#e2b84a', {
    bodyLength: length,
    tailPivotZ,
  });

  const bodyGeom = safeMerge(parts);

  // Convex rounded paddle caudal fin with dark-ringed cyan spots & electric-blue margin
  const tailGeom = buildFinStrip(
    [
      [0.006 * S, 0.044 * S],
      [-0.055 * S, 0.082 * S],
      [-0.115 * S, 0.078 * S],
      [-0.142 * S, 0.036 * S],
      [-0.148 * S, 0.0],
      [-0.142 * S, -0.036 * S],
      [-0.115 * S, -0.078 * S],
      [-0.055 * S, -0.082 * S],
      [0.006 * S, -0.044 * S],
    ],
    0.0068 * S,
    (x, y, z, out) => {
      const sx = x / S;
      const sy = y / S;
      const sz = z / S;
      out.copy(cVermilion);
      const cell = cellularSpotMask(sx, sy, sz, 31.0, 0.64);
      if (cell.dist < 0.19) out.copy(cCyanSpot);
      else if (cell.dist < 0.26) out.lerp(cSpotRing, 0.72);
      const edgeDist = Math.hypot(sz + 0.015, sy * 1.15);
      if (edgeDist > 0.124) out.lerp(cMargin, 0.88);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 5 }
  );

  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 2. Bluefin Trevally (Caranx melampygus) — ~54.5-65.5 cm TL diamond jack + cobalt scythes
// -----------------------------------------------------------------------------
function buildTrevallyPrototype() {
  const parts = [];
  const S = 0.82;
  const length = 0.56 * S;
  const halfHeight = 0.125 * S;
  const halfWidth = 0.054 * S;
  const tailPivotZ = 0.265 * S;

  const cSilver = new THREE.Color('#c0d2e2');
  const cBrass = new THREE.Color('#cbc6a8');
  const cBack = new THREE.Color('#265382');
  const cDarkFleck = new THREE.Color('#132d52');
  const cElectricFleck = new THREE.Color('#209cff');
  const cCobaltFin = new THREE.Color('#1a8cff');
  const cFinBase = new THREE.Color('#1450a6');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight,
      halfWidth,
      segsU: 40,
      segsV: 22,
      dorsalSharpness: 0.36,
      operculumRidge: 0.09,
      tailPivotZ,
      heightProfile: (u) => {
        if (u < 0.18) return 0.11 + Math.pow(u / 0.18, 1.25) * 0.34;
        if (u <= 0.76) return 0.45 + Math.sin(((u - 0.18) / 0.58) * Math.PI * 0.82) * 0.55;
        return 0.745 * Math.pow((1 - u) / 0.24, 0.54);
      },
      dorsalProfile: (u) => {
        if (u < 0.18) return 0.11 + Math.pow(u / 0.18, 1.25) * 0.34;
        if (u <= 0.76) return 0.45 + Math.sin(((u - 0.18) / 0.58) * Math.PI * 0.82) * 0.55;
        // Steep convex trevally forehead
        return 0.745 * Math.pow((1 - u) / 0.24, 0.50);
      },
      ventralProfile: (u) => {
        if (u < 0.18) return 0.10 + Math.pow(u / 0.18, 1.25) * 0.32;
        if (u <= 0.76) return 0.42 + Math.sin(((u - 0.18) / 0.58) * Math.PI * 0.86) * 0.50;
        return 0.633 * Math.pow((1 - u) / 0.24, 0.64);
      },
      widthProfile: (u) => {
        if (u < 0.16) return 0.08 + (u / 0.16) * 0.32;
        const bodySw = 0.40 + Math.sin(((u - 0.16) / 0.84) * Math.PI * 0.84) * 0.60;
        const snoutTaper = u > 0.86 ? Math.pow((1 - u) / 0.14, 0.60) : 1.0;
        return bodySw * snoutTaper;
      },
      colorFn: (zNorm, yNorm, xNorm, out) => {
        // Silvery-brass mid-flank grading to iridescent steel-blue back
        const brassBand = Math.exp(-Math.pow((yNorm + 0.05) / 0.35, 2));
        out.copy(cSilver).lerp(cBrass, brassBand * 0.32);
        if (yNorm > 0.08) {
          out.lerp(cBack, THREE.MathUtils.clamp((yNorm - 0.08) * 1.15, 0, 1));
        }

        // Above lateral line: cellularSpotMask dark blue & glowing electric-cyan flecks
        if (yNorm > 0.04 && zNorm < 0.78 && zNorm > -0.82) {
          const px = (xNorm * halfWidth) / S;
          const py = (yNorm * halfHeight) / S;
          const pz = (zNorm * (length * 0.5)) / S;
          const cell = cellularSpotMask(px, py, pz, 38.0, 0.72);
          if (cell.dist < 0.17) {
            out.copy(cell.cellHash > 0.42 ? cElectricFleck : cDarkFleck);
          }
        }
      },
    })
  );

  // Low 1st spiny dorsal fin
  parts.push(
    buildFinStrip(
      [
        [-0.015 * S, 0.075 * S],
        [0.012 * S, 0.148 * S],
        [0.068 * S, 0.158 * S],
        [0.086 * S, 0.075 * S],
      ],
      0.0048 * S,
      (_x, y, _z, out) => out.copy(cBack).lerp(cCobaltFin, THREE.MathUtils.clamp((y / S - 0.08) * 9.0, 0, 1)),
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Tall falcate scythe-lobed 2nd dorsal fin
  parts.push(
    buildFinStrip(
      [
        [-0.205 * S, 0.012 * S],
        [-0.195 * S, 0.045 * S],
        [-0.125 * S, 0.072 * S],
        [-0.078 * S, 0.122 * S],
        [-0.060 * S, 0.232 * S],
        [-0.032 * S, 0.228 * S],
        [0.004 * S, 0.058 * S],
      ],
      0.0052 * S,
      (_x, y, _z, out) => out.copy(cFinBase).lerp(cCobaltFin, THREE.MathUtils.clamp((y / S - 0.05) * 6.5, 0, 1)),
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 5 }
    )
  );

  // Tall falcate scythe-lobed anal fin
  parts.push(
    buildFinStrip(
      [
        [-0.205 * S, -0.012 * S],
        [-0.195 * S, -0.040 * S],
        [-0.130 * S, -0.065 * S],
        [-0.085 * S, -0.112 * S],
        [-0.068 * S, -0.212 * S],
        [-0.042 * S, -0.206 * S],
        [-0.002 * S, -0.052 * S],
      ],
      0.0052 * S,
      (_x, y, _z, out) => out.copy(cFinBase).lerp(cCobaltFin, THREE.MathUtils.clamp((-y / S - 0.04) * 6.8, 0, 1)),
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 5 }
    )
  );

  // Pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.105 * S,
      yPos: -0.070 * S,
      xOffset: 0.014 * S,
      length: 0.084 * S,
      width: 0.034 * S,
      splay: 0.28,
      dip: -0.44,
      thickness: 0.0032 * S,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, y, _z, out) => out.copy(cSilver).lerp(cCobaltFin, THREE.MathUtils.clamp((-y / S - 0.06) * 14.0, 0, 1)),
    })
  );

  // Long swept falcate pectoral wings
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.105 * S,
      yPos: -0.018 * S,
      xOffset: 0.046 * S,
      span: 0.185 * S,
      chord: 0.058 * S,
      sweep: -0.78,
      dihedral: -0.06,
      flare: 0.62,
      thickness: 0.0036 * S,
      bodyLength: length,
      tailPivotZ,
      shape: 'falcate',
      colorFn: (x, _y, _z, out) => {
        const spanT = THREE.MathUtils.clamp((Math.abs(x / S) - 0.045) / 0.11, 0, 1);
        out.copy(cFinBase).lerp(cCobaltFin, spanT);
      },
    })
  );

  addFishEyes(parts, 0.205 * S, 0.024 * S, 0.031 * S, 0.014 * S, '#c8d6e4', {
    bodyLength: length,
    tailPivotZ,
  });

  const bodyGeom = safeMerge(parts);

  // Deeply forked razor-thin pelagic lunate tail
  const tailGeom = buildFinStrip(
    [
      [0.005 * S, 0.014 * S],
      [-0.072 * S, 0.095 * S],
      [-0.155 * S, 0.155 * S],
      [-0.162 * S, 0.148 * S],
      [-0.095 * S, 0.044 * S],
      [-0.042 * S, 0.0],
      [-0.095 * S, -0.044 * S],
      [-0.162 * S, -0.148 * S],
      [-0.155 * S, -0.155 * S],
      [-0.072 * S, -0.095 * S],
      [0.005 * S, -0.014 * S],
    ],
    0.0038 * S,
    (_x, _y, z, out) => out.copy(cFinBase).lerp(cCobaltFin, THREE.MathUtils.clamp((-z / S) / 0.15, 0, 1)),
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 5 }
  );

  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 3. Devil Firefish / Lionfish (Pterois miles) — ~25.6-33.2 cm TL zebra + 13 dorsal plumes
// -----------------------------------------------------------------------------
function buildLionfishPrototype() {
  const parts = [];
  const S = 0.64;
  const length = 0.34 * S;
  const halfHeight = 0.082 * S;
  const halfWidth = 0.048 * S;
  const tailPivotZ = 0.155 * S;

  const cCrimson = new THREE.Color('#8c1a20');
  const cMahogany = new THREE.Color('#321012');
  const cIvory = new THREE.Color('#f6eedb');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight,
      halfWidth,
      segsU: 38,
      segsV: 22,
      dorsalSharpness: 0.16,
      operculumRidge: 0.11,
      tailPivotZ,
      heightProfile: (u) => {
        if (u < 0.15) return 0.24 + (u / 0.15) * 0.44;
        if (u <= 0.80) return 0.68 + Math.sin(((u - 0.15) / 0.65) * Math.PI) * 0.34;
        return 0.68 * Math.pow((1 - u) / 0.20, 0.64);
      },
      widthProfile: (u) => Math.sin(Math.pow(u, 0.68) * Math.PI) * 0.94,
      colorFn: (zNorm, _yNorm, _xNorm, out) => {
        // Crisp alternating wide & narrow maroon-crimson, dark mahogany, and cream-ivory zebra bars
        const wideBar = Math.sin(zNorm * 28.0);
        const narrowSub = Math.sin(zNorm * 56.0 + 0.6);
        if (wideBar > 0.18) {
          out.copy(narrowSub > 0.72 ? cMahogany : cIvory);
        } else if (wideBar > -0.34) {
          out.copy(cCrimson);
        } else {
          out.copy(cMahogany);
        }
      },
    })
  );

  // Prominent supraorbital fleshy tentacle horns above eyes
  for (const side of [-1, 1]) {
    const hornLen = 0.046 * S;
    const horn = new THREE.ConeGeometry(0.0042 * S, hornLen, 5, 4);
    horn.rotateZ(side * -0.26);
    horn.rotateX(-0.22);
    const yRoot = 0.050 * S;
    const zHorn = 0.112 * S;
    horn.translate(side * 0.022 * S, yRoot + hornLen * 0.42, zHorn);
    const uAttach = computeUAttach(zHorn, length, tailPivotZ);
    parts.push(
      prepareFishPart(
        horn,
        (_x, y, _z, _nx, _ny, _nz, out) => {
          const band = Math.sin(((y - yRoot) / S) * 210.0);
          out.copy(band > 0.1 ? cIvory : cMahogany);
        },
        (_x, y) => [PART_MEDIAN_FIN, THREE.MathUtils.clamp((y - yRoot) / hornLen, 0, 1), uAttach, 0.15]
      )
    );
    horn.dispose();
  }

  // 13 tall alternating ivory/maroon banded dorsal feather-spines with continuous span01 & chord01
  for (let s = 0; s < 13; s++) {
    const t = s / 12;
    const zPos = (0.104 - t * 0.205) * S;
    const len = (0.145 + Math.sin(t * Math.PI) * 0.088) * S;
    const yRoot = (0.046 + Math.sin(t * Math.PI) * 0.022) * S;
    const spine = new THREE.ConeGeometry(0.0056 * S, len, 5, 8);
    spine.rotateX(-0.34 + t * 0.52);
    spine.translate(0, yRoot + len * 0.46, zPos);
    const uAttach = computeUAttach(zPos, length, tailPivotZ);
    parts.push(
      prepareFishPart(
        spine,
        (_x, y, _z, _nx, _ny, _nz, out) => {
          const stripe = Math.sin(((y - yRoot) / S) * 105.0 + s * 0.6);
          if (stripe > 0.12) out.copy(cIvory);
          else if (stripe > -0.45) out.copy(cCrimson);
          else out.copy(cMahogany);
        },
        (_x, y) => [
          PART_MEDIAN_FIN,
          THREE.MathUtils.clamp((y - yRoot) / (len * 0.92), 0, 1),
          uAttach,
          t,
        ]
      )
    );
    spine.dispose();
  }

  // Spotted soft posterior dorsal fin
  parts.push(
    buildFinStrip(
      [
        [-0.162 * S, 0.028 * S],
        [-0.148 * S, 0.095 * S],
        [-0.108 * S, 0.106 * S],
        [-0.072 * S, 0.036 * S],
      ],
      0.0038 * S,
      (x, y, z, out) => {
        const cell = cellularSpotMask(x / S, y / S, z / S, 54.0, 0.66);
        out.copy(cell.dist < 0.24 ? cCrimson : cIvory);
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Spotted soft anal fin
  parts.push(
    buildFinStrip(
      [
        [-0.162 * S, -0.026 * S],
        [-0.142 * S, -0.092 * S],
        [-0.092 * S, -0.102 * S],
        [-0.045 * S, -0.042 * S],
      ],
      0.0038 * S,
      (x, y, z, out) => {
        const cell = cellularSpotMask(x / S, y / S, z / S, 54.0, 0.66);
        out.copy(cell.dist < 0.24 ? cCrimson : cIvory);
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Ornate flared zebra-banded webbed pectoral fans: inner membrane + radial feather-rays
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.068 * S,
      yPos: -0.008 * S,
      xOffset: 0.042 * S,
      span: 0.145 * S,
      chord: 0.125 * S,
      sweep: -0.45,
      dihedral: -0.05,
      flare: 0.85,
      thickness: 0.0030 * S,
      bodyLength: length,
      tailPivotZ,
      shape: 'fan',
      colorFn: (x, _y, z, out) => {
        const band = Math.sin(Math.hypot(Math.abs(x / S) - 0.04, z / S - 0.065) * 90.0);
        if (band > 0.15) out.copy(cIvory);
        else if (band > -0.45) out.copy(cCrimson);
        else out.copy(cMahogany);
      },
    })
  );

  const pecAttach = computeUAttach(0.068 * S, length, tailPivotZ);
  for (const side of [PART_PECTORAL_LEFT, PART_PECTORAL_RIGHT]) {
    for (let r = 0; r < 9; r++) {
      const f = r / 8;
      const rayLen = (0.205 + Math.sin(f * Math.PI) * 0.025) * S;
      const ray = new THREE.ConeGeometry(0.0062 * S, rayLen, 5, 7);
      ray.rotateZ(side * (0.98 + f * 0.52));
      ray.rotateY(side * (-0.34 + f * 0.84));
      ray.translate(side * 0.088 * S, (-0.012 + (0.5 - f) * 0.062) * S, (0.056 - f * 0.075) * S);
      parts.push(
        prepareFishPart(
          ray,
          (x, _y, z, _nx, _ny, _nz, out) => {
            const band = Math.sin(Math.hypot(Math.abs(x / S) - 0.04, z / S - 0.065) * 85.0);
            if (band > 0.10) out.copy(cIvory);
            else if (band > -0.45) out.copy(cCrimson);
            else out.copy(cMahogany);
          },
          (x) => [
            side,
            THREE.MathUtils.clamp((Math.abs(x) - 0.040 * S) / (0.165 * S), 0, 1),
            pecAttach,
            f,
          ]
        )
      );
      ray.dispose();
    }
  }

  // Banded pelvic fans
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.042 * S,
      yPos: -0.052 * S,
      xOffset: 0.012 * S,
      length: 0.088 * S,
      width: 0.050 * S,
      splay: 0.36,
      dip: -0.48,
      thickness: 0.0032 * S,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, y, z, out) => {
        const band = Math.sin(((y + z) / S) * 95.0);
        out.copy(band > 0.1 ? cIvory : cCrimson);
      },
    })
  );

  addFishEyes(parts, 0.115 * S, 0.022 * S, 0.028 * S, 0.011 * S, '#d8be72', {
    bodyLength: length,
    tailPivotZ,
  });

  const bodyGeom = safeMerge(parts);

  // Translucent-look spotted rounded caudal fan
  const tailGeom = buildFinStrip(
    [
      [0.004 * S, 0.022 * S],
      [-0.050 * S, 0.066 * S],
      [-0.105 * S, 0.072 * S],
      [-0.125 * S, 0.032 * S],
      [-0.130 * S, 0.0],
      [-0.125 * S, -0.032 * S],
      [-0.105 * S, -0.072 * S],
      [-0.050 * S, -0.066 * S],
      [0.004 * S, -0.022 * S],
    ],
    0.0036 * S,
    (x, y, z, out) => {
      const cell = cellularSpotMask(x / S, y / S, z / S, 58.0, 0.65);
      out.copy(cell.dist < 0.22 ? cCrimson : cIvory);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );

  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 4. Geometric Moray Eel (Gymnothorax griseus) — ~56-64 cm TL 14-segment S-wave + pore dots
// -----------------------------------------------------------------------------
const MORAY_SCALE = 0.56;

function buildMorayPrototypes() {
  const S = MORAY_SCALE;
  const cHeadGround = new THREE.Color('#cbb9a8');
  const cHeadTaupe = new THREE.Color('#bba390');
  const cBodyGround = new THREE.Color('#c8b6a4');
  const cThroat = new THREE.Color('#dfd3c6');
  const cMouthRim = new THREE.Color('#cf8876');
  const cPalate = new THREE.Color('#8e363c');
  const cFang = new THREE.Color('#f7f2e6');
  const cGillInside = new THREE.Color('#2a1816');
  const cGillRim = new THREE.Color('#b59f8d');
  const cVermicLight = new THREE.Color('#9c8058');
  const cVermicDark = new THREE.Color('#7c613e');
  const cNostril = new THREE.Color('#cbb9a8');
  const cIris = new THREE.Color('#f4f2ea');
  const cPupil = new THREE.Color('#0a0c10');
  const cEyeGlint = new THREE.Color('#f5fbff');
  const cPore = new THREE.Color('#12100f');

  function morayVermiculationColor(x, y, z, out, { isHead = false, isFin = false } = {}) {
    const warp = Math.sin(z * 58.0 + y * 52.0) * 0.0055 + Math.cos(x * 64.0 - z * 44.0) * 0.0035;
    const cell = cellularSpotMask(x + warp, y * 1.15, z - warp, 64.0, 0.82);

    if (isHead) {
      const headT = THREE.MathUtils.clamp((z - 0.02) / 0.11, 0, 1);
      out.copy(cHeadTaupe).lerp(cHeadGround, headT);
      if (y < -0.004) {
        const throatT = THREE.MathUtils.clamp((-y - 0.004) / 0.022, 0, 1);
        const groove = 0.5 + 0.5 * Math.sin(x * 290.0 + z * 24.0);
        out.lerp(cThroat, throatT * (0.68 + 0.24 * groove));
      }
      const rearFactor = THREE.MathUtils.clamp((0.055 - z) / 0.08, 0, 1);
      if (rearFactor > 0.02 && cell.edgeDist < 0.22) {
        const vMix = (1.0 - cell.edgeDist / 0.22) * rearFactor * 0.50;
        out.lerp(cell.cellHash > 0.45 ? cVermicLight : cVermicDark, vMix);
      }
      return;
    }

    if (isFin) {
      out.copy(cBodyGround).lerp(cHeadGround, 0.42);
      const heightFade = 1.0 - THREE.MathUtils.clamp((y - 0.048) / 0.048, 0, 0.78);
      if (cell.edgeDist < 0.20) {
        const vMix = (1.0 - cell.edgeDist / 0.20) * 0.34 * heightFade;
        out.lerp(cVermicLight, vMix);
      }
      return;
    }

    out.copy(cBodyGround);
    if (y < -0.022) {
      const bellyT = THREE.MathUtils.clamp((-y - 0.022) / 0.026, 0, 1);
      out.lerp(cThroat, bellyT * 0.78);
    }
    const flankMask = 1.0 - THREE.MathUtils.clamp((-y - 0.024) / 0.025, 0, 0.78);
    const flankBoost = 0.58 + 0.42 * THREE.MathUtils.clamp(Math.abs(x) / 0.036, 0, 1);
    if (cell.edgeDist < 0.26) {
      const ridge = 1.0 - cell.edgeDist / 0.26;
      const vermicCol = cell.cellHash > 0.52 ? cVermicDark : cVermicLight;
      out.lerp(vermicCol, ridge * 0.65 * flankMask * flankBoost);
    }
  }

  // Laterally compressed overlapping teardrop ribbon segment (spherical joint caps prevent curve gaps)
  const segParts = [];
  const segCyl = new THREE.CylinderGeometry(0.043 * S, 0.046 * S, 0.088 * S, 20, 6);
  segCyl.rotateX(Math.PI * 0.5);
  segCyl.scale(0.68, 1.24, 1.0);
  segParts.push(
    prepareForMerge(segCyl, (x, y, z, _nx, _ny, _nz, out) => {
      morayVermiculationColor(x / S, y / S, z / S, out);
    })
  );
  segCyl.dispose();

  for (const capZ of [-0.040 * S, 0.040 * S]) {
    const cap = new THREE.SphereGeometry(0.0445 * S, 12, 8);
    cap.scale(0.68, 1.24, 0.78);
    cap.translate(0, 0, capZ);
    segParts.push(
      prepareForMerge(cap, (x, y, z, _nx, _ny, _nz, out) => {
        morayVermiculationColor(x / S, y / S, z / S, out);
      })
    );
    cap.dispose();
  }

  // Continuous fleshy dorsal fin fold tapered thinly along upper translucent margin
  const fin = new THREE.BoxGeometry(0.0085 * S, 0.060 * S, 0.098 * S, 1, 5, 8);
  const finPos = fin.attributes.position;
  for (let i = 0; i < finPos.count; i++) {
    const fy = finPos.getY(i);
    const fz = finPos.getZ(i);
    const heightFrac = THREE.MathUtils.clamp((fy / S + 0.030) / 0.060, 0, 1);
    const undulate = Math.sin((fz / S) * 65.0) * 0.0022 * S * heightFrac;
    finPos.setX(i, finPos.getX(i) * (1.0 - heightFrac * 0.62) + undulate);
    finPos.setY(i, fy + 0.070 * S + Math.sin((fz / S) * 38.0) * 0.0025 * S * heightFrac);
  }
  fin.computeVertexNormals();
  segParts.push(
    prepareForMerge(fin, (x, y, z, _nx, _ny, _nz, out) => {
      morayVermiculationColor(x / S, y / S, z / S, out, { isFin: true });
    })
  );
  fin.dispose();
  const bodySegGeom = safeMerge(segParts);

  function skullSurfaceX(y, z) {
    const dy = (y - 0.015) / 0.92;
    const dzCap = Math.max(0, Math.abs(z - 0.05) - 0.05);
    const inside = Math.max(0.00004, 0.046 * 0.046 - dy * dy - dzCap * dzCap);
    return 0.78 * Math.sqrt(inside);
  }

  // Geometric jet-black sensory-pore dot rows (Gymnothorax griseus signature)
  const headPoreDots = [];
  for (let k = 0; k < 6; k++) {
    const t = k / 5;
    const z = THREE.MathUtils.lerp(0.125, 0.068, t);
    const y = 0.032 + Math.sin(t * Math.PI) * 0.016 + t * 0.004;
    headPoreDots.push({ x: skullSurfaceX(y, z) + 0.0005, y, z });
  }
  for (let k = 0; k < 7; k++) {
    const t = k / 6;
    const z = THREE.MathUtils.lerp(0.128, 0.048, t);
    const y = THREE.MathUtils.lerp(0.018, 0.016, t);
    headPoreDots.push({ x: skullSurfaceX(y, z) + 0.0005, y, z });
  }
  for (const arcZBase of [0.042, 0.012]) {
    const arcCount = 7;
    for (let k = 0; k < arcCount; k++) {
      const t = k / (arcCount - 1);
      const y = THREE.MathUtils.lerp(0.050, -0.006, t);
      const z = arcZBase - Math.sin(t * Math.PI) * 0.005 + (t - 0.5) * 0.004;
      headPoreDots.push({ x: skullSurfaceX(y, z) + 0.0005, y, z });
    }
  }
  for (const z of [-0.002, -0.018, -0.034]) {
    const y = 0.017;
    headPoreDots.push({ x: skullSurfaceX(y, z) + 0.0005, y, z });
  }

  // Sculpted concave-snout skull + inner palate + recurved fangs + gill pore + nostrils + pores
  const headParts = [];
  const skull = new THREE.CapsuleGeometry(0.046 * S, 0.10 * S, 16, 24);
  skull.rotateX(Math.PI * 0.5);
  skull.scale(0.80, 0.94, 1.0);
  skull.translate(0, 0.015 * S, 0.05 * S);
  const skullPos = skull.attributes.position;
  for (let i = 0; i < skullPos.count; i++) {
    let sx = skullPos.getX(i) / S;
    let sy = skullPos.getY(i) / S;
    const sz = skullPos.getZ(i) / S;
    // Slight supraorbital brow crest above eyes + concave dorsal snout dip
    if (sy > 0.016) {
      const brow = Math.exp(-Math.pow((sz - 0.084) / 0.020, 2)) * 0.0045;
      const snoutDip = Math.exp(-Math.pow((sz - 0.114) / 0.016, 2)) * 0.0042;
      sy += brow - snoutDip;
    }
    if (sz > 0.07) {
      const pointT = THREE.MathUtils.clamp((sz - 0.07) / 0.075, 0, 1);
      sx *= 1.0 - pointT * 0.24;
    }
    skullPos.setXYZ(i, sx * S, sy * S, sz * S);
  }
  skull.computeVertexNormals();
  headParts.push(
    prepareForMerge(skull, (x, y, z, _nx, _ny, _nz, out) => {
      const ux = x / S;
      const uy = y / S;
      const uz = z / S;
      morayVermiculationColor(ux, uy, uz, out, { isHead: true });
      if (uy < 0.009 && uz > 0.025 && Math.abs(ux) > 0.012) {
        const rimT = THREE.MathUtils.clamp((0.009 - uy) / 0.014, 0, 1) * THREE.MathUtils.clamp((uz - 0.025) / 0.045, 0, 1);
        out.lerp(cMouthRim, rimT * 0.72);
      }
      const absX = Math.abs(ux);
      for (let p = 0; p < headPoreDots.length; p++) {
        const pd = headPoreDots[p];
        const d = Math.hypot(absX - pd.x, uy - pd.y, uz - pd.z);
        if (d < 0.0048) {
          out.lerp(cPore, 1.0 - d / 0.0048);
        }
      }
    })
  );
  skull.dispose();

  // Inner dark-crimson oral pharynx & palate liner
  const palate = new THREE.BoxGeometry(0.026 * S, 0.006 * S, 0.076 * S);
  palate.translate(0, 0.0035 * S, 0.080 * S);
  headParts.push(prepareForMerge(palate, cPalate));
  palate.dispose();

  // Central vomerine median recurved fangs (2)
  for (const vz of [0.104, 0.088]) {
    const vFang = new THREE.ConeGeometry(0.0017 * S, 0.0105 * S, 5);
    vFang.rotateX(Math.PI + 0.36);
    vFang.translate(0, 0.001 * S, vz * S);
    headParts.push(prepareForMerge(vFang, cFang));
    vFang.dispose();
  }

  for (const side of [-1, 1]) {
    // 5 paired lateral maxillary recurved glass-needle fangs (total 12 upper fangs!)
    for (let t = 0; t < 5; t++) {
      const fz = 0.124 - t * 0.017;
      const fx = side * (0.012 + t * 0.0022);
      const fang = new THREE.ConeGeometry(0.0015 * S, 0.0095 * S, 5);
      fang.rotateX(Math.PI + 0.32);
      fang.translate(fx * S, 0.002 * S, fz * S);
      headParts.push(prepareForMerge(fang, cFang));
      fang.dispose();
    }

    // Lateral circular branchial gill opening (gill pore)
    const gillRim = new THREE.TorusGeometry(0.0064 * S, 0.0020 * S, 6, 12);
    gillRim.rotateY(side * Math.PI * 0.48);
    gillRim.translate(side * 0.0355 * S, 0.011 * S, -0.008 * S);
    headParts.push(prepareForMerge(gillRim, cGillRim));
    gillRim.dispose();

    const gillPit = new THREE.CylinderGeometry(0.0052 * S, 0.0052 * S, 0.004 * S, 10);
    gillPit.rotateZ(Math.PI * 0.5);
    gillPit.translate(side * 0.0348 * S, 0.011 * S, -0.008 * S);
    headParts.push(prepareForMerge(gillPit, cGillInside));
    gillPit.dispose();

    // Raised tubular anterior nostrils on snout
    const nostril = new THREE.CylinderGeometry(0.0034 * S, 0.0046 * S, 0.016 * S, 8);
    nostril.rotateX(0.45);
    nostril.rotateZ(side * -0.25);
    nostril.translate(side * 0.012 * S, 0.032 * S, 0.130 * S);
    headParts.push(prepareForMerge(nostril, cNostril));
    nostril.dispose();

    // Stark chalk-white iris + pinpoint jet-black pupil + corneal catchlight
    const iris = new THREE.SphereGeometry(0.009 * S, 12, 10);
    iris.scale(0.55, 1.0, 1.0);
    iris.translate(side * 0.0315 * S, 0.035 * S, 0.090 * S);
    headParts.push(prepareForMerge(iris, cIris));
    iris.dispose();

    const pupil = new THREE.SphereGeometry(0.0037 * S, 8, 6);
    pupil.scale(0.68, 1.0, 1.0);
    pupil.translate(side * 0.0346 * S, 0.035 * S, 0.090 * S);
    headParts.push(prepareForMerge(pupil, cPupil));
    pupil.dispose();

    const glint = new THREE.SphereGeometry(0.0014 * S, 5, 4);
    glint.translate(side * 0.0365 * S, 0.0375 * S, 0.092 * S);
    headParts.push(prepareForMerge(glint, cEyeGlint));
    glint.dispose();

    for (let p = 0; p < headPoreDots.length; p++) {
      const pd = headPoreDots[p];
      const dot = new THREE.SphereGeometry(0.0021 * S, 6, 5);
      dot.translate(side * pd.x * S, pd.y * S, pd.z * S);
      headParts.push(prepareForMerge(dot, cPore));
      dot.dispose();
    }
  }

  const headGeom = safeMerge(headParts);

  // Curved U-arch articulated lower mandible with lower needle fangs & pore dots
  const jawPoreDots = [];
  for (let k = 0; k < 7; k++) {
    const t = k / 6;
    const z = THREE.MathUtils.lerp(0.118, 0.035, t);
    const y = THREE.MathUtils.lerp(-0.010, -0.012, t);
    const halfW = THREE.MathUtils.lerp(0.016, 0.025, Math.sqrt(t));
    jawPoreDots.push({ x: halfW, y, z });
  }

  const jawParts = [];
  const jaw = new THREE.BoxGeometry(0.050 * S, 0.021 * S, 0.124 * S, 8, 3, 12);
  const jawPos = jaw.attributes.position;
  for (let i = 0; i < jawPos.count; i++) {
    let x = jawPos.getX(i);
    let y = jawPos.getY(i);
    const z = jawPos.getZ(i) + 0.062 * S;
    const snoutT = THREE.MathUtils.clamp((z / S - 0.015) / 0.108, 0, 1);
    const archScale = Math.sqrt(Math.max(0.08, 1.0 - snoutT * 0.72));
    const chinHook = Math.pow(snoutT, 2.4) * 0.005 * S;
    x *= archScale;
    y = y * (1.0 - snoutT * 0.25) - 0.012 * S + chinHook;
    jawPos.setXYZ(i, x, y, z);
  }
  jaw.computeVertexNormals();
  jawParts.push(
    prepareForMerge(jaw, (x, y, z, _nx, _ny, _nz, out) => {
      const ux = x / S;
      const uy = y / S;
      const uz = z / S;
      out.copy(cHeadGround).lerp(cThroat, THREE.MathUtils.clamp((-uy - 0.008) / 0.015, 0, 1));
      if (uy > -0.005 && uz > 0.025) {
        const rimT = THREE.MathUtils.clamp((uy + 0.005) / 0.006, 0, 1);
        out.lerp(cPalate, rimT * 0.65);
      }
      if (uy < -0.014) {
        const groove = 0.5 + 0.5 * Math.sin(ux * 300.0 + uz * 22.0);
        out.lerp(cThroat, 0.55 + 0.35 * groove);
      }
      const absX = Math.abs(ux);
      for (let p = 0; p < jawPoreDots.length; p++) {
        const pd = jawPoreDots[p];
        const d = Math.hypot(absX - pd.x, uy - pd.y, uz - pd.z);
        if (d < 0.0046) {
          out.lerp(cPore, 1.0 - d / 0.0046);
        }
      }
    })
  );
  jaw.dispose();

  for (const side of [-1, 1]) {
    // 3 paired recurved dentary teeth along lower mandible
    for (let t = 0; t < 3; t++) {
      const fz = 0.114 - t * 0.022;
      const fx = side * (0.010 + t * 0.003);
      const dFang = new THREE.ConeGeometry(0.0014 * S, 0.008 * S, 5);
      dFang.rotateX(-0.30);
      dFang.translate(fx * S, -0.001 * S, fz * S);
      jawParts.push(prepareForMerge(dFang, cFang));
      dFang.dispose();
    }
    for (let p = 0; p < jawPoreDots.length; p++) {
      const pd = jawPoreDots[p];
      const dot = new THREE.SphereGeometry(0.0021 * S, 6, 5);
      dot.translate(side * pd.x * S, pd.y * S, pd.z * S);
      jawParts.push(prepareForMerge(dot, cPore));
      dot.dispose();
    }
  }

  const jawGeom = safeMerge(jawParts);

  return { bodySegGeom, headGeom, jawGeom };
}

// -----------------------------------------------------------------------------
// 5. Bluespotted Ribbontail Ray (Taeniura lymma — מחבטן ספירים) — ~29.9-36.0 cm DW
// -----------------------------------------------------------------------------
function buildRibbontailRayPrototypes() {
  const S = 0.60;
  const discRadiusX = 0.34 * S;
  const discRadiusZ = 0.39 * S;
  const coreRadiusX = 0.215 * S;

  const cDisc = new THREE.Color('#b59a55');
  const cBelly = new THREE.Color('#f4f0e4');
  const cWhite = new THREE.Color('#ffffff');
  const cEyeTop = new THREE.Color('#e6a428');
  const cEyeBase = new THREE.Color('#cc8a1a');
  const cEyeAmberRim = new THREE.Color('#8f5911');
  const cPupil = new THREE.Color('#1a140c');
  const cSpiracleLip = new THREE.Color('#c4aa64');
  const cSpiracleDeep = new THREE.Color('#18120a');
  const cTailStripe = new THREE.Color('#128eff');
  const cFinfoldMid = new THREE.Color('#64bbff');
  const cFinfoldTip = new THREE.Color('#e2f4ff');

  function attachRayDiscAttr(geom, evalFn = null) {
    const pos = geom.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    if (typeof evalFn === 'function') {
      for (let i = 0; i < pos.count; i++) {
        const res = evalFn(pos.getX(i), pos.getY(i), pos.getZ(i));
        arr[i * 3] = res[0];
        arr[i * 3 + 1] = res[1];
        arr[i * 3 + 2] = res[2];
      }
    }
    geom.setAttribute('aRayDisc', new THREE.BufferAttribute(arr, 3));
    return geom;
  }

  const centerParts = [];

  // Smooth rounded-oval central disc core with sculpted spiracle sockets
  const core = new THREE.SphereGeometry(1, 44, 28);
  const corePos = core.attributes.position;
  for (let i = 0; i < corePos.count; i++) {
    const x0 = corePos.getX(i);
    const y0 = corePos.getY(i);
    const z0 = corePos.getZ(i);
    const x = x0 * coreRadiusX;
    const z = z0 * discRadiusZ;
    let y;
    if (y0 >= 0) {
      const cranialDome = 0.011 * S * Math.exp(-((x / (0.09 * S)) ** 2 + ((z - 0.03 * S) / (0.19 * S)) ** 2));
      const spiracleDip = 0.0085 * S * Math.exp(-(((Math.abs(x) - 0.068 * S) / (0.019 * S)) ** 2 + ((z - 0.058 * S) / (0.016 * S)) ** 2));
      y = y0 * (0.024 * S + cranialDome) - y0 * spiracleDip;
    } else {
      y = y0 * (0.015 * S);
    }
    corePos.setXYZ(i, x, y, z);
  }
  core.computeVertexNormals();
  const corePrepped = prepareForMerge(core, (_x, y, _z, _nx, _ny, _nz, out) => {
    const dorsalMask = THREE.MathUtils.smoothstep(y, -0.002 * S, 0.003 * S);
    out.copy(cBelly).lerp(cWhite, dorsalMask);
  });
  attachRayDiscAttr(corePrepped, (x, y, z) => [
    x / discRadiusX,
    z / discRadiusZ,
    THREE.MathUtils.smoothstep(y, -0.002 * S, 0.003 * S),
  ]);
  centerParts.push(corePrepped);
  core.dispose();

  // Prominent raised golden-amber periscopic eye turrets + recessed crescentic spiracles
  for (const side of [-1, 1]) {
    const brow = new THREE.SphereGeometry(0.022 * S, 14, 10);
    brow.scale(0.88, 0.85, 1.18);
    brow.translate(side * 0.054 * S, 0.035 * S, 0.094 * S);
    centerParts.push(
      attachRayDiscAttr(
        prepareForMerge(brow, (_x, y, _z, _nx, _ny, _nz, out) => {
          const t = THREE.MathUtils.clamp((y / S - 0.022) / 0.026, 0, 1);
          out.copy(cEyeBase).lerp(cEyeTop, t);
        })
      )
    );
    brow.dispose();

    const eyeTurret = new THREE.SphereGeometry(0.0175 * S, 14, 10);
    eyeTurret.scale(0.82, 0.96, 1.06);
    eyeTurret.translate(side * 0.056 * S, 0.044 * S, 0.095 * S);
    centerParts.push(
      attachRayDiscAttr(
        prepareForMerge(eyeTurret, (x, y, z, _nx, _ny, _nz, out) => {
          const sx = x / S;
          const sy = y / S;
          const sz = z / S;
          const t = THREE.MathUtils.clamp((sy - 0.030) / 0.028, 0, 1);
          out.copy(cEyeBase).lerp(cEyeTop, t);
          // Dark amber rim around the lateral-anterior pupil slot
          const dRim = Math.hypot((sx - side * 0.064) * 1.1, (sy - 0.045) * 1.5, sz - 0.099);
          if (dRim < 0.0125) {
            out.lerp(cEyeAmberRim, 1.0 - dRim / 0.0125);
          }
        })
      )
    );
    eyeTurret.dispose();

    // Horizontal/crescentic dark pupil slit on lateral-anterior face
    const pupil = new THREE.SphereGeometry(0.0098 * S, 10, 8);
    pupil.scale(0.46, 0.34, 1.24);
    pupil.rotateZ(side * -0.14);
    pupil.rotateY(side * 0.34);
    pupil.translate(side * 0.0645 * S, 0.045 * S, 0.100 * S);
    centerParts.push(attachRayDiscAttr(prepareForMerge(pupil, cPupil)));
    pupil.dispose();

    // Sculpted recessed dark crescentic spiracle behind and slightly lateral to eye turret
    const spiracleLip = new THREE.TorusGeometry(0.0145 * S, 0.0048 * S, 8, 16, Math.PI * 1.42);
    spiracleLip.rotateX(Math.PI * 0.5);
    spiracleLip.rotateY(side * 0.55);
    spiracleLip.scale(0.95, 0.72, 1.18);
    spiracleLip.translate(side * 0.068 * S, 0.0265 * S, 0.058 * S);
    centerParts.push(attachRayDiscAttr(prepareForMerge(spiracleLip, cSpiracleLip)));
    spiracleLip.dispose();

    const spiracleCavity = new THREE.SphereGeometry(0.0125 * S, 10, 8);
    spiracleCavity.scale(0.88, 0.24, 1.12);
    spiracleCavity.rotateY(side * 0.25);
    spiracleCavity.translate(side * 0.0675 * S, 0.0245 * S, 0.0585 * S);
    centerParts.push(attachRayDiscAttr(prepareForMerge(spiracleCavity, cSpiracleDeep)));
    spiracleCavity.dispose();
  }

  // Tapered ribbontail with twin vivid electric-blue lateral stripes & terminal sky-blue/white finfold
  const tail = new THREE.ConeGeometry(0.026 * S, 0.72 * S, 14, 18);
  tail.rotateX(-Math.PI * 0.5);
  tail.translate(0, 0.005 * S, -0.60 * S);
  centerParts.push(
    attachRayDiscAttr(
      prepareForMerge(tail, (x, y, z, _nx, _ny, _nz, out) => {
        const sx = x / S;
        const sy = y / S;
        const sz = z / S;
        if (sy < -0.004) {
          out.copy(cBelly);
          return;
        }
        const tailT = THREE.MathUtils.clamp((-sz - 0.24) / 0.72, 0, 1);
        const localHalfW = Math.max(0.0022, 0.026 * (1.0 - tailT));
        const absX = Math.abs(sx);

        if (sz < -0.78) {
          const tipT = THREE.MathUtils.clamp((-sz - 0.78) / 0.18, 0, 1);
          out.copy(cTailStripe).lerp(cFinfoldMid, Math.min(1, tipT * 1.4)).lerp(cFinfoldTip, Math.max(0, (tipT - 0.35) / 0.65));
        } else if (sz < -0.33 && absX > localHalfW * 0.30 && absX < localHalfW * 0.94) {
          out.copy(cTailStripe);
        } else {
          out.copy(cDisc);
        }
      })
    )
  );
  tail.dispose();

  // Terminal ventral caudal finfold grading sky-blue -> pale white at posterior tip
  const finfold = new THREE.BoxGeometry(0.0034 * S, 0.019 * S, 0.42 * S, 1, 2, 10);
  finfold.translate(0, -0.007 * S, -0.74 * S);
  centerParts.push(
    attachRayDiscAttr(
      prepareForMerge(finfold, (_x, y, z, _nx, _ny, _nz, out) => {
        const zT = THREE.MathUtils.clamp((-(z / S) - 0.53) / 0.42, 0, 1);
        const yT = THREE.MathUtils.clamp((-(y / S) - 0.001) / 0.015, 0, 1);
        out.copy(cTailStripe).lerp(cFinfoldMid, THREE.MathUtils.clamp(zT * 1.2, 0, 1)).lerp(cFinfoldTip, THREE.MathUtils.clamp(zT * 0.65 + yT * 0.35, 0, 1));
      })
    )
  );
  finfold.dispose();

  // Twin venomous dorsal caudal stingers characteristic of Family Dasyatidae (Taeniura lymma)
  const cSpine = new THREE.Color('#efe7cf');
  for (let sp = 0; sp < 2; sp++) {
    const spine = new THREE.ConeGeometry(0.0052 * S, 0.088 * S, 6, 1);
    spine.rotateX(-Math.PI * 0.38);
    spine.translate(0, 0.022 * S, (-0.52 - sp * 0.042) * S);
    centerParts.push(attachRayDiscAttr(prepareForMerge(spine, cSpine)));
    spine.dispose();
  }

  const centerGeom = safeMerge(centerParts);

  // 3 chordwise pectoral wing ribbon strips per side aligned to wingZOffsets = [0.072, -0.006, -0.078]
  function makeWingStrip(side, zCenter, zLen) {
    const wing = new THREE.SphereGeometry(1, 24, 18);
    const pos = wing.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x0 = pos.getX(i);
      const y0 = pos.getY(i);
      const z0 = pos.getZ(i);
      const z = z0 * (zLen * 0.5);
      const zDisc = z + zCenter;
      const ovalMaxX = discRadiusX * Math.sqrt(Math.max(0.02, 1.0 - Math.min(0.98, (zDisc / discRadiusZ) ** 2)));
      // Keep positive dx/dx0 for both sides so front-face triangle winding stays outward
      const x = side > 0 ? (x0 * 0.5 + 0.5) * ovalMaxX : (x0 * 0.5 - 0.5) * ovalMaxX;
      const u = Math.min(1.0, Math.abs(x) / Math.max(0.01 * S, ovalMaxX));
      const y = y0 * (0.020 * S) * (1.0 - 0.74 * u);
      pos.setXYZ(i, x, y, z);
    }
    wing.computeVertexNormals();
    const geom = prepareForMerge(wing, (_x, y, _z, _nx, _ny, _nz, out) => {
      const dorsalMask = THREE.MathUtils.smoothstep(y, -0.002 * S, 0.003 * S);
      out.copy(cBelly).lerp(cWhite, dorsalMask);
    });
    attachRayDiscAttr(geom, (x, y, z) => [
      x / discRadiusX,
      (z + zCenter) / discRadiusZ,
      THREE.MathUtils.smoothstep(y, -0.002 * S, 0.003 * S),
    ]);
    wing.dispose();
    return geom;
  }

  const wingGeoms = {
    left: [
      makeWingStrip(-1, 0.12 * S, 0.34 * S),
      makeWingStrip(-1, -0.01 * S, 0.28 * S),
      makeWingStrip(-1, -0.13 * S, 0.32 * S),
    ],
    right: [
      makeWingStrip(1, 0.12 * S, 0.34 * S),
      makeWingStrip(1, -0.01 * S, 0.28 * S),
      makeWingStrip(1, -0.13 * S, 0.32 * S),
    ],
  };

  return { centerGeom, wingGeoms };
}

// -----------------------------------------------------------------------------
// 6. Red Sea Sand Lizardfish (Synodus variegatus) — ~23.0-28.0 cm TL sit-and-wait predator
// -----------------------------------------------------------------------------
function buildLizardfishPrototype() {
  const parts = [];
  const S = 0.57;
  const length = 0.38 * S;
  const halfHeight = 0.038 * S;
  const halfWidth = 0.044 * S;
  const tailPivotZ = 0.174 * S;

  const cBelly = new THREE.Color('#e4dac2');
  const cSand = new THREE.Color('#c6b086');
  const cRufous = new THREE.Color('#6d4428');
  const cUmber = new THREE.Color('#4c3a25');
  const cSpeck = new THREE.Color('#dfd3b5');
  const cLateral = new THREE.Color('#e6dcc2');
  const cJawCleft = new THREE.Color('#38261a');
  const cIris = new THREE.Color('#cfa038');
  const cPupil = new THREE.Color('#121418');
  const tmpBand = new THREE.Color();

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight,
      halfWidth,
      segsU: 38,
      segsV: 22,
      ventralFlatness: 0.45,
      operculumRidge: 0.06,
      tailPivotZ,
      heightProfile: (u) => {
        if (u < 0.20) return 0.24 + (u / 0.20) * 0.56;
        if (u <= 0.72) return 0.80 + Math.sin(((u - 0.20) / 0.52) * Math.PI) * 0.18;
        const t = (u - 0.72) / 0.28;
        return 0.80 * Math.pow(1 - t * 0.84, 0.75);
      },
      widthProfile: (u) => {
        if (u < 0.18) return 0.20 + (u / 0.18) * 0.54;
        if (u <= 0.72) return 0.74 + Math.sin(((u - 0.18) / 0.54) * Math.PI * 0.68) * 0.24;
        const t = (u - 0.72) / 0.28;
        return (0.94 + Math.sin(t * Math.PI * 0.45) * 0.14) * Math.pow(1 - t * 0.94, 0.46);
      },
      spineYOffset: (u) => (u > 0.76 ? Math.pow((u - 0.76) / 0.24, 1.3) * 0.18 : 0),
      colorFn: (zNorm, yNorm, xNorm, out) => {
        out.copy(cSand);

        // 7 irregular dark rufous-brown & olive-umber dorsal saddle bands
        const bandPhase = ((zNorm + 0.88) / 1.76) * 7.0 * Math.PI * 2.0;
        const wobble =
          Math.sin(zNorm * 19.0 + xNorm * 4.2) * 0.55 +
          Math.cos(yNorm * 13.0 - zNorm * 9.5) * 0.40;
        const saddle = Math.sin(bandPhase + wobble);
        const dorsalWeight = THREE.MathUtils.clamp((yNorm + 0.12) * 1.45, 0, 1);
        if (saddle > 0.08 && dorsalWeight > 0) {
          const bandMix = THREE.MathUtils.clamp((saddle - 0.08) * 1.5, 0, 1) * dorsalWeight;
          const toneMix = Math.sin(zNorm * 27.0 + xNorm * 11.0 + yNorm * 8.0) * 0.5 + 0.5;
          tmpBand.copy(cRufous).lerp(cUmber, toneMix);
          out.lerp(tmpBand, bandMix * 0.92);
        }

        // Fine cellularSpotMask carbonate-sand mottling breaking up dorsal saddles
        const px = (xNorm * halfWidth) / S;
        const py = (yNorm * halfHeight) / S;
        const pz = (zNorm * (length * 0.5)) / S;
        const cell = cellularSpotMask(px, py, pz, 55.0, 0.85);
        if (cell.dist < 0.26) {
          out.lerp(cell.cellHash > 0.48 ? cSpeck : cUmber, yNorm > -0.25 ? 0.60 : 0.25);
        }

        // Pale lateral line
        const lateralLine = Math.exp(-Math.pow((yNorm + 0.08) / 0.075, 2));
        if (lateralLine > 0.35) out.lerp(cLateral, (lateralLine - 0.35) * 0.85);

        // Pale cream belly
        if (yNorm < -0.16) {
          out.lerp(cBelly, THREE.MathUtils.clamp((-yNorm - 0.16) * 1.9, 0, 1));
        }

        // Upturned terminal jaw cleft shading
        if (zNorm > 0.82 && Math.abs(yNorm - (zNorm - 0.82) * 1.15) < 0.18) {
          out.lerp(cJawCleft, 0.85);
        }
      },
    })
  );

  // Upturned toothy lower jaw cleft ridge
  const jawCleft = new THREE.BoxGeometry(0.026 * S, 0.005 * S, 0.036 * S);
  jawCleft.rotateX(-0.28);
  jawCleft.translate(0, 0.002 * S, 0.172 * S);
  const jawUAttach = computeUAttach(0.172 * S, length, tailPivotZ);
  parts.push(
    prepareFishPart(
      jawCleft,
      (_x, y, _z, _nx, _ny, _nz, out) => {
        out.copy(y / S > 0.002 ? cJawCleft : cBelly);
      },
      [PART_BODY, 0, jawUAttach, 0.04]
    )
  );
  jawCleft.dispose();

  // Dorsally perched upward-looking eyes with golden-ochre iris rings (#cfa038) & dark pupils (#121418)
  const eyeUAttach = computeUAttach(0.135 * S, length, tailPivotZ);
  for (const side of [-1, 1]) {
    const iris = new THREE.SphereGeometry(0.009 * S, 10, 8);
    iris.scale(0.85, 0.95, 1.0);
    iris.translate(side * 0.023 * S, 0.028 * S, 0.135 * S);
    parts.push(prepareFishPart(iris, cIris, [PART_BODY, 0, eyeUAttach, 0.12]));
    iris.dispose();

    const pupil = new THREE.SphereGeometry(0.0055 * S, 8, 6);
    pupil.scale(0.85, 0.95, 1.0);
    pupil.translate(side * 0.0245 * S, 0.0315 * S, 0.1365 * S);
    parts.push(prepareFishPart(pupil, cPupil, [PART_BODY, 0, eyeUAttach, 0.12]));
    pupil.dispose();
  }

  // Splayed sand-mottled pectoral fins
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.088 * S,
      yPos: -0.015 * S,
      xOffset: 0.038 * S,
      span: 0.068 * S,
      chord: 0.042 * S,
      sweep: -0.36,
      dihedral: -0.26,
      flare: 0.88,
      thickness: 0.0026 * S,
      bodyLength: length,
      tailPivotZ,
      shape: 'fan',
      colorFn: (x, y, z, out) => {
        const cell = cellularSpotMask(x / S, y / S, z / S, 60.0, 0.82);
        out.copy(cell.dist < 0.25 ? cUmber : cSand);
      },
    })
  );

  // Tripod pelvic prop fins angled outward & downward to prop forebody off sand
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.046 * S,
      yPos: -0.028 * S,
      xOffset: 0.020 * S,
      length: 0.070 * S,
      width: 0.044 * S,
      splay: 0.44,
      dip: -0.52,
      thickness: 0.0028 * S,
      bodyLength: length,
      tailPivotZ,
      colorFn: (x, y, z, out) => {
        const cell = cellularSpotMask(x / S, y / S, z / S, 55.0, 0.80);
        out.copy(cell.dist < 0.22 ? cRufous : cBelly);
      },
    })
  );

  // High triangular barred dorsal fin
  parts.push(
    buildFinStrip(
      [
        [-0.035 * S, 0.024 * S],
        [-0.012 * S, 0.098 * S],
        [0.028 * S, 0.105 * S],
        [0.050 * S, 0.028 * S],
      ],
      0.0042 * S,
      (x, y, z, out) => {
        const sx = x / S;
        const sy = y / S;
        const sz = z / S;
        const bar = Math.sin(sy * 130.0 + sz * 85.0) > 0.12;
        const cell = cellularSpotMask(sx, sy, sz, 65.0, 0.80);
        out.copy(bar || cell.dist < 0.18 ? cRufous : cSand);
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Tiny posterior adipose fin
  parts.push(
    buildFinStrip(
      [
        [-0.126 * S, 0.016 * S],
        [-0.118 * S, 0.038 * S],
        [-0.102 * S, 0.036 * S],
        [-0.095 * S, 0.018 * S],
      ],
      0.0032 * S,
      (_x, y, _z, out) => out.copy(y / S > 0.028 ? cRufous : cSand),
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 3 }
    )
  );

  const bodyGeom = safeMerge(parts);

  // Forked barred caudal fin
  const tailGeom = buildFinStrip(
    [
      [0.004 * S, 0.014 * S],
      [-0.074 * S, 0.056 * S],
      [-0.044 * S, 0.007 * S],
      [-0.032 * S, 0.0],
      [-0.044 * S, -0.007 * S],
      [-0.074 * S, -0.056 * S],
      [0.004 * S, -0.014 * S],
    ],
    0.0040 * S,
    (_x, y, z, out) => {
      out.copy(Math.sin((z / S) * 115.0 + Math.abs(y / S) * 55.0) > 0.15 ? cUmber : cSand);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );

  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 7. Green Sea Turtle (Chelonia mydas — צב ים ירוק) — ~95 cm SCL hydrofoil swimmer
// -----------------------------------------------------------------------------
function buildGreenSeaTurtlePrototypes() {
  const cOliveDark = new THREE.Color('#3b4827');
  const cOliveWarm = new THREE.Color('#5f6934');
  const cAmberStreak = new THREE.Color('#9e742e');
  const cChestnut = new THREE.Color('#6b3b20');
  const cSuture = new THREE.Color('#221b14');
  const cMarginalRim = new THREE.Color('#7c6e46');
  const cPlastron = new THREE.Color('#ebdec0');
  const cPlastronShade = new THREE.Color('#cbb68c');
  const cSkinTop = new THREE.Color('#5a5e3c');
  const cSkinCream = new THREE.Color('#d9cba6');
  const cBeak = new THREE.Color('#474f38');
  const cEyeSclera = new THREE.Color('#9c8e6a');
  const cEyeIris = new THREE.Color('#130e0b');
  const cEyeGlint = new THREE.Color('#eef7ff');
  const cClaw = new THREE.Color('#ddd0b0');

  const bodyParts = [];

  // 1. Sculpted Carapace (dome + vertebral keel + scalloped posterior marginals) fused to Convex Plastron
  const rRings = 16;
  const aSegs = 36;
  const shellPositions = [];
  const shellColors = [];
  const shellIndices = [];
  const tmpCol = new THREE.Color();

  function buildShellHalf(isTop) {
    const startIdx = shellPositions.length / 3;
    for (let ir = 0; ir <= rRings; ir++) {
      const r = ir / rRings;
      for (let ia = 0; ia <= aSegs; ia++) {
        const theta = (ia / aSegs) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        // Heart-teardrop Chelonia outline: broader shoulder (+z), tapered pygal rear (-z)
        const rearWeight = Math.pow(Math.max(0, -sinT), 1.6);
        const shoulderWeight = Math.max(0, sinT) * 0.09;
        const widthMod = 1.0 + shoulderWeight - rearWeight * 0.16;
        const marginScallop =
          1.0 + Math.pow(r, 4.0) * 0.015 * Math.cos(theta * 22.0) * (1.0 - Math.max(0, sinT) * 0.55);

        const x = r * cosT * 0.375 * widthMod * marginScallop;
        const z = r * sinT * 0.470 * marginScallop;

        const radialDome = Math.pow(Math.max(0, 1.0 - r * r * 0.96), 0.72);
        let y;
        if (isTop) {
          const keel = 0.013 * Math.exp(-(x * x) / 0.0032) * (1.0 - r * 0.85);
          const marginFlare = Math.pow(r, 4.0) * 0.008;
          y = 0.005 + 0.158 * radialDome + keel + marginFlare;
        } else {
          y = 0.005 - 0.056 * Math.pow(Math.max(0, 1.0 - r * r), 0.62);
        }

        shellPositions.push(x, y, z);

        if (isTop) {
          const absX = Math.abs(x);
          const marginalRing = r > 0.81;
          if (marginalRing) {
            const mSuture = Math.abs(Math.sin(theta * 11.0));
            const notchDark = THREE.MathUtils.clamp((0.22 - mSuture) / 0.22, 0, 1);
            tmpCol
              .copy(cMarginalRim)
              .lerp(cChestnut, 0.35 + 0.25 * Math.sin(theta * 5.0))
              .lerp(cSuture, Math.max(notchDark * 0.75, THREE.MathUtils.clamp((0.84 - r) / 0.03, 0, 0.85)));
          } else {
            // 5 hexagonal vertebral scutes along midline + 4 paired costal scutes
            const isVertebral = absX < 0.115 + 0.018 * Math.cos((z + 0.04) * 26.0);
            const bandCoord = isVertebral ? (z + 0.38) * 5.0 / 0.76 : (z + 0.34) * 4.0 / 0.68;
            const scuteIdx = Math.floor(bandCoord);
            const bandFrac = bandCoord - scuteIdx;
            const sutureDist = Math.min(bandFrac, 1.0 - bandFrac);
            const borderDist = isVertebral
              ? Math.max(0, 0.12 - absX)
              : Math.min(Math.max(0, absX - 0.115), Math.max(0, 0.81 - r));

            // Sunburst streaks fanning radially within each keratin plate
            const centerZ = isVertebral
              ? -0.38 + (scuteIdx + 0.5) * (0.76 / 5.0)
              : -0.34 + (scuteIdx + 0.5) * (0.68 / 4.0);
            const centerX = isVertebral ? 0.0 : Math.sign(x || 1) * 0.22;
            const rayAngle = Math.atan2(z - centerZ, x - centerX);
            const rays = 0.5 + 0.5 * Math.sin(rayAngle * 14.0 + scuteIdx * 1.9);

            tmpCol
              .copy(cOliveDark)
              .lerp(cOliveWarm, rays * 0.55)
              .lerp(cChestnut, (scuteIdx % 2 === 0 ? 0.32 : 0.18) + rays * 0.28)
              .lerp(cAmberStreak, Math.pow(rays, 2.2) * 0.52);

            if (sutureDist < 0.085 || (isVertebral && borderDist < 0.016) || (!isVertebral && absX < 0.132)) {
              const seamMix = Math.max(
                THREE.MathUtils.clamp((0.085 - sutureDist) / 0.085, 0, 1),
                THREE.MathUtils.clamp((0.016 - borderDist) / 0.016, 0, 0.85)
              );
              tmpCol.lerp(cSuture, seamMix * 0.85);
            }
          }
        } else {
          // Smooth cream-ochre plastron with warm bridge border
          const bridge = THREE.MathUtils.clamp((r - 0.72) / 0.28, 0, 1);
          tmpCol.copy(cPlastron).lerp(cPlastronShade, bridge * 0.78);
        }
        shellColors.push(tmpCol.r, tmpCol.g, tmpCol.b);
      }
    }
    return startIdx;
  }

  const topStart = buildShellHalf(true);
  const botStart = buildShellHalf(false);
  const stride = aSegs + 1;

  for (let ir = 0; ir < rRings; ir++) {
    for (let ia = 0; ia < aSegs; ia++) {
      const a = topStart + ir * stride + ia;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      shellIndices.push(a, b, d, a, d, c);

      const ba = botStart + ir * stride + ia;
      const bb = ba + 1;
      const bc = ba + stride;
      const bd = bc + 1;
      shellIndices.push(ba, bd, bb, ba, bc, bd);
    }
  }

  const shellGeom = new THREE.BufferGeometry();
  shellGeom.setAttribute('position', new THREE.Float32BufferAttribute(shellPositions, 3));
  shellGeom.setAttribute('color', new THREE.Float32BufferAttribute(shellColors, 3));
  shellGeom.setIndex(shellIndices);
  shellGeom.computeVertexNormals();
  bodyParts.push(prepareForMerge(shellGeom, null));
  shellGeom.dispose();

  // 2. Muscular Wrinkled Neck + Blunt Rounded Beaked Cranium + Scaled Cheek Plates + Expressive Eyes
  const neck = new THREE.CylinderGeometry(0.066, 0.084, 0.16, 12, 3);
  neck.rotateX(Math.PI * 0.44);
  neck.scale(1.05, 0.86, 1.0);
  neck.translate(0, 0.020, 0.475);
  bodyParts.push(
    prepareForMerge(neck, (x, y, z, _nx, _ny, _nz, out) => {
      const skinCell = cellularSpotMask(x, y, z, 42.0, 0.75);
      const topMix = THREE.MathUtils.clamp((y + 0.04) / 0.08, 0, 1);
      out.copy(cSkinCream).lerp(cSkinTop, topMix);
      if (topMix > 0.45 && skinCell.edgeDist < 0.22) {
        out.lerp(cSkinCream, (1.0 - skinCell.edgeDist / 0.22) * 0.42);
      }
    })
  );
  neck.dispose();

  const cranium = new THREE.SphereGeometry(0.090, 16, 12);
  cranium.scale(0.84, 0.82, 1.24);
  const cPos = cranium.attributes.position;
  for (let i = 0; i < cPos.count; i++) {
    let cx = cPos.getX(i);
    let cy = cPos.getY(i);
    const cz = cPos.getZ(i);
    // Chelonia mydas signature short rounded blunt snout & jaw shelf
    if (cz > 0.04) {
      const f = (cz - 0.04) / 0.072;
      cx *= 1.0 - f * 0.26;
      if (cy < 0) cy *= 0.85;
    }
    cPos.setXYZ(i, cx, cy, cz);
  }
  cranium.computeVertexNormals();
  cranium.translate(0, 0.042, 0.590);
  bodyParts.push(
    prepareForMerge(cranium, (x, y, z, _nx, _ny, _nz, out) => {
      const topMix = THREE.MathUtils.clamp((y + 0.025) / 0.11, 0, 1);
      out.copy(cSkinCream).lerp(cSkinTop, topMix);
      // Polygonal olive head scales outlined in creamy tan sutures
      const scaleCell = cellularSpotMask(x, y, z, 36.0, 0.78);
      if (topMix > 0.32 && scaleCell.edgeDist < 0.24) {
        out.lerp(cSkinCream, (1.0 - scaleCell.edgeDist / 0.24) * 0.72);
      }
      // Dark olive-slate serrated keratin herbivore beak at tip
      if (z > 0.655 && y < 0.068) {
        out.lerp(cBeak, THREE.MathUtils.clamp((z - 0.655) / 0.032, 0, 1));
      }
    })
  );
  cranium.dispose();

  for (const side of [-1, 1]) {
    const scl = new THREE.SphereGeometry(0.021, 10, 8);
    scl.scale(0.55, 1.0, 1.0);
    scl.translate(side * 0.064, 0.056, 0.625);
    bodyParts.push(prepareForMerge(scl, cEyeSclera));
    scl.dispose();

    const iris = new THREE.SphereGeometry(0.0155, 10, 8);
    iris.scale(0.62, 1.0, 1.0);
    iris.translate(side * 0.069, 0.056, 0.628);
    bodyParts.push(prepareForMerge(iris, cEyeIris));
    iris.dispose();

    const glint = new THREE.SphereGeometry(0.0052, 6, 4);
    glint.translate(side * 0.075, 0.061, 0.634);
    bodyParts.push(prepareForMerge(glint, cEyeGlint));
    glint.dispose();
  }

  // Short stubby tail
  const tail = new THREE.ConeGeometry(0.032, 0.11, 8);
  tail.rotateX(-Math.PI * 0.54);
  tail.translate(0, -0.022, -0.505);
  bodyParts.push(prepareForMerge(tail, cSkinTop));
  tail.dispose();

  const bodyGeom = safeMerge(bodyParts);

  // 3. Swept Hydrofoil Fore-Flippers (pivoted cleanly at local shoulder socket 0,0,0)
  function buildForeFlipper(side) {
    const uSpan = 16;
    const vChord = 14;
    const positions = [];
    const colors = [];
    const indices = [];

    for (let iu = 0; iu <= uSpan; iu++) {
      const u = iu / uSpan; // 0 = shoulder socket, 1 = wingtip
      const xBase = side * u * 0.66;
      const chordHalf = (0.072 + Math.sin(Math.pow(u, 0.72) * Math.PI) * 0.048) * (1.0 - 0.68 * Math.pow(u, 1.8));
      const sweepZ = -Math.pow(u, 1.42) * 0.40 + Math.sin(u * Math.PI) * 0.052;
      const maxThick = 0.019 * (1.0 - 0.72 * u);

      for (let iv = 0; iv <= vChord; iv++) {
        const theta = (iv / vChord) * Math.PI * 2;
        const cosA = Math.cos(theta); // +1 = leading edge, -1 = trailing edge
        const sinA = Math.sin(theta); // +1 = top dorsal surface, -1 = bottom pale surface

        // Streamlined cambered NACA-like foil
        const zOff = cosA * chordHalf;
        const foilPinch = Math.pow(Math.max(0.0, 1.0 - Math.max(0, -cosA) * 0.68), 0.7);
        const yOff = sinA * maxThick * foilPinch + (1.0 - cosA * cosA) * 0.008;

        const px = xBase;
        const py = yOff;
        const pz = sweepZ + zOff;
        positions.push(px, py, pz);

        const scCell = cellularSpotMask(px, py, pz, 34.0, 0.78);
        if (sinA >= 0) {
          tmpCol.copy(cSkinTop).lerp(cOliveDark, 0.45);
          if (scCell.edgeDist < 0.24) {
            tmpCol.lerp(cSkinCream, (1.0 - scCell.edgeDist / 0.24) * 0.65);
          }
          if (cosA > 0.72) {
            tmpCol.lerp(cClaw, (cosA - 0.72) * 1.4);
          }
        } else {
          tmpCol.copy(cSkinCream).lerp(cPlastron, 0.45);
        }
        colors.push(tmpCol.r, tmpCol.g, tmpCol.b);
      }
    }

    const rowStride = vChord + 1;
    for (let iu = 0; iu < uSpan; iu++) {
      for (let iv = 0; iv < vChord; iv++) {
        const a = iu * rowStride + iv;
        const b = a + 1;
        const c = a + rowStride;
        const d = c + 1;
        if (side > 0) {
          indices.push(a, d, b, a, c, d);
        } else {
          indices.push(a, b, d, a, d, c);
        }
      }
    }

    const tipPos = [side * 0.675, 0.0, -0.355];
    const tipIdx = positions.length / 3;
    positions.push(tipPos[0], tipPos[1], tipPos[2]);
    colors.push(cSkinTop.r, cSkinTop.g, cSkinTop.b);
    const lastRing = uSpan * rowStride;
    for (let iv = 0; iv < vChord; iv++) {
      const a = lastRing + iv;
      const b = a + 1;
      if (side > 0) {
        indices.push(a, tipIdx, b);
      } else {
        indices.push(a, b, tipIdx);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    // Small keratin marginal claw spur along leading edge near u = 0.25
    const claw = new THREE.ConeGeometry(0.011, 0.028, 6);
    claw.rotateX(Math.PI * 0.35);
    claw.rotateZ(side * -0.45);
    claw.translate(side * 0.175, 0.006, 0.042);
    const preppedGeom = prepareForMerge(geom, null);
    geom.dispose();
    const merged = safeMerge([preppedGeom, prepareForMerge(claw, cClaw)]);
    claw.dispose();
    return merged;
  }

  const leftFlipperGeom = buildForeFlipper(-1);
  const rightFlipperGeom = buildForeFlipper(1);

  // 4. Twin Broad Paddle Hind Steering Flippers pivoted at (0,0,0)
  const hindParts = [];
  for (const side of [-1, 1]) {
    const pad = new THREE.SphereGeometry(0.11, 10, 8);
    pad.scale(0.68, 0.12, 1.38);
    pad.rotateY(side * -0.42);
    pad.translate(side * 0.115, 0, -0.095);
    hindParts.push(
      prepareForMerge(pad, (x, y, z, _nx, _ny, _nz, out) => {
        const scCell = cellularSpotMask(x, y, z, 38.0, 0.78);
        out.copy(y >= 0 ? cSkinTop : cSkinCream);
        if (y >= 0 && scCell.edgeDist < 0.22) {
          out.lerp(cSkinCream, (1.0 - scCell.edgeDist / 0.22) * 0.55);
        }
      })
    );
    pad.dispose();
  }
  const hindFlippersGeom = safeMerge(hindParts);

  return { bodyGeom, leftFlipperGeom, rightFlipperGeom, hindFlippersGeom };
}

export function createPredatorsAndRays({
  applyUnderwaterMaterial,
  getSeabedHeight = defaultGetSeabedHeight,
  getSubstrateHeight = null,
  sampleSubstrate = null,
  sampleWall = null,
  bommies = [],
  coralHeads = [],
  caves = [],
  cleaningSystem = null,
  observer = null,
} = {}) {
  const group = new THREE.Group();
  group.name = 'reef-predators-and-rays';

  const readSeabedHeight =
    typeof getSeabedHeight === 'function' ? getSeabedHeight : defaultGetSeabedHeight;
  const readSubstrateHeight =
    typeof getSubstrateHeight === 'function' ? getSubstrateHeight : readSeabedHeight;
  const bommyList = Array.isArray(bommies) ? bommies : [];
  const coralList = Array.isArray(coralHeads) ? coralHeads : [];
  const caveList = Array.isArray(caves) ? caves : [];

  function isClearOfRock(x, y, z, radiusScale = 0.96, subClearance = 0.04) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    if (y < readSubstrateHeight(x, z) + subClearance) return false;
    for (let b = 0; b < bommyList.length; b++) {
      const bm = bommyList[b];
      const topY = bm.topY ?? -Infinity;
      const minR = (bm.radius ?? 0) * radiusScale;
      if (y < topY + 0.15) {
        const dx = x - bm.x;
        const dz = z - bm.z;
        if (dx * dx + dz * dz < minR * minR) return false;
      }
    }
    return true;
  }

  function findWallPerch(
    bommyId,
    prefDirX = 0,
    prefDirZ = 1,
    wallOffset = 0.32,
    yOffsets = [0.42, 0.65, 0.88, 0.28, 1.1]
  ) {
    const bommy = bommyList.find((b) => b.id === bommyId) ?? bommyList[0] ?? null;
    const baseLen = Math.hypot(prefDirX, prefDirZ) || 1;
    const baseAngle = Math.atan2(prefDirZ / baseLen, prefDirX / baseLen);
    const angleOffsets = [0, 0.45, -0.45, 0.9, -0.9, 1.45, -1.45, 2.0, -2.0, 2.6, -2.6, Math.PI];

    if (bommy && typeof sampleWall === 'function') {
      const baseY = bommy.baseY ?? readSeabedHeight(bommy.x, bommy.z);
      const topY = bommy.topY ?? baseY + 1.4;
      for (let yi = 0; yi < yOffsets.length; yi++) {
        const probeY = Math.min(topY - 0.12, baseY + yOffsets[yi]);
        for (let ai = 0; ai < angleOffsets.length; ai++) {
          const ang = baseAngle + angleOffsets[ai];
          const dx = Math.cos(ang);
          const dz = Math.sin(ang);
          const hit = sampleWall(bommy.x, bommy.z, dx, dz, {
            targetY: probeY,
            maxDist: (bommy.radius ?? 2.2) + 0.95,
            offset: wallOffset,
          });
          if (hit && hit.found) {
            const subY = readSubstrateHeight(hit.x, hit.z);
            if (hit.y >= subY + 0.04 && isClearOfRock(hit.x, hit.y, hit.z, 0.96, 0.04)) {
              // Ensure outward normal actually faces away from the bommy center
              const radX = hit.x - bommy.x;
              const radZ = hit.z - bommy.z;
              let nx = hit.nx ?? dx;
              let nz = hit.nz ?? dz;
              if (radX * nx + radZ * nz <= 0.05) {
                nx = radX;
                nz = radZ;
              }
              const outLen = Math.hypot(nx, nz) || 1;
              return {
                pos: new THREE.Vector3(hit.x, hit.y, hit.z),
                outDir: new THREE.Vector3(nx / outLen, 0.06, nz / outLen).normalize(),
              };
            }
          }
        }
      }
    }

    // Smooth fallback around bommy perimeter (or preferred offset if bommies omitted)
    const cx = bommy ? bommy.x : prefDirX * 2.5;
    const cz = bommy ? bommy.z : prefDirZ * 2.5;
    const r = (bommy?.radius ?? 1.2) + Math.max(wallOffset, 0.35);
    for (let ai = 0; ai < angleOffsets.length; ai++) {
      const ang = baseAngle + angleOffsets[ai];
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      const px = cx + dx * r;
      const pz = cz + dz * r;
      const py = Math.max(readSeabedHeight(px, pz), readSubstrateHeight(px, pz)) + yOffsets[0];
      if (isClearOfRock(px, py, pz, 0.95, 0.04)) {
        return {
          pos: new THREE.Vector3(px, py, pz),
          outDir: new THREE.Vector3(dx, 0.06, dz).normalize(),
        };
      }
    }

    const px = cx + (prefDirX / baseLen) * r;
    const pz = cz + (prefDirZ / baseLen) * r;
    const tmp = new THREE.Vector3(px, readSubstrateHeight(px, pz) + 0.42, pz);
    avoidBommiesXZ(tmp, null, bommyList, Math.max(0.25, wallOffset), 0.016);
    tmp.y = Math.max(tmp.y, readSubstrateHeight(tmp.x, tmp.z) + 0.25);
    return {
      pos: tmp,
      outDir: new THREE.Vector3(prefDirX / baseLen, 0.06, prefDirZ / baseLen).normalize(),
    };
  }

  const pickableMeshes = [];
  const predators = []; // live array { pos, vel, radius, speciesId, isActiveHunter } updated every frame!

  const fishMat = createAnimatedFishMaterial(
    applyUnderwaterMaterial,
    { roughness: 0.28, metalness: 0.14 },
    { receiveCaustics: true, causticsStrength: 0.80 }
  );

  const morayRayMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.34,
      metalness: 0.10,
    }),
    { receiveCaustics: true, causticsStrength: 0.80 }
  );

  const rawRayMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.32,
    metalness: 0.08,
  });
  rawRayMat.customProgramCacheKey = () => 'taeniura_ocelli_v1';
  rawRayMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
attribute vec3 aRayDisc;
varying vec3 vRayDisc;
`
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
#include <begin_vertex>
vRayDisc = aRayDisc;
`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
varying vec3 vRayDisc;
vec2 rayOcelliHash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}
vec3 rayVoronoi2D(vec2 uv, float jitter) {
  vec2 n = floor(uv);
  vec2 f = fract(uv);
  float d1 = 8.0;
  vec2 bestId = n;
  float bestHash = 0.5;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 cell = n + g;
      vec2 h = rayOcelliHash(cell);
      vec2 o = 0.5 + (h - 0.5) * jitter;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) {
        d1 = d;
        bestId = cell;
        bestHash = fract(h.x * 1.37 + h.y * 0.73);
      }
    }
  }
  return vec3(sqrt(d1), bestHash, fract(dot(bestId, vec2(0.13, 0.37))));
}
vec3 evalTaeniuraOcelli(vec2 p) {
  float r = length(p);
  vec3 cDisc = vec3(0.49, 0.34, 0.085);
  vec3 cMargin = vec3(0.76, 0.60, 0.26);
  vec3 col = mix(cDisc, cMargin, smoothstep(0.83, 0.96, r));
  col *= 1.05 - 0.10 * clamp(r, 0.0, 1.0);

  vec3 vc = rayVoronoi2D(p * vec2(5.6, 6.2) + vec2(0.37, -0.21), 0.62);
  float rc = (0.285 + 0.075 * vc.y) * mix(0.76, 1.0, smoothstep(0.76, 0.58, r));
  float coarseMask = 1.0 - smoothstep(0.67, 0.77, r);

  vec3 vf = rayVoronoi2D(p * vec2(10.2, 11.2) + vec2(3.13, 1.77), 0.66);
  float rf = 0.255 + 0.065 * vf.y;
  float fineMask = smoothstep(0.67, 0.73, r) * (1.0 - smoothstep(0.88, 0.92, r));

  float coarseSpot = (1.0 - smoothstep(rc * 0.84, rc, vc.x)) * coarseMask;
  float fineSpot = (1.0 - smoothstep(rf * 0.82, rf, vf.x)) * fineMask;
  float spot = max(coarseSpot, fineSpot);

  float coarseHalo = (1.0 - smoothstep(rc, rc + 0.095, vc.x)) * coarseMask * (1.0 - coarseSpot);
  float fineHalo = (1.0 - smoothstep(rf, rf + 0.08, vf.x)) * fineMask * (1.0 - fineSpot);
  float halo = max(coarseHalo, fineHalo);

  float spotCore = max(
    coarseSpot * clamp(1.0 - vc.x / max(rc, 0.001), 0.0, 1.0),
    fineSpot * clamp(1.0 - vf.x / max(rf, 0.001), 0.0, 1.0)
  );
  vec3 cHalo = vec3(0.11, 0.072, 0.018);
  vec3 cSpotOuter = vec3(0.012, 0.34, 1.08);
  vec3 cSpotInner = vec3(0.16, 0.78, 1.25);
  vec3 spotCol = mix(cSpotOuter, cSpotInner, pow(clamp(spotCore, 0.0, 1.0), 0.65));

  col = mix(col, cHalo, clamp(halo * 0.68, 0.0, 1.0));
  col = mix(col, spotCol, clamp(spot, 0.0, 1.0));
  return col;
}
`
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
#include <color_fragment>
if (vRayDisc.z > 0.005) {
  vec3 rayDiscCol = evalTaeniuraOcelli(vRayDisc.xy);
  diffuseColor.rgb = mix(diffuseColor.rgb, rayDiscCol * diffuseColor.rgb, clamp(vRayDisc.z, 0.0, 1.0));
}
`
      );
  };
  const rayMat = applyUnderwaterMaterial(rawRayMat, { receiveCaustics: true, causticsStrength: 0.82 });

  const turtleMat = applyUnderwaterMaterial(
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.38,
      metalness: 0.08,
    }),
    { receiveCaustics: true, causticsStrength: 0.88 }
  );

  const scratch = createMatrixScratch();
  const dummy = new THREE.Object3D();

  function makePair(proto, count, speciesId) {
    const bodyMesh = new THREE.InstancedMesh(proto.bodyGeom, fishMat, count);
    bodyMesh.name = `${speciesId}-bodies`;
    configureDynamicMesh(bodyMesh, speciesId);
    enableShadows(bodyMesh, true, true);

    const tailMesh = new THREE.InstancedMesh(proto.tailGeom, fishMat, count);
    tailMesh.name = `${speciesId}-tails`;
    configureDynamicMesh(tailMesh, speciesId);
    enableShadows(tailMesh, true, true);

    const swimAttr = attachSwimStateAttribute(bodyMesh, tailMesh, count);

    group.add(bodyMesh, tailMesh);
    pickableMeshes.push(bodyMesh, tailMesh);
    return { bodyMesh, tailMesh, tailPivotZ: proto.tailPivotZ, swimAttr };
  }

  // ---------------------------------------------------------------------------
  // 1. Red Sea Coral Groupers (6 -> 12 patrolling canyon ledges past coral heads)
  // ---------------------------------------------------------------------------
  const DEFAULT_GROUPER_COUNT = SPECIES_POPULATION_SPEC.grouper.defaultCount;
  const MAX_GROUPER_COUNT = SPECIES_POPULATION_SPEC.grouper.maxCount;
  const grouperMeshes = makePair(buildGrouperPrototype(), MAX_GROUPER_COUNT, 'grouper');
  const grouperRng = createRng(7101);
  const groupers = [];
  const grouperWaypoints = [
    new THREE.Vector3(-1.4, 1.0, 4.5),
    new THREE.Vector3(3.85, 0.55, 4.25),
    new THREE.Vector3(4.2, 0.8, 3.2),
    new THREE.Vector3(3.4, 0.9, -1.6),
    new THREE.Vector3(2.85, 1.15, -0.55),
    new THREE.Vector3(-3.45, 1.0, -3.05),
    new THREE.Vector3(-2.1, 1.0, -5.8),
    new THREE.Vector3(3.5, 0.7, -9.8),
  ];
  for (let w = 0; w < grouperWaypoints.length; w++) {
    const wp = grouperWaypoints[w];
    avoidBommiesXZ(wp, null, bommyList, 0.52, 0.016);
    wp.y = Math.max(wp.y, readSubstrateHeight(wp.x, wp.z) + 0.55);
  }

  for (let i = 0; i < MAX_GROUPER_COUNT; i++) {
    const wp = grouperWaypoints[i % grouperWaypoints.length];
    const pos = wp.clone();
    if (i >= DEFAULT_GROUPER_COUNT) {
      pos.x += (i % 2 === 0 ? 0.65 : -0.65);
      pos.y += 0.18;
      pos.z += (i % 3 === 0 ? 0.55 : -0.55);
    }
    avoidBommiesXZ(pos, null, bommyList, 0.48, 0.016);
    pos.y = Math.max(pos.y, readSubstrateHeight(pos.x, pos.z) + 0.48);
    const vel = new THREE.Vector3(Math.cos(i), 0, Math.sin(i)).multiplyScalar(0.55);
    const heading = safeNormalize(vel.clone(), 0, 0, 1);
    const isActive = i < DEFAULT_GROUPER_COUNT;
    const predEntry = {
      pos: pos.clone(),
      vel: isActive ? vel.clone() : new THREE.Vector3(),
      radius: isActive ? 2.05 : 0,
      speciesId: 'grouper',
      isActiveHunter: isActive,
    };
    predators.push(predEntry);
    groupers.push({
      pos,
      vel,
      heading,
      prevYaw: Math.atan2(heading.x, heading.z),
      targetIdx: (i < DEFAULT_GROUPER_COUNT ? i + 1 : i + 3) % grouperWaypoints.length,
      scale: 0.93 + grouperRng() * 0.19,
      phase: grouperRng() * Math.PI * 2,
      swimPhase: grouperRng() * Math.PI * 2,
      pitchOffset: 0,
      rollOffset: 0,
      predEntry,
      cleanState: 'none',
      cleanTimer: 0,
      cleanApproachTimer: 0,
      cleanCooldown: i === 0 ? 1.0 : 8.0 + i * 4.5,
      cleanTarget: null,
      postCleanGrace: 0,
      cleanSide: i % 2 === 0 ? 1 : -1,
      clientKey: `grouper-${i}`,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Bluefin Trevally (6 -> 12 sweeping from blue water through winding canyon)
  // ---------------------------------------------------------------------------
  const DEFAULT_CARANX_COUNT = SPECIES_POPULATION_SPEC.caranx.defaultCount;
  const MAX_CARANX_COUNT = SPECIES_POPULATION_SPEC.caranx.maxCount;
  const caranxMeshes = makePair(buildTrevallyPrototype(), MAX_CARANX_COUNT, 'caranx');
  const caranxRng = createRng(7201);
  const trevallies = [];
  for (let i = 0; i < MAX_CARANX_COUNT; i++) {
    const t =
      i < DEFAULT_CARANX_COUNT
        ? (i / DEFAULT_CARANX_COUNT) * Math.PI * 2
        : ((i - DEFAULT_CARANX_COUNT + 0.5) / (MAX_CARANX_COUNT - DEFAULT_CARANX_COUNT)) * Math.PI * 2;
    const pos = new THREE.Vector3(Math.sin(t) * 5.0, 1.4 + (i % 3) * 0.35, Math.cos(t) * 11.0 - 2.0);
    avoidBommiesXZ(pos, null, bommyList, 0.55, 0.016);
    pos.y = Math.max(pos.y, readSubstrateHeight(pos.x, pos.z) + 0.65);
    const vel = new THREE.Vector3(0.8, 0, -0.8);
    const heading = safeNormalize(vel.clone(), 0, 0, -1);
    const isActive = i < DEFAULT_CARANX_COUNT;
    const predEntry = {
      pos: pos.clone(),
      vel: isActive ? vel.clone() : new THREE.Vector3(),
      radius: isActive ? 2.55 : 0,
      speciesId: 'caranx',
      isActiveHunter: isActive,
    };
    predators.push(predEntry);
    trevallies.push({
      pos,
      vel,
      heading,
      prevYaw: Math.atan2(heading.x, heading.z),
      tParam: t,
      speed: 0.34 + (i % 2) * 0.08,
      altitude: 1.3 + (i % 3) * 0.38,
      scale: 0.94 + caranxRng() * 0.19,
      phase: caranxRng() * Math.PI * 2,
      swimPhase: caranxRng() * Math.PI * 2,
      pitchOffset: 0,
      rollOffset: 0,
      predEntry,
      cleanState: 'none',
      cleanTimer: 0,
      cleanApproachTimer: 0,
      cleanCooldown: i === 0 ? 4.5 : 14.0 + i * 5.0,
      cleanTarget: null,
      postCleanGrace: 0,
      cleanSide: i % 2 === 0 ? 1 : -1,
      clientKey: `caranx-${i}`,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Devil Firefish / Lionfish (5 -> 10 hovering near bommies & reef arch)
  // ---------------------------------------------------------------------------
  const DEFAULT_LION_COUNT = SPECIES_POPULATION_SPEC.pterois.defaultCount;
  const MAX_LION_COUNT = SPECIES_POPULATION_SPEC.pterois.maxCount;
  const lionMeshes = makePair(buildLionfishPrototype(), MAX_LION_COUNT, 'pterois');
  const lionSpecs = [
    { bommyId: 'reef-arch', dirX: 0.85, dirZ: 0.52 },
    { bommyId: 'undercut-cave-east', dirX: -0.78, dirZ: 0.62 },
    { bommyId: 'fg-showcase', dirX: 0.82, dirZ: 0.56 },
    { bommyId: 'canyon-east-mid', dirX: -0.88, dirZ: 0.32 },
    { bommyId: 'dropoff-west', dirX: 0.90, dirZ: 0.22 },
    { bommyId: 'canyon-west-mid', dirX: 0.86, dirZ: 0.38 },
    { bommyId: 'dropoff-east', dirX: -0.92, dirZ: 0.25 },
    { bommyId: 'arch-west-buttress', dirX: 0.72, dirZ: 0.68 },
    { bommyId: 'table-north', dirX: 0.68, dirZ: -0.72 },
    { bommyId: 'far-north-spur', dirX: -0.70, dirZ: 0.70 },
  ];
  const lionfish = [];
  for (let i = 0; i < MAX_LION_COUNT; i++) {
    const spec = lionSpecs[i % lionSpecs.length];
    const perch = findWallPerch(spec.bommyId, spec.dirX, spec.dirZ, 0.50, [0.55, 0.80, 0.40, 1.05]);
    const anchor = perch.pos.clone();
    avoidBommiesXZ(anchor, null, bommyList, 0.46, 0.016);
    anchor.y = Math.max(anchor.y, readSubstrateHeight(anchor.x, anchor.z) + 0.38);

    const wallNormal = perch.outDir.clone();
    wallNormal.y = 0;
    safeNormalize(wallNormal, spec.dirX, 0, spec.dirZ);
    const wallTangent = new THREE.Vector3(-wallNormal.z, 0, wallNormal.x);
    safeNormalize(wallTangent, 1, 0, 0);

    const pos = anchor.clone();
    const heading = wallTangent.clone();
    const vel = heading.clone().multiplyScalar(0.12);
    const isActive = i < DEFAULT_LION_COUNT;
    const predEntry = {
      pos: pos.clone(),
      vel: isActive ? vel.clone() : new THREE.Vector3(),
      radius: isActive ? 0.95 : 0,
      speciesId: 'pterois',
      isActiveHunter: false,
    };
    predators.push(predEntry);
    lionfish.push({
      anchor,
      wallNormal,
      wallTangent,
      heading,
      pos,
      vel,
      phase: i * 1.4,
      scale: 0.88 + (i % 3) * 0.13,
      predEntry,
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Geometric Moray Eels (Gymnothorax griseus — 4 -> 8 x 14-segment sinusoidal S-wave + gaping jaws)
  // ---------------------------------------------------------------------------
  const DEFAULT_MORAY_COUNT = SPECIES_POPULATION_SPEC.moray.defaultCount;
  const MAX_MORAY_COUNT = SPECIES_POPULATION_SPEC.moray.maxCount;
  const MORAY_SEGS = 18;
  const morayProto = buildMorayPrototypes();

  const morayHeadMesh = new THREE.InstancedMesh(morayProto.headGeom, morayRayMat, MAX_MORAY_COUNT);
  morayHeadMesh.name = 'moray-heads';
  configureDynamicMesh(morayHeadMesh, 'moray');
  enableShadows(morayHeadMesh, true, true);

  const morayJawMesh = new THREE.InstancedMesh(morayProto.jawGeom, morayRayMat, MAX_MORAY_COUNT);
  morayJawMesh.name = 'moray-jaws';
  configureDynamicMesh(morayJawMesh, 'moray');
  enableShadows(morayJawMesh, true, true);

  const moraySegMesh = new THREE.InstancedMesh(morayProto.bodySegGeom, morayRayMat, MAX_MORAY_COUNT * MORAY_SEGS);
  moraySegMesh.name = 'moray-segments';
  configureDynamicMesh(moraySegMesh, 'moray');
  enableShadows(moraySegMesh, true, true);

  const morayRng = createRng(7301);
  for (let i = 0; i < MAX_MORAY_COUNT; i++) {
    const col = new THREE.Color('#ffffff');
    col.setHSL(
      0.085 + (morayRng() - 0.5) * 0.03,
      morayRng() * 0.015,
      Math.min(1.0, 0.985 + (morayRng() - 0.5) * 0.025)
    );
    morayHeadMesh.setColorAt(i, col);
    morayJawMesh.setColorAt(i, col);
    for (let s = 0; s < MORAY_SEGS; s++) {
      moraySegMesh.setColorAt(i * MORAY_SEGS + s, col);
    }
  }
  if (morayHeadMesh.instanceColor) morayHeadMesh.instanceColor.needsUpdate = true;
  if (morayJawMesh.instanceColor) morayJawMesh.instanceColor.needsUpdate = true;
  if (moraySegMesh.instanceColor) moraySegMesh.instanceColor.needsUpdate = true;

  group.add(morayHeadMesh, morayJawMesh, moraySegMesh);
  pickableMeshes.push(morayHeadMesh, morayJawMesh, moraySegMesh);

  const MORAY_TRAIL_LEN = 48;
  const morayCreviceSpecs = [
    { bommyId: 'fg-showcase', dirX: 0.55, dirZ: 0.83 },
    { bommyId: 'undercut-cave-east', dirX: -0.75, dirZ: 0.35 },
    { bommyId: 'canyon-west-mid', dirX: 0.85, dirZ: 0.25 },
    { bommyId: 'canyon-east-mid', dirX: -0.85, dirZ: -0.15 },
  ];
  let creviceIdx = 0;
  const morays = [];
  for (let i = 0; i < MAX_MORAY_COUNT; i++) {
    const isCrevice = i < 2 || (i >= 4 && i % 2 === 0);
    let anchor;
    let outDir;
    let pos;
    let vel;
    let heading;
    let trail = null;
    let trailHead = 0;
    let totalArc = 0;
    let lastSampleArc = 0;
    let prevHeadPos = null;

    if (isCrevice) {
      const spec = morayCreviceSpecs[creviceIdx % morayCreviceSpecs.length];
      if (bommyList.length > 0 || typeof sampleWall === 'function') {
        const perch = findWallPerch(spec.bommyId, spec.dirX, spec.dirZ, 0.30, [0.35, 0.55, 0.75, 0.25, 0.95]);
        anchor = perch.pos;
        outDir = perch.outDir;
      } else {
        const fallbackCave =
          caveList[creviceIdx % Math.max(1, caveList.length)]?.position ??
          new THREE.Vector3(spec.dirX * 2.5, readSubstrateHeight(spec.dirX * 2.5, spec.dirZ * 2.5) + 0.35, spec.dirZ * 2.5);
        anchor = fallbackCave.clone();
        outDir = new THREE.Vector3(spec.dirX, 0.06, spec.dirZ).normalize();
      }
      creviceIdx++;
      avoidBommiesXZ(anchor, null, bommyList, 0.22, 0.016);
      anchor.y = Math.max(anchor.y, readSubstrateHeight(anchor.x, anchor.z) + 0.14);
      pos = anchor.clone();
      heading = outDir.clone();
      vel = outDir.clone();
    } else {
      const initX = i === 2 ? 0.8 : i === 3 ? -1.2 : i === 5 ? 1.6 : -1.8;
      const initZ = i === 2 ? -2.0 : i === 3 ? 3.5 : i === 5 ? -5.0 : 0.5;
      pos = new THREE.Vector3(initX, readSubstrateHeight(initX, initZ) + 0.25, initZ);
      avoidBommiesXZ(pos, null, bommyList, 0.34, 0.016);
      pos.y = Math.max(pos.y, readSubstrateHeight(pos.x, pos.z) + 0.22);
      anchor = pos.clone();
      vel = new THREE.Vector3(-0.35, 0, 0.25);
      heading = safeNormalize(vel.clone(), 0, 0, 1);
      outDir = heading.clone();

      const initRight = safeNormalize(new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), heading), 1, 0, 0);
      trail = new Array(MORAY_TRAIL_LEN);
      const stepArc = 0.06;
      const tmpTrailPos = new THREE.Vector3();
      for (let k = 0; k < MORAY_TRAIL_LEN; k++) {
        const backDist = (MORAY_TRAIL_LEN - 1 - k) * stepArc;
        tmpTrailPos.copy(pos).addScaledVector(heading, -backDist);
        avoidBommiesXZ(tmpTrailPos, null, bommyList, 0.16, 0.016);
        tmpTrailPos.y = Math.max(tmpTrailPos.y, readSubstrateHeight(tmpTrailPos.x, tmpTrailPos.z) + 0.16);
        trail[k] = {
          x: tmpTrailPos.x,
          y: tmpTrailPos.y,
          z: tmpTrailPos.z,
          rx: initRight.x,
          ry: initRight.y,
          rz: initRight.z,
          arc: -backDist,
        };
      }
      trailHead = MORAY_TRAIL_LEN - 1;
      totalArc = 0;
      lastSampleArc = 0;
      prevHeadPos = pos.clone();
    }

    const isActive = i < DEFAULT_MORAY_COUNT;
    const predEntry = {
      pos: pos.clone(),
      vel: isActive && !isCrevice ? vel.clone() : new THREE.Vector3(),
      radius: isActive ? (isCrevice ? 0.95 : 1.85) : 0,
      speciesId: 'moray',
      isActiveHunter: isActive && !isCrevice,
    };
    predators.push(predEntry);
    morays.push({
      isCrevice,
      anchor,
      outDir,
      pos,
      vel,
      heading,
      trail,
      trailHead,
      totalArc,
      lastSampleArc,
      prevHeadPos,
      scale: 0.93 + morayRng() * 0.13,
      phase: i * 1.7,
      predEntry,
      cleanState: 'none',
      cleanTimer: 0,
      cleanApproachTimer: 0,
      cleanCooldown: isCrevice ? (i === 0 ? 3.5 : 10.0 + i * 4.0) : Infinity,
      cleanTarget: null,
      postCleanGrace: 0,
      cleanBlend: 0,
      clientKey: `moray-${i}`,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Bluespotted Ribbontail Rays (Taeniura lymma — 4 -> 8 rays gliding over canyon & under tables)
  // ---------------------------------------------------------------------------
  const DEFAULT_RAY_COUNT = SPECIES_POPULATION_SPEC.taeniura.defaultCount;
  const MAX_RAY_COUNT = SPECIES_POPULATION_SPEC.taeniura.maxCount;
  const rayProto = buildRibbontailRayPrototypes();
  const rayCenterMesh = new THREE.InstancedMesh(rayProto.centerGeom, rayMat, MAX_RAY_COUNT);
  rayCenterMesh.name = 'taeniura-centers';
  configureDynamicMesh(rayCenterMesh, 'taeniura');
  enableShadows(rayCenterMesh, true, true);
  group.add(rayCenterMesh);
  pickableMeshes.push(rayCenterMesh);

  const wingMeshes = { left: [], right: [] };
  const wingZOffsets = [0.072, -0.006, -0.078];
  for (let s = 0; s < 3; s++) {
    const lMesh = new THREE.InstancedMesh(rayProto.wingGeoms.left[s], rayMat, MAX_RAY_COUNT);
    lMesh.name = `taeniura-left-wing-${s}`;
    configureDynamicMesh(lMesh, 'taeniura');
    enableShadows(lMesh, true, true);
    const rMesh = new THREE.InstancedMesh(rayProto.wingGeoms.right[s], rayMat, MAX_RAY_COUNT);
    rMesh.name = `taeniura-right-wing-${s}`;
    configureDynamicMesh(rMesh, 'taeniura');
    enableShadows(rMesh, true, true);
    group.add(lMesh, rMesh);
    pickableMeshes.push(lMesh, rMesh);
    wingMeshes.left.push(lMesh);
    wingMeshes.right.push(rMesh);
  }

  const rayRng = createRng(7351);
  for (let i = 0; i < MAX_RAY_COUNT; i++) {
    const col = new THREE.Color('#ffffff');
    col.setHSL(
      0.11 + (rayRng() - 0.5) * 0.04,
      rayRng() * 0.02,
      Math.min(1.0, 0.98 + (rayRng() - 0.5) * 0.035)
    );
    rayCenterMesh.setColorAt(i, col);
    for (let s = 0; s < 3; s++) {
      wingMeshes.left[s].setColorAt(i, col);
      wingMeshes.right[s].setColorAt(i, col);
    }
  }
  if (rayCenterMesh.instanceColor) rayCenterMesh.instanceColor.needsUpdate = true;
  for (let s = 0; s < 3; s++) {
    if (wingMeshes.left[s].instanceColor) wingMeshes.left[s].instanceColor.needsUpdate = true;
    if (wingMeshes.right[s].instanceColor) wingMeshes.right[s].instanceColor.needsUpdate = true;
  }

  const rays = [];
  for (let i = 0; i < MAX_RAY_COUNT; i++) {
    const t =
      i < DEFAULT_RAY_COUNT
        ? 0.68 + i * 1.67
        : 0.35 + ((i - DEFAULT_RAY_COUNT + 0.5) / Math.max(1, MAX_RAY_COUNT - DEFAULT_RAY_COUNT)) * Math.PI * 2;
    const z0 = Math.sin(t) * 7.8 + 0.8;
    const canyonX0 = 2.4 * Math.sin(z0 * 0.19) + 1.1 * Math.cos(z0 * 0.08);
    const x0 = canyonX0 + Math.sin(t * 2.0 + i * 1.4) * 1.45;
    const pos = new THREE.Vector3(x0, readSubstrateHeight(x0, z0) + 0.28, z0);
    avoidBommiesXZ(pos, null, bommyList, 0.48, 0.016);
    pos.y = Math.max(pos.y, readSubstrateHeight(pos.x, pos.z) + 0.24);
    rays.push({
      tParam: t,
      pos,
      vel: new THREE.Vector3(0, 0, 0.65),
      heading: new THREE.Vector3(0, 0, 1),
      scale: 0.88 + (i % 3) * 0.09,
      phase: i * 1.6,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Red Sea Sand Lizardfish (Synodus variegatus — 9 -> 16 sit-and-wait sand predators)
  // ---------------------------------------------------------------------------
  const DEFAULT_LIZARD_COUNT = SPECIES_POPULATION_SPEC.lizardfish.defaultCount;
  const MAX_LIZARD_COUNT = SPECIES_POPULATION_SPEC.lizardfish.maxCount;
  const lizardMeshes = makePair(buildLizardfishPrototype(), MAX_LIZARD_COUNT, 'lizardfish');
  const lizardRng = createRng(7401);

  function isValidSandPatch(x, z, existingPositions = [], coralClearance = 0.36, peerClearance = 1.1) {
    // 1. Cheap domain bounds check first
    if (Math.hypot(x, z) > 15.5) return false;

    // 2. Cheap seabed elevation check
    const h = readSeabedHeight(x, z);
    if (h >= -0.62) return false;

    // 3. Cheap analytical substrate / bommy rock height check
    if (readSubstrateHeight(x, z) - h > 0.04) return false;

    // 4. Cheap seabed slope check
    const slopeX = readSeabedHeight(x + 0.25, z) - readSeabedHeight(x - 0.25, z);
    const slopeZ = readSeabedHeight(x, z + 0.25) - readSeabedHeight(x, z - 0.25);
    if (Math.hypot(slopeX, slopeZ) / 0.5 >= 0.13) return false;

    // 5. Bommy footprint clearance
    for (let b = 0; b < bommyList.length; b++) {
      const bm = bommyList[b];
      const clearR = (bm.radius ?? 0) + coralClearance;
      if (Math.hypot(x - bm.x, z - bm.z) < clearR) return false;
    }

    // 6. Active coral head clearance
    for (let c = 0; c < coralList.length; c++) {
      const ch = coralList[c];
      if (ch.active === false) continue;
      if (Math.hypot(x - ch.position.x, z - ch.position.z) < ch.radius + coralClearance) {
        return false;
      }
    }

    // 7. Peer clearance
    for (let e = 0; e < existingPositions.length; e++) {
      const ep = existingPositions[e];
      if (Math.hypot(x - ep.x, z - ep.z) < peerClearance) {
        return false;
      }
    }

    // 8. Expensive raycast/mesh probe strictly LAST
    if (sampleSubstrate && sampleSubstrate(x, z).onRock) return false;

    return true;
  }

  // Precompute all clean sandy canyon patches once at init for zero runtime raycasts
  const validSandPatches = [];
  for (let gx = -11.5; gx <= 11.5; gx += 0.5) {
    for (let gz = -12.5; gz <= 12.5; gz += 0.5) {
      if (isValidSandPatch(gx, gz, [], 0.36, 0)) {
        validSandPatches.push({ x: gx, z: gz, y: readSubstrateHeight(gx, gz) });
      }
    }
  }

  function findSandPatch(prefX, prefZ, rng, existingPositions = []) {
    if (validSandPatches.length > 0) {
      let best = null;
      let bestDist = Infinity;
      for (let i = 0; i < validSandPatches.length; i++) {
        const p = validSandPatches[i];
        const d = Math.hypot(p.x - prefX, p.z - prefZ);
        if (d > 4.5 || d >= bestDist) continue;
        let peerOk = true;
        for (let e = 0; e < existingPositions.length; e++) {
          const ep = existingPositions[e];
          if (Math.hypot(p.x - ep.x, p.z - ep.z) < 1.1) {
            peerOk = false;
            break;
          }
        }
        if (peerOk) {
          bestDist = d;
          best = p;
        }
      }
      if (best) return best;
    }

    const angleJitter = rng() * Math.PI * 2;
    for (let k = 0; k < 24; k++) {
      const r = k === 0 ? 0 : Math.sqrt(k / 23) * 4.5;
      const a = k === 0 ? 0 : angleJitter + k * 2.3999632 + (rng() - 0.5) * 0.25;
      const x = prefX + Math.cos(a) * r;
      const z = prefZ + Math.sin(a) * r;
      if (isValidSandPatch(x, z, existingPositions)) return { x, z };
    }
    return null;
  }

  function findInitialSandPatch(prefX, prefZ, rng, existingPositions = []) {
    if (validSandPatches.length > 0) {
      const clearances = [1.1, 0.7, 0.35];
      for (let p = 0; p < clearances.length; p++) {
        const peerClear = clearances[p];
        let best = null;
        let bestDist = Infinity;
        for (let i = 0; i < validSandPatches.length; i++) {
          const cand = validSandPatches[i];
          const d = Math.hypot(cand.x - prefX, cand.z - prefZ);
          if (d >= bestDist) continue;
          let peerOk = true;
          for (let e = 0; e < existingPositions.length; e++) {
            const ep = existingPositions[e];
            if (Math.hypot(cand.x - ep.x, cand.z - ep.z) < peerClear) {
              peerOk = false;
              break;
            }
          }
          if (peerOk) {
            bestDist = d;
            best = cand;
          }
        }
        if (best) return best;
      }
    }

    const direct = findSandPatch(prefX, prefZ, rng, existingPositions);
    if (direct) return direct;

    // Minimal standalone test fallback: clamp away from bommies & pick nearest open spot
    const fallback = new THREE.Vector3(prefX, readSubstrateHeight(prefX, prefZ), prefZ);
    avoidBommiesXZ(fallback, null, bommyList, 0.4, 0.016);
    return { x: fallback.x, z: fallback.z };
  }

  const lizardPreferredSpots = [
    [0.85, 5.65],
    [2.95, 6.45],
    [-0.25, 2.85],
    [1.25, 1.45],
    [-0.55, -0.85],
    [1.65, -3.65],
    [-0.45, -4.25],
    [0.85, -7.15],
    [-3.35, 6.85],
    [0.25, 4.10],
    [-1.45, 3.05],
    [2.35, 1.85],
    [0.15, -2.10],
    [2.15, -5.45],
    [-0.85, -6.55],
    [1.35, -8.85],
  ];

  const lizards = [];
  const spawnedSandPositions = [];
  for (let i = 0; i < MAX_LIZARD_COUNT; i++) {
    const [prefX, prefZ] = lizardPreferredSpots[i];
    const patch = findInitialSandPatch(prefX, prefZ, lizardRng, spawnedSandPositions);
    const sx = patch ? patch.x : prefX;
    const sz = patch ? patch.z : prefZ;
    const scale = 0.92 + lizardRng() * 0.20;
    const pos = new THREE.Vector3(sx, readSubstrateHeight(sx, sz) + 0.035 * scale, sz);
    avoidBommiesXZ(pos, null, bommyList, 0.36, 0.016);
    pos.y = readSubstrateHeight(pos.x, pos.z) + 0.035 * scale;
    spawnedSandPositions.push(pos);

    const yaw = lizardRng() * Math.PI * 2;
    const heading = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const predEntry = {
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      radius: 0,
      speciesId: 'lizardfish',
      isActiveHunter: false,
    };
    predators.push(predEntry);

    lizards.push({
      state: 'perched',
      pos,
      vel: new THREE.Vector3(),
      heading,
      scale,
      phase: lizardRng() * Math.PI * 2,
      waitTimer: 0.9 + i * 0.85,
      strikeElapsed: 0,
      strikeDuration: 0.55,
      startPos: pos.clone(),
      targetPos: pos.clone(),
      apexHeight: 0.45,
      predEntry,
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Green Sea Turtles (Chelonia mydas — צב ים ירוק)
  // ---------------------------------------------------------------------------
  const DEFAULT_TURTLE_COUNT = SPECIES_POPULATION_SPEC.chelonia.defaultCount;
  const MAX_TURTLE_COUNT = SPECIES_POPULATION_SPEC.chelonia.maxCount;
  const turtleProto = buildGreenSeaTurtlePrototypes();

  const turtleBodyMesh = new THREE.InstancedMesh(turtleProto.bodyGeom, turtleMat, MAX_TURTLE_COUNT);
  turtleBodyMesh.name = 'chelonia-bodies';
  configureDynamicMesh(turtleBodyMesh, 'chelonia');
  enableShadows(turtleBodyMesh, true, true);

  const turtleLeftFlipperMesh = new THREE.InstancedMesh(
    turtleProto.leftFlipperGeom,
    turtleMat,
    MAX_TURTLE_COUNT
  );
  turtleLeftFlipperMesh.name = 'chelonia-left-flippers';
  configureDynamicMesh(turtleLeftFlipperMesh, 'chelonia');
  enableShadows(turtleLeftFlipperMesh, true, true);

  const turtleRightFlipperMesh = new THREE.InstancedMesh(
    turtleProto.rightFlipperGeom,
    turtleMat,
    MAX_TURTLE_COUNT
  );
  turtleRightFlipperMesh.name = 'chelonia-right-flippers';
  configureDynamicMesh(turtleRightFlipperMesh, 'chelonia');
  enableShadows(turtleRightFlipperMesh, true, true);

  const turtleHindMesh = new THREE.InstancedMesh(turtleProto.hindFlippersGeom, turtleMat, MAX_TURTLE_COUNT);
  turtleHindMesh.name = 'chelonia-hind-flippers';
  configureDynamicMesh(turtleHindMesh, 'chelonia');
  enableShadows(turtleHindMesh, true, true);

  const turtleRng = createRng(9127);
  const turtlePalette = ['#ffffff', '#f5f2e8', '#ecebe0', '#f7efe3', '#eef4ea'];
  const turtleInitConfigs = [
    { x: -0.55, y: 1.72, z: 5.85, cx: 0.35, cz: 2.8, rx: 4.4, rz: 5.4, alt: 1.68, scale: 1.02, dir: 1 },
    { x: 3.2, y: 1.55, z: -2.8, cx: 0.6, cz: -3.2, rx: 5.8, rz: 7.4, alt: 1.48, scale: 0.94, dir: -1 },
    { x: 0.4, y: 1.85, z: -6.5, cx: 0.2, cz: -5.4, rx: 5.0, rz: 5.5, alt: 1.72, scale: 0.98, dir: 1 },
    { x: -4.4, y: 1.45, z: 1.2, cx: -2.2, cz: 0.8, rx: 4.4, rz: 5.8, alt: 1.42, scale: 0.89, dir: -1 },
    { x: 4.6, y: 1.68, z: 2.6, cx: 2.0, cz: 1.2, rx: 4.6, rz: 6.0, alt: 1.58, scale: 1.06, dir: 1 },
  ];
  const turtles = [];
  for (let i = 0; i < MAX_TURTLE_COUNT; i++) {
    const cfg = turtleInitConfigs[i % turtleInitConfigs.length];
    const tCol = new THREE.Color(turtlePalette[i % turtlePalette.length]);
    turtleBodyMesh.setColorAt(i, tCol);
    turtleLeftFlipperMesh.setColorAt(i, tCol);
    turtleRightFlipperMesh.setColorAt(i, tCol);
    turtleHindMesh.setColorAt(i, tCol);

    const pos = new THREE.Vector3(cfg.x, cfg.y, cfg.z);
    avoidBommiesXZ(pos, null, bommyList, 0.56 * cfg.scale, 0.016);
    pos.y = Math.max(pos.y, readSubstrateHeight(pos.x, pos.z) + 0.42 * cfg.scale);
    const rngYaw = turtleRng() * Math.PI * 2;
    const yaw = i === 0 ? 0.98 : rngYaw;
    const heading = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();

    turtles.push({
      pos,
      vel: heading.clone().multiplyScalar(0.45),
      heading,
      scale: cfg.scale,
      orbitParam: i * 1.45,
      orbitDir: cfg.dir,
      centerX: cfg.cx,
      centerZ: cfg.cz,
      radiusX: cfg.rx,
      radiusZ: cfg.rz,
      baseAlt: cfg.alt,
      phase: turtleRng() * Math.PI * 2,
      flapClock: turtleRng() * 14.0,
      glideBlend: 0,
      pitch: 0,
      roll: 0,
      mode: 'cruise',
      breathCooldown: 18 + i * 9.5,
      breathHold: 0,
      grazeCooldown: 9 + i * 7.2,
      grazeTimer: 0,
      cleanState: 'none',
      cleanTimer: 0,
      cleanApproachTimer: 0,
      cleanCooldown: 5.0 + i * 9.5,
      cleanTarget: null,
      clientKey: `chelonia-${i}`,
    });
  }
  if (turtleBodyMesh.instanceColor) turtleBodyMesh.instanceColor.needsUpdate = true;
  if (turtleLeftFlipperMesh.instanceColor) turtleLeftFlipperMesh.instanceColor.needsUpdate = true;
  if (turtleRightFlipperMesh.instanceColor) turtleRightFlipperMesh.instanceColor.needsUpdate = true;
  if (turtleHindMesh.instanceColor) turtleHindMesh.instanceColor.needsUpdate = true;
  group.add(turtleBodyMesh, turtleLeftFlipperMesh, turtleRightFlipperMesh, turtleHindMesh);
  pickableMeshes.push(turtleBodyMesh, turtleLeftFlipperMesh, turtleRightFlipperMesh, turtleHindMesh);

  const vDiff = new THREE.Vector3();
  const vDir = new THREE.Vector3();
  const vFwd = new THREE.Vector3();
  const vRight = new THREE.Vector3();
  const vUp = new THREE.Vector3();
  const vSegRight = new THREE.Vector3();
  const vSegUp = new THREE.Vector3();
  const vStripPos = new THREE.Vector3();
  const vFlow = new THREE.Vector3();
  const vObsDiff = new THREE.Vector3();
  const vAvoidTarget = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const segPos = new THREE.Vector3();
  const mRot = new THREE.Matrix4();
  const mLocal = new THREE.Matrix4();
  const mWing = new THREE.Matrix4();
  const qRot = new THREE.Quaternion();
  const _tShoulderLPos = new THREE.Vector3();
  const _tShoulderRPos = new THREE.Vector3();
  const _tHindPos = new THREE.Vector3();
  const _tTarget = new THREE.Vector3();
  const _tSteer = new THREE.Vector3();
  const _tEuler = new THREE.Euler(0, 0, 0, 'ZYX');
  const _tWingQuat = new THREE.Quaternion();
  const _tWorldQuat = new THREE.Quaternion();
  const _tScale = new THREE.Vector3();
  const lizardCandidates = [];

  const activeCounts = {
    grouper: DEFAULT_GROUPER_COUNT,
    caranx: DEFAULT_CARANX_COUNT,
    pterois: DEFAULT_LION_COUNT,
    moray: DEFAULT_MORAY_COUNT,
    taeniura: DEFAULT_RAY_COUNT,
    lizardfish: DEFAULT_LIZARD_COUNT,
    chelonia: DEFAULT_TURTLE_COUNT,
  };

  function applyPairCount(meshes, count) {
    meshes.bodyMesh.count = count;
    meshes.tailMesh.count = count;
    meshes.bodyMesh.visible = count > 0;
    meshes.tailMesh.visible = count > 0;
  }

  function applySpeciesCounts(speciesCounts) {
    const nGrouper = Math.min(
      groupers.length,
      sanitizeSpeciesCount('grouper', speciesCounts?.grouper ?? DEFAULT_GROUPER_COUNT)
    );
    activeCounts.grouper = nGrouper;
    applyPairCount(grouperMeshes, nGrouper);
    for (let i = 0; i < nGrouper; i++) {
      const g = groupers[i];
      const inClean = g.cleanState === 'approaching' || g.cleanState === 'beingCleaned';
      const isHunting = !inClean && g.postCleanGrace <= 0;
      g.predEntry.radius = isHunting ? 2.05 : 0;
      g.predEntry.isActiveHunter = isHunting;
    }
    for (let i = nGrouper; i < groupers.length; i++) {
      const g = groupers[i];
      g.predEntry.radius = 0;
      g.predEntry.isActiveHunter = false;
      g.predEntry.vel.set(0, 0, 0);
      g.postCleanGrace = 0;
      if (g.cleanState === 'approaching' || g.cleanState === 'beingCleaned') {
        cleaningSystem?.releaseStation(g.clientKey);
        g.cleanState = 'none';
        g.cleanTarget = null;
        g.cleanApproachTimer = 0;
      }
    }

    const nCaranx = Math.min(
      trevallies.length,
      sanitizeSpeciesCount('caranx', speciesCounts?.caranx ?? DEFAULT_CARANX_COUNT)
    );
    activeCounts.caranx = nCaranx;
    applyPairCount(caranxMeshes, nCaranx);
    for (let i = 0; i < nCaranx; i++) {
      const tr = trevallies[i];
      const inClean = tr.cleanState === 'approaching' || tr.cleanState === 'beingCleaned';
      const isHunting = !inClean && tr.postCleanGrace <= 0;
      tr.predEntry.radius = isHunting ? 2.55 : 0;
      tr.predEntry.isActiveHunter = isHunting;
    }
    for (let i = nCaranx; i < trevallies.length; i++) {
      const tr = trevallies[i];
      tr.predEntry.radius = 0;
      tr.predEntry.isActiveHunter = false;
      tr.predEntry.vel.set(0, 0, 0);
      tr.postCleanGrace = 0;
      if (tr.cleanState === 'approaching' || tr.cleanState === 'beingCleaned') {
        cleaningSystem?.releaseStation(tr.clientKey);
        tr.cleanState = 'none';
        tr.cleanTarget = null;
        tr.cleanApproachTimer = 0;
      }
    }

    const nLion = Math.min(
      lionfish.length,
      sanitizeSpeciesCount('pterois', speciesCounts?.pterois ?? DEFAULT_LION_COUNT)
    );
    activeCounts.pterois = nLion;
    applyPairCount(lionMeshes, nLion);
    for (let i = 0; i < lionfish.length; i++) {
      const active = i < nLion;
      lionfish[i].predEntry.radius = active ? 0.95 : 0;
      lionfish[i].predEntry.isActiveHunter = false;
      if (!active) lionfish[i].predEntry.vel.set(0, 0, 0);
    }

    const nMoray = Math.min(
      morays.length,
      sanitizeSpeciesCount('moray', speciesCounts?.moray ?? DEFAULT_MORAY_COUNT)
    );
    activeCounts.moray = nMoray;
    morayHeadMesh.count = nMoray;
    morayJawMesh.count = nMoray;
    moraySegMesh.count = nMoray * MORAY_SEGS;
    morayHeadMesh.visible = nMoray > 0;
    morayJawMesh.visible = nMoray > 0;
    moraySegMesh.visible = nMoray > 0;
    for (let i = 0; i < nMoray; i++) {
      const m = morays[i];
      const inClean = m.cleanState === 'approaching' || m.cleanState === 'beingCleaned';
      const inTruce = inClean || m.postCleanGrace > 0;
      m.predEntry.radius = inTruce ? 0 : (m.isCrevice ? 0.95 : 1.85);
      m.predEntry.isActiveHunter = !m.isCrevice && !inTruce;
      if (m.isCrevice || inTruce) m.predEntry.vel.set(0, 0, 0);
    }
    for (let i = nMoray; i < morays.length; i++) {
      const m = morays[i];
      m.predEntry.radius = 0;
      m.predEntry.isActiveHunter = false;
      m.predEntry.vel.set(0, 0, 0);
      m.postCleanGrace = 0;
      m.cleanBlend = 0;
      if (m.cleanState === 'approaching' || m.cleanState === 'beingCleaned') {
        cleaningSystem?.releaseStation(m.clientKey);
        m.cleanState = 'none';
        m.cleanTarget = null;
        m.cleanApproachTimer = 0;
      }
    }

    const nRay = Math.min(
      rays.length,
      sanitizeSpeciesCount('taeniura', speciesCounts?.taeniura ?? DEFAULT_RAY_COUNT)
    );
    activeCounts.taeniura = nRay;
    rayCenterMesh.count = nRay;
    rayCenterMesh.visible = nRay > 0;
    for (let s = 0; s < 3; s++) {
      wingMeshes.left[s].count = nRay;
      wingMeshes.left[s].visible = nRay > 0;
      wingMeshes.right[s].count = nRay;
      wingMeshes.right[s].visible = nRay > 0;
    }

    const nLizard = Math.min(
      lizards.length,
      sanitizeSpeciesCount('lizardfish', speciesCounts?.lizardfish ?? DEFAULT_LIZARD_COUNT)
    );
    activeCounts.lizardfish = nLizard;
    applyPairCount(lizardMeshes, nLizard);
    for (let i = nLizard; i < lizards.length; i++) {
      lizards[i].predEntry.radius = 0;
      lizards[i].predEntry.isActiveHunter = false;
      lizards[i].predEntry.vel.set(0, 0, 0);
    }

    const nTurtle = Math.min(
      turtles.length,
      sanitizeSpeciesCount('chelonia', speciesCounts?.chelonia ?? DEFAULT_TURTLE_COUNT)
    );
    activeCounts.chelonia = nTurtle;
    turtleBodyMesh.count = nTurtle;
    turtleBodyMesh.visible = nTurtle > 0;
    turtleLeftFlipperMesh.count = nTurtle;
    turtleLeftFlipperMesh.visible = nTurtle > 0;
    turtleRightFlipperMesh.count = nTurtle;
    turtleRightFlipperMesh.visible = nTurtle > 0;
    turtleHindMesh.count = nTurtle;
    turtleHindMesh.visible = nTurtle > 0;
    for (let i = nTurtle; i < turtles.length; i++) {
      if (turtles[i].cleanTarget && cleaningSystem) {
        cleaningSystem.releaseStation(turtles[i].clientKey);
      }
      turtles[i].cleanState = 'none';
      turtles[i].cleanTarget = null;
      if (turtles[i].mode === 'clean') turtles[i].mode = 'cruise';
    }
  }

  function update(elapsedTime, deltaTime, envState) {
    applySpeciesCounts(envState?.speciesCounts);
    const dt = Math.min(Math.max(deltaTime || 0.016, 0.001), 0.05);
    const activeEnv = envState ?? DEFAULT_ENV_STATE;
    const surfaceLimitY = WORLD_CONSTANTS.SURFACE_BASE_Y + (envState?.diveDepth ?? 6.0) - 0.65;
    const obsPos = observer?.position ?? null;
    const hasObserver =
      obsPos !== null &&
      Number.isFinite(obsPos.x) &&
      Number.isFinite(obsPos.y) &&
      Number.isFinite(obsPos.z);

    // 1. Coral Groupers
    const nGrouper = activeCounts.grouper;
    if (nGrouper > 0) {
      for (let i = 0; i < nGrouper; i++) {
        const g = groupers[i];
        let targetPitch = 0;
        let targetRoll = 0;
        let swimSpeed = 5.2;
        let tailAmp = 0.28;
        let bodySwimAmp = 0.008;
        let finSwimAmp = 0.0055;

        if (g.cleanState === 'none') {
          g.postCleanGrace = Math.max(0, g.postCleanGrace - dt);
          g.cleanCooldown = Math.max(0, g.cleanCooldown - dt);
          if (g.cleanCooldown <= 0 && cleaningSystem) {
            const claim = cleaningSystem.tryAcquireStation(g.clientKey, g.pos, 2.95);
            if (claim) {
              g.cleanState = 'approaching';
              g.cleanTarget = claim;
              g.cleanTimer = 5.6;
              g.cleanApproachTimer = 0;
            }
          }
        }

        const gInClean = g.cleanState === 'approaching' || g.cleanState === 'beingCleaned';
        if (gInClean && g.cleanTarget && cleaningSystem) {
          g.predEntry.radius = 0; // Strict cleaning truce
          g.predEntry.isActiveHunter = false;
          const hover = g.cleanTarget.hoverPos;
          const targetY = Math.min(
            surfaceLimitY - 0.15,
            Math.max(readSubstrateHeight(hover.x, hover.z) + 0.35, hover.y)
          );
          vDiff.set(hover.x - g.pos.x, targetY - g.pos.y, hover.z - g.pos.z);
          const distToHover = vDiff.length();

          if (g.cleanState === 'approaching' && distToHover <= 0.22) {
            g.cleanState = 'beingCleaned';
          } else if (g.cleanState === 'beingCleaned' && distToHover > 0.45) {
            g.cleanState = 'approaching';
          }

          sampleFlowField(g.pos.x, g.pos.y, g.pos.z, elapsedTime, activeEnv, bommyList, vFlow);

          if (g.cleanState === 'approaching') {
            g.cleanApproachTimer += dt;
            if (distToHover > 1e-4) {
              const desiredSpeed = THREE.MathUtils.clamp(distToHover * 1.4, 0.24, 0.68);
              vDir.copy(vDiff).multiplyScalar(desiredSpeed / distToHover);
              g.vel.lerp(vDir, Math.min(1, dt * 4.0));
            }
            g.pos.addScaledVector(g.vel, dt);
            g.pos.addScaledVector(vFlow, dt * 0.20);
            avoidBommiesXZ(g.pos, g.vel, bommyList, 0.26, dt);
            if (g.vel.lengthSq() > 1e-4) {
              safeNormalize(g.heading.copy(g.vel), g.heading.x, g.heading.y, g.heading.z);
            }
            targetPitch = -0.14;
            targetRoll = 0;
          } else {
            g.vel.multiplyScalar(Math.max(0, 1 - dt * 10.0));
            const sp = g.vel.length();
            if (sp > 0.025) {
              g.vel.multiplyScalar(0.025 / sp);
            }
            g.pos.addScaledVector(g.vel, dt);
            g.pos.addScaledVector(vFlow, dt * 0.06);
            // Gentle spring keeping pose anchored near station despite current
            g.pos.x += (hover.x - g.pos.x) * Math.min(1, dt * 2.5);
            g.pos.z += (hover.z - g.pos.z) * Math.min(1, dt * 2.5);
            avoidBommiesXZ(g.pos, g.vel, bommyList, 0.22, dt);
            const flowMag = vFlow.length();
            targetPitch = -0.45;
            targetRoll = g.cleanSide * 0.24;
            swimSpeed = 2.2 + flowMag * 2.4;
            tailAmp = 0.06 + flowMag * 0.08;
            // Broad paddle pectorals scull noticeably while station-keeping at cleaning station
            bodySwimAmp = 0.0022;
            finSwimAmp = 0.015 + flowMag * 0.012;
            // ONLY decrement cleaning timer once positioned in hover pose!
            g.cleanTimer -= dt;
          }

          const floorMin = readSubstrateHeight(g.pos.x, g.pos.z) + 0.35;
          const minY = Math.min(surfaceLimitY - 0.1, floorMin);
          g.pos.y = THREE.MathUtils.clamp(g.pos.y, minY, Math.max(minY, surfaceLimitY));

          const poseOk = cleaningSystem.updateClientPose(
            g.clientKey,
            g.pos,
            g.vel.lengthSq() > 1e-4 ? g.vel : g.heading,
            {
              halfLen: 0.175 * g.scale,
              halfHeight: 0.067 * g.scale,
              halfWidth: 0.039 * g.scale,
              isPredator: true,
              jawOpen: false,
            },
            'grouper'
          );
          if (!poseOk || g.cleanTimer <= 0 || g.cleanApproachTimer > 14.0) {
            cleaningSystem.releaseStation(g.clientKey);
            g.cleanState = 'none';
            g.cleanTarget = null;
            g.cleanApproachTimer = 0;
            g.cleanCooldown = 24.0;
            g.postCleanGrace = 2.5;
            g.predEntry.radius = 0;
            g.predEntry.isActiveHunter = false;
            g.vel.copy(g.heading).multiplyScalar(0.55);
          }
        } else {
          if (g.postCleanGrace > 0) {
            g.predEntry.radius = 0;
            g.predEntry.isActiveHunter = false;
          } else {
            g.predEntry.radius = 2.05;
            g.predEntry.isActiveHunter = true;
          }
          const prevYaw = Math.atan2(g.heading.x, g.heading.z);
          const target = grouperWaypoints[g.targetIdx];
          vDiff.set(target.x - g.pos.x, target.y - g.pos.y, target.z - g.pos.z);
          const dist = vDiff.length();
          if (dist < 1.1) {
            g.targetIdx = (g.targetIdx + 1) % grouperWaypoints.length;
          } else if (dist > 1e-4) {
            g.vel.addScaledVector(vDiff, (0.95 / dist) * dt);
          }

          // Gentle diver comfort veer (maintain comfortable buffer without panicking)
          if (hasObserver) {
            vObsDiff.subVectors(g.pos, obsPos);
            const obsDist = vObsDiff.length();
            if (obsDist > 1e-4 && obsDist < 2.6) {
              const push = (2.6 - obsDist) / 2.6;
              g.vel.x += (vObsDiff.x / obsDist) * push * 1.15 * dt;
              g.vel.z += (vObsDiff.z / obsDist) * push * 1.15 * dt;
            }
          }

          // Gentle steering around/above scaled active coralHeads
          for (let c = 0; c < coralList.length; c++) {
            const head = coralList[c];
            if (head.active === false) continue;
            const topY = head.topWorldY ?? (head.position.y + head.radius * 0.45);
            const baseY = head.baseY ?? (head.position.y - head.radius * 0.45);
            if (g.pos.y < baseY - 0.25 || g.pos.y > topY + 0.45) continue;
            const dx = g.pos.x - head.position.x;
            const dz = g.pos.z - head.position.z;
            const avoidR = head.radius + 0.48;
            const dSq = dx * dx + dz * dz;
            if (dSq < avoidR * avoidR) {
              const d = Math.sqrt(dSq);
              const push = (avoidR - d) / avoidR;
              if (g.pos.y > topY - 0.20) {
                g.vel.y += Math.max(0.4, (topY + 0.36 - g.pos.y) * 3.0) * push * dt * 2.2;
              } else {
                const nx = d > 1e-4 ? dx / d : 1;
                const nz = d > 1e-4 ? dz / d : 0;
                const tangSign = -nz * g.vel.x + nx * g.vel.z >= 0 ? 1 : -1;
                g.vel.x += (nx * 1.8 - nz * tangSign * 0.9) * push * dt;
                g.vel.z += (nz * 1.8 + nx * tangSign * 0.9) * push * dt;
              }
            }
          }

          const floorY = readSubstrateHeight(g.pos.x, g.pos.z) + 0.55;
          if (g.pos.y < floorY) g.vel.y += (floorY - g.pos.y) * 3.5 * dt;
          if (g.pos.y > surfaceLimitY) g.vel.y -= (g.pos.y - surfaceLimitY) * 4.0 * dt;

          const sp = g.vel.length();
          if (sp < 1e-5) g.vel.set(0.5, 0, 0);
          else g.vel.multiplyScalar(THREE.MathUtils.clamp(sp, 0.42, 0.78) / sp);

          sampleFlowField(g.pos.x, g.pos.y, g.pos.z, elapsedTime, activeEnv, bommyList, vFlow);
          g.pos.addScaledVector(g.vel, dt);
          g.pos.addScaledVector(vFlow, dt * 0.22);

          // Post-step bommy avoidance + active coralHeads clearance
          avoidBommiesXZ(g.pos, g.vel, bommyList, 0.34, dt);
          for (let c = 0; c < coralList.length; c++) {
            const head = coralList[c];
            if (head.active === false) continue;
            const topY = head.topWorldY ?? (head.position.y + head.radius * 0.45);
            const baseY = head.baseY ?? (head.position.y - head.radius * 0.45);
            const clearMargin = 0.28;
            if (g.pos.y < baseY - 0.16 || g.pos.y > topY + clearMargin) continue;
            const dx = g.pos.x - head.position.x;
            const dz = g.pos.z - head.position.z;
            const clearR = head.radius + clearMargin;
            const dSq = dx * dx + dz * dz;
            if (dSq >= clearR * clearR) continue;
            if (g.pos.y > topY - 0.18 && topY + clearMargin <= surfaceLimitY) {
              g.pos.y = topY + clearMargin;
              g.vel.y = Math.max(0, g.vel.y);
            } else {
              const d = Math.sqrt(dSq);
              const nx = d > 1e-4 ? dx / d : 1;
              const nz = d > 1e-4 ? dz / d : 0;
              g.pos.x = head.position.x + nx * clearR;
              g.pos.z = head.position.z + nz * clearR;
              const vDotN = g.vel.x * nx + g.vel.z * nz;
              if (vDotN < 0) {
                const tx = -nz;
                const tz = nx;
                const tangSign = g.vel.x * tx + g.vel.z * tz >= 0 ? 1 : -1;
                g.vel.x -= vDotN * nx;
                g.vel.z -= vDotN * nz;
                g.vel.x += tx * tangSign * Math.abs(vDotN) * 0.35;
                g.vel.z += tz * tangSign * Math.abs(vDotN) * 0.35;
              }
            }
          }

          const floorMin = readSubstrateHeight(g.pos.x, g.pos.z) + 0.42;
          const minY = Math.min(surfaceLimitY - 0.1, floorMin);
          g.pos.y = THREE.MathUtils.clamp(g.pos.y, minY, Math.max(minY, surfaceLimitY));
          safeNormalize(g.heading.copy(g.vel), 0, 0, 1);

          const headwind = Math.max(0, -g.heading.dot(vFlow));
          swimSpeed += headwind * 2.0;
          tailAmp += headwind * 0.07;

          const newYaw = Math.atan2(g.heading.x, g.heading.z);
          const dYaw = Math.atan2(Math.sin(newYaw - prevYaw), Math.cos(newYaw - prevYaw));
          targetRoll = THREE.MathUtils.clamp(-(dYaw / dt) * 0.20, -0.22, 0.22);
        }

        g.predEntry.pos.copy(g.pos);
        g.predEntry.vel.copy(g.vel);
        g.pitchOffset = THREE.MathUtils.lerp(g.pitchOffset, targetPitch, Math.min(1, dt * 5.0));
        g.rollOffset = THREE.MathUtils.lerp(g.rollOffset, targetRoll, Math.min(1, dt * 5.0));
        g.swimPhase += swimSpeed * dt;

        const { bodyMatrix, tailMatrix } = orientFishMatrix(
          g.pos,
          g.vel.lengthSq() > 1e-4 ? g.vel : g.heading,
          g.scale,
          Math.sin(g.swimPhase) * (g.cleanState === 'beingCleaned' ? 0.015 : 0.05),
          Math.sin(g.swimPhase - 0.5) * tailAmp,
          g.pitchOffset,
          grouperMeshes.tailPivotZ,
          scratch,
          g.rollOffset
        );
        grouperMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
        grouperMeshes.tailMesh.setMatrixAt(i, tailMatrix);
        setSwimState(grouperMeshes.swimAttr, i, g.swimPhase, bodySwimAmp, finSwimAmp);
      }
      grouperMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      grouperMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      grouperMeshes.swimAttr.needsUpdate = true;
    }

    // 2. Bluefin Trevally sweeping through winding sand canyon & blue water + periodic cleaning visits
    const nCaranx = activeCounts.caranx;
    if (nCaranx > 0) {
      for (let i = 0; i < nCaranx; i++) {
        const tr = trevallies[i];
        let targetPitch = 0;
        let targetRoll = 0;
        let swimSpeed = 7.8;
        let tailAmp = 0.34;
        let bodySwimAmp = 0.014;
        let finSwimAmp = 0.009;

        if (tr.cleanState === 'none') {
          tr.postCleanGrace = Math.max(0, tr.postCleanGrace - dt);
          tr.cleanCooldown = Math.max(0, tr.cleanCooldown - dt);
          if (tr.cleanCooldown <= 0 && cleaningSystem) {
            const claim = cleaningSystem.tryAcquireStation(tr.clientKey, tr.pos, 3.2);
            if (claim) {
              tr.cleanState = 'approaching';
              tr.cleanTarget = claim;
              tr.cleanTimer = 4.8;
              tr.cleanApproachTimer = 0;
            }
          }
        }

        const trInClean = tr.cleanState === 'approaching' || tr.cleanState === 'beingCleaned';
        if (trInClean && tr.cleanTarget && cleaningSystem) {
          tr.predEntry.radius = 0; // Strict cleaning truce
          tr.predEntry.isActiveHunter = false;
          const hover = tr.cleanTarget.hoverPos;
          const targetY = Math.min(
            surfaceLimitY - 0.25,
            Math.max(readSubstrateHeight(hover.x, hover.z) + 0.42, hover.y)
          );
          vDiff.set(hover.x - tr.pos.x, targetY - tr.pos.y, hover.z - tr.pos.z);
          const distToHover = vDiff.length();

          if (tr.cleanState === 'approaching' && distToHover <= 0.24) {
            tr.cleanState = 'beingCleaned';
          } else if (tr.cleanState === 'beingCleaned' && distToHover > 0.48) {
            tr.cleanState = 'approaching';
          }

          sampleFlowField(tr.pos.x, tr.pos.y, tr.pos.z, elapsedTime, activeEnv, bommyList, vFlow);

          if (tr.cleanState === 'approaching') {
            tr.cleanApproachTimer += dt;
            if (distToHover > 1e-4) {
              const desiredSpeed = THREE.MathUtils.clamp(distToHover * 1.6, 0.28, 0.95);
              vDir.copy(vDiff).multiplyScalar(desiredSpeed / distToHover);
              tr.vel.lerp(vDir, Math.min(1, dt * 4.5));
            }
            tr.pos.addScaledVector(tr.vel, dt);
            tr.pos.addScaledVector(vFlow, dt * 0.20);
            avoidBommiesXZ(tr.pos, tr.vel, bommyList, 0.28, dt);
            if (tr.vel.lengthSq() > 1e-4) {
              safeNormalize(tr.heading.copy(tr.vel), tr.heading.x, tr.heading.y, tr.heading.z);
            }
            targetPitch = -0.10;
            targetRoll = 0;
            swimSpeed = 5.2;
            tailAmp = 0.20;
            bodySwimAmp = 0.008;
            finSwimAmp = 0.011;
          } else {
            tr.vel.multiplyScalar(Math.max(0, 1 - dt * 9.0));
            const sp = tr.vel.length();
            if (sp > 0.03) {
              tr.vel.multiplyScalar(0.03 / sp);
            }
            tr.pos.addScaledVector(tr.vel, dt);
            tr.pos.addScaledVector(vFlow, dt * 0.06);
            tr.pos.x += (hover.x - tr.pos.x) * Math.min(1, dt * 2.5);
            tr.pos.z += (hover.z - tr.pos.z) * Math.min(1, dt * 2.5);
            avoidBommiesXZ(tr.pos, tr.vel, bommyList, 0.24, dt);
            const flowMag = vFlow.length();
            targetPitch = -0.36;
            targetRoll = tr.cleanSide * 0.22;
            swimSpeed = 2.4 + flowMag * 2.4;
            tailAmp = 0.07 + flowMag * 0.08;
            bodySwimAmp = 0.003;
            finSwimAmp = 0.016 + flowMag * 0.012;
            // ONLY decrement cleaning timer once positioned in hover pose!
            tr.cleanTimer -= dt;
          }

          const floorMin = readSubstrateHeight(tr.pos.x, tr.pos.z) + 0.40;
          const minY = Math.min(surfaceLimitY - 0.2, floorMin);
          tr.pos.y = THREE.MathUtils.clamp(tr.pos.y, minY, Math.max(minY, surfaceLimitY - 0.2));

          const poseOk = cleaningSystem.updateClientPose(
            tr.clientKey,
            tr.pos,
            tr.vel.lengthSq() > 1e-4 ? tr.vel : tr.heading,
            {
              halfLen: 0.275 * tr.scale,
              halfHeight: 0.103 * tr.scale,
              halfWidth: 0.045 * tr.scale,
              isPredator: true,
              jawOpen: false,
            },
            'caranx'
          );
          if (!poseOk || tr.cleanTimer <= 0 || tr.cleanApproachTimer > 14.0) {
            cleaningSystem.releaseStation(tr.clientKey);
            tr.cleanState = 'none';
            tr.cleanTarget = null;
            tr.cleanApproachTimer = 0;
            tr.cleanCooldown = 26.0;
            tr.postCleanGrace = 2.5;
            tr.predEntry.radius = 0;
            tr.predEntry.isActiveHunter = false;
            tr.vel.copy(tr.heading).multiplyScalar(1.0);
          }
        } else {
          tr.tParam += tr.speed * dt;
          const z = Math.sin(tr.tParam) * 13.5 - 2.5;
          const canyonX = 2.4 * Math.sin(z * 0.19) + 1.1 * Math.cos(z * 0.08);
          const x = canyonX + Math.sin(tr.tParam * 2.0 + i) * 2.6;
          const yBase = Math.max(readSubstrateHeight(x, z) + 0.85, tr.altitude + Math.sin(tr.tParam * 1.5) * 0.45);
          vAvoidTarget.set(x, THREE.MathUtils.clamp(yBase, -2.5, surfaceLimitY - 0.25), z);
          avoidBommiesXZ(vAvoidTarget, null, bommyList, 0.55, dt);
          vAvoidTarget.y = THREE.MathUtils.clamp(
            Math.max(vAvoidTarget.y, readSubstrateHeight(vAvoidTarget.x, vAvoidTarget.z) + 0.72),
            -2.5,
            surfaceLimitY - 0.25
          );

          vDiff.subVectors(vAvoidTarget, tr.pos);
          if (hasObserver) {
            vObsDiff.subVectors(tr.pos, obsPos);
            const obsDist = vObsDiff.length();
            if (obsDist > 1e-4 && obsDist < 3.0) {
              const push = ((3.0 - obsDist) / 3.0) * 1.8;
              vDiff.x += (vObsDiff.x / obsDist) * push;
              vDiff.z += (vObsDiff.z / obsDist) * push;
            }
          }
          safeNormalize(vDir.copy(vDiff), tr.heading.x, tr.heading.y, tr.heading.z);

          // Bounded realistic yaw turn rate + graceful roll banking into turns
          const curYaw = Math.atan2(tr.heading.x, tr.heading.z);
          const desYaw = Math.atan2(vDir.x, vDir.z);
          const dYaw = Math.atan2(Math.sin(desYaw - curYaw), Math.cos(desYaw - curYaw));
          const maxYawStep = 1.45 * dt;
          const clampedDYaw = THREE.MathUtils.clamp(dYaw, -maxYawStep, maxYawStep);
          const newYaw = curYaw + clampedDYaw;
          const actualYawRate = clampedDYaw / dt;

          const nextPitchY = THREE.MathUtils.lerp(tr.heading.y, THREE.MathUtils.clamp(vDir.y, -0.45, 0.45), Math.min(1, dt * 3.2));
          const horiz = Math.sqrt(Math.max(0.05, 1.0 - nextPitchY * nextPitchY));
          tr.heading.set(Math.sin(newYaw) * horiz, nextPitchY, Math.cos(newYaw) * horiz).normalize();

          const cruiseSpeed = 1.18 + (tr.speed - 0.34) * 1.0;
          tr.vel.copy(tr.heading).multiplyScalar(cruiseSpeed);

          sampleFlowField(tr.pos.x, tr.pos.y, tr.pos.z, elapsedTime, activeEnv, bommyList, vFlow);
          tr.pos.addScaledVector(tr.vel, dt);
          tr.pos.addScaledVector(vFlow, dt * 0.24);
          avoidBommiesXZ(tr.pos, tr.vel, bommyList, 0.36, dt);

          const floorMin = readSubstrateHeight(tr.pos.x, tr.pos.z) + 0.55;
          const minY = Math.min(surfaceLimitY - 0.25, floorMin);
          tr.pos.y = THREE.MathUtils.clamp(tr.pos.y, minY, Math.max(minY, surfaceLimitY - 0.25));
          if (tr.vel.lengthSq() > 1e-4) {
            safeNormalize(tr.heading.copy(tr.vel), tr.heading.x, tr.heading.y, tr.heading.z);
          }

          targetRoll = THREE.MathUtils.clamp(-actualYawRate * 0.36, -0.44, 0.44);
          const headwind = Math.max(0, -tr.heading.dot(vFlow));
          swimSpeed += headwind * 2.5;
          tailAmp += headwind * 0.08;

          if (tr.postCleanGrace > 0) {
            tr.predEntry.radius = 0;
            tr.predEntry.isActiveHunter = false;
          } else {
            tr.predEntry.radius = 2.55;
            tr.predEntry.isActiveHunter = true;
          }
        }

        tr.predEntry.pos.copy(tr.pos);
        tr.predEntry.vel.copy(tr.vel);
        tr.pitchOffset = THREE.MathUtils.lerp(tr.pitchOffset, targetPitch, Math.min(1, dt * 5.0));
        tr.rollOffset = THREE.MathUtils.lerp(tr.rollOffset, targetRoll, Math.min(1, dt * 5.0));
        tr.swimPhase += swimSpeed * dt;

        const { bodyMatrix, tailMatrix } = orientFishMatrix(
          tr.pos,
          tr.vel.lengthSq() > 1e-4 ? tr.vel : tr.heading,
          tr.scale,
          Math.sin(tr.swimPhase) * (tr.cleanState === 'beingCleaned' ? 0.015 : 0.045),
          Math.sin(tr.swimPhase - 0.5) * tailAmp,
          tr.pitchOffset,
          caranxMeshes.tailPivotZ,
          scratch,
          tr.rollOffset
        );
        caranxMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
        caranxMeshes.tailMesh.setMatrixAt(i, tailMatrix);
        setSwimState(caranxMeshes.swimAttr, i, tr.swimPhase, bodySwimAmp, finSwimAmp);
      }
      caranxMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      caranxMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      caranxMeshes.swimAttr.needsUpdate = true;
    }

    // 3. Lionfish hovering slowly along bommy walls & caves (wall-parallel patrol + low-speed hover state)
    const nLion = activeCounts.pterois;
    if (nLion > 0) {
      for (let i = 0; i < nLion; i++) {
        const lf = lionfish[i];
        const hoverCycle = Math.sin(elapsedTime * 0.42 + lf.phase * 1.7);
        const isHovering = hoverCycle > 0.35;
        const tangSlide = Math.sin(elapsedTime * 0.30 + lf.phase) * 0.48;
        const standOff = 0.08 + Math.sin(elapsedTime * 0.55 + lf.phase) * 0.06;
        const bobY = Math.sin(elapsedTime * 0.70 + lf.phase) * 0.16;

        vAvoidTarget
          .copy(lf.anchor)
          .addScaledVector(lf.wallTangent, tangSlide)
          .addScaledVector(lf.wallNormal, standOff);
        vAvoidTarget.y += bobY;
        avoidBommiesXZ(vAvoidTarget, null, bommyList, 0.40, dt);
        const targetMinY = Math.min(surfaceLimitY - 0.3, readSubstrateHeight(vAvoidTarget.x, vAvoidTarget.z) + 0.36);
        vAvoidTarget.y = THREE.MathUtils.clamp(vAvoidTarget.y, targetMinY, Math.max(targetMinY, surfaceLimitY - 0.3));

        vDiff.subVectors(vAvoidTarget, lf.pos);
        const dist = vDiff.length();
        const maxCruise = isHovering ? 0.06 : 0.21;
        if (dist > 1e-4) {
          const desiredSpeed = Math.min(maxCruise, dist * 0.75);
          vDir.copy(vDiff).multiplyScalar(desiredSpeed / dist);
          lf.vel.lerp(vDir, Math.min(1, dt * (isHovering ? 3.5 : 2.5)));
        } else {
          lf.vel.multiplyScalar(Math.max(0, 1 - dt * 4.0));
        }

        sampleFlowField(lf.pos.x, lf.pos.y, lf.pos.z, elapsedTime, activeEnv, bommyList, vFlow);
        lf.pos.addScaledVector(lf.vel, dt);
        lf.pos.addScaledVector(vFlow, dt * 0.14);
        avoidBommiesXZ(lf.pos, lf.vel, bommyList, 0.32, dt);

        const floorMin = readSubstrateHeight(lf.pos.x, lf.pos.z) + 0.30;
        const minY = Math.min(surfaceLimitY - 0.3, floorMin);
        lf.pos.y = THREE.MathUtils.clamp(lf.pos.y, minY, Math.max(minY, surfaceLimitY - 0.3));

        const hSpeed = Math.hypot(lf.vel.x, lf.vel.z);
        if (hSpeed > 0.03) {
          vDir.set(lf.vel.x, lf.vel.y * 0.25, lf.vel.z);
          safeNormalize(vDir, lf.wallTangent.x, 0, lf.wallTangent.z);
          lf.heading.lerp(vDir, Math.min(1, dt * 3.0)).normalize();
        } else {
          lf.heading.lerp(lf.wallTangent, Math.min(1, dt * 1.5)).normalize();
        }

        lf.predEntry.pos.copy(lf.pos);
        lf.predEntry.vel.copy(lf.vel);
        lf.predEntry.radius = 0.95;
        lf.predEntry.isActiveHunter = false;

        const flowMag = vFlow.length();
        const swim = elapsedTime * ((isHovering ? 2.1 : 2.7) + flowMag * 1.8) + lf.phase;
        const { bodyMatrix, tailMatrix } = orientFishMatrix(
          lf.pos,
          lf.heading,
          lf.scale,
          Math.sin(swim) * (isHovering ? 0.025 : 0.04),
          Math.sin(swim - 0.6) * (isHovering ? 0.12 : 0.18),
          isHovering ? 0.16 : 0.10,
          lionMeshes.tailPivotZ,
          scratch,
          0
        );
        lionMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
        lionMeshes.tailMesh.setMatrixAt(i, tailMatrix);
        setSwimState(lionMeshes.swimAttr, i, swim, 0.0025, (isHovering ? 0.011 : 0.0085) + flowMag * 0.005);
      }
      lionMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      lionMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      lionMeshes.swimAttr.needsUpdate = true;
    }

    // 4. Geometric Moray Eels (14-segment sinusoidal S-wave + gaping jaws + crevice cleaning solicitation)
    const nMoray = activeCounts.moray;
    if (nMoray > 0) {
      let segIdx = 0;
      for (let i = 0; i < nMoray; i++) {
        const m = morays[i];
        if (m.isCrevice) {
          if (m.cleanState === 'none') {
            m.postCleanGrace = Math.max(0, m.postCleanGrace - dt);
            m.cleanCooldown = Math.max(0, m.cleanCooldown - dt);
            m.cleanBlend = Math.max(0, m.cleanBlend - dt * 1.4);
            if (m.cleanCooldown <= 0 && cleaningSystem) {
              const claim = cleaningSystem.tryAcquireStation(m.clientKey, m.pos, 4.8);
              if (claim) {
                m.cleanState = 'approaching';
                m.cleanTarget = claim;
                m.cleanTimer = 6.0;
                m.cleanApproachTimer = 0;
              }
            }
          }

          vFwd.copy(m.outDir);
          safeNormalize(vFwd, 0, 0.06, 1);
          m.vel.copy(vFwd);

          const mInClean = m.cleanState === 'approaching' || m.cleanState === 'beingCleaned';
          if (mInClean && m.cleanTarget && cleaningSystem) {
            m.cleanBlend = Math.min(1, m.cleanBlend + dt * 1.6);
            if (m.cleanState === 'approaching') {
              m.cleanApproachTimer += dt;
              if (m.cleanBlend >= 0.70) {
                m.cleanState = 'beingCleaned';
              }
            }
          }

          // Strict outward emergence (>= 0 along wall normal into open water)
          const baseEmerge = 0.5 + 0.5 * Math.sin(elapsedTime * 0.65 + m.phase);
          const emergeDist = (0.14 + baseEmerge * 0.20) * (1.0 - 0.45 * m.cleanBlend) + 0.24 * m.cleanBlend;
          m.pos.copy(m.anchor).addScaledVector(vFwd, emergeDist);
          avoidBommiesXZ(m.pos, null, bommyList, 0.16, dt);
          m.pos.y = Math.max(m.pos.y, readSubstrateHeight(m.pos.x, m.pos.z) + 0.08);
          m.heading.copy(vFwd);

          if (mInClean && m.cleanTarget && cleaningSystem) {
            m.predEntry.radius = 0; // Strict cleaning truce
            m.predEntry.isActiveHunter = false;
            m.predEntry.vel.set(0, 0, 0);

            const poseOk = cleaningSystem.updateClientPose(
              m.clientKey,
              m.pos,
              vFwd,
              {
                halfLen: 0.16 * m.scale,
                halfHeight: 0.030 * m.scale,
                halfWidth: 0.025 * m.scale,
                isPredator: true,
                jawOpen: true,
              },
              'moray'
            );
            if (m.cleanState === 'beingCleaned') {
              m.cleanTimer -= dt;
            }
            if (!poseOk || m.cleanTimer <= 0 || m.cleanApproachTimer > 14.0) {
              cleaningSystem.releaseStation(m.clientKey);
              m.cleanState = 'none';
              m.cleanTarget = null;
              m.cleanApproachTimer = 0;
              m.cleanCooldown = 22.0;
              m.postCleanGrace = 2.0;
              m.predEntry.radius = 0;
              m.predEntry.isActiveHunter = false;
            }
          } else {
            m.predEntry.radius = m.postCleanGrace > 0 ? 0 : 0.95;
            m.predEntry.isActiveHunter = false;
            m.predEntry.vel.set(0, 0, 0);
          }
        } else {
          const patrolA = elapsedTime * 0.22 + m.phase;
          const tx = 2.4 * Math.sin((Math.cos(patrolA) * 6.0) * 0.19) + Math.sin(patrolA * 1.7) * 1.4;
          const tz = Math.cos(patrolA) * 6.5;
          const rawFloor = readSubstrateHeight(tx, tz);
          vAvoidTarget.set(tx, Math.min(surfaceLimitY - 0.5, rawFloor + 0.22), tz);
          avoidBommiesXZ(vAvoidTarget, null, bommyList, 0.45, dt);
          const tMinY = Math.min(surfaceLimitY - 0.5, readSubstrateHeight(vAvoidTarget.x, vAvoidTarget.z) + 0.22);
          vAvoidTarget.y = THREE.MathUtils.clamp(vAvoidTarget.y, tMinY, Math.max(tMinY, surfaceLimitY - 0.5));

          vDiff.subVectors(vAvoidTarget, m.pos);
          if (hasObserver) {
            vObsDiff.subVectors(m.pos, obsPos);
            const obsDist = vObsDiff.length();
            if (obsDist > 1e-4 && obsDist < 2.4) {
              const push = ((2.4 - obsDist) / 2.4) * 1.4;
              vDiff.x += (vObsDiff.x / obsDist) * push;
              vDiff.z += (vObsDiff.z / obsDist) * push;
            }
          }
          if (vDiff.lengthSq() > 1e-6) {
            safeNormalize(vDir.copy(vDiff), m.heading.x, m.heading.y, m.heading.z).multiplyScalar(0.56);
            m.vel.lerp(vDir, Math.min(1, dt * 3.0));
          }

          const sp = m.vel.length();
          if (sp < 1e-5) m.vel.copy(m.heading).multiplyScalar(0.45);
          else m.vel.multiplyScalar(THREE.MathUtils.clamp(sp, 0.34, 0.68) / sp);

          sampleFlowField(m.pos.x, m.pos.y, m.pos.z, elapsedTime, activeEnv, bommyList, vFlow);
          m.pos.addScaledVector(m.vel, dt);
          m.pos.addScaledVector(vFlow, dt * 0.18);
          avoidBommiesXZ(m.pos, m.vel, bommyList, 0.28, dt);

          const floorMin = readSubstrateHeight(m.pos.x, m.pos.z) + 0.16;
          const minY = Math.min(surfaceLimitY - 0.4, floorMin);
          m.pos.y = THREE.MathUtils.clamp(m.pos.y, minY, Math.max(minY, surfaceLimitY - 0.4));

          safeNormalize(m.heading.copy(m.vel), 0, 0, 1);

          // Update follow-the-leader ring buffer strictly when head moves forward
          if (m.trail && m.prevHeadPos) {
            const stepDist = m.prevHeadPos.distanceTo(m.pos);
            if (stepDist > 1e-5) {
              m.totalArc += stepDist;
              m.prevHeadPos.copy(m.pos);
              if (m.totalArc - m.lastSampleArc >= 0.045) {
                vRight.crossVectors(worldUp, m.heading);
                safeNormalize(vRight, 1, 0, 0);
                m.trailHead = (m.trailHead + 1) % MORAY_TRAIL_LEN;
                const slot = m.trail[m.trailHead];
                slot.x = m.pos.x;
                slot.y = m.pos.y;
                slot.z = m.pos.z;
                slot.rx = vRight.x;
                slot.ry = vRight.y;
                slot.rz = vRight.z;
                slot.arc = m.totalArc;
                m.lastSampleArc = m.totalArc;
              }
            }
          }

          m.predEntry.radius = 1.85;
          m.predEntry.isActiveHunter = true;
          m.predEntry.vel.copy(m.vel);
        }
        m.predEntry.pos.copy(m.pos);

        vFwd.copy(m.vel);
        safeNormalize(vFwd, m.heading.x, m.heading.y, m.heading.z);
        vRight.crossVectors(worldUp, vFwd);
        safeNormalize(vRight, 1, 0, 0);
        vUp.crossVectors(vFwd, vRight);
        safeNormalize(vUp, 0, 1, 0);

        // Head matrix (calmer when soliciting cleaning)
        const headSway = Math.sin(elapsedTime * 3.6 + m.phase) * 0.08 * (1.0 - 0.75 * m.cleanBlend);
        mRot.makeBasis(vRight, vUp, vFwd);
        mLocal.makeRotationY(headSway);
        mRot.multiply(mLocal);
        qRot.setFromRotationMatrix(mRot);
        dummy.position.copy(m.pos);
        dummy.quaternion.copy(qRot);
        dummy.scale.setScalar(m.scale);
        dummy.updateMatrix();
        morayHeadMesh.setMatrixAt(i, dummy.matrix);

        // Articulated lower jaw: calm open gape when soliciting cleaning, gentle breathing snap otherwise
        const normalJaw = 0.14 + Math.max(0, Math.sin(elapsedTime * 1.9 + m.phase)) * 0.28;
        const solicitJaw = 0.36 + Math.sin(elapsedTime * 1.1 + m.phase) * 0.04;
        const jawOpen = THREE.MathUtils.lerp(normalJaw, solicitJaw, m.cleanBlend);
        mLocal.makeRotationX(jawOpen);
        mRot.multiply(mLocal);
        qRot.setFromRotationMatrix(mRot);
        dummy.quaternion.copy(qRot);
        dummy.updateMatrix();
        morayJawMesh.setMatrixAt(i, dummy.matrix);

        // 18 overlapping compressed ribbon body segments undulating in continuous S-wave
        let prevX = m.pos.x;
        let prevY = m.pos.y;
        let prevZ = m.pos.z;
        for (let s = 0; s < MORAY_SEGS; s++) {
          const frac = (s + 1) / MORAY_SEGS;
          const waveAmp = (0.04 + frac * 0.13) * MORAY_SCALE * m.scale * (m.isCrevice ? 0.45 : 1.0);
          const waveOffset = Math.sin(elapsedTime * 4.2 + m.phase - s * 0.50) * waveAmp;
          const distBack = (s + 0.62) * 0.066 * MORAY_SCALE * m.scale;

          if (!m.isCrevice && m.trail) {
            const targetArc = m.totalArc - distBack;
            const headSlot = m.trail[m.trailHead];
            if (targetArc >= headSlot.arc && m.totalArc > headSlot.arc + 1e-6) {
              const u = THREE.MathUtils.clamp((targetArc - headSlot.arc) / (m.totalArc - headSlot.arc), 0, 1);
              vSegRight.set(
                THREE.MathUtils.lerp(headSlot.rx, vRight.x, u),
                THREE.MathUtils.lerp(headSlot.ry, vRight.y, u),
                THREE.MathUtils.lerp(headSlot.rz, vRight.z, u)
              );
              safeNormalize(vSegRight, vRight.x, vRight.y, vRight.z);
              segPos.set(
                THREE.MathUtils.lerp(headSlot.x, m.pos.x, u) + vSegRight.x * waveOffset,
                THREE.MathUtils.lerp(headSlot.y, m.pos.y, u) + vSegRight.y * waveOffset,
                THREE.MathUtils.lerp(headSlot.z, m.pos.z, u) + vSegRight.z * waveOffset
              );
            } else {
              let found = false;
              for (let k = 0; k < MORAY_TRAIL_LEN - 1; k++) {
                const idxB = (m.trailHead - k + MORAY_TRAIL_LEN * 2) % MORAY_TRAIL_LEN;
                const idxA = (m.trailHead - k - 1 + MORAY_TRAIL_LEN * 2) % MORAY_TRAIL_LEN;
                const b = m.trail[idxB];
                const a = m.trail[idxA];
                if (a.arc <= targetArc && targetArc <= b.arc) {
                  const denom = b.arc - a.arc;
                  const u = denom > 1e-6 ? THREE.MathUtils.clamp((targetArc - a.arc) / denom, 0, 1) : 1;
                  vSegRight.set(
                    THREE.MathUtils.lerp(a.rx, b.rx, u),
                    THREE.MathUtils.lerp(a.ry, b.ry, u),
                    THREE.MathUtils.lerp(a.rz, b.rz, u)
                  );
                  safeNormalize(vSegRight, vRight.x, vRight.y, vRight.z);
                  segPos.set(
                    THREE.MathUtils.lerp(a.x, b.x, u) + vSegRight.x * waveOffset,
                    THREE.MathUtils.lerp(a.y, b.y, u) + vSegRight.y * waveOffset,
                    THREE.MathUtils.lerp(a.z, b.z, u) + vSegRight.z * waveOffset
                  );
                  found = true;
                  break;
                }
              }
              if (!found) {
                const oldest = m.trail[(m.trailHead + 1) % MORAY_TRAIL_LEN];
                segPos.set(
                  oldest.x + oldest.rx * waveOffset,
                  oldest.y + oldest.ry * waveOffset,
                  oldest.z + oldest.rz * waveOffset
                );
              }
            }
            avoidBommiesXZ(segPos, null, bommyList, 0.12, dt);
            segPos.y = Math.max(
              segPos.y,
              readSubstrateHeight(segPos.x, segPos.z) + 0.09 * MORAY_SCALE * m.scale
            );
          } else {
            segPos.set(
              m.pos.x - vFwd.x * distBack + vRight.x * waveOffset,
              Math.max(
                readSeabedHeight(m.pos.x - vFwd.x * distBack, m.pos.z - vFwd.z * distBack) + 0.09 * MORAY_SCALE * m.scale,
                m.pos.y - vFwd.y * distBack * 0.5
              ),
              m.pos.z - vFwd.z * distBack + vRight.z * waveOffset
            );
          }

          vDiff.set(prevX - segPos.x, prevY - segPos.y, prevZ - segPos.z);
          safeNormalize(vDiff, vFwd.x, vFwd.y, vFwd.z);
          vSegRight.crossVectors(worldUp, vDiff);
          safeNormalize(vSegRight, 1, 0, 0);
          vSegUp.crossVectors(vDiff, vSegRight);
          safeNormalize(vSegUp, 0, 1, 0);
          mRot.makeBasis(vSegRight, vSegUp, vDiff);
          qRot.setFromRotationMatrix(mRot);

          const taper = 1.0 - Math.pow(frac, 1.45) * 0.60;
          const latTaper = taper * (1.0 - frac * 0.42);
          const vertTaper = taper * (1.0 + frac * 0.14);
          dummy.position.copy(segPos);
          dummy.quaternion.copy(qRot);
          dummy.scale.set(latTaper * m.scale, vertTaper * m.scale, m.scale);
          dummy.updateMatrix();
          moraySegMesh.setMatrixAt(segIdx++, dummy.matrix);

          prevX = segPos.x;
          prevY = segPos.y;
          prevZ = segPos.z;
        }
      }
      morayHeadMesh.instanceMatrix.needsUpdate = true;
      morayJawMesh.instanceMatrix.needsUpdate = true;
      moraySegMesh.instanceMatrix.needsUpdate = true;
    }

    // 5. Bluespotted Ribbontail Rays (Taeniura lymma — zero-allocation gliding + wing wave)
    const nRay = activeCounts.taeniura;
    if (nRay > 0) {
      for (let i = 0; i < nRay; i++) {
        const r = rays[i];
        r.tParam += 0.16 * dt;
        const z = Math.sin(r.tParam) * 7.8 + 0.8;
        const canyonX = 2.4 * Math.sin(z * 0.19) + 1.1 * Math.cos(z * 0.08);
        const x = canyonX + Math.sin(r.tParam * 2.0 + i * 1.4) * 1.45;
        const floorY = readSubstrateHeight(x, z);
        vAvoidTarget.set(
          x,
          Math.min(surfaceLimitY - 0.4, floorY + 0.26 + Math.sin(elapsedTime * 1.2 + r.phase) * 0.09),
          z
        );
        avoidBommiesXZ(vAvoidTarget, null, bommyList, 0.48, dt);
        const tMinY = Math.min(surfaceLimitY - 0.4, readSubstrateHeight(vAvoidTarget.x, vAvoidTarget.z) + 0.24);
        vAvoidTarget.y = THREE.MathUtils.clamp(
          vAvoidTarget.y,
          tMinY,
          Math.max(tMinY, surfaceLimitY - 0.4)
        );

        vDiff.subVectors(vAvoidTarget, r.pos);
        if (hasObserver) {
          vObsDiff.subVectors(r.pos, obsPos);
          const obsDist = vObsDiff.length();
          if (obsDist > 1e-4 && obsDist < 1.10) {
            const push = ((1.10 - obsDist) / 1.10) * 0.75;
            vDiff.x += (vObsDiff.x / obsDist) * push;
            vDiff.z += (vObsDiff.z / obsDist) * push;
          }
        }
        if (vDiff.lengthSq() > 1e-6) {
          safeNormalize(vDir.copy(vDiff), r.heading.x, r.heading.y, r.heading.z).multiplyScalar(0.72);
          r.vel.lerp(vDir, Math.min(1, dt * 2.5));
        }

        sampleFlowField(r.pos.x, r.pos.y, r.pos.z, elapsedTime, activeEnv, bommyList, vFlow);
        r.pos.addScaledVector(r.vel, dt);
        r.pos.addScaledVector(vFlow, dt * 0.22);
        avoidBommiesXZ(r.pos, r.vel, bommyList, 0.36, dt);

        const rayMinY = Math.min(surfaceLimitY - 0.35, readSubstrateHeight(r.pos.x, r.pos.z) + 0.20);
        r.pos.y = THREE.MathUtils.clamp(r.pos.y, rayMinY, Math.max(rayMinY, surfaceLimitY - 0.35));

        safeNormalize(r.heading.copy(r.vel), 0, 0, 1);
        vFwd.copy(r.heading);
        vRight.crossVectors(worldUp, vFwd);
        safeNormalize(vRight, 1, 0, 0);
        vUp.crossVectors(vFwd, vRight);
        safeNormalize(vUp, 0, 1, 0);

        mRot.makeBasis(vRight, vUp, vFwd);
        qRot.setFromRotationMatrix(mRot);
        dummy.position.copy(r.pos);
        dummy.quaternion.copy(qRot);
        dummy.scale.setScalar(r.scale);
        dummy.updateMatrix();
        rayCenterMesh.setMatrixAt(i, dummy.matrix);

        // Undulating pectoral wing strips (zero per-frame allocations)
        const wingSpeed = 4.4 + vFlow.length() * 1.6;
        for (let s = 0; s < 3; s++) {
          const wave = Math.sin(elapsedTime * wingSpeed + r.phase - s * 0.95) * 0.24;
          const zOff = wingZOffsets[s] * r.scale;
          vStripPos.copy(r.pos).addScaledVector(vFwd, zOff);

          // Left wing rolls opposite sign in Z relative to right wing
          mLocal.makeRotationZ(wave);
          mWing.multiplyMatrices(mRot, mLocal);
          qRot.setFromRotationMatrix(mWing);
          dummy.position.copy(vStripPos);
          dummy.quaternion.copy(qRot);
          dummy.scale.setScalar(r.scale);
          dummy.updateMatrix();
          wingMeshes.left[s].setMatrixAt(i, dummy.matrix);

          mLocal.makeRotationZ(-wave);
          mWing.multiplyMatrices(mRot, mLocal);
          qRot.setFromRotationMatrix(mWing);
          dummy.position.copy(vStripPos);
          dummy.quaternion.copy(qRot);
          dummy.updateMatrix();
          wingMeshes.right[s].setMatrixAt(i, dummy.matrix);
        }
      }
      rayCenterMesh.instanceMatrix.needsUpdate = true;
      for (let s = 0; s < 3; s++) {
        wingMeshes.left[s].instanceMatrix.needsUpdate = true;
        wingMeshes.right[s].instanceMatrix.needsUpdate = true;
      }
    }

    // 6. Red Sea Sand Lizardfish (Sit-and-Wait Ambush State Machine — zero runtime raycasts)
    const nLizard = activeCounts.lizardfish;
    if (nLizard > 0) {
      for (let i = 0; i < nLizard; i++) {
        const lz = lizards[i];
        let pitchOffset = -0.21;
        let bodyYaw = 0;
        let tailYaw = 0;
        let swimPhase = elapsedTime * 3.0 + lz.phase;
        let bodySwimAmp = 0.0006;
        let finSwimAmp = 0.0026;

        if (lz.state === 'perched') {
          lz.waitTimer -= dt;
          lz.vel.set(0, 0, 0);
          lz.pos.y = readSubstrateHeight(lz.pos.x, lz.pos.z) + 0.035 * lz.scale;
          lz.predEntry.radius = 0;
          lz.predEntry.isActiveHunter = false;
          lz.predEntry.vel.set(0, 0, 0);
          pitchOffset = -0.21;

          if (lz.waitTimer < 0.45) {
            bodyYaw = Math.sin(elapsedTime * 24.0 + lz.phase) * 0.06;
          }
          tailYaw = Math.sin(elapsedTime * 2.4 + lz.phase) * 0.035;

          if (lz.waitTimer <= 0) {
            let chosenPatch = null;
            if (validSandPatches.length > 0) {
              lizardCandidates.length = 0;
              for (let p = 0; p < validSandPatches.length; p++) {
                const cand = validSandPatches[p];
                const d2d = Math.hypot(cand.x - lz.pos.x, cand.z - lz.pos.z);
                if (d2d < 0.55 || d2d > 2.45) continue;
                let peerClear = true;
                for (let j = 0; j < nLizard; j++) {
                  if (j === i) continue;
                  const lp = lizards[j].pos;
                  if (Math.hypot(cand.x - lp.x, cand.z - lp.z) < 1.1) {
                    peerClear = false;
                    break;
                  }
                }
                if (peerClear) {
                  lizardCandidates.push(cand);
                }
              }
              if (lizardCandidates.length > 0) {
                chosenPatch = lizardCandidates[Math.floor(lizardRng() * lizardCandidates.length)];
              }
            }

            if (chosenPatch) {
              lz.state = 'ambush';
              lz.strikeElapsed = 0;
              lz.strikeDuration = 0.48 + lizardRng() * 0.14;
              lz.startPos.copy(lz.pos);
              lz.targetPos.set(
                chosenPatch.x,
                readSubstrateHeight(chosenPatch.x, chosenPatch.z) + 0.035 * lz.scale,
                chosenPatch.z
              );
              lz.apexHeight = 0.30 + lizardRng() * 0.20;
              vDir.set(chosenPatch.x - lz.pos.x, 0, chosenPatch.z - lz.pos.z);
              safeNormalize(vDir, lz.heading.x, 0, lz.heading.z);
              lz.heading.copy(vDir);
            } else {
              lz.waitTimer = 4.5 + lizardRng() * 4.8;
            }
          }
        } else {
          lz.strikeElapsed += dt;
          const u = Math.min(1, lz.strikeElapsed / lz.strikeDuration);
          const uFast = Math.pow(u, 0.72);
          const s = uFast * uFast * (3 - 2 * uFast);
          const nx = THREE.MathUtils.lerp(lz.startPos.x, lz.targetPos.x, s);
          const nz = THREE.MathUtils.lerp(lz.startPos.z, lz.targetPos.z, s);
          const baseY = readSubstrateHeight(nx, nz) + 0.035 * lz.scale;
          const arcY = Math.sin(Math.pow(u, 0.75) * Math.PI) * lz.apexHeight;
          const ny = Math.min(surfaceLimitY - 0.25, baseY + arcY);

          const prevX = lz.pos.x;
          const prevY = lz.pos.y;
          const prevZ = lz.pos.z;
          lz.pos.set(nx, ny, nz);
          avoidBommiesXZ(lz.pos, null, bommyList, 0.20, dt);
          lz.pos.y = Math.max(lz.pos.y, readSubstrateHeight(lz.pos.x, lz.pos.z) + 0.035 * lz.scale);
          lz.vel.set((lz.pos.x - prevX) / dt, (lz.pos.y - prevY) / dt, (lz.pos.z - prevZ) / dt);
          lz.predEntry.radius = 2.25;
          lz.predEntry.isActiveHunter = true;
          lz.predEntry.vel.copy(lz.vel);

          if (u < 0.55) {
            const k = u / 0.55;
            const ks = k * k * (3 - 2 * k);
            pitchOffset = THREE.MathUtils.lerp(-0.42, 0.08, ks);
          } else {
            const k = (u - 0.55) / 0.45;
            const ks = k * k * (3 - 2 * k);
            pitchOffset = THREE.MathUtils.lerp(0.08, -0.21, ks);
          }

          tailYaw = Math.sin(elapsedTime * 32.0 + lz.phase) * 0.38 * (1 - u * 0.5);
          bodyYaw = Math.sin(elapsedTime * 32.0 + lz.phase - 0.6) * 0.06 * (1 - u * 0.5);

          const strikeRamp = Math.min(1, u / 0.12);
          swimPhase = elapsedTime * 32.0 + lz.phase;
          bodySwimAmp = THREE.MathUtils.lerp(0.0006, 0.011, strikeRamp);
          finSwimAmp = THREE.MathUtils.lerp(0.0026, 0.006, strikeRamp);

          if (u >= 1) {
            lz.state = 'perched';
            lz.pos.copy(lz.targetPos);
            avoidBommiesXZ(lz.pos, null, bommyList, 0.22, dt);
            lz.pos.y = readSubstrateHeight(lz.pos.x, lz.pos.z) + 0.035 * lz.scale;
            lz.vel.set(0, 0, 0);
            lz.predEntry.radius = 0;
            lz.predEntry.isActiveHunter = false;
            lz.predEntry.vel.set(0, 0, 0);
            lz.waitTimer = 4.5 + lizardRng() * 4.8;
            pitchOffset = -0.21;
            tailYaw = 0;
            bodyYaw = 0;
            bodySwimAmp = 0.0006;
            finSwimAmp = 0.0026;
          }
        }

        lz.predEntry.pos.copy(lz.pos);

        const { bodyMatrix, tailMatrix } = orientFishMatrix(
          lz.pos,
          lz.heading,
          lz.scale,
          bodyYaw,
          tailYaw,
          pitchOffset,
          lizardMeshes.tailPivotZ,
          scratch,
          0
        );
        lizardMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
        lizardMeshes.tailMesh.setMatrixAt(i, tailMatrix);
        setSwimState(lizardMeshes.swimAttr, i, swimPhase, bodySwimAmp, finSwimAmp);
      }
      lizardMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      lizardMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      lizardMeshes.swimAttr.needsUpdate = true;
    }

    // 7. Green Sea Turtles (Chelonia mydas — figure-8 hydrofoil wingbeats + glide + grazing + surfacing)
    const nTurtle = activeCounts.chelonia;
    if (nTurtle > 0) {
      for (let i = 0; i < nTurtle; i++) {
        const t = turtles[i];
        sampleFlowField(t.pos.x, t.pos.y, t.pos.z, elapsedTime, activeEnv, bommyList, vFlow);

        t.breathCooldown -= dt;
        t.grazeCooldown -= dt;
        t.cleanCooldown -= dt;

        if (t.mode === 'cruise') {
          if (t.breathCooldown <= 0) {
            t.mode = 'breathe';
            t.breathHold = 2.6;
          } else if (t.cleanCooldown <= 0 && cleaningSystem) {
            const claim = cleaningSystem.tryAcquireStation(t.clientKey, t.pos, 4.6);
            if (claim) {
              t.mode = 'clean';
              t.cleanState = 'approaching';
              t.cleanTarget = claim;
              t.cleanTimer = 5.4;
              t.cleanApproachTimer = 0;
            }
          } else if (t.grazeCooldown <= 0) {
            t.mode = 'graze';
            t.grazeTimer = 5.2;
          }
        } else if (t.mode === 'breathe') {
          if (t.pos.y >= surfaceLimitY - 0.22) {
            t.breathHold -= dt;
            if (t.breathHold <= 0) {
              t.mode = 'cruise';
              t.breathCooldown = 28 + (i % 3) * 6.5;
            }
          }
        } else if (t.mode === 'graze') {
          t.grazeTimer -= dt;
          if (t.grazeTimer <= 0) {
            t.mode = 'cruise';
            t.grazeCooldown = 19 + (i % 3) * 5.0;
          }
        }

        if (t.mode === 'clean' && t.cleanTarget && cleaningSystem) {
          const hover = t.cleanTarget.hoverPos;
          const hoverFloor = readSubstrateHeight(hover.x, hover.z);
          const targetY = Math.min(
            surfaceLimitY - 0.18,
            Math.max(hoverFloor + 0.44 * t.scale, hover.y)
          );
          _tTarget.set(hover.x, targetY, hover.z);
          const distToHover = _tTarget.distanceTo(t.pos);
          if (t.cleanState === 'approaching') {
            t.cleanApproachTimer += dt;
            if (distToHover <= 0.44) t.cleanState = 'beingCleaned';
          } else {
            t.cleanTimer -= dt;
            if (distToHover > 0.72) t.cleanState = 'approaching';
          }
          const poseOk = cleaningSystem.updateClientPose(
            t.clientKey,
            t.pos,
            t.heading,
            {
              halfLen: 0.44 * t.scale,
              halfHeight: 0.14 * t.scale,
              halfWidth: 0.32 * t.scale,
              isPredator: false,
              jawOpen: false,
            },
            'chelonia'
          );
          if (!poseOk || t.cleanTimer <= 0 || t.cleanApproachTimer > 15.0) {
            cleaningSystem.releaseStation(t.clientKey);
            t.mode = 'cruise';
            t.cleanState = 'none';
            t.cleanTarget = null;
            t.cleanCooldown = 24 + (i % 3) * 7.5;
          }
        } else {
          if (t.mode === 'clean') {
            t.mode = 'cruise';
            t.cleanState = 'none';
            t.cleanTarget = null;
          }
          // Elliptic figure-8 reef canyon & drop-off patrol path
          t.orbitParam += dt * 0.088 * t.orbitDir * (t.mode === 'graze' ? 0.28 : 1.0);
          const targetX = t.centerX + Math.sin(t.orbitParam) * t.radiusX + Math.sin(t.orbitParam * 2.0) * 1.1;
          const targetZ = t.centerZ + Math.cos(t.orbitParam) * t.radiusZ;
          const floorAtTarget = readSubstrateHeight(targetX, targetZ);
          let targetY = Math.max(t.baseAlt, floorAtTarget + 0.85);
          if (t.mode === 'breathe') {
            targetY = surfaceLimitY - 0.14;
          } else if (t.mode === 'graze') {
            targetY = floorAtTarget + 0.36 * t.scale;
          } else {
            targetY += Math.sin(elapsedTime * 0.25 + t.phase) * 0.22;
          }
          targetY = Math.min(surfaceLimitY - 0.12, targetY);

          _tTarget.set(targetX, targetY, targetZ);
        }
        _tSteer.subVectors(_tTarget, t.pos);
        const distToTarget = _tSteer.length();
        if (distToTarget > 1e-4) {
          _tSteer.multiplyScalar(1 / distToTarget);
        } else {
          _tSteer.copy(t.heading);
        }

        // Keep wide clearance over tall coral colonies
        for (let c = 0; c < coralList.length; c++) {
          const ch = coralList[c];
          const dx = t.pos.x - ch.x;
          const dz = t.pos.z - ch.z;
          const clr = (ch.radius || 0.4) + 0.42 * t.scale;
          if (dx * dx + dz * dz < clr * clr && t.pos.y < (ch.topY || 1.2) + 0.36) {
            _tSteer.y = Math.max(_tSteer.y, 0.48);
          }
        }

        // Gentle separation from diver without erratic darting
        if (hasObserver) {
          vObsDiff.subVectors(t.pos, obsPos);
          const obsDist = vObsDiff.length();
          if (obsDist < 1.15 && obsDist > 1e-4) {
            const away = (1.15 - obsDist) / 1.15;
            _tSteer.addScaledVector(vObsDiff, (away * 0.65) / obsDist);
          }
        }

        safeNormalize(_tSteer, t.heading.x, t.heading.y, t.heading.z);
        const turnDot = THREE.MathUtils.clamp(t.heading.x * _tSteer.z - t.heading.z * _tSteer.x, -1, 1);

        const targetSpeed =
          t.mode === 'clean'
            ? t.cleanState === 'beingCleaned'
              ? 0.09
              : 0.44
            : t.mode === 'graze'
              ? 0.17
              : t.mode === 'breathe'
                ? 0.56
                : 0.46;
        t.vel.lerp(_tSteer.multiplyScalar(targetSpeed), Math.min(1, dt * 1.65));
        t.vel.addScaledVector(vFlow, 0.22 * dt);
        t.pos.addScaledVector(t.vel, dt);

        avoidBommiesXZ(t.pos, t.vel, bommyList, 0.56 * t.scale, dt);
        const minSubY = readSubstrateHeight(t.pos.x, t.pos.z) + 0.32 * t.scale;
        if (t.pos.y < minSubY) {
          t.pos.y = minSubY;
          if (t.vel.y < 0) t.vel.y = 0;
        }
        if (t.pos.y > surfaceLimitY - 0.08) {
          t.pos.y = surfaceLimitY - 0.08;
          if (t.vel.y > 0) t.vel.y *= 0.25;
        }

        safeNormalize(vDir.copy(t.vel), t.heading.x, t.heading.y, t.heading.z);
        t.heading.lerp(vDir, Math.min(1, dt * 3.4));
        safeNormalize(t.heading, 0, 0, 1);

        // Compute smooth body basis with gentle bank during turns
        t.roll = THREE.MathUtils.lerp(t.roll, THREE.MathUtils.clamp(turnDot * 0.42, -0.26, 0.26), Math.min(1, dt * 3.2));
        vRight.crossVectors(worldUp, t.heading);
        safeNormalize(vRight, 1, 0, 0);
        vUp.crossVectors(t.heading, vRight);
        safeNormalize(vUp, 0, 1, 0);
        mRot.makeBasis(vRight, vUp, t.heading);
        mLocal.makeRotationZ(t.roll);
        mRot.multiply(mLocal);
        qRot.setFromRotationMatrix(mRot);

        dummy.position.copy(t.pos);
        dummy.quaternion.copy(qRot);
        dummy.scale.setScalar(t.scale);
        dummy.updateMatrix();
        turtleBodyMesh.setMatrixAt(i, dummy.matrix);

        // Alternate slow rhythmic power strokes with extended serene dihedral glides
        const strokeRate = t.mode === 'graze' ? 0.55 : t.mode === 'breathe' ? 1.55 : 1.05;
        t.flapClock += dt * strokeRate;
        const cycle = t.flapClock % 8.5;
        const isGliding = cycle > 5.6 && t.mode !== 'breathe';
        t.glideBlend += ((isGliding ? 1.0 : 0.0) - t.glideBlend) * Math.min(1, dt * 2.8);

        const phi = t.flapClock * 2.4 + t.phase;
        const powerFlapY = Math.sin(phi) * 0.46 + 0.04;
        const powerSweepZ = -Math.cos(phi) * 0.24;
        const powerTwistX = -Math.cos(phi) * 0.36;

        const g = t.glideBlend;
        const flapAngle = THREE.MathUtils.lerp(powerFlapY, 0.11 + Math.sin(elapsedTime * 1.4 + t.phase) * 0.04, g);
        const sweepAngle = THREE.MathUtils.lerp(powerSweepZ, -0.18, g);
        const twistAngle = THREE.MathUtils.lerp(powerTwistX, -0.05, g);

        _tScale.setScalar(t.scale);

        // Left Fore-Flipper at shoulder socket (-0.21, -0.025, +0.20)
        _tShoulderLPos.set(-0.21 * t.scale, -0.025 * t.scale, 0.20 * t.scale).applyQuaternion(qRot).add(t.pos);
        _tEuler.set(twistAngle, sweepAngle, -flapAngle, 'ZYX');
        _tWingQuat.setFromEuler(_tEuler);
        _tWorldQuat.multiplyQuaternions(qRot, _tWingQuat);
        mWing.compose(_tShoulderLPos, _tWorldQuat, _tScale);
        turtleLeftFlipperMesh.setMatrixAt(i, mWing);

        // Right Fore-Flipper at shoulder socket (+0.21, -0.025, +0.20)
        _tShoulderRPos.set(0.21 * t.scale, -0.025 * t.scale, 0.20 * t.scale).applyQuaternion(qRot).add(t.pos);
        _tEuler.set(twistAngle, -sweepAngle, flapAngle, 'ZYX');
        _tWingQuat.setFromEuler(_tEuler);
        _tWorldQuat.multiplyQuaternions(qRot, _tWingQuat);
        mWing.compose(_tShoulderRPos, _tWorldQuat, _tScale);
        turtleRightFlipperMesh.setMatrixAt(i, mWing);

        // Hind Steering Flippers at hip socket (0, -0.032, -0.42)
        _tHindPos.set(0, -0.032 * t.scale, -0.42 * t.scale).applyQuaternion(qRot).add(t.pos);
        _tEuler.set(
          -0.06 + g * 0.05 + Math.sin(elapsedTime * 1.2 + t.phase) * 0.05,
          -turnDot * 0.35,
          t.roll * 0.35,
          'YXZ'
        );
        _tWingQuat.setFromEuler(_tEuler);
        _tWorldQuat.multiplyQuaternions(qRot, _tWingQuat);
        mWing.compose(_tHindPos, _tWorldQuat, _tScale);
        turtleHindMesh.setMatrixAt(i, mWing);
      }
      turtleBodyMesh.instanceMatrix.needsUpdate = true;
      turtleLeftFlipperMesh.instanceMatrix.needsUpdate = true;
      turtleRightFlipperMesh.instanceMatrix.needsUpdate = true;
      turtleHindMesh.instanceMatrix.needsUpdate = true;
    }
  }

  update(0, 0.016, { diveDepth: 6.0 });

  return {
    group,
    pickableMeshes,
    predators,
    groupers,
    trevallies,
    lionfish,
    morays,
    rays,
    lizardfish: lizards,
    turtles,
    validSandPatches,
    applySpeciesCounts,
    getActiveCounts: () => ({ ...activeCounts }),
    update,
  };
}
