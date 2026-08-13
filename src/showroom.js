// A small open-air exhibition off the road where you can change who you are.
//
// Everything here is free: walk to a plinth to become that character, to a
// post to change colour, or to the rack to pick something up. Whatever you
// choose is broadcast, so everyone sees the new you immediately.
//
// The plinths carry no statue until you get close — that is what triggers the
// remaining character models to download, so a player who never visits never
// pays for them.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, roadX } from './terrain.js';
import { MODELS, TINTS } from '../shared/world.js';

// Sits in the meadow beside the road, close enough to spot on the way past.
export const SHOWROOM_Z = 8;
export const SHOWROOM_X = roadX(SHOWROOM_Z) + 15;
export const STATUE_RANGE = 46; // how near you must be before statues load

const PLINTH_R = 6.4;
const ARC_FROM = -Math.PI * 0.72;
const ARC_TO = Math.PI * 0.12;

function paint(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function merge(geos) {
  return mergeGeometries(
    geos.map((g) => {
      const ni = g.index ? g.toNonIndexed() : g;
      ni.deleteAttribute('uv');
      return ni;
    }),
    false
  );
}

// where each character plinth stands
export function plinthSpots() {
  return MODELS.map((model, i) => {
    const t = MODELS.length > 1 ? i / (MODELS.length - 1) : 0.5;
    const a = ARC_FROM + (ARC_TO - ARC_FROM) * t;
    const x = SHOWROOM_X + Math.cos(a) * PLINTH_R;
    const z = SHOWROOM_Z + Math.sin(a) * PLINTH_R;
    return { model, x, z, y: heightAt(x, z), facing: Math.atan2(SHOWROOM_X - x, SHOWROOM_Z - z) };
  });
}

export function buildShowroom() {
  const group = new THREE.Group();
  group.name = 'showroom';
  const colliders = [];
  const interactables = [];
  const stone = () => new THREE.MeshLambertMaterial({ vertexColors: true });

  const parts = [];

  // ---------- character plinths ----------

  const spots = plinthSpots();
  for (const spot of spots) {
    const top = new THREE.CylinderGeometry(0.66, 0.72, 0.16, 10);
    top.translate(0, 0.44, 0);
    const shaft = new THREE.CylinderGeometry(0.5, 0.58, 0.38, 10);
    shaft.translate(0, 0.19, 0);
    const g = merge([paint(top, '#d9cdb0'), paint(shaft, '#c3b596')]);
    g.translate(spot.x, spot.y, spot.z);
    parts.push(g);

    colliders.push({ x: spot.x, z: spot.z, r: 0.75 });
    interactables.push({
      kind: 'wear',
      label: `become the ${spot.model.replace('_', ' ').toLowerCase()}`,
      anchor: new THREE.Vector3(spot.x, spot.y + 2.5, spot.z),
      look: { model: spot.model },
    });
  }

  // ---------- colour posts ----------

  // a low arc of painted posts in front of the plinths
  TINTS.forEach((tint, i) => {
    const a = -Math.PI * 0.62 + (i / (TINTS.length - 1)) * Math.PI * 0.62;
    const r = PLINTH_R + 3.6;
    const x = SHOWROOM_X + Math.cos(a) * r;
    const z = SHOWROOM_Z + Math.sin(a) * r;
    const y = heightAt(x, z);

    const post = new THREE.CylinderGeometry(0.08, 0.1, 0.62, 6);
    post.translate(0, 0.31, 0);
    const cap = new THREE.IcosahedronGeometry(0.19, 1);
    cap.translate(0, 0.74, 0);
    const g = merge([paint(post, '#8d7a58'), paint(cap, tint)]);
    g.translate(x, y, z);
    parts.push(g);

    colliders.push({ x, z, r: 0.3 });
    interactables.push({
      kind: 'wear',
      label: 'wear this colour',
      anchor: new THREE.Vector3(x, y + 1.35, z),
      look: { tint },
    });
  });

  // ---------- gear rack ----------

  const rackX = SHOWROOM_X + 3.4;
  const rackZ = SHOWROOM_Z + 4.6;
  const rackY = heightAt(rackX, rackZ);
  const rackParts = [];
  for (const dx of [-0.7, 0.7]) {
    const leg = new THREE.BoxGeometry(0.11, 1.1, 0.11);
    leg.translate(dx, 0.55, 0);
    rackParts.push(paint(leg, '#6b4e33'));
  }
  const bar = new THREE.BoxGeometry(1.6, 0.1, 0.1);
  bar.translate(0, 1.05, 0);
  rackParts.push(paint(bar, '#8a6a48'));
  const shelf = new THREE.BoxGeometry(1.6, 0.08, 0.42);
  shelf.translate(0, 0.62, 0);
  rackParts.push(paint(shelf, '#c99f63'));
  const rack = merge(rackParts);
  rack.translate(rackX, rackY, rackZ);
  parts.push(rack);

  colliders.push({ x: rackX, z: rackZ, r: 0.9 });
  interactables.push({
    kind: 'item',
    label: 'pick something up',
    anchor: new THREE.Vector3(rackX, rackY + 1.7, rackZ),
  });

  // ---------- ring of stones marking the clearing ----------

  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = PLINTH_R + 5.4;
    const x = SHOWROOM_X + Math.cos(a) * r;
    const z = SHOWROOM_Z + Math.sin(a) * r;
    const s = 0.22 + ((i * 37) % 10) / 40;
    const g = new THREE.IcosahedronGeometry(s, 0);
    g.scale(1, 0.6, 1);
    paint(g, '#c9c0ac');
    g.translate(x, heightAt(x, z) + s * 0.2, z);
    parts.push(g);
  }

  const mesh = new THREE.Mesh(merge(parts), stone());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  return { group, colliders, interactables, spots };
}
