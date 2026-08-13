// Sky dome with a warm gradient, drifting low-poly clouds, and a bird flock
// that follows a closed curve (Lucendo's trick: they only *look* like they
// are going somewhere).

import * as THREE from 'three';
import { noise2 } from './noise.js';

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
    0.0,  0,    0.045,  // leading root
    0.0,  0,   -0.035,  // trailing root
    0.14, 0.004, -0.05, // mid trailing
    0.0,  0,    0.045,
    0.14, 0.004, -0.05,
    0.23, 0.008, -0.09, // swept tip
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

export function buildBirds() {
  const group = new THREE.Group();
  group.name = 'birds';

  // hazy blue-grey rather than near-black, so they sit in the sky instead of
  // punching a hole in it
  const mat = new THREE.MeshBasicMaterial({ color: '#6b7885', side: THREE.DoubleSide, fog: true });

  const bodyGeo = new THREE.ConeGeometry(0.022, 0.15, 5);
  bodyGeo.rotateX(Math.PI / 2); // point forward (+z)
  const wingGeo = makeWingGeometry();

  // closed loop high over the valley, above the tree line
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts.push(
      new THREE.Vector3(
        Math.cos(a) * (46 + noise2(i, 1) * 16),
        26 + noise2(i, 6) * 4,
        Math.sin(a) * (54 + noise2(i, 3) * 16)
      )
    );
  }
  const path = new THREE.CatmullRomCurve3(pts, true, 'centripetal');

  const birds = [];
  for (let i = 0; i < 4; i++) {
    const bird = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, mat);
    const right = new THREE.Mesh(wingGeo, mat);
    const left = new THREE.Mesh(wingGeo, mat);
    left.scale.x = -1; // mirror
    bird.add(body, left, right);
    group.add(bird);
    birds.push({ bird, left, right, t: (i * 0.16) % 1, phase: i * 1.7 });
  }

  const pos = new THREE.Vector3();
  const ahead = new THREE.Vector3();

  function update(dt, elapsed) {
    for (const b of birds) {
      b.t = (b.t + dt * 0.009) % 1;
      path.getPointAt(b.t, pos);
      path.getPointAt((b.t + 0.01) % 1, ahead);
      b.bird.position.copy(pos);
      b.bird.lookAt(ahead);

      // flap in bursts, glide in between (wings held in a shallow V)
      const gliding = Math.sin(elapsed * 0.55 + b.phase) < -0.25;
      const flap = gliding ? 0.18 : Math.sin(elapsed * 8 + b.phase) * 0.55 + 0.1;
      b.right.rotation.z = flap;
      b.left.rotation.z = -flap;
    }
  }

  return { group, update };
}
