// Facts about the world that BOTH the browser and the Node server need.
//
// Must stay dependency-free (no three.js, no DOM) so Node can import it
// directly and the two never drift apart.

// Centre line of the road at a given z. The server walks its bots along this
// and the client builds the terrain from it.
export function roadX(z) {
  return 10 * Math.sin(z * 0.021) + 5 * Math.sin(z * 0.011 + 2.1);
}

// Bots stay inside this lane either side of the road centre. Trees are only
// scattered beyond roadDist > 9, so staying in the lane means a bot can never
// walk through a tree without the server needing to know where any tree is.
export const BOT_LANE = 5.5;
export const ROAD_Z_MIN = -88;
export const ROAD_Z_MAX = 88;

// Animation states, sent as a single integer per player per update.
export const ANIM = {
  IDLE: 0,
  WALK: 1,
  RUN: 2,
  JUMP: 3,
  WAVE: 4,
  SIT_CHAIR: 5,
  SIT_FLOOR: 6,
  LIE: 7,
  INTERACT: 8,
};

// state integer -> the clip a remote character should loop
export const ANIM_CLIP = {
  [ANIM.IDLE]: 'Idle',
  [ANIM.WALK]: 'Walking_A',
  [ANIM.RUN]: 'Running_A',
  [ANIM.JUMP]: 'Jump_Idle',
  [ANIM.WAVE]: 'Cheer',
  [ANIM.SIT_CHAIR]: 'Sit_Chair_Idle',
  [ANIM.SIT_FLOOR]: 'Sit_Floor_Idle',
  [ANIM.LIE]: 'Lie_Idle',
  [ANIM.INTERACT]: 'Interact',
};

export const MODELS = ['Rogue', 'Knight', 'Barbarian'];

// Never tint these — a green face reads as a bug, not as variety.
export const SKIN_PART = /head|face|hair/i;

// Clothing tints multiplied over the character texture. Kept light, because
// multiplying only ever darkens — a saturated tint turns the outfit muddy.
// Free variety: no extra download, no extra draw calls.
export const TINTS = [
  '#ffffff', '#ffd0b0', '#b9daff', '#c6ecbb', '#f6c8e2', '#ffe89a', '#bde4dc',
  '#dcc9ff', '#ffc0c0', '#cdeeff', '#ddf7c0', '#ffd6ea', '#c9d4ff', '#ffe6bd',
];

// A little height difference reads as strongly as colour at a distance.
export const SCALES = [0.93, 1.0, 1.07];

// model x tint x scale — 3 x 14 x 3 = 126 distinguishable people
export function pickLook(rand = Math.random) {
  return {
    model: MODELS[Math.floor(rand() * MODELS.length)],
    tint: TINTS[Math.floor(rand() * TINTS.length)],
    scale: SCALES[Math.floor(rand() * SCALES.length)],
  };
}

// Names are one word plus a number, generated on the fly and never stored.
export const NAME_WORDS = [
  'Willow', 'Pebble', 'Meadow', 'Cricket', 'Sunny', 'Maple', 'Clover', 'Breeze',
  'Poppy', 'Cedar', 'Rusty', 'Puddle', 'Hazel', 'Comet', 'Bramble', 'Fern',
  'Peach', 'Otter', 'Juniper', 'Sparrow', 'Olive', 'Waffle', 'Pumpkin', 'Wren',
  'Basil', 'Mango', 'Thistle', 'Robin', 'Acorn', 'Daisy', 'Ginger', 'Marlow',
];

export function makeName(rand = Math.random) {
  const word = NAME_WORDS[Math.floor(rand() * NAME_WORDS.length)];
  return `${word}${Math.floor(rand() * 90) + 10}`;
}
