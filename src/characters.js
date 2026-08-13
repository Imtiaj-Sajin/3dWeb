// Character loading (KayKit CC0 GLBs), the player controller, and wandering
// NPCs. Movement is frame-rate independent (exponential damping) and walks
// on the analytic heightfield — no raycasts needed.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { heightAt, roadX, WORLD_RADIUS } from './terrain.js';
import { SKIN_PART, HELD_ITEM } from '../shared/world.js';

const CHARACTER_HEIGHT = 1.5;
const GRAVITY = 16;

// exponential damping factor — stable at any frame rate
function damp(k, dt) {
  return 1 - Math.exp(-k * dt);
}

function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Models are fetched the first time somebody actually wears one, then cached
// forever. Only the model you spawn as is on the critical path; the rest
// arrive quietly as people turn up wearing them.
const modelCache = new Map();

export function loadModel(name, manager) {
  if (!modelCache.has(name)) {
    const loader = new GLTFLoader(manager);
    const base = import.meta.env.BASE_URL;
    modelCache.set(
      name,
      new Promise((resolve, reject) => {
        loader.load(`${base}models/${name}.glb`, resolve, undefined, reject);
      }).catch((err) => {
        modelCache.delete(name); // let a later join retry
        throw err;
      })
    );
  }
  return modelCache.get(name);
}

export const isModelLoaded = (name) => modelCache.has(name);

// Build a ready-to-place rig from a loaded gltf. Always clones, so the same
// gltf can back several characters without them sharing (or re-scaling)
// one scene graph.
export function createRig(gltf) {
  const model = SkeletonUtils.clone(gltf.scene);

  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false; // skinned meshes pop with default culling
      const src = o.material;
      o.material = new THREE.MeshLambertMaterial({
        map: src.map ?? null,
        color: src.color ? src.color.clone() : new THREE.Color('#ffffff'),
      });
    }
    // prep-characters.mjs already strips these, but a raw model would still
    // arrive armed
    if (HELD_ITEM.test(o.name)) o.visible = false;
  });

  // normalize to a consistent height
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = CHARACTER_HEIGHT / Math.max(size.y, 0.001);

  const root = new THREE.Group();
  model.scale.setScalar(scale);
  model.position.y = -box.min.y * scale;
  root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of gltf.animations) {
    actions[clip.name] = mixer.clipAction(clip);
  }

  return { root, model, mixer, actions };
}

// Show exactly one held item (or none). The items are already parented to the
// hand bones, so this is all "carrying" needs to be.
export function setHeldItem(root, itemNode) {
  root.traverse((o) => {
    if (HELD_ITEM.test(o.name)) o.visible = !!itemNode && o.name === itemNode;
  });
}

// Give a rig its clothing colour and build. createRig hands every character
// its own material instances, so tinting one never leaks into another.
export function applyLook(root, look) {
  if (!look) return;
  if (look.tint && look.tint !== '#ffffff') {
    const tint = new THREE.Color(look.tint);
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (SKIN_PART.test(o.name)) return; // faces and hair stay as authored
      o.material.color.multiply(tint);
    });
  }
  if (look.scale && look.scale !== 1) root.scale.setScalar(look.scale);
  setHeldItem(root, look.item);
}

class AnimatedCharacter {
  constructor(rig) {
    this.root = rig.root;
    this.mixer = rig.mixer;
    this.actions = rig.actions;
    this.current = null;
    this.heading = 0;
    this.velocity = new THREE.Vector2(); // xz plane
    this.vy = 0;
    this.grounded = true;
    this.ignoreCollider = null;
    this.bodyRadius = 0.42;
    // inverse mass decides who gives way in a shove; 0 means immovable
    this.inverseMass = 1;
  }

  get immovable() {
    return false;
  }

  // re-settle after being pushed by another character
  settleAfterPush(colliders) {
    this.resolveCollisions(colliders);
    if (this.grounded) {
      this.root.position.y = heightAt(this.root.position.x, this.root.position.z);
    }
  }

  play(name, fade = 0.22, once = false) {
    if (this.current === name || !this.actions[name]) return;
    const next = this.actions[name];
    next.reset();
    if (once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true; // hold the last pose while fading out
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    next.fadeIn(fade).play();
    if (this.current && this.actions[this.current]) {
      this.actions[this.current].fadeOut(fade);
    }
    this.current = name;
  }

  emoteDuration(name, fallback = 1.2) {
    return this.actions[name] ? this.actions[name].getClip().duration : fallback;
  }

  resolveCollisions(colliders) {
    const p = this.root.position;
    for (const c of colliders) {
      if (c === this.ignoreCollider) continue;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d2 = dx * dx + dz * dz;
      const min = c.r + 0.35;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
      }
    }
    // soft world boundary
    const r = Math.hypot(p.x, p.z);
    if (r > WORLD_RADIUS) {
      p.x *= WORLD_RADIUS / r;
      p.z *= WORLD_RADIUS / r;
    }
  }

  applyGround(dt) {
    const p = this.root.position;
    const ground = heightAt(p.x, p.z);
    if (this.grounded) {
      p.y = ground;
    } else {
      this.vy -= GRAVITY * dt;
      p.y += this.vy * dt;
      if (p.y <= ground) {
        p.y = ground;
        this.grounded = true;
        this.vy = 0;
      }
    }
  }
}

// ---------- player ----------

const WALK_SPEED = 2.2;
const RUN_SPEED = 4.6;

export class Player extends AnimatedCharacter {
  constructor(rig) {
    super(rig);
    this.root.position.set(roadX(30), heightAt(roadX(30), 30), 30);
    this.heading = Math.PI; // face down the road (toward -z)
    this.root.rotation.y = this.heading;
    // mode: free | emote | interacting | entering | resting | leaving
    this.mode = 'free';
    this.modeTimer = 0;
    this.rest = null;
    this.faceTarget = null;
    this.justWaved = false;
    // the player shrugs off bumps; NPCs do most of the stepping aside
    this.inverseMass = 0.34;
    this.play('Idle', 0);
  }

  get busy() {
    return this.mode !== 'free';
  }

  // while seated the pose is pinned, so nobody gets to shove the player
  get immovable() {
    return this.rest !== null;
  }

  get isResting() {
    return this.mode === 'resting';
  }

  wave() {
    if (this.mode !== 'free' || !this.grounded) return;
    this.mode = 'emote';
    this.modeTimer = this.emoteDuration('Cheer') - 0.15;
    this.velocity.set(0, 0);
    this.play('Cheer', 0.2, true);
    this.justWaved = true;
  }

  // one-shot reach-out gesture, turning to face the object
  interact(item) {
    if (this.mode !== 'free' || !this.grounded) return;
    this.mode = 'interacting';
    this.modeTimer = this.emoteDuration('Interact', 1.2);
    this.velocity.set(0, 0);
    this.faceTarget = Math.atan2(
      item.anchor.x - this.root.position.x,
      item.anchor.z - this.root.position.z
    );
    this.play('Interact', 0.2, true);
  }

  // sit on a bench / on the grass / lie down: snap to the spot, play the
  // enter clip, then hold the looping idle until the player stands up
  beginRest(item) {
    if (this.mode !== 'free' || !this.grounded) return;
    this.rest = item;
    this.mode = 'entering';
    this.modeTimer = this.emoteDuration(item.clips.enter, 1);
    this.velocity.set(0, 0);
    // the seat sits inside the bench's own collider, so suspend it until the
    // player has walked clear again after standing up
    this.ignoreCollider = item.collider ?? null;
    this.root.position.set(item.spot.x, item.spot.y, item.spot.z);
    this.heading = item.facing;
    this.root.rotation.y = this.heading;
    this.play(item.clips.enter, 0.25, true);
  }

  standUp() {
    if (this.mode !== 'resting') return;
    this.mode = 'leaving';
    this.modeTimer = this.emoteDuration(this.rest.clips.exit, 1);
    this.play(this.rest.clips.exit, 0.2, true);
  }

  update(dt, input, cameraYaw, colliders) {
    this.justWaved = false;

    // --- locked modes: sitting, waving, interacting ---
    if (this.mode !== 'free') {
      this.modeTimer -= dt;

      if (this.faceTarget !== null) {
        this.heading = angleLerp(this.heading, this.faceTarget, damp(8, dt));
        this.root.rotation.y = this.heading;
      }

      // walking away cancels a standing gesture (but never a sit — you must
      // stand up, which keeps the seated pose from sliding around)
      const walkingAway =
        input.magnitude > 0.4 && (this.mode === 'emote' || this.mode === 'interacting');

      if (walkingAway) {
        this.mode = 'free';
        this.faceTarget = null;
      } else if (this.mode === 'resting') {
        this.modeTimer = 1; // held until standUp()
      } else if (this.modeTimer <= 0) {
        if (this.mode === 'entering') {
          this.mode = 'resting';
          this.play(this.rest.clips.idle, 0.3);
        } else if (this.mode === 'leaving') {
          this.mode = 'free';
          this.rest = null;
          this.play('Idle', 0.25);
        } else {
          this.mode = 'free';
          this.faceTarget = null;
          this.play('Idle', 0.3);
        }
      }

      if (this.mode !== 'free') {
        if (this.rest) {
          // pinned to the seat: the pose is authored around this exact spot
          this.root.position.set(this.rest.spot.x, this.rest.spot.y, this.rest.spot.z);
        } else {
          this.applyGround(dt);
        }
        this.mixer.update(dt);
        return;
      }
    }

    // re-enable a suspended collider once the player has stepped clear of it
    if (this.ignoreCollider) {
      const c = this.ignoreCollider;
      const clear = c.r + 0.45;
      if (Math.hypot(this.root.position.x - c.x, this.root.position.z - c.z) > clear) {
        this.ignoreCollider = null;
      }
    }

    // input is screen-relative; rotate into world by camera yaw
    const ix = input.moveX;
    const iy = input.moveY;
    const mag = Math.min(1, input.magnitude);
    let targetVX = 0;
    let targetVZ = 0;
    if (mag > 0.01) {
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      // camera forward is (sin, cos) in xz; screen-right is forward x up
      // = (-cos, sin). world move = right * ix + forward * iy
      const wx = -ix * cos + iy * sin;
      const wz = ix * sin + iy * cos;
      const speed = (input.running ? RUN_SPEED : WALK_SPEED) * mag;
      targetVX = wx * speed;
      targetVZ = wz * speed;
    }

    const k = this.grounded ? 8 : 2.5;
    this.velocity.x += (targetVX - this.velocity.x) * damp(k, dt);
    this.velocity.y += (targetVZ - this.velocity.y) * damp(k, dt);

    const p = this.root.position;
    p.x += this.velocity.x * dt;
    p.z += this.velocity.y * dt;

    if (input.consumeJump() && this.grounded) {
      this.grounded = false;
      this.vy = 5.6;
      this.play('Jump_Idle', 0.12);
    }

    this.resolveCollisions(colliders);
    this.applyGround(dt);

    // face the movement direction, lazily
    const speed = this.velocity.length();
    if (speed > 0.25) {
      const target = Math.atan2(this.velocity.x, this.velocity.y);
      this.heading = angleLerp(this.heading, target, damp(10, dt));
      this.root.rotation.y = this.heading;
    }

    // animation state
    if (!this.grounded) {
      this.play('Jump_Idle', 0.15);
    } else if (speed > 3.2) {
      this.play('Running_A');
    } else if (speed > 0.3) {
      this.play('Walking_A');
    } else {
      this.play('Idle', 0.3);
    }

    this.mixer.update(dt);
  }
}

// Push overlapping characters apart. Each pair splits the correction by
// inverse mass, so the player barely budges while an NPC steps aside — and a
// seated player does not budge at all.
export function separateCharacters(list, colliders) {
  let moved = false;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const ax = a.root.position;
      const bx = b.root.position;
      const dx = bx.x - ax.x;
      const dz = bx.z - ax.z;
      const min = a.bodyRadius + b.bodyRadius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;

      const wa = a.immovable ? 0 : a.inverseMass;
      const wb = b.immovable ? 0 : b.inverseMass;
      const total = wa + wb;
      if (total <= 0) continue;

      // exactly stacked: shove apart along an arbitrary axis
      const d = Math.sqrt(d2);
      const nx = d > 1e-4 ? dx / d : 1;
      const nz = d > 1e-4 ? dz / d : 0;
      const overlap = min - d;

      ax.x -= nx * overlap * (wa / total);
      ax.z -= nz * overlap * (wa / total);
      bx.x += nx * overlap * (wb / total);
      bx.z += nz * overlap * (wb / total);
      moved = true;
    }
  }

  if (moved) {
    for (const c of list) {
      if (!c.immovable) c.settleAfterPush(colliders);
    }
  }
}

// ---------- NPCs ----------

export class NPC extends AnimatedCharacter {
  constructor(rig, seed) {
    super(rig);
    const z = -80 + ((seed * 47) % 160);
    const x = roadX(z) + (seed % 2 === 0 ? -4 : 4);
    this.root.position.set(x, heightAt(x, z), z);
    this.state = 'idle';
    this.timer = 1 + (seed % 3);
    this.target = new THREE.Vector2(x, z);
    this.speed = 1.5;
    this.greetCooldown = 0;
    this.greetDelay = 0;
    this.greetTimer = -1;
    this.greetFrom = new THREE.Vector3();
    this.play('Idle', 0);
    // desync animation phases between clones
    if (this.actions.Idle) this.actions.Idle.time = seed * 0.7;
  }

  pickTarget() {
    // wander to somewhere near the road so NPCs stay on the paths
    const z = THREE.MathUtils.clamp(
      this.root.position.z + (Math.random() - 0.5) * 60,
      -88,
      88
    );
    const x = roadX(z) + (Math.random() - 0.5) * 11;
    this.target.set(x, z);
  }

  // called when the player waves nearby: pause, turn, wave back
  reactWave(fromPos, delay) {
    if (this.greetCooldown > 0) return;
    this.greetCooldown = 6;
    this.state = 'greet';
    this.greetDelay = delay;
    this.greetTimer = -1;
    this.greetFrom.copy(fromPos);
  }

  update(dt, colliders) {
    const p = this.root.position;
    this.greetCooldown = Math.max(0, this.greetCooldown - dt);

    if (this.state === 'greet') {
      this.greetDelay -= dt;
      if (this.greetDelay > 0) {
        this.play('Idle', 0.25);
      } else {
        // turn toward whoever waved
        const dx = this.greetFrom.x - p.x;
        const dz = this.greetFrom.z - p.z;
        this.heading = angleLerp(this.heading, Math.atan2(dx, dz), damp(6, dt));
        this.root.rotation.y = this.heading;
        if (this.greetTimer < 0) {
          this.greetTimer = this.emoteDuration('Cheer') - 0.1;
          this.play('Cheer', 0.2, true);
        } else {
          this.greetTimer -= dt;
          if (this.greetTimer <= 0) {
            this.state = 'idle';
            this.timer = 1 + Math.random() * 2;
          }
        }
      }
      this.mixer.update(dt);
      return;
    }

    if (this.state === 'idle') {
      this.timer -= dt;
      this.play('Idle', 0.35);
      if (this.timer <= 0) {
        this.pickTarget();
        this.state = 'walk';
      }
    } else {
      const dx = this.target.x - p.x;
      const dz = this.target.y - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1) {
        this.state = 'idle';
        this.timer = 2 + Math.random() * 4;
      } else {
        const targetHeading = Math.atan2(dx, dz);
        this.heading = angleLerp(this.heading, targetHeading, damp(4, dt));
        this.root.rotation.y = this.heading;
        p.x += Math.sin(this.heading) * this.speed * dt;
        p.z += Math.cos(this.heading) * this.speed * dt;
        this.play('Walking_B');
      }
    }

    this.resolveCollisions(colliders);
    p.y = heightAt(p.x, p.z);
    this.mixer.update(dt);
  }
}
