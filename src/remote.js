// Everybody who is not you: other players and the server's bots.
//
// Snapshots arrive 10 times a second, so positions are smoothed toward the
// latest one rather than snapped. Y is never sent — each client derives it
// from the terrain function, which keeps the payload small and guarantees
// feet stay on the ground.

import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { applyLook, attackClipFor } from './characters.js';
import { ANIM, ANIM_CLIP } from '../shared/world.js';

function damp(k, dt) {
  return 1 - Math.exp(-k * dt);
}

function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class RemoteCharacter {
  constructor(rig, info) {
    this.id = info.id;
    this.name = info.name;
    this.isBot = !!info.bot;
    this.root = rig.root;
    this.mixer = rig.mixer;
    this.actions = rig.actions;
    this.current = null;

    this.target = new THREE.Vector3();
    this.targetHeading = 0;
    this.anim = ANIM.IDLE;
    this.emote = 0; // seconds left on a one-off gesture
    this.spawned = false;
    this.visible = true;
    this.dead = false;
    this.item = info.item ?? null;

    // You collide with them, but you never push them: the server owns where
    // they are, and shoving them locally would just fight the next snapshot.
    this.bodyRadius = 0.42;
    this.inverseMass = 0;

    applyLook(this.root, info);

    this.play('Idle', 0);
  }

  get immovable() {
    return true;
  }

  // Someone changed their look at the showroom. Rebuild onto the new model
  // but keep them exactly where they are, so they never pop across the map.
  swapRig(rig, info) {
    const oldRoot = this.root;
    rig.root.position.copy(oldRoot.position);
    rig.root.rotation.copy(oldRoot.rotation);
    this.mixer.stopAllAction();

    this.root = rig.root;
    this.mixer = rig.mixer;
    this.actions = rig.actions;
    this.current = null;
    applyLook(this.root, info);
    this.play(ANIM_CLIP[this.anim] ?? 'Idle', 0);
    return oldRoot;
  }

  play(name, fade = 0.22, once = false) {
    if (this.current === name || !this.actions[name]) return;
    const next = this.actions[name];
    next.reset();
    if (once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    next.fadeIn(fade).play();
    if (this.current && this.actions[this.current]) this.actions[this.current].fadeOut(fade);
    this.current = name;
  }

  applySnapshot(x, z, h, a) {
    this.target.set(x, heightAt(x, z), z);
    this.targetHeading = h;
    this.anim = a;
    if (!this.spawned) {
      // first sighting: appear where they actually are, do not glide in
      this.root.position.copy(this.target);
      this.root.rotation.y = h;
      this.spawned = true;
    }
  }

  playEvent(e) {
    if (e === 'wave') {
      this.emote = 1.5;
      this.play('Cheer', 0.18, true);
    }
  }

  playSwing(item) {
    if (this.dead) return;
    const clip = attackClipFor(item);
    this.emote = Math.max(this.emote, 0.75);
    this.play(clip, 0.1, true);
  }

  playHurt() {
    if (this.dead) return;
    this.emote = Math.max(this.emote, 0.5);
    this.play(Math.random() < 0.5 ? 'Hit_A' : 'Hit_B', 0.08, true);
  }

  playDeath() {
    this.dead = true;
    this.emote = Infinity; // held until the server respawns them
    this.play(Math.random() < 0.5 ? 'Death_A' : 'Death_B', 0.12, true);
  }

  reviveAt(x, z) {
    this.dead = false;
    this.emote = 0;
    this.spawned = false; // reappear at the new spot rather than sliding there
    this.applySnapshot(x, z, this.targetHeading, this.anim);
    this.current = null;
    this.play('Idle', 0.2);
  }

  update(dt) {
    const p = this.root.position;
    p.x += (this.target.x - p.x) * damp(11, dt);
    p.z += (this.target.z - p.z) * damp(11, dt);
    // resample the ground under the smoothed position so they never sink
    p.y = heightAt(p.x, p.z);

    this.root.rotation.y = angleLerp(this.root.rotation.y, this.targetHeading, damp(9, dt));

    if (this.dead) {
      // hold the death pose; the server decides when they get up
    } else if (this.emote > 0) {
      this.emote -= dt;
    } else {
      this.play(ANIM_CLIP[this.anim] ?? 'Idle', 0.25);
    }

    // skinned animation is the expensive part, so only run it for characters
    // actually on screen and near enough to read
    if (this.visible) this.mixer.update(dt);
  }

  dispose(scene) {
    scene.remove(this.root);
    this.mixer.stopAllAction();
  }
}

// ---------- floating name tags ----------

export class NameTags {
  constructor(camera, container) {
    this.camera = camera;
    this.container = container;
    this.tags = new Map(); // id -> element
    this._v = new THREE.Vector3();
  }

  add(id, name, isBot) {
    const el = document.createElement('div');
    el.className = `nametag${isBot ? ' bot' : ''}`;
    el.textContent = name;
    this.container.appendChild(el);
    this.tags.set(id, el);
  }

  remove(id) {
    this.tags.get(id)?.remove();
    this.tags.delete(id);
  }

  clear() {
    for (const el of this.tags.values()) el.remove();
    this.tags.clear();
  }

  // returns nothing, but flags each character with whether it is on screen so
  // the animation mixers of off-screen players can be skipped
  update(characters) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const c of characters) {
      const el = this.tags.get(c.id);
      this._v.copy(c.root.position);
      this._v.y += 1.95;
      this._v.project(this.camera);

      const dist = this.camera.position.distanceTo(c.root.position);
      const onScreen =
        this._v.z < 1 && Math.abs(this._v.x) < 1.25 && Math.abs(this._v.y) < 1.25;
      c.visible = onScreen && dist < 70;

      if (!el) continue;
      if (!onScreen || dist > 34) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      const x = (this._v.x * 0.5 + 0.5) * w;
      const y = (-this._v.y * 0.5 + 0.5) * h;
      el.style.display = '';
      el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      el.style.opacity = String(Math.max(0.25, 1 - dist / 40));
    }
  }
}
