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
  TINTS,
  SCALES,
  pickLook,
  itemsFor,
  makeName,
  MAX_HEALTH,
  RESPAWN_MS,
  WAVE_RANGE,
  ATTACK_ARC,
  ARMED_ITEMS,
  weaponOf,
  isProtected,
  scoreOf,
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
const round2 = (n) => Math.round(n * 100) / 100;

const freshStats = () => ({ kills: 0, deaths: 0, waveGave: 0, waveGot: 0 });

// hand someone a weapon their own character can actually hold
function randomWeaponFor(model) {
  const usable = itemsFor(model)
    .map((i) => i.node)
    .filter((n) => ARMED_ITEMS.includes(n));
  return usable.length ? usable[Math.floor(Math.random() * usable.length)] : null;
}

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
    hp: MAX_HEALTH,
    dead: false,
    respawnAt: 0,
    stats: freshStats(),
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
  // bots carry gear and can be fought, but never start a fight themselves
  bot.item = randomWeaponFor(bot.model);
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
  item: e.item ?? null,
  bot: !!e.bot,
});


// The showroom is free but the server still validates: a client may only ask
// for a model, tint and item that actually exist, and an item its own
// character can hold.
function sanitizeLook(look, current) {
  if (!look || typeof look !== 'object') return null;
  const out = {};
  if (MODELS.includes(look.model)) out.model = look.model;
  if (TINTS.includes(look.tint)) out.tint = look.tint;
  if (SCALES.includes(look.scale)) out.scale = look.scale;

  const model = out.model ?? current.model;
  if (look.item === null) out.item = null;
  else if (itemsFor(model).some((i) => i.node === look.item)) out.item = look.item;

  // changing character drops anything the new one cannot hold
  if (out.model && out.item === undefined) {
    const stillValid = itemsFor(out.model).some((i) => i.node === current.item);
    if (!stillValid) out.item = null;
  }
  return Object.keys(out).length ? out : null;
}
const send = (ws, msg) => {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
};

function broadcast(msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(raw);
  }
}

// ---------- combat ----------
//
// The client only ever says "I swung". Everything that decides whether that
// hurt anybody — cooldown, reach, facing, who is protected — happens here,
// because a browser will happily claim whatever it likes.

function resolveAttack(attacker) {
  const t = now();
  if (attacker.dead) return;

  const w = weaponOf(attacker.item);
  if (w.damage <= 0) return; // shields and mugs swing at nothing
  if (t - attacker.lastSwing < w.cooldown * 1000) return;
  attacker.lastSwing = t;
  attacker.lastActive = t;

  // the swing itself is always shown, hit or miss
  broadcast({ t: 'swing', id: attacker.id, kind: w.kind });

  if (isProtected(attacker)) return; // no swinging out from safety

  // nearest valid target within reach and roughly in front
  let best = null;
  let bestD = Infinity;
  for (const target of [...players.values(), ...bots]) {
    if (target === attacker || target.dead) continue;
    if (isProtected(target)) continue;

    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const d = Math.hypot(dx, dz);
    if (d > w.reach || d >= bestD) continue;

    // heading is the direction the attacker faces; compare with the bearing
    // to the target and require it inside the arc
    let off = Math.atan2(dx, dz) - attacker.h;
    while (off > Math.PI) off -= Math.PI * 2;
    while (off < -Math.PI) off += Math.PI * 2;
    if (Math.abs(off) > ATTACK_ARC) continue;

    best = target;
    bestD = d;
  }
  if (!best) return;

  const soak = weaponOf(best.item).block ?? 0;
  const dealt = Math.max(1, Math.round(w.damage * (1 - soak)));
  best.hp = (best.hp ?? MAX_HEALTH) - dealt;
  broadcast({ t: 'hurt', id: best.id, by: attacker.id, hp: Math.max(0, best.hp) });

  if (best.hp > 0) return;

  best.dead = true;
  best.hp = 0;
  best.respawnAt = t + RESPAWN_MS;
  best.stats ??= freshStats();
  best.stats.deaths++;
  attacker.stats.kills++;
  if (best.bot) {
    best.state = 'idle';
    best.timer = RESPAWN_MS / 1000;
  }
  broadcast({ t: 'died', id: best.id, by: attacker.id });
}

function respawn(e) {
  const z = rand(ROAD_Z_MIN, ROAD_Z_MAX);
  e.x = roadX(z) + rand(-BOT_LANE, BOT_LANE);
  e.z = z;
  e.hp = MAX_HEALTH;
  e.dead = false;
  broadcast({ t: 'respawn', id: e.id, x: round2(e.x), z: round2(e.z), hp: e.hp });
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
    hp: MAX_HEALTH,
    dead: false,
    respawnAt: 0,
    lastSwing: 0,
    stats: freshStats(),
    x: roadX(spawnZ),
    z: spawnZ,
    h: Math.PI,
    a: ANIM.IDLE,
    lastActive: now(),
    alive: true,
  };
  player.item = randomWeaponFor(player.model); // arrive already carrying something
  players.set(id, player);

  send(ws, {
    t: 'welcome',
    you: meta(player),
    spawn: { x: player.x, z: player.z },
    hp: player.hp,
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
    } else if (m.t === 'atk') {
      resolveAttack(player);
    } else if (m.t === 'look') {
      const look = sanitizeLook(m.look, player);
      if (!look) return;
      Object.assign(player, look);
      player.lastActive = now();
      broadcast({ t: 'look', id, look: meta(player) });
    } else if (m.t === 'ev') {
      player.lastActive = now();
      broadcast({ t: 'ev', id, e: m.e }, id);
      if (m.e === 'wave') {
        player.stats.waveGave++;
        // bots near a wave turn and wave back
        for (const b of bots) {
          if (b.state === 'greet' || b.dead) continue;
          if (Math.hypot(b.x - player.x, b.z - player.z) < WAVE_RANGE) {
            b.state = 'greet';
            b.timer = 1.6;
            b.h = Math.atan2(player.x - b.x, player.z - b.z);
          }
        }
        // everyone within earshot was waved at
        for (const other of players.values()) {
          if (other === player || other.dead) continue;
          if (Math.hypot(other.x - player.x, other.z - player.z) < WAVE_RANGE) {
            other.stats.waveGot++;
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
let lastBoard = 0;
setInterval(() => {
  const t = now();
  const dt = Math.min((t - last) / 1000, 0.25);
  last = t;

  for (const e of [...bots, ...players.values()]) {
    if (e.dead && t >= e.respawnAt) respawn(e);
  }
  for (const b of bots) if (!b.dead) updateBot(b, dt);

  const entities = [];
  for (const e of [...bots, ...players.values()]) {
    entities.push([e.id, round2(e.x), round2(e.z), round2(e.h), e.a]);
  }
  broadcast({ t: 'snap', e: entities });

  // the board, a couple of times a second
  if (t - lastBoard > 1500) {
    lastBoard = t;
    const board = [...players.values(), ...bots]
      .map((e) => ({
        id: e.id,
        name: e.name,
        bot: !!e.bot,
        ...(e.stats ?? freshStats()),
        score: Math.round(scoreOf(e.stats ?? {}) * 10) / 10,
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 12);
    broadcast({ t: 'board', board });
  }

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
