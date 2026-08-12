// Character loading (KayKit CC0 GLBs), the player controller, and wandering
// NPCs. Movement is frame-rate independent (exponential damping) and walks
// on the analytic heightfield — no raycasts needed.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { heightAt, roadX, WORLD_RADIUS } from './terrain.js';

const CHARACTER_HEIGHT = 1.5;
const GRAVITY = 16;
const WEAPON_RE = /sword|dagger|knife|axe|crossbow|shield|arrow|quiver|staff|wand|bow|spellbook|mug|throwable/i;

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

export function loadCharacterGLBs(manager, names) {
  const loader = new GLTFLoader(manager);
  const base = import.meta.env.BASE_URL;
  return Promise.all(
    names.map(
      (name) =>
        new Promise((resolve, reject) => {
          loader.load(`${base}models/${name}.glb`, resolve, undefined, reject);
        })
    )
  );
}

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
    if (WEAPON_RE.test(o.name)) o.visible = false;
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
  }

  play(name, fade = 0.22) {
    if (this.current === name || !this.actions[name]) return;
    const next = this.actions[name];
    next.reset().fadeIn(fade).play();
    if (this.current && this.actions[this.current]) {
      this.actions[this.current].fadeOut(fade);
    }
    this.current = name;
  }

  resolveCollisions(colliders) {
    const p = this.root.position;
    for (const c of colliders) {
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
    this.play('Idle', 0);
  }

  update(dt, input, cameraYaw, colliders) {
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

  update(dt, colliders) {
    const p = this.root.position;

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
