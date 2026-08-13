// Sky dome with a warm gradient, drifting low-poly clouds, and a bird flock
// that follows a closed curve (Lucendo's trick: they only *look* like they
// are going somewhere).

import * as THREE from 'three';
import { noise2 } from './noise.js';
import { heightAt } from './terrain.js';

export function buildSky(sunDir) {
  const geo = new THREE.SphereGeometry(430, 32, 18);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color('#3f95d8') },
      midColor: { value: new THREE.Color('#a8d8f0') },
      horizonColor: { value: new THREE.Color('#f7e6c4') },
      sunColor: { value: new THREE.Color('#fff3d0') },
      sunDir: { value: sunDir.clone() },
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
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);

        vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.20, h));
        col = mix(col, topColor, smoothstep(0.14, 0.62, h));

        // warm bloom around the sun, plus a broad haze lifting off the horizon
        float sd = max(dot(d, sunDir), 0.0);
        col += sunColor * pow(sd, 6.0) * 0.30;
        col += sunColor * pow(sd, 64.0) * 0.55;
        col = mix(col, horizonColor, (1.0 - smoothstep(0.0, 0.10, h)) * 0.55);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'sky';
  return sky;
}

// ---------- clouds ----------

// Cumulus built as a fat base row with a smaller crown on top, so the
// silhouette bulges in the middle instead of reading as a flat pancake.
function makeCloudGeometry(seed, count, baseR, width) {
  const geos = [];

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) - 0.5 : 0;
    const bulge = Math.cos(t * Math.PI); // fattest at the centre
    const r = baseR * (0.5 + bulge * 0.6) * (0.85 + Math.abs(noise2(seed + i * 3.1, seed * 1.7)) * 0.4);
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1.05, 0.82, 0.95);
    g.translate(
      t * width + noise2(seed, i) * baseR * 0.2,
      noise2(seed + 9, i * 2.2) * baseR * 0.16,
      noise2(seed + 4, i * 1.4) * baseR * 0.55
    );
    geos.push(g);
  }

  const crown = Math.max(1, Math.round(count * 0.55));
  for (let i = 0; i < crown; i++) {
    const t = (crown > 1 ? i / (crown - 1) - 0.5 : 0) * 0.62;
    const r = baseR * (0.42 + Math.abs(noise2(seed + i * 5.3, 5)) * 0.34);
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1.0, 0.9, 0.95);
    g.translate(
      t * width + noise2(seed + 3, i) * baseR * 0.25,
      baseR * 0.5 + noise2(seed + 7, i) * baseR * 0.18,
      noise2(seed + 2, i * 1.9) * baseR * 0.4
    );
    geos.push(g);
  }

  return mergeGeos(geos);
}

// Bake the lighting in: bright sunlit crown fading to a cooler underside.
// Painted into vertex colours so the clouds can be drawn unlit and stay
// clean and bright no matter where the sun is.
function paintCloud(geo, topHex, bottomHex) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const span = Math.max(max.y - min.y, 1e-3);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const top = new THREE.Color(topHex);
  const bottom = new THREE.Color(bottomHex);
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const h = (pos.getY(i) - min.y) / span; // 0 underside, 1 crown
    const up = nrm.getY(i) * 0.5 + 0.5; // faces tilted skyward catch more
    const k = THREE.MathUtils.smoothstep(h * 0.6 + up * 0.5, 0.08, 0.92);
    c.copy(bottom).lerp(top, k);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
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

  // unlit: the shading is baked into the vertex colours
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const hazeMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });

  // high drifting cumulus — white crowns, cool blue-grey undersides
  for (let i = 0; i < 9; i++) {
    const big = i % 3 === 0;
    const geo = paintCloud(
      makeCloudGeometry(i * 7.3, big ? 5 : 3 + (i % 2), big ? 3.4 : 2.4, big ? 11 : 6.5),
      '#fffdf8',
      big ? '#ccd4e6' : '#d9dfec'
    );
    const mesh = new THREE.Mesh(geo, skyMat);
    const angle = (i / 9) * Math.PI * 2;
    mesh.position.set(
      Math.cos(angle) * (58 + (i % 4) * 24),
      27 + noise2(i, 3) * 9,
      Math.sin(angle) * (58 + ((i + 2) % 4) * 24)
    );
    mesh.rotation.y = noise2(i, 11) * Math.PI;
    mesh.scale.setScalar(0.85 + Math.abs(noise2(i, 5)) * 0.7);
    group.add(mesh);
    drifters.push({ mesh, speed: 0.2 + Math.abs(noise2(i, 8)) * 0.3 });
  }

  // thin wisps up high, for a bit of layering
  for (let i = 0; i < 4; i++) {
    const geo = paintCloud(makeCloudGeometry(80 + i * 4.1, 4, 1.5, 9), '#fffefb', '#e4e9f4');
    const mesh = new THREE.Mesh(geo, skyMat);
    const angle = (i / 4) * Math.PI * 2 + 0.8;
    mesh.position.set(Math.cos(angle) * 95, 44 + noise2(i, 21) * 6, Math.sin(angle) * 95);
    mesh.scale.set(1.7, 0.5, 1.2);
    group.add(mesh);
    drifters.push({ mesh, speed: 0.5 + Math.abs(noise2(i, 17)) * 0.3 });
  }

  // big warm banks low on the horizon, hazed by distance
  for (const [x, y, z, s, seed] of [
    [38, 15, -108, 2.7, 31.7],
    [-74, 13, 92, 2.3, 44.2],
    [104, 14, 34, 2.4, 58.9],
  ]) {
    const geo = paintCloud(makeCloudGeometry(seed, 6, 3.2, 13), '#fff6e4', '#ddcbaa');
    const mesh = new THREE.Mesh(geo, hazeMat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = noise2(seed, 2) * Math.PI;
    mesh.scale.setScalar(s);
    group.add(mesh);
  }

  function update(dt) {
    for (const d of drifters) {
      d.mesh.position.x += d.speed * dt;
      if (d.mesh.position.x > 160) d.mesh.position.x = -160;
    }
  }

  return { group, update };
}

// ---------- birds ----------

function makeWingGeometry() {
  // swept, tapered wing: hinge at x=0, tip trailing slightly back and out.
  // Deliberately small — a bird this size reads as distant wildlife rather
  // than a dark shape cutting across the sky.
  const g = new THREE.BufferGeometry();
  // prettier-ignore
  const verts = new Float32Array([
    0.0,  0,    0.10,  // leading root
    0.0,  0,   -0.07,  // trailing root
    0.26, 0.01, -0.11, // mid trailing
    0.0,  0,    0.10,
    0.26, 0.01, -0.11,
    0.44, 0.02, -0.20, // swept tip
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- birds ----------
//
// Steered rather than path-animated: each bird picks its own wandering target
// in 3D, so no two runs look alike and there is no visible repeating loop.
// Flock members share a target and jostle for spacing; solo birds roam.
// Everything is drawn from three InstancedMeshes, so the whole flock costs
// three draw calls no matter how many birds there are.

const ROAM_RADIUS = 92;
const MIN_CLEARANCE = 1.7; // never skim closer than this to the ground
const MAX_SPEED = 7.5;
const MIN_SPEED = 3.4;

function newTarget(out, nearGround) {
  const a = Math.random() * Math.PI * 2;
  const r = 12 + Math.random() * (ROAM_RADIUS - 12);
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  // roughly a third of the time, dive down and skim the meadow
  const y = heightAt(x, z) + (nearGround ? 2.5 + Math.random() * 4.5 : 11 + Math.random() * 24);
  out.set(x, y, z);
}

export function buildBirds({ obstacles = [] } = {}) {
  const group = new THREE.Group();
  group.name = 'birds';

  const mat = new THREE.MeshBasicMaterial({ color: '#5d6a78', side: THREE.DoubleSide, fog: true });

  const bodyGeo = new THREE.ConeGeometry(0.05, 0.34, 5);
  bodyGeo.rotateX(Math.PI / 2); // nose along +z
  const wingR = makeWingGeometry();
  const wingL = makeWingGeometry();
  wingL.scale(-1, 1, 1); // mirrored, so both wings can flap as instances

  // 4 + 3 in two loose flocks, plus 3 loners
  const flocks = [
    { count: 4, target: new THREE.Vector3(), timer: 0 },
    { count: 3, target: new THREE.Vector3(), timer: 0 },
  ];
  for (const f of flocks) newTarget(f.target, false);

  const birds = [];
  const addBird = (flock) => {
    const a = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 50;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const b = {
      pos: new THREE.Vector3(x, heightAt(x, z) + 8 + Math.random() * 18, z),
      vel: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(5),
      target: new THREE.Vector3(),
      timer: Math.random() * 4,
      flock,
      scale: 0.85 + Math.random() * 0.5,
      flapPhase: Math.random() * 10,
      bank: 0,
      climb: 0,
    };
    newTarget(b.target, Math.random() < 0.3);
    birds.push(b);
  };
  for (const f of flocks) for (let i = 0; i < f.count; i++) addBird(f);
  for (let i = 0; i < 3; i++) addBird(null);

  const N = birds.length;
  const bodies = new THREE.InstancedMesh(bodyGeo, mat, N);
  const wingsR = new THREE.InstancedMesh(wingR, mat, N);
  const wingsL = new THREE.InstancedMesh(wingL, mat, N);
  for (const m of [bodies, wingsR, wingsL]) {
    m.frustumCulled = false; // they roam far outside the bind-pose bounds
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
  }

  const _dummy = new THREE.Object3D();
  const _wing = new THREE.Object3D();
  const _mat = new THREE.Matrix4();
  const _acc = new THREE.Vector3();
  const _d = new THREE.Vector3();

  function update(dt, elapsed) {
    // flocks re-aim on their own schedule
    for (const f of flocks) {
      f.timer -= dt;
      if (f.timer <= 0) {
        newTarget(f.target, Math.random() < 0.25);
        f.timer = 6 + Math.random() * 8;
      }
    }

    for (let i = 0; i < N; i++) {
      const b = birds[i];
      const aim = b.flock ? b.flock.target : b.target;

      if (!b.flock) {
        b.timer -= dt;
        if (b.timer <= 0 || b.pos.distanceToSquared(b.target) < 36) {
          newTarget(b.target, Math.random() < 0.35);
          b.timer = 5 + Math.random() * 7;
        }
      }

      _acc.set(0, 0, 0);

      // steer toward the target
      _d.copy(aim).sub(b.pos);
      const dist = _d.length() || 1;
      _acc.addScaledVector(_d.divideScalar(dist), 6);

      // flock spacing: pull loosely together, but never crowd
      if (b.flock) {
        for (let j = 0; j < N; j++) {
          if (j === i || birds[j].flock !== b.flock) continue;
          _d.copy(b.pos).sub(birds[j].pos);
          const d2 = _d.lengthSq();
          if (d2 < 9 && d2 > 1e-4) _acc.addScaledVector(_d.normalize(), (3 - Math.sqrt(d2)) * 3.5);
          else if (d2 > 100) _acc.addScaledVector(_d.normalize(), -1.2);
        }
      }

      // ground clearance, sampled slightly ahead so they climb over rises
      const aheadX = b.pos.x + b.vel.x * 0.6;
      const aheadZ = b.pos.z + b.vel.z * 0.6;
      const ground = Math.max(heightAt(b.pos.x, b.pos.z), heightAt(aheadX, aheadZ));
      const clearance = b.pos.y - ground;
      if (clearance < MIN_CLEARANCE) _acc.y += (MIN_CLEARANCE - clearance) * 22;

      // dodge trees and poles, but only down in the cluttered layer
      if (clearance < 11) {
        for (const o of obstacles) {
          const dx = b.pos.x - o.x;
          const dz = b.pos.z - o.z;
          const rr = (o.camR ?? o.r) + 2.2;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-4) {
            const d = Math.sqrt(d2);
            const push = 1 - d / rr;
            _acc.x += (dx / d) * push * 55;
            _acc.z += (dz / d) * push * 55;
            _acc.y += push * 20; // and lift over it
          }
        }
      }

      // stay in the valley
      const rad = Math.hypot(b.pos.x, b.pos.z);
      if (rad > ROAM_RADIUS) {
        _acc.x -= (b.pos.x / rad) * (rad - ROAM_RADIUS) * 1.6;
        _acc.z -= (b.pos.z / rad) * (rad - ROAM_RADIUS) * 1.6;
      }

      // integrate, remembering the old heading so we can bank into the turn
      const prevX = b.vel.x;
      const prevZ = b.vel.z;
      b.vel.addScaledVector(_acc, dt);

      const speed = b.vel.length();
      if (speed > MAX_SPEED) b.vel.multiplyScalar(MAX_SPEED / speed);
      else if (speed < MIN_SPEED) b.vel.multiplyScalar(MIN_SPEED / Math.max(speed, 1e-4));
      b.pos.addScaledVector(b.vel, dt);

      const turn = Math.atan2(prevX * b.vel.z - prevZ * b.vel.x, prevX * b.vel.x + prevZ * b.vel.z);
      b.bank += (THREE.MathUtils.clamp(turn / Math.max(dt, 1e-3) * 0.09, -0.85, 0.85) - b.bank) * Math.min(1, dt * 5);
      b.climb += (b.vel.y - b.climb) * Math.min(1, dt * 3);

      // flap hard when climbing, hold a glide when descending
      const effort = THREE.MathUtils.clamp(0.5 + b.climb * 0.35, 0, 1);
      const flap =
        effort < 0.22
          ? 0.16
          : Math.sin(elapsed * (7 + effort * 6) + b.flapPhase) * (0.3 + effort * 0.4) + 0.1;

      _dummy.position.copy(b.pos);
      _dummy.scale.setScalar(b.scale);
      _dummy.up.set(0, 1, 0);
      _dummy.lookAt(b.pos.x + b.vel.x, b.pos.y + b.vel.y, b.pos.z + b.vel.z);
      _dummy.rotateZ(b.bank);
      _dummy.updateMatrix();
      bodies.setMatrixAt(i, _dummy.matrix);

      _wing.rotation.set(0, 0, flap);
      _wing.updateMatrix();
      wingsR.setMatrixAt(i, _mat.multiplyMatrices(_dummy.matrix, _wing.matrix));
      _wing.rotation.set(0, 0, -flap);
      _wing.updateMatrix();
      wingsL.setMatrixAt(i, _mat.multiplyMatrices(_dummy.matrix, _wing.matrix));
    }

    bodies.instanceMatrix.needsUpdate = true;
    wingsR.instanceMatrix.needsUpdate = true;
    wingsL.instanceMatrix.needsUpdate = true;
  }

  return { group, update };
}
