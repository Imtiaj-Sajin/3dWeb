// Unified input: WASD/arrows + shift + space on desktop, a floating
// joystick on touch. Also tracks normalized pointer position for the
// camera's parallax tilt.

export class Input {
  constructor() {
    this.keys = new Set();
    this.moveX = 0; // -1..1, screen-relative (right positive)
    this.moveY = 0; // -1..1, forward positive
    this.magnitude = 0;
    this.running = false;
    this.jumpQueued = false;
    this.pointerX = 0; // -1..1
    this.pointerY = 0;
    this.isTouch = window.matchMedia('(pointer: coarse)').matches;
    this.enabled = false;

    this._joyActive = false;
    this._joyId = null;
    this._joyOrigin = { x: 0, y: 0 };

    this._bindKeyboard();
    this._bindPointer();
    if (this.isTouch) this._buildJoystick();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this.jumpQueued = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _bindPointer() {
    window.addEventListener('mousemove', (e) => {
      this.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointerY = (e.clientY / window.innerHeight) * 2 - 1;
    });
  }

  _buildJoystick() {
    const base = document.createElement('div');
    base.className = 'joystick-base';
    base.style.display = 'none';
    const thumb = document.createElement('div');
    thumb.className = 'joystick-thumb';
    thumb.style.display = 'none';
    document.body.append(base, thumb);
    this._joyBase = base;
    this._joyThumb = thumb;

    const RADIUS = 55;

    window.addEventListener('touchstart', (e) => {
      if (!this.enabled || this._joyActive) return;
      const t = e.changedTouches[0];
      this._joyActive = true;
      this._joyId = t.identifier;
      this._joyOrigin = { x: t.clientX, y: t.clientY };
      base.style.display = thumb.style.display = 'block';
      base.style.left = thumb.style.left = `${t.clientX}px`;
      base.style.top = thumb.style.top = `${t.clientY}px`;
    });

    window.addEventListener('touchmove', (e) => {
      if (!this._joyActive) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this._joyId) continue;
        let dx = t.clientX - this._joyOrigin.x;
        let dy = t.clientY - this._joyOrigin.y;
        const len = Math.hypot(dx, dy);
        const clamped = Math.min(len, RADIUS);
        if (len > 0) {
          dx = (dx / len) * clamped;
          dy = (dy / len) * clamped;
        }
        thumb.style.left = `${this._joyOrigin.x + dx}px`;
        thumb.style.top = `${this._joyOrigin.y + dy}px`;
        this._joyVec = { x: dx / RADIUS, y: -dy / RADIUS };
      }
    });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this._joyId) continue;
        this._joyActive = false;
        this._joyVec = { x: 0, y: 0 };
        base.style.display = thumb.style.display = 'none';
      }
    };
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    this._joyVec = { x: 0, y: 0 };
  }

  consumeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  update() {
    if (!this.enabled) {
      this.moveX = this.moveY = this.magnitude = 0;
      this.jumpQueued = false;
      return;
    }

    if (this.isTouch && this._joyActive) {
      this.moveX = this._joyVec.x;
      this.moveY = this._joyVec.y;
      this.magnitude = Math.min(1, Math.hypot(this.moveX, this.moveY));
      this.running = this.magnitude > 0.85;
      return;
    }

    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, y);
    this.moveX = len > 0 ? x / len : 0;
    this.moveY = len > 0 ? y / len : 0;
    this.magnitude = len > 0 ? 1 : 0;
    this.running = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }
}
