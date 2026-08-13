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
import { heightAt } from './terrain.js';
import { MODELS, TINTS, EXHIBITS, SHOWROOM_X, SHOWROOM_Z } from '../shared/world.js';

// Position comes from shared/ because the server needs it too: this clearing
// is the safe zone, and both sides must agree on exactly where it is.
export { SHOWROOM_X, SHOWROOM_Z };
export const STATUE_RANGE = 46; // how near you must be before statues load

const PLINTH_R = 6.4;
const ARC_FROM = -Math.PI * 0.72;
const ARC_TO = Math.PI * 0.12;

// gear stands sit on a wider ring behind the characters, in the same order,
// so a character's kit is always the group nearest to them
const ITEM_R = 11.4;
const ITEM_FROM = -Math.PI * 0.8;
const ITEM_TO = Math.PI * 0.2;
export const ITEM_DISPLAY_Y = 0.86; // top of a gear stand, in local units

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

// where each gear stand sits, one per distinct item, plus a bare stand at the
// front for putting whatever you carry back down
export function itemSpots() {
  const entries = [{ node: null, label: 'nothing', model: null }, ...EXHIBITS];
  return entries.map((entry, i) => {
    const t = entries.length > 1 ? i / (entries.length - 1) : 0.5;
    const a = ITEM_FROM + (ITEM_TO - ITEM_FROM) * t;
    const x = SHOWROOM_X + Math.cos(a) * ITEM_R;
    const z = SHOWROOM_Z + Math.sin(a) * ITEM_R;
    return {
      ...entry,
      x,
      z,
      y: heightAt(x, z),
      facing: Math.atan2(SHOWROOM_X - x, SHOWROOM_Z - z),
    };
  });
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
  // opposite side of the ring from the characters and their gear
  TINTS.forEach((tint, i) => {
    const a = Math.PI * 0.28 + (i / (TINTS.length - 1)) * Math.PI * 0.58;
    const r = PLINTH_R + 1.6;
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

  // ---------- gear stands, one per item ----------

  const items = itemSpots();
  for (const spot of items) {
    // a slim post with a small tray on top for the item to rest on
    const post = new THREE.CylinderGeometry(0.09, 0.13, 0.72, 8);
    post.translate(0, 0.36, 0);
    const tray = new THREE.CylinderGeometry(0.28, 0.24, 0.1, 8);
    tray.translate(0, 0.77, 0);
    const g = merge([
      paint(post, spot.node ? '#8d7a58' : '#9a9384'),
      paint(tray, spot.node ? '#ddd0b2' : '#c6bfae'),
    ]);
    g.translate(spot.x, spot.y, spot.z);
    parts.push(g);

    colliders.push({ x: spot.x, z: spot.z, r: 0.34 });
    interactables.push({
      kind: 'take',
      label: spot.node ? `take the ${spot.label}` : 'carry nothing',
      anchor: new THREE.Vector3(spot.x, spot.y + 1.5, spot.z),
      itemNode: spot.node,
      itemLabel: spot.label,
    });
  }

  // ---------- ring of stones marking the clearing ----------

  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = ITEM_R + 3.2;
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
