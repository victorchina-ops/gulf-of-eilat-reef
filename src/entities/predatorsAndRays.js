import * as THREE from 'three';
import { SPECIES_POPULATION_SPEC, WORLD_CONSTANTS, sanitizeSpeciesCount } from '../contracts.js';
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
import { configureDynamicMesh, createRng, prepareForMerge, safeMerge, safeNormalize } from './utils.js';

// -----------------------------------------------------------------------------
// 1. Red Sea Coral Grouper (Cephalopholis miniata) — ~0.52m vermilion + cyan ocelli
// -----------------------------------------------------------------------------
function buildGrouperPrototype() {
  const parts = [];
  const length = 0.52;
  const halfHeight = 0.118;
  const halfWidth = 0.068;
  const tailPivotZ = 0.245;

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
        const px = xNorm * halfWidth;
        const py = yNorm * halfHeight;
        const pz = zNorm * (length * 0.5);
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
        [-0.185, 0.042],
        [-0.165, 0.128],
        [-0.115, 0.148],
        [-0.065, 0.138],
        [-0.015, 0.120],
        [0.050, 0.114],
        [0.095, 0.104],
        [0.105, 0.045],
      ],
      0.0065,
      (x, y, z, out) => {
        out.copy(cVermilion);
        const cell = cellularSpotMask(x, y, z, 30.0, 0.64);
        if (cell.dist < 0.19) out.copy(cCyanSpot);
        else if (cell.dist < 0.26) out.lerp(cSpotRing, 0.72);
        // Thin electric-blue soft-fin margin along posterior rounded lobe
        if (z < -0.025 && (y > 0.132 || (z < -0.148 && y > 0.075))) {
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
        [-0.175, -0.040],
        [-0.155, -0.115],
        [-0.105, -0.142],
        [-0.045, -0.130],
        [0.010, -0.055],
      ],
      0.0065,
      (x, y, z, out) => {
        out.copy(cVermilion).lerp(cBelly, 0.35);
        const cell = cellularSpotMask(x, y, z, 30.0, 0.64);
        if (cell.dist < 0.19) out.copy(cCyanSpot);
        else if (cell.dist < 0.26) out.lerp(cSpotRing, 0.72);
        if (y < -0.124 || (z < -0.142 && y < -0.070)) {
          out.lerp(cMargin, 0.85);
        }
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 5 }
    )
  );

  // Pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.085,
      yPos: -0.076,
      xOffset: 0.018,
      length: 0.092,
      width: 0.050,
      splay: 0.34,
      dip: -0.44,
      thickness: 0.0040,
      bodyLength: length,
      tailPivotZ,
      colorFn: (x, y, z, out) => {
        out.copy(cBelly).lerp(cVermilion, 0.45);
        const cell = cellularSpotMask(x, y, z, 32.0, 0.64);
        if (cell.dist < 0.17) out.copy(cCyanSpot);
      },
    })
  );

  // Broad rounded paddle pectoral fins (scull noticeably at cleaning stations)
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.095,
      yPos: -0.025,
      xOffset: 0.056,
      span: 0.115,
      chord: 0.088,
      sweep: -0.42,
      dihedral: -0.12,
      flare: 0.88,
      thickness: 0.0046,
      bodyLength: length,
      tailPivotZ,
      shape: 'paddle',
      colorFn: (x, y, z, out) => {
        const spanApprox = THREE.MathUtils.clamp((Math.abs(x) - 0.055) / 0.10, 0, 1);
        out.copy(cVermilion).lerp(cBelly, spanApprox * 0.55);
        if (spanApprox > 0.88) out.lerp(cMargin, 0.65);
        const cell = cellularSpotMask(x, y, z, 34.0, 0.64);
        if (cell.dist < 0.16 && spanApprox < 0.72) out.copy(cCyanSpot);
      },
    })
  );

  addFishEyes(parts, 0.190, 0.030, 0.042, 0.0155, '#e2b84a', {
    bodyLength: length,
    tailPivotZ,
  });

  const bodyGeom = safeMerge(parts);

  // Convex rounded paddle caudal fin with dark-ringed cyan spots & electric-blue margin
  const tailGeom = buildFinStrip(
    [
      [0.006, 0.044],
      [-0.055, 0.082],
      [-0.115, 0.078],
      [-0.142, 0.036],
      [-0.148, 0.0],
      [-0.142, -0.036],
      [-0.115, -0.078],
      [-0.055, -0.082],
      [0.006, -0.044],
    ],
    0.0068,
    (x, y, z, out) => {
      out.copy(cVermilion);
      const cell = cellularSpotMask(x, y, z, 31.0, 0.64);
      if (cell.dist < 0.19) out.copy(cCyanSpot);
      else if (cell.dist < 0.26) out.lerp(cSpotRing, 0.72);
      const edgeDist = Math.hypot(z + 0.015, y * 1.15);
      if (edgeDist > 0.124) out.lerp(cMargin, 0.88);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 5 }
  );

  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 2. Bluefin Trevally (Caranx melampygus) — ~0.56m diamond jack + cobalt scythes
// -----------------------------------------------------------------------------
function buildTrevallyPrototype() {
  const parts = [];
  const length = 0.56;
  const halfHeight = 0.125;
  const halfWidth = 0.054;
  const tailPivotZ = 0.265;

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
          const px = xNorm * halfWidth;
          const py = yNorm * halfHeight;
          const pz = zNorm * (length * 0.5);
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
        [-0.015, 0.075],
        [0.012, 0.148],
        [0.068, 0.158],
        [0.086, 0.075],
      ],
      0.0048,
      (_x, y, _z, out) => out.copy(cBack).lerp(cCobaltFin, THREE.MathUtils.clamp((y - 0.08) * 9.0, 0, 1)),
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Tall falcate scythe-lobed 2nd dorsal fin
  parts.push(
    buildFinStrip(
      [
        [-0.205, 0.012],
        [-0.195, 0.045],
        [-0.125, 0.072],
        [-0.078, 0.122],
        [-0.060, 0.232],
        [-0.032, 0.228],
        [0.004, 0.058],
      ],
      0.0052,
      (_x, y, _z, out) => out.copy(cFinBase).lerp(cCobaltFin, THREE.MathUtils.clamp((y - 0.05) * 6.5, 0, 1)),
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 5 }
    )
  );

  // Tall falcate scythe-lobed anal fin
  parts.push(
    buildFinStrip(
      [
        [-0.205, -0.012],
        [-0.195, -0.040],
        [-0.130, -0.065],
        [-0.085, -0.112],
        [-0.068, -0.212],
        [-0.042, -0.206],
        [-0.002, -0.052],
      ],
      0.0052,
      (_x, y, _z, out) => out.copy(cFinBase).lerp(cCobaltFin, THREE.MathUtils.clamp((-y - 0.04) * 6.8, 0, 1)),
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 5 }
    )
  );

  // Pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.105,
      yPos: -0.070,
      xOffset: 0.014,
      length: 0.084,
      width: 0.034,
      splay: 0.28,
      dip: -0.44,
      thickness: 0.0032,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, y, _z, out) => out.copy(cSilver).lerp(cCobaltFin, THREE.MathUtils.clamp((-y - 0.06) * 14.0, 0, 1)),
    })
  );

  // Long swept falcate pectoral wings
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.105,
      yPos: -0.018,
      xOffset: 0.046,
      span: 0.185,
      chord: 0.058,
      sweep: -0.78,
      dihedral: -0.06,
      flare: 0.62,
      thickness: 0.0036,
      bodyLength: length,
      tailPivotZ,
      shape: 'falcate',
      colorFn: (x, _y, _z, out) => {
        const spanT = THREE.MathUtils.clamp((Math.abs(x) - 0.045) / 0.11, 0, 1);
        out.copy(cFinBase).lerp(cCobaltFin, spanT);
      },
    })
  );

  addFishEyes(parts, 0.205, 0.024, 0.031, 0.014, '#c8d6e4', {
    bodyLength: length,
    tailPivotZ,
  });

  const bodyGeom = safeMerge(parts);

  // Deeply forked razor-thin pelagic lunate tail
  const tailGeom = buildFinStrip(
    [
      [0.005, 0.014],
      [-0.072, 0.095],
      [-0.155, 0.155],
      [-0.162, 0.148],
      [-0.095, 0.044],
      [-0.042, 0.0],
      [-0.095, -0.044],
      [-0.162, -0.148],
      [-0.155, -0.155],
      [-0.072, -0.095],
      [0.005, -0.014],
    ],
    0.0038,
    (_x, _y, z, out) => out.copy(cFinBase).lerp(cCobaltFin, THREE.MathUtils.clamp(-z / 0.15, 0, 1)),
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 5 }
  );

  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 3. Devil Firefish / Lionfish (Pterois miles) — ~0.34m zebra + 13 dorsal plumes
// -----------------------------------------------------------------------------
function buildLionfishPrototype() {
  const parts = [];
  const length = 0.34;
  const halfHeight = 0.082;
  const halfWidth = 0.048;
  const tailPivotZ = 0.155;

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
    const hornLen = 0.046;
    const horn = new THREE.ConeGeometry(0.0042, hornLen, 5, 4);
    horn.rotateZ(side * -0.26);
    horn.rotateX(-0.22);
    const yRoot = 0.050;
    const zHorn = 0.112;
    horn.translate(side * 0.022, yRoot + hornLen * 0.42, zHorn);
    const uAttach = computeUAttach(zHorn, length, tailPivotZ);
    parts.push(
      prepareFishPart(
        horn,
        (_x, y, _z, _nx, _ny, _nz, out) => {
          const band = Math.sin((y - yRoot) * 210.0);
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
    const zPos = 0.104 - t * 0.205;
    const len = 0.145 + Math.sin(t * Math.PI) * 0.088;
    const yRoot = 0.046 + Math.sin(t * Math.PI) * 0.022;
    const spine = new THREE.ConeGeometry(0.0056, len, 5, 8);
    spine.rotateX(-0.34 + t * 0.52);
    spine.translate(0, yRoot + len * 0.46, zPos);
    const uAttach = computeUAttach(zPos, length, tailPivotZ);
    parts.push(
      prepareFishPart(
        spine,
        (_x, y, _z, _nx, _ny, _nz, out) => {
          const stripe = Math.sin((y - yRoot) * 105.0 + s * 0.6);
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
        [-0.162, 0.028],
        [-0.148, 0.095],
        [-0.108, 0.106],
        [-0.072, 0.036],
      ],
      0.0038,
      (x, y, z, out) => {
        const cell = cellularSpotMask(x, y, z, 54.0, 0.66);
        out.copy(cell.dist < 0.24 ? cCrimson : cIvory);
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Spotted soft anal fin
  parts.push(
    buildFinStrip(
      [
        [-0.162, -0.026],
        [-0.142, -0.092],
        [-0.092, -0.102],
        [-0.045, -0.042],
      ],
      0.0038,
      (x, y, z, out) => {
        const cell = cellularSpotMask(x, y, z, 54.0, 0.66);
        out.copy(cell.dist < 0.24 ? cCrimson : cIvory);
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Ornate flared zebra-banded webbed pectoral fans: inner membrane + radial feather-rays
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.068,
      yPos: -0.008,
      xOffset: 0.042,
      span: 0.145,
      chord: 0.125,
      sweep: -0.45,
      dihedral: -0.05,
      flare: 0.85,
      thickness: 0.0030,
      bodyLength: length,
      tailPivotZ,
      shape: 'fan',
      colorFn: (x, _y, z, out) => {
        const band = Math.sin(Math.hypot(Math.abs(x) - 0.04, z - 0.065) * 90.0);
        if (band > 0.15) out.copy(cIvory);
        else if (band > -0.45) out.copy(cCrimson);
        else out.copy(cMahogany);
      },
    })
  );

  const pecAttach = computeUAttach(0.068, length, tailPivotZ);
  for (const side of [PART_PECTORAL_LEFT, PART_PECTORAL_RIGHT]) {
    for (let r = 0; r < 9; r++) {
      const f = r / 8;
      const rayLen = 0.205 + Math.sin(f * Math.PI) * 0.025;
      const ray = new THREE.ConeGeometry(0.0062, rayLen, 5, 7);
      ray.rotateZ(side * (0.98 + f * 0.52));
      ray.rotateY(side * (-0.34 + f * 0.84));
      ray.translate(side * 0.088, -0.012 + (0.5 - f) * 0.062, 0.056 - f * 0.075);
      parts.push(
        prepareFishPart(
          ray,
          (x, _y, z, _nx, _ny, _nz, out) => {
            const band = Math.sin(Math.hypot(Math.abs(x) - 0.04, z - 0.065) * 85.0);
            if (band > 0.10) out.copy(cIvory);
            else if (band > -0.45) out.copy(cCrimson);
            else out.copy(cMahogany);
          },
          (x) => [
            side,
            THREE.MathUtils.clamp((Math.abs(x) - 0.040) / 0.165, 0, 1),
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
      zPos: 0.042,
      yPos: -0.052,
      xOffset: 0.012,
      length: 0.088,
      width: 0.050,
      splay: 0.36,
      dip: -0.48,
      thickness: 0.0032,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, y, z, out) => {
        const band = Math.sin((y + z) * 95.0);
        out.copy(band > 0.1 ? cIvory : cCrimson);
      },
    })
  );

  addFishEyes(parts, 0.115, 0.022, 0.028, 0.011, '#d8be72', {
    bodyLength: length,
    tailPivotZ,
  });

  const bodyGeom = safeMerge(parts);

  // Translucent-look spotted rounded caudal fan
  const tailGeom = buildFinStrip(
    [
      [0.004, 0.022],
      [-0.050, 0.066],
      [-0.105, 0.072],
      [-0.125, 0.032],
      [-0.130, 0.0],
      [-0.125, -0.032],
      [-0.105, -0.072],
      [-0.050, -0.066],
      [0.004, -0.022],
    ],
    0.0036,
    (x, y, z, out) => {
      const cell = cellularSpotMask(x, y, z, 58.0, 0.65);
      out.copy(cell.dist < 0.22 ? cCrimson : cIvory);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );

  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 4. Geometric Moray Eel (Gymnothorax griseus) — 14-segment S-wave + pore dots
// -----------------------------------------------------------------------------
function buildMorayPrototypes() {
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

  const segCyl = new THREE.CylinderGeometry(0.044, 0.048, 0.106, 20, 6);
  segCyl.rotateX(Math.PI * 0.5);
  segCyl.scale(0.82, 1.18, 1.0);
  const segGeom = prepareForMerge(segCyl, (x, y, z, _nx, _ny, _nz, out) => {
    morayVermiculationColor(x, y, z, out);
  });
  segCyl.dispose();

  // Continuous fleshy dorsal fin crest (paler grey-beige) merged on segment
  const fin = new THREE.BoxGeometry(0.009, 0.056, 0.110, 1, 4, 6);
  fin.translate(0, 0.068, 0);
  const finGeom = prepareForMerge(fin, (x, y, z, _nx, _ny, _nz, out) => {
    morayVermiculationColor(x, y, z, out, { isFin: true });
  });
  fin.dispose();
  const bodySegGeom = safeMerge([segGeom, finGeom]);

  // Exact surface X helper on the sculpted skull capsule (R=0.046, L=0.10, scale 0.84x0.92x1, pos 0,0.015,0.05)
  function skullSurfaceX(y, z) {
    const dy = (y - 0.015) / 0.92;
    const dzCap = Math.max(0, Math.abs(z - 0.05) - 0.05);
    const inside = Math.max(0.00004, 0.046 * 0.046 - dy * dy - dzCap * dzCap);
    return 0.84 * Math.sqrt(inside);
  }

  // Iconic Gymnothorax griseus geometric jet-black sensory-pore dot rows
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
  const skull = new THREE.CapsuleGeometry(0.046, 0.10, 14, 22);
  skull.rotateX(Math.PI * 0.5);
  skull.scale(0.84, 0.92, 1.0);
  skull.translate(0, 0.015, 0.05);
  headParts.push(
    prepareForMerge(skull, (x, y, z, _nx, _ny, _nz, out) => {
      morayVermiculationColor(x, y, z, out, { isHead: true });
      // Subtle pinkish-flesh inner mouth rim along lower lateral-anterior lip
      if (y < 0.009 && z > 0.025 && Math.abs(x) > 0.012) {
        const rimT = THREE.MathUtils.clamp((0.009 - y) / 0.014, 0, 1) * THREE.MathUtils.clamp((z - 0.025) / 0.045, 0, 1);
        out.lerp(cMouthRim, rimT * 0.65);
      }
      // Crisp dark pore spots painted into head surface under pore spheres
      const absX = Math.abs(x);
      for (let p = 0; p < headPoreDots.length; p++) {
        const pd = headPoreDots[p];
        const d = Math.hypot(absX - pd.x, y - pd.y, z - pd.z);
        if (d < 0.0045) {
          out.lerp(cPore, 1.0 - d / 0.0045);
        }
      }
    })
  );
  skull.dispose();

  for (const side of [-1, 1]) {
    // Raised tubular anterior nostrils on snout
    const nostril = new THREE.CylinderGeometry(0.0034, 0.0046, 0.016, 8);
    nostril.rotateX(0.45);
    nostril.rotateZ(side * -0.25);
    nostril.translate(side * 0.013, 0.032, 0.130);
    headParts.push(prepareForMerge(nostril, cNostril));
    nostril.dispose();

    // Signature stark chalk-white iris + pinpoint jet-black pupil
    const iris = new THREE.SphereGeometry(0.009, 12, 10);
    iris.scale(0.55, 1.0, 1.0);
    iris.translate(side * 0.0328, 0.035, 0.090);
    headParts.push(prepareForMerge(iris, cIris));
    iris.dispose();

    const pupil = new THREE.SphereGeometry(0.0036, 8, 6);
    pupil.scale(0.68, 1.0, 1.0);
    pupil.translate(side * 0.0358, 0.035, 0.090);
    headParts.push(prepareForMerge(pupil, cPupil));
    pupil.dispose();

    // Sculpted jet-black sensory-pore dot spheres along head geometric rows
    for (let p = 0; p < headPoreDots.length; p++) {
      const pd = headPoreDots[p];
      const dot = new THREE.SphereGeometry(0.0020, 6, 5);
      dot.translate(side * pd.x, pd.y, pd.z);
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
  const jaw = new THREE.BoxGeometry(0.052, 0.022, 0.126, 4, 3, 10);
  const jawPos = jaw.attributes.position;
  for (let i = 0; i < jawPos.count; i++) {
    let x = jawPos.getX(i);
    const y = jawPos.getY(i);
    const z = jawPos.getZ(i) + 0.062; // spans z = -0.001 .. +0.125
    const snoutT = THREE.MathUtils.clamp((z - 0.02) / 0.105, 0, 1);
    const widthScale = 1.04 - 0.24 * snoutT * snoutT;
    x *= widthScale;
    jawPos.setXYZ(i, x, y - 0.012, z);
  }
  jaw.computeVertexNormals();
  jawParts.push(
    prepareForMerge(jaw, (x, y, z, _nx, _ny, _nz, out) => {
      out.copy(cHeadGround).lerp(cThroat, THREE.MathUtils.clamp((-y - 0.008) / 0.015, 0, 1));
      if (y > -0.005 && z > 0.025) {
        const rimT = THREE.MathUtils.clamp((y + 0.005) / 0.006, 0, 1);
        out.lerp(cMouthRim, rimT * 0.72);
      }
      if (y < -0.014) {
        const groove = 0.5 + 0.5 * Math.sin(x * 300.0 + z * 22.0);
        out.lerp(cThroat, 0.55 + 0.35 * groove);
      }
      const absX = Math.abs(x);
      for (let p = 0; p < jawPoreDots.length; p++) {
        const pd = jawPoreDots[p];
        const d = Math.hypot(absX - pd.x, y - pd.y, z - pd.z);
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
      const dot = new THREE.SphereGeometry(0.0020, 6, 5);
      dot.translate(side * pd.x, pd.y, pd.z);
      jawParts.push(prepareForMerge(dot, cPore));
      dot.dispose();
    }
  }

  const jawGeom = safeMerge(jawParts);

  return { bodySegGeom, headGeom, jawGeom };
}

// -----------------------------------------------------------------------------
// 5. Bluespotted Ribbontail Ray (Taeniura lymma — מחבטן ספירים)
// -----------------------------------------------------------------------------
function buildRibbontailRayPrototypes() {
  const discRadiusX = 0.34;
  const discRadiusZ = 0.39;
  const coreRadiusX = 0.215;

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
    if (y < -0.004) {
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

    // Inner/mid disc (edgeFrac < 0.72): prominent electric-blue spots (scale ~17.5)
    let spotStrength = 0;
    let spotCoreFrac = 0;
    let edgeShade = 0;

    if (edgeFrac < 0.75) {
      const coarseFade = edgeFrac > 0.67 ? 1.0 - (edgeFrac - 0.67) / 0.08 : 1.0;
      const cellCoarse = cellularSpotMask(x * 1.06, 0, zDisc * 0.92, 17.5, 0.58);
      const rCoarse = (0.20 + cellCoarse.cellHash * 0.045) * (0.72 + 0.28 * coarseFade);
      if (cellCoarse.dist < rCoarse) {
        spotStrength = coarseFade;
        spotCoreFrac = 1.0 - cellCoarse.dist / rCoarse;
      } else if (cellCoarse.dist < rCoarse + 0.042) {
        edgeShade = Math.max(edgeShade, (1.0 - (cellCoarse.dist - rCoarse) / 0.042) * 0.38 * coarseFade);
      }
    }

    // Outer disc (edgeFrac = 0.70..0.92): finer, smaller electric-blue spots (scale ~30.0)
    if (edgeFrac >= 0.68 && edgeFrac <= 0.93) {
      const fineIn = THREE.MathUtils.clamp((edgeFrac - 0.68) / 0.05, 0, 1);
      const fineOut = edgeFrac > 0.89 ? 1.0 - (edgeFrac - 0.89) / 0.04 : 1.0;
      const fineWeight = fineIn * fineOut;
      const cellFine = cellularSpotMask(x + 1.37, 0, zDisc - 0.83, 30.0, 0.62);
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
      const cranialDome = 0.011 * Math.exp(-((x / 0.09) ** 2 + ((z - 0.03) / 0.19) ** 2));
      const spiracleDip = 0.0085 * Math.exp(-(((Math.abs(x) - 0.068) / 0.019) ** 2 + ((z - 0.058) / 0.016) ** 2));
      y = y0 * (0.024 + cranialDome) - y0 * spiracleDip;
    } else {
      y = y0 * 0.015;
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
    const brow = new THREE.SphereGeometry(0.022, 14, 10);
    brow.scale(0.88, 0.85, 1.18);
    brow.translate(side * 0.054, 0.035, 0.094);
    centerParts.push(
      prepareForMerge(brow, (_x, y, _z, _nx, _ny, _nz, out) => {
        const t = THREE.MathUtils.clamp((y - 0.022) / 0.026, 0, 1);
        out.copy(cEyeBase).lerp(cEyeTop, t);
      })
    );
    brow.dispose();

    const eyeTurret = new THREE.SphereGeometry(0.0175, 14, 10);
    eyeTurret.scale(0.82, 0.96, 1.06);
    eyeTurret.translate(side * 0.056, 0.044, 0.095);
    centerParts.push(
      prepareForMerge(eyeTurret, (x, y, z, _nx, _ny, _nz, out) => {
        const t = THREE.MathUtils.clamp((y - 0.030) / 0.028, 0, 1);
        out.copy(cEyeBase).lerp(cEyeTop, t);
        // Dark amber rim around the lateral-anterior pupil slot
        const dRim = Math.hypot((x - side * 0.064) * 1.1, (y - 0.045) * 1.5, z - 0.099);
        if (dRim < 0.0125) {
          out.lerp(cEyeAmberRim, 1.0 - dRim / 0.0125);
        }
      })
    );
    eyeTurret.dispose();

    // Horizontal/crescentic dark pupil slit on lateral-anterior face
    const pupil = new THREE.SphereGeometry(0.0098, 10, 8);
    pupil.scale(0.46, 0.34, 1.24);
    pupil.rotateZ(side * -0.14);
    pupil.rotateY(side * 0.34);
    pupil.translate(side * 0.0645, 0.045, 0.100);
    centerParts.push(prepareForMerge(pupil, cPupil));
    pupil.dispose();

    // Sculpted recessed dark crescentic spiracle behind and slightly lateral to eye turret
    const spiracleLip = new THREE.TorusGeometry(0.0145, 0.0048, 8, 16, Math.PI * 1.42);
    spiracleLip.rotateX(Math.PI * 0.5);
    spiracleLip.rotateY(side * 0.55);
    spiracleLip.scale(0.95, 0.72, 1.18);
    spiracleLip.translate(side * 0.068, 0.0265, 0.058);
    centerParts.push(prepareForMerge(spiracleLip, cSpiracleLip));
    spiracleLip.dispose();

    const spiracleCavity = new THREE.SphereGeometry(0.0125, 10, 8);
    spiracleCavity.scale(0.88, 0.24, 1.12);
    spiracleCavity.rotateY(side * 0.25);
    spiracleCavity.translate(side * 0.0675, 0.0245, 0.0585);
    centerParts.push(prepareForMerge(spiracleCavity, cSpiracleDeep));
    spiracleCavity.dispose();
  }

  // Tapered ribbontail with twin vivid electric-blue lateral stripes & terminal sky-blue/white finfold
  const tail = new THREE.ConeGeometry(0.026, 0.72, 14, 18);
  tail.rotateX(-Math.PI * 0.5);
  tail.translate(0, 0.005, -0.60);
  centerParts.push(
    prepareForMerge(tail, (x, y, z, _nx, _ny, _nz, out) => {
      if (y < -0.004) {
        out.copy(cBelly);
        return;
      }
      const tailT = THREE.MathUtils.clamp((-z - 0.24) / 0.72, 0, 1);
      const localHalfW = Math.max(0.0022, 0.026 * (1.0 - tailT));
      const absX = Math.abs(x);

      if (z < -0.78) {
        const tipT = THREE.MathUtils.clamp((-z - 0.78) / 0.18, 0, 1);
        out.copy(cTailStripe).lerp(cFinfoldMid, Math.min(1, tipT * 1.4)).lerp(cFinfoldTip, Math.max(0, (tipT - 0.35) / 0.65));
      } else if (z < -0.33 && absX > localHalfW * 0.30 && absX < localHalfW * 0.94) {
        out.copy(cTailStripe);
      } else {
        out.copy(cDisc);
      }
    })
  );
  tail.dispose();

  // Terminal ventral caudal finfold grading sky-blue -> pale white at posterior tip
  const finfold = new THREE.BoxGeometry(0.0034, 0.019, 0.42, 1, 2, 10);
  finfold.translate(0, -0.007, -0.74);
  centerParts.push(
    prepareForMerge(finfold, (_x, y, z, _nx, _ny, _nz, out) => {
      const zT = THREE.MathUtils.clamp((-z - 0.53) / 0.42, 0, 1);
      const yT = THREE.MathUtils.clamp((-y - 0.001) / 0.015, 0, 1);
      out.copy(cTailStripe).lerp(cFinfoldMid, THREE.MathUtils.clamp(zT * 1.2, 0, 1)).lerp(cFinfoldTip, THREE.MathUtils.clamp(zT * 0.65 + yT * 0.35, 0, 1));
    })
  );
  finfold.dispose();

  const centerGeom = safeMerge(centerParts);

  // 3 chordwise pectoral wing ribbon strips per side aligned to wingZOffsets = [0.12, -0.01, -0.13]
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
      const u = Math.min(1.0, Math.abs(x) / Math.max(0.01, ovalMaxX));
      const y = y0 * 0.020 * (1.0 - 0.74 * u);
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
      makeWingStrip(-1, 0.12, 0.34),
      makeWingStrip(-1, -0.01, 0.28),
      makeWingStrip(-1, -0.13, 0.32),
    ],
    right: [
      makeWingStrip(1, 0.12, 0.34),
      makeWingStrip(1, -0.01, 0.28),
      makeWingStrip(1, -0.13, 0.32),
    ],
  };

  return { centerGeom, wingGeoms };
}

// -----------------------------------------------------------------------------
// 6. Red Sea Sand Lizardfish (Synodus variegatus) — ~0.38m sit-and-wait predator
// -----------------------------------------------------------------------------
function buildLizardfishPrototype() {
  const parts = [];
  const length = 0.38;
  const halfHeight = 0.038;
  const halfWidth = 0.044;
  const tailPivotZ = 0.174;

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
        const px = xNorm * halfWidth;
        const py = yNorm * halfHeight;
        const pz = zNorm * (length * 0.5);
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
  const jawCleft = new THREE.BoxGeometry(0.026, 0.005, 0.036);
  jawCleft.rotateX(-0.28);
  jawCleft.translate(0, 0.002, 0.172);
  const jawUAttach = computeUAttach(0.172, length, tailPivotZ);
  parts.push(
    prepareFishPart(
      jawCleft,
      (_x, y, _z, _nx, _ny, _nz, out) => {
        out.copy(y > 0.002 ? cJawCleft : cBelly);
      },
      [PART_BODY, 0, jawUAttach, 0.04]
    )
  );
  jawCleft.dispose();

  // Dorsally perched upward-looking eyes with golden-ochre iris rings (#cfa038) & dark pupils (#121418)
  const eyeUAttach = computeUAttach(0.135, length, tailPivotZ);
  for (const side of [-1, 1]) {
    const iris = new THREE.SphereGeometry(0.009, 10, 8);
    iris.scale(0.85, 0.95, 1.0);
    iris.translate(side * 0.023, 0.028, 0.135);
    parts.push(prepareFishPart(iris, cIris, [PART_BODY, 0, eyeUAttach, 0.12]));
    iris.dispose();

    const pupil = new THREE.SphereGeometry(0.0055, 8, 6);
    pupil.scale(0.85, 0.95, 1.0);
    pupil.translate(side * 0.0245, 0.0315, 0.1365);
    parts.push(prepareFishPart(pupil, cPupil, [PART_BODY, 0, eyeUAttach, 0.12]));
    pupil.dispose();
  }

  // Splayed sand-mottled pectoral fins
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.088,
      yPos: -0.015,
      xOffset: 0.038,
      span: 0.068,
      chord: 0.042,
      sweep: -0.36,
      dihedral: -0.26,
      flare: 0.88,
      thickness: 0.0026,
      bodyLength: length,
      tailPivotZ,
      shape: 'fan',
      colorFn: (x, y, z, out) => {
        const cell = cellularSpotMask(x, y, z, 60.0, 0.82);
        out.copy(cell.dist < 0.25 ? cUmber : cSand);
      },
    })
  );

  // Tripod pelvic prop fins angled outward & downward to prop forebody off sand
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.046,
      yPos: -0.028,
      xOffset: 0.020,
      length: 0.070,
      width: 0.044,
      splay: 0.44,
      dip: -0.52,
      thickness: 0.0028,
      bodyLength: length,
      tailPivotZ,
      colorFn: (x, y, z, out) => {
        const cell = cellularSpotMask(x, y, z, 55.0, 0.80);
        out.copy(cell.dist < 0.22 ? cRufous : cBelly);
      },
    })
  );

  // High triangular barred dorsal fin
  parts.push(
    buildFinStrip(
      [
        [-0.035, 0.024],
        [-0.012, 0.098],
        [0.028, 0.105],
        [0.050, 0.028],
      ],
      0.0042,
      (x, y, z, out) => {
        const bar = Math.sin(y * 130.0 + z * 85.0) > 0.12;
        const cell = cellularSpotMask(x, y, z, 65.0, 0.80);
        out.copy(bar || cell.dist < 0.18 ? cRufous : cSand);
      },
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Tiny posterior adipose fin
  parts.push(
    buildFinStrip(
      [
        [-0.126, 0.016],
        [-0.118, 0.038],
        [-0.102, 0.036],
        [-0.095, 0.018],
      ],
      0.0032,
      (_x, y, _z, out) => out.copy(y > 0.028 ? cRufous : cSand),
      { partCode: PART_MEDIAN_FIN, bodyLength: length, tailPivotZ, spanSegs: 3 }
    )
  );

  const bodyGeom = safeMerge(parts);

  // Forked barred caudal fin
  const tailGeom = buildFinStrip(
    [
      [0.004, 0.014],
      [-0.074, 0.056],
      [-0.044, 0.007],
      [-0.032, 0.0],
      [-0.044, -0.007],
      [-0.074, -0.056],
      [0.004, -0.014],
    ],
    0.0040,
    (_x, y, z, out) => {
      out.copy(Math.sin(z * 115.0 + Math.abs(y) * 55.0) > 0.15 ? cUmber : cSand);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );

  return { bodyGeom, tailGeom, tailPivotZ };
}

export function createPredatorsAndRays({
  applyUnderwaterMaterial,
  getSeabedHeight,
  sampleSubstrate = null,
  coralHeads,
  caves,
  cleaningSystem = null,
}) {
  const group = new THREE.Group();
  group.name = 'reef-predators-and-rays';

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

    const tailMesh = new THREE.InstancedMesh(proto.tailGeom, fishMat, count);
    tailMesh.name = `${speciesId}-tails`;
    configureDynamicMesh(tailMesh, speciesId);

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

  for (let i = 0; i < MAX_GROUPER_COUNT; i++) {
    const wp = grouperWaypoints[i % grouperWaypoints.length];
    const pos = wp.clone();
    if (i >= DEFAULT_GROUPER_COUNT) {
      pos.x += (i % 2 === 0 ? 0.65 : -0.65);
      pos.y += 0.18;
      pos.z += (i % 3 === 0 ? 0.55 : -0.55);
    }
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
      targetIdx: (i < DEFAULT_GROUPER_COUNT ? i + 1 : i + 3) % grouperWaypoints.length,
      scale: 0.92 + grouperRng() * 0.22,
      phase: grouperRng() * Math.PI * 2,
      predEntry,
      cleanState: 'none',
      cleanTimer: 0,
      cleanCooldown: i === 0 ? 1.2 : 8.0 + i * 4.5,
      cleanTarget: null,
      postCleanGrace: 0,
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
    const vel = new THREE.Vector3(0.8, 0, -0.8);
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
      tParam: t,
      speed: 0.34 + (i % 2) * 0.08,
      altitude: 1.3 + (i % 3) * 0.38,
      scale: 0.94 + caranxRng() * 0.20,
      phase: caranxRng() * Math.PI * 2,
      predEntry,
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Devil Firefish / Lionfish (5 -> 10 hovering near bommies & reef arch)
  // ---------------------------------------------------------------------------
  const DEFAULT_LION_COUNT = SPECIES_POPULATION_SPEC.pterois.defaultCount;
  const MAX_LION_COUNT = SPECIES_POPULATION_SPEC.pterois.maxCount;
  const lionMeshes = makePair(buildLionfishPrototype(), MAX_LION_COUNT, 'pterois');
  const lionAnchors = [
    new THREE.Vector3(-2.0, 0.7, 1.9), // arch swim-through
    new THREE.Vector3(3.3, 0.7, 0.8),  // undercut cave
    new THREE.Vector3(-0.35, 0.95, 6.05), // foreground pinnacle
    new THREE.Vector3(4.3, 1.0, -1.6),
    new THREE.Vector3(-4.6, 0.9, -9.6),
    new THREE.Vector3(-4.8, 0.85, -1.8),
    new THREE.Vector3(5.2, 0.9, 3.8),
    new THREE.Vector3(-6.2, 0.85, 3.4),
    new THREE.Vector3(-2.4, 0.95, -5.9),
    new THREE.Vector3(4.2, 0.9, -10.4),
  ];
  const lionfish = [];
  for (let i = 0; i < MAX_LION_COUNT; i++) {
    const anchor = lionAnchors[i];
    const pos = anchor.clone();
    const vel = new THREE.Vector3(0.18, 0, 0.12);
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
      pos,
      vel,
      phase: i * 1.4,
      scale: 0.96 + (i % 2) * 0.14,
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

  const morayJawMesh = new THREE.InstancedMesh(morayProto.jawGeom, morayRayMat, MAX_MORAY_COUNT);
  morayJawMesh.name = 'moray-jaws';
  configureDynamicMesh(morayJawMesh, 'moray');

  const moraySegMesh = new THREE.InstancedMesh(morayProto.bodySegGeom, morayRayMat, MAX_MORAY_COUNT * MORAY_SEGS);
  moraySegMesh.name = 'moray-segments';
  configureDynamicMesh(moraySegMesh, 'moray');

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

  const bonusMorayCrevices = [
    new THREE.Vector3(-4.6, getSeabedHeight(-4.6, -2.2) + 0.35, -2.2),
    new THREE.Vector3(4.5, getSeabedHeight(4.5, -1.7) + 0.35, -1.7),
  ];
  const morays = [];
  for (let i = 0; i < MAX_MORAY_COUNT; i++) {
    const isCrevice = i < 2 || (i >= 4 && i % 2 === 0);
    const cave =
      i < 4
        ? (caves[i % Math.max(1, caves.length)]?.position ?? new THREE.Vector3(3.1, -0.1, 0.9))
        : bonusMorayCrevices[Math.floor((i - 4) / 2) % bonusMorayCrevices.length];
    const pos = isCrevice
      ? cave.clone()
      : new THREE.Vector3(
          i === 2 ? 0.8 : i === 3 ? -1.2 : i === 5 ? 1.6 : -1.8,
          getSeabedHeight(0, 0) + 0.35,
          i === 2 ? -2.0 : i === 3 ? 3.5 : i === 5 ? -5.0 : 0.5
        );
    const isActive = i < DEFAULT_MORAY_COUNT;
    const predEntry = {
      pos: pos.clone(),
      vel: isActive && !isCrevice ? new THREE.Vector3(-0.35, 0, 0.25) : new THREE.Vector3(),
      radius: isActive ? (isCrevice ? 0.95 : 1.85) : 0,
      speciesId: 'moray',
      isActiveHunter: isActive && !isCrevice,
    };
    predators.push(predEntry);
    morays.push({
      isCrevice,
      anchor: cave.clone(),
      pos,
      vel: new THREE.Vector3(-0.35, 0, 0.25),
      phase: i * 1.7,
      predEntry,
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
  group.add(rayCenterMesh);
  pickableMeshes.push(rayCenterMesh);

  const wingMeshes = { left: [], right: [] };
  const wingZOffsets = [0.12, -0.01, -0.13];
  for (let s = 0; s < 3; s++) {
    const lMesh = new THREE.InstancedMesh(rayProto.wingGeoms.left[s], morayRayMat, MAX_RAY_COUNT);
    lMesh.name = `taeniura-left-wing-${s}`;
    configureDynamicMesh(lMesh, 'taeniura');
    const rMesh = new THREE.InstancedMesh(rayProto.wingGeoms.right[s], morayRayMat, MAX_RAY_COUNT);
    rMesh.name = `taeniura-right-wing-${s}`;
    configureDynamicMesh(rMesh, 'taeniura');
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
    rays.push({
      tParam: t,
      pos: new THREE.Vector3(1.2 * Math.sin(t), 0.2, -2.0 + (i % DEFAULT_RAY_COUNT) * 2.5),
      vel: new THREE.Vector3(0, 0, 1),
      scale: 0.95 + (i % 2) * 0.14,
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
    if (Math.hypot(x, z) > 15.5) return false;
    if (sampleSubstrate && sampleSubstrate(x, z).onRock) return false;

    const h = getSeabedHeight(x, z);
    if (h >= -0.62) return false;

    const slopeX = getSeabedHeight(x + 0.25, z) - getSeabedHeight(x - 0.25, z);
    const slopeZ = getSeabedHeight(x, z + 0.25) - getSeabedHeight(x, z - 0.25);
    if (Math.hypot(slopeX, slopeZ) / 0.5 >= 0.13) return false;

    for (let c = 0; c < coralHeads.length; c++) {
      const ch = coralHeads[c];
      if (Math.hypot(x - ch.position.x, z - ch.position.z) < ch.radius + coralClearance) {
        return false;
      }
    }

    for (let e = 0; e < existingPositions.length; e++) {
      const ep = existingPositions[e];
      if (Math.hypot(x - ep.x, z - ep.z) < peerClearance) {
        return false;
      }
    }

    return true;
  }

  function findSandPatch(prefX, prefZ, rng, existingPositions = []) {
    const angleJitter = rng() * Math.PI * 2;
    for (let k = 0; k < 48; k++) {
      const r = k === 0 ? 0 : Math.sqrt(k / 47) * 4.5;
      const a = k === 0 ? 0 : angleJitter + k * 2.3999632 + (rng() - 0.5) * 0.25;
      const x = prefX + Math.cos(a) * r;
      const z = prefZ + Math.sin(a) * r;
      if (isValidSandPatch(x, z, existingPositions)) return { x, z };
    }
    return null;
  }

  function findInitialSandPatch(prefX, prefZ, rng, existingPositions = []) {
    const direct = findSandPatch(prefX, prefZ, rng, existingPositions);
    if (direct) return direct;
    const passes = [
      [0.36, 1.1],
      [0.18, 0.7],
      [0.0, 0.35],
    ];
    for (let p = 0; p < passes.length; p++) {
      const [coralClearance, peerClearance] = passes[p];
      let best = null;
      let bestDist = Infinity;
      for (let r = 0.25; r <= 18.0; r += 0.35) {
        const steps = Math.max(12, Math.ceil((2 * Math.PI * r) / 0.35));
        for (let s = 0; s < steps; s++) {
          const a = (s / steps) * Math.PI * 2;
          const x = prefX + Math.cos(a) * r;
          const z = prefZ + Math.sin(a) * r;
          if (isValidSandPatch(x, z, existingPositions, coralClearance, peerClearance)) {
            const d = Math.hypot(x - prefX, z - prefZ);
            if (d < bestDist) {
              bestDist = d;
              best = { x, z };
            }
          }
        }
        if (best) return best;
      }
    }
    return null;
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
    const pos = new THREE.Vector3(sx, getSeabedHeight(sx, sz) + 0.058 * scale, sz);
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
  const vFwd = new THREE.Vector3();
  const vRight = new THREE.Vector3();
  const vUp = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const segPos = new THREE.Vector3();
  const mRot = new THREE.Matrix4();
  const mLocal = new THREE.Matrix4();
  const qRot = new THREE.Quaternion();

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
      const isHunting = g.cleanState !== 'cleaning' && g.postCleanGrace <= 0;
      g.predEntry.radius = isHunting ? 2.05 : 0;
      g.predEntry.isActiveHunter = isHunting;
    }
    for (let i = nGrouper; i < groupers.length; i++) {
      const g = groupers[i];
      g.predEntry.radius = 0;
      g.predEntry.isActiveHunter = false;
      g.predEntry.vel.set(0, 0, 0);
      g.postCleanGrace = 0;
      if (g.cleanState === 'cleaning') {
        cleaningSystem?.releaseStation(g.clientKey);
        g.cleanState = 'none';
        g.cleanTarget = null;
      }
    }

    const nCaranx = Math.min(
      trevallies.length,
      sanitizeSpeciesCount('caranx', speciesCounts?.caranx ?? DEFAULT_CARANX_COUNT)
    );
    activeCounts.caranx = nCaranx;
    applyPairCount(caranxMeshes, nCaranx);
    for (let i = 0; i < trevallies.length; i++) {
      const active = i < nCaranx;
      trevallies[i].predEntry.radius = active ? 2.55 : 0;
      trevallies[i].predEntry.isActiveHunter = active;
      if (!active) trevallies[i].predEntry.vel.set(0, 0, 0);
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
    for (let i = 0; i < morays.length; i++) {
      const m = morays[i];
      const active = i < nMoray;
      m.predEntry.radius = active ? (m.isCrevice ? 0.95 : 1.85) : 0;
      m.predEntry.isActiveHunter = active && !m.isCrevice;
      if (!active || m.isCrevice) m.predEntry.vel.set(0, 0, 0);
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
    const surfaceLimitY = WORLD_CONSTANTS.SURFACE_BASE_Y + (envState?.diveDepth ?? 6.0) - 0.65;

    // 1. Coral Groupers
    const nGrouper = activeCounts.grouper;
    if (nGrouper > 0) {
      for (let i = 0; i < nGrouper; i++) {
        const g = groupers[i];
        let pitchOffset = 0;
        let tailAmp = 0.28;
        let bodySwimAmp = 0.014;
        let finSwimAmp = 0.009;

        if (g.cleanState === 'none') {
          g.postCleanGrace = Math.max(0, g.postCleanGrace - dt);
          g.cleanCooldown = Math.max(0, g.cleanCooldown - dt);
          if (g.cleanCooldown <= 0 && cleaningSystem) {
            const claim = cleaningSystem.tryAcquireStation(g.clientKey, g.pos, 2.95);
            if (claim) {
              g.cleanState = 'cleaning';
              g.cleanTarget = claim;
              g.cleanTimer = 5.2;
            }
          }
        }

        if (g.cleanState === 'cleaning' && g.cleanTarget && cleaningSystem) {
          g.predEntry.radius = 0; // Cleaning truce
          g.predEntry.isActiveHunter = false;
          const hover = g.cleanTarget.hoverPos;
          const targetY = Math.min(
            surfaceLimitY - 0.15,
            Math.max(getSeabedHeight(hover.x, hover.z) + 0.35, hover.y)
          );
          vDiff.set(hover.x - g.pos.x, targetY - g.pos.y, hover.z - g.pos.z);
          const distToHover = vDiff.length();

          if (distToHover > 0.18) {
            const desiredSpeed = THREE.MathUtils.clamp(distToHover * 1.4, 0.22, 0.68);
            vDiff.multiplyScalar(desiredSpeed / distToHover);
            g.vel.lerp(vDiff, Math.min(1, dt * 4.0));
            g.pos.addScaledVector(g.vel, dt);
            if (g.vel.lengthSq() > 1e-4) {
              safeNormalize(g.heading.copy(g.vel), g.heading.x, g.heading.y, g.heading.z);
            }
            pitchOffset = -0.06;
          } else {
            g.vel.multiplyScalar(Math.max(0, 1 - dt * 10.0));
            const sp = g.vel.length();
            if (sp > 0.04) {
              g.vel.multiplyScalar(0.04 / sp);
            }
            g.pos.addScaledVector(g.vel, dt);
            pitchOffset = -0.15;
            tailAmp = 0.12;
            // Broad paddle pectorals scull noticeably while hovering at cleaning station
            bodySwimAmp = 0.0045;
            finSwimAmp = 0.016;
          }

          g.pos.y = THREE.MathUtils.clamp(
            g.pos.y,
            Math.min(surfaceLimitY - 0.1, getSeabedHeight(g.pos.x, g.pos.z) + 0.35),
            surfaceLimitY
          );

          const poseOk = cleaningSystem.updateClientPose(
            g.clientKey,
            g.pos,
            g.vel.lengthSq() > 1e-4 ? g.vel : g.heading,
            0.22,
            'grouper'
          );
          g.cleanTimer -= dt;
          if (!poseOk || g.cleanTimer <= 0) {
            cleaningSystem.releaseStation(g.clientKey);
            g.cleanState = 'none';
            g.cleanTarget = null;
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
          const target = grouperWaypoints[g.targetIdx];
          vDiff.set(target.x - g.pos.x, target.y - g.pos.y, target.z - g.pos.z);
          const dist = vDiff.length();
          if (dist < 1.1) {
            g.targetIdx = (g.targetIdx + 1) % grouperWaypoints.length;
          } else if (dist > 1e-4) {
            g.vel.addScaledVector(vDiff, (0.95 / dist) * dt);
          }

          // Gentle steering around/above scaled active coralHeads
          for (let c = 0; c < coralHeads.length; c++) {
            const head = coralHeads[c];
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

          const floorY = getSeabedHeight(g.pos.x, g.pos.z) + 0.55;
          if (g.pos.y < floorY) g.vel.y += (floorY - g.pos.y) * 3.5 * dt;
          if (g.pos.y > surfaceLimitY) g.vel.y -= (g.pos.y - surfaceLimitY) * 4.0 * dt;

          const sp = g.vel.length();
          if (sp < 1e-5) g.vel.set(0.5, 0, 0);
          else g.vel.multiplyScalar(THREE.MathUtils.clamp(sp, 0.42, 0.78) / sp);
          g.pos.addScaledVector(g.vel, dt);

          // Post-step coral clearance above/around active coralHeads
          for (let c = 0; c < coralHeads.length; c++) {
            const head = coralHeads[c];
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

          g.pos.y = THREE.MathUtils.clamp(
            g.pos.y,
            Math.min(surfaceLimitY - 0.1, getSeabedHeight(g.pos.x, g.pos.z) + 0.35),
            surfaceLimitY
          );
          safeNormalize(g.heading.copy(g.vel), 0, 0, 1);
        }

        g.predEntry.pos.copy(g.pos);
        g.predEntry.vel.copy(g.vel);

        const swim = elapsedTime * 5.2 + g.phase;
        const { bodyMatrix, tailMatrix } = orientFishMatrix(
          g.pos,
          g.vel.lengthSq() > 1e-4 ? g.vel : g.heading,
          g.scale,
          Math.sin(swim) * 0.05,
          Math.sin(swim - 0.5) * tailAmp,
          pitchOffset,
          grouperMeshes.tailPivotZ,
          scratch
        );
        grouperMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
        grouperMeshes.tailMesh.setMatrixAt(i, tailMatrix);
        setSwimState(grouperMeshes.swimAttr, i, swim, bodySwimAmp, finSwimAmp);
      }
      grouperMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      grouperMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      grouperMeshes.swimAttr.needsUpdate = true;
    }

    // 2. Bluefin Trevally sweeping through winding sand canyon & blue water
    const nCaranx = activeCounts.caranx;
    if (nCaranx > 0) {
      for (let i = 0; i < nCaranx; i++) {
        const tr = trevallies[i];
        tr.tParam += tr.speed * dt;
        const z = Math.sin(tr.tParam) * 13.5 - 2.5;
        const canyonX = 2.4 * Math.sin(z * 0.19) + 1.1 * Math.cos(z * 0.08);
        const x = canyonX + Math.sin(tr.tParam * 2.0 + i) * 2.6;
        const y = THREE.MathUtils.clamp(
          Math.max(getSeabedHeight(x, z) + 0.85, tr.altitude + Math.sin(tr.tParam * 1.5) * 0.45),
          -2.5,
          surfaceLimitY - 0.25
        );

        vDiff.set(x - tr.pos.x, y - tr.pos.y, z - tr.pos.z);
        if (vDiff.lengthSq() > 1e-6) {
          tr.vel.lerp(safeNormalize(vDiff.clone(), 0, 0, -1).multiplyScalar(1.35), dt * 3.5);
        }
        tr.pos.addScaledVector(tr.vel, dt);
        tr.predEntry.pos.copy(tr.pos);
        tr.predEntry.vel.copy(tr.vel);
        tr.predEntry.radius = 2.55;
        tr.predEntry.isActiveHunter = true;

        const swim = elapsedTime * 7.8 + tr.phase;
        const { bodyMatrix, tailMatrix } = orientFishMatrix(
          tr.pos,
          tr.vel,
          tr.scale,
          Math.sin(swim) * 0.045,
          Math.sin(swim - 0.5) * 0.34,
          0,
          caranxMeshes.tailPivotZ,
          scratch
        );
        caranxMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
        caranxMeshes.tailMesh.setMatrixAt(i, tailMatrix);
        setSwimState(caranxMeshes.swimAttr, i, swim, 0.017, 0.011);
      }
      caranxMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      caranxMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      caranxMeshes.swimAttr.needsUpdate = true;
    }

    // 3. Lionfish hovering slowly near bommies & caves
    const nLion = activeCounts.pterois;
    if (nLion > 0) {
      for (let i = 0; i < nLion; i++) {
        const lf = lionfish[i];
        const orbitA = elapsedTime * 0.28 + lf.phase;
        const tx = lf.anchor.x + Math.cos(orbitA) * 0.72;
        const tz = lf.anchor.z + Math.sin(orbitA) * 0.72;
        const ty = THREE.MathUtils.clamp(
          Math.max(getSeabedHeight(tx, tz) + 0.48, lf.anchor.y + Math.sin(elapsedTime * 0.7 + lf.phase) * 0.22),
          -2.0,
          surfaceLimitY - 0.3
        );
        vDiff.set(tx - lf.pos.x, ty - lf.pos.y, tz - lf.pos.z);
        if (vDiff.lengthSq() > 1e-6) {
          lf.vel.lerp(safeNormalize(vDiff.clone(), 1, 0, 0).multiplyScalar(0.24), dt * 2.5);
        }
        lf.pos.addScaledVector(lf.vel, dt);
        lf.predEntry.pos.copy(lf.pos);
        lf.predEntry.vel.copy(lf.vel);
        lf.predEntry.radius = 0.95;
        lf.predEntry.isActiveHunter = false;

        const swim = elapsedTime * 2.6 + lf.phase;
        const { bodyMatrix, tailMatrix } = orientFishMatrix(
          lf.pos,
          lf.vel,
          lf.scale,
          Math.sin(swim) * 0.04,
          Math.sin(swim - 0.6) * 0.18,
          0.12,
          lionMeshes.tailPivotZ,
          scratch
        );
        lionMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
        lionMeshes.tailMesh.setMatrixAt(i, tailMatrix);
        setSwimState(lionMeshes.swimAttr, i, swim, 0.0035, 0.013);
      }
      lionMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      lionMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      lionMeshes.swimAttr.needsUpdate = true;
    }

    // 4. Giant Moray Eels (14-segment sinusoidal S-wave + gaping jaws)
    const nMoray = activeCounts.moray;
    if (nMoray > 0) {
      let segIdx = 0;
      for (let i = 0; i < nMoray; i++) {
        const m = morays[i];
        if (m.isCrevice) {
          const emerge = Math.sin(elapsedTime * 0.65 + m.phase) * 0.28;
          m.pos.set(
            m.anchor.x - 0.25 + emerge * 0.45,
            Math.max(getSeabedHeight(m.anchor.x, m.anchor.z) + 0.28, m.anchor.y),
            m.anchor.z + emerge * 0.35
          );
          m.vel.set(-0.6, 0.08, 0.45);
          m.predEntry.radius = 0.95;
          m.predEntry.isActiveHunter = false;
          m.predEntry.vel.set(0, 0, 0);
        } else {
          const patrolA = elapsedTime * 0.22 + m.phase;
          const tx = 2.4 * Math.sin((Math.cos(patrolA) * 6.0) * 0.19) + Math.sin(patrolA * 1.7) * 1.4;
          const tz = Math.cos(patrolA) * 6.5;
          const ty = Math.min(surfaceLimitY - 0.5, getSeabedHeight(tx, tz) + 0.26);
          vDiff.set(tx - m.pos.x, ty - m.pos.y, tz - m.pos.z);
          if (vDiff.lengthSq() > 1e-6) {
            m.vel.lerp(safeNormalize(vDiff.clone(), 0, 0, 1).multiplyScalar(0.65), dt * 3.0);
          }
          m.pos.addScaledVector(m.vel, dt);
          m.predEntry.radius = 1.85;
          m.predEntry.isActiveHunter = true;
          m.predEntry.vel.copy(m.vel);
        }
        m.predEntry.pos.copy(m.pos);

        vFwd.copy(m.vel);
        safeNormalize(vFwd, 0, 0, 1);
        vRight.crossVectors(worldUp, vFwd);
        safeNormalize(vRight, 1, 0, 0);
        vUp.crossVectors(vFwd, vRight);
        safeNormalize(vUp, 0, 1, 0);

        // Head matrix
        const headSway = Math.sin(elapsedTime * 3.6 + m.phase) * 0.08;
        mRot.makeBasis(vRight, vUp, vFwd);
        mLocal.makeRotationY(headSway);
        mRot.multiply(mLocal);
        qRot.setFromRotationMatrix(mRot);
        dummy.position.copy(m.pos);
        dummy.quaternion.copy(qRot);
        dummy.scale.setScalar(1.0);
        dummy.updateMatrix();
        morayHeadMesh.setMatrixAt(i, dummy.matrix);

        // Articulated gaping lower jaw
        const jawOpen = 0.14 + Math.max(0, Math.sin(elapsedTime * 1.9 + m.phase)) * 0.28;
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
          const waveAmp = (0.04 + frac * 0.12) * (m.isCrevice ? 0.45 : 1.0);
          const waveOffset = Math.sin(elapsedTime * 4.2 + m.phase - s * 0.58) * waveAmp;
          const distBack = (s + 0.65) * 0.088;

          segPos.set(
            m.pos.x - vFwd.x * distBack + vRight.x * waveOffset,
            Math.max(getSeabedHeight(m.pos.x - vFwd.x * distBack, m.pos.z - vFwd.z * distBack) + 0.09, m.pos.y - vFwd.y * distBack * 0.5),
            m.pos.z - vFwd.z * distBack + vRight.z * waveOffset
          );

          vDiff.set(prevX - segPos.x, prevY - segPos.y, prevZ - segPos.z);
          safeNormalize(vDiff, vFwd.x, vFwd.y, vFwd.z);
          const segRight = safeNormalize(new THREE.Vector3().crossVectors(worldUp, vDiff), 1, 0, 0);
          const segUp = safeNormalize(new THREE.Vector3().crossVectors(vDiff, segRight), 0, 1, 0);
          mRot.makeBasis(segRight, segUp, vDiff);
          qRot.setFromRotationMatrix(mRot);

          const taper = 1.0 - Math.pow(frac, 1.5) * 0.62;
          dummy.position.copy(segPos);
          dummy.quaternion.copy(qRot);
          dummy.scale.set(taper, taper, 1.0);
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

    // 5. Bluespotted Ribbontail Rays (Taeniura lymma — gliding with traveling wing wave)
    const nRay = activeCounts.taeniura;
    if (nRay > 0) {
      for (let i = 0; i < nRay; i++) {
        const r = rays[i];
        r.tParam += 0.16 * dt;
        const z = Math.sin(r.tParam) * 8.5 - 1.0;
        const canyonX = 2.4 * Math.sin(z * 0.19) + 1.1 * Math.cos(z * 0.08);
        const x = canyonX + Math.sin(r.tParam * 2.0 + i * 1.4) * 1.65;
        const floorY = getSeabedHeight(x, z);
        const targetY = Math.min(surfaceLimitY - 0.4, floorY + 0.34 + Math.sin(elapsedTime * 1.2 + r.phase) * 0.12);

        vDiff.set(x - r.pos.x, targetY - r.pos.y, z - r.pos.z);
        if (vDiff.lengthSq() > 1e-6) {
          r.vel.lerp(safeNormalize(vDiff.clone(), 0, 0, 1).multiplyScalar(0.72), dt * 2.5);
        }
        r.pos.addScaledVector(r.vel, dt);

        vFwd.copy(r.vel);
        safeNormalize(vFwd, 0, 0, 1);
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

        // Undulating pectoral wing strips (traveling sinusoidal wave front -> back)
        for (let s = 0; s < 3; s++) {
          const wave = Math.sin(elapsedTime * 4.4 + r.phase - s * 0.95) * 0.24;
          const zOff = wingZOffsets[s] * r.scale;
          const stripPos = r.pos.clone().addScaledVector(vFwd, zOff);

          // Left wing rolls opposite sign in Z relative to right wing
          mLocal.makeRotationZ(wave);
          const mL = mRot.clone().multiply(mLocal);
          qRot.setFromRotationMatrix(mL);
          dummy.position.copy(stripPos);
          dummy.quaternion.copy(qRot);
          dummy.scale.setScalar(r.scale);
          dummy.updateMatrix();
          wingMeshes.left[s].setMatrixAt(i, dummy.matrix);

          mLocal.makeRotationZ(-wave);
          const mR = mRot.clone().multiply(mLocal);
          qRot.setFromRotationMatrix(mR);
          dummy.position.copy(stripPos);
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

    // 6. Red Sea Sand Lizardfish (Sit-and-Wait Ambush State Machine)
    const nLizard = activeCounts.lizardfish;
    if (nLizard > 0) {
      for (let i = 0; i < nLizard; i++) {
        const lz = lizards[i];
        let pitchOffset = -0.21;
        let bodyYaw = 0;
        let tailYaw = 0;
        let swimPhase = elapsedTime * 3.0 + lz.phase;
        let bodySwimAmp = 0.001;
        let finSwimAmp = 0.0045;

        if (lz.state === 'perched') {
          lz.waitTimer -= dt;
          lz.vel.set(0, 0, 0);
          lz.pos.y = getSeabedHeight(lz.pos.x, lz.pos.z) + 0.058 * lz.scale;
          lz.predEntry.radius = 0;
          lz.predEntry.isActiveHunter = false;
          lz.predEntry.vel.set(0, 0, 0);
          pitchOffset = -0.21;

          if (lz.waitTimer < 0.45) {
            bodyYaw = Math.sin(elapsedTime * 24.0 + lz.phase) * 0.06;
          }
          tailYaw = Math.sin(elapsedTime * 2.4 + lz.phase) * 0.035;

          if (lz.waitTimer <= 0) {
            const otherPositions = [];
            for (let j = 0; j < nLizard; j++) {
              if (j !== i) otherPositions.push(lizards[j].pos);
            }
            const baseAngle = Math.atan2(lz.heading.x, lz.heading.z);
            let chosenPatch = null;
            for (let attempt = 0; attempt < 6; attempt++) {
              const searchDist = 1.15 + lizardRng() * 0.90;
              const searchAngle = baseAngle + (lizardRng() - 0.5) * (attempt === 0 ? 2.4 : Math.PI * 2);
              const candX = lz.pos.x + Math.sin(searchAngle) * searchDist;
              const candZ = lz.pos.z + Math.cos(searchAngle) * searchDist;
              const nextPatch = findSandPatch(candX, candZ, lizardRng, otherPositions);
              const dist2D = nextPatch ? Math.hypot(nextPatch.x - lz.pos.x, nextPatch.z - lz.pos.z) : 0;
              if (nextPatch && dist2D > 0.45 && dist2D <= 2.45) {
                chosenPatch = nextPatch;
                break;
              }
            }

            if (chosenPatch) {
              lz.state = 'ambush';
              lz.strikeElapsed = 0;
              lz.strikeDuration = 0.48 + lizardRng() * 0.14;
              lz.startPos.copy(lz.pos);
              lz.targetPos.set(
                chosenPatch.x,
                getSeabedHeight(chosenPatch.x, chosenPatch.z) + 0.058 * lz.scale,
                chosenPatch.z
              );
              lz.apexHeight = 0.36 + lizardRng() * 0.24;
              lz.heading.set(chosenPatch.x - lz.pos.x, 0, chosenPatch.z - lz.pos.z).normalize();
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
          const baseY = getSeabedHeight(nx, nz) + 0.058 * lz.scale;
          const arcY = Math.sin(Math.pow(u, 0.75) * Math.PI) * lz.apexHeight;
          const ny = Math.min(surfaceLimitY - 0.25, baseY + arcY);

          lz.vel.set((nx - lz.pos.x) / dt, (ny - lz.pos.y) / dt, (nz - lz.pos.z) / dt);
          lz.pos.set(nx, ny, nz);
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
          bodySwimAmp = THREE.MathUtils.lerp(0.001, 0.018, strikeRamp);
          finSwimAmp = THREE.MathUtils.lerp(0.0045, 0.010, strikeRamp);

          if (u >= 1) {
            lz.state = 'perched';
            lz.pos.copy(lz.targetPos);
            lz.vel.set(0, 0, 0);
            lz.predEntry.radius = 0;
            lz.predEntry.isActiveHunter = false;
            lz.predEntry.vel.set(0, 0, 0);
            lz.waitTimer = 4.5 + lizardRng() * 4.8;
            pitchOffset = -0.21;
            tailYaw = 0;
            bodyYaw = 0;
            bodySwimAmp = 0.001;
            finSwimAmp = 0.0045;
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
          scratch
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
    lizardfish: lizards,
    applySpeciesCounts,
    getActiveCounts: () => ({ ...activeCounts }),
    update,
  };
}
