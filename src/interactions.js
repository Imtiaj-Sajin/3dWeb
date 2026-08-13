// Proximity interaction system: world objects register an anchor + label,
// and a floating HTML prompt appears above the nearest one in range.
// Pressing E (or clicking/tapping the prompt) triggers it.

import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Interactions {
  constructor(camera, el) {
    this.camera = camera;
    this.el = el;
    this.keyEl = el.querySelector('.prompt-key');
    this.labelEl = el.querySelector('.prompt-label');
    this.items = [];
    this.shown = false;
    this.clicked = false;

    const fire = (e) => {
      e.preventDefault();
      e.stopPropagation(); // don't let the touch spawn the walk joystick
      this.clicked = true;
    };
    el.addEventListener('click', fire);
    el.addEventListener('touchstart', fire, { passive: false });
  }

  // anchor: THREE.Vector3 the prompt floats above
  // spot: where the player is placed (rest interactions only)
  add(item) {
    this.items.push(item);
    return item;
  }

  consumeClick() {
    const c = this.clicked;
    this.clicked = false;
    return c;
  }

  // items attached to something that moves (NPCs) refresh their anchor here
  sync() {
    for (const it of this.items) {
      if (!it.follow) continue;
      const p = it.follow.root.position;
      it.anchor.set(p.x, p.y + (it.followHeight ?? 1.85), p.z);
    }
  }

  nearest(pos, maxDist = 3.2) {
    let best = null;
    let bestD = maxDist;
    for (const it of this.items) {
      const d = Math.hypot(it.anchor.x - pos.x, it.anchor.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  show(worldPos, label, keyHint) {
    _v.copy(worldPos).project(this.camera);
    if (_v.z > 1) {
      this.hide();
      return;
    }
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    this.el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    if (this.labelEl.textContent !== label) this.labelEl.textContent = label;
    this.keyEl.style.display = keyHint ? '' : 'none';
    if (!this.shown) {
      this.el.classList.add('show');
      this.shown = true;
    }
  }

  hide() {
    if (this.shown) {
      this.el.classList.remove('show');
      this.shown = false;
    }
  }
}
