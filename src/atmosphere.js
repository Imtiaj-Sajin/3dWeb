// Atmospheric extras that sell the "warm afternoon" mood: pollen drifting in
// the sunlight, and layered hill silhouettes fading out past the valley.

import * as THREE from 'three';
import { noise2 } from './noise.js';

// ---------- pollen / dust motes ----------

// Motes live in a box that wraps around the player, so they are always
// present without ever being spawned or destroyed.
const MOTE_BOX = 30;

export function buildPollen(count = 320) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * MOTE_BOX;
    positions[i * 3 + 1] = (Math.random() - 0.5) * MOTE_BOX;
    positions[i * 3 + 2] = (Math.random() - 0.5) * MOTE_BOX;
    seeds[i] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  // the shader relocates every mote, so never let three cull by bind pose
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color('#fff4d2') },
    uBox: { value: MOTE_BOX },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCenter;
      uniform float uBox;
      attribute float aSeed;
      varying float vFade;

      void main() {
        vec3 p = position;
        // lazy drift: a slow prevailing breeze plus a gentle bob
        p.x += uTime * 0.30 + sin(uTime * 0.11 + aSeed * 30.0) * 2.2;
        p.y += sin(uTime * 0.45 + aSeed * 44.0) * 0.7;
        p.z += cos(uTime * 0.09 + aSeed * 22.0) * 1.8;

        // wrap into a box centred on the player
        vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
        vec4 mv = modelViewMatrix * vec4(uCenter + rel, 1.0);

        float dist = -mv.z;
        // fade in from the far edge and out as they pass the camera
        vFade = smoothstep(uBox * 0.5, uBox * 0.25, dist) * smoothstep(0.5, 4.0, dist);
        gl_PointSize = (26.0 / max(dist, 0.6)) * (0.55 + 0.8 * fract(aSeed * 7.3));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vFade;
      void main() {
        // soft round mote
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.06, length(d));
        if (a <= 0.001) discard;
        gl_FragColor = vec4(uColor, a * vFade * 0.5);
      }
    `,
  });

  const points = new THREE.Points(geo, mat);
  points.name = 'pollen';
  points.frustumCulled = false;
  points.renderOrder = 2;

  function update(dt, elapsed, playerPos) {
    uniforms.uTime.value = elapsed;
    if (playerPos) uniforms.uCenter.value.set(playerPos.x, playerPos.y + 3.2, playerPos.z);
  }

  return { points, update };
}

// ---------- distant hills ----------

// Unfogged silhouettes sitting beyond the playable valley. Their colour is
// mixed toward the horizon haze per layer, which reads as aerial perspective.
export function buildDistantHills() {
  const group = new THREE.Group();
  group.name = 'distant-hills';
  group.renderOrder = -1;

  const layers = [
    { radius: 235, height: 34, color: '#b9b48f', count: 16, spread: 46 },
    { radius: 300, height: 46, color: '#cbc3a4', count: 14, spread: 60 },
    { radius: 365, height: 58, color: '#dcd3b6', count: 12, spread: 74 },
  ];

  for (const [li, layer] of layers.entries()) {
    const mat = new THREE.MeshBasicMaterial({
      color: layer.color,
      fog: false, // they ARE the haze; fogging them would erase them
      depthWrite: false,
    });

    const geos = [];
    for (let i = 0; i < layer.count; i++) {
      const a = (i / layer.count) * Math.PI * 2 + li * 0.4;
      const n = noise2(i * 2.7 + li * 11, li * 3.1);
      const h = layer.height * (0.65 + Math.abs(n) * 0.7);
      const w = layer.spread * (0.7 + Math.abs(noise2(i, li * 5)) * 0.7);

      // a squashed cone makes a soft, rounded ridge
      const g = new THREE.ConeGeometry(w, h, 7, 1);
      g.scale(1, 1, 0.55);
      g.translate(0, h / 2 - layer.height * 0.55, 0);
      g.rotateY(a);

      const r = layer.radius * (0.92 + Math.abs(noise2(i * 3.3, li)) * 0.18);
      g.translate(Math.cos(a) * r, 0, Math.sin(a) * r);
      geos.push(g);
    }

    // merge each layer into one mesh: three draw calls for the whole horizon
    const merged = mergeSimple(geos);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.renderOrder = -3 + li;
    group.add(mesh);
  }

  return group;
}

// positions-only merge (these are unlit, so normals and uvs are dead weight)
function mergeSimple(geos) {
  const nonIndexed = geos.map((g) => g.toNonIndexed());
  let total = 0;
  for (const g of nonIndexed) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  let off = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array, off);
    off += g.attributes.position.array.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}
