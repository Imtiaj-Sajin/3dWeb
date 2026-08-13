import * as THREE from 'three';
import './style.css';

import { buildTerrain, buildRoadMarkings, heightAt, roadX } from './terrain.js';
import { buildSky, buildClouds, buildBirds } from './sky.js';
import { buildPollen, buildDistantHills } from './atmosphere.js';
import { buildScatter } from './scatter.js';
import { buildProps } from './props.js';
import { buildShowroom, plinthSpots, SHOWROOM_X, SHOWROOM_Z, STATUE_RANGE } from './showroom.js';
import { Input } from './input.js';
import { Interactions } from './interactions.js';
import { CameraRig } from './camera.js';
import {
  loadModel,
  createRig,
  applyLook,
  Player,
  NPC,
  separateCharacters,
} from './characters.js';
import { Net, serverUrl } from './net.js';
import { RemoteCharacter, NameTags } from './remote.js';
import {
  ANIM,
  MODELS,
  TINTS,
  pickLook,
  itemsFor,
  MAX_HEALTH,
  weaponOf,
  inSafeZone,
} from '../shared/world.js';

const FOG_COLOR = '#eeddc0';
const isMobile = window.matchMedia('(pointer: coarse)').matches;

// ---------- renderer / scene ----------

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.75 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// No filmic tone mapping on purpose: these are flat, hand-picked pastel
// colours, and ACES desaturates them into a washed-out grey-green.
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG_COLOR);
scene.fog = new THREE.Fog(FOG_COLOR, 55, 165);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 700);

// ---------- lights ----------

const hemi = new THREE.HemisphereLight('#bfe0f2', '#9aa66f', 0.8);
scene.add(hemi);

const sun = new THREE.DirectionalLight('#fff0d0', 1.75);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(isMobile ? 1024 : 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 140;
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -28;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.5;
scene.add(sun);
scene.add(sun.target);

// ---------- world ----------

const SUN_DIR = new THREE.Vector3(0.55, 0.72, -0.42).normalize();

scene.add(buildTerrain());
scene.add(buildRoadMarkings());
scene.add(buildSky(SUN_DIR));
scene.add(buildDistantHills());

const pollen = buildPollen(isMobile ? 180 : 320);
scene.add(pollen.points);

const clouds = buildClouds();
scene.add(clouds.group);

const props = buildProps();
scene.add(props.group);

const showroom = buildShowroom();
scene.add(showroom.group);

// scatter avoids everything hand-placed, so nothing grows through a plinth
const scatter = buildScatter({
  isMobile,
  avoid: [...props.colliders, ...showroom.colliders],
});
scene.add(scatter.group);

const colliders = [...scatter.colliders, ...props.colliders, ...showroom.colliders];

// built last: the flock steers around whatever is already in the world
const birds = buildBirds({ obstacles: colliders });
scene.add(birds.group);

const interactions = new Interactions(camera, document.getElementById('prompt'));
for (const item of [...props.interactables, ...scatter.interactables]) {
  interactions.add(item);
}


// ---------- characters ----------

const input = new Input();
const rig = new CameraRig(camera, colliders);

let player = null;
const npcs = [];

const overlay = document.getElementById('overlay');
const enterBtn = document.getElementById('enter-btn');
const progressFill = document.getElementById('progress-fill');
const progressTrack = document.getElementById('progress-track');
const hint = document.getElementById('hint');

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => {
  progressFill.style.width = `${Math.round((loaded / total) * 100)}%`;
};

// ---------- multiplayer (optional) ----------

const status = document.getElementById('status');
const nameTags = new NameTags(camera, document.getElementById('tags'));
const remotes = new Map(); // id -> RemoteCharacter
const statues = [];
let net = null;
let playerLook = null;
let soloStarted = false;
let statuesLoaded = false;

// what you are currently wearing/carrying; the showroom edits this
let myLook = { model: MODELS[0], tint: TINTS[0], scale: 1, item: null };

for (const item of showroom.interactables) interactions.add(item);

// debug handle: inspect/teleport from the console, e.g.
//   __wa.interactions.items.map(i => i.label)
// Declared after the state it exposes — a getter cannot rescue a const that
// has not been initialised yet.
window.__wa = {
  THREE,
  interactions,
  scene,
  camera,
  renderer,
  npcs,
  heightAt,
  remotes,
  statues,
  get look() {
    return myLook;
  },
  get net() {
    return net;
  },
  get player() {
    return player;
  },
};

function setStatus(text, kind = '') {
  status.textContent = text;
  status.className = `status ${kind}`.trim();
}

// ---------- health, death and the board ----------

const healthEl = document.getElementById('health');
const healthFill = document.getElementById('health-fill');
const downedEl = document.getElementById('downed');
const boardEl = document.getElementById('board');
const boardList = document.getElementById('board-list');
let myHp = MAX_HEALTH;

function setHealth(hp) {
  myHp = Math.max(0, Math.min(MAX_HEALTH, hp));
  const pct = (myHp / MAX_HEALTH) * 100;
  healthFill.style.width = `${pct}%`;
  healthFill.classList.toggle('low', pct <= 35);
  healthEl.classList.toggle('hidden', !net?.connected);
}

function renderBoard(rows) {
  const myId = net?.you?.id;
  boardList.innerHTML = '';
  for (const r of rows) {
    const li = document.createElement('li');
    if (r.id === myId) li.className = 'me';
    else if (r.bot) li.className = 'bot';
    const who = document.createElement('span');
    who.textContent = r.name;
    const sc = document.createElement('span');
    sc.className = 'sc';
    sc.textContent = String(r.score);
    sc.title = `${r.waveGot} waves received · ${r.waveGave} given · ${r.kills} kills · ${r.deaths} deaths`;
    li.append(who, sc);
    boardList.appendChild(li);
  }
  boardEl.classList.toggle('hidden', rows.length === 0);
}

// roster is the synchronous truth of who should exist. A model may still be
// downloading when someone leaves, so every async step re-checks it.
const roster = new Map(); // id -> info

function addRemote(info) {
  if (roster.has(info.id)) return;
  roster.set(info.id, info);

  loadModel(info.model)
    .then((gltf) => {
      if (roster.get(info.id) !== info) return; // left while their model loaded
      const rc = new RemoteCharacter(createRig(gltf), info);
      remotes.set(info.id, rc);
      scene.add(rc.root);
      nameTags.add(info.id, info.name, info.bot);
      interactions.add({
        kind: 'greet',
        label: 'say hi',
        anchor: new THREE.Vector3(),
        follow: rc,
        remote: rc,
        id: info.id,
      });
    })
    .catch((err) => console.error(`could not load model ${info.model}:`, err));
}

// Give the local player the look the server handed out, so the character you
// see is the character everyone else sees. Swaps the whole rig when the model
// differs, keeping wherever you were standing.
// Apply a change to your own appearance and tell everyone about it.
function changeMyLook(patch) {
  const next = { ...myLook, ...patch };
  // a character can only hold its own gear
  if (patch.model && !itemsFor(next.model).some((i) => i.node === next.item)) {
    next.item = null;
  }
  setPlayerLook(next);
  net?.sendLook(next);
}

// Statues are what make the remaining models download, so they wait until
// somebody is actually close enough to look at them.
function loadStatues() {
  if (statuesLoaded) return;
  statuesLoaded = true;
  for (const spot of plinthSpots()) {
    loadModel(spot.model)
      .then((gltf) => {
        const rig = createRig(gltf);
        rig.root.position.set(spot.x, spot.y + 0.52, spot.z);
        rig.root.rotation.y = spot.facing;
        rig.actions.Idle?.play(); // one clip, no mixer ticks needed after this
        rig.mixer.update(0.4);
        scene.add(rig.root);
        statues.push(rig);
      })
      .catch((err) => console.error(`statue ${spot.model} failed:`, err));
  }
}

function setPlayerLook(look) {
  if (!look) return;
  playerLook = look;
  myLook = { ...myLook, ...look };

  loadModel(look.model)
    .then((gltf) => {
      if (playerLook !== look || !player) return; // reassigned mid-download
      const rig = createRig(gltf);
      applyLook(rig.root, look);

      const old = player.root;
      rig.root.position.copy(old.position);
      rig.root.rotation.copy(old.rotation);
      scene.remove(old);
      player.mixer.stopAllAction();

      player.root = rig.root;
      player.mixer = rig.mixer;
      player.actions = rig.actions;
      player.current = null;
      player._started = new Set(); // fresh rig, nothing started on it yet
      player.play('Idle', 0);
      scene.add(rig.root);
    })
    .catch((err) => console.error(`could not load model ${look.model}:`, err));
}

function removeRemote(id) {
  roster.delete(id);
  const rc = remotes.get(id);
  if (!rc) return;
  rc.dispose(scene);
  remotes.delete(id);
  nameTags.remove(id);
  interactions.items = interactions.items.filter((it) => it.id !== id);
}

function playSolo(reason) {
  // No server, or it went away: keep the world alive with local bots so the
  // published site is never broken by a socket being down.
  if (reason) setStatus(reason, 'warn');
  if (npcs.length || soloStarted) return;
  soloStarted = true;

  ['Knight', 'Barbarian', 'Mage'].forEach((model, i) => {
    loadModel(model)
      .then((gltf) => {
        if (net?.connected) return; // server turned up first; it owns the crowd
        const npc = new NPC(createRig(gltf), i * 7 + 3);
        applyLook(npc.root, pickLook());
        npcs.push(npc);
        scene.add(npc.root);
        interactions.add({
          kind: 'greet',
          label: 'say hi',
          anchor: new THREE.Vector3(),
          follow: npc,
          npc,
        });
      })
      .catch((err) => console.error(`could not load model ${model}:`, err));
  });
}

function connectOrPlaySolo() {
  // Offline you still get a look of your own, just a locally chosen one.
  setPlayerLook(pickLook());

  const url = serverUrl();
  if (!url) {
    playSolo('');
    return;
  }

  net = new Net(url, {
    onWelcome: (m) => {
      // hand over from local bots to the shared world
      for (const npc of npcs) scene.remove(npc.root);
      npcs.length = 0;
      soloStarted = false;
      interactions.items = interactions.items.filter((it) => !it.npc);
      player.root.position.set(m.spawn.x, heightAt(m.spawn.x, m.spawn.z), m.spawn.z);
      setPlayerLook(m.you);
      setHealth(m.hp ?? MAX_HEALTH);
      for (const who of m.others) addRemote(who);
      setStatus(`you are ${m.you.name}`, 'live');
    },
    onJoin: (who) => {
      addRemote(who);
      setStatus(`${who.name} joined`, 'live');
    },
    onLeave: (id) => {
      const name = remotes.get(id)?.name;
      removeRemote(id);
      if (name) setStatus(`${name} left`, 'live');
    },
    onSnapshot: (list) => {
      for (const [id, x, z, h, a] of list) remotes.get(id)?.applySnapshot(x, z, h, a);
    },
    onEvent: (id, e) => remotes.get(id)?.playEvent(e),
    onSwing: (id) => {
      const info = roster.get(id);
      remotes.get(id)?.playSwing(info?.item ?? null);
    },
    onHurt: (id, hp) => {
      if (id === net?.you?.id) {
        setHealth(hp);
        player.takeHit();
      } else {
        remotes.get(id)?.playHurt();
      }
    },
    onDied: (id) => {
      if (id === net?.you?.id) {
        setHealth(0);
        player.die();
        downedEl.classList.remove('hidden');
      } else {
        remotes.get(id)?.playDeath();
      }
    },
    onRespawn: (id, x, z, hp) => {
      if (id === net?.you?.id) {
        player.root.position.set(x, heightAt(x, z), z);
        player.velocity.set(0, 0);
        player.revive();
        setHealth(hp);
        downedEl.classList.add('hidden');
      } else {
        remotes.get(id)?.reviveAt(x, z);
      }
    },
    onBoard: renderBoard,
    onLook: (id, look) => {
      const info = roster.get(id);
      if (!info) return;
      Object.assign(info, look);
      const rc = remotes.get(id);
      if (!rc) return; // still downloading; it will be built with the new look
      loadModel(look.model)
        .then((gltf) => {
          if (roster.get(id) !== info || remotes.get(id) !== rc) return;
          const oldRoot = rc.swapRig(createRig(gltf), info);
          scene.remove(oldRoot);
          scene.add(rc.root);
        })
        .catch((err) => console.error(`could not load model ${look.model}:`, err));
    },
    onFail: () => playSolo(''),
    onClose: (kicked) => {
      for (const id of [...remotes.keys()]) removeRemote(id);
      nameTags.clear();
      healthEl.classList.add('hidden');
      boardEl.classList.add('hidden');
      downedEl.classList.add('hidden');
      playSolo(kicked === 'idle' ? 'you drifted off — reload to rejoin' : 'offline');
    },
  });
  net.connect();
  // if the server never answers, fall back so the loading state never sticks
  setTimeout(() => {
    if (!net.connected) playSolo('');
  }, 4000);
}

// a hidden tab stops sending, which is how the server notices you left
document.addEventListener('visibilitychange', () => {
  if (document.hidden) input.keys.clear();
});

// which single integer describes what the player is doing right now
function animCode(p) {
  if (p.mode === 'resting' || p.mode === 'entering' || p.mode === 'leaving') {
    const enter = p.rest?.clips?.enter ?? '';
    if (enter.startsWith('Lie')) return ANIM.LIE;
    if (enter.startsWith('Sit_Floor')) return ANIM.SIT_FLOOR;
    return ANIM.SIT_CHAIR;
  }
  if (p.mode === 'emote') return ANIM.WAVE;
  if (p.mode === 'interacting') return ANIM.INTERACT;
  if (!p.grounded) return ANIM.JUMP;
  const speed = p.velocity.length();
  if (speed > 3.2) return ANIM.RUN;
  if (speed > 0.3) return ANIM.WALK;
  return ANIM.IDLE;
}

// Only the starting model blocks the loading screen. Everything else is
// fetched the moment somebody actually shows up wearing it.
loadModel(MODELS[0], manager)
  .then((rogue) => {
    player = new Player(createRig(rogue));
    // debug spawn override: ?z=-50 (x defaults to the road at that z)
    const params = new URLSearchParams(location.search);
    if (params.has('z') || params.has('x')) {
      const z = parseFloat(params.get('z') ?? '30');
      const x = params.has('x') ? parseFloat(params.get('x')) : roadX(z);
      player.root.position.set(x, heightAt(x, z), z);
    }
    scene.add(player.root);
    connectOrPlaySolo();

    progressFill.style.width = '100%';
    enterBtn.disabled = false;
    enterBtn.textContent = 'take a walk';
    enterBtn.classList.add('ready');
    progressTrack.style.opacity = '0';
  })
  .catch((err) => {
    console.error('Character loading failed:', err);
    enterBtn.textContent = 'could not load characters — check console';
  });

enterBtn.addEventListener('click', () => {
  overlay.classList.add('fade-out');
  input.enable();
  hint.textContent = input.isTouch
    ? 'drag to walk · 👋 wave · ⚔️ attack'
    : 'WASD move · shift run · space jump · E interact · Q wave · F or click to attack';
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 7000);
});

// ---------- resize ----------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- loop ----------

const clock = new THREE.Clock();
const _promptAnchor = new THREE.Vector3();
let elapsed = 0;

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  input.update();
  scatter.timeUniform.value = elapsed;
  clouds.update(dt);
  birds.update(dt, elapsed);
  pollen.update(dt, elapsed, player ? player.root.position : camera.position);

  if (player) {
    player.update(dt, input, rig.yaw, colliders);

    // proximity prompt + contextual action (E key, or click/tap the prompt)
    const pressed = input.consumeAction() || interactions.consumeClick();
    interactions.sync(); // NPC prompts follow them around
    if (!input.enabled) {
      interactions.hide(); // still on the title screen
    } else if (player.isResting) {
      _promptAnchor.copy(player.root.position).y += 1.5;
      interactions.show(_promptAnchor, 'stand up', !input.isTouch);
      if (pressed) player.standUp();
    } else if (player.busy) {
      interactions.hide();
    } else {
      const near = interactions.nearest(player.root.position);
      if (near) {
        // the gear rack names whatever you would pick up next
        let label = near.label;
        if (near.kind === 'item') {
          const list = itemsFor(myLook.model);
          const at = list.findIndex((i) => i.node === myLook.item);
          const next = list[at + 1] ?? null;
          label = next ? `pick up the ${next.label}` : 'put it down';
        }
        interactions.show(near.anchor, label, !input.isTouch);
        if (pressed) {
          if (near.kind === 'wear') {
            changeMyLook(near.look);
            player.interact(near);
          } else if (near.kind === 'item') {
            // cycle: nothing -> first item -> ... -> nothing
            const list = itemsFor(myLook.model);
            const at = list.findIndex((i) => i.node === myLook.item);
            const next = list[at + 1] ?? null;
            changeMyLook({ item: next ? next.node : null });
            player.interact(near);
          } else if (near.kind === 'rest') {
            player.beginRest(near);
          } else if (near.kind === 'greet') {
            player.wave();
            // local bot: answer here. Networked: the server decides, so that
            // everyone sees the same reply.
            near.npc?.reactWave(player.root.position, 0.25);
          } else {
            player.interact(near);
          }
        }
      } else {
        interactions.hide();
        if (pressed) player.wave(); // nothing nearby — E just waves
      }
    }
    if (input.consumeWave()) player.wave(); // touch 👋 button always waves

    // swinging: played locally straight away so it feels instant, while the
    // server independently decides whether it actually connected
    if (input.consumeAttack() && !player.busy) {
      const w = weaponOf(myLook.item);
      if (w.damage > 0 && !inSafeZone(player.root.position.x, player.root.position.z)) {
        if (player.swing(myLook.item)) net?.sendAttack();
      } else {
        setStatus(
          w.damage > 0 ? 'no fighting at the exhibition' : 'nothing to fight with',
          'warn'
        );
      }
    }

    if (player.justWaved) {
      // nearby NPCs pause, turn, and wave back after a beat
      for (const npc of npcs) {
        if (npc.root.position.distanceTo(player.root.position) < 10) {
          npc.reactWave(player.root.position, 0.35 + Math.random() * 0.5);
        }
      }
      net?.sendEvent('wave');
    }
    for (const npc of npcs) npc.update(dt, colliders);
    for (const rc of remotes.values()) rc.update(dt);

    // keep bodies out of each other before the camera reads the final pose
    separateCharacters([player, ...npcs, ...remotes.values()], colliders);
    nameTags.update(remotes.values());
    rig.update(dt, player, input);

    // approaching the exhibition is what pulls the remaining models down
    if (!statuesLoaded) {
      const p = player.root.position;
      if (Math.hypot(p.x - SHOWROOM_X, p.z - SHOWROOM_Z) < STATUE_RANGE) loadStatues();
    }

    if (net) {
      const p = player.root.position;
      net.sendState(p.x, p.z, player.heading, animCode(player), performance.now());
    }

    // keep the shadow frustum centered on the player
    sun.position.copy(player.root.position).addScaledVector(SUN_DIR, 70);
    sun.target.position.copy(player.root.position);
  } else {
    // idle establishing shot while loading: drift over the road crest
    const t = elapsed * 0.05;
    camera.position.set(Math.sin(t) * 4, heightAt(0, 20) + 4.5, 24 + Math.cos(t * 0.7));
    camera.lookAt(0, heightAt(0, -20) + 2, -30);
  }

  renderer.render(scene, camera);
});
