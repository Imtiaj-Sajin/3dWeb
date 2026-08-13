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
import { loadCharacterGLBs, createRig, Player, NPC } from './characters.js';

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

// debug handle: inspect/teleport from the console, e.g.
//   __wa.interactions.items.map(i => i.label)
window.__wa = {
  THREE,
  interactions,
  scene,
  camera,
  renderer,
  npcs,
  heightAt,
  get player() {
    return player;
  },
};

const overlay = document.getElementById('overlay');
const enterBtn = document.getElementById('enter-btn');
const progressFill = document.getElementById('progress-fill');
const progressTrack = document.getElementById('progress-track');
const hint = document.getElementById('hint');

const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => {
  progressFill.style.width = `${Math.round((loaded / total) * 100)}%`;
};

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

    const npcSources = [knight, barbarian, rogue];
    npcSources.forEach((gltf, i) => {
      const npc = new NPC(createRig(gltf), i * 7 + 3);
      npcs.push(npc);
      scene.add(npc.root);
      interactions.add({
        kind: 'greet',
        label: 'say hi',
        anchor: new THREE.Vector3(),
        follow: npc, // the prompt tracks them as they wander
        npc,
      });
    });

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
            // the one you greeted answers promptly; the loop below catches
            // any other bystanders, who reply a beat later
            near.npc.reactWave(player.root.position, 0.25);
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
    }
    for (const npc of npcs) npc.update(dt, colliders);
    rig.update(dt, player, input);

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
