// Warm Afternoon multiplayer server.
//
// Deliberately tiny: one room, everything in memory, nothing persisted. When
// a player leaves they are gone; there is nothing to recover and nothing to
// clean up. Restarting the process resets the world to just its bots.
//
//   node server/index.js
//
// Behind TLS in production (browsers refuse ws:// from an https:// page), so
// put Caddy or nginx in front and proxy wss:// to this port.

import { WebSocketServer } from 'ws';
import {
  roadX,
  BOT_LANE,
  ROAD_Z_MIN,
  ROAD_Z_MAX,
  ANIM,
  MODELS,
  pickLook,
  makeName,
} from '../shared/world.js';

const PORT = Number(process.env.PORT) || 8787;
const TICK_MS = 100; // 10 snapshots a second; clients smooth between them
const IDLE_MS = Number(process.env.IDLE_MS) || 7 * 60 * 1000;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 20;
const BOT_COUNT = Number(process.env.BOT_COUNT) || 3;

// ---------- state ----------

let nextId = 1;
const players = new Map(); // id -> player
const bots = [];

const now = () => Date.now();
const rand = (a, b) => a + Math.random() * (b - a);

function takenNames() {
  const s = new Set(bots.map((b) => b.name));
  for (const p of players.values()) s.add(p.name);
  return s;
}

function uniqueName() {
  const taken = takenNames();
  for (let i = 0; i < 40; i++) {
    const n = makeName();
    if (!taken.has(n)) return n;
  }
  return `Guest${Math.floor(Math.random() * 9000) + 1000}`;
}

// ---------- bots ----------
//
// Bots live on the server so that everyone sees them in the same place. They
// only ever walk the road lane, which is guaranteed clear of trees, so the
// server never needs to know where any scenery is.

function spawnBot(i) {
  const z = rand(ROAD_Z_MIN, ROAD_Z_MAX);
  const bot = {
    id: -(i + 1),
    bot: true,
    name: uniqueName(),
    ...pickLook(),
    model: MODELS[i % MODELS.length], // one of each, so the bots never twin
    x: roadX(z) + rand(-BOT_LANE, BOT_LANE),
    z,
    h: Math.PI,
    a: ANIM.IDLE,
    state: 'idle',
    timer: rand(1, 4),
    tx: 0,
    tz: 0,
    speed: rand(1.3, 1.7),
  };
  bots.push(bot);
}

function botPickTarget(b) {
  b.tz = Math.max(ROAD_Z_MIN, Math.min(ROAD_Z_MAX, b.z + rand(-40, 40)));
  b.tx = roadX(b.tz) + rand(-BOT_LANE, BOT_LANE);
}

function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function updateBot(b, dt) {
  if (b.state === 'greet') {
    b.timer -= dt;
    b.a = ANIM.WAVE;
    if (b.timer <= 0) {
      b.state = 'idle';
      b.timer = rand(1, 3);
    }
    return;
  }

  if (b.state === 'idle') {
    b.timer -= dt;
    b.a = ANIM.IDLE;
    if (b.timer <= 0) {
      botPickTarget(b);
      b.state = 'walk';
    }
    return;
  }

  const dx = b.tx - b.x;
  const dz = b.tz - b.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1) {
    b.state = 'idle';
    b.timer = rand(2, 6);
    b.a = ANIM.IDLE;
    return;
  }
  b.h = angleLerp(b.h, Math.atan2(dx, dz), Math.min(1, dt * 4));
  b.x += Math.sin(b.h) * b.speed * dt;
  b.z += Math.cos(b.h) * b.speed * dt;
  b.a = ANIM.WALK;
}

for (let i = 0; i < BOT_COUNT; i++) spawnBot(i);

// ---------- wire format ----------

const meta = (e) => ({
  id: e.id,
  name: e.name,
  model: e.model,
  tint: e.tint,
  scale: e.scale,
  bot: !!e.bot,
});
const send = (ws, msg) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
};

function broadcast(msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(raw);
  }
}

// ---------- connections ----------

const wss = new WebSocketServer({ port: PORT });
console.log(`warm-afternoon server listening on :${PORT} (${BOT_COUNT} bots)`);

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { t: 'full' });
    ws.close(4001, 'room full');
    return;
  }

  const id = nextId++;
  const spawnZ = rand(10, 40);
  const player = {
    id,
    ws,
    name: uniqueName(),
    ...pickLook(),
    x: roadX(spawnZ),
    z: spawnZ,
    h: Math.PI,
    a: ANIM.IDLE,
    lastActive: now(),
    alive: true,
  };
  players.set(id, player);

  send(ws, {
    t: 'welcome',
    you: meta(player),
    spawn: { x: player.x, z: player.z },
    others: [...bots, ...[...players.values()].filter((p) => p.id !== id)].map(meta),
  });
  broadcast({ t: 'join', who: meta(player) }, id);
  console.log(`+ ${player.name} (${players.size} online)`);

  ws.on('message', (buf) => {
    let m;
    try {
      m = JSON.parse(buf);
    } catch {
      return;
    }

    if (m.t === 's') {
      // Only real movement counts as activity. A player parked on a
      // background tab keeps sending nothing at all, and times out.
      const moved = Math.abs(m.x - player.x) > 0.05 || Math.abs(m.z - player.z) > 0.05;
      player.x = m.x;
      player.z = m.z;
      player.h = m.h;
      player.a = m.a;
      if (moved) player.lastActive = now();
    } else if (m.t === 'ev') {
      player.lastActive = now();
      broadcast({ t: 'ev', id, e: m.e }, id);
      // bots near a wave turn and wave back
      if (m.e === 'wave') {
        for (const b of bots) {
          if (b.state === 'greet') continue;
          if (Math.hypot(b.x - player.x, b.z - player.z) < 10) {
            b.state = 'greet';
            b.timer = 1.6;
            b.h = Math.atan2(player.x - b.x, player.z - b.z);
          }
        }
      }
    }
  });

  ws.on('pong', () => {
    player.alive = true;
  });

  const drop = (reason) => {
    if (!players.has(id)) return;
    players.delete(id);
    broadcast({ t: 'leave', id });
    console.log(`- ${player.name} (${reason}) (${players.size} online)`);
  };

  ws.on('close', () => drop('left'));
  ws.on('error', () => drop('error'));
  ws.__drop = drop;
});

// ---------- ticks ----------

let last = now();
setInterval(() => {
  const t = now();
  const dt = Math.min((t - last) / 1000, 0.25);
  last = t;

  for (const b of bots) updateBot(b, dt);

  const round = (n) => Math.round(n * 100) / 100;
  const entities = [];
  for (const e of [...bots, ...players.values()]) {
    entities.push([e.id, round(e.x), round(e.z), round(e.h), e.a]);
  }
  broadcast({ t: 'snap', e: entities });

  // kick the idle: they are on another tab and not coming back
  for (const p of [...players.values()]) {
    if (t - p.lastActive > IDLE_MS) {
      send(p.ws, { t: 'idle' });
      p.ws.close(4002, 'idle');
      p.ws.__drop?.('idle');
    }
  }
}, TICK_MS);

// drop half-open sockets (laptop lid closed, network gone)
setInterval(() => {
  for (const p of [...players.values()]) {
    if (!p.alive) {
      p.ws.terminate();
      p.ws.__drop?.('timeout');
      continue;
    }
    p.alive = false;
    if (p.ws.readyState === 1) p.ws.ping();
  }
}, 30000);
