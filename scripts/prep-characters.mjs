// Shrink the KayKit character models for the web.
//
//   npm run prep:characters
//
// Reads the untouched downloads from assets/src-characters/ and writes
// game-ready copies into public/models/. Two things make the files small:
//
//   1. Animation clips the game never plays are removed. KayKit ships 76 per
//      character, almost all combat, and we use 16.
// Held items are KEPT. They are already rigged to the hand bones, so the
// showroom can hand somebody a mug or a staff just by making one visible —
// no separate model, no attachment maths. They cost very little next to the
// animation data.
//
// Re-run it after adding a character, or after adding an animation to
// USED_CLIPS in shared/world.js.

import { NodeIO } from '@gltf-transform/core';
import { dedup, prune } from '@gltf-transform/functions';
import { readdir, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USED_CLIPS, HELD_ITEM } from '../shared/world.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'assets', 'src-characters');
const OUT = join(here, '..', 'public', 'models');

const keep = new Set(USED_CLIPS);
const io = new NodeIO();
const mb = (n) => (n / 1024 / 1024).toFixed(2);

await mkdir(OUT, { recursive: true });

const files = (await readdir(SRC)).filter((f) => f.toLowerCase().endsWith('.glb'));
if (!files.length) {
  console.error(`No .glb files in ${SRC}`);
  process.exit(1);
}

let beforeTotal = 0;
let afterTotal = 0;
const missingReport = new Map();

for (const file of files.sort()) {
  const srcPath = join(SRC, file);
  const outPath = join(OUT, file);
  const before = (await stat(srcPath)).size;

  const doc = await io.read(srcPath);
  const root = doc.getRoot();

  const present = new Set(root.listAnimations().map((a) => a.getName()));
  const missing = USED_CLIPS.filter((c) => !present.has(c));
  if (missing.length) missingReport.set(file, missing);

  let droppedClips = 0;
  for (const anim of root.listAnimations()) {
    if (keep.has(anim.getName())) continue;
    // dispose the samplers and channels too, or their buffers survive
    for (const ch of anim.listChannels()) ch.dispose();
    for (const s of anim.listSamplers()) s.dispose();
    anim.dispose();
    droppedClips++;
  }

  const heldItems = root
    .listNodes()
    .filter((n) => n.getMesh() && HELD_ITEM.test(n.getName())).length;

  // prune sweeps up whatever is now unreferenced (meshes, accessors, buffers)
  await doc.transform(dedup(), prune({ keepAttributes: false }));
  await io.write(outPath, doc);

  const after = (await stat(outPath)).size;
  beforeTotal += before;
  afterTotal += after;
  console.log(
    `${file.padEnd(20)} ${mb(before)}MB -> ${mb(after)}MB` +
      `  (-${Math.round((1 - after / before) * 100)}%, ` +
      `dropped ${droppedClips} clips, kept ${heldItems} held items)`
  );
}

console.log(
  `\ntotal ${mb(beforeTotal)}MB -> ${mb(afterTotal)}MB ` +
    `(-${Math.round((1 - afterTotal / beforeTotal) * 100)}%)`
);

if (missingReport.size) {
  console.warn('\nWARNING — clips listed in USED_CLIPS but absent from the model:');
  for (const [file, list] of missingReport) console.warn(`  ${file}: ${list.join(', ')}`);
  process.exitCode = 1;
}
