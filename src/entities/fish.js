import * as THREE from 'three';
import { SPECIES_POPULATION_SPEC, WORLD_CONSTANTS, sanitizeSpeciesCount } from '../contracts.js';
import {
  PART_BODY,
  PART_MEDIAN_FIN,
  addFishEyes,
  attachSwimStateAttribute,
  buildFinStrip,
  buildPairedPectoralFins,
  buildPairedPelvicFins,
  buildParametricFishBody,
  computeUAttach,
  createAnimatedFishMaterial,
  createMatrixScratch,
  orientFishMatrix,
  prepareFishPart,
  setSwimState,
} from './fishGeometry.js';
import { configureDynamicMesh, createRng, safeMerge, safeNormalize } from './utils.js';

const CHROMIS_SPEC = SPECIES_POPULATION_SPEC.chromis ?? { defaultCount: 110, maxCount: 190, step: 10, group: 'fish' };

// -----------------------------------------------------------------------------
// 1. Pseudanthias squamipinnis (Sea Goldies — Female & Supermale Dimorphism)
// -----------------------------------------------------------------------------
function buildAnthiasFemalePrototype() {
  const parts = [];
  const length = 0.148;
  const tailPivotZ = 0.064;
  const cTangerine = new THREE.Color('#ff8c12');
  const cYellow = new THREE.Color('#ffd629');
  const cFinGold = new THREE.Color('#ffcf3a');
  const cStreak = new THREE.Color('#8c5eff');
  const cEyeRing = new THREE.Color('#8e62ff');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight: 0.029,
      halfWidth: 0.016,
      segsU: 44,
      segsV: 24,
      dorsalProfile: (u) => {
        if (u < 0.14) return 0.22 + (u / 0.14) * 0.36;
        if (u < 0.66) return 0.58 + Math.sin(((u - 0.14) / 0.52) * Math.PI * 0.58) * 0.44;
        return Math.pow(Math.max(0, (1 - u) / 0.34), 0.62) * 1.00;
      },
      ventralProfile: (u) => {
        if (u < 0.14) return 0.21 + (u / 0.14) * 0.30;
        if (u < 0.60) return 0.51 + Math.sin(((u - 0.14) / 0.46) * Math.PI * 0.62) * 0.36;
        return Math.pow(Math.max(0, (1 - u) / 0.40), 0.72) * 0.85;
      },
      widthProfile: (u) => Math.max(0.14, Math.sin(Math.pow(u, 0.72) * Math.PI) * 0.96),
      dorsalSharpness: 0.22,
      operculumRidge: 0.07,
      tailPivotZ,
      colorFn: (zNorm, yNorm, _xNorm, out) => {
        out.copy(cTangerine);
        // Smooth grade into sunny canary-yellow throat & belly
        const bellyT = THREE.MathUtils.clamp((-yNorm - 0.05) * 0.95 + (zNorm > 0.25 ? (zNorm - 0.25) * 0.45 : 0), 0, 1);
        if (bellyT > 0) out.lerp(cYellow, bellyT);
        // Oblique violet-blue suborbital cheek streak from below eye toward pectoral base
        const cheekLine = -0.02 - (0.62 - zNorm) * 1.32;
        if (zNorm > 0.28 && zNorm < 0.68 && Math.abs(yNorm - cheekLine) < 0.13) {
          out.lerp(cStreak, 0.86);
        }
      },
    })
  );

  // Smooth low-arched continuous dorsal fin WITHOUT elongated spine filament (max y = 0.036)
  parts.push(
    buildFinStrip(
      [
        [-0.042, 0.009],
        [-0.046, 0.029],
        [-0.020, 0.035],
        [0.005, 0.036],
        [0.024, 0.033],
        [0.036, 0.018],
      ],
      0.0022,
      (_x, y, _z, out) => {
        const edge = THREE.MathUtils.clamp((y - 0.024) / 0.012, 0, 1);
        out.copy(cTangerine).lerp(cFinGold, 0.35 + edge * 0.45);
      },
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Translucent golden-yellow anal fin
  parts.push(
    buildFinStrip(
      [[-0.044, -0.008], [-0.042, -0.032], [-0.022, -0.035], [-0.005, -0.024], [0.004, -0.015]],
      0.0020,
      (_x, _y, _z, out) => out.copy(cYellow).lerp(cFinGold, 0.4),
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Translucent golden-yellow pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.022,
      yPos: -0.018,
      xOffset: 0.004,
      length: 0.034,
      width: 0.010,
      splay: 0.26,
      dip: -0.48,
      thickness: 0.0016,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, _y, _z, out) => out.copy(cYellow).lerp(cFinGold, 0.35),
    })
  );

  // Translucent golden-yellow pectoral fins
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.027,
      yPos: -0.004,
      xOffset: 0.013,
      span: 0.026,
      chord: 0.020,
      sweep: -0.44,
      dihedral: -0.14,
      flare: 0.88,
      thickness: 0.0016,
      bodyLength: length,
      tailPivotZ,
      shape: 'fan',
      colorFn: (_x, _y, _z, out) => out.copy(cYellow).lerp(cFinGold, 0.30),
    })
  );

  // Violet-rimmed eye (#8e62ff outer ring around #ffd24c iris)
  const eyeZ = 0.050;
  const eyeY = 0.0055;
  const eyeX = 0.0095;
  const eyeR = 0.0048;
  const eyeU = computeUAttach(eyeZ, length, tailPivotZ);
  for (const side of [-1, 1]) {
    const ring = new THREE.SphereGeometry(eyeR * 1.28, 10, 8);
    ring.scale(0.46, 1.0, 1.0);
    ring.translate(side * (eyeX - 0.0005), eyeY, eyeZ);
    parts.push(prepareFishPart(ring, cEyeRing, [PART_BODY, 0, eyeU, 0]));
    ring.dispose();
  }
  addFishEyes(parts, eyeZ, eyeY, eyeX, eyeR, '#ffd24c', { bodyLength: length, tailPivotZ });
  const bodyGeom = safeMerge(parts);

  // Forked golden-orange lyretail
  const tailGeom = buildFinStrip(
    [
      [0.0, 0.006],
      [-0.032, 0.022],
      [-0.068, 0.039],
      [-0.050, 0.020],
      [-0.028, 0.008],
      [-0.021, 0.0],
      [-0.028, -0.008],
      [-0.050, -0.020],
      [-0.068, -0.039],
      [-0.032, -0.022],
      [0.0, -0.006],
    ],
    0.0022,
    (_x, y, z, out) => {
      const tip = THREE.MathUtils.clamp((-z - 0.024) / 0.040 + Math.max(0, Math.abs(y) - 0.015) * 20.0, 0, 1);
      out.copy(cTangerine).lerp(cYellow, 0.20 + tip * 0.45);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );
  return { bodyGeom, tailGeom, tailPivotZ };
}

function buildAnthiasMalePrototype() {
  const parts = [];
  const length = 0.174;
  const tailPivotZ = 0.075;
  const cCrimson = new THREE.Color('#d83252');
  const cSpineRed = new THREE.Color('#d62849');
  const cBlotch = new THREE.Color('#e81c4f');
  const cSaddle = new THREE.Color('#f3ad98');
  const cPecBase = new THREE.Color('#f29e90');
  const cLyreTip = new THREE.Color('#a81f4e');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight: 0.037,
      halfWidth: 0.019,
      segsU: 46,
      segsV: 24,
      dorsalProfile: (u) => {
        if (u < 0.14) return 0.24 + (u / 0.14) * 0.38;
        if (u < 0.66) return 0.62 + Math.sin(((u - 0.14) / 0.52) * Math.PI * 0.58) * 0.44;
        return Math.pow(Math.max(0, (1 - u) / 0.34), 0.60) * 1.04;
      },
      ventralProfile: (u) => {
        if (u < 0.14) return 0.23 + (u / 0.14) * 0.32;
        if (u < 0.60) return 0.55 + Math.sin(((u - 0.14) / 0.46) * Math.PI * 0.62) * 0.38;
        return Math.pow(Math.max(0, (1 - u) / 0.40), 0.70) * 0.90;
      },
      widthProfile: (u) => Math.max(0.15, Math.sin(Math.pow(u, 0.72) * Math.PI) * 0.98),
      dorsalSharpness: 0.28,
      operculumRidge: 0.09,
      tailPivotZ,
      colorFn: (zNorm, yNorm, _xNorm, out) => {
        // Paler rosy-peach / golden-pink central flank saddle framed by crimson-fuchsia
        out.copy(cSaddle);
        const headMask = THREE.MathUtils.clamp((zNorm - 0.20) / 0.28, 0, 1);
        const dorsalMask = THREE.MathUtils.clamp((yNorm - 0.18) / 0.32, 0, 1);
        const peduncleMask = THREE.MathUtils.clamp((-zNorm - 0.22) / 0.28, 0, 1);
        const crimsonWeight = Math.max(headMask, dorsalMask, peduncleMask);
        if (crimsonWeight > 0) {
          out.lerp(cCrimson, crimsonWeight);
        }
      },
    })
  );

  // Continuous dorsal fin with dramatic swept elongated 3rd dorsal spine filament rising to y = 0.078
  parts.push(
    buildFinStrip(
      [
        [-0.048, 0.012],
        [-0.052, 0.036],
        [-0.022, 0.044],
        [0.002, 0.049],
        [0.014, 0.055],
        [0.007, 0.078],
        [0.025, 0.062],
        [0.036, 0.042],
        [0.044, 0.022],
      ],
      0.0025,
      (_x, y, _z, out) => {
        const banner = THREE.MathUtils.clamp((y - 0.040) / 0.025, 0, 1);
        out.copy(cCrimson).lerp(cSpineRed, banner);
      },
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Pointed anal fin
  parts.push(
    buildFinStrip(
      [[-0.050, -0.010], [-0.048, -0.038], [-0.026, -0.042], [-0.006, -0.028], [0.005, -0.018]],
      0.0024,
      (_x, y, _z, out) => out.copy(cSaddle).lerp(cCrimson, THREE.MathUtils.clamp((-y - 0.020) / 0.018, 0, 0.72)),
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Crimson-reddish pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.026,
      yPos: -0.023,
      xOffset: 0.004,
      length: 0.045,
      width: 0.013,
      splay: 0.28,
      dip: -0.52,
      thickness: 0.0019,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, y, _z, out) => {
        const tip = THREE.MathUtils.clamp((-y - 0.024) / 0.018, 0, 1);
        out.copy(cCrimson).lerp(cSpineRed, tip * 0.85);
      },
    })
  );

  // Sculling pectoral fins with signature vivid magenta-crimson blotch (#e81c4f) on outer-upper region
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.033,
      yPos: -0.005,
      xOffset: 0.015,
      span: 0.031,
      chord: 0.024,
      sweep: -0.44,
      dihedral: -0.10,
      flare: 0.88,
      thickness: 0.0019,
      bodyLength: length,
      tailPivotZ,
      shape: 'fan',
      colorFn: (x, y, z, out) => {
        const dist = Math.hypot(Math.max(0, Math.abs(x) - 0.015), y + 0.005, z - 0.033);
        const upper = THREE.MathUtils.clamp((y + 0.010) / 0.012, 0, 1);
        const outer = THREE.MathUtils.clamp((dist - 0.014) / 0.010, 0, 1);
        out.copy(cPecBase).lerp(cBlotch, outer * upper);
      },
    })
  );

  addFishEyes(parts, 0.060, 0.007, 0.0112, 0.0054, '#f0b898', { bodyLength: length, tailPivotZ });
  const bodyGeom = safeMerge(parts);

  // Deeply lunate crimson-violet lyretail lobes
  const tailGeom = buildFinStrip(
    [
      [0.0, 0.008],
      [-0.040, 0.027],
      [-0.088, 0.052],
      [-0.066, 0.027],
      [-0.035, 0.010],
      [-0.026, 0.0],
      [-0.035, -0.010],
      [-0.066, -0.027],
      [-0.088, -0.052],
      [-0.040, -0.027],
      [0.0, -0.008],
    ],
    0.0025,
    (_x, y, z, out) => {
      const tip = THREE.MathUtils.clamp((-z - 0.030) / 0.052 + Math.max(0, Math.abs(y) - 0.018) * 18.0, 0, 1);
      out.copy(cCrimson).lerp(cLyreTip, tip * 0.78);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );
  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 1b. Chromis viridis (Blue-Green Chromis)
// -----------------------------------------------------------------------------
function buildChromisPrototype() {
  const parts = [];
  const length = 0.095;
  const tailPivotZ = 0.041;
  const cDorsum = new THREE.Color('#2cd4b2');
  const cFlank = new THREE.Color('#6ce6f8');
  const cBelly = new THREE.Color('#dcfcff');
  const cSnout = new THREE.Color('#b8e876');
  const cFin = new THREE.Color('#9af0fc');
  const cTailEdge = new THREE.Color('#1ea8c8');
  const cTailWeb = new THREE.Color('#ccf7ff');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight: 0.025,
      halfWidth: 0.0125,
      segsU: 38,
      segsV: 22,
      dorsalProfile: (u) => {
        if (u < 0.16) return 0.20 + (u / 0.16) * 0.36;
        if (u < 0.72) return 0.56 + Math.sin(((u - 0.16) / 0.56) * Math.PI * 0.62) * 0.44;
        return Math.pow(Math.max(0, (1 - u) / 0.28), 0.64) * 0.92;
      },
      ventralProfile: (u) => {
        if (u < 0.16) return 0.20 + (u / 0.16) * 0.34;
        if (u < 0.70) return 0.54 + Math.sin(((u - 0.16) / 0.54) * Math.PI * 0.64) * 0.40;
        return Math.pow(Math.max(0, (1 - u) / 0.30), 0.68) * 0.88;
      },
      widthProfile: (u) => Math.max(0.14, Math.sin(Math.pow(u, 0.72) * Math.PI) * 0.94),
      dorsalSharpness: 0.20,
      operculumRidge: 0.05,
      tailPivotZ,
      colorFn: (zNorm, yNorm, _xNorm, out) => {
        out.copy(cFlank);
        if (yNorm > 0.12) out.lerp(cDorsum, THREE.MathUtils.clamp((yNorm - 0.12) * 1.35, 0, 1));
        else if (yNorm < -0.15) out.lerp(cBelly, THREE.MathUtils.clamp((-yNorm - 0.15) * 1.30, 0, 1));
        if (zNorm > 0.62 && yNorm > -0.18) {
          out.lerp(cSnout, THREE.MathUtils.clamp((zNorm - 0.62) / 0.35, 0, 0.72));
        }
      },
    })
  );

  // Translucent cyan-tinted continuous dorsal fin
  parts.push(
    buildFinStrip(
      [[-0.028, 0.007], [-0.032, 0.021], [-0.016, 0.028], [0.006, 0.028], [0.022, 0.015]],
      0.0016,
      (_x, y, _z, out) => out.copy(cDorsum).lerp(cFin, THREE.MathUtils.clamp((y - 0.014) / 0.014, 0.25, 0.85)),
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Translucent cyan-tinted anal fin
  parts.push(
    buildFinStrip(
      [[-0.028, -0.006], [-0.032, -0.019], [-0.014, -0.024], [0.004, -0.013]],
      0.0016,
      (_x, _y, _z, out) => out.copy(cFin).lerp(cBelly, 0.35),
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Translucent pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.014,
      yPos: -0.016,
      xOffset: 0.003,
      length: 0.022,
      width: 0.008,
      splay: 0.26,
      dip: -0.45,
      thickness: 0.0014,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, _y, _z, out) => out.copy(cBelly).lerp(cFin, 0.45),
    })
  );

  // Translucent pectoral fins
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.019,
      yPos: -0.004,
      xOffset: 0.0095,
      span: 0.019,
      chord: 0.015,
      sweep: -0.42,
      dihedral: -0.12,
      flare: 0.88,
      thickness: 0.0014,
      bodyLength: length,
      tailPivotZ,
      shape: 'fan',
      colorFn: (_x, _y, _z, out) => out.copy(cFin).lerp(cBelly, 0.35),
    })
  );

  addFishEyes(parts, 0.033, 0.005, 0.0072, 0.0036, '#a8f4ff', { bodyLength: length, tailPivotZ });
  const bodyGeom = safeMerge(parts);

  // Deeply forked scissor-like caudal fin with darker turquoise-blue outer margins & pale inner web
  const tailGeom = buildFinStrip(
    [
      [0.0, 0.005],
      [-0.022, 0.017],
      [-0.044, 0.028],
      [-0.030, 0.011],
      [-0.017, 0.0],
      [-0.030, -0.011],
      [-0.044, -0.028],
      [-0.022, -0.017],
      [0.0, -0.005],
    ],
    0.0016,
    (_x, y, z, out) => {
      const ay = Math.abs(y);
      const outerMargin = THREE.MathUtils.clamp((ay - (0.005 + (-z) * 0.36)) / 0.008, 0, 1);
      const tipWeight = THREE.MathUtils.clamp((-z - 0.026) / 0.018, 0, 1);
      out.copy(cTailWeb).lerp(cTailEdge, Math.max(outerMargin, tipWeight * 0.85));
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );
  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 2. Abudefduf vaigiensis (Indo-Pacific Sergeant — lemon-yellow back, silver-blue flanks, 5 black bars)
// -----------------------------------------------------------------------------
function buildSergeantMajorPrototype() {
  const parts = [];
  const length = 0.165;
  const tailPivotZ = 0.078;
  const cSilver = new THREE.Color('#c8dfee');
  const cBelly = new THREE.Color('#e6f1fa');
  const cYellow = new THREE.Color('#f2d027');
  const cBlack = new THREE.Color('#161920');
  const cFinEdge = new THREE.Color('#8ea5b8');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight: 0.048,
      halfWidth: 0.021,
      segsU: 46,
      segsV: 24,
      dorsalProfile: (u) =>
        u < 0.14 ? 0.24 + (u / 0.14) * 0.38 : Math.pow(Math.sin(Math.pow(u, 0.86) * Math.PI), 0.52),
      ventralProfile: (u) =>
        u < 0.14 ? 0.23 + (u / 0.14) * 0.35 : Math.pow(Math.sin(u * Math.PI), 0.58) * 0.94,
      widthProfile: (u) => Math.max(0.16, Math.sin(Math.pow(u, 0.70) * Math.PI) * 0.94),
      dorsalSharpness: 0.30,
      operculumRidge: 0.07,
      tailPivotZ,
      colorFn: (zNorm, yNorm, _xNorm, out) => {
        out.copy(cSilver);
        if (yNorm < -0.25) out.lerp(cBelly, THREE.MathUtils.clamp((-yNorm - 0.25) * 1.2, 0, 0.85));
        if (yNorm > 0.12) out.lerp(cYellow, THREE.MathUtils.clamp((yNorm - 0.12) * 1.25, 0, 1));
        // 5 clean jet-black vertical bars tapering slightly toward belly
        const bars = [0.40, 0.17, -0.06, -0.29, -0.52];
        const barHalfW = 0.048 * THREE.MathUtils.clamp(1.0 + yNorm * 0.26, 0.56, 1.12);
        if (yNorm > -0.82) {
          for (let b = 0; b < bars.length; b++) {
            if (Math.abs(zNorm - bars[b]) < barHalfW) {
              out.copy(cBlack);
              break;
            }
          }
        }
        // Dark spot at upper pectoral base
        if (zNorm > 0.44 && zNorm < 0.54 && yNorm > -0.20 && yNorm < 0.02) {
          out.lerp(cBlack, 0.85);
        }
      },
    })
  );

  // Spiny + soft continuous dorsal fin
  parts.push(
    buildFinStrip(
      [
        [-0.052, 0.014],
        [-0.056, 0.032],
        [-0.048, 0.054],
        [-0.030, 0.064],
        [-0.008, 0.056],
        [0.018, 0.058],
        [0.034, 0.050],
        [0.042, 0.026],
      ],
      0.0026,
      (_x, y, z, out) => {
        out.copy(cYellow);
        if (z < -0.024) out.lerp(cBlack, THREE.MathUtils.clamp((-z - 0.024) / 0.026, 0, 0.72));
        if (y > 0.056) out.lerp(cBlack, 0.35);
      },
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Pointed anal fin
  parts.push(
    buildFinStrip(
      [[-0.050, -0.014], [-0.052, -0.034], [-0.036, -0.050], [-0.012, -0.042], [0.006, -0.024]],
      0.0026,
      (_x, y, _z, out) => out.copy(cSilver).lerp(cFinEdge, THREE.MathUtils.clamp((-y - 0.024) / 0.026, 0, 0.8)),
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Thoracic pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.026,
      yPos: -0.033,
      xOffset: 0.005,
      length: 0.032,
      width: 0.013,
      splay: 0.30,
      dip: -0.45,
      thickness: 0.0020,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, _y, _z, out) => out.copy(cBelly),
    })
  );

  // Paired pectoral fans with dark upper pectoral base spot
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.034,
      yPos: -0.006,
      xOffset: 0.017,
      span: 0.030,
      chord: 0.023,
      sweep: -0.38,
      dihedral: -0.10,
      flare: 0.88,
      thickness: 0.0020,
      bodyLength: length,
      tailPivotZ,
      shape: 'fan',
      colorFn: (x, y, z, out) => {
        out.copy(cBelly);
        if (Math.abs(x) < 0.022 && y > -0.006 && z > 0.028) out.lerp(cBlack, 0.90);
      },
    })
  );

  addFishEyes(parts, 0.058, 0.011, 0.0135, 0.0056, '#d6c87a', { bodyLength: length, tailPivotZ });
  const bodyGeom = safeMerge(parts);

  // Deeply forked scissor tail
  const tailGeom = buildFinStrip(
    [
      [0.0, 0.009],
      [-0.034, 0.025],
      [-0.062, 0.040],
      [-0.042, 0.016],
      [-0.026, 0.0],
      [-0.042, -0.016],
      [-0.062, -0.040],
      [-0.034, -0.025],
      [0.0, -0.009],
    ],
    0.0026,
    (_x, y, z, out) => {
      const outer = THREE.MathUtils.clamp((-z - 0.014) / 0.042 + Math.abs(y) * 14.0, 0, 1);
      out.copy(cBlack).lerp(cFinEdge, outer * 0.55);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );
  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 3. Parupeneus forsskali (Red Sea Goatfish — black lateral stripe + yellow flank + chin barbels)
// -----------------------------------------------------------------------------
function buildGoatfishPrototype() {
  const parts = [];
  const length = 0.24;
  const tailPivotZ = 0.114;
  const cSilver = new THREE.Color('#e4e8ee');
  const cPink = new THREE.Color('#e4a6b0');
  const cBelly = new THREE.Color('#f2eef2');
  const cStripe = new THREE.Color('#16181e');
  const cYellow = new THREE.Color('#ffd224');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight: 0.039,
      halfWidth: 0.024,
      segsU: 42,
      segsV: 22,
      dorsalProfile: (u) => {
        if (u < 0.14) return 0.22 + (u / 0.14) * 0.36;
        if (u < 0.58) return 0.58 + Math.sin(((u - 0.14) / 0.44) * Math.PI * 0.56) * 0.46;
        return 0.18 + Math.pow(Math.max(0, (1 - u) / 0.42), 0.78) * 0.85;
      },
      ventralProfile: (u) => {
        if (u < 0.14) return 0.21 + (u / 0.14) * 0.30;
        if (u < 0.78) return 0.51 + Math.sin(((u - 0.14) / 0.64) * Math.PI) * 0.25;
        return 0.16 + Math.pow(Math.max(0, (1 - u) / 0.22), 0.72) * 0.35;
      },
      spineYOffset: (u) => (u > 0.65 ? -0.18 * Math.pow((u - 0.65) / 0.35, 1.3) : 0),
      widthProfile: (u) => Math.max(0.16, Math.sin(Math.pow(u, 0.72) * Math.PI) * 0.94),
      ventralFlatness: 0.38,
      operculumRidge: 0.08,
      tailPivotZ,
      colorFn: (zNorm, yNorm, _xNorm, out) => {
        out.copy(cSilver);
        if (yNorm > 0) out.lerp(cPink, THREE.MathUtils.clamp(yNorm * 0.65 + 0.15, 0, 0.72));
        else out.lerp(cBelly, THREE.MathUtils.clamp(-yNorm * 0.8, 0, 0.7));
        // Vivid canary-yellow upper flank posterior to stripe
        if (zNorm < -0.06 && zNorm > -0.52 && yNorm > 0.22) {
          const yFade = THREE.MathUtils.clamp((yNorm - 0.22) / 0.20, 0, 1);
          out.lerp(cYellow, yFade);
        }
        // Bold jet-black lateral stripe from snout tip through eye to below 2nd dorsal
        const stripeY = 0.06 + zNorm * 0.05;
        if (zNorm > -0.36 && zNorm < 0.96 && Math.abs(yNorm - stripeY) < 0.16) {
          out.copy(cStripe);
        }
        // Black caudal peduncle saddle blotch
        if (zNorm < -0.56 && zNorm > -0.80 && yNorm > -0.22) {
          out.copy(cStripe);
        }
      },
    })
  );

  // Two forward-curved yellow chin barbels probing sand (wrapped via prepareFishPart)
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.005, -0.017, 0.098),
      new THREE.Vector3(side * 0.007, -0.030, 0.106),
      new THREE.Vector3(side * 0.009, -0.041, 0.117),
      new THREE.Vector3(side * 0.010, -0.047, 0.128),
    ]);
    const barbel = new THREE.TubeGeometry(curve, 6, 0.0022, 5, false);
    parts.push(
      prepareFishPart(barbel, cYellow, (_x, y, z) => [
        PART_MEDIAN_FIN,
        THREE.MathUtils.clamp((-0.017 - y) / 0.030, 0, 1) * 0.35,
        computeUAttach(z, length, tailPivotZ),
        0.35,
      ])
    );
    barbel.dispose();
  }

  // Separated 1st triangular dorsal fin (canary-yellow)
  parts.push(
    buildFinStrip(
      [[0.002, 0.025], [0.012, 0.058], [0.028, 0.072], [0.044, 0.023]],
      0.0024,
      (_x, y, _z, out) => out.copy(cPink).lerp(cYellow, THREE.MathUtils.clamp((y - 0.026) / 0.025, 0, 1)),
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Separated 2nd dorsal fin
  parts.push(
    buildFinStrip(
      [[-0.074, 0.014], [-0.082, 0.028], [-0.068, 0.046], [-0.034, 0.054], [-0.024, 0.022]],
      0.0024,
      (_x, y, _z, out) => out.copy(cPink).lerp(cYellow, THREE.MathUtils.clamp((y - 0.024) / 0.025, 0, 0.7)),
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Anal fin
  parts.push(
    buildFinStrip(
      [[-0.072, -0.012], [-0.076, -0.034], [-0.040, -0.046], [-0.024, -0.018]],
      0.0024,
      (_x, _y, _z, out) => out.copy(cBelly).lerp(cPink, 0.35),
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.038,
      yPos: -0.024,
      xOffset: 0.006,
      length: 0.044,
      width: 0.017,
      splay: 0.34,
      dip: -0.42,
      thickness: 0.0022,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, _y, _z, out) => out.copy(cBelly).lerp(cPink, 0.30),
    })
  );

  // Pectoral fins
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.048,
      yPos: -0.006,
      xOffset: 0.019,
      span: 0.038,
      chord: 0.024,
      sweep: -0.45,
      dihedral: -0.14,
      flare: 0.85,
      thickness: 0.0022,
      bodyLength: length,
      tailPivotZ,
      shape: 'fan',
      colorFn: (_x, _y, _z, out) => out.copy(cPink).lerp(cYellow, 0.25),
    })
  );

  addFishEyes(parts, 0.078, 0.012, 0.015, 0.0060, '#ffd65c', { bodyLength: length, tailPivotZ });
  const bodyGeom = safeMerge(parts);

  // Yellow forked tail
  const tailGeom = buildFinStrip(
    [
      [0.0, 0.009],
      [-0.040, 0.028],
      [-0.070, 0.045],
      [-0.048, 0.016],
      [-0.032, 0.0],
      [-0.048, -0.016],
      [-0.070, -0.045],
      [-0.040, -0.028],
      [0.0, -0.009],
    ],
    0.0026,
    (_x, y, z, out) => {
      const lobe = THREE.MathUtils.clamp((-z - 0.012) / 0.042 + Math.abs(y) * 10.0, 0, 1);
      out.copy(cPink).lerp(cYellow, 0.45 + lobe * 0.55);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );
  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 4. Amphiprion bicinctus (Red Sea Two-Band Clownfish)
// -----------------------------------------------------------------------------
function buildClownfishPrototype() {
  const parts = [];
  const length = 0.205; // ~1.5x prominent size (0.18-0.23m with scale)
  const tailPivotZ = 0.096;
  const cBody = new THREE.Color('#f56c10');
  const cBelly = new THREE.Color('#ffa22e');
  const cWhite = new THREE.Color('#fafcff');
  const cRim = new THREE.Color('#141110');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight: 0.056,
      halfWidth: 0.033,
      segsU: 46,
      segsV: 24,
      dorsalProfile: (u) => (u < 0.14 ? 0.30 + (u / 0.14) * 0.36 : Math.pow(Math.sin(u * Math.PI), 0.56)),
      ventralProfile: (u) => (u < 0.14 ? 0.28 + (u / 0.14) * 0.36 : Math.pow(Math.sin(u * Math.PI), 0.58)),
      widthProfile: (u) => Math.max(0.18, Math.sin(Math.pow(u, 0.68) * Math.PI) * 0.98),
      operculumRidge: 0.05,
      tailPivotZ,
      colorFn: (zNorm, yNorm, _xNorm, out) => {
        out.copy(cBody);
        if (yNorm < -0.15) out.lerp(cBelly, THREE.MathUtils.clamp((-yNorm - 0.15) * 0.65, 0, 0.65));
        const headDist = Math.abs(zNorm - (0.34 + yNorm * 0.04));
        const midDist = Math.abs(zNorm - (-0.08 + yNorm * 0.02));
        if (headDist < 0.090 || midDist < 0.082) out.copy(cWhite);
        else if (headDist < 0.118 || midDist < 0.110) out.copy(cRim);
      },
    })
  );

  // Notched two-lobe continuous dorsal fin with mid-trunk white bar extension & crisp jet-black outer margin
  parts.push(
    buildFinStrip(
      [
        [-0.062, 0.022],
        [-0.064, 0.054],
        [-0.048, 0.076],
        [-0.024, 0.080],
        [-0.004, 0.060],
        [0.014, 0.076],
        [0.036, 0.072],
        [0.046, 0.034],
      ],
      0.0032,
      (_x, y, z, out) => {
        const barDist = Math.abs(z + 0.008);
        const outerMargin =
          y > 0.067 ||
          (z < -0.055 && y > 0.034) ||
          (z > 0.037 && y > 0.044);
        if (outerMargin) {
          out.copy(cRim);
        } else if (barDist < 0.010) {
          out.copy(cWhite);
        } else if (barDist < 0.015) {
          out.copy(cRim);
        } else {
          out.copy(cBody).lerp(cRim, THREE.MathUtils.clamp((y - 0.058) / 0.010, 0, 1));
        }
      },
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Rounded anal fin with clear jet-black outer margin
  parts.push(
    buildFinStrip(
      [[-0.064, -0.020], [-0.068, -0.038], [-0.058, -0.056], [-0.034, -0.066], [-0.006, -0.060], [0.006, -0.034]],
      0.0032,
      (_x, y, z, out) => {
        const rimT = THREE.MathUtils.clamp(
          Math.max((-y - 0.051) / 0.008, (-z - 0.054) / 0.008),
          0,
          1
        );
        out.copy(cBody).lerp(cRim, rimT);
      },
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Prominent rounded paddle pectoral fins with crisp jet-black outer margin
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.042,
      yPos: -0.010,
      xOffset: 0.028,
      span: 0.046,
      chord: 0.038,
      sweep: -0.28,
      dihedral: -0.08,
      flare: 0.90,
      thickness: 0.0028,
      bodyLength: length,
      tailPivotZ,
      shape: 'paddle',
      colorFn: (x, y, z, out) => {
        const dx = Math.max(0, Math.abs(x) - 0.028);
        const dy = y + 0.010;
        const dz = z - 0.042;
        const dist = Math.hypot(dx, dy * 0.9, dz * 0.9);
        out.copy(cBody).lerp(cBelly, 0.35);
        if (dist > 0.029) out.lerp(cRim, THREE.MathUtils.clamp((dist - 0.029) / 0.005, 0, 1));
      },
    })
  );

  // Rounded pelvic fins with crisp jet-black outer margin
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.032,
      yPos: -0.044,
      xOffset: 0.007,
      length: 0.038,
      width: 0.022,
      splay: 0.36,
      dip: -0.44,
      thickness: 0.0026,
      bodyLength: length,
      tailPivotZ,
      colorFn: (x, y, z, out) => {
        const pDist = Math.hypot(Math.max(0, Math.abs(x) - 0.007), y + 0.044, z - 0.032);
        out.copy(cBody).lerp(cRim, THREE.MathUtils.clamp((pDist - 0.025) / 0.006, 0, 1));
      },
    })
  );

  addFishEyes(parts, 0.074, 0.012, 0.020, 0.0080, '#f08a24', { bodyLength: length, tailPivotZ });
  const bodyGeom = safeMerge(parts);

  // Rounded fan tail with clear jet-black outer margin
  const tailGeom = buildFinStrip(
    [
      [0.0, 0.014],
      [-0.026, 0.034],
      [-0.054, 0.042],
      [-0.068, 0.024],
      [-0.072, 0.0],
      [-0.068, -0.024],
      [-0.054, -0.042],
      [-0.026, -0.034],
      [0.0, -0.014],
    ],
    0.0032,
    (_x, y, z, out) => {
      out.copy(cBody).lerp(cBelly, THREE.MathUtils.clamp(-z / 0.064, 0, 0.50));
      const tailR = Math.hypot(z * 0.92, y * 1.35);
      const rimT = THREE.MathUtils.clamp(Math.max((tailR - 0.052) / 0.007, (-z - 0.060) / 0.006), 0, 1);
      if (rimT > 0) out.lerp(cRim, rimT);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );
  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 5. Chaetodon austriacus (Exquisite Butterflyfish)
// -----------------------------------------------------------------------------
function buildButterflyfishPrototype() {
  const parts = [];
  const length = 0.19;
  const tailPivotZ = 0.090;
  const cGold = new THREE.Color('#f5c424');
  const cStripe = new THREE.Color('#2d2415');
  const cBlack = new THREE.Color('#111216');
  const cWhite = new THREE.Color('#f7f5e8');
  const cCream = new THREE.Color('#f6edc2');
  const cPectoral = new THREE.Color('#f7da78');

  const trunkProfile = (u) =>
    u < 0.12 ? 0.18 + (u / 0.12) * 0.44 : Math.pow(Math.sin(Math.max(0.01, (u - 0.04) / 0.86) * Math.PI), 0.52) * 0.98;
  const trunkAtBrow = trunkProfile(0.74);

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight: 0.074,
      halfWidth: 0.017,
      segsU: 48,
      segsV: 24,
      dorsalProfile: (u) => {
        if (u > 0.74) {
          const t = (u - 0.74) / 0.26;
          return 0.055 + (trunkAtBrow - 0.055) * Math.pow(1.0 - t, 2.35);
        }
        return trunkProfile(u);
      },
      ventralProfile: (u) => {
        if (u > 0.74) {
          const t = (u - 0.74) / 0.26;
          return 0.055 + (trunkAtBrow - 0.055) * Math.pow(1.0 - t, 1.45);
        }
        return trunkProfile(u);
      },
      widthProfile: (u) => Math.max(0.14, Math.sin(Math.pow(u, 0.75) * Math.PI) * 0.95),
      dorsalSharpness: 0.42,
      tailPivotZ,
      colorFn: (zNorm, yNorm, _xNorm, out) => {
        out.copy(cGold);
        // Curved dark longitudinal pinstripes along saffron-gold flanks
        if (zNorm > -0.52 && zNorm < 0.34 && Math.sin(yNorm * 28.0 + Math.cos(zNorm * 2.4) * 2.2) > 0.56) {
          out.copy(cStripe);
        }
        // Bright white cheek crescent behind black vertical eyebar
        if (zNorm >= 0.34 && zNorm < 0.45) out.copy(cWhite);
        // Crisp black vertical eyebar
        if (zNorm >= 0.45 && zNorm < 0.62) out.copy(cBlack);
        // Cream-gold snout with black snout tip
        if (zNorm >= 0.62 && zNorm < 0.84) out.copy(cCream).lerp(cGold, 0.45);
        if (zNorm >= 0.84) out.copy(cBlack);
        // Jet-black rear body/peduncle band & lower edge
        if (zNorm < -0.52 || (yNorm < -0.78 && zNorm < 0.14)) out.copy(cBlack);
      },
    })
  );

  // Tall sail dorsal fin wrapping rear profile with black band + golden stripe + cream margin
  parts.push(
    buildFinStrip(
      [
        [-0.084, 0.012],
        [-0.090, 0.032],
        [-0.082, 0.062],
        [-0.052, 0.082],
        [-0.005, 0.082],
        [0.022, 0.068],
        [0.040, 0.044],
      ],
      0.0024,
      (_x, y, z, out) => {
        if (z < -0.072 || y > 0.075) out.copy(cCream);
        else if (z < -0.064 || y > 0.069) out.copy(cGold);
        else if (z < -0.030 || y > 0.058) out.copy(cBlack);
        else out.copy(cGold);
      },
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Rounded anal fin wrapping rear profile with black band + golden stripe + cream margin
  parts.push(
    buildFinStrip(
      [
        [-0.084, -0.012],
        [-0.090, -0.030],
        [-0.084, -0.058],
        [-0.060, -0.078],
        [-0.024, -0.076],
        [-0.004, -0.056],
      ],
      0.0024,
      (_x, y, z, out) => {
        if (z < -0.076 || y < -0.071) out.copy(cCream);
        else if (z < -0.068 || y < -0.065) out.copy(cGold);
        else out.copy(cBlack);
      },
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Delicate golden-translucent pectoral fins
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.028,
      yPos: -0.010,
      xOffset: 0.014,
      span: 0.032,
      chord: 0.025,
      sweep: -0.35,
      dihedral: -0.10,
      flare: 0.85,
      thickness: 0.0018,
      bodyLength: length,
      tailPivotZ,
      shape: 'fan',
      colorFn: (_x, _y, _z, out) => out.copy(cPectoral),
    })
  );

  // Pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.022,
      yPos: -0.054,
      xOffset: 0.004,
      length: 0.034,
      width: 0.016,
      splay: 0.25,
      dip: -0.50,
      thickness: 0.0018,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, _y, _z, out) => out.copy(cGold),
    })
  );

  addFishEyes(parts, 0.051, 0.010, 0.0115, 0.0054, '#c49d3a', { bodyLength: length, tailPivotZ });
  const bodyGeom = safeMerge(parts);

  // Jet-black caudal fin with golden stripe and pale yellow-cream margin
  const tailGeom = buildFinStrip(
    [
      [0.0, 0.010],
      [-0.018, 0.025],
      [-0.038, 0.032],
      [-0.045, 0.016],
      [-0.046, 0.0],
      [-0.045, -0.016],
      [-0.038, -0.032],
      [-0.018, -0.025],
      [0.0, -0.010],
    ],
    0.0024,
    (_x, _y, z, out) => {
      if (z <= -0.036) out.copy(cCream);
      else if (z <= -0.029) out.copy(cGold);
      else out.copy(cBlack);
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );
  return { bodyGeom, tailGeom, tailPivotZ };
}

// -----------------------------------------------------------------------------
// 6. Caesio suevica (Suez Fusilier — cerulean-blue, gold band, forked black-tip tail)
// -----------------------------------------------------------------------------
function buildFusilierPrototype() {
  const parts = [];
  const length = 0.25;
  const tailPivotZ = 0.119;
  const cBlue = new THREE.Color('#1482f2');
  const cSilver = new THREE.Color('#dbeaf8');
  const cYellow = new THREE.Color('#ffe033');
  const cTip = new THREE.Color('#141820');
  const cMargin = new THREE.Color('#eef5fc');
  const cTailMid = new THREE.Color('#a8c9ea');

  parts.push(
    buildParametricFishBody({
      length,
      halfHeight: 0.033,
      halfWidth: 0.020,
      segsU: 42,
      segsV: 22,
      heightProfile: (u) => (u < 0.14 ? 0.16 + (u / 0.14) * 0.34 : Math.sin(Math.pow(u, 0.72) * Math.PI)),
      widthProfile: (u) => Math.max(0.14, Math.sin(Math.pow(u, 0.75) * Math.PI) * 0.94),
      dorsalSharpness: 0.18,
      tailPivotZ,
      colorFn: (zNorm, yNorm, _xNorm, out) => {
        if (yNorm > 0.50) {
          out.copy(cBlue);
        } else if (yNorm >= 0.18 && zNorm <= 0.60) {
          const bandCore = Math.min((yNorm - 0.18) / 0.07, (0.50 - yNorm) / 0.07, 1.0);
          out.copy(yNorm > 0.34 ? cBlue : cSilver).lerp(cYellow, 0.72 + bandCore * 0.28);
        } else if (yNorm > 0.04) {
          out.copy(cSilver).lerp(cBlue, (yNorm - 0.04) / 0.14);
        } else {
          out.copy(cSilver);
        }
        if (zNorm > 0.60 && yNorm > 0.04) {
          out.copy(cSilver).lerp(cBlue, THREE.MathUtils.clamp((yNorm - 0.04) / 0.35, 0, 1));
        }
      },
    })
  );

  // Sleek low dorsal fin
  parts.push(
    buildFinStrip(
      [[-0.062, 0.012], [-0.060, 0.030], [-0.018, 0.042], [0.028, 0.044], [0.044, 0.018]],
      0.0024,
      (_x, y, _z, out) => out.copy(cBlue).lerp(cSilver, THREE.MathUtils.clamp((y - 0.028) / 0.018, 0, 0.45)),
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Sleek low anal fin
  parts.push(
    buildFinStrip(
      [[-0.062, -0.012], [-0.064, -0.026], [-0.024, -0.036], [-0.010, -0.018]],
      0.0024,
      (_x, _y, _z, out) => out.copy(cSilver),
      { bodyLength: length, tailPivotZ, spanSegs: 4 }
    )
  );

  // Falcate pectoral wings
  parts.push(
    buildPairedPectoralFins({
      zPos: 0.056,
      yPos: -0.008,
      xOffset: 0.016,
      span: 0.048,
      chord: 0.022,
      sweep: -0.62,
      dihedral: -0.14,
      flare: 0.85,
      thickness: 0.0020,
      bodyLength: length,
      tailPivotZ,
      shape: 'falcate',
      colorFn: (x, y, z, out) => {
        out.copy(cSilver).lerp(cBlue, 0.25);
        if (Math.abs(x) < 0.020 && y > -0.006 && z > 0.052) out.lerp(cTip, 0.85);
      },
    })
  );

  // Pelvic fins
  parts.push(
    buildPairedPelvicFins({
      zPos: 0.046,
      yPos: -0.024,
      xOffset: 0.005,
      length: 0.034,
      width: 0.013,
      splay: 0.30,
      dip: -0.40,
      thickness: 0.0020,
      bodyLength: length,
      tailPivotZ,
      colorFn: (_x, _y, _z, out) => out.copy(cSilver),
    })
  );

  addFishEyes(parts, 0.092, 0.007, 0.0125, 0.0058, '#e6d690', { bodyLength: length, tailPivotZ });
  const bodyGeom = safeMerge(parts);

  // Deeply forked scissor tail with sharp jet-black lobe tips & pale silver-white inner margin
  const tailGeom = buildFinStrip(
    [
      [0.0, 0.007],
      [-0.040, 0.028],
      [-0.076, 0.048],
      [-0.052, 0.018],
      [-0.034, 0.0],
      [-0.052, -0.018],
      [-0.076, -0.048],
      [-0.040, -0.028],
      [0.0, -0.007],
    ],
    0.0024,
    (_x, y, z, out) => {
      const ay = Math.abs(y);
      const innerFork = Math.max(0.004, (-z - 0.028) * 0.45);
      if (z < -0.056 && ay > 0.028) {
        out.copy(cTip);
      } else if (z < -0.046 && ay > 0.021) {
        out.copy(cMargin);
      } else if (ay < innerFork && z < -0.026) {
        out.copy(cMargin);
      } else {
        out.copy(cTailMid).lerp(cSilver, 0.45);
      }
    },
    { isCaudal: true, bodyLength: length, tailPivotZ, spanSegs: 4 }
  );
  return { bodyGeom, tailGeom, tailPivotZ };
}

export function createFish({
  applyUnderwaterMaterial,
  getSeabedHeight,
  coralHeads,
  anemoneAnchors,
  bommies,
  predators,
  cleaningSystem = null,
}) {
  const group = new THREE.Group();
  group.name = 'reef-fishes';
  const pickableMeshes = [];

  const fishMat = createAnimatedFishMaterial(
    applyUnderwaterMaterial,
    { roughness: 0.28, metalness: 0.14 },
    { receiveCaustics: true, causticsStrength: 0.80 }
  );

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

  const defaultBranchingCorals = coralHeads.filter(
    (c) => c.active !== false && (c.speciesId === 'acropora' || c.speciesId === 'stylophora')
  );
  const defaultActiveCorals = coralHeads.filter((c) => c.active !== false);
  const initialHostCorals =
    defaultBranchingCorals.length > 0
      ? defaultBranchingCorals
      : defaultActiveCorals.length > 0
        ? defaultActiveCorals
        : coralHeads;
  const initialAnthiasHosts =
    defaultBranchingCorals.length >= 2
      ? defaultBranchingCorals.filter((_, idx) => idx % 2 === 0)
      : initialHostCorals;
  const initialChromisHosts =
    defaultBranchingCorals.length >= 2
      ? defaultBranchingCorals.filter((_, idx) => idx % 2 === 1)
      : initialHostCorals;
  const fallbackHostCoral = { position: new THREE.Vector3(0, 0.5, 0), radius: 0.6, active: false };

  const worldUp = new THREE.Vector3(0, 1, 0);
  // Default Due North upstream vector (matches currentDirection = 180 deg N -> S)
  const baseUpstream = safeNormalize(new THREE.Vector3(0, 0.045, -1), 0, 0.045, -1);
  const baseCrossStream = safeNormalize(new THREE.Vector3().crossVectors(worldUp, baseUpstream), 1, 0, 0);
  const smoothedUpstream = baseUpstream.clone();
  const targetUpstream = baseUpstream.clone();
  let smoothedSpeed = 0.45;

  function computeLocalUpstream(x, z, elapsedTime, outUp, outRight) {
    const yaw = Math.sin(elapsedTime * 0.52 - (x * 0.11 - z * 0.08)) * 0.08;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    outUp.set(
      smoothedUpstream.x * c - smoothedUpstream.z * s,
      smoothedUpstream.y,
      smoothedUpstream.x * s + smoothedUpstream.z * c
    );
    safeNormalize(outUp, smoothedUpstream.x, smoothedUpstream.y, smoothedUpstream.z);
    outRight.crossVectors(worldUp, outUp);
    safeNormalize(outRight, 1, 0, 0);
  }

  // ---------------------------------------------------------------------------
  // 1. Pseudanthias squamipinnis (130 -> 220 schooling, 1:10 male:female dimorphism)
  // ---------------------------------------------------------------------------
  const DEFAULT_ANTHIAS_COUNT = SPECIES_POPULATION_SPEC.pseudanthias.defaultCount;
  const MAX_ANTHIAS_COUNT = SPECIES_POPULATION_SPEC.pseudanthias.maxCount;
  const anthiasFemaleMeshes = makePair(buildAnthiasFemalePrototype(), MAX_ANTHIAS_COUNT, 'pseudanthias');
  const anthiasMaleMeshes = makePair(
    buildAnthiasMalePrototype(),
    Math.ceil(MAX_ANTHIAS_COUNT / 11) + 2,
    'pseudanthias'
  );
  const anthiasRng = createRng(4101);
  const anthias = [];
  let anthiasMaleInitIdx = 0;
  let anthiasFemaleInitIdx = 0;

  for (let i = 0; i < MAX_ANTHIAS_COUNT; i++) {
    const host =
      initialAnthiasHosts.length > 0
        ? initialAnthiasHosts[i % initialAnthiasHosts.length]
        : fallbackHostCoral;
    const upDist = host.radius * (0.25 + anthiasRng() * 0.95);
    const crossDist = (anthiasRng() - 0.5) * 2.0 * (host.radius * 1.15 + 0.25);
    const hoverOffsetY = 0.30 + anthiasRng() * 0.75;
    const stationPhase = anthiasRng() * Math.PI * 2;
    const hostTopY = host.topWorldY ?? (host.position.y + host.radius * 0.45);
    const spawnX = host.position.x + baseUpstream.x * upDist + baseCrossStream.x * crossDist;
    const spawnZ = host.position.z + baseUpstream.z * upDist + baseCrossStream.z * crossDist;
    const spawnY = THREE.MathUtils.clamp(
      hostTopY + hoverOffsetY,
      getSeabedHeight(spawnX, spawnZ) + 0.45,
      2.75
    );
    const pos = new THREE.Vector3(spawnX, spawnY, spawnZ);
    const vel = baseUpstream.clone().multiplyScalar(0.04);
    const isMale = i % 11 === 0;
    const col = new THREE.Color('#ffffff').offsetHSL(
      (anthiasRng() - 0.5) * 0.025,
      (anthiasRng() - 0.5) * 0.04,
      (anthiasRng() - 0.5) * 0.06
    );
    if (isMale) {
      anthiasMaleMeshes.bodyMesh.setColorAt(anthiasMaleInitIdx, col);
      anthiasMaleMeshes.tailMesh.setColorAt(anthiasMaleInitIdx, col);
      anthiasMaleInitIdx++;
    } else {
      anthiasFemaleMeshes.bodyMesh.setColorAt(anthiasFemaleInitIdx, col);
      anthiasFemaleMeshes.tailMesh.setColorAt(anthiasFemaleInitIdx, col);
      anthiasFemaleInitIdx++;
    }

    const hideAngle = anthiasRng() * Math.PI * 2;
    const hideRadFrac = 0.32 + anthiasRng() * 0.34;
    const hideYRelTop = -0.16 + anthiasRng() * 0.20;
    const hideOffset = new THREE.Vector3(
      Math.cos(hideAngle) * host.radius * hideRadFrac,
      hostTopY + hideYRelTop - host.position.y,
      Math.sin(hideAngle) * host.radius * hideRadFrac
    );

    anthias.push({
      pos,
      vel,
      isMale,
      hostCoral: host,
      upDist,
      crossDist,
      hoverOffsetY,
      stationPhase,
      heading: baseUpstream.clone(),
      feedTimer: 0.6 + anthiasRng() * 3.8,
      snapTimer: 0,
      snapDir: baseUpstream.clone(),
      feedPitch: 0,
      hideAngle,
      hideRadFrac,
      hideYRelTop,
      hideOffset,
      continuousHideTimer: 0,
      alertLevel: 0,
      scale: isMale ? 1.06 + anthiasRng() * 0.10 : 0.90 + anthiasRng() * 0.18,
      swimPhase: anthiasRng() * Math.PI * 2,
      swimFreq: 7.5 + anthiasRng() * 3.5,
    });
  }
  if (anthiasMaleMeshes.bodyMesh.instanceColor) anthiasMaleMeshes.bodyMesh.instanceColor.needsUpdate = true;
  if (anthiasMaleMeshes.tailMesh.instanceColor) anthiasMaleMeshes.tailMesh.instanceColor.needsUpdate = true;
  if (anthiasFemaleMeshes.bodyMesh.instanceColor) anthiasFemaleMeshes.bodyMesh.instanceColor.needsUpdate = true;
  if (anthiasFemaleMeshes.tailMesh.instanceColor) anthiasFemaleMeshes.tailMesh.instanceColor.needsUpdate = true;

  // ---------------------------------------------------------------------------
  // 1b. Chromis viridis (110 -> 190 Blue-Green Chromis on disjoint branching corals)
  // ---------------------------------------------------------------------------
  const DEFAULT_CHROMIS_COUNT = CHROMIS_SPEC.defaultCount;
  const MAX_CHROMIS_COUNT = CHROMIS_SPEC.maxCount;
  const chromisMeshes = makePair(buildChromisPrototype(), MAX_CHROMIS_COUNT, 'chromis');
  const chromisRng = createRng(4301);
  const chromis = [];

  for (let i = 0; i < MAX_CHROMIS_COUNT; i++) {
    const host =
      initialChromisHosts.length > 0
        ? initialChromisHosts[i % initialChromisHosts.length]
        : fallbackHostCoral;
    const upDist = host.radius * (0.18 + chromisRng() * 0.60);
    const crossDist = (chromisRng() - 0.5) * 2.0 * (host.radius * 0.85 + 0.18);
    const hoverOffsetY = 0.16 + chromisRng() * 0.34;
    const stationPhase = chromisRng() * Math.PI * 2;
    const hostTopY = host.topWorldY ?? (host.position.y + host.radius * 0.45);
    const spawnX = host.position.x + baseUpstream.x * upDist + baseCrossStream.x * crossDist;
    const spawnZ = host.position.z + baseUpstream.z * upDist + baseCrossStream.z * crossDist;
    const spawnY = THREE.MathUtils.clamp(
      hostTopY + hoverOffsetY,
      getSeabedHeight(spawnX, spawnZ) + 0.40,
      2.70
    );
    const pos = new THREE.Vector3(spawnX, spawnY, spawnZ);
    const vel = baseUpstream.clone().multiplyScalar(0.04);
    const col = new THREE.Color('#ffffff').offsetHSL(
      (chromisRng() - 0.5) * 0.025,
      (chromisRng() - 0.5) * 0.04,
      (chromisRng() - 0.5) * 0.06
    );
    chromisMeshes.bodyMesh.setColorAt(i, col);
    chromisMeshes.tailMesh.setColorAt(i, col);

    const hideAngle = chromisRng() * Math.PI * 2;
    const hideRadFrac = 0.28 + chromisRng() * 0.32;
    const hideYRelTop = -0.18 + chromisRng() * 0.18;
    const hideOffset = new THREE.Vector3(
      Math.cos(hideAngle) * host.radius * hideRadFrac,
      hostTopY + hideYRelTop - host.position.y,
      Math.sin(hideAngle) * host.radius * hideRadFrac
    );

    chromis.push({
      pos,
      vel,
      hostCoral: host,
      upDist,
      crossDist,
      hoverOffsetY,
      stationPhase,
      heading: baseUpstream.clone(),
      feedTimer: 0.4 + chromisRng() * 3.0,
      snapTimer: 0,
      snapDir: baseUpstream.clone(),
      feedPitch: 0,
      hideAngle,
      hideRadFrac,
      hideYRelTop,
      hideOffset,
      continuousHideTimer: 0,
      alertLevel: 0,
      scale: 0.88 + chromisRng() * 0.24,
      swimPhase: chromisRng() * Math.PI * 2,
      swimFreq: 9.5 + chromisRng() * 3.5,
    });
  }
  if (chromisMeshes.bodyMesh.instanceColor) chromisMeshes.bodyMesh.instanceColor.needsUpdate = true;
  if (chromisMeshes.tailMesh.instanceColor) chromisMeshes.tailMesh.instanceColor.needsUpdate = true;

  // ---------------------------------------------------------------------------
  // 2. Abudefduf vaigiensis (54 -> 90 Sergeant Major: 3 Cohesive Reef-Crossing Schools)
  // ---------------------------------------------------------------------------
  const SERGEANT_SCHOOL_SIZE = 18;
  const SERGEANT_SCHOOL_CONFIGS = [
    { startX: -2.4, startZ: 4.60, dirSign: 1, xBound: 10.6, baseZ: 4.55, speed: 1.08, zSlope: 0.04, hoverHeight: 1.68 },
    { startX: 4.2, startZ: -2.2, dirSign: -1, xBound: 11.2, baseZ: -2.3, speed: 1.15, zSlope: -0.05, hoverHeight: 1.78 },
    { startX: -5.8, startZ: 1.2, dirSign: 1, xBound: 11.6, baseZ: 1.0, speed: 1.18, zSlope: -0.16, hoverHeight: 1.86 },
  ];
  const DEFAULT_SERGEANT_COUNT = SERGEANT_SCHOOL_CONFIGS.length * SERGEANT_SCHOOL_SIZE; // 54
  const MAX_SERGEANT_COUNT = SPECIES_POPULATION_SPEC.abudefduf.maxCount; // 90
  const sergeantMeshes = makePair(buildSergeantMajorPrototype(), MAX_SERGEANT_COUNT, 'abudefduf');
  const sgtRng = createRng(4201);
  const sergeants = [];
  const sergeantSchools = SERGEANT_SCHOOL_CONFIGS.map((cfg, sIdx) => {
    const startY = Math.min(
      WORLD_CONSTANTS.SURFACE_BASE_Y + 6.0 - 0.55 - 0.55,
      getSeabedHeight(cfg.startX, cfg.startZ) + cfg.hoverHeight
    );
    const theta = Math.atan2(cfg.dirSign * cfg.zSlope, cfg.dirSign);
    const vel = new THREE.Vector3(Math.cos(theta) * cfg.speed, 0, Math.sin(theta) * cfg.speed);
    return {
      schoolIdx: sIdx,
      pos: new THREE.Vector3(cfg.startX, startY, cfg.startZ),
      vel,
      heading: safeNormalize(vel.clone(), cfg.dirSign, 0, 0),
      dirSign: cfg.dirSign,
      xBound: cfg.xBound,
      baseZ: cfg.baseZ,
      speed: cfg.speed,
      zSlope: cfg.zSlope,
      hoverHeight: cfg.hoverHeight,
      zWaveAmp: 0.16,
      zWaveFreq: 0.36,
      wavePhase: sIdx * 2.1,
      theta,
      turnRate: 1.55,
      turnSign: sIdx % 2 === 0 ? -1 : 1,
      defaultTurnSign: sIdx % 2 === 0 ? -1 : 1,
      isTurning: false,
      members: [],
    };
  });

  for (let i = 0; i < MAX_SERGEANT_COUNT; i++) {
    const isDefault = i < DEFAULT_SERGEANT_COUNT;
    const schoolIdx = isDefault
      ? Math.floor(i / SERGEANT_SCHOOL_SIZE)
      : (i - DEFAULT_SERGEANT_COUNT) % SERGEANT_SCHOOL_CONFIGS.length;
    const memberIdx = isDefault
      ? i % SERGEANT_SCHOOL_SIZE
      : SERGEANT_SCHOOL_SIZE + Math.floor((i - DEFAULT_SERGEANT_COUNT) / SERGEANT_SCHOOL_CONFIGS.length);
    const school = sergeantSchools[schoolIdx];

    // Stratified 3D school slots: along [-1.25, 1.25], across [-0.70, 0.70], vert [-0.36, 0.36]
    const row = isDefault ? Math.floor(memberIdx / 3) : Math.floor((memberIdx - SERGEANT_SCHOOL_SIZE) / 3);
    const rowDenom = isDefault ? 5 : 3;
    const col = memberIdx % 3; // 0..2
    const along = THREE.MathUtils.clamp(((row / rowDenom) * 2 - 1) * 1.05 + (sgtRng() - 0.5) * 0.40, -1.25, 1.25);
    const across = THREE.MathUtils.clamp((col - 1) * 0.52 + (sgtRng() - 0.5) * 0.36, -0.70, 0.70);
    const vert = THREE.MathUtils.clamp((((memberIdx % 4) / 3) * 2 - 1) * 0.24 + (sgtRng() - 0.5) * 0.24, -0.36, 0.36);

    const fwdX = school.heading.x;
    const fwdZ = school.heading.z;
    const rightX = fwdZ;
    const rightZ = -fwdX;
    const spawnX = school.pos.x + fwdX * along + rightX * across;
    const spawnZ = school.pos.z + fwdZ * along + rightZ * across;
    const spawnY = Math.max(getSeabedHeight(spawnX, spawnZ) + 0.45, school.pos.y + vert);

    const f = {
      pos: new THREE.Vector3(spawnX, spawnY, spawnZ),
      vel: school.vel.clone(),
      heading: school.heading.clone(),
      schoolIdx,
      localSlot: { along, across, vert },
      scale: 0.88 + sgtRng() * 0.28,
      swimPhase: sgtRng() * Math.PI * 2,
      swimFreq: 7.5 + sgtRng() * 2.5,
    };
    sergeants.push(f);
    school.members.push(f);
  }

  // ---------------------------------------------------------------------------
  // 3. Amphiprion bicinctus (20 -> 36 mated pairs + juveniles, hide < 0.12m)
  // ---------------------------------------------------------------------------
  const DEFAULT_CLOWN_COUNT = SPECIES_POPULATION_SPEC.amphiprion.defaultCount;
  const MAX_CLOWN_COUNT = SPECIES_POPULATION_SPEC.amphiprion.maxCount;
  const clownMeshes = makePair(buildClownfishPrototype(), MAX_CLOWN_COUNT, 'amphiprion');
  const clownRng = createRng(5101);
  const clowns = [];
  const defaultAnemoneAnchors = anemoneAnchors.filter((a) => a.active !== false);
  const initialAnemoneAnchors = defaultAnemoneAnchors.length > 0 ? defaultAnemoneAnchors : anemoneAnchors;
  const fallbackAnemoneAnchor = { position: new THREE.Vector3(0, 0.5, 0), radius: 0.85, active: false };

  function resolveHomeAnchor(homeAnemoneIdx) {
    const home = anemoneAnchors[homeAnemoneIdx];
    if (home && home.active !== false) return home;
    if (initialAnemoneAnchors.length > 0) {
      return initialAnemoneAnchors[homeAnemoneIdx % initialAnemoneAnchors.length];
    }
    return fallbackAnemoneAnchor;
  }

  function createClownMember(role, homeAnemoneIdx, scale, femaleRef, indexHint) {
    const anchor = resolveHomeAnchor(homeAnemoneIdx);
    const angle = clownRng() * Math.PI * 2;
    const rScale = Math.max(0.65, anchor.radius ?? 0.85);
    let targetOffset;
    if (role === 'female') {
      const upShift = (0.04 + 0.22 * clownRng()) * rScale;
      const crossShift = (clownRng() - 0.5) * 0.44 * rScale;
      const offsetY = (0.22 + clownRng() * 0.24) * rScale;
      targetOffset = new THREE.Vector3(
        baseUpstream.x * upShift + baseCrossStream.x * crossShift,
        offsetY,
        baseUpstream.z * upShift + baseCrossStream.z * crossShift
      );
    } else if (role === 'male' && femaleRef) {
      const sideSign = indexHint % 4 < 2 ? 1 : -1;
      const pairDist = 0.18;
      const lx = sideSign * 0.14;
      const tz = Math.sqrt(pairDist * pairDist - lx * lx);
      targetOffset = new THREE.Vector3(
        femaleRef.targetOffset.x + baseCrossStream.x * lx - baseUpstream.x * tz,
        THREE.MathUtils.clamp(femaleRef.targetOffset.y - 0.02, 0.18 * rScale, 0.46 * rScale),
        femaleRef.targetOffset.z + baseCrossStream.z * lx - baseUpstream.z * tz
      );
    } else {
      const rad = (0.06 + 0.16 * clownRng()) * rScale;
      const offsetY = (0.14 + clownRng() * 0.14) * rScale;
      targetOffset = new THREE.Vector3(
        (baseUpstream.x * Math.cos(angle) + baseCrossStream.x * Math.sin(angle)) * rad,
        offsetY,
        (baseUpstream.z * Math.cos(angle) + baseCrossStream.z * Math.sin(angle)) * rad
      );
    }
    const pos = new THREE.Vector3(
      anchor.position.x + targetOffset.x,
      anchor.position.y + targetOffset.y,
      anchor.position.z + targetOffset.z
    );
    return {
      pos,
      vel: baseUpstream.clone().multiplyScalar(0.12),
      heading: baseUpstream.clone(),
      anchor,
      homeAnemoneIdx,
      role,
      femaleRef,
      scale,
      orbitAngle: angle,
      orbitDir: role === 'female' ? 1 : -1,
      swimPhase: clownRng() * Math.PI * 2,
      dartTimer: 1.0 + clownRng() * 2.0,
      targetOffset,
      alertLevel: 0,
    };
  }

  // Indices 0..15: 8 adult mated pairs on anemones 0..7
  for (let p = 0; p < 8; p++) {
    const maleScale = 0.83 + clownRng() * 0.05;
    const femaleScale = Number((maleScale * 1.30).toFixed(6));
    const female = createClownMember('female', p, femaleScale, null, 2 * p);
    const male = createClownMember('male', p, maleScale, female, 2 * p + 1);
    clowns.push(female, male);
  }
  // Indices 16..19: 4 juveniles on anemones 0, 2, 4, 6
  for (let i = 16; i < 20; i++) {
    const idx = i - 16;
    const homeAnemoneIdx = idx * 2;
    const femaleRef = clowns[idx * 4];
    const maleRef = clowns[idx * 4 + 1];
    const juvScale = Number((maleRef.scale * 0.62).toFixed(6));
    clowns.push(createClownMember('juvenile', homeAnemoneIdx, juvScale, femaleRef, i));
  }
  // Indices 20..31: 6 adult mated pairs on expansion anemones 8..13
  for (let k = 0; k < 6; k++) {
    const homeAnemoneIdx = 8 + k;
    const maleScale = 0.83 + clownRng() * 0.05;
    const femaleScale = Number((maleScale * 1.30).toFixed(6));
    const baseIdx = 20 + 2 * k;
    const female = createClownMember('female', homeAnemoneIdx, femaleScale, null, baseIdx);
    const male = createClownMember('male', homeAnemoneIdx, maleScale, female, baseIdx + 1);
    clowns.push(female, male);
  }
  // Indices 32..35: 4 expansion juveniles on anemones 1, 3, 5, 7
  for (let i = 32; i < MAX_CLOWN_COUNT; i++) {
    const idx = i - 32;
    const homeAnemoneIdx = idx * 2 + 1;
    const femaleRef = clowns[idx * 4 + 2];
    const maleRef = clowns[idx * 4 + 3];
    const juvScale = Number((maleRef.scale * 0.62).toFixed(6));
    clowns.push(createClownMember('juvenile', homeAnemoneIdx, juvScale, femaleRef, i));
  }

  // ---------------------------------------------------------------------------
  // 4. Parupeneus forsskali (18 -> 32 Goatfish probing sandy canyon floor + cleaning visits)
  // ---------------------------------------------------------------------------
  const DEFAULT_GOAT_COUNT = SPECIES_POPULATION_SPEC.goatfish.defaultCount;
  const MAX_GOAT_COUNT = SPECIES_POPULATION_SPEC.goatfish.maxCount;
  const goatMeshes = makePair(buildGoatfishPrototype(), MAX_GOAT_COUNT, 'goatfish');
  const goatRng = createRng(5301);
  const goatfish = [];

  for (let i = 0; i < MAX_GOAT_COUNT; i++) {
    const isStarter = i === 0;
    const z = isStarter
      ? 4.30
      : i < DEFAULT_GOAT_COUNT
        ? -6.5 + (i / DEFAULT_GOAT_COUNT) * 14.0
        : -6.5 + ((i - DEFAULT_GOAT_COUNT) / (MAX_GOAT_COUNT - DEFAULT_GOAT_COUNT)) * 14.0;
    const canyonX = isStarter
      ? 1.35
      : 2.4 * Math.sin(z * 0.19) + 1.1 * Math.cos(z * 0.08) + (goatRng() - 0.5) * 2.4;
    const y = getSeabedHeight(canyonX, z) + 0.18;
    const initVel = isStarter
      ? new THREE.Vector3(0.32, 0, 0.22)
      : safeNormalize(new THREE.Vector3(goatRng() - 0.5, 0, goatRng() - 0.5), 0, 0, 1).multiplyScalar(0.45);
    goatfish.push({
      pos: new THREE.Vector3(canyonX, y, z),
      vel: initVel,
      heading: safeNormalize(initVel.clone(), 0, 0, 1),
      targetZ: isStarter ? 4.45 : z + (goatRng() - 0.5) * 4.0,
      targetX: isStarter ? 1.55 : canyonX,
      probeTimer: isStarter ? 1.5 : goatRng() * 3.0,
      cleanState: 'none',
      cleanTimer: 0,
      cleanCooldown: isStarter ? 0.2 : 5 + (i % 6) * 3,
      cleanTarget: null,
      cleanPosePitch: 0,
      approachTimer: 0,
      clientKey: `goatfish-${i}`,
      scale: 0.90 + goatRng() * 0.24,
      swimPhase: goatRng() * Math.PI * 2,
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Chaetodon austriacus (8 -> 16 bonded monogamous pairs = 16 -> 32 fish)
  // ---------------------------------------------------------------------------
  const DEFAULT_BF_PAIR_COUNT = SPECIES_POPULATION_SPEC.chaetodon.defaultCount / 2;
  const MAX_BF_PAIR_COUNT = SPECIES_POPULATION_SPEC.chaetodon.maxCount / 2;
  const MAX_BF_COUNT = SPECIES_POPULATION_SPEC.chaetodon.maxCount; // 32
  const butterflyMeshes = makePair(buildButterflyfishPrototype(), MAX_BF_COUNT, 'chaetodon');
  const bfRng = createRng(6101);
  const butterflies = [];
  const butterflyPairs = [];

  const safeBommies = bommies || [];
  const floorCorals = defaultActiveCorals.filter(
    (c) => Boolean(c.onReefFloor) || c.position.y <= getSeabedHeight(c.position.x, c.position.z) + 0.88
  );
  const patrolPool = floorCorals.length >= 6 ? floorCorals : defaultActiveCorals;
  const BF_TERRITORY_ANCHORS = [
    [1.3, 5.5],
    [-3.6, 5.2],
    [1.1, 2.2],
    [-1.5, -0.6],
    [1.4, -2.2],
    [-2.8, -2.4],
    [0.8, -6.2],
    [-3.8, 1.2],
    [3.8, 4.8],
    [-5.8, 3.6],
    [4.4, -0.8],
    [-5.2, -2.1],
    [2.6, -4.8],
    [-1.6, -7.8],
    [-4.2, -9.2],
    [3.8, -9.6],
  ];

  function buildButterflyRoute(anchorX, anchorZ) {
    if (patrolPool.length === 0) return [];
    const ranked = patrolPool.map((coral, idx) => {
      const dx = coral.position.x - anchorX;
      const dz = coral.position.z - anchorZ;
      return { coral, idx, dSq: dx * dx + dz * dz };
    });
    ranked.sort((a, b) => a.dSq - b.dSq);
    const chosen = ranked.slice(0, Math.min(5, ranked.length));

    let centroidX = 0;
    let centroidZ = 0;
    for (let k = 0; k < chosen.length; k++) {
      centroidX += chosen[k].coral.position.x;
      centroidZ += chosen[k].coral.position.z;
    }
    centroidX /= chosen.length;
    centroidZ /= chosen.length;

    chosen.sort(
      (a, b) =>
        Math.atan2(a.coral.position.z - centroidZ, a.coral.position.x - centroidX) -
        Math.atan2(b.coral.position.z - centroidZ, b.coral.position.x - centroidX)
    );

    return chosen.map(({ coral }, idx) => {
      let nearestBommy = null;
      let nearestBommyDistSq = Infinity;
      for (let b = 0; b < safeBommies.length; b++) {
        const bommy = safeBommies[b];
        const dx = coral.position.x - bommy.x;
        const dz = coral.position.z - bommy.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < nearestBommyDistSq) {
          nearestBommyDistSq = dSq;
          nearestBommy = bommy;
        }
      }

      let dirX = 0;
      let dirZ = 0;
      if (nearestBommy && nearestBommyDistSq < Math.pow(nearestBommy.radius + coral.radius + 1.8, 2)) {
        dirX = coral.position.x - nearestBommy.x;
        dirZ = coral.position.z - nearestBommy.z;
      }
      if (dirX * dirX + dirZ * dirZ < 1e-6) {
        dirX = coral.position.x - centroidX;
        dirZ = coral.position.z - centroidZ;
      }
      if (dirX * dirX + dirZ * dirZ < 1e-6) {
        const nextCoral = chosen[(idx + 1) % chosen.length].coral;
        dirX = -(nextCoral.position.z - coral.position.z);
        dirZ = nextCoral.position.x - coral.position.x;
      }
      const len = Math.hypot(dirX, dirZ);
      if (len > 1e-5) {
        dirX /= len;
        dirZ /= len;
      } else {
        dirX = 1;
        dirZ = 0;
      }

      const offset = coral.radius + 0.34;
      return {
        coral,
        x: coral.position.x + dirX * offset,
        z: coral.position.z + dirZ * offset,
      };
    });
  }

  for (let p = 0; p < MAX_BF_PAIR_COUNT; p++) {
    const [anchorX, anchorZ] = BF_TERRITORY_ANCHORS[p % BF_TERRITORY_ANCHORS.length];
    const route = buildButterflyRoute(anchorX, anchorZ);
    const hoverClearance = 0.27 + (p % 3) * 0.045;
    const pauseDuration = 1.35 + (p % 3) * 0.35;
    const sideSign = p % 2 === 0 ? 1 : -1;

    const startWp = route[0] || { x: anchorX, z: anchorZ, coral: coralHeads[0] || null };
    const nextWp = route.length > 1 ? route[1] : startWp;
    const initDirX = nextWp.x - startWp.x;
    const initDirZ = nextWp.z - startWp.z;
    const initLen = Math.hypot(initDirX, initDirZ);
    const fwdX = initLen > 1e-4 ? initDirX / initLen : Math.cos(p * 0.8);
    const fwdZ = initLen > 1e-4 ? initDirZ / initLen : Math.sin(p * 0.8);
    // Matches worldUp (0,1,0) x forward (fwdX,0,fwdZ)
    const rightX = fwdZ;
    const rightZ = -fwdX;

    const leaderX = startWp.x;
    const leaderZ = startWp.z;
    const leaderY = getSeabedHeight(leaderX, leaderZ) + hoverClearance;
    const leader = {
      pos: new THREE.Vector3(leaderX, leaderY, leaderZ),
      vel: new THREE.Vector3(fwdX * 0.56, 0, fwdZ * 0.56),
      heading: new THREE.Vector3(fwdX, 0, fwdZ),
      pairIdx: p,
      pairLeader: null,
      route,
      routeIdx: route.length > 1 ? 1 : 0,
      hoverClearance,
      pauseDuration,
      pauseTimer: 0,
      peckPitch: 0,
      sideSign,
      scale: 1.06 + bfRng() * 0.14,
      swimPhase: bfRng() * Math.PI * 2,
    };

    const mateX = leaderX + rightX * (sideSign * 0.24) - fwdX * 0.15;
    const mateZ = leaderZ + rightZ * (sideSign * 0.24) - fwdZ * 0.15;
    const mateY = Math.max(getSeabedHeight(mateX, mateZ) + 0.18, leaderY);
    const mate = {
      pos: new THREE.Vector3(mateX, mateY, mateZ),
      vel: new THREE.Vector3(fwdX * 0.56, 0, fwdZ * 0.56),
      heading: new THREE.Vector3(fwdX, 0, fwdZ),
      pairIdx: p,
      pairLeader: leader,
      route,
      routeIdx: leader.routeIdx,
      hoverClearance,
      pauseDuration,
      pauseTimer: 0,
      peckPitch: 0,
      sideSign,
      scale: 0.99 + bfRng() * 0.12,
      swimPhase: bfRng() * Math.PI * 2,
    };

    butterflies.push(leader, mate);
    butterflyPairs.push({
      leader,
      mate,
      route,
      hoverClearance,
      pauseDuration,
      sideSign,
      cleanState: 'none',
      cleanTimer: 0,
      cleanCooldown: p === 0 ? 3.5 : 6 + p * 2.5,
      cleanTarget: null,
      approachTimer: 0,
      clientKey: `chaetodon-pair-${p}`,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Caesio suevica (84 -> 140 Electric-Blue Fusiliers: 2 Pelagic Mid-Water Schools)
  // ---------------------------------------------------------------------------
  const FUSILIER_SCHOOL_SIZE = 42;
  const FUSILIER_SCHOOL_CONFIGS = [
    { startX: -7.0, startZ: -0.8, dirSign: 1, xBound: 15.5, speed: 1.70, baseZ: -0.8, zWaveAmp: 1.4, yRatio: 0.65 },
    { startX: 6.5, startZ: -6.8, dirSign: -1, xBound: 16.5, speed: 1.78, baseZ: -6.8, zWaveAmp: 1.5, yRatio: 0.48 },
  ];
  const DEFAULT_FUSILIER_COUNT = FUSILIER_SCHOOL_CONFIGS.length * FUSILIER_SCHOOL_SIZE; // 84
  const MAX_FUSILIER_COUNT = SPECIES_POPULATION_SPEC.caesio.maxCount; // 140
  const fusilierMeshes = makePair(buildFusilierPrototype(), MAX_FUSILIER_COUNT, 'caesio');
  const fusRng = createRng(6401);
  const fusiliers = [];
  const defaultSurfaceY = WORLD_CONSTANTS.SURFACE_BASE_Y + 6.0 - 0.55;

  const fusilierSchools = FUSILIER_SCHOOL_CONFIGS.map((cfg, sIdx) => {
    const localSeabedY = getSeabedHeight(cfg.startX, cfg.startZ);
    const minPelagicY = Math.min(defaultSurfaceY - 0.45, Math.max(localSeabedY + 2.25, 1.95));
    const maxPelagicY = Math.max(minPelagicY + 0.35, Math.min(defaultSurfaceY - 0.40, 5.25));
    const startY = Math.min(defaultSurfaceY - 0.40, THREE.MathUtils.lerp(minPelagicY, maxPelagicY, cfg.yRatio));
    const theta = cfg.dirSign > 0 ? 0 : Math.PI;
    const vel = new THREE.Vector3(cfg.dirSign * cfg.speed, 0, 0);
    return {
      schoolIdx: sIdx,
      pos: new THREE.Vector3(cfg.startX, startY, cfg.startZ),
      vel,
      heading: new THREE.Vector3(cfg.dirSign, 0, 0),
      dirSign: cfg.dirSign,
      xBound: cfg.xBound,
      baseZ: cfg.baseZ,
      speed: cfg.speed,
      zSlope: 0,
      zWaveAmp: cfg.zWaveAmp,
      zWaveFreq: 0.28 + sIdx * 0.06,
      wavePhase: sIdx * 1.7,
      yRatio: cfg.yRatio,
      theta,
      turnRate: 0.78,
      turnSign: sIdx === 0 ? -1 : 1,
      defaultTurnSign: sIdx === 0 ? -1 : 1,
      isTurning: false,
      members: [],
    };
  });

  for (let i = 0; i < MAX_FUSILIER_COUNT; i++) {
    const isDefault = i < DEFAULT_FUSILIER_COUNT;
    const schoolIdx = isDefault
      ? Math.floor(i / FUSILIER_SCHOOL_SIZE)
      : (i - DEFAULT_FUSILIER_COUNT) % FUSILIER_SCHOOL_CONFIGS.length;
    const memberIdx = isDefault
      ? i % FUSILIER_SCHOOL_SIZE
      : FUSILIER_SCHOOL_SIZE + Math.floor((i - DEFAULT_FUSILIER_COUNT) / FUSILIER_SCHOOL_CONFIGS.length);
    const school = fusilierSchools[schoolIdx];

    // Polarized 3D ribbon formation: along [-3.0, 3.0], across [-1.0, 1.0], vert [-0.48, 0.48]
    const rank = isDefault ? Math.floor(memberIdx / 3) : Math.floor((memberIdx - FUSILIER_SCHOOL_SIZE) / 3);
    const rankDenom = isDefault ? 13 : 9;
    const lane = memberIdx % 3; // 0..2
    const along = THREE.MathUtils.clamp(((rank / rankDenom) * 2 - 1) * 2.65 + (fusRng() - 0.5) * 0.70, -3.0, 3.0);
    const across = THREE.MathUtils.clamp((lane - 1) * 0.72 + (fusRng() - 0.5) * 0.56, -1.0, 1.0);
    const vert = THREE.MathUtils.clamp((((memberIdx % 5) / 4) * 2 - 1) * 0.34 + (fusRng() - 0.5) * 0.28, -0.48, 0.48);

    const spawnX = school.pos.x + school.heading.x * along + school.heading.z * across;
    const spawnZ = school.pos.z + school.heading.z * along - school.heading.x * across;
    const ceilY = defaultSurfaceY - 0.28;
    const minY = Math.min(ceilY - 0.04, Math.max(getSeabedHeight(spawnX, spawnZ) + 1.95, 1.70));
    const spawnY = THREE.MathUtils.clamp(school.pos.y + vert, minY, Math.max(minY, ceilY));

    const fu = {
      pos: new THREE.Vector3(spawnX, spawnY, spawnZ),
      vel: school.vel.clone(),
      heading: school.heading.clone(),
      schoolIdx,
      localSlot: { along, across, vert },
      scale: 0.88 + fusRng() * 0.26,
      swimPhase: fusRng() * Math.PI * 2,
    };
    fusiliers.push(fu);
    school.members.push(fu);
  }

  const scratch = createMatrixScratch();
  const vSep = new THREE.Vector3();
  const vForce = new THREE.Vector3();
  const vDiff = new THREE.Vector3();
  const vRight = new THREE.Vector3();
  const vUpstream = new THREE.Vector3();
  const vCrossStream = new THREE.Vector3();
  const vWater = new THREE.Vector3();
  const vWaterDir = new THREE.Vector3();

  function nearestPredatorThreat(pos, customRadius = null, ignorePassive = false) {
    let maxThreat = 0;
    let closest = null;
    for (let p = 0; p < predators.length; p++) {
      const pred = predators[p];
      if (pred.radius <= 0) continue;
      if (ignorePassive && !pred.isActiveHunter) continue;
      const rad = customRadius !== null ? Math.min(customRadius, pred.radius) : pred.radius;
      const dx = pos.x - pred.pos.x;
      const dy = pos.y - pred.pos.y;
      const dz = pos.z - pred.pos.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq < rad * rad) {
        const dist = Math.sqrt(dSq);
        let t = 1.0 - dist / rad;
        if (dist > 1e-4 && pred.vel) {
          const pSpeedSq = pred.vel.lengthSq();
          if (pSpeedSq > 0.15 * 0.15) {
            const pSpeed = Math.sqrt(pSpeedSq);
            const approachDot = (dx * pred.vel.x + dy * pred.vel.y + dz * pred.vel.z) / (dist * pSpeed);
            if (approachDot < -0.15) {
              t *= 0.38;
            }
          }
        }
        if (t > maxThreat) {
          maxThreat = t;
          closest = pred;
        }
      }
    }
    return { threat: maxThreat, predator: closest };
  }

  function resolveOutsideObstacles(pos, vel, { margin = 0.18, checkAnemones = true, skipCoral = null } = {}) {
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (let c = 0; c < coralHeads.length; c++) {
        const head = coralHeads[c];
        if (head.active === false || head === skipCoral) continue;
        const topY = head.topWorldY ?? (head.position.y + head.radius * 0.45);
        const baseY = head.baseY ?? (head.position.y - head.radius * 0.45);
        if (pos.y < baseY - 0.12 || pos.y > topY + margin) continue;
        const dx = pos.x - head.position.x;
        const dz = pos.z - head.position.z;
        const clearR = head.radius + margin;
        const distSq = dx * dx + dz * dz;
        if (distSq >= clearR * clearR) continue;

        changed = true;
        if (pos.y > topY - 0.16) {
          pos.y = topY + margin;
          vel.y = Math.max(0, vel.y);
        } else {
          const dist = Math.sqrt(distSq);
          let nx = 1;
          let nz = 0;
          if (dist > 1e-4) {
            nx = dx / dist;
            nz = dz / dist;
          } else {
            const vLen = Math.hypot(vel.x, vel.z);
            if (vLen > 1e-4) {
              nx = -vel.x / vLen;
              nz = -vel.z / vLen;
            }
          }
          pos.x = head.position.x + nx * clearR;
          pos.z = head.position.z + nz * clearR;
          const vDotN = vel.x * nx + vel.z * nz;
          if (vDotN < 0) {
            const tx = -nz;
            const tz = nx;
            const tangSign = vel.x * tx + vel.z * tz >= 0 ? 1 : -1;
            vel.x -= vDotN * nx;
            vel.z -= vDotN * nz;
            vel.x += tx * tangSign * Math.abs(vDotN) * 0.35;
            vel.z += tz * tangSign * Math.abs(vDotN) * 0.35;
          }
        }
      }

      if (checkAnemones) {
        for (let a = 0; a < anemoneAnchors.length; a++) {
          const anchor = anemoneAnchors[a];
          if (anchor.active === false) continue;
          const dx = pos.x - anchor.position.x;
          const dy = pos.y - anchor.position.y;
          const dz = pos.z - anchor.position.z;
          const clearR = anchor.radius + margin;
          if (dy < -anchor.radius * 0.65 || dy > clearR) continue;
          const dSq = dx * dx + dy * dy + dz * dz;
          if (dSq >= clearR * clearR) continue;

          changed = true;
          if (dy >= clearR * 0.35) {
            const d = Math.sqrt(dSq);
            if (d > 1e-4) {
              const nx = dx / d;
              const ny = dy / d;
              const nz = dz / d;
              pos.x = anchor.position.x + nx * clearR;
              pos.y = anchor.position.y + ny * clearR;
              pos.z = anchor.position.z + nz * clearR;
              const vDotN = vel.x * nx + vel.y * ny + vel.z * nz;
              if (vDotN < 0) {
                vel.x -= vDotN * nx;
                vel.y -= vDotN * ny;
                vel.z -= vDotN * nz;
              }
            } else {
              pos.y = anchor.position.y + clearR;
              vel.y = Math.max(0, vel.y);
            }
          } else {
            const dXZ = Math.hypot(dx, dz);
            const reqXZ = Math.sqrt(Math.max(0.01, clearR * clearR - Math.max(0, dy) * Math.max(0, dy)));
            let nx = 1;
            let nz = 0;
            if (dXZ > 1e-4) {
              nx = dx / dXZ;
              nz = dz / dXZ;
            } else {
              const vLen = Math.hypot(vel.x, vel.z);
              if (vLen > 1e-4) {
                nx = -vel.x / vLen;
                nz = -vel.z / vLen;
              }
            }
            pos.x = anchor.position.x + nx * reqXZ;
            pos.z = anchor.position.z + nz * reqXZ;
            const vDotN = vel.x * nx + vel.z * nz;
            if (vDotN < 0) {
              const tx = -nz;
              const tz = nx;
              const tangSign = vel.x * tx + vel.z * tz >= 0 ? 1 : -1;
              vel.x -= vDotN * nx;
              vel.z -= vDotN * nz;
              vel.x += tx * tangSign * Math.abs(vDotN) * 0.35;
              vel.z += tz * tangSign * Math.abs(vDotN) * 0.35;
            }
          }
        }
      }

      if (!changed) break;
    }
  }

  function steerClearObstacles(pos, vel, steerOut, margin = 0.34, checkAnemones = true, liftAbove = false) {
    for (let c = 0; c < coralHeads.length; c++) {
      const head = coralHeads[c];
      if (head.active === false) continue;
      const topY = head.topWorldY ?? (head.position.y + head.radius * 0.45);
      const baseY = head.baseY ?? (head.position.y - head.radius * 0.45);
      if (pos.y < baseY - 0.18 || pos.y > topY + margin) continue;
      const dx = pos.x - head.position.x;
      const dz = pos.z - head.position.z;
      const avoidR = head.radius + margin;
      const distSq = dx * dx + dz * dz;
      if (distSq >= avoidR * avoidR) continue;
      const dist = Math.sqrt(distSq);
      const push = (avoidR - dist) / avoidR;
      if (liftAbove && pos.y > topY - 0.25) {
        steerOut.y += Math.max(0.8, (topY + margin - pos.y) * 5.0) * push;
      } else {
        const nx = dist > 1e-4 ? dx / dist : 1;
        const nz = dist > 1e-4 ? dz / dist : 0;
        const tangSign = -nz * vel.x + nx * vel.z >= 0 ? 1 : -1;
        steerOut.x += nx * push * 4.4 - nz * tangSign * push * 1.8;
        steerOut.z += nz * push * 4.4 + nx * tangSign * push * 1.8;
      }
    }
    if (checkAnemones) {
      for (let a = 0; a < anemoneAnchors.length; a++) {
        const anchor = anemoneAnchors[a];
        if (anchor.active === false) continue;
        const topY = anchor.position.y + anchor.radius * 0.72;
        if (pos.y < anchor.position.y - anchor.radius * 0.6 || pos.y > topY + margin) continue;
        const dx = pos.x - anchor.position.x;
        const dz = pos.z - anchor.position.z;
        const avoidR = anchor.radius + margin;
        const distSq = dx * dx + dz * dz;
        if (distSq >= avoidR * avoidR) continue;
        const dist = Math.sqrt(distSq);
        const push = (avoidR - dist) / avoidR;
        if (liftAbove && pos.y > topY - 0.22) {
          steerOut.y += Math.max(0.8, (topY + margin - pos.y) * 5.0) * push;
        } else {
          const nx = dist > 1e-4 ? dx / dist : 1;
          const nz = dist > 1e-4 ? dz / dist : 0;
          const tangSign = -nz * vel.x + nx * vel.z >= 0 ? 1 : -1;
          steerOut.x += nx * push * 4.2 - nz * tangSign * push * 1.6;
          steerOut.z += nz * push * 4.2 + nx * tangSign * push * 1.6;
        }
      }
    }
  }

  function applyBounds(pos, vel, surfaceLimitY, steerOut, radiusLimit = 18.0) {
    const seabedY = getSeabedHeight(pos.x, pos.z) + 0.42;
    if (pos.y < seabedY) {
      steerOut.y += (seabedY - pos.y) * 5.5;
      if (pos.y < seabedY - 0.15) {
        pos.y = seabedY - 0.15;
        vel.y = Math.max(0.05, vel.y);
      }
    }
    if (pos.y > surfaceLimitY) {
      steerOut.y -= (pos.y - surfaceLimitY) * 6.0;
      if (pos.y > surfaceLimitY + 0.25) {
        pos.y = surfaceLimitY + 0.25;
        vel.y = Math.min(-0.05, vel.y);
      }
    }
    const rHorizSq = pos.x * pos.x + pos.z * pos.z;
    if (rHorizSq > radiusLimit * radiusLimit) {
      const rHoriz = Math.sqrt(rHorizSq);
      const excess = rHoriz - radiusLimit;
      steerOut.x -= (pos.x / rHoriz) * excess * 1.4;
      steerOut.z -= (pos.z / rHoriz) * excess * 1.4;
    }
  }

  function steerButterflyReefFloor(bf, clearance, surfaceLimitY, steerOut) {
    const localFloorY = getSeabedHeight(bf.pos.x, bf.pos.z);
    const desiredY = Math.min(surfaceLimitY - 0.25, localFloorY + clearance);
    steerOut.y += (desiredY - bf.pos.y) * 5.2 - bf.vel.y * 1.8;

    const rHorizSq = bf.pos.x * bf.pos.x + bf.pos.z * bf.pos.z;
    if (rHorizSq > 15.5 * 15.5) {
      const rHoriz = Math.sqrt(rHorizSq);
      const excess = rHoriz - 15.5;
      steerOut.x -= (bf.pos.x / rHoriz) * excess * 2.2;
      steerOut.z -= (bf.pos.z / rHoriz) * excess * 2.2;
    }

    for (let b = 0; b < safeBommies.length; b++) {
      const bommy = safeBommies[b];
      if (
        bommy.id === 'reef-arch' &&
        Math.abs(bf.pos.x + 2.0) < 0.85 &&
        Math.abs(bf.pos.z - 1.8) < 1.35
      ) {
        continue;
      }
      const dx = bf.pos.x - bommy.x;
      const dz = bf.pos.z - bommy.z;
      const avoidR = bommy.radius * 0.88 + 0.38;
      const distSq = dx * dx + dz * dz;
      if (distSq < avoidR * avoidR && bf.pos.y < bommy.baseY + bommy.height * 0.72) {
        const dist = Math.sqrt(distSq);
        const nx = dist > 1e-4 ? dx / dist : 1;
        const nz = dist > 1e-4 ? dz / dist : 0;
        const push = (avoidR - dist) / avoidR;
        const tangSign = -nz * bf.vel.x + nx * bf.vel.z >= 0 ? 1 : -1;
        steerOut.x += nx * push * 4.6 - nz * tangSign * push * 1.8;
        steerOut.z += nz * push * 4.6 + nx * tangSign * push * 1.8;
      }
    }

    for (let c = 0; c < coralHeads.length; c++) {
      const head = coralHeads[c];
      if (head.active === false) continue;
      const topY = head.topWorldY ?? (head.position.y + head.radius * 0.45);
      const baseY = head.baseY ?? (head.position.y - head.radius * 0.45);
      if (bf.pos.y < baseY - 0.15 || bf.pos.y > topY + 0.28) continue;
      const dx = bf.pos.x - head.position.x;
      const dz = bf.pos.z - head.position.z;
      const avoidR = head.radius + 0.26;
      const distSq = dx * dx + dz * dz;
      if (distSq < avoidR * avoidR) {
        const dist = Math.sqrt(distSq);
        const nx = dist > 1e-4 ? dx / dist : 1;
        const nz = dist > 1e-4 ? dz / dist : 0;
        const push = (avoidR - dist) / avoidR;
        const tangSign = -nz * bf.vel.x + nx * bf.vel.z >= 0 ? 1 : -1;
        steerOut.x += nx * push * 4.2 - nz * tangSign * push * 1.6;
        steerOut.z += nz * push * 4.2 + nx * tangSign * push * 1.6;
      }
    }
    for (let a = 0; a < anemoneAnchors.length; a++) {
      const anchor = anemoneAnchors[a];
      if (anchor.active === false) continue;
      if (bf.pos.y > anchor.position.y + anchor.radius * 0.78) continue;
      const dx = bf.pos.x - anchor.position.x;
      const dz = bf.pos.z - anchor.position.z;
      const avoidR = anchor.radius + 0.24;
      const distSq = dx * dx + dz * dz;
      if (distSq < avoidR * avoidR) {
        const dist = Math.sqrt(distSq);
        const nx = dist > 1e-4 ? dx / dist : 1;
        const nz = dist > 1e-4 ? dz / dist : 0;
        const push = (avoidR - dist) / avoidR;
        const tangSign = -nz * bf.vel.x + nx * bf.vel.z >= 0 ? 1 : -1;
        steerOut.x += nx * push * 4.0 - nz * tangSign * push * 1.6;
        steerOut.z += nz * push * 4.0 + nx * tangSign * push * 1.6;
      }
    }
  }

  function integrateButterfly(bf, clearance, minSp, maxSp, dt, surfaceLimitY, steerOut) {
    steerButterflyReefFloor(bf, clearance, surfaceLimitY, steerOut);
    bf.vel.addScaledVector(steerOut, dt);
    const sp = bf.vel.length();
    if (sp < 1e-5) bf.vel.set(0.3, 0, 0);
    else bf.vel.multiplyScalar(THREE.MathUtils.clamp(sp, minSp, maxSp) / sp);
    bf.pos.addScaledVector(bf.vel, dt);

    const newFloorY = getSeabedHeight(bf.pos.x, bf.pos.z);
    const floorClampY = newFloorY + 0.17;
    const ceilClampY = Math.min(surfaceLimitY - 0.15, newFloorY + 0.55);
    if (bf.pos.y < floorClampY) {
      bf.pos.y = floorClampY;
      bf.vel.y = Math.max(0, bf.vel.y);
    } else if (bf.pos.y > ceilClampY) {
      bf.pos.y = ceilClampY;
      bf.vel.y = Math.min(0, bf.vel.y);
    }
  }

  function setHidingSwirlVel(f, host, minSp, idx, yVel = 0) {
    const rx = f.pos.x - host.position.x;
    const rz = f.pos.z - host.position.z;
    const rLen = Math.hypot(rx, rz);
    const swirlSign = idx % 2 === 0 ? 1 : -1;
    const tx = rLen > 1e-4 ? (-rz / rLen) * swirlSign : Math.cos(f.hideAngle + Math.PI * 0.5);
    const tz = rLen > 1e-4 ? (rx / rLen) * swirlSign : Math.sin(f.hideAngle + Math.PI * 0.5);
    f.vel.set(tx * minSp, yVel, tz * minSp);
    if (yVel !== 0) f.vel.setLength(minSp);
  }

  function updateReefSchool(
    list,
    meshes,
    elapsedTime,
    dt,
    surfaceLimitY,
    baseSpeedRange,
    sepR,
    effFlow,
    activeCount,
    activeHostCorals
  ) {
    if (activeCount <= 0) return;
    const isDual = Boolean(meshes.maleMeshes && meshes.femaleMeshes);
    let maleIdx = 0;
    let femaleIdx = 0;
    const sepSq = sepR * sepR;
    const hasActiveHosts = activeHostCorals.length > 0;
    const hasShelterHosts =
      hasActiveHosts &&
      (activeHostCorals[0].speciesId === 'acropora' || activeHostCorals[0].speciesId === 'stylophora');

    for (let i = 0; i < activeCount; i++) {
      const f = list[i];
      let host = f.hostCoral;
      const hostIsShelter = host.speciesId === 'acropora' || host.speciesId === 'stylophora';
      if (
        hasActiveHosts &&
        (host.active === false || !activeHostCorals.includes(host) || (!hostIsShelter && hasShelterHosts))
      ) {
        host = activeHostCorals[i % activeHostCorals.length];
        f.hostCoral = host;
      }
      const hostActive = hasActiveHosts && host.active !== false;
      const hostCanShelter = host.speciesId === 'acropora' || host.speciesId === 'stylophora';
      const hostTopY = host.topWorldY ?? (host.position.y + host.radius * 0.45);
      const hostBaseY = host.baseY ?? (host.position.y - host.radius * 0.45);
      computeLocalUpstream(host.position.x, host.position.z, elapsedTime, vUpstream, vCrossStream);

      const colonyThreat = nearestPredatorThreat(host.position, 2.05, true).threat;
      const fishThreat = nearestPredatorThreat(f.pos, 1.10, false).threat;
      const rawThreat = Math.max(colonyThreat, fishThreat);
      let targetAlert = hostActive && hostCanShelter && rawThreat > 0.10 ? 1.0 : 0.0;
      if (rawThreat <= 0.10) {
        f.continuousHideTimer = 0;
      } else if (f.alertLevel > 0.35 && hostActive && hostCanShelter) {
        f.continuousHideTimer += dt;
        if (f.continuousHideTimer > 2.4 && fishThreat < 0.35) {
          targetAlert = 0.0;
        }
      }
      const rampRate = targetAlert > f.alertLevel ? 8.5 : 3.0;
      f.alertLevel = THREE.MathUtils.lerp(f.alertLevel, targetAlert, Math.min(1, dt * rampRate));

      vForce.set(0, 0, 0);
      let distToHide = 0;
      const isHiding = hostActive && hostCanShelter && f.alertLevel > 0.35;

      if (isHiding) {
        // Dive into upper/outer inter-branch gaps of open-branching Acropora/Stylophora host
        const hideX = host.position.x + Math.cos(f.hideAngle) * host.radius * f.hideRadFrac;
        const hideZ = host.position.z + Math.sin(f.hideAngle) * host.radius * f.hideRadFrac;
        const hideY = Math.max(hostBaseY + 0.08, hostTopY + f.hideYRelTop);
        f.hideOffset.set(hideX - host.position.x, hideY - host.position.y, hideZ - host.position.z);

        vDiff.set(hideX - f.pos.x, hideY - f.pos.y, hideZ - f.pos.z);
        distToHide = vDiff.length();
        if (distToHide > 0.08) {
          vForce.addScaledVector(vDiff, Math.min(12.0, distToHide * 12.0) / distToHide);
          vForce.addScaledVector(f.vel, -4.0);
        } else {
          // Subtle inter-branch weaving without stalling to zero velocity
          vForce.set(
            (hideX - f.pos.x) * 4.5 + Math.sin(elapsedTime * 5.2 + i * 1.7) * 0.48,
            (hideY - f.pos.y) * 4.5 + Math.cos(elapsedTime * 4.1 + i) * 0.22,
            (hideZ - f.pos.z) * 4.5 + Math.cos(elapsedTime * 5.5 + i * 1.3) * 0.48
          );
        }
        f.feedPitch = THREE.MathUtils.lerp(f.feedPitch, 0, Math.min(1, dt * 8.0));
      } else {
        // Normal Plankton-Feeding State: windward station-holding + local separation + foraging snaps
        const surgeShift = Math.sin(elapsedTime * 0.72 + f.stationPhase) * 0.10;
        const hx = host.position.x + vUpstream.x * (f.upDist + surgeShift) + vCrossStream.x * f.crossDist;
        const hz = host.position.z + vUpstream.z * (f.upDist + surgeShift) + vCrossStream.z * f.crossDist;
        const hy = Math.min(
          surfaceLimitY - 0.22,
          hostTopY + f.hoverOffsetY + Math.sin(elapsedTime * 1.05 + f.stationPhase) * 0.055
        );

        vForce.x += (hx - f.pos.x) * 2.6;
        vForce.y += (hy - f.pos.y) * 2.6;
        vForce.z += (hz - f.pos.z) * 2.6;

        vSep.set(0, 0, 0);
        let sepC = 0;
        for (let j = 0; j < activeCount; j++) {
          if (i === j) continue;
          vDiff.subVectors(f.pos, list[j].pos);
          const dSq = vDiff.lengthSq();
          if (dSq < sepSq && dSq > 1e-6) {
            const d = Math.sqrt(dSq);
            vSep.addScaledVector(vDiff, (sepR - d) / (sepR * d));
            sepC++;
          }
        }
        if (sepC > 0) {
          vSep.divideScalar(sepC);
          vForce.addScaledVector(vSep, 1.85);
        }

        vForce.addScaledVector(f.vel, -3.2);
        applyBounds(f.pos, f.vel, surfaceLimitY, vForce, 17.0);

        // Plankton-Snapping Foraging Darts
        f.feedTimer -= dt;
        if (f.feedTimer <= 0) {
          f.snapTimer = 0.22 + (i % 3) * 0.05;
          f.feedTimer = 1.9 + ((i * 1.37) % 3.6);
          f.snapDir
            .copy(vUpstream)
            .addScaledVector(vCrossStream, Math.sin(elapsedTime * 7.3 + i) * 0.15);
          f.snapDir.y += 0.10;
          safeNormalize(f.snapDir, smoothedUpstream.x, smoothedUpstream.y, smoothedUpstream.z);
        }
        if (f.snapTimer > 0) {
          f.snapTimer = Math.max(0, f.snapTimer - dt);
          vForce.addScaledVector(f.snapDir, 3.6);
          f.feedPitch = THREE.MathUtils.lerp(f.feedPitch, -0.14, Math.min(1, dt * 14.0));
        } else {
          f.feedPitch = THREE.MathUtils.lerp(f.feedPitch, 0, Math.min(1, dt * 7.0));
        }
      }

      f.vel.addScaledVector(vForce, dt);
      const sp = f.vel.length();
      if (isHiding) {
        const burstMax = baseSpeedRange[1] * (1.0 + f.alertLevel * 1.3);
        const maxSp = distToHide < 0.4 ? Math.min(burstMax, Math.max(0.28, distToHide * 3.5)) : burstMax;
        const minSp = 0.16;
        if (sp < minSp) {
          if (sp > 1e-4 && distToHide > 0.08) {
            f.vel.multiplyScalar(minSp / sp);
          } else {
            setHidingSwirlVel(f, host, minSp, i, Math.cos(elapsedTime * 4.1 + i) * 0.04);
          }
        } else if (sp > maxSp) {
          f.vel.multiplyScalar(maxSp / sp);
        }
      } else {
        const maxSp = f.snapTimer > 0 ? 0.62 : 0.24;
        if (sp > maxSp && sp > 1e-5) {
          f.vel.multiplyScalar(maxSp / sp);
        }
      }

      f.pos.addScaledVector(f.vel, dt);
      resolveOutsideObstacles(f.pos, f.vel, {
        margin: 0.14,
        checkAnemones: true,
        skipCoral: isHiding ? host : null,
      });
      if (isHiding) {
        const minSp = 0.16;
        const spPost = f.vel.length();
        if (spPost < minSp) {
          if (spPost > 1e-4) {
            f.vel.multiplyScalar(minSp / spPost);
          } else {
            setHidingSwirlVel(f, host, minSp, i);
          }
        }
      }

      // Water-relative swimming heading & active tail beat into oncoming flow
      const flowWeight = isHiding && distToHide > 0.08 ? 0.12 : 1.0;
      vWater.copy(f.vel).addScaledVector(vUpstream, flowWeight * effFlow);
      const waterSpeed = vWater.length();
      vWaterDir.copy(vWater);
      safeNormalize(vWaterDir, vUpstream.x, vUpstream.y, vUpstream.z);
      f.heading.lerp(vWaterDir, Math.min(1, dt * 8.5));
      safeNormalize(f.heading, vUpstream.x, vUpstream.y, vUpstream.z);
      f.swimPhase += dt * ((f.swimFreq || 8.5) + waterSpeed * 5.0);

      const speedRatio = THREE.MathUtils.clamp(waterSpeed / 1.4, 0, 1);
      const bodyAmp = isHiding
        ? 0.0085 + 0.0055 * Math.max(speedRatio, f.alertLevel)
        : 0.0045 + 0.0045 * speedRatio + (f.snapTimer > 0 ? 0.001 : 0);
      const finAmp = isHiding
        ? 0.007 + 0.003 * speedRatio
        : 0.010 + 0.0035 * speedRatio + (f.snapTimer > 0 ? 0.0015 : 0);

      const targetMeshes = isDual ? (f.isMale ? meshes.maleMeshes : meshes.femaleMeshes) : meshes;
      const instIdx = isDual ? (f.isMale ? maleIdx++ : femaleIdx++) : i;
      setSwimState(targetMeshes.swimAttr, instIdx, f.swimPhase, bodyAmp, finAmp);

      const { bodyMatrix, tailMatrix } = orientFishMatrix(
        f.pos,
        f.heading,
        f.scale,
        Math.sin(f.swimPhase) * 0.032,
        Math.sin(f.swimPhase - 0.55) * 0.22,
        f.feedPitch,
        targetMeshes.tailPivotZ,
        scratch
      );
      targetMeshes.bodyMesh.setMatrixAt(instIdx, bodyMatrix);
      targetMeshes.tailMesh.setMatrixAt(instIdx, tailMatrix);
    }
    if (isDual) {
      setPairCount(meshes.maleMeshes, maleIdx);
      setPairCount(meshes.femaleMeshes, femaleIdx);
      if (maleIdx > 0) {
        meshes.maleMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
        meshes.maleMeshes.tailMesh.instanceMatrix.needsUpdate = true;
        meshes.maleMeshes.swimAttr.needsUpdate = true;
      }
      if (femaleIdx > 0) {
        meshes.femaleMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
        meshes.femaleMeshes.tailMesh.instanceMatrix.needsUpdate = true;
        meshes.femaleMeshes.swimAttr.needsUpdate = true;
      }
    } else {
      meshes.bodyMesh.instanceMatrix.needsUpdate = true;
      meshes.tailMesh.instanceMatrix.needsUpdate = true;
      meshes.swimAttr.needsUpdate = true;
    }
  }

  function stepCrossingSchool(school, targetY, elapsedTime, dt) {
    const turnRadius = school.speed / Math.max(0.1, school.turnRate);
    const triggerMargin = turnRadius * 1.05;
    if (!school.isTurning) {
      if (
        (school.dirSign > 0 && school.pos.x >= school.xBound - triggerMargin) ||
        (school.dirSign < 0 && school.pos.x <= -school.xBound + triggerMargin)
      ) {
        school.dirSign *= -1;
        school.isTurning = true;
        const zErr = school.pos.z - (school.baseZ + school.pos.x * school.zSlope);
        if (Math.abs(zErr) > 0.25) {
          school.turnSign = (school.dirSign < 0 ? -1 : 1) * (zErr > 0 ? 1 : -1);
        } else {
          school.turnSign = school.defaultTurnSign;
        }
      }
    }

    const desiredZ =
      school.baseZ +
      school.pos.x * school.zSlope +
      Math.sin(elapsedTime * school.zWaveFreq + school.wavePhase) * school.zWaveAmp;
    const cruiseDx = school.dirSign;
    const cruiseDz = school.dirSign * school.zSlope + THREE.MathUtils.clamp((desiredZ - school.pos.z) * 0.35, -0.45, 0.45);
    const targetTheta = Math.atan2(cruiseDz, cruiseDx);
    const diff = Math.atan2(Math.sin(targetTheta - school.theta), Math.cos(targetTheta - school.theta));
    const maxStep = school.turnRate * dt;

    if (school.isTurning) {
      if (Math.abs(diff) <= maxStep * 1.35) {
        school.theta = targetTheta;
        school.isTurning = false;
      } else {
        school.theta += school.turnSign * maxStep;
      }
    } else {
      school.theta += THREE.MathUtils.clamp(diff, -maxStep, maxStep);
    }

    const prevY = school.pos.y;
    school.pos.x = THREE.MathUtils.clamp(
      school.pos.x + Math.cos(school.theta) * school.speed * dt,
      -school.xBound - 0.15,
      school.xBound + 0.15
    );
    school.pos.z += Math.sin(school.theta) * school.speed * dt;
    school.pos.y = THREE.MathUtils.lerp(school.pos.y, targetY, Math.min(1, dt * 3.5));

    const vy = (school.pos.y - prevY) / Math.max(dt, 1e-4);
    school.vel.set(Math.cos(school.theta) * school.speed, vy, Math.sin(school.theta) * school.speed);
    school.heading.copy(school.vel);
    safeNormalize(school.heading, school.dirSign, 0, 0);
  }

  function stepCleaningVisit(entity, hoverPos, surfaceLimitY, minFloorClearance, maxApproachSpeed, dampRadius, maxHoverSpeed, targetPitch, dt) {
    const tx = hoverPos.x;
    const tz = hoverPos.z;
    const ty = Math.min(surfaceLimitY - 0.25, Math.max(getSeabedHeight(tx, tz) + minFloorClearance, hoverPos.y));
    vDiff.set(tx - entity.pos.x, ty - entity.pos.y, tz - entity.pos.z);
    const dist = vDiff.length();

    if (dist > dampRadius) {
      vForce.copy(vDiff).multiplyScalar(Math.min(5.5, dist * 4.5) / dist).addScaledVector(entity.vel, -3.2);
      entity.vel.addScaledVector(vForce, dt);
      const sp = entity.vel.length();
      if (sp > maxApproachSpeed && sp > 1e-5) {
        entity.vel.multiplyScalar(maxApproachSpeed / sp);
      }
      entity.pos.addScaledVector(entity.vel, dt);
      if (sp > 0.06) {
        vWaterDir.copy(entity.vel);
        safeNormalize(vWaterDir, entity.heading.x, 0, entity.heading.z);
        entity.heading.lerp(vWaterDir, Math.min(1, dt * 7.0));
      }
    } else {
      entity.vel.addScaledVector(vDiff, 4.0 * dt);
      entity.vel.multiplyScalar(Math.max(0, 1.0 - dt * 12.0));
      const sp = entity.vel.length();
      const hoverCap = maxHoverSpeed * 0.88;
      if (sp > hoverCap && sp > 1e-5) {
        entity.vel.multiplyScalar(hoverCap / sp);
      }
      entity.pos.addScaledVector(entity.vel, dt);
      entity.heading.y = THREE.MathUtils.lerp(entity.heading.y, 0, Math.min(1, dt * 6.0));
    }

    safeNormalize(entity.heading, 1, 0, 0);
    entity.cleanPosePitch = THREE.MathUtils.lerp(
      entity.cleanPosePitch ?? 0,
      dist <= dampRadius * 1.4 ? targetPitch : targetPitch * 0.4,
      Math.min(1, dt * 6.0)
    );
    return dist;
  }

  function avoidBommiesXZ(pos, vel, steerOut) {
    for (let b = 0; b < safeBommies.length; b++) {
      const bommy = safeBommies[b];
      if (
        bommy.id === 'reef-arch' &&
        Math.abs(pos.x + 2.0) < 0.85 &&
        Math.abs(pos.z - 1.8) < 1.35
      ) {
        continue;
      }
      const dx = pos.x - bommy.x;
      const dz = pos.z - bommy.z;
      const avoidR = bommy.radius * 0.9 + 0.42;
      const distSq = dx * dx + dz * dz;
      if (distSq < avoidR * avoidR && pos.y < bommy.baseY + bommy.height + 0.35) {
        const dist = Math.sqrt(distSq);
        const nx = dist > 1e-4 ? dx / dist : 1;
        const nz = dist > 1e-4 ? dz / dist : 0;
        const push = (avoidR - dist) / avoidR;
        const tangSign = -nz * vel.x + nx * vel.z >= 0 ? 1 : -1;
        steerOut.x += nx * push * 5.2 - nz * tangSign * push * 2.0;
        steerOut.z += nz * push * 5.2 + nx * tangSign * push * 2.0;
      }
    }
  }

  const activeCounts = {
    pseudanthias: DEFAULT_ANTHIAS_COUNT,
    chromis: DEFAULT_CHROMIS_COUNT,
    abudefduf: DEFAULT_SERGEANT_COUNT,
    amphiprion: DEFAULT_CLOWN_COUNT,
    goatfish: DEFAULT_GOAT_COUNT,
    chaetodon: DEFAULT_BF_PAIR_COUNT * 2,
    caesio: DEFAULT_FUSILIER_COUNT,
  };

  function setPairCount(meshes, count) {
    meshes.bodyMesh.count = count;
    meshes.tailMesh.count = count;
    const vis = count > 0;
    meshes.bodyMesh.visible = vis;
    meshes.tailMesh.visible = vis;
  }

  function applySpeciesCounts(speciesCounts) {
    const nAnthias = sanitizeSpeciesCount('pseudanthias', speciesCounts?.pseudanthias ?? DEFAULT_ANTHIAS_COUNT);
    activeCounts.pseudanthias = nAnthias;
    let anthiasMaleCount = 0;
    for (let i = 0; i < nAnthias; i++) {
      if (anthias[i].isMale) anthiasMaleCount++;
    }
    setPairCount(anthiasMaleMeshes, anthiasMaleCount);
    setPairCount(anthiasFemaleMeshes, nAnthias - anthiasMaleCount);

    const rawChromis = speciesCounts?.chromis ?? DEFAULT_CHROMIS_COUNT;
    const nChromis = SPECIES_POPULATION_SPEC.chromis
      ? sanitizeSpeciesCount('chromis', rawChromis)
      : Math.max(
          0,
          Math.min(
            MAX_CHROMIS_COUNT,
            Number.isFinite(Number(rawChromis)) ? Math.round(Number(rawChromis)) : DEFAULT_CHROMIS_COUNT
          )
        );
    activeCounts.chromis = nChromis;
    setPairCount(chromisMeshes, nChromis);

    const nSergeant = sanitizeSpeciesCount('abudefduf', speciesCounts?.abudefduf ?? DEFAULT_SERGEANT_COUNT);
    activeCounts.abudefduf = nSergeant;
    setPairCount(sergeantMeshes, nSergeant);

    const nClown = sanitizeSpeciesCount('amphiprion', speciesCounts?.amphiprion ?? DEFAULT_CLOWN_COUNT);
    activeCounts.amphiprion = nClown;
    setPairCount(clownMeshes, nClown);

    const nGoat = sanitizeSpeciesCount('goatfish', speciesCounts?.goatfish ?? DEFAULT_GOAT_COUNT);
    activeCounts.goatfish = nGoat;
    setPairCount(goatMeshes, nGoat);
    for (let i = nGoat; i < MAX_GOAT_COUNT; i++) {
      const gf = goatfish[i];
      if (gf.cleanState !== 'none') {
        cleaningSystem?.releaseStation(gf.clientKey);
        gf.cleanState = 'none';
        gf.cleanTarget = null;
        gf.cleanTimer = 0;
        gf.approachTimer = 0;
      }
    }

    const nButterflyRaw = sanitizeSpeciesCount(
      'chaetodon',
      speciesCounts?.chaetodon ?? DEFAULT_BF_PAIR_COUNT * 2
    );
    const nButterflyEven = Math.floor(nButterflyRaw / 2) * 2;
    const activePairs = nButterflyEven / 2;
    activeCounts.chaetodon = nButterflyEven;
    setPairCount(butterflyMeshes, nButterflyEven);
    for (let p = activePairs; p < MAX_BF_PAIR_COUNT; p++) {
      const pair = butterflyPairs[p];
      if (pair.cleanState !== 'none') {
        cleaningSystem?.releaseStation(pair.clientKey);
        pair.cleanState = 'none';
        pair.cleanTarget = null;
        pair.cleanTimer = 0;
        pair.approachTimer = 0;
      }
    }

    const nFusilier = sanitizeSpeciesCount('caesio', speciesCounts?.caesio ?? DEFAULT_FUSILIER_COUNT);
    activeCounts.caesio = nFusilier;
    setPairCount(fusilierMeshes, nFusilier);
  }

  function update(elapsedTime, deltaTime, envState) {
    applySpeciesCounts(envState?.speciesCounts);
    const dt = Math.min(Math.max(deltaTime || 0.016, 0.001), 0.05);
    const rawDir = Number.isFinite(envState?.currentDirection) ? envState.currentDirection : 180;
    const rawSpd = Number.isFinite(envState?.currentSpeed) ? envState.currentSpeed : 0.45;
    const targetSpeed = THREE.MathUtils.clamp(rawSpd, 0, 1.2);
    const toRad = (rawDir * Math.PI) / 180;
    targetUpstream.set(-Math.sin(toRad), 0.045, Math.cos(toRad));
    safeNormalize(targetUpstream, 0, 0.045, -1);

    smoothedUpstream.lerp(targetUpstream, Math.min(1, dt * 3.2));
    safeNormalize(smoothedUpstream, 0, 0.045, -1);
    smoothedSpeed = THREE.MathUtils.lerp(smoothedSpeed, targetSpeed, Math.min(1, dt * 3.5));

    const effFlow = 0.22 + smoothedSpeed * 1.05;
    const surfaceLimitY = WORLD_CONSTANTS.SURFACE_BASE_Y + (envState?.diveDepth ?? 6.0) - 0.55;

    const activeBranchingCorals = [];
    const activeAllCorals = [];
    for (let c = 0; c < coralHeads.length; c++) {
      const ch = coralHeads[c];
      if (ch.active === false) continue;
      activeAllCorals.push(ch);
      if (ch.speciesId === 'acropora' || ch.speciesId === 'stylophora') {
        activeBranchingCorals.push(ch);
      }
    }
    const activeHostCorals = activeBranchingCorals.length > 0 ? activeBranchingCorals : activeAllCorals;
    const anthiasHostCorals =
      activeBranchingCorals.length >= 2
        ? activeBranchingCorals.filter((_, idx) => idx % 2 === 0)
        : activeHostCorals;
    const chromisHostCorals =
      activeBranchingCorals.length >= 2
        ? activeBranchingCorals.filter((_, idx) => idx % 2 === 1)
        : activeHostCorals;

    // 1: Pseudanthias station-holding on even branching corals + predator hiding
    updateReefSchool(
      anthias,
      { maleMeshes: anthiasMaleMeshes, femaleMeshes: anthiasFemaleMeshes },
      elapsedTime,
      dt,
      surfaceLimitY,
      [0.42, 1.55],
      0.36,
      effFlow,
      activeCounts.pseudanthias,
      anthiasHostCorals
    );

    // 1b: Blue-Green Chromis shimmering clouds on odd branching corals + predator hiding
    updateReefSchool(
      chromis,
      chromisMeshes,
      elapsedTime,
      dt,
      surfaceLimitY,
      [0.38, 1.35],
      0.24,
      effFlow,
      activeCounts.chromis,
      chromisHostCorals
    );

    // 2: Abudefduf vaigiensis (3 cohesive reef-crossing schools continuously moving above canopies)
    const activeSergeantCount = activeCounts.abudefduf;
    if (activeSergeantCount > 0) {
      for (let s = 0; s < sergeantSchools.length; s++) {
        const school = sergeantSchools[s];
        const localSeabedY = getSeabedHeight(school.pos.x, school.pos.z);
        let canopyY = localSeabedY + school.hoverHeight;
        for (let c = 0; c < activeAllCorals.length; c++) {
          const head = activeAllCorals[c];
          const clearR = head.radius + 0.55;
          const dx = school.pos.x - head.position.x;
          const dz = school.pos.z - head.position.z;
          if (dx * dx + dz * dz < clearR * clearR) {
            const topY = head.topWorldY ?? (head.position.y + head.radius * 0.45);
            if (topY + 0.44 > canopyY) canopyY = topY + 0.44;
          }
        }
        for (let a = 0; a < anemoneAnchors.length; a++) {
          const anchor = anemoneAnchors[a];
          if (anchor.active === false) continue;
          const clearR = anchor.radius + 0.55;
          const dx = school.pos.x - anchor.position.x;
          const dz = school.pos.z - anchor.position.z;
          if (dx * dx + dz * dz < clearR * clearR) {
            const topY = anchor.position.y + anchor.radius * 0.72;
            if (topY + 0.44 > canopyY) canopyY = topY + 0.44;
          }
        }
        const targetY = Math.min(
          surfaceLimitY - 0.35,
          canopyY + Math.sin(elapsedTime * 0.55 + s * 2.1) * 0.12
        );
        stepCrossingSchool(school, targetY, elapsedTime, dt);
      }
    }

    const sgtSepR = 0.36;
    const sgtSepSq = sgtSepR * sgtSepR;
    for (let i = 0; i < activeSergeantCount; i++) {
      const f = sergeants[i];
      const school = sergeantSchools[f.schoolIdx];
      const { threat, predator } = nearestPredatorThreat(f.pos, 1.85);
      const isEvading = threat > 0.28 && Boolean(predator);

      // Compute rotated slot relative to school heading
      vDiff.set(school.heading.x, 0, school.heading.z);
      safeNormalize(vDiff, school.dirSign, 0, 0);
      vRight.set(vDiff.z, 0, -vDiff.x);
      const slotX = school.pos.x + vDiff.x * f.localSlot.along + vRight.x * f.localSlot.across;
      const slotZ = school.pos.z + vDiff.z * f.localSlot.along + vRight.z * f.localSlot.across;
      let minCanopyY = getSeabedHeight(slotX, slotZ) + 0.42;
      for (let c = 0; c < activeAllCorals.length; c++) {
        const head = activeAllCorals[c];
        const clearR = head.radius + 0.38;
        const dx = slotX - head.position.x;
        const dz = slotZ - head.position.z;
        if (dx * dx + dz * dz < clearR * clearR) {
          const topY = head.topWorldY ?? (head.position.y + head.radius * 0.45);
          if (topY + 0.36 > minCanopyY) minCanopyY = topY + 0.36;
        }
      }
      for (let a = 0; a < anemoneAnchors.length; a++) {
        const anchor = anemoneAnchors[a];
        if (anchor.active === false) continue;
        const clearR = anchor.radius + 0.38;
        const dx = slotX - anchor.position.x;
        const dz = slotZ - anchor.position.z;
        if (dx * dx + dz * dz < clearR * clearR) {
          const topY = anchor.position.y + anchor.radius * 0.72;
          if (topY + 0.36 > minCanopyY) minCanopyY = topY + 0.36;
        }
      }
      const slotY = Math.min(
        surfaceLimitY - 0.25,
        Math.max(minCanopyY, school.pos.y + f.localSlot.vert)
      );

      vForce.set(slotX - f.pos.x, slotY - f.pos.y, slotZ - f.pos.z);
      const distToSlot = vForce.length();
      if (distToSlot > 1e-4) {
        const slotGain = distToSlot > 2.0 ? 3.8 : 2.6;
        vForce.multiplyScalar(Math.min(5.2, distToSlot * slotGain) / distToSlot);
      }

      if (isEvading) {
        vDiff.subVectors(f.pos, predator.pos);
        safeNormalize(vDiff, 0, 0.3, 1);
        vForce.addScaledVector(vDiff, 6.5 * threat);
      }

      // Strong alignment with school velocity & nearby schoolmates for polarization > 0.85
      vForce.addScaledVector(school.vel, 2.8);
      vSep.set(0, 0, 0);
      let sepC = 0;
      let alignX = 0;
      let alignY = 0;
      let alignZ = 0;
      let alignC = 0;
      for (let j = 0; j < activeSergeantCount; j++) {
        if (i === j) continue;
        const other = sergeants[j];
        vDiff.subVectors(f.pos, other.pos);
        const dSq = vDiff.lengthSq();
        if (dSq < sgtSepSq && dSq > 1e-6) {
          const d = Math.sqrt(dSq);
          vSep.addScaledVector(vDiff, (sgtSepR - d) / (sgtSepR * d));
          sepC++;
        }
        if (other.schoolIdx === f.schoolIdx && dSq < 3.6) {
          alignX += other.vel.x;
          alignY += other.vel.y;
          alignZ += other.vel.z;
          alignC++;
        }
      }
      if (sepC > 0) {
        vSep.divideScalar(sepC);
        vForce.addScaledVector(vSep, 2.1);
      }
      if (alignC > 0) {
        vForce.x += (alignX / alignC - f.vel.x) * 2.2;
        vForce.y += (alignY / alignC - f.vel.y) * 2.2;
        vForce.z += (alignZ / alignC - f.vel.z) * 2.2;
      }

      vForce.addScaledVector(f.vel, -1.6);
      avoidBommiesXZ(f.pos, f.vel, vForce);
      steerClearObstacles(f.pos, f.vel, vForce, 0.36, true, true);
      applyBounds(f.pos, f.vel, surfaceLimitY - 0.25, vForce, 17.5);

      f.vel.addScaledVector(vForce, dt);
      const sp = f.vel.length();
      const maxSp = isEvading ? 2.05 : distToSlot > 1.8 ? 1.90 : 1.75;
      if (sp < 1e-5) f.vel.copy(school.vel);
      else f.vel.multiplyScalar(THREE.MathUtils.clamp(sp, 0.80, maxSp) / sp);
      f.pos.addScaledVector(f.vel, dt);
      resolveOutsideObstacles(f.pos, f.vel, { margin: 0.22, checkAnemones: true });
      const spPost = f.vel.length();
      if (spPost < 0.80) {
        if (spPost > 1e-4) f.vel.multiplyScalar(0.80 / spPost);
        else f.vel.copy(school.vel).setLength(Math.max(0.80, school.vel.length()));
      }
      f.pos.y = THREE.MathUtils.clamp(
        f.pos.y,
        getSeabedHeight(f.pos.x, f.pos.z) + 0.30,
        surfaceLimitY - 0.25
      );

      vWaterDir.copy(f.vel);
      safeNormalize(vWaterDir, school.heading.x, school.heading.y, school.heading.z);
      f.heading.lerp(vWaterDir, Math.min(1, dt * 9.5));
      safeNormalize(f.heading, school.heading.x, school.heading.y, school.heading.z);

      const speedNow = f.vel.length();
      f.swimPhase += dt * ((f.swimFreq || 8.0) + speedNow * 4.8);
      const sgtSpeedRatio = THREE.MathUtils.clamp((speedNow - 0.80) / 1.25, 0, 1);
      const sgtBodyAmp = 0.008 + 0.006 * sgtSpeedRatio;
      const sgtFinAmp = 0.006 + 0.004 * sgtSpeedRatio;
      setSwimState(sergeantMeshes.swimAttr, i, f.swimPhase, sgtBodyAmp, sgtFinAmp);

      const { bodyMatrix, tailMatrix } = orientFishMatrix(
        f.pos,
        f.heading,
        f.scale,
        Math.sin(f.swimPhase) * 0.032,
        Math.sin(f.swimPhase - 0.55) * 0.22,
        0,
        sergeantMeshes.tailPivotZ,
        scratch
      );
      sergeantMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
      sergeantMeshes.tailMesh.setMatrixAt(i, tailMatrix);
    }
    if (activeSergeantCount > 0) {
      sergeantMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      sergeantMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      sergeantMeshes.swimAttr.needsUpdate = true;
    }

    // 3: Amphiprion bicinctus (mated pairs + juveniles, windward anemone weaving; dive < 0.12m when predator threatens)
    const activeAnchors = [];
    for (let a = 0; a < anemoneAnchors.length; a++) {
      if (anemoneAnchors[a].active !== false) activeAnchors.push(anemoneAnchors[a]);
    }
    const activeClownCount = activeCounts.amphiprion;
    for (let i = 0; i < activeClownCount; i++) {
      const c = clowns[i];
      const homeAnchor = anemoneAnchors[c.homeAnemoneIdx];
      if (homeAnchor && homeAnchor.active !== false) {
        c.anchor = homeAnchor;
      } else if (activeAnchors.length > 0) {
        c.anchor = activeAnchors[c.homeAnemoneIdx % activeAnchors.length];
      }
      const hasActiveAnchor = activeAnchors.length > 0 && c.anchor.active !== false;
      computeLocalUpstream(c.anchor.position.x, c.anchor.position.z, elapsedTime, vUpstream, vCrossStream);
      const anchorThreat = nearestPredatorThreat(c.anchor.position, 1.80, true).threat;
      const localThreat = nearestPredatorThreat(c.pos, 1.0, false).threat;
      const targetAlert = hasActiveAnchor && Math.max(anchorThreat, localThreat) > 0.22 ? 1.0 : 0.0;
      c.alertLevel = THREE.MathUtils.lerp(
        c.alertLevel,
        targetAlert,
        Math.min(1, dt * (targetAlert > c.alertLevel ? 6.0 : 3.2))
      );

      if (hasActiveAnchor && c.alertLevel > 0.35) {
        // Dive deep inside anemone tentacles (< 0.12m from anchor)
        vForce.set(
          c.anchor.position.x - c.pos.x,
          c.anchor.position.y + 0.05 - c.pos.y,
          c.anchor.position.z - c.pos.z
        );
        const d = vForce.length();
        if (d > 0.02) vForce.multiplyScalar(7.5 / d);
      } else {
        const rScale = Math.max(0.65, c.anchor.radius ?? 0.85);
        if (c.role === 'male' && c.femaleRef) {
          const femOff = c.femaleRef.targetOffset;
          const pairPhase = elapsedTime * 0.9 + i * 1.3;
          const pairDist = 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(pairPhase));
          const sideSign = i % 4 < 2 ? 1 : -1;
          const latAngle = Math.sin(pairPhase * 0.6) * 0.45;
          const latComp = Math.cos(latAngle) * sideSign;
          const trailComp = 0.55 + 0.35 * Math.abs(Math.sin(latAngle));
          const norm = Math.hypot(latComp, trailComp) || 1;
          const lx = (latComp / norm) * pairDist;
          const tz = (trailComp / norm) * pairDist;
          const oy = THREE.MathUtils.clamp(
            femOff.y - 0.02 + Math.sin(pairPhase * 1.1) * 0.03,
            0.18 * rScale,
            0.46 * rScale
          );
          c.targetOffset.set(
            femOff.x + vCrossStream.x * lx - vUpstream.x * tz,
            oy,
            femOff.z + vCrossStream.z * lx - vUpstream.z * tz
          );
        } else {
          c.dartTimer -= dt;
          if (c.dartTimer <= 0) {
            if (c.role === 'juvenile') {
              c.dartTimer = 0.9 + ((i * 0.61) % 1.6);
              c.orbitAngle += c.orbitDir * (1.4 + Math.sin(elapsedTime * 1.9 + i) * 0.7);
              const rad = (0.06 + 0.16 * Math.abs(Math.sin(elapsedTime * 0.8 + i))) * rScale;
              const upShift = Math.cos(c.orbitAngle) * rad;
              const crossShift = Math.sin(c.orbitAngle) * rad;
              const offsetY = (0.14 + 0.14 * Math.abs(Math.cos(elapsedTime * 1.1 + i))) * rScale;
              c.targetOffset.set(
                vUpstream.x * upShift + vCrossStream.x * crossShift,
                offsetY,
                vUpstream.z * upShift + vCrossStream.z * crossShift
              );
            } else {
              c.dartTimer = 1.1 + ((i * 0.73) % 2.1);
              c.orbitAngle += c.orbitDir * (1.2 + Math.sin(elapsedTime * 1.6 + i) * 0.8);
              const upShift = (0.04 + 0.26 * Math.abs(Math.sin(elapsedTime + i))) * rScale;
              const crossShift = Math.sin(c.orbitAngle) * 0.28 * rScale;
              const offsetY = (0.22 + 0.24 * Math.abs(Math.cos(elapsedTime * 0.9 + i))) * rScale;
              c.targetOffset.set(
                vUpstream.x * upShift + vCrossStream.x * crossShift,
                offsetY,
                vUpstream.z * upShift + vCrossStream.z * crossShift
              );
            }
          }
        }
        vForce.set(
          c.anchor.position.x + c.targetOffset.x - c.pos.x,
          Math.min(surfaceLimitY - 0.15, c.anchor.position.y + c.targetOffset.y) - c.pos.y,
          c.anchor.position.z + c.targetOffset.z - c.pos.z
        );
        const d = vForce.length();
        if (d > 1e-4) vForce.multiplyScalar((d > c.anchor.radius ? 4.8 : 2.3) / d);
      }

      c.vel.addScaledVector(vForce, dt);
      const sp = c.vel.length();
      const minSp = 0.12;
      const maxSp = hasActiveAnchor && c.alertLevel > 0.35 ? 1.75 : 0.42;
      if (sp < 1e-5) c.vel.copy(vUpstream).multiplyScalar(minSp);
      else c.vel.multiplyScalar(THREE.MathUtils.clamp(sp, minSp, maxSp) / sp);
      c.pos.addScaledVector(c.vel, dt);
      resolveOutsideObstacles(c.pos, c.vel, { margin: 0.14, checkAnemones: false });
      const clownMinY = getSeabedHeight(c.pos.x, c.pos.z) + 0.12;
      if (c.pos.y < clownMinY) {
        c.pos.y = clownMinY;
        c.vel.y = Math.max(0, c.vel.y);
      }

      const flowBias = hasActiveAnchor && c.alertLevel > 0.35 ? 0.10 : effFlow * 0.8;
      vWater.copy(c.vel).addScaledVector(vUpstream, flowBias);
      vWaterDir.copy(vWater);
      safeNormalize(vWaterDir, vUpstream.x, vUpstream.y, vUpstream.z);
      c.heading.lerp(vWaterDir, Math.min(1, dt * 8.5));
      safeNormalize(c.heading, vUpstream.x, vUpstream.y, vUpstream.z);
      c.swimPhase += dt * (11.5 + vWater.length() * 5.0);
      const clownDiving = hasActiveAnchor && c.alertLevel > 0.35;
      const clownSpeedRatio = THREE.MathUtils.clamp(c.vel.length() / 1.5, 0, 1);
      const clownBodyAmp = clownDiving
        ? 0.009 + 0.005 * Math.max(clownSpeedRatio, c.alertLevel)
        : 0.005 + 0.0045 * clownSpeedRatio;
      const clownFinAmp = clownDiving
        ? 0.010 + 0.003 * clownSpeedRatio
        : 0.0115 + 0.0035 * (0.5 + 0.5 * Math.sin(c.swimPhase * 0.5));
      setSwimState(clownMeshes.swimAttr, i, c.swimPhase, clownBodyAmp, clownFinAmp);

      const { bodyMatrix, tailMatrix } = orientFishMatrix(
        c.pos,
        c.heading,
        c.scale,
        Math.sin(c.swimPhase) * 0.06,
        Math.sin(c.swimPhase - 0.5) * 0.24,
        Math.sin(c.swimPhase * 0.5) * 0.07,
        clownMeshes.tailPivotZ,
        scratch
      );
      clownMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
      clownMeshes.tailMesh.setMatrixAt(i, tailMatrix);
    }
    if (activeClownCount > 0) {
      clownMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      clownMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      clownMeshes.swimAttr.needsUpdate = true;
    }

    // 4: Parupeneus forsskali (Goatfish probing sandy canyon floor + cleaning visits + evasion)
    const activeGoatCount = activeCounts.goatfish;
    for (let i = 0; i < activeGoatCount; i++) {
      const gf = goatfish[i];
      const { threat, predator } = nearestPredatorThreat(gf.pos, 1.75);
      const isEvading = threat > 0.22 && Boolean(predator);

      if (isEvading && gf.cleanState !== 'none') {
        cleaningSystem?.releaseStation(gf.clientKey);
        gf.cleanState = 'none';
        gf.cleanTarget = null;
        gf.cleanTimer = 0;
        gf.approachTimer = 0;
        gf.cleanCooldown = 16;
      }

      if (gf.cleanState === 'none' && !isEvading) {
        gf.cleanCooldown = Math.max(0, gf.cleanCooldown - dt);
        if (gf.cleanCooldown <= 0 && cleaningSystem) {
          const acquired = cleaningSystem?.tryAcquireStation(gf.clientKey, gf.pos, 2.6);
          if (acquired) {
            gf.cleanState = 'cleaning';
            gf.cleanTarget = acquired;
            gf.cleanTimer = 4.5;
            gf.approachTimer = 0;
          }
        }
      }

      if (gf.cleanState === 'cleaning' && gf.cleanTarget) {
        const dist = stepCleaningVisit(
          gf,
          gf.cleanTarget.hoverPos,
          surfaceLimitY,
          0.16,
          0.85,
          0.16,
          0.08,
          -0.16,
          dt
        );
        resolveOutsideObstacles(gf.pos, gf.vel, { margin: 0.18, checkAnemones: true });
        gf.approachTimer += dt;
        if (dist < 0.30) {
          gf.cleanTimer -= dt;
        }
        const poseOk = cleaningSystem
          ? cleaningSystem.updateClientPose(gf.clientKey, gf.pos, gf.heading, 0.12, 'goatfish')
          : false;
        if (!poseOk || gf.cleanTimer <= 0 || gf.approachTimer > 6.0) {
          cleaningSystem?.releaseStation(gf.clientKey);
          gf.cleanState = 'none';
          gf.cleanTarget = null;
          gf.cleanTimer = 0;
          gf.approachTimer = 0;
          gf.cleanCooldown = 22;
        }
      } else {
        gf.probeTimer -= dt;
        if (gf.probeTimer <= 0) {
          gf.probeTimer = 2.5 + (i % 4) * 1.1;
          gf.targetZ = THREE.MathUtils.clamp(gf.pos.z + Math.sin(elapsedTime + i * 2.1) * 4.5, -8.5, 8.5);
          const canyonX = 2.4 * Math.sin(gf.targetZ * 0.19) + 1.1 * Math.cos(gf.targetZ * 0.08);
          gf.targetX = canyonX + Math.cos(i * 1.7 + elapsedTime * 0.5) * 1.8;
        }

        const targetY = getSeabedHeight(gf.targetX, gf.targetZ) + 0.16;
        vForce.set(gf.targetX - gf.pos.x, targetY - gf.pos.y, gf.targetZ - gf.pos.z);
        const td = vForce.length();
        if (td > 1e-4) vForce.multiplyScalar(1.25 / td);

        if (isEvading) {
          vDiff.subVectors(gf.pos, predator.pos);
          safeNormalize(vDiff, 0, 0, 1);
          vForce.addScaledVector(vDiff, 5.5 * threat);
        }

        avoidBommiesXZ(gf.pos, gf.vel, vForce);
        steerClearObstacles(gf.pos, gf.vel, vForce, 0.28, true, false);

        const floorY = getSeabedHeight(gf.pos.x, gf.pos.z) + 0.14;
        if (gf.pos.y < floorY) gf.pos.y = floorY;
        if (gf.pos.y > surfaceLimitY - 0.3) vForce.y -= 3.0;

        gf.vel.addScaledVector(vForce, dt);
        const sp = gf.vel.length();
        const maxSp = isEvading ? 1.55 : 0.65;
        if (sp < 1e-5) gf.vel.set(0.3, 0, 0);
        else gf.vel.multiplyScalar(THREE.MathUtils.clamp(sp, 0.25, maxSp) / sp);
        gf.pos.addScaledVector(gf.vel, dt);
        resolveOutsideObstacles(gf.pos, gf.vel, { margin: 0.18, checkAnemones: true });
        const postFloorY = getSeabedHeight(gf.pos.x, gf.pos.z) + 0.14;
        gf.pos.y = THREE.MathUtils.clamp(gf.pos.y, postFloorY, surfaceLimitY - 0.2);

        vWaterDir.copy(gf.vel);
        safeNormalize(vWaterDir, gf.heading.x, 0, gf.heading.z);
        gf.heading.lerp(vWaterDir, Math.min(1, dt * 8.0));
        safeNormalize(gf.heading, 0, 0, 1);

        const probePitch = isEvading ? 0 : 0.16 + Math.sin(elapsedTime * 3.5 + i) * 0.08;
        gf.cleanPosePitch = THREE.MathUtils.lerp(gf.cleanPosePitch, probePitch, Math.min(1, dt * 6.0));
      }

      const gfSpeed = gf.vel.length();
      gf.swimPhase += dt * (7.0 + gfSpeed * 5.0);
      const gfSwimRatio = THREE.MathUtils.clamp((gfSpeed - 0.25) / 1.15, 0, 1);
      const gfBodyAmp =
        gf.cleanState === 'cleaning'
          ? 0.0055
          : isEvading
            ? 0.012 + 0.004 * Math.max(gfSwimRatio, threat)
            : 0.010 + 0.0035 * gfSwimRatio;
      const gfFinAmp =
        gf.cleanState === 'cleaning'
          ? 0.009
          : 0.007 + 0.004 * THREE.MathUtils.clamp(gfSpeed / 0.9, 0, 1);
      setSwimState(goatMeshes.swimAttr, i, gf.swimPhase, gfBodyAmp, gfFinAmp);

      const { bodyMatrix, tailMatrix } = orientFishMatrix(
        gf.pos,
        gf.heading,
        gf.scale,
        Math.sin(gf.swimPhase) * (gf.cleanState === 'cleaning' ? 0.018 : 0.036),
        Math.sin(gf.swimPhase - 0.5) * (gf.cleanState === 'cleaning' ? 0.12 : 0.20),
        gf.cleanPosePitch,
        goatMeshes.tailPivotZ,
        scratch
      );
      goatMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
      goatMeshes.tailMesh.setMatrixAt(i, tailMatrix);
    }
    if (activeGoatCount > 0) {
      goatMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      goatMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      goatMeshes.swimAttr.needsUpdate = true;
    }

    // 5: Chaetodon austriacus (bonded monogamous pairs patrolling low reef floor + cleaning visits)
    const activeButterflyPairs = activeCounts.chaetodon / 2;
    for (let p = 0; p < activeButterflyPairs; p++) {
      const pair = butterflyPairs[p];
      const { leader, mate, route, hoverClearance, pauseDuration, sideSign } = pair;

      const leaderThreat = nearestPredatorThreat(leader.pos, 1.80);
      const mateThreat = nearestPredatorThreat(mate.pos, 1.80);
      const pairThreat = Math.max(leaderThreat.threat, mateThreat.threat);
      const threatPredator =
        leaderThreat.threat >= mateThreat.threat ? leaderThreat.predator : mateThreat.predator;
      const isSheltering = pairThreat > 0.22 && Boolean(threatPredator);

      const leaderSurge = Math.sin(elapsedTime * 1.6 + p * 1.3) * 0.03;
      const mateSurge = Math.sin(elapsedTime * 1.6 + p * 1.3 + 0.45) * 0.03;
      const leaderClearance = isSheltering ? 0.20 : hoverClearance + leaderSurge;
      const mateClearance = isSheltering ? 0.20 : hoverClearance + mateSurge;

      if (isSheltering) {
        if (pair.cleanState !== 'none') {
          cleaningSystem?.releaseStation(pair.clientKey);
          pair.cleanState = 'none';
          pair.cleanTarget = null;
          pair.cleanTimer = 0;
          pair.approachTimer = 0;
          pair.cleanCooldown = 14;
        }
        const midX = (leader.pos.x + mate.pos.x) * 0.5;
        const midZ = (leader.pos.z + mate.pos.z) * 0.5;
        let shelterCoral = null;
        let bestDSq = Infinity;
        for (let r = 0; r < route.length; r++) {
          const c = route[r].coral;
          if (c.active === false) continue;
          const dx = c.position.x - midX;
          const dz = c.position.z - midZ;
          const dSq = dx * dx + dz * dz;
          if (dSq < bestDSq) {
            bestDSq = dSq;
            shelterCoral = c;
          }
        }
        if (!shelterCoral && activeAllCorals.length > 0) {
          for (let cIdx = 0; cIdx < activeAllCorals.length; cIdx++) {
            const c = activeAllCorals[cIdx];
            const dx = c.position.x - midX;
            const dz = c.position.z - midZ;
            const dSq = dx * dx + dz * dz;
            if (dSq < bestDSq) {
              bestDSq = dSq;
              shelterCoral = c;
            }
          }
        }

        let awayX = shelterCoral ? shelterCoral.position.x - threatPredator.pos.x : midX - threatPredator.pos.x;
        let awayZ = shelterCoral ? shelterCoral.position.z - threatPredator.pos.z : midZ - threatPredator.pos.z;
        const awayLen = Math.hypot(awayX, awayZ);
        if (awayLen > 1e-4) {
          awayX /= awayLen;
          awayZ /= awayLen;
        } else {
          awayX = 1;
          awayZ = 0;
        }
        const perpX = -awayZ;
        const perpZ = awayX;
        const shelterDist = shelterCoral ? shelterCoral.radius + 0.34 : 0.4;
        const baseX = (shelterCoral ? shelterCoral.position.x : midX) + awayX * shelterDist;
        const baseZ = (shelterCoral ? shelterCoral.position.z : midZ) + awayZ * shelterDist;

        const leaderSlotX = baseX + perpX * (sideSign * 0.14);
        const leaderSlotZ = baseZ + perpZ * (sideSign * 0.14);
        const mateSlotX = baseX - perpX * (sideSign * 0.14);
        const mateSlotZ = baseZ - perpZ * (sideSign * 0.14);

        vForce.set(leaderSlotX - leader.pos.x, 0, leaderSlotZ - leader.pos.z);
        const ld = Math.hypot(vForce.x, vForce.z);
        if (ld > 1e-4) {
          const strength = Math.min(4.8, ld * 4.0) / ld;
          vForce.x *= strength;
          vForce.z *= strength;
        }
        leader.peckPitch = THREE.MathUtils.lerp(leader.peckPitch, 0.0, dt * 6.0);
        integrateButterfly(leader, leaderClearance, ld < 0.20 ? 0.12 : 0.45, 1.45, dt, surfaceLimitY, vForce);
        safeNormalize(vWaterDir.copy(leader.vel), leader.heading.x, 0, leader.heading.z);
        leader.heading.lerp(vWaterDir, Math.min(1, dt * 9.0));
        safeNormalize(leader.heading, 1, 0, 0);

        vForce.set(mateSlotX - mate.pos.x, 0, mateSlotZ - mate.pos.z);
        const md = Math.hypot(vForce.x, vForce.z);
        if (md > 1e-4) {
          const strength = Math.min(4.8, md * 4.0) / md;
          vForce.x *= strength;
          vForce.z *= strength;
        }
        mate.peckPitch = THREE.MathUtils.lerp(mate.peckPitch, 0.0, dt * 6.0);
        integrateButterfly(mate, mateClearance, md < 0.20 ? 0.12 : 0.45, 1.45, dt, surfaceLimitY, vForce);
        safeNormalize(vWaterDir.copy(mate.vel), mate.heading.x, 0, mate.heading.z);
        mate.heading.lerp(vWaterDir, Math.min(1, dt * 9.0));
        safeNormalize(mate.heading, 1, 0, 0);
      } else {
        if (pair.cleanState === 'none') {
          pair.cleanCooldown = Math.max(0, pair.cleanCooldown - dt);
          if (pair.cleanCooldown <= 0 && cleaningSystem) {
            const acquired = cleaningSystem?.tryAcquireStation(pair.clientKey, leader.pos, 2.4);
            if (acquired) {
              pair.cleanState = 'cleaning';
              pair.cleanTarget = acquired;
              pair.cleanTimer = 4.8;
              pair.approachTimer = 0;
            }
          }
        }

        if (pair.cleanState === 'cleaning' && pair.cleanTarget) {
          leader.cleanPosePitch = leader.peckPitch;
          const dist = stepCleaningVisit(
            leader,
            pair.cleanTarget.hoverPos,
            surfaceLimitY,
            0.18,
            0.85,
            0.16,
            0.08,
            -0.14,
            dt
          );
          leader.peckPitch = leader.cleanPosePitch;
          pair.approachTimer += dt;
          if (dist < 0.30) {
            pair.cleanTimer -= dt;
          }
          const poseOk = cleaningSystem
            ? cleaningSystem.updateClientPose(pair.clientKey, leader.pos, leader.heading, 0.09, 'chaetodon')
            : false;

          // Mate holds closely beside leader
          vDiff.set(leader.heading.x, 0, leader.heading.z);
          safeNormalize(vDiff, 1, 0, 0);
          vRight.crossVectors(worldUp, vDiff);
          safeNormalize(vRight, 0, 0, 1);

          const mateHoverX = leader.pos.x + vRight.x * (sideSign * 0.26) - vDiff.x * 0.12;
          const mateHoverZ = leader.pos.z + vRight.z * (sideSign * 0.26) - vDiff.z * 0.12;
          const mateHoverY = Math.min(
            surfaceLimitY - 0.22,
            Math.max(getSeabedHeight(mateHoverX, mateHoverZ) + 0.18, leader.pos.y)
          );
          vForce.set(mateHoverX - mate.pos.x, mateHoverY - mate.pos.y, mateHoverZ - mate.pos.z);
          const mDist = vForce.length();
          if (mDist > 0.14) {
            vForce.multiplyScalar(Math.min(4.0, mDist * 4.0) / mDist).addScaledVector(mate.vel, -3.0);
            mate.vel.addScaledVector(vForce, dt);
            const mSp = mate.vel.length();
            if (mSp > 0.90 && mSp > 1e-5) mate.vel.multiplyScalar(0.90 / mSp);
          } else {
            mate.vel.addScaledVector(vForce, 3.5 * dt);
            mate.vel.multiplyScalar(Math.max(0, 1.0 - dt * 11.0));
            const mSp = mate.vel.length();
            if (mSp > 0.07 && mSp > 1e-5) mate.vel.multiplyScalar(0.07 / mSp);
          }
          mate.pos.addScaledVector(mate.vel, dt);
          mate.heading.lerp(leader.heading, Math.min(1, dt * 6.5));
          safeNormalize(mate.heading, leader.heading.x, 0, leader.heading.z);
          mate.peckPitch = leader.peckPitch * 0.85;

          if (!poseOk || pair.cleanTimer <= 0 || pair.approachTimer > 6.0) {
            cleaningSystem?.releaseStation(pair.clientKey);
            pair.cleanState = 'none';
            pair.cleanTarget = null;
            pair.cleanTimer = 0;
            pair.approachTimer = 0;
            pair.cleanCooldown = 26;
          }
        } else {
          // Leader: territorial coral-circuit patrol + polyp-pecking pause
          vForce.set(0, 0, 0);
          let leaderMinSp = 0.46;
          let leaderMaxSp = 0.70;

          if (route.length > 0) {
            const wp = route[leader.routeIdx];
            const toWpX = wp.x - leader.pos.x;
            const toWpZ = wp.z - leader.pos.z;
            const wpDistXZ = Math.hypot(toWpX, toWpZ);

            if (leader.pauseTimer > 0) {
              leader.pauseTimer -= dt;
              leader.peckPitch = THREE.MathUtils.lerp(
                leader.peckPitch,
                0.28 + Math.sin(elapsedTime * 5.2 + p * 1.7) * 0.12,
                dt * 5.0
              );
              const toCoralX = wp.coral.position.x - leader.pos.x;
              const toCoralZ = wp.coral.position.z - leader.pos.z;
              const toCoralLen = Math.hypot(toCoralX, toCoralZ);
              if (toCoralLen > 1e-4) {
                vForce.x += (toCoralX / toCoralLen) * 0.9;
                vForce.z += (toCoralZ / toCoralLen) * 0.9;
              }
              leader.vel.multiplyScalar(Math.max(0.25, 1.0 - dt * 2.5));
              leaderMinSp = 0.10;
              leaderMaxSp = 0.22;
              if (leader.pauseTimer <= 0) {
                leader.routeIdx = (leader.routeIdx + 1) % route.length;
              }
            } else {
              leader.peckPitch = THREE.MathUtils.lerp(leader.peckPitch, 0.0, dt * 4.0);
              if (wpDistXZ < 0.42) {
                leader.pauseTimer = pauseDuration;
              } else if (wpDistXZ > 1e-4) {
                vForce.x += (toWpX / wpDistXZ) * 1.85;
                vForce.z += (toWpZ / wpDistXZ) * 1.85;
              }
            }
          }
          integrateButterfly(leader, leaderClearance, leaderMinSp, leaderMaxSp, dt, surfaceLimitY, vForce);
          safeNormalize(vWaterDir.copy(leader.vel), leader.heading.x, 0, leader.heading.z);
          leader.heading.lerp(vWaterDir, Math.min(1, dt * 9.0));
          safeNormalize(leader.heading, 1, 0, 0);

          // Mate: swims beside/slightly trailing leader + mirrors polyp pecking
          vForce.set(0, 0, 0);
          vDiff.copy(leader.vel);
          safeNormalize(vDiff, 0, 0, 1);
          vRight.crossVectors(worldUp, vDiff);
          safeNormalize(vRight, 1, 0, 0);

          const mateTargetX = leader.pos.x + vRight.x * (sideSign * 0.24) - vDiff.x * 0.15;
          const mateTargetZ = leader.pos.z + vRight.z * (sideSign * 0.24) - vDiff.z * 0.15;
          const slotDx = mateTargetX - mate.pos.x;
          const slotDz = mateTargetZ - mate.pos.z;
          const slotDistXZ = Math.hypot(slotDx, slotDz);

          vForce.x += slotDx * 3.8 + leader.vel.x * 1.35;
          vForce.z += slotDz * 3.8 + leader.vel.z * 1.35;
          mate.peckPitch = leader.peckPitch * 0.9;

          const isInspecting = leader.pauseTimer > 0;
          const mateMinSp = isInspecting && slotDistXZ < 0.22 ? 0.10 : 0.28;
          const mateMaxSp = isInspecting && slotDistXZ < 0.22 ? 0.28 : 0.85;
          integrateButterfly(mate, mateClearance, mateMinSp, mateMaxSp, dt, surfaceLimitY, vForce);
          safeNormalize(vWaterDir.copy(mate.vel), mate.heading.x, 0, mate.heading.z);
          mate.heading.lerp(vWaterDir, Math.min(1, dt * 9.0));
          safeNormalize(mate.heading, 1, 0, 0);
        }
      }

      // Pair cohesion leash: never split > 0.58m around obstacles
      vDiff.subVectors(mate.pos, leader.pos);
      const pairDist = vDiff.length();
      if (pairDist > 0.58) {
        vDiff.multiplyScalar(0.58 / pairDist);
        mate.pos.copy(leader.pos).add(vDiff);
        const mateFloorY = getSeabedHeight(mate.pos.x, mate.pos.z);
        const mateCeilY = Math.min(
          surfaceLimitY - 0.15,
          pair.cleanState === 'cleaning' ? surfaceLimitY - 0.15 : mateFloorY + 0.55
        );
        if (mate.pos.y < mateFloorY + 0.18 || mate.pos.y > mateCeilY) {
          mate.pos.y = THREE.MathUtils.clamp(mate.pos.y, mateFloorY + 0.18, mateCeilY);
          const dy = mate.pos.y - leader.pos.y;
          const dx = mate.pos.x - leader.pos.x;
          const dz = mate.pos.z - leader.pos.z;
          const horizSq = dx * dx + dz * dz;
          const maxHorizSq = Math.max(0.0001, 0.58 * 0.58 - dy * dy);
          if (horizSq > maxHorizSq) {
            const scaleH = Math.sqrt(maxHorizSq / horizSq);
            mate.pos.x = leader.pos.x + dx * scaleH;
            mate.pos.z = leader.pos.z + dz * scaleH;
            const postFloorY = getSeabedHeight(mate.pos.x, mate.pos.z);
            mate.pos.y = THREE.MathUtils.clamp(
              mate.pos.y,
              postFloorY + 0.17,
              Math.min(surfaceLimitY - 0.15, pair.cleanState === 'cleaning' ? surfaceLimitY - 0.15 : postFloorY + 0.55)
            );
          }
        }
        mate.vel.lerp(leader.vel, 0.45);
      }

      resolveOutsideObstacles(leader.pos, leader.vel, { margin: 0.16, checkAnemones: true });
      resolveOutsideObstacles(mate.pos, mate.vel, { margin: 0.16, checkAnemones: true });

      const members = [leader, mate];
      for (let m = 0; m < 2; m++) {
        const bf = members[m];
        const idx = p * 2 + m;
        const bfSpeed = bf.vel.length();
        bf.swimPhase += dt * (6.2 + bfSpeed * 4.5);
        const bfSpeedRatio = THREE.MathUtils.clamp(bfSpeed / 1.2, 0, 1);
        const isPecking = bf.peckPitch > 0.08 || pair.cleanState === 'cleaning';
        const bfBodyAmp = isSheltering
          ? 0.008 + 0.005 * bfSpeedRatio
          : 0.0045 + 0.0045 * bfSpeedRatio;
        const bfFinAmp = isPecking
          ? 0.0115 + 0.0035 * (1.0 - bfSpeedRatio)
          : 0.010 + 0.0035 * (1.0 - bfSpeedRatio * 0.5);
        setSwimState(butterflyMeshes.swimAttr, idx, bf.swimPhase, bfBodyAmp, bfFinAmp);

        const { bodyMatrix, tailMatrix } = orientFishMatrix(
          bf.pos,
          bf.heading,
          bf.scale,
          Math.sin(bf.swimPhase) * (pair.cleanState === 'cleaning' ? 0.015 : 0.030),
          Math.sin(bf.swimPhase - 0.5) * (pair.cleanState === 'cleaning' ? 0.12 : 0.18),
          bf.peckPitch,
          butterflyMeshes.tailPivotZ,
          scratch
        );
        butterflyMeshes.bodyMesh.setMatrixAt(idx, bodyMatrix);
        butterflyMeshes.tailMesh.setMatrixAt(idx, tailMatrix);
      }
    }
    if (activeButterflyPairs > 0) {
      butterflyMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      butterflyMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      butterflyMeshes.swimAttr.needsUpdate = true;
    }

    // 6: Caesio suevica (Electric-Blue Fusiliers in 2 pelagic mid-water crossing schools)
    const activeFusilierCount = activeCounts.caesio;
    if (activeFusilierCount > 0) {
      for (let s = 0; s < fusilierSchools.length; s++) {
        const school = fusilierSchools[s];
        const localSeabedY = getSeabedHeight(school.pos.x, school.pos.z);
        const minPelagicY = Math.min(surfaceLimitY - 0.45, Math.max(localSeabedY + 2.25, 1.95));
        const maxPelagicY = Math.max(minPelagicY + 0.35, Math.min(surfaceLimitY - 0.40, 5.25));
        const waveY = Math.sin(elapsedTime * 0.42 + s * 1.9) * 0.16;
        const targetY = Math.min(
          surfaceLimitY - 0.40,
          THREE.MathUtils.lerp(minPelagicY, maxPelagicY, school.yRatio) + waveY
        );
        stepCrossingSchool(school, targetY, elapsedTime, dt);
      }
    }

    const fusSepR = 0.36;
    const fusSepSq = fusSepR * fusSepR;
    for (let i = 0; i < activeFusilierCount; i++) {
      const fu = fusiliers[i];
      const school = fusilierSchools[fu.schoolIdx];

      vDiff.set(school.heading.x, 0, school.heading.z);
      safeNormalize(vDiff, school.dirSign, 0, 0);
      vRight.set(vDiff.z, 0, -vDiff.x);
      const tx = school.pos.x + vDiff.x * fu.localSlot.along + vRight.x * fu.localSlot.across;
      const tz = school.pos.z + vDiff.z * fu.localSlot.along + vRight.z * fu.localSlot.across;
      const ty = school.pos.y + fu.localSlot.vert;

      vForce.set(tx - fu.pos.x, ty - fu.pos.y, tz - fu.pos.z);
      const d = vForce.length();
      if (d > 1e-4) vForce.multiplyScalar(Math.min(5.0, d * 2.4) / d);

      // Polarize strongly with school velocity & nearby schoolmates + 0.36m separation
      vForce.addScaledVector(school.vel, 2.4);
      vSep.set(0, 0, 0);
      let sepC = 0;
      let alignX = 0;
      let alignY = 0;
      let alignZ = 0;
      let alignC = 0;
      for (let j = 0; j < activeFusilierCount; j++) {
        if (i === j) continue;
        const other = fusiliers[j];
        vDiff.subVectors(fu.pos, other.pos);
        const dSq = vDiff.lengthSq();
        if (dSq < fusSepSq && dSq > 1e-6) {
          const dist = Math.sqrt(dSq);
          vSep.addScaledVector(vDiff, (fusSepR - dist) / (fusSepR * dist));
          sepC++;
        }
        if (other.schoolIdx === fu.schoolIdx && dSq < 5.76) {
          alignX += other.vel.x;
          alignY += other.vel.y;
          alignZ += other.vel.z;
          alignC++;
        }
      }
      if (sepC > 0) {
        vSep.divideScalar(sepC);
        vForce.addScaledVector(vSep, 2.2);
      }
      if (alignC > 0) {
        vForce.x += (alignX / alignC - fu.vel.x) * 2.0;
        vForce.y += (alignY / alignC - fu.vel.y) * 2.0;
        vForce.z += (alignZ / alignC - fu.vel.z) * 2.0;
      }

      // Caranx trevally flash-avoidance (plus close active predator awareness)
      let flashThreat = 0;
      let flashPred = null;
      for (let p = 0; p < predators.length; p++) {
        const pred = predators[p];
        if (pred.radius <= 0 || !pred.isActiveHunter) continue;
        const rad = pred.speciesId === 'caranx' ? 3.1 : 2.0;
        const dx = fu.pos.x - pred.pos.x;
        const dy = fu.pos.y - pred.pos.y;
        const dz = fu.pos.z - pred.pos.z;
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq < rad * rad) {
          const dist = Math.sqrt(dSq);
          let t = (1.0 - dist / rad) * (pred.speciesId === 'caranx' ? 1.25 : 0.85);
          if (dist > 1e-4 && pred.vel) {
            const pSpeedSq = pred.vel.lengthSq();
            if (pSpeedSq > 0.15 * 0.15) {
              const pSpeed = Math.sqrt(pSpeedSq);
              const approachDot = (dx * pred.vel.x + dy * pred.vel.y + dz * pred.vel.z) / (dist * pSpeed);
              if (approachDot < -0.15) {
                t *= 0.38;
              }
            }
          }
          if (t > flashThreat) {
            flashThreat = t;
            flashPred = pred;
          }
        }
      }
      if (flashThreat > 0.16 && flashPred) {
        vDiff.subVectors(fu.pos, flashPred.pos);
        safeNormalize(vDiff, 1, 0, 0);
        // Flash away + slight lateral scatter perpendicular to predator approach
        vForce.addScaledVector(vDiff, 8.5 * flashThreat);
        vForce.x += -vDiff.z * (i % 2 === 0 ? 2.4 : -2.4) * flashThreat;
        vForce.z += vDiff.x * (i % 2 === 0 ? 2.4 : -2.4) * flashThreat;
      }

      vForce.addScaledVector(fu.vel, -1.4);
      fu.vel.addScaledVector(vForce, dt);
      const sp = fu.vel.length();
      const maxSp = flashThreat > 0.16 ? 2.25 : 1.98;
      if (sp < 1e-5) fu.vel.copy(school.vel);
      else fu.vel.multiplyScalar(THREE.MathUtils.clamp(sp, 1.15, maxSp) / sp);
      fu.pos.addScaledVector(fu.vel, dt);

      // Strict Mid-Water Placement (NEVER on reef floor, NEVER breaching surface)
      const ceilingY = surfaceLimitY - 0.28;
      const minFishY = Math.min(ceilingY - 0.04, Math.max(getSeabedHeight(fu.pos.x, fu.pos.z) + 1.95, 1.70));
      const maxFishY = Math.max(minFishY, ceilingY);
      if (fu.pos.y < minFishY) {
        fu.pos.y = minFishY;
        fu.vel.y = Math.max(0, fu.vel.y);
      }
      if (fu.pos.y > maxFishY) {
        fu.pos.y = maxFishY;
        fu.vel.y = Math.min(0, fu.vel.y);
      }
      resolveOutsideObstacles(fu.pos, fu.vel, { margin: 0.20, checkAnemones: true });
      fu.pos.y = THREE.MathUtils.clamp(fu.pos.y, minFishY, maxFishY);

      vWaterDir.copy(fu.vel);
      safeNormalize(vWaterDir, school.heading.x, school.heading.y, school.heading.z);
      fu.heading.lerp(vWaterDir, Math.min(1, dt * 10.0));
      safeNormalize(fu.heading, school.heading.x, school.heading.y, school.heading.z);
      const fuSpeed = fu.vel.length();
      fu.swimPhase += dt * (11.0 + fuSpeed * 4.2);
      const fuSpeedRatio = THREE.MathUtils.clamp((fuSpeed - 1.15) / 1.10, 0, 1);
      const fuBodyAmp = 0.0085 + 0.0055 * fuSpeedRatio;
      const fuFinAmp = 0.006 + 0.004 * fuSpeedRatio;
      setSwimState(fusilierMeshes.swimAttr, i, fu.swimPhase, fuBodyAmp, fuFinAmp);

      const { bodyMatrix, tailMatrix } = orientFishMatrix(
        fu.pos,
        fu.heading,
        fu.scale,
        Math.sin(fu.swimPhase) * 0.025,
        Math.sin(fu.swimPhase - 0.5) * 0.20,
        0,
        fusilierMeshes.tailPivotZ,
        scratch
      );
      fusilierMeshes.bodyMesh.setMatrixAt(i, bodyMatrix);
      fusilierMeshes.tailMesh.setMatrixAt(i, tailMatrix);
    }
    if (activeFusilierCount > 0) {
      fusilierMeshes.bodyMesh.instanceMatrix.needsUpdate = true;
      fusilierMeshes.tailMesh.instanceMatrix.needsUpdate = true;
      fusilierMeshes.swimAttr.needsUpdate = true;
    }
  }

  update(0, 0.016, { diveDepth: 6.0, currentDirection: 180, currentSpeed: 0.45 });

  return {
    group,
    pickableMeshes,
    anthias,
    chromis,
    clowns,
    anthiasMaleMeshes,
    anthiasFemaleMeshes,
    sergeants,
    butterflies,
    fusiliers,
    goatfish,
    applySpeciesCounts,
    getActiveCounts: () => ({ ...activeCounts }),
    update,
  };
}
