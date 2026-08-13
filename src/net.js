// Client end of the multiplayer link.
//
// Optional by design: if no server URL is configured, or the connection
// fails, the game simply runs solo with local bots. The published site must
// never break because a socket server is down.

const RATE_MS = 100; // match the server tick — 10 updates a second

// The hosted room. Free Render instances sleep when idle, so the first
// connection after a quiet spell has to wait for it to wake up.
export const LIVE_SERVER = 'wss://threedwebbackend.onrender.com';
const LOCAL_SERVER_PORT = 8787;

// How long to wait on each candidate before moving on. The last one gets a
// long budget because there is nothing to fall back to, and a sleeping Render
// instance genuinely can take the better part of a minute to answer.
const QUICK_TRY_MS = 6000;
const LAST_TRY_MS = 75000;
const WAKING_AFTER_MS = 2500; // when to admit we are waiting on a cold start

// Servers to try, best first.
export function serverCandidates() {
  // ?server=ws://host:port — point a tab at one specific room, no rebuild
  const override = new URLSearchParams(location.search).get('server');
  if (override) return [override];

  const configured = import.meta.env.VITE_SERVER_URL;
  if (configured) return [configured];

  const list = [LIVE_SERVER];
  // during local dev, fall back to a server running alongside vite
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    list.push(`ws://${location.hostname}:${LOCAL_SERVER_PORT}`);
  }
  return list;
}

export class Net {
  constructor(urls, handlers = {}) {
    this.urls = Array.isArray(urls) ? urls.filter(Boolean) : [urls].filter(Boolean);
    this.h = handlers;
    this.ws = null;
    this.url = null;
    this.connected = false;
    this.you = null;
    this.kicked = false;
    this._lastSent = 0;
    this._last = { x: 1e9, z: 1e9, h: 0, a: -1 };
  }

  connect() {
    this._try(0);
  }

  // Walk the candidate list until one answers. A candidate that fails or goes
  // quiet is abandoned and we move on; once a socket is open we stop trying
  // others, and any later close is a real disconnect rather than a fallback.
  _try(index) {
    if (index >= this.urls.length) {
      this.h.onFail?.();
      return;
    }
    const url = this.urls[index];
    const isLast = index === this.urls.length - 1;
    this.url = url;

    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this._try(index + 1);
      return;
    }
    this.ws = ws;

    let settled = false;
    const giveUp = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(budget);
      clearTimeout(waking);
      try {
        ws.close();
      } catch {
        /* already gone */
      }
      this.h.onGiveUp?.(url, why, isLast);
      this._try(index + 1);
    };

    const budget = setTimeout(
      () => giveUp('timeout'),
      isLast ? LAST_TRY_MS : QUICK_TRY_MS
    );
    // a slow answer usually means a sleeping free instance, not a broken one
    const waking = setTimeout(() => {
      if (!settled) this.h.onWaking?.(url);
    }, WAKING_AFTER_MS);

    this.h.onTrying?.(url, index, this.urls.length);

    ws.onopen = () => {
      settled = true;
      clearTimeout(budget);
      clearTimeout(waking);
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
      // closing before we ever got in means this candidate is no good; after
      // we were in, it is a genuine disconnect
      if (wasConnected) this.h.onClose?.(this.kicked);
      else giveUp('closed');
    };

    ws.onerror = () => {
      if (!this.connected) giveUp('error');
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
