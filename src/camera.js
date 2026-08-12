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
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI; // looking down the road at start
    this.distance = 7.6;
    this.height = 3.1;
    this.lookTarget = new THREE.Vector3();
    this.position = new THREE.Vector3();
    this._initialized = false;
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

    const desired = new THREE.Vector3(
      p.x - Math.sin(yaw) * this.distance,
      p.y + this.height + heightOffset,
      p.z - Math.cos(yaw) * this.distance
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
