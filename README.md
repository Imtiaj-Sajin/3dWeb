# Warm Afternoon

A calm, low-poly 3D walking experience for the browser, inspired by
[Summer Afternoon](https://summer-afternoon.vlucendo.com/) by Vicente Lucendo.
Built with [Three.js](https://threejs.org/) + [Vite](https://vitejs.dev/) — no game engine.

## Run it

```bash
npm install
npm run dev      # opens on http://localhost:5173
```

`npm run build` produces a static site in `dist/` you can host anywhere
(Netlify, Vercel, GitHub Pages — no server needed).

## Controls

- **WASD / arrow keys** — walk
- **Shift** — run
- **Space** — jump
- **Mouse** — subtle camera tilt
- **Touch** — drag anywhere for a floating joystick

## How it works

- `src/terrain.js` — analytic heightfield (value noise + road corridor blending).
  Characters walk by sampling `heightAt(x, z)` — no physics engine, no raycasts.
  Ground colors (asphalt / sand / grass) are painted into vertex colors by
  distance-to-road and height.
- `src/scatter.js` — procedural trees, bushes, rocks, and palms merged into
  vertex-colored geometry, drawn with `InstancedMesh` (one draw call per
  variant). Grass sways in the vertex shader via `onBeforeCompile`.
- `src/props.js` — power poles with sagging catenary wires, street lamps,
  benches, a road barrier.
- `src/characters.js` — KayKit rigged characters (CC0) with idle/walk/run/jump
  crossfades; frame-rate-independent movement; circle-collider push-out.
- `src/camera.js` — lazy auto-follow camera with mouse parallax (no dragging).
- `src/sky.js` — gradient sky dome, drifting low-poly clouds, birds following
  a closed curve.

## Credits

- Character models & animations: [KayKit](https://kaylousberg.com/) by
  Kay Lousberg — CC0 (`public/models/KAYKIT_LICENSE.txt`)
- Inspired by Vicente Lucendo's *Summer Afternoon*
