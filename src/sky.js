// Sky dome with a warm gradient, drifting low-poly clouds, and a bird flock
// that follows a closed curve (Lucendo's trick: they only *look* like they
// are going somewhere).

import * as THREE from 'three';
import { noise2 } from './noise.js';

export function buildSky() {
  const geo = new THREE.SphereGeometry(430, 24, 14);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color('#4aa0dd') },
      midColor: { value: new THREE.Color('#a5d5ef') },
      horizonColor: { value: new THREE.Color('#f6e7c9') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 horizonColor;
      varying vec3 vDir;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.18, h));
        col = mix(col, topColor, smoothstep(0.12, 0.55, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'sky';
  return sky;
}

// ---------- clouds ----------

function makeCloudGeometry(seed, puffs) {
  const geos = [];
  for (let i = 0; i < puffs; i++) {
    const r = 2.2 + Math.abs(noise2(seed + i * 3.1, seed * 1.7)) * 3.4;
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1.25, 0.5, 1);
    g.translate(
      (i - (puffs - 1) / 2) * r * 1.15 + noise2(seed, i) * 1.5,
      noise2(seed + 9, i * 2.2) * 0.9,
      noise2(seed + 4, i * 1.4) * 2.2
    );
    geos.push(g);
  }
  return mergeGeos(geos);
}

// tiny merge helper (positions + normals only, non-indexed)
function mergeGeos(geos) {
  const nonIndexed = geos.map((g) => g.toNonIndexed());
  let total = 0;
  for (const g of nonIndexed) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  let off = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array, off);
    norm.set(g.attributes.normal.array, off);
    off += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return out;
}

export function buildClouds() {
  const group = new THREE.Group();
  group.name = 'clouds';
  const drifters = [];

  const mat = new THREE.MeshLambertMaterial({
    color: '#fbf6ea',
    emissive: '#8f887a',
    emissiveIntensity: 0.55,
  });
  const creamMat = new THREE.MeshLambertMaterial({
    color: '#f5e3ba',
    emissive: '#9a8a68',
    emissiveIntensity: 0.5,
  });

  // high drifting clouds
  for (let i = 0; i < 7; i++) {
    const mesh = new THREE.Mesh(makeCloudGeometry(i * 7.3, 4 + (i % 3)), mat);
    const angle = (i / 7) * Math.PI * 2;
    mesh.position.set(
      Math.cos(angle) * (55 + (i % 4) * 22),
      26 + noise2(i, 3) * 8,
      Math.sin(angle) * (55 + ((i + 2) % 4) * 22)
    );
    mesh.rotation.y = noise2(i, 11) * Math.PI;
    const s = 0.9 + Math.abs(noise2(i, 5)) * 0.8;
    mesh.scale.setScalar(s);
    group.add(mesh);
    drifters.push({ mesh, speed: 0.25 + Math.abs(noise2(i, 8)) * 0.35 });
  }

  // big warm cumulus sitting low behind the dune rim (like the reference)
  const big1 = new THREE.Mesh(makeCloudGeometry(31.7, 6), creamMat);
  big1.position.set(38, 14, -104);
  big1.scale.setScalar(2.6);
  group.add(big1);
  const big2 = new THREE.Mesh(makeCloudGeometry(44.2, 5), creamMat);
  big2.position.set(-72, 12, 88);
  big2.scale.setScalar(2.2);
  group.add(big2);

  function update(dt) {
    for (const d of drifters) {
      d.mesh.position.x += d.speed * dt;
      if (d.mesh.position.x > 150) d.mesh.position.x = -150;
    }
  }

  return { group, update };
}

// ---------- birds ----------

export function buildBirds() {
  const group = new THREE.Group();
  group.name = 'birds';

  const mat = new THREE.MeshBasicMaterial({ color: '#2e3138', side: THREE.DoubleSide, fog: true });
  const wingGeo = new THREE.PlaneGeometry(0.55, 0.22);
  wingGeo.translate(0.27, 0, 0); // hinge at the body

  // closed loop path high over the valley
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push(
      new THREE.Vector3(
        Math.cos(a) * (40 + noise2(i, 1) * 18),
        21 + noise2(i, 6) * 5,
        Math.sin(a) * (48 + noise2(i, 3) * 18)
      )
    );
  }
  const path = new THREE.CatmullRomCurve3(pts, true, 'centripetal');

  const birds = [];
  for (let i = 0; i < 5; i++) {
    const bird = new THREE.Group();
    const left = new THREE.Mesh(wingGeo, mat);
    left.rotation.y = Math.PI; // mirror
    const right = new THREE.Mesh(wingGeo, mat);
    bird.add(left, right);
    group.add(bird);
    birds.push({ bird, left, right, t: i * 0.17, flap: i * 1.3 });
  }

  const pos = new THREE.Vector3();
  const ahead = new THREE.Vector3();

  function update(dt, elapsed) {
    for (const b of birds) {
      b.t = (b.t + dt * 0.008) % 1;
      path.getPointAt(b.t, pos);
      path.getPointAt((b.t + 0.01) % 1, ahead);
      b.bird.position.copy(pos);
      b.bird.lookAt(ahead);
      const flap = Math.sin(elapsed * 9 + b.flap) * 0.75;
      b.left.rotation.z = flap;
      b.right.rotation.z = -flap;
    }
  }

  return { group, update };
}
