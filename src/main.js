import * as THREE from 'three';
import './style.css';

import { buildTerrain, buildRoadMarkings, heightAt, roadX } from './terrain.js';
import { buildSky, buildClouds, buildBirds } from './sky.js';
import { buildPollen, buildDistantHills } from './atmosphere.js';
import { buildScatter } from './scatter.js';
import { buildProps } from './props.js';
import { Input } from './input.js';
import { Interactions } from './interactions.js';
import { CameraRig } from './camera.js';
import { loadCharacterGLBs, createRig, Player, NPC, separateCharacters } from './characters.js';
import { Net, serverUrl } from './net.js';
import { RemoteCharacter, NameTags } from './remote.js';
import { ANIM, MODELS } from '../shared/world.js';

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

const scatter = buildScatter({ isMobile, avoid: props.colliders });
scene.add(scatter.group);

const colliders = [...scatter.colliders, ...props.colliders];

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
let gltfByModel = null;
let net = null;

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

function addRemote(info) {
  if (remotes.has(info.id) || !gltfByModel) return;
  const gltf = gltfByModel[info.model] ?? gltfByModel[MODELS[0]];
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
}

function removeRemote(id) {
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
  if (npcs.length || !gltfByModel) return;
  const sources = [gltfByModel.Knight, gltfByModel.Barbarian, gltfByModel.Rogue];
  sources.forEach((gltf, i) => {
    const npc = new NPC(createRig(gltf), i * 7 + 3);
    npcs.push(npc);
    scene.add(npc.root);
    interactions.add({
      kind: 'greet',
      label: 'say hi',
      anchor: new THREE.Vector3(),
      follow: npc,
      npc,
    });
  });
  if (reason) setStatus(reason, 'warn');
}

function connectOrPlaySolo() {
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
      interactions.items = interactions.items.filter((it) => !it.npc);
      player.root.position.set(m.spawn.x, heightAt(m.spawn.x, m.spawn.z), m.spawn.z);
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
    onFail: () => playSolo(''),
    onClose: (kicked) => {
      for (const id of [...remotes.keys()]) removeRemote(id);
      nameTags.clear();
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

loadCharacterGLBs(manager, ['Rogue', 'Knight', 'Barbarian'])
  .then(([rogue, knight, barbarian]) => {
    player = new Player(createRig(rogue));
    // debug spawn override: ?z=-50 (x defaults to the road at that z)
    const params = new URLSearchParams(location.search);
    if (params.has('z') || params.has('x')) {
      const z = parseFloat(params.get('z') ?? '30');
      const x = params.has('x') ? parseFloat(params.get('x')) : roadX(z);
      player.root.position.set(x, heightAt(x, z), z);
    }
    scene.add(player.root);

    gltfByModel = { Rogue: rogue, Knight: knight, Barbarian: barbarian };
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
    ? 'drag anywhere to walk · 👋 to wave'
    : 'WASD move · shift run · space jump · E interact · Q wave';
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
        interactions.show(near.anchor, near.label, !input.isTouch);
        if (pressed) {
          if (near.kind === 'rest') {
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
