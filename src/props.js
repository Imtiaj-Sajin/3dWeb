// Roadside props: power poles with sagging wires, street lamps, benches and
// a wooden barrier near the crest — the small storytelling details.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, roadX } from './terrain.js';
import { noise2 } from './noise.js';

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

const woodMat = () => new THREE.MeshLambertMaterial({ vertexColors: true });

// yaw of the road's tangent at z — used to align props with the road
function roadAngle(z) {
  return Math.atan2(roadX(z + 0.5) - roadX(z - 0.5), 1);
}

// Measured from the seated pose (Sit_Chair_Idle): where the character's hips
// end up relative to their root. The bench is sized and the sit spot placed
// from these, so the pose lands on the seat instead of through the backrest.
const SIT_HIP_UP = 0.331;
const SIT_HIP_BACK = 0.272;
const SEAT_TOP = 0.33; // bench seat height, matched to the animation

export function buildProps() {
  const group = new THREE.Group();
  group.name = 'props';
  const colliders = [];
  const interactables = [];

  // ---------- power poles + wires ----------

  const poleTops = [];
  const poleParts = [];
  for (let i = 0; i < 8; i++) {
    const z = -98 + i * 28;
    const side = i % 2 === 0 ? 1 : -1;
    const x = roadX(z) + side * (6.8 + Math.abs(noise2(i, 2)) * 2);
    const y = heightAt(x, z);
    const h = 7 + noise2(i, 5) * 0.5;

    const pole = new THREE.CylinderGeometry(0.09, 0.14, h, 6);
    pole.translate(0, h / 2, 0);
    const arm = new THREE.BoxGeometry(1.7, 0.1, 0.1);
    arm.translate(0, h - 0.55, 0);
    const armLow = new THREE.BoxGeometry(1.25, 0.09, 0.09);
    armLow.translate(0, h - 1.15, 0);

    const g = merge([paint(pole, '#8b8274'), paint(arm, '#7d7466'), paint(armLow, '#7d7466')]);
    const tilt = noise2(i, 9) * 0.04;
    g.rotateZ(tilt);
    g.rotateY(noise2(i, 12) * 0.6);
    g.translate(x, y, z);
    poleParts.push(g);

    poleTops.push(new THREE.Vector3(x, y + h - 0.55, z));
    colliders.push({ x, z, r: 0.35 });
  }
  const poles = new THREE.Mesh(merge(poleParts), woodMat());
  poles.castShadow = true;
  group.add(poles);

  // sagging wires between consecutive pole tops (they cross the road, which
  // draws those nice looping lines against the sky, like the reference)
  const wireMat = new THREE.MeshBasicMaterial({ color: '#2e2e36', fog: true });
  const wireGeos = [];
  for (let i = 0; i < poleTops.length - 1; i++) {
    const a = poleTops[i];
    const b = poleTops[i + 1];
    for (const drop of [0, 0.55]) {
      const mid = a.clone().lerp(b, 0.5);
      mid.y -= 1.5 + drop;
      const curve = new THREE.CatmullRomCurve3([
        a.clone().setY(a.y - drop),
        mid,
        b.clone().setY(b.y - drop),
      ]);
      wireGeos.push(new THREE.TubeGeometry(curve, 14, 0.022, 3));
    }
  }
  const wires = new THREE.Mesh(merge(wireGeos.map((g) => paint(g, '#2e2e36'))), wireMat);
  group.add(wires);

  // ---------- street lamps ----------

  const lampParts = [];
  for (const [i, z] of [-18, -48, 22].entries()) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = roadX(z) + side * 4.6;
    const y = heightAt(x, z);

    const pole = new THREE.CylinderGeometry(0.07, 0.1, 5.4, 6);
    pole.translate(0, 2.7, 0);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 1.3, 5);
    arm.rotateZ(Math.PI / 2.6);
    arm.translate(side * -0.5, 5.35, 0);
    const shade = new THREE.ConeGeometry(0.3, 0.28, 7);
    shade.translate(side * -1.05, 5.55, 0);
    const bulb = new THREE.SphereGeometry(0.11, 6, 5);
    bulb.translate(side * -1.05, 5.42, 0);

    const g = merge([
      paint(pole, '#6f6a5e'),
      paint(arm, '#6f6a5e'),
      paint(shade, '#5d584d'),
      paint(bulb, '#fff3c8'),
    ]);
    g.translate(x, y, z);
    lampParts.push(g);
    colliders.push({ x, z, r: 0.3 });
    interactables.push({
      kind: 'touch',
      label: 'touch',
      anchor: new THREE.Vector3(x, y + 1.5, z),
    });
  }
  const lamps = new THREE.Mesh(merge(lampParts), woodMat());
  lamps.castShadow = true;
  group.add(lamps);

  // ---------- benches near the crest ----------

  // side: +1 = right of the road, -1 = left. The bench sits parallel to the
  // road, seat facing it, and settles on the lowest of its four leg corners
  // so it never floats off the shoulder slope.
  function bench(z, side) {
    const x = roadX(z) + side * 5.2;
    const rotY = roadAngle(z) + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    const legH = SEAT_TOP - 0.05;

    const parts = [];
    for (const dx of [-0.68, 0.68]) {
      const leg = new THREE.BoxGeometry(0.1, legH, 0.5);
      leg.translate(dx, legH / 2, 0);
      parts.push(paint(leg, '#6b4e33'));
      const post = new THREE.BoxGeometry(0.09, 0.72, 0.09);
      post.translate(dx, 0.36, -0.28);
      parts.push(paint(post, '#6b4e33'));
    }
    for (const dz of [-0.2, 0, 0.2]) {
      const slat = new THREE.BoxGeometry(1.7, 0.05, 0.17);
      slat.translate(0, SEAT_TOP - 0.025, dz);
      parts.push(paint(slat, '#c99f63'));
    }
    for (const dy of [0.52, 0.68]) {
      const back = new THREE.BoxGeometry(1.7, 0.11, 0.05);
      back.translate(0, dy, -0.28);
      parts.push(paint(back, '#c99f63'));
    }
    const g = merge(parts);
    g.rotateY(rotY);

    const cs = Math.cos(rotY);
    const sn = Math.sin(rotY);
    const toWorld = (lx, lz) => ({ x: x + lx * cs + lz * sn, z: z - lx * sn + lz * cs });

    let y = Infinity;
    for (const [lx, lz] of [[-0.68, -0.25], [0.68, -0.25], [-0.68, 0.25], [0.68, 0.25]]) {
      const w = toWorld(lx, lz);
      y = Math.min(y, heightAt(w.x, w.z));
    }
    const base = y - 0.02;
    g.translate(x, base, z);

    const collider = { x, z, r: 0.85 };
    colliders.push(collider);

    // sit spot: shifted forward so the hips land on the seat, and lifted so
    // they rest on the slats rather than sinking through them
    const seat = toWorld(0, SIT_HIP_BACK - 0.05);
    interactables.push({
      kind: 'rest',
      label: 'sit',
      anchor: new THREE.Vector3(x, base + 1.25, z),
      spot: { x: seat.x, y: base + SEAT_TOP + 0.035 - SIT_HIP_UP, z: seat.z },
      facing: rotY, // model forward is +z, which the bench faces toward the road
      collider, // ignored until the player walks clear after standing up
      clips: { enter: 'Sit_Chair_Down', idle: 'Sit_Chair_Idle', exit: 'Sit_Chair_StandUp' },
    });
    return g;
  }

  // ---------- wooden road barrier ----------

  // sits across the road (perpendicular to its tangent), half-blocking a lane
  function barrier(z, offset) {
    const x = roadX(z) + offset;
    const rotY = roadAngle(z);
    const y = heightAt(x, z);
    const parts = [];
    for (const dx of [-1.1, 1.1]) {
      const post = new THREE.BoxGeometry(0.14, 1.05, 0.14);
      post.translate(dx, 0.52, 0);
      parts.push(paint(post, '#a8814f'));
    }
    const plank = new THREE.BoxGeometry(2.9, 0.3, 0.09);
    plank.translate(0, 0.82, 0);
    parts.push(paint(plank, '#d9a748'));
    const plankLow = new THREE.BoxGeometry(2.9, 0.22, 0.08);
    plankLow.translate(0, 0.35, 0);
    parts.push(paint(plankLow, '#cf9c3f'));
    const g = merge(parts);
    g.rotateY(rotY);
    g.translate(x, y, z);
    colliders.push({ x, z, r: 1.3 });
    interactables.push({
      kind: 'touch',
      label: 'touch',
      anchor: new THREE.Vector3(x, y + 1.4, z),
    });
    return g;
  }

  const woodwork = new THREE.Mesh(
    merge([bench(-52, 1), bench(-43, -1), barrier(-96, 1.2)]),
    woodMat()
  );
  woodwork.castShadow = true;
  woodwork.receiveShadow = true;
  group.add(woodwork);

  return { group, colliders, interactables };
}
