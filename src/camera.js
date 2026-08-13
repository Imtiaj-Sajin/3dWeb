// Lazy auto-follow camera: drifts behind the player's movement direction,
// tilts slightly with the mouse, and never dips below the terrain.
// No dragging needed — Lucendo's "for non-gamers" camera.

import * as THREE from 'three';
import { heightAt } from './terrain.js';

function damp(k, dt) {
  return 1 - Math.exp(-k * dt);
}

function angleDamp(a, b, k, dt) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * damp(k, dt);
}

export class CameraRig {
  constructor(camera, colliders = []) {
    this.camera = camera;
    this.colliders = colliders;
    this.yaw = Math.PI; // looking down the road at start
    this.distance = 7.6;
    this.height = 3.1;
    this.lookTarget = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this.currentDistance = this.distance;
    this._initialized = false;
  }

  // How far back the camera can sit before something (a tree trunk, a pole)
  // comes between it and the player. Solved in 2D — everything here is a
  // vertical cylinder — by finding the nearest hit along the boom.
  clearDistance(px, pz, yaw, want) {
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    let best = want;
    for (const c of this.colliders) {
      // camR, where present, is the canopy width rather than the trunk the
      // player collides with — the lens has to clear the leaves, not the bark
      const r = (c.camR ?? c.r) + 0.4;
      const ox = px - c.x;
      const oz = pz - c.z;
      const b = ox * dx + oz * dz;
      const cc = ox * ox + oz * oz - r * r;
      if (cc < 0) continue; // player is inside it; pushing in would not help
      const disc = b * b - cc;
      if (disc <= 0) continue;
      const t = -b - Math.sqrt(disc); // nearest forward intersection
      if (t > 0 && t < best) best = t;
    }
    return best;
  }

  update(dt, player, input) {
    // follow the player's heading only while they move — standing still
    // leaves the camera where it is, which feels calm
    const speed = player.velocity.length();
    if (speed > 0.6) {
      this.yaw = angleDamp(this.yaw, player.heading, 1.6, dt);
    }

    // pointer parallax (desktop only)
    const px = input.isTouch ? 0 : input.pointerX;
    const py = input.isTouch ? 0 : input.pointerY;
    const yawOffset = -px * 0.28;
    const heightOffset = py * 1.1;

    const p = player.root.position;
    const yaw = this.yaw + yawOffset;

    // pull in fast when something blocks the view, ease back out slowly
    const clear = Math.max(2.2, this.clearDistance(p.x, p.z, yaw, this.distance));
    const k = clear < this.currentDistance ? 18 : 2.5;
    this.currentDistance += (clear - this.currentDistance) * damp(k, dt);

    const desired = new THREE.Vector3(
      p.x - Math.sin(yaw) * this.currentDistance,
      p.y + this.height * (0.55 + 0.45 * (this.currentDistance / this.distance)) + heightOffset,
      p.z - Math.cos(yaw) * this.currentDistance
    );

    // keep the camera above the ground with some clearance
    const groundY = heightAt(desired.x, desired.z);
    desired.y = Math.max(desired.y, groundY + 0.7);

    if (!this._initialized) {
      this.position.copy(desired);
      this.lookTarget.set(p.x, p.y + 1.3, p.z);
      this._initialized = true;
    }

    this.position.lerp(desired, damp(3.2, dt));
    const look = new THREE.Vector3(p.x, p.y + 1.3, p.z);
    this.lookTarget.lerp(look, damp(6, dt));

    this.camera.position.copy(this.position);
    this.camera.lookAt(this.lookTarget);
  }
}
