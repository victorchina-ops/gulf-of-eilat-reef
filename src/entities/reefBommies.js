import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  MAX_STATIC_Y,
  clampGeometryTopY,
  createRng,
  enableShadows,
  fbm3D,
  prepareForMerge,
  safeMerge,
} from './utils.js';

// Pre-weld shared icosphere templates once so lobe generation skips 60+ redundant
// mergeVertices passes and achieves fast (<150 ms) scene initialization.
const _unitIco5Raw = new THREE.IcosahedronGeometry(1, 5);
_unitIco5Raw.deleteAttribute('uv');
_unitIco5Raw.deleteAttribute('normal');
const TEMPLATE_ICO_5 = mergeVertices(_unitIco5Raw, 1e-3);
_unitIco5Raw.dispose();

const _unitIco2Raw = new THREE.IcosahedronGeometry(1, 2);
_unitIco2Raw.deleteAttribute('uv');
_unitIco2Raw.deleteAttribute('normal');
const TEMPLATE_ICO_2 = mergeVertices(_unitIco2Raw, 1e-3);
_unitIco2Raw.dispose();

const STRUCTURE_SPECS = [
  { id: 'fg-showcase', type: 'pinnacle', x: -1.6, z: 5.2, radius: 2.35, height: 1.85, seed: 101 },
  { id: 'fg-east', type: 'bommy', x: 5.6, z: 4.4, radius: 2.55, height: 1.55, seed: 102 },
  { id: 'fg-west', type: 'bommy', x: -6.8, z: 3.8, radius: 2.85, height: 1.72, seed: 103 },
  { id: 'reef-arch', type: 'arch', x: -2.0, z: 1.8, radius: 3.1, height: 1.95, seed: 104 },
  { id: 'canyon-east-mid', type: 'bommy', x: 4.6, z: -1.7, radius: 3.4, height: 1.95, seed: 105 },
  { id: 'canyon-west-mid', type: 'bommy', x: -5.8, z: -2.5, radius: 3.3, height: 1.92, seed: 106 },
  { id: 'undercut-cave-east', type: 'cave', x: 3.9, z: 0.9, radius: 2.45, height: 1.68, seed: 107 },
  { id: 'canyon-north-spur', type: 'bommy', x: -2.2, z: -6.3, radius: 3.1, height: 1.88, seed: 108 },
  { id: 'dropoff-west', type: 'buttress', x: -4.8, z: -10.6, radius: 3.7, height: 3.1, seed: 109 },
  { id: 'dropoff-east', type: 'buttress', x: 4.4, z: -11.2, radius: 3.8, height: 3.2, seed: 110 },
];

function weldAndComputeSmoothNormals(geom) {
  geom.deleteAttribute('uv');
  geom.deleteAttribute('normal');
  const welded = mergeVertices(geom, 1e-3);
  welded.computeVertexNormals();
  return welded;
}

function displaceLimestoneLobe(geom, lx, lz, rx, ry, rz, baseSeabedY, noiseOffset, isCave = false, caveDirX = 1) {
  const pos = geom.attributes.position;
  for (let v = 0; v < pos.count; v++) {
    const vx = pos.getX(v);
    const vy = pos.getY(v);
    const vz = pos.getZ(v);

    // Multi-octave crags + horizontal carbonate reef ledges
    const nLarge = fbm3D(vx * 1.65 + noiseOffset, vy * 2.1, vz * 1.65 - noiseOffset, 4);
    const nFine = fbm3D(vx * 4.4, vy * 4.8 + noiseOffset, vz * 4.4, 2);
    const strata = Math.sin(vy * 8.5 + nLarge * 2.5 + noiseOffset) * 0.085;
    const disp = 0.74 + nLarge * 0.44 + (nFine - 0.5) * 0.14 + strata;

    // Terraced overhang flare on mid-upper shelves
    const shelfFlare = vy > 0.08 && vy < 0.52 ? 1.14 : vy < -0.25 ? 1.08 : 0.98;
    let dx = vx * rx * disp * shelfFlare;
    let dz = vz * rz * disp * shelfFlare;

    // Carve dramatic undercut cave recess on lower canyon-facing flank
    if (isCave && vy < 0.12 && vy > -0.65 && vx * caveDirX > 0.15) {
      const recess = Math.sin(((vy + 0.65) / 0.77) * Math.PI) * 0.52;
      dx *= 1.0 - recess;
      dz *= 1.0 - recess * 0.45;
    }

    const worldY = baseSeabedY - 0.65 + (vy + 1.0) * 0.5 * (ry * 2.05) * (0.86 + nLarge * 0.28);
    pos.setXYZ(v, lx + dx, worldY, lz + dz);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  return geom;
}

function buildArchGeometry(spec, getSeabedHeight) {
  const rng = createRng(spec.seed);
  const parts = [];
  const baseSeabedY = getSeabedHeight(spec.x, spec.z);

  // Left & right craggy pillars flanking the swim-through at (-2.0, 1.8)
  for (const side of [-1, 1]) {
    const px = spec.x + side * 1.62;
    const pz = spec.z + side * 0.22;
    const py = getSeabedHeight(px, pz);
    const pillar = displaceLimestoneLobe(
      TEMPLATE_ICO_5.clone(),
      px,
      pz,
      1.12,
      1.38,
      1.18,
      py,
      rng() * 100,
      false,
      1
    );
    parts.push(prepareForMerge(pillar));
    pillar.dispose();
  }

  // Sculpted overarching limestone bridge spanning the two pillars
  const bridgeRaw = new THREE.TorusGeometry(1.62, 0.58, 22, 44, Math.PI * 1.08);
  bridgeRaw.rotateZ(-0.04 * Math.PI);
  bridgeRaw.rotateY(-0.14);
  const bPos = bridgeRaw.attributes.position;
  const off = rng() * 80;
  for (let i = 0; i < bPos.count; i++) {
    let x = bPos.getX(i);
    let y = bPos.getY(i);
    let z = bPos.getZ(i);
    const n = fbm3D(x * 1.4 + off, y * 1.8, z * 1.4, 4);
    const strata = Math.sin(y * 7.5 + n * 2.0) * 0.08;
    const scale = 0.8 + n * 0.44 + strata;
    x *= scale;
    z *= scale * 1.28;
    y = baseSeabedY + 0.42 + y * 1.08 * scale;
    bPos.setXYZ(i, spec.x + x, y, spec.z + z);
  }
  const bridge = weldAndComputeSmoothNormals(bridgeRaw);
  bridgeRaw.dispose();
  parts.push(prepareForMerge(bridge));
  bridge.dispose();

  return parts;
}

function buildStructureGeometry(spec, getSeabedHeight) {
  const rng = createRng(spec.seed);
  const baseSeabedY = getSeabedHeight(spec.x, spec.z);
  const parts = [];

  if (spec.type === 'arch') {
    parts.push(...buildArchGeometry(spec, getSeabedHeight));
  } else {
    const lobeCount = spec.type === 'pinnacle' ? 5 : 6;
    for (let i = 0; i < lobeCount; i++) {
      const isMain = i === 0;
      const angle = (i / Math.max(1, lobeCount - 1)) * Math.PI * 2 + rng() * 0.55;
      const dist = isMain ? 0 : spec.radius * (0.34 + rng() * 0.30);
      const lx = spec.x + Math.cos(angle) * dist;
      const lz = spec.z + Math.sin(angle) * dist;
      const localSeabed = getSeabedHeight(lx, lz);

      const rx = isMain ? spec.radius * 0.78 : spec.radius * (0.40 + rng() * 0.24);
      const rz = isMain ? spec.radius * 0.74 : spec.radius * (0.38 + rng() * 0.24);
      const ry = isMain ? spec.height * 0.66 : spec.height * (0.35 + rng() * 0.26);

      const geom = displaceLimestoneLobe(
        TEMPLATE_ICO_5.clone(),
        lx,
        lz,
        rx,
        ry,
        rz,
        localSeabed,
        rng() * 120,
        spec.type === 'cave' && isMain,
        spec.x > 0 ? -1 : 1
      );
      parts.push(prepareForMerge(geom));
      geom.dispose();
    }
  }

  // Scattered carbonate reef rubble boulders around base
  for (let r = 0; r < 4; r++) {
    const a = rng() * Math.PI * 2;
    const d = spec.radius * (0.76 + rng() * 0.32);
    const bx = spec.x + Math.cos(a) * d;
    const bz = spec.z + Math.sin(a) * d;
    const by = getSeabedHeight(bx, bz);
    const br = 0.28 + rng() * 0.36;
    const bGeom = TEMPLATE_ICO_2.clone();
    const bPos = bGeom.attributes.position;
    const off = rng() * 50;
    for (let v = 0; v < bPos.count; v++) {
      const px = bPos.getX(v) * br;
      const py = bPos.getY(v) * br;
      const pz = bPos.getZ(v) * br;
      const n = 0.72 + fbm3D(px * 3.2 + off, py * 3.2, pz * 3.2, 2) * 0.54;
      bPos.setXYZ(v, bx + px * n * 1.2, by - 0.14 + py * n * 0.72, bz + pz * n);
    }
    bPos.needsUpdate = true;
    bGeom.computeVertexNormals();
    parts.push(prepareForMerge(bGeom));
    bGeom.dispose();
  }

  const merged = safeMerge(parts);
  clampGeometryTopY(merged, MAX_STATIC_Y - 0.48);

  // Stratified limestone, crustose coralline pink/violet algae, turf crevices & sand shelves
  const pos = merged.attributes.position;
  const norm = merged.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const cLimestone = new THREE.Color('#8a7d69');
  const cSand = new THREE.Color('#c7bb9e');
  const cCoralline = new THREE.Color('#ab567b');
  const cTurf = new THREE.Color('#4f5d3c');
  const cCrevice = new THREE.Color('#474037');
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const ny = norm.getY(i);

    const patch = fbm3D(px * 0.85, py * 1.15, pz * 0.85, 3);
    const strata = Math.sin(py * 9.0 + patch * 3.0) * 0.5 + 0.5;
    const fine = fbm3D(px * 3.4 + 17, py * 3.4, pz * 3.4, 2);

    tmp.copy(cLimestone);
    if (ny > 0.52) {
      tmp.lerp(cSand, Math.min(1, (ny - 0.52) * 1.55) * (0.45 + 0.35 * patch));
    } else if (ny < -0.08) {
      tmp.lerp(cCrevice, 0.42);
    }

    if (patch > 0.54 && py > baseSeabedY + 0.1) {
      tmp.lerp(cCoralline, Math.min(0.70, (patch - 0.54) * 1.75));
    } else if (patch < 0.43) {
      tmp.lerp(cTurf, Math.min(0.65, (0.43 - patch) * 1.4));
    }

    const shade = 0.84 + fine * 0.22 + strata * 0.10;
    tmp.multiplyScalar(shade);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return merged;
}

export function createReefBommies({ applyUnderwaterMaterial, getSeabedHeight }) {
  const group = new THREE.Group();
  group.name = 'reef-bommies';

  const rockMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.90,
    metalness: 0.02,
  });

  rockMat.customProgramCacheKey = () => 'reef_bommie_limestone_v2';
  rockMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
varying vec3 vBommieWorldPos;
varying vec3 vBommieWorldNormal;
`
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `
#include <project_vertex>
vec4 bmWorldPos = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  bmWorldPos = batchingMatrix * bmWorldPos;
#endif
#ifdef USE_INSTANCING
  bmWorldPos = instanceMatrix * bmWorldPos;
#endif
bmWorldPos = modelMatrix * bmWorldPos;
vBommieWorldPos = bmWorldPos.xyz;
mat3 bmMm = mat3( modelMatrix );
vec3 bmWorldN = objectNormal / max( vec3( dot( bmMm[0], bmMm[0] ), dot( bmMm[1], bmMm[1] ), dot( bmMm[2], bmMm[2] ) ), vec3( 1e-6 ) );
vBommieWorldNormal = normalize( bmMm * bmWorldN );
`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
#include <common>
varying vec3 vBommieWorldPos;
varying vec3 vBommieWorldNormal;

float bmHash3( vec3 p3 ) {
  p3 = fract( p3 * 0.1031 );
  p3 += dot( p3, p3.zyx + 31.32 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

float bmNoise3D( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  vec3 u = f * f * ( 3.0 - 2.0 * f );

  float n000 = bmHash3( i + vec3( 0.0, 0.0, 0.0 ) );
  float n100 = bmHash3( i + vec3( 1.0, 0.0, 0.0 ) );
  float n010 = bmHash3( i + vec3( 0.0, 1.0, 0.0 ) );
  float n110 = bmHash3( i + vec3( 1.0, 1.0, 0.0 ) );
  float n001 = bmHash3( i + vec3( 0.0, 0.0, 1.0 ) );
  float n101 = bmHash3( i + vec3( 1.0, 0.0, 1.0 ) );
  float n011 = bmHash3( i + vec3( 0.0, 1.0, 1.0 ) );
  float n111 = bmHash3( i + vec3( 1.0, 1.0, 1.0 ) );

  float nx00 = mix( n000, n100, u.x );
  float nx10 = mix( n010, n110, u.x );
  float nx01 = mix( n001, n101, u.x );
  float nx11 = mix( n011, n111, u.x );
  float nxy0 = mix( nx00, nx10, u.y );
  float nxy1 = mix( nx01, nx11, u.y );
  return mix( nxy0, nxy1, u.z );
}

float bmLimestoneHeight( vec3 p ) {
  float nCoarse = bmNoise3D( p * 1.45 );
  float nMid    = bmNoise3D( p * 4.2 + vec3( 3.7, 1.9, 5.3 ) );
  float nFine   = bmNoise3D( p * 11.5 + vec3( 7.1, 4.3, 2.1 ) );
  float nPore   = bmNoise3D( p * 25.0 + vec3( 1.3, 8.7, 4.9 ) );

  float strataPhase = p.y * 10.2 + nCoarse * 4.4 + nMid * 1.3;
  float strata = smoothstep( -0.45, 0.72, sin( strataPhase ) );
  float ridge  = 1.0 - abs( nFine * 2.0 - 1.0 );
  float pores  = smoothstep( 0.56, 0.90, nPore );
  float fossilPatch = smoothstep( 0.48, 0.72, nCoarse );
  float septa = abs( sin( p.x * 26.0 + p.z * 18.0 + nMid * 4.1 ) * cos( p.z * 24.0 - p.y * 21.0 + nMid * 3.5 ) );

  return nCoarse * 0.34 + nMid * 0.24 + strata * 0.22 + ridge * 0.22 - pores * 0.14 + septa * fossilPatch * 0.11;
}
`
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
#include <color_fragment>
vec3 bm_worldPos = vBommieWorldPos;
vec3 bm_worldN = normalize( vBommieWorldNormal );

float bm_nCoarse = bmNoise3D( bm_worldPos * 1.45 );
float bm_nMid    = bmNoise3D( bm_worldPos * 4.2 + vec3( 3.7, 1.9, 5.3 ) );
float bm_nFine   = bmNoise3D( bm_worldPos * 11.5 + vec3( 7.1, 4.3, 2.1 ) );
float bm_nPore   = bmNoise3D( bm_worldPos * 25.0 + vec3( 1.3, 8.7, 4.9 ) );

float bm_strataPhase = bm_worldPos.y * 10.2 + bm_nCoarse * 4.4 + bm_nMid * 1.3;
float bm_strata = smoothstep( -0.45, 0.72, sin( bm_strataPhase ) );
float bm_ridge  = 1.0 - abs( bm_nFine * 2.0 - 1.0 );
float bm_pores  = smoothstep( 0.56, 0.90, bm_nPore );
float bm_fossilPatch = smoothstep( 0.48, 0.72, bm_nCoarse );
float bm_septa = abs( sin( bm_worldPos.x * 26.0 + bm_worldPos.z * 18.0 + bm_nMid * 4.1 ) * cos( bm_worldPos.z * 24.0 - bm_worldPos.y * 21.0 + bm_nMid * 3.5 ) );

float bm_hCenter = bm_nCoarse * 0.34 + bm_nMid * 0.24 + bm_strata * 0.22 + bm_ridge * 0.22 - bm_pores * 0.14 + bm_septa * bm_fossilPatch * 0.11;

// Multi-scale fossil limestone grain, stratification & fossilized coral septa
vec3 bm_limeLight = vec3( 0.27, 0.23, 0.17 );
vec3 bm_limeDark  = vec3( 0.11, 0.095, 0.075 );
vec3 bm_rockMicro = mix( bm_limeDark, bm_limeLight, clamp( bm_strata * 0.52 + bm_nMid * 0.48, 0.0, 1.0 ) );
bm_rockMicro *= 0.88 + bm_septa * bm_fossilPatch * 0.18 + ( bm_nFine - 0.5 ) * 0.16;
diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.52 + bm_rockMicro * 0.72, 0.52 );

// Crustose coralline algae (Porolithon mauve / rose-pink patches) on sunlit upward & oblique faces
float bm_corallineNoise = bmNoise3D( bm_worldPos * 2.4 + vec3( 9.2, 3.1, 6.4 ) ) * 0.65
                        + bmNoise3D( bm_worldPos * 6.8 - vec3( 2.1, 5.4, 1.7 ) ) * 0.35;
float bm_sunlitSlope = smoothstep( -0.05, 0.55, bm_worldN.y ) * smoothstep( -3.4, -0.35, bm_worldPos.y );
float bm_corallineMask = smoothstep( 0.52, 0.68, bm_corallineNoise ) * bm_sunlitSlope * ( 1.0 - bm_pores * 0.45 );
vec3 bm_porolithonRose  = vec3( 0.45, 0.12, 0.22 );
vec3 bm_porolithonMauve = vec3( 0.29, 0.11, 0.23 );
vec3 bm_corallineCol = mix( bm_porolithonMauve, bm_porolithonRose, smoothstep( 0.32, 0.78, bm_nCoarse ) );
diffuseColor.rgb = mix( diffuseColor.rgb, bm_corallineCol * ( 0.84 + 0.28 * bm_nFine ), bm_corallineMask * 0.76 );

// Fine ivory-cream carbonate sand dusting settling in flat upper pockets (vBommieWorldNormal.y > 0.78)
float bm_flatTop = smoothstep( 0.78, 0.93, bm_worldN.y );
float bm_pocketPool = smoothstep( 0.30, 0.68, 1.0 - bm_nMid * 0.75 + bm_pores * 0.30 );
float bm_sandMask = bm_flatTop * clamp( 0.42 + 0.58 * bm_pocketPool, 0.0, 1.0 );
vec3 bm_ivorySand = mix( vec3( 0.58, 0.51, 0.37 ), vec3( 0.75, 0.68, 0.51 ), bm_nFine );
bm_ivorySand *= 0.93 + 0.14 * bm_nPore;
diffuseColor.rgb = mix( diffuseColor.rgb, bm_ivorySand, bm_sandMask * 0.82 );

// Natural under-ledge & overhang ambient occlusion darkening (vBommieWorldNormal.y < -0.1) + crevice AO
float bm_overhangAO = smoothstep( -0.10, -0.65, bm_worldN.y );
float bm_crevicePit = smoothstep( 0.45, 0.88, bm_pores * 0.72 + ( 1.0 - bm_ridge ) * 0.42 );
float bm_totalAO = clamp( bm_overhangAO * 0.54 + bm_crevicePit * 0.38 * ( 1.0 - bm_sandMask * 0.8 ), 0.0, 0.76 );
diffuseColor.rgb *= ( 1.0 - bm_totalAO );
`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
#include <roughnessmap_fragment>
float bm_rockRough = mix( 0.84, 0.96, bm_crevicePit );
bm_rockRough = mix( bm_rockRough, 0.72, bm_corallineMask * 0.75 );
bm_rockRough = mix( bm_rockRough, 0.94, bm_sandMask );
roughnessFactor = clamp( bm_rockRough + bm_overhangAO * 0.08, 0.55, 0.99 );
`
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
#include <normal_fragment_maps>
{
  float bm_eps = 0.014;
  float bm_hx = bmLimestoneHeight( bm_worldPos + vec3( bm_eps, 0.0, 0.0 ) );
  float bm_hy = bmLimestoneHeight( bm_worldPos + vec3( 0.0, bm_eps, 0.0 ) );
  float bm_hz = bmLimestoneHeight( bm_worldPos + vec3( 0.0, 0.0, bm_eps ) );
  vec3 bm_grad = vec3( bm_hx - bm_hCenter, bm_hy - bm_hCenter, bm_hz - bm_hCenter ) / bm_eps;

  vec3 bm_surfGrad = bm_grad - bm_worldN * dot( bm_grad, bm_worldN );
  float bm_gradMag = length( bm_surfGrad );
  if ( bm_gradMag > 1e-4 ) {
    bm_surfGrad *= min( bm_gradMag, 6.5 ) / bm_gradMag;
  }

  float bm_distFade = 1.0 - smoothstep( 14.0, 34.0, length( vViewPosition ) );
  float bm_bumpScale = mix( 0.16, 0.045, bm_sandMask ) * ( 1.0 - bm_corallineMask * 0.28 ) * bm_distFade;
  vec3 bm_viewGrad = ( viewMatrix * vec4( bm_surfGrad, 0.0 ) ).xyz;
  normal = normalize( normal - bm_viewGrad * bm_bumpScale );
}
`
      );
  };

  applyUnderwaterMaterial(rockMat, { receiveCaustics: true, causticsStrength: 1.0 });

  const bommies = [];
  const meshes = [];

  // Pre-baked 0.25 m bilinear lookup grid across [-18, 18] x [-18, 18]
  const GRID_MIN = -18.0;
  const GRID_MAX = 18.0;
  const GRID_STEP = 0.25;
  const INV_GRID_STEP = 1.0 / GRID_STEP;
  const GRID_SIZE = Math.round((GRID_MAX - GRID_MIN) / GRID_STEP) + 1; // 145
  const heightGrid = new Float32Array(GRID_SIZE * GRID_SIZE);

  for (let iz = 0; iz < GRID_SIZE; iz++) {
    const gz = GRID_MIN + iz * GRID_STEP;
    const row = iz * GRID_SIZE;
    for (let ix = 0; ix < GRID_SIZE; ix++) {
      heightGrid[row + ix] = getSeabedHeight(GRID_MIN + ix * GRID_STEP, gz);
    }
  }

  for (const spec of STRUCTURE_SPECS) {
    const geom = buildStructureGeometry(spec, getSeabedHeight);
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const minX = bb.min.x;
    const maxX = bb.max.x;
    const minZ = bb.min.z;
    const maxZ = bb.max.z;
    const topY = bb.max.y;
    const baseY = getSeabedHeight(spec.x, spec.z);
    const boundingRadius = Math.max(
      spec.radius,
      Math.hypot(maxX - spec.x, maxZ - spec.z),
      Math.hypot(spec.x - minX, spec.z - minZ)
    );

    const mesh = new THREE.Mesh(geom, rockMat);
    mesh.name = `bommy-${spec.id}`;
    enableShadows(mesh, true, true);
    mesh.updateMatrixWorld(true);
    group.add(mesh);
    meshes.push(mesh);

    bommies.push({
      ...spec,
      mesh,
      baseY,
      topY,
      boundingRadius,
      minX,
      maxX,
      minZ,
      maxZ,
    });

    // Rasterize upper bommy triangles onto the 0.25 m substrate height grid
    const posArr = geom.attributes.position.array;
    const triVertCount = posArr.length;
    for (let k = 0; k + 8 < triVertCount; k += 9) {
      const x0 = posArr[k];
      const y0 = posArr[k + 1];
      const z0 = posArr[k + 2];
      const x1 = posArr[k + 3];
      const y1 = posArr[k + 4];
      const z1 = posArr[k + 5];
      const x2 = posArr[k + 6];
      const y2 = posArr[k + 7];
      const z2 = posArr[k + 8];

      const v0x = x1 - x0;
      const v0z = z1 - z0;
      const v1x = x2 - x0;
      const v1z = z2 - z0;
      const denom = v0x * v1z - v1x * v0z;
      if (Math.abs(denom) < 1e-9) continue;
      const invDenom = 1.0 / denom;

      const tMinX = Math.min(x0, x1, x2);
      const tMaxX = Math.max(x0, x1, x2);
      const tMinZ = Math.min(z0, z1, z2);
      const tMaxZ = Math.max(z0, z1, z2);

      const ix0 = Math.max(0, Math.ceil((tMinX - GRID_MIN) * INV_GRID_STEP));
      const ix1 = Math.min(GRID_SIZE - 1, Math.floor((tMaxX - GRID_MIN) * INV_GRID_STEP));
      if (ix0 > ix1) continue;
      const iz0 = Math.max(0, Math.ceil((tMinZ - GRID_MIN) * INV_GRID_STEP));
      const iz1 = Math.min(GRID_SIZE - 1, Math.floor((tMaxZ - GRID_MIN) * INV_GRID_STEP));
      if (iz0 > iz1) continue;

      for (let iz = iz0; iz <= iz1; iz++) {
        const gz = GRID_MIN + iz * GRID_STEP;
        const v2z = gz - z0;
        const row = iz * GRID_SIZE;
        for (let ix = ix0; ix <= ix1; ix++) {
          const gx = GRID_MIN + ix * GRID_STEP;
          const v2x = gx - x0;
          const u = (v2x * v1z - v1x * v2z) * invDenom;
          if (u < -1e-4) continue;
          const v = (v0x * v2z - v2x * v0z) * invDenom;
          if (v < -1e-4 || u + v > 1.0001) continue;
          const hy = y0 + u * (y1 - y0) + v * (y2 - y0);
          const idx = row + ix;
          if (hy > heightGrid[idx]) {
            heightGrid[idx] = hy;
          }
        }
      }
    }
  }

  /**
   * Instant O(1) bilinear substrate elevation lookup across the [-18, 18] reef grid,
   * falling back seamlessly to getSeabedHeight outside the baked domain.
   */
  function getSubstrateHeight(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    if (x < GRID_MIN || x > GRID_MAX || z < GRID_MIN || z > GRID_MAX) {
      return getSeabedHeight(x, z);
    }
    const fx = (x - GRID_MIN) * INV_GRID_STEP;
    const fz = (z - GRID_MIN) * INV_GRID_STEP;
    const ix = Math.min(GRID_SIZE - 2, Math.max(0, Math.floor(fx)));
    const iz = Math.min(GRID_SIZE - 2, Math.max(0, Math.floor(fz)));
    const tx = fx - ix;
    const tz = fz - iz;
    const i00 = iz * GRID_SIZE + ix;
    const h00 = heightGrid[i00];
    const h10 = heightGrid[i00 + 1];
    const h01 = heightGrid[i00 + GRID_SIZE];
    const h11 = heightGrid[i00 + GRID_SIZE + 1];
    const hx0 = h00 + (h10 - h00) * tx;
    const hx1 = h01 + (h11 - h01) * tx;
    return hx0 + (hx1 - hx0) * tz;
  }

  // Exact vertical substrate sampler onto sculpted limestone tops & canyon walls
  // with fast XZ AABB pre-filtering so sand queries skip raycasts entirely.
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  const rayDir = new THREE.Vector3();
  const candidateMeshes = [];

  function sampleSubstrate(x, z) {
    const seabedY = getSeabedHeight(x, z);
    candidateMeshes.length = 0;
    for (let i = 0; i < bommies.length; i++) {
      const b = bommies[i];
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
        candidateMeshes.push(b.mesh);
      }
    }

    if (candidateMeshes.length > 0) {
      origin.set(x, 6.0, z);
      raycaster.set(origin, down);
      const hits = raycaster.intersectObjects(candidateMeshes, false);
      if (hits.length > 0 && hits[0].point.y > seabedY) {
        return {
          y: hits[0].point.y,
          normal: hits[0].face ? hits[0].face.normal.clone().normalize() : new THREE.Vector3(0, 1, 0),
          onRock: true,
        };
      }
    }

    return {
      y: seabedY,
      normal: new THREE.Vector3(0, 1, 0),
      onRock: false,
    };
  }

  /**
   * Checks a 5-point radial footprint around (x, z) to catch steep rock ledges
   * or overhang drop-offs before seating benthic organisms.
   */
  function sampleFootprint(x, z, radius = 0.35) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return { minY: 0, maxY: 0, slope: 99, onRock: false, valid: false };
    }
    const r = Math.max(0.12, Math.min(2.5, (Number.isFinite(radius) ? radius : 0.35) * 0.85));
    const hC = getSubstrateHeight(x, z);
    const hE = getSubstrateHeight(x + r, z);
    const hW = getSubstrateHeight(x - r, z);
    const hN = getSubstrateHeight(x, z - r);
    const hS = getSubstrateHeight(x, z + r);

    const minY = Math.min(hC, hE, hW, hN, hS);
    const maxY = Math.max(hC, hE, hW, hN, hS);
    const relief = maxY - minY;
    const span2 = 2 * r;
    const slope = Math.max(
      Math.abs(hE - hW) / span2,
      Math.abs(hN - hS) / span2,
      relief / span2
    );

    const bedC = getSeabedHeight(x, z);
    const onRock = hC - bedC > 0.04;
    const maxAllowedRelief = Math.max(0.32, (Number.isFinite(radius) ? radius : 0.35) * 0.95);
    const valid = relief <= maxAllowedRelief && slope <= 1.15 && maxY < MAX_STATIC_Y - 0.12;

    return {
      minY,
      maxY,
      slope,
      onRock,
      valid,
    };
  }

  /**
   * Casts horizontally along (dirX, dirZ) at targetY to locate an exterior rock
   * wall surface offset strictly into open water so crevice dwellers never embed inside rock.
   *
   * @param {number} x - Search center world X
   * @param {number} z - Search center world Z
   * @param {number} dirX - Desired outward normal/facing X from rock into water
   * @param {number} dirZ - Desired outward normal/facing Z from rock into water
   * @param {object} [opts] - { targetY, maxDist, offset }
   */
  function sampleWall(x, z, dirX = 0, dirZ = 1, opts = {}) {
    const dirLen = Math.hypot(dirX, dirZ);
    const ux = dirLen > 1e-5 ? dirX / dirLen : 0;
    const uz = dirLen > 1e-5 ? dirZ / dirLen : 1;

    const baseTargetY = Number.isFinite(opts?.targetY)
      ? opts.targetY
      : (Number.isFinite(opts?.y) ? opts.y : getSeabedHeight(x, z) + 0.48);
    const maxDist = Number.isFinite(opts?.maxDist)
      ? Math.max(0.5, opts.maxDist)
      : (Number.isFinite(opts?.searchRadius) ? Math.max(0.5, opts.searchRadius) : 4.2);
    const offset = Number.isFinite(opts?.offset)
      ? Math.max(0, opts.offset)
      : (Number.isFinite(opts?.standoff) ? Math.max(0, opts.standoff) : 0.06);

    const startDist = maxDist + 2.2;
    const yOffsets = [0, -0.25, 0.25];

    // Prefer bommy enclosing (x, z) so overlapping internal lobes or far across-canyon
    // bommies cannot shadow the local bommy's true exterior rock surface.
    const containingMeshes = [];
    for (let i = 0; i < bommies.length; i++) {
      const b = bommies[i];
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
        containingMeshes.push(b.mesh);
      }
    }

    if (containingMeshes.length === 0) {
      const rayMinX = Math.min(x - maxDist, x + ux * startDist) - 0.5;
      const rayMaxX = Math.max(x + maxDist, x + ux * startDist) + 0.5;
      const rayMinZ = Math.min(z - maxDist, z + uz * startDist) - 0.5;
      const rayMaxZ = Math.max(z + maxDist, z + uz * startDist) + 0.5;
      for (let i = 0; i < bommies.length; i++) {
        const b = bommies[i];
        if (b.maxX >= rayMinX && b.minX <= rayMaxX && b.maxZ >= rayMinZ && b.minZ <= rayMaxZ) {
          containingMeshes.push(b.mesh);
        }
      }
    }

    if (containingMeshes.length > 0) {
      for (let yi = 0; yi < yOffsets.length; yi++) {
        const ty = baseTargetY + yOffsets[yi];
        // Cast inward from open water toward anchor so FrontSide outward faces hit cleanly
        origin.set(x + ux * startDist, ty, z + uz * startDist);
        rayDir.set(-ux, 0, -uz);
        raycaster.set(origin, rayDir);
        raycaster.far = startDist + maxDist;
        const hits = raycaster.intersectObjects(containingMeshes, false);
        raycaster.far = Infinity;

        for (let hi = 0; hi < hits.length; hi++) {
          const hit = hits[hi];
          const sProj = (hit.point.x - x) * ux + (hit.point.z - z) * uz;
          if (sProj < -0.5 || sProj > maxDist) continue;
          const n = hit.face ? hit.face.normal : null;
          const nx = n ? n.x : ux;
          const ny = n ? n.y : 0;
          const nz = n ? n.z : uz;
          const nLen = Math.hypot(nx, ny, nz) || 1;
          const unx = nx / nLen;
          const uny = ny / nLen;
          const unz = nz / nLen;
          if (unx * ux + unz * uz > 0.05) {
            return {
              x: hit.point.x + unx * offset,
              y: hit.point.y + uny * offset,
              z: hit.point.z + unz * offset,
              nx: unx,
              ny: uny,
              nz: unz,
              found: true,
            };
          }
        }
      }
    }

    raycaster.far = Infinity;
    return {
      x: x + ux * offset,
      y: baseTargetY,
      z: z + uz * offset,
      nx: ux,
      ny: 0,
      nz: uz,
      found: false,
    };
  }

  const caves = [
    { position: new THREE.Vector3(3.1, getSeabedHeight(3.1, 0.9) + 0.38, 0.9), radius: 1.2 },
    { position: new THREE.Vector3(-2.0, getSeabedHeight(-2.0, 1.8) + 0.45, 1.8), radius: 1.35 },
  ];

  return {
    group,
    bommies,
    caves,
    sampleSubstrate,
    getSubstrateHeight,
    sampleFootprint,
    sampleWall,
  };
}
