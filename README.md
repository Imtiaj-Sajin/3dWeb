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

### Which server the client uses

`serverCandidates()` in `src/net.js` tries these in order, stopping at the
first that answers:

1. `?server=ws://host:port` in the URL — aims one tab at one room, no rebuild
2. `VITE_SERVER_URL` if set at build time
3. **the hosted room** (`LIVE_SERVER`) — `wss://threedwebbackend.onrender.com`
4. `ws://localhost:8787`, only when the page itself is on localhost

If none answer, the game falls back to solo with local bots rather than
failing. Candidates before the last get a short window (6s); the last gets a
long one, because a free Render instance sleeps when idle and can take most
of a minute to wake — the player sees "waking the server, one moment…" rather
than an unexplained pause.

Note this order means that while developing, you connect to the **hosted**
room by default even with a local server running. Use
`?server=ws://localhost:8787` to force the local one.

Deployment note: browsers refuse plain `ws://` from an `https://` page, so the
server must sit behind TLS. Render provides that; on a plain VPS use Caddy or
nginx with Let's Encrypt proxying to port 8787.

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

At the exhibition, every character stands on a plinth and every item sits on
its own gear stand — the display copies are lifted straight out of the models
they are rigged to, so what you see on the stand is exactly what ends up in
your hand. Items belong to their character, and a stand you cannot use says
whose it is rather than staying silent.

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

## Combat and ranking

You arrive already carrying a weapon your character can hold. **F or left
click** swings it; on touch there is a ⚔️ button.

Weapons trade reach against damage — see `WEAPONS` in `shared/world.js`.
Crossbows and thrown things reach far and land lightly; swords and axes need
you close but hurt. Shields deal nothing and soak a share of what lands on
you. Mugs are for drinking.

**Nothing about a fight is decided by the browser.** The client only ever says
"I swung"; the server checks cooldown, reach, facing arc and who is protected
against its own copy of everyone's position, then decides the hit. A client
claiming a kill, or claiming to be unhurt, is simply ignored.

Two places are peaceful, checked server-side:

- the exhibition clearing (`SAFE_RADIUS` around the showroom)
- anyone sitting or lying down, anywhere

so you can always put yourself somewhere the fighting cannot reach.

Dying plays a death animation, then you get up a few seconds later somewhere
on the road with full health.

The board ranks whoever is currently connected, weighted so that **being waved
at beats waving, which beats fighting** (`SCORE_WEIGHTS`). It is entirely
possible — and intended — for someone who just got killed to outrank the
person who killed them. Stats live in the server's memory and vanish when you
disconnect: no database, nothing to recover, same as everything else here.

## Characters

Five models (Rogue, Knight, Barbarian, Mage, Hooded Rogue), each combined with
14 clothing tints and 3 heights — 126 distinguishable people from 4.4MB of
assets.

Models are **fetched on demand**: only the one you spawn as blocks the loading
screen, and the rest arrive as people turn up wearing them.

`npm run prep:characters` rebuilds `public/models/` from the untouched
downloads in `assets/src-characters/` (gitignored). It drops the ~60 animation
clips the game never plays and the weapons nobody carries, which takes each
model from ~3.5MB to ~0.9MB — a 74% saving.

Re-run it after adding a character, or after adding a clip to `USED_CLIPS` in
`shared/world.js`. That list is the single source of truth for which
animations survive; if a clip is not in it, it will not be in the shipped
model. Re-fetch the raw models with:

```bash
BASE=https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main/addons/kaykit_character_pack_adventures/Characters/gltf
for n in Rogue Knight Barbarian Mage Rogue_Hooded; do
  curl -sL "$BASE/$n.glb" -o "assets/src-characters/$n.glb"
done
```

Tints skip faces and hair — colouring those turns skin green, which reads as a
bug rather than as variety.

## Credits

- Character models & animations: [KayKit](https://kaylousberg.com/) by
  Kay Lousberg — CC0 (`public/models/KAYKIT_LICENSE.txt`)
- Inspired by Vicente Lucendo's *Summer Afternoon*
