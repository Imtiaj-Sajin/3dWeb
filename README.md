# Warm Afternoon

A calm, low-poly 3D walking experience for the browser, inspired by
[Summer Afternoon](https://summer-afternoon.vlucendo.com/) by Vicente Lucendo.
Built with [Three.js](https://threejs.org/) + [Vite](https://vitejs.dev/) — no game engine.

## Run it

```bash
npm install
npm run dev      # game on http://localhost:5173
npm run server   # multiplayer server on :8787 (optional, separate terminal)
```

Open two browser windows on the dev URL and you will see each other.

`npm run build` produces a static site in `dist/`. **The game runs fine with
no server at all** — without one it falls back to local bots, so the published
site is never broken by the socket server being down.

## Multiplayer

Ephemeral by design: nothing is stored, nothing is recovered. You are given a
name and a character on arrival; when you close the tab you are gone.

- `server/index.js` — one room, all in memory. Assigns a name (word + number)
  and a model + tint, runs the shared bots, relays position at 10 Hz, and
  drops anyone idle for 7 minutes (`IDLE_MS` to change).
- `shared/world.js` — the handful of facts both the browser and the server
  need (road curve, animation codes, name words). Dependency-free so Node can
  import it directly and the two can never drift apart.
- Only `x, z, heading, animation` go over the wire. **Y is never sent** — each
  client derives ground height from the terrain function, which keeps packets
  tiny and guarantees remote players' feet stay on the ground.
- Bots are server-driven so everyone sees them in the same place. They walk
  only the road lane, which is guaranteed clear of trees, so the server never
  needs to know where any scenery is.
- Birds, clouds and pollen are deliberately **not** synced. They are ambient;
  nothing can be hidden behind a bird.

Point the client at a server with `VITE_SERVER_URL`:

```bash
VITE_SERVER_URL=wss://your-host.example npm run build
```

Deployment note: browsers refuse plain `ws://` from an `https://` page, so in
production the server must sit behind TLS (`wss://`). Caddy or nginx with
Let's Encrypt, proxying to port 8787, is the usual way.

## Controls

- **WASD / arrow keys** — walk
- **Shift** — run
- **Space** — jump
- **E** — contextual action: use whatever the floating prompt is pointing at
  (sit on a bench, lie down under a palm, touch a lamp, say hi to someone).
  With nothing nearby, it waves.
- **Q** — wave, always
- **Mouse** — subtle camera tilt
- **Touch** — drag anywhere for a floating joystick; 👋 button to wave; tap the
  floating prompt to use it

Walk close to a bench, boulder, palm, street lamp, barrier, or another
character and a prompt appears above it saying what E will do. Greeting someone
makes them stop, turn to face you, and wave back.

Debug helpers: `?x=&z=` URL params teleport the player (`?z=-52` lands at the
benches), and `__wa` in the browser console exposes the scene, player, NPCs, and
the interactable list.

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
