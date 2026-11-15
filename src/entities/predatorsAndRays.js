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
const MORAY_SCALE = 0.43;

function buildMorayPrototypes() {
  const S = MORAY_SCALE;
  const cHeadGround = new THREE.Color('#cbb9a8');
  const cHeadTaupe = new THREE.Color('#bfa998');
  const cBodyGround = new THREE.Color('#c8b6a4');
  const cThroat = new THREE.Color('#dfd3c6');
  const cMouthRim = new THREE.Color('#d59b88');
  const cVermicLight = new THREE.Color('#9c8058');
  const cVermicDark = new THREE.Color('#846946');
  const cNostril = new THREE.Color('#cbb9a8');
  const cIris = new THREE.Color('#f4f2ea');
  const cPupil = new THREE.Color('#0b0d11');
  const cPore = new THREE.Color('#12100f');

  function morayVermiculationColor(x, y, z, out, { isHead = false, isFin = false } = {}) {
    const warp = Math.sin(z * 58.0 + y * 52.0) * 0.0055 + Math.cos(x * 64.0 - z * 44.0) * 0.0035;
    const cell = cellularSpotMask(x + warp, y * 1.15, z - warp, 62.0, 0.82);

    if (isHead) {
      const headT = THREE.MathUtils.clamp((z - 0.02) / 0.11, 0, 1);
      out.copy(cHeadTaupe).lerp(cHeadGround, headT);
      if (y < -0.004) {
        const throatT = THREE.MathUtils.clamp((-y - 0.004) / 0.022, 0, 1);
        const groove = 0.5 + 0.5 * Math.sin(x * 290.0 + z * 24.0);
        out.lerp(cThroat, throatT * (0.68 + 0.24 * groove));
      }
      // Subtle fine mottling on rear head/neck transitioning toward body
      const rearFactor = THREE.MathUtils.clamp((0.055 - z) / 0.08, 0, 1);
      if (rearFactor > 0.02 && cell.edgeDist < 0.22) {
        const vMix = (1.0 - cell.edgeDist / 0.22) * rearFactor * 0.48;
        out.lerp(cell.cellHash > 0.45 ? cVermicLight : cVermicDark, vMix);
      }
      return;
    }

    if (isFin) {
      out.copy(cBodyGround).lerp(cHeadGround, 0.35);
      const heightFade = 1.0 - THREE.MathUtils.clamp((y - 0.048) / 0.045, 0, 0.72);
      if (cell.edgeDist < 0.20) {
        const vMix = (1.0 - cell.edgeDist / 0.20) * 0.30 * heightFade;
        out.lerp(cVermicLight, vMix);
      }
      return;
    }

    // Body segments: pale warm grey-beige ground with fine ochre-tan marbled vermiculations
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
      out.lerp(vermicCol, ridge * 0.62 * flankMask * flankBoost);
    }
  }

  const segCyl = new THREE.CylinderGeometry(0.044 * S, 0.048 * S, 0.106 * S, 20, 6);
  segCyl.rotateX(Math.PI * 0.5);
  segCyl.scale(0.82, 1.18, 1.0);
  const segGeom = prepareForMerge(segCyl, (x, y, z, _nx, _ny, _nz, out) => {
    morayVermiculationColor(x / S, y / S, z / S, out);
  });
  segCyl.dispose();

  // Continuous fleshy dorsal fin crest (paler grey-beige) merged on segment
  const fin = new THREE.BoxGeometry(0.009 * S, 0.056 * S, 0.110 * S, 1, 4, 6);
  fin.translate(0, 0.068 * S, 0);
  const finGeom = prepareForMerge(fin, (x, y, z, _nx, _ny, _nz, out) => {
    morayVermiculationColor(x / S, y / S, z / S, out, { isFin: true });
  });
  fin.dispose();
  const bodySegGeom = safeMerge([segGeom, finGeom]);

  // Exact surface X helper on the sculpted skull capsule (unscaled ref: R=0.046, L=0.10, scale 0.84x0.92x1, pos 0,0.015,0.05)
  function skullSurfaceX(y, z) {
    const dy = (y - 0.015) / 0.92;
    const dzCap = Math.max(0, Math.abs(z - 0.05) - 0.05);
    const inside = Math.max(0.00004, 0.046 * 0.046 - dy * dy - dzCap * dzCap);
    return 0.84 * Math.sqrt(inside);
  }

  // Iconic Gymnothorax griseus geometric jet-black sensory-pore dot rows (in unscaled ref coordinates)
  const headPoreDots = [];
  // 1. Supraorbital / Snout Arch (6 dots curving over eye)
  for (let k = 0; k < 6; k++) {
    const t = k / 5;
    const z = THREE.MathUtils.lerp(0.125, 0.068, t);
    const y = 0.032 + Math.sin(t * Math.PI) * 0.016 + t * 0.004;
    headPoreDots.push({ x: skullSurfaceX(y, z) + 0.0004, y, z });
  }
  // 2. Upper-Jaw (Infraorbital) Row (7 dots along upper lip/maxilla)
  for (let k = 0; k < 7; k++) {
    const t = k / 6;
    const z = THREE.MathUtils.lerp(0.128, 0.048, t);
    const y = THREE.MathUtils.lerp(0.018, 0.016, t);
    headPoreDots.push({ x: skullSurfaceX(y, z) + 0.0005, y, z });
  }
  // 4. Two Transverse Temple / Nape Dotted Arcs (6-7 dots each)
  for (const arcZBase of [0.042, 0.012]) {
    const arcCount = 7;
    for (let k = 0; k < arcCount; k++) {
      const t = k / (arcCount - 1);
      const y = THREE.MathUtils.lerp(0.050, -0.006, t);
      const z = arcZBase - Math.sin(t * Math.PI) * 0.005 + (t - 0.5) * 0.004;
      headPoreDots.push({ x: skullSurfaceX(y, z) + 0.0004, y, z });
    }
  }
  // + 3 anterior lateral-line pore dots extending behind the nape arcs
  for (const z of [-0.002, -0.018, -0.034]) {
    const y = 0.017;
    headPoreDots.push({ x: skullSurfaceX(y, z) + 0.0004, y, z });
  }

  // Sculpted upper head + snout + tubular nostrils + chalk-white iris + pinpoint pupil + pore rows
  const headParts = [];
  const skull = new THREE.CapsuleGeometry(0.046 * S, 0.10 * S, 14, 22);
  skull.rotateX(Math.PI * 0.5);
  skull.scale(0.84, 0.92, 1.0);
  skull.translate(0, 0.015 * S, 0.05 * S);
  headParts.push(
    prepareForMerge(skull, (x, y, z, _nx, _ny, _nz, out) => {
      const ux = x / S;
      const uy = y / S;
      const uz = z / S;
      morayVermiculationColor(ux, uy, uz, out, { isHead: true });
      // Subtle pinkish-flesh inner mouth rim along lower lateral-anterior lip
      if (uy < 0.009 && uz > 0.025 && Math.abs(ux) > 0.012) {
        const rimT = THREE.MathUtils.clamp((0.009 - uy) / 0.014, 0, 1) * THREE.MathUtils.clamp((uz - 0.025) / 0.045, 0, 1);
        out.lerp(cMouthRim, rimT * 0.65);
      }
      // Crisp dark pore spots painted into head surface under pore spheres
      const absX = Math.abs(ux);
      for (let p = 0; p < headPoreDots.length; p++) {
        const pd = headPoreDots[p];
        const d = Math.hypot(absX - pd.x, uy - pd.y, uz - pd.z);
        if (d < 0.0045) {
          out.lerp(cPore, 1.0 - d / 0.0045);
        }
      }
    })
  );
  skull.dispose();

  for (const side of [-1, 1]) {
    // Raised tubular anterior nostrils on snout
    const nostril = new THREE.CylinderGeometry(0.0034 * S, 0.0046 * S, 0.016 * S, 8);
    nostril.rotateX(0.45);
    nostril.rotateZ(side * -0.25);
    nostril.translate(side * 0.013 * S, 0.032 * S, 0.130 * S);
    headParts.push(prepareForMerge(nostril, cNostril));
    nostril.dispose();

    // Signature stark chalk-white iris + pinpoint jet-black pupil
    const iris = new THREE.SphereGeometry(0.009 * S, 12, 10);
    iris.scale(0.55, 1.0, 1.0);
    iris.translate(side * 0.0328 * S, 0.035 * S, 0.090 * S);
    headParts.push(prepareForMerge(iris, cIris));
    iris.dispose();

    const pupil = new THREE.SphereGeometry(0.0036 * S, 8, 6);
    pupil.scale(0.68, 1.0, 1.0);
    pupil.translate(side * 0.0358 * S, 0.035 * S, 0.090 * S);
    headParts.push(prepareForMerge(pupil, cPupil));
    pupil.dispose();

    // Sculpted jet-black sensory-pore dot spheres along head geometric rows
    for (let p = 0; p < headPoreDots.length; p++) {
      const pd = headPoreDots[p];
      const dot = new THREE.SphereGeometry(0.0020 * S, 6, 5);
      dot.translate(side * pd.x * S, pd.y * S, pd.z * S);
      headParts.push(prepareForMerge(dot, cPore));
      dot.dispose();
    }
  }

  const headGeom = safeMerge(headParts);

  // Articulated lower jaw with mandibular sensory-pore dot row + pinkish mouth rim + creamy throat
  const jawPoreDots = [];
  for (let k = 0; k < 7; k++) {
    const t = k / 6;
    const z = THREE.MathUtils.lerp(0.120, 0.035, t);
    const y = THREE.MathUtils.lerp(-0.010, -0.012, t);
    const halfW = THREE.MathUtils.lerp(0.021, 0.027, t);
    jawPoreDots.push({ x: halfW, y, z });
  }

  const jawParts = [];
  const jaw = new THREE.BoxGeometry(0.052 * S, 0.022 * S, 0.126 * S, 4, 3, 10);
  const jawPos = jaw.attributes.position;
  for (let i = 0; i < jawPos.count; i++) {
    let x = jawPos.getX(i);
    const y = jawPos.getY(i);
    const z = jawPos.getZ(i) + 0.062 * S; // spans z = -0.001*S .. +0.125*S
    const snoutT = THREE.MathUtils.clamp((z / S - 0.02) / 0.105, 0, 1);
    const widthScale = 1.04 - 0.24 * snoutT * snoutT;
    x *= widthScale;
    jawPos.setXYZ(i, x, y - 0.012 * S, z);
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
        out.lerp(cMouthRim, rimT * 0.72);
      }
      if (uy < -0.014) {
        const groove = 0.5 + 0.5 * Math.sin(ux * 300.0 + uz * 22.0);
        out.lerp(cThroat, 0.55 + 0.35 * groove);
      }
      const absX = Math.abs(ux);
      for (let p = 0; p < jawPoreDots.length; p++) {
        const pd = jawPoreDots[p];
        const d = Math.hypot(absX - pd.x, uy - pd.y, uz - pd.z);
        if (d < 0.0045) {
          out.lerp(cPore, 1.0 - d / 0.0045);
        }
      }
    })
  );
  jaw.dispose();

  for (const side of [-1, 1]) {
    for (let p = 0; p < jawPoreDots.length; p++) {
      const pd = jawPoreDots[p];
      const dot = new THREE.SphereGeometry(0.0020 * S, 6, 5);
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
  const S = 0.50;
  const discRadiusX = 0.34 * S;
  const discRadiusZ = 0.39 * S;
  const coreRadiusX = 0.215 * S;

  const cDisc = new THREE.Color('#a69154');
  const cMargin = new THREE.Color('#ccb67a');
  const cBelly = new THREE.Color('#f2eee2');
  const cSpotOuter = new THREE.Color('#0d74f5');
  const cSpotInner = new THREE.Color('#2994ff');
  const cSpotEdge = new THREE.Color('#7b6938');
  const cEyeTop = new THREE.Color('#df9d26');
  const cEyeBase = new THREE.Color('#c88719');
  const cEyeAmberRim = new THREE.Color('#8f5911');
  const cPupil = new THREE.Color('#1a140c');
  const cSpiracleLip = new THREE.Color('#bba260');
  const cSpiracleDeep = new THREE.Color('#18120a');
  const cTailStripe = new THREE.Color('#0f7af5');
  const cFinfoldMid = new THREE.Color('#54adff');
  const cFinfoldTip = new THREE.Color('#d8eeff');

  function rayOcelliColor(x, y, zDisc, out) {
    if (y < -0.004 * S) {
      out.copy(cBelly);
      return;
    }

    const edgeFrac = Math.hypot(x / discRadiusX, zDisc / discRadiusZ);
    out.copy(cDisc);
    if (edgeFrac > 0.84) {
      const rimT = THREE.MathUtils.clamp((edgeFrac - 0.84) / 0.16, 0, 1);
      out.lerp(cMargin, rimT);
    }

    // Leave outermost buff-gold rim (edgeFrac > 0.93) spotless
    if (edgeFrac > 0.93) {
      return;
    }

    // Inner/mid disc (edgeFrac < 0.72): prominent electric-blue spots (doubled spatial freq 17.5 -> 35.0)
    let spotStrength = 0;
    let spotCoreFrac = 0;
    let edgeShade = 0;

    if (edgeFrac < 0.75) {
      const coarseFade = edgeFrac > 0.67 ? 1.0 - (edgeFrac - 0.67) / 0.08 : 1.0;
      const cellCoarse = cellularSpotMask(x * 1.06, 0, zDisc * 0.92, 35.0, 0.58);
      const rCoarse = (0.20 + cellCoarse.cellHash * 0.045) * (0.72 + 0.28 * coarseFade);
      if (cellCoarse.dist < rCoarse) {
        spotStrength = coarseFade;
        spotCoreFrac = 1.0 - cellCoarse.dist / rCoarse;
      } else if (cellCoarse.dist < rCoarse + 0.042) {
        edgeShade = Math.max(edgeShade, (1.0 - (cellCoarse.dist - rCoarse) / 0.042) * 0.38 * coarseFade);
      }
    }

    // Outer disc (edgeFrac = 0.70..0.92): finer electric-blue spots (doubled spatial freq 30.0 -> 60.0)
    if (edgeFrac >= 0.68 && edgeFrac <= 0.93) {
      const fineIn = THREE.MathUtils.clamp((edgeFrac - 0.68) / 0.05, 0, 1);
      const fineOut = edgeFrac > 0.89 ? 1.0 - (edgeFrac - 0.89) / 0.04 : 1.0;
      const fineWeight = fineIn * fineOut;
      const cellFine = cellularSpotMask(x + 1.37, 0, zDisc - 0.83, 60.0, 0.62);
      const rFine = 0.155 + cellFine.cellHash * 0.04;
      if (cellFine.dist < rFine && fineWeight > spotStrength) {
        spotStrength = fineWeight;
        spotCoreFrac = 1.0 - cellFine.dist / rFine;
      } else if (cellFine.dist < rFine + 0.036) {
        edgeShade = Math.max(edgeShade, (1.0 - (cellFine.dist - rFine) / 0.036) * 0.30 * fineWeight);
      }
    }

    if (spotStrength > 0.01) {
      const spotCol = new THREE.Color().copy(cSpotOuter).lerp(cSpotInner, Math.pow(spotCoreFrac, 0.65));
      out.lerp(spotCol, spotStrength);
    } else if (edgeShade > 0.01) {
      out.lerp(cSpotEdge, edgeShade);
    }
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
  centerParts.push(
    prepareForMerge(core, (x, y, z, _nx, _ny, _nz, out) => {
      rayOcelliColor(x, y, z, out);
    })
  );
  core.dispose();

  // Prominent raised golden-amber periscopic eye turrets + recessed crescentic spiracles
  for (const side of [-1, 1]) {
    const brow = new THREE.SphereGeometry(0.022 * S, 14, 10);
    brow.scale(0.88, 0.85, 1.18);
    brow.translate(side * 0.054 * S, 0.035 * S, 0.094 * S);
    centerParts.push(
      prepareForMerge(brow, (_x, y, _z, _nx, _ny, _nz, out) => {
        const t = THREE.MathUtils.clamp((y / S - 0.022) / 0.026, 0, 1);
        out.copy(cEyeBase).lerp(cEyeTop, t);
      })
    );
    brow.dispose();

    const eyeTurret = new THREE.SphereGeometry(0.0175 * S, 14, 10);
    eyeTurret.scale(0.82, 0.96, 1.06);
    eyeTurret.translate(side * 0.056 * S, 0.044 * S, 0.095 * S);
    centerParts.push(
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
    );
    eyeTurret.dispose();

    // Horizontal/crescentic dark pupil slit on lateral-anterior face
    const pupil = new THREE.SphereGeometry(0.0098 * S, 10, 8);
    pupil.scale(0.46, 0.34, 1.24);
    pupil.rotateZ(side * -0.14);
    pupil.rotateY(side * 0.34);
    pupil.translate(side * 0.0645 * S, 0.045 * S, 0.100 * S);
    centerParts.push(prepareForMerge(pupil, cPupil));
    pupil.dispose();

    // Sculpted recessed dark crescentic spiracle behind and slightly lateral to eye turret
    const spiracleLip = new THREE.TorusGeometry(0.0145 * S, 0.0048 * S, 8, 16, Math.PI * 1.42);
    spiracleLip.rotateX(Math.PI * 0.5);
    spiracleLip.rotateY(side * 0.55);
    spiracleLip.scale(0.95, 0.72, 1.18);
    spiracleLip.translate(side * 0.068 * S, 0.0265 * S, 0.058 * S);
    centerParts.push(prepareForMerge(spiracleLip, cSpiracleLip));
    spiracleLip.dispose();

    const spiracleCavity = new THREE.SphereGeometry(0.0125 * S, 10, 8);
    spiracleCavity.scale(0.88, 0.24, 1.12);
    spiracleCavity.rotateY(side * 0.25);
    spiracleCavity.translate(side * 0.0675 * S, 0.0245 * S, 0.0585 * S);
    centerParts.push(prepareForMerge(spiracleCavity, cSpiracleDeep));
    spiracleCavity.dispose();
  }

  // Tapered ribbontail with twin vivid electric-blue lateral stripes & terminal sky-blue/white finfold
  const tail = new THREE.ConeGeometry(0.026 * S, 0.72 * S, 14, 18);
  tail.rotateX(-Math.PI * 0.5);
  tail.translate(0, 0.005 * S, -0.60 * S);
  centerParts.push(
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
  );
  tail.dispose();

  // Terminal ventral caudal finfold grading sky-blue -> pale white at posterior tip
  const finfold = new THREE.BoxGeometry(0.0034 * S, 0.019 * S, 0.42 * S, 1, 2, 10);
  finfold.translate(0, -0.007 * S, -0.74 * S);
  centerParts.push(
    prepareForMerge(finfold, (_x, y, z, _nx, _ny, _nz, out) => {
      const zT = THREE.MathUtils.clamp((-(z / S) - 0.53) / 0.42, 0, 1);
      const yT = THREE.MathUtils.clamp((-(y / S) - 0.001) / 0.015, 0, 1);
      out.copy(cTailStripe).lerp(cFinfoldMid, THREE.MathUtils.clamp(zT * 1.2, 0, 1)).lerp(cFinfoldTip, THREE.MathUtils.clamp(zT * 0.65 + yT * 0.35, 0, 1));
    })
  );
  finfold.dispose();

  const centerGeom = safeMerge(centerParts);

  // 3 chordwise pectoral wing ribbon strips per side aligned to wingZOffsets = [0.06, -0.005, -0.065]
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
    const geom = prepareForMerge(wing, (x, y, z, _nx, _ny, _nz, out) => {
      rayOcelliColor(x, y, z + zCenter, out);
    });
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
            maxDist: (bommy.radius ?? 2.2) + 2.5,
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
    new THREE.Vector3(1.85, 0.3, 4.45),
    new THREE.Vector3(4.2, 0.8, 3.2),
    new THREE.Vector3(3.4, 0.9, -1.6),
    new THREE.Vector3(1.25, 0.2, -2.4),
    new THREE.Vector3(-4.5, 1.0, -2.0),
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
      cleanCooldown: i === 0 ? 2.2 : 8.0 + i * 4.5,
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
  const MORAY_SEGS = 14;
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
    { bommyId: 'undercut-cave-east', dirX: -0.75, dirZ: 0.35 },
    { bommyId: 'fg-showcase', dirX: 0.85, dirZ: 0.45 },
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
  const rayCenterMesh = new THREE.InstancedMesh(rayProto.centerGeom, morayRayMat, MAX_RAY_COUNT);
  rayCenterMesh.name = 'taeniura-centers';
  configureDynamicMesh(rayCenterMesh, 'taeniura');
  enableShadows(rayCenterMesh, true, true);
  group.add(rayCenterMesh);
  pickableMeshes.push(rayCenterMesh);

  const wingMeshes = { left: [], right: [] };
  const wingZOffsets = [0.06, -0.005, -0.065];
  for (let s = 0; s < 3; s++) {
    const lMesh = new THREE.InstancedMesh(rayProto.wingGeoms.left[s], morayRayMat, MAX_RAY_COUNT);
    lMesh.name = `taeniura-left-wing-${s}`;
    configureDynamicMesh(lMesh, 'taeniura');
    enableShadows(lMesh, true, true);
    const rMesh = new THREE.InstancedMesh(rayProto.wingGeoms.right[s], morayRayMat, MAX_RAY_COUNT);
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
        ? (i / DEFAULT_RAY_COUNT) * Math.PI * 2
        : ((i - DEFAULT_RAY_COUNT + 0.5) / (MAX_RAY_COUNT - DEFAULT_RAY_COUNT)) * Math.PI * 2;
    const z0 = Math.sin(t) * 8.5 - 1.0;
    const canyonX0 = 2.4 * Math.sin(z0 * 0.19) + 1.1 * Math.cos(z0 * 0.08);
    const x0 = canyonX0 + Math.sin(t * 2.0 + i * 1.4) * 1.65;
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
  const lizardCandidates = [];

  const activeCounts = {
    grouper: DEFAULT_GROUPER_COUNT,
    caranx: DEFAULT_CARANX_COUNT,
    pterois: DEFAULT_LION_COUNT,
    moray: DEFAULT_MORAY_COUNT,
    taeniura: DEFAULT_RAY_COUNT,
    lizardfish: DEFAULT_LIZARD_COUNT,
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
          const emergeDist = baseEmerge * 0.16 * (1.0 - 0.55 * m.cleanBlend) + 0.12 * m.cleanBlend;
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

        // 14 trailing body segments undulating in traveling S-wave
        let prevX = m.pos.x;
        let prevY = m.pos.y;
        let prevZ = m.pos.z;
        for (let s = 0; s < MORAY_SEGS; s++) {
          const frac = (s + 1) / MORAY_SEGS;
          const waveAmp = (0.04 + frac * 0.12) * MORAY_SCALE * m.scale * (m.isCrevice ? 0.45 : 1.0);
          const waveOffset = Math.sin(elapsedTime * 4.2 + m.phase - s * 0.58) * waveAmp;
          const distBack = (s + 0.65) * 0.088 * MORAY_SCALE * m.scale;

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

          const taper = 1.0 - Math.pow(frac, 1.5) * 0.62;
          dummy.position.copy(segPos);
          dummy.quaternion.copy(qRot);
          dummy.scale.set(taper * m.scale, taper * m.scale, m.scale);
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
        const z = Math.sin(r.tParam) * 8.5 - 1.0;
        const canyonX = 2.4 * Math.sin(z * 0.19) + 1.1 * Math.cos(z * 0.08);
        const x = canyonX + Math.sin(r.tParam * 2.0 + i * 1.4) * 1.65;
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
          if (obsDist > 1e-4 && obsDist < 2.6) {
            const push = ((2.6 - obsDist) / 2.6) * 1.3;
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
    validSandPatches,
    applySpeciesCounts,
    getActiveCounts: () => ({ ...activeCounts }),
    update,
  };
}
