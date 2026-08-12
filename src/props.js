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

export function buildProps() {
  const group = new THREE.Group();
  group.name = 'props';
  const colliders = [];

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
  }
  const lamps = new THREE.Mesh(merge(lampParts), woodMat());
  lamps.castShadow = true;
  group.add(lamps);

  // ---------- benches near the crest ----------

  function bench(x, z, rotY) {
    const y = heightAt(x, z);
    const parts = [];
    for (const dx of [-0.85, 0.85]) {
      const leg = new THREE.BoxGeometry(0.12, 0.5, 0.55);
      leg.translate(dx, 0.25, 0);
      parts.push(paint(leg, '#6b4e33'));
    }
    for (const dz of [-0.18, 0.02, 0.22]) {
      const slat = new THREE.BoxGeometry(2.1, 0.07, 0.17);
      slat.translate(0, 0.53, dz);
      parts.push(paint(slat, '#c99f63'));
    }
    for (const dy of [0.85, 1.05]) {
      const back = new THREE.BoxGeometry(2.1, 0.14, 0.06);
      back.translate(0, dy, -0.3);
      parts.push(paint(back, '#c99f63'));
    }
    const g = merge(parts);
    g.rotateY(rotY);
    g.translate(x, y, z);
    colliders.push({ x, z, r: 1.0 });
    return g;
  }

  // ---------- wooden road barrier ----------

  function barrier(x, z, rotY) {
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
    return g;
  }

  const crestZ = -52;
  const woodwork = new THREE.Mesh(
    merge([
      bench(roadX(crestZ) + 5.6, crestZ, 0.5),
      bench(roadX(crestZ + 9) - 5.9, crestZ + 9, -2.4),
      barrier(roadX(-96) + 1.2, -96, 0.15),
    ]),
    woodMat()
  );
  woodwork.castShadow = true;
  woodwork.receiveShadow = true;
  group.add(woodwork);

  return { group, colliders };
}
