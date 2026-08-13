// Procedural vegetation & rocks, scattered with rejection sampling and drawn
// with InstancedMesh (one draw call per variant). Grass sways in the vertex
// shader via onBeforeCompile.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, roadDist, roadX, groundColorAt } from './terrain.js';
import { fbm2 } from './noise.js';

// ---------- geometry helpers ----------

function paint(geo, color) {
  const c = new THREE.Color(color);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merge(geos) {
  const prepared = geos.map((g) => {
    const ni = g.index ? g.toNonIndexed() : g;
    ni.deleteAttribute('uv');
    return ni;
  });
  return mergeGeometries(prepared, false);
}

function blob(r, sx, sy, sz, x, y, z, color) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return paint(g, color);
}

// ---------- trees ----------

function makeTree(variant) {
  const parts = [];
  const trunkCol = '#7b5a3d';

  if (variant === 0) {
    // round oak: fat crown of blobs
    const t = new THREE.CylinderGeometry(0.13, 0.24, 1.9, 5);
    t.translate(0, 0.95, 0);
    parts.push(paint(t, trunkCol));
    parts.push(blob(1.35, 1.15, 0.95, 1.1, 0, 2.6, 0, '#3a7d5c'));
    parts.push(blob(1.0, 1.1, 0.85, 1.0, 1.0, 2.2, 0.35, '#2c6249'));
    parts.push(blob(0.95, 1.0, 0.8, 1.05, -0.95, 2.3, -0.3, '#357257'));
    parts.push(blob(0.8, 1.0, 0.85, 1.0, 0.15, 3.4, -0.2, '#458a63'));
  } else if (variant === 1) {
    // taller, brighter tree
    const t = new THREE.CylinderGeometry(0.11, 0.2, 2.6, 5);
    t.translate(0, 1.3, 0);
    parts.push(paint(t, trunkCol));
    parts.push(blob(1.1, 1.0, 1.05, 1.0, 0, 3.3, 0, '#4f9663'));
    parts.push(blob(0.85, 1.0, 0.9, 1.0, 0.7, 2.7, 0.4, '#3a7d52'));
    parts.push(blob(0.7, 1.0, 0.9, 1.0, -0.6, 4.0, -0.2, '#5aa26d'));
  } else {
    // dark dense tree (the near-black-green ones in the reference)
    const t = new THREE.CylinderGeometry(0.14, 0.26, 1.4, 5);
    t.translate(0, 0.7, 0);
    parts.push(paint(t, '#6b4e35'));
    parts.push(blob(1.5, 1.25, 0.9, 1.15, 0, 2.2, 0, '#24544a'));
    parts.push(blob(1.05, 1.1, 0.8, 1.0, 1.1, 1.8, 0.3, '#1d4840'));
    parts.push(blob(0.95, 1.05, 0.85, 1.0, -1.0, 2.0, -0.35, '#2a5f50'));
    parts.push(blob(0.75, 1.0, 0.8, 1.0, 0.2, 3.0, 0.1, '#2f6853'));
  }

  return merge(parts);
}

function makeBush(dark) {
  return merge([
    blob(0.75, 1.2, 0.7, 1.1, 0, 0.42, 0, dark ? '#2e5f50' : '#6fae62'),
    blob(0.55, 1.1, 0.7, 1.0, 0.6, 0.32, 0.2, dark ? '#24534a' : '#5f9e55'),
    blob(0.45, 1.0, 0.75, 1.0, -0.5, 0.34, -0.15, dark ? '#356a58' : '#7cb96e'),
  ]);
}

function makeRock() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const jx = fbm2(pos.getX(i) * 2.1 + 4, pos.getY(i) * 2.1) * 0.22;
    const jy = fbm2(pos.getY(i) * 2.1 + 9, pos.getZ(i) * 2.1) * 0.18;
    pos.setXYZ(i, pos.getX(i) + jx, (pos.getY(i) + jy) * 0.75, pos.getZ(i) + jx * 0.6);
  }
  g.computeVertexNormals();
  return paint(g, '#b9b0a0');
}

function makePalm() {
  const parts = [];
  // curved trunk out of stacked, shifted segments
  let px = 0;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.CylinderGeometry(0.12 - i * 0.008, 0.15 - i * 0.008, 0.85, 5);
    px += i * 0.05;
    seg.translate(px, 0.4 + i * 0.78, 0);
    parts.push(paint(seg, '#8a6a48'));
  }
  // fan of drooping leaves
  for (let i = 0; i < 8; i++) {
    const leaf = new THREE.PlaneGeometry(0.42, 2.4, 1, 4);
    const lp = leaf.attributes.position;
    for (let v = 0; v < lp.count; v++) {
      const y = lp.getY(v);
      lp.setZ(v, -Math.pow(y + 1.2, 2) * 0.14); // droop curve
    }
    leaf.rotateX(-Math.PI / 2.4);
    leaf.rotateY((i / 8) * Math.PI * 2);
    leaf.translate(px, 5.15, 0);
    paint(leaf, i % 2 ? '#3c7d54' : '#46895c');
    parts.push(leaf);
  }
  const g = merge(parts);
  return g;
}

// ---------- grass ----------

const BLADE_H = 0.6;

function makeGrassTuft() {
  const blades = [];
  for (let i = 0; i < 4; i++) {
    const p = new THREE.PlaneGeometry(0.13, BLADE_H, 1, 2);
    p.translate(0, BLADE_H / 2, 0);
    const pos = p.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const t = pos.getY(v) / BLADE_H; // 0 at base, 1 at tip
      pos.setX(v, pos.getX(v) * (1 - t * 0.9)); // taper to a point
      pos.setZ(v, pos.getZ(v) + t * t * 0.22); // curl outward
    }
    p.rotateY((i / 4) * Math.PI * 2 + i * 0.45);
    blades.push(p);
  }
  const g = merge(blades);

  // vertex colors are a brightness gradient only — each tuft's real color
  // comes from the terrain under it (per-instance tint), so grass always
  // grows out of the ground color instead of floating on it
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / BLADE_H, 0, 1);
    col[i * 3] = 0.72 + t * 0.36;
    col[i * 3 + 1] = 0.75 + t * 0.35;
    col[i * 3 + 2] = 0.66 + t * 0.3;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// approximate the Lambert-lit terrain color for unlit grass (sun + hemi on
// a flat surface), so tufts visually match the ground they stand on
const _lit = new THREE.Color();
function litGroundColor(x, z) {
  groundColorAt(x, z, _lit);
  const jitter = 0.95 + Math.random() * 0.1;
  _lit.r = Math.min(1, _lit.r * 1.7 * jitter);
  _lit.g = Math.min(1, _lit.g * 1.75 * jitter);
  _lit.b = Math.min(1, _lit.b * 1.6 * jitter);
  return _lit;
}

function makeGrassMaterial(timeUniform) {
  // unlit: vertical blades catch almost no Lambert light and turn into dark
  // sticks — flat painterly color matches the reference better anyway
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      vec3 transformed = vec3( position );
      #ifdef USE_INSTANCING
        float swayPhase = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.45;
        float swayAmp = smoothstep(0.05, 0.6, position.y);
        transformed.x += sin(uTime * 1.7 + swayPhase) * 0.09 * swayAmp;
        transformed.z += cos(uTime * 1.3 + swayPhase * 1.31) * 0.05 * swayAmp;
      #endif
      `
    );
  };
  mat.customProgramCacheKey = () => 'grass-sway';
  return mat;
}

// ---------- placement ----------

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

function scatterInstanced(geo, material, tries, accept, opts = {}) {
  const placed = [];
  for (let i = 0; i < tries; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 100;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!accept(x, z)) continue;
    placed.push({ x, z, s: opts.scale ? opts.scale() : 1, rot: Math.random() * Math.PI * 2 });
  }
  const mesh = new THREE.InstancedMesh(geo, material, placed.length);
  placed.forEach((it, i) => {
    _p.set(it.x, heightAt(it.x, it.z) + (opts.sink ?? 0), it.z);
    _q.setFromAxisAngle(_up, it.rot);
    _s.setScalar(it.s);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
    if (opts.tintAt) {
      mesh.setColorAt(i, opts.tintAt(it.x, it.z));
    } else {
      mesh.setColorAt(i, _c.setScalar(0.93 + Math.random() * 0.12));
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, placed };
}

export function buildScatter({ isMobile, avoid = [] }) {
  const group = new THREE.Group();
  group.name = 'scatter';
  const colliders = [];
  const interactables = [];
  const timeUniform = { value: 0 };

  // keep scattered things away from hand-placed props (benches, poles...)
  const nearAvoid = (x, z, margin) =>
    avoid.some((a) => {
      const dx = x - a.x;
      const dz = z - a.z;
      const min = a.r + margin;
      return dx * dx + dz * dz < min * min;
    });

  const flatWhite = () => new THREE.MeshLambertMaterial({ vertexColors: true });

  // --- trees (3 variants) ---
  const treeBudget = isMobile ? [34, 26, 22] : [52, 40, 34];
  for (let v = 0; v < 3; v++) {
    const { mesh, placed } = scatterInstanced(
      makeTree(v),
      flatWhite(),
      treeBudget[v],
      (x, z) => roadDist(x, z) > 9 && Math.hypot(x, z) > 12 && !nearAvoid(x, z, 1.8),
      { scale: () => 0.8 + Math.random() * 0.7 }
    );
    mesh.castShadow = true;
    group.add(mesh);
    for (const it of placed) colliders.push({ x: it.x, z: it.z, r: 0.5 * it.s });
  }

  // --- bushes ---
  for (const dark of [true, false]) {
    const { mesh } = scatterInstanced(
      makeBush(dark),
      flatWhite(),
      isMobile ? 30 : 44,
      (x, z) => roadDist(x, z) > 6.2 && !nearAvoid(x, z, 1.2),
      { scale: () => 0.7 + Math.random() * 1.1 }
    );
    mesh.castShadow = true;
    group.add(mesh);
  }

  // --- rocks ---
  const { mesh: rocks, placed: rockPlaced } = scatterInstanced(
    makeRock(),
    flatWhite(),
    isMobile ? 26 : 40,
    (x, z) => roadDist(x, z) > 5 && !nearAvoid(x, z, 1.6),
    { scale: () => 0.35 + Math.random() * 1.3, sink: -0.15 }
  );
  rocks.castShadow = true;
  group.add(rocks);
  for (const it of rockPlaced) {
    if (it.s > 0.8) colliders.push({ x: it.x, z: it.z, r: it.s * 0.9 });
  }

  // two landmark boulders near the road, like the reference shot
  const boulderGeo = makeRock();
  for (const [bx, bz, bs] of [[-14.5, 38, 2.6], [13, -62, 2.1]]) {
    const b = new THREE.Mesh(boulderGeo, flatWhite());
    b.position.set(bx, heightAt(bx, bz) - 0.3, bz);
    b.scale.setScalar(bs);
    b.rotation.y = Math.random() * Math.PI;
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
    colliders.push({ x: bx, z: bz, r: bs * 1.05 });

    // sit on the grass with your back to the rock, looking toward the road
    const toRoad = Math.sign(roadX(bz) - bx) || 1;
    const sx = bx + toRoad * (bs * 1.05 + 0.55);
    interactables.push({
      kind: 'rest',
      label: 'sit',
      anchor: new THREE.Vector3(sx, heightAt(sx, bz) + 1.4, bz),
      spot: { x: sx, y: heightAt(sx, bz), z: bz },
      facing: toRoad > 0 ? Math.PI / 2 : -Math.PI / 2,
      clips: { enter: 'Sit_Floor_Down', idle: 'Sit_Floor_Idle', exit: 'Sit_Floor_StandUp' },
    });
  }

  // --- palms on the dunes ---
  const palmGeo = makePalm();
  for (const [px, pz] of [[52, 14], [-58, -34]]) {
    const palm = new THREE.Mesh(palmGeo, flatWhite());
    palm.position.set(px, heightAt(px, pz) - 0.1, pz);
    palm.rotation.y = Math.random() * Math.PI * 2;
    palm.scale.setScalar(1.15);
    palm.castShadow = true;
    group.add(palm);
    colliders.push({ x: px, z: pz, r: 0.5 });

    // lie down in the shade and watch the clouds drift
    const toRoad = Math.sign(roadX(pz) - px) || 1;
    const lx = px + toRoad * 1.5;
    interactables.push({
      kind: 'rest',
      label: 'lie down',
      anchor: new THREE.Vector3(lx, heightAt(lx, pz) + 1.4, pz),
      spot: { x: lx, y: heightAt(lx, pz), z: pz },
      facing: toRoad > 0 ? Math.PI / 2 : -Math.PI / 2,
      clips: { enter: 'Lie_Down', idle: 'Lie_Idle', exit: 'Lie_StandUp' },
    });
  }

  // --- grass ---
  const grassMat = makeGrassMaterial(timeUniform);
  const { mesh: grass } = scatterInstanced(
    makeGrassTuft(),
    grassMat,
    isMobile ? 3000 : 5600,
    (x, z) => {
      if (roadDist(x, z) < 6.4) return false;
      if (heightAt(x, z) > 9) return false; // not on the bare dune tops
      if (nearAvoid(x, z, 0.6)) return false;
      // avoid the sandy noise patches so grass sits on green
      return fbm2(x * 0.05 + 31, z * 0.05 + 17) < 0.45 || Math.random() < 0.2;
    },
    { scale: () => 0.6 + Math.random() * 0.6, tintAt: litGroundColor }
  );
  group.add(grass);

  return { group, colliders, interactables, timeUniform };
}
