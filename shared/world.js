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

// Subtle clothing tints multiplied over the character texture, so the same
// three models can front a much larger crowd.
export const TINTS = [
  '#ffffff',
  '#ffd9c2',
  '#c8e2ff',
  '#d5f0cd',
  '#f4d3ef',
  '#ffeeb0',
  '#cfe9e4',
  '#e6d6ff',
];

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
