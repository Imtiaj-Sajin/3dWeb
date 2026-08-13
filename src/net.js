// Client end of the multiplayer link.
//
// Optional by design: if no server URL is configured, or the connection
// fails, the game simply runs solo with local bots. The published site must
// never break because a socket server is down.

const RATE_MS = 100; // match the server tick — 10 updates a second

export function serverUrl() {
  // ?server=ws://host:port — point a tab at a different room without a rebuild
  const override = new URLSearchParams(location.search).get('server');
  if (override) return override;

  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) return configured;
  // during local dev, assume the server is running alongside vite
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return `ws://${location.hostname}:8787`;
  }
  return null; // deployed with no server configured -> solo
}

export class Net {
  constructor(url, handlers = {}) {
    this.url = url;
    this.h = handlers;
    this.ws = null;
    this.connected = false;
    this.you = null;
    this.kicked = false;
    this._lastSent = 0;
    this._last = { x: 1e9, z: 1e9, h: 0, a: -1 };
  }

  connect() {
    if (!this.url) return;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.h.onFail?.();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
    };

    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (m.t) {
        case 'welcome':
          this.you = m.you;
          this.h.onWelcome?.(m);
          break;
        case 'join':
          this.h.onJoin?.(m.who);
          break;
        case 'leave':
          this.h.onLeave?.(m.id);
          break;
        case 'snap':
          this.h.onSnapshot?.(m.e);
          break;
        case 'ev':
          this.h.onEvent?.(m.id, m.e);
          break;
        case 'look':
          this.h.onLook?.(m.id, m.look);
          break;
        case 'swing':
          this.h.onSwing?.(m.id, m.kind);
          break;
        case 'hurt':
          this.h.onHurt?.(m.id, m.hp, m.by);
          break;
        case 'died':
          this.h.onDied?.(m.id, m.by);
          break;
        case 'respawn':
          this.h.onRespawn?.(m.id, m.x, m.z, m.hp);
          break;
        case 'board':
          this.h.onBoard?.(m.board);
          break;
        case 'idle':
          this.kicked = 'idle';
          break;
        case 'full':
          this.kicked = 'full';
          break;
      }
    };

    ws.onclose = () => {
      const wasConnected = this.connected;
      this.connected = false;
      if (wasConnected) this.h.onClose?.(this.kicked);
      else this.h.onFail?.();
    };

    ws.onerror = () => {
      if (!this.connected) this.h.onFail?.();
    };
  }

  // Throttled to RATE_MS, and skipped entirely when nothing changed — a
  // player standing still sends nothing, which is also how the server
  // notices they have wandered off to another tab.
  sendState(x, z, h, a, timeMs) {
    if (!this.connected) return;
    if (timeMs - this._lastSent < RATE_MS) return;
    const l = this._last;
    if (Math.abs(x - l.x) < 0.02 && Math.abs(z - l.z) < 0.02 && Math.abs(h - l.h) < 0.02 && a === l.a) {
      return;
    }
    this._lastSent = timeMs;
    this._last = { x, z, h, a };
    this.ws.send(
      JSON.stringify({
        t: 's',
        x: Math.round(x * 100) / 100,
        z: Math.round(z * 100) / 100,
        h: Math.round(h * 100) / 100,
        a,
      })
    );
  }

  sendEvent(e) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ t: 'ev', e }));
  }

  // sent only when you actually change something at the showroom
  sendLook(look) {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ t: 'look', look }));
  }

  // "I swung." The server decides whether that hit anyone.
  sendAttack() {
    if (!this.connected) return;
    this.ws.send(JSON.stringify({ t: 'atk' }));
  }

  // called when the tab is hidden so the server can time the player out
  close() {
    this.ws?.close();
  }
}
