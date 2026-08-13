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

export const MODELS = ['Rogue', 'Knight', 'Barbarian', 'Mage', 'Rogue_Hooded'];

// Clips kept in the shipped models. KayKit ships 76 per character; the ones
// left out are duplicates and static reference poses (T-Pose, *_Pose, the
// dual-wield and strafe variants) that nothing is likely to want.
//
// KEEP THIS IN SYNC with any animation you intend to play. A clip missing
// from this list is missing from the shipped model, and prep-characters.mjs
// fails loudly if a listed clip does not exist.
export const USED_CLIPS = [
  // --- movement and idling ---
  'Idle',
  'Unarmed_Idle',
  'Walking_A',
  'Walking_B',
  'Walking_C',
  'Walking_Backwards',
  'Running_A',
  'Running_B',
  'Jump_Start',
  'Jump_Idle',
  'Jump_Land',
  'Dodge_Forward',
  'Dodge_Backward',
  'Dodge_Left',
  'Dodge_Right',

  // --- social ---
  'Cheer',
  'Interact',
  'PickUp',
  'Throw',
  'Use_Item',

  // --- resting ---
  'Sit_Chair_Down',
  'Sit_Chair_Idle',
  'Sit_Chair_StandUp',
  'Sit_Floor_Down',
  'Sit_Floor_Idle',
  'Sit_Floor_StandUp',
  'Lie_Down',
  'Lie_Idle',
  'Lie_StandUp',

  // --- combat: one-handed ---
  '1H_Melee_Attack_Chop',
  '1H_Melee_Attack_Slice_Diagonal',
  '1H_Melee_Attack_Slice_Horizontal',
  '1H_Melee_Attack_Stab',

  // --- combat: two-handed ---
  '2H_Melee_Idle',
  '2H_Melee_Attack_Chop',
  '2H_Melee_Attack_Slice',
  '2H_Melee_Attack_Spin',
  '2H_Melee_Attack_Stab',

  // --- combat: ranged ---
  '1H_Ranged_Aiming',
  '1H_Ranged_Shoot',
  '1H_Ranged_Reload',
  '2H_Ranged_Aiming',
  '2H_Ranged_Shoot',
  '2H_Ranged_Reload',

  // --- combat: unarmed ---
  'Unarmed_Melee_Attack_Punch_A',
  'Unarmed_Melee_Attack_Punch_B',
  'Unarmed_Melee_Attack_Kick',

  // --- combat: casting (staff and wand) ---
  'Spellcast_Raise',
  'Spellcast_Shoot',
  'Spellcasting',
  'Spellcast_Long',

  // --- defence and consequences ---
  'Block',
  'Blocking',
  'Block_Attack',
  'Block_Hit',
  'Hit_A',
  'Hit_B',
  'Death_A',
  'Death_B',
];

// Held items ship rigged to the characters' hand bones, so carrying one is
// just a matter of making that node visible. Everyone starts empty-handed.
export const HELD_ITEM = /sword|dagger|knife|axe|crossbow|shield|arrow|quiver|staff|wand|bow|spellbook|mug|throwable/i;

// What each character can pick up at the showroom. Node names come straight
// from the model, so they must match exactly. Offhand duplicates (the second
// copy used for dual wielding) are left out.
export const ITEMS = {
  Rogue: [
    { node: 'Knife', label: 'knife' },
    { node: '1H_Crossbow', label: 'crossbow' },
    { node: '2H_Crossbow', label: 'big crossbow' },
    { node: 'Throwable', label: 'smoke bomb' },
  ],
  Rogue_Hooded: [
    { node: 'Knife', label: 'knife' },
    { node: '1H_Crossbow', label: 'crossbow' },
    { node: '2H_Crossbow', label: 'big crossbow' },
    { node: 'Throwable', label: 'smoke bomb' },
  ],
  Knight: [
    { node: 'Round_Shield', label: 'round shield' },
    { node: 'Badge_Shield', label: 'badge shield' },
    { node: 'Spike_Shield', label: 'spiked shield' },
    { node: 'Rectangle_Shield', label: 'tower shield' },
    { node: '1H_Sword', label: 'sword' },
    { node: '2H_Sword', label: 'greatsword' },
  ],
  Barbarian: [
    { node: 'Mug', label: 'mug' },
    { node: '1H_Axe', label: 'axe' },
    { node: '2H_Axe', label: 'great axe' },
    { node: 'Barbarian_Round_Shield', label: 'shield' },
  ],
  Mage: [
    { node: '2H_Staff', label: 'staff' },
    { node: '1H_Wand', label: 'wand' },
    { node: 'Spellbook', label: 'spellbook' },
    { node: 'Spellbook_open', label: 'open spellbook' },
  ],
};

export const itemsFor = (model) => ITEMS[model] ?? [];

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
