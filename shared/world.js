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

// ---------- combat ----------
//
// The trade-off is reach against damage: thrown and shot things keep you at a
// distance but land lightly, while anything you have to walk up to hurts.
// Shields deal nothing and soak a share of what lands on you.
// Every one of these numbers is enforced on the server, never the client.

export const MAX_HEALTH = 100;
export const UNARMED = { kind: 'unarmed', reach: 1.5, damage: 7, cooldown: 0.5, block: 0 };

export const WEAPONS = {
  // short reach, heavy hits
  Knife: { kind: 'melee1h', reach: 1.7, damage: 17, cooldown: 0.45, block: 0 },
  '1H_Sword': { kind: 'melee1h', reach: 2.2, damage: 26, cooldown: 0.75, block: 0 },
  '1H_Axe': { kind: 'melee1h', reach: 2.1, damage: 28, cooldown: 0.8, block: 0 },
  '2H_Sword': { kind: 'melee2h', reach: 2.7, damage: 38, cooldown: 1.2, block: 0 },
  '2H_Axe': { kind: 'melee2h', reach: 2.6, damage: 41, cooldown: 1.3, block: 0 },

  // long reach, lighter hits
  '1H_Crossbow': { kind: 'ranged1h', reach: 15, damage: 15, cooldown: 1.1, block: 0 },
  '2H_Crossbow': { kind: 'ranged2h', reach: 21, damage: 23, cooldown: 1.7, block: 0 },
  Throwable: { kind: 'throw', reach: 11, damage: 20, cooldown: 1.0, block: 0 },

  // middling reach
  '2H_Staff': { kind: 'cast', reach: 10, damage: 22, cooldown: 1.0, block: 0 },
  '1H_Wand': { kind: 'cast', reach: 7.5, damage: 14, cooldown: 0.55, block: 0 },
  Spellbook: { kind: 'cast', reach: 6.5, damage: 13, cooldown: 0.65, block: 0 },
  Spellbook_open: { kind: 'cast', reach: 6.5, damage: 13, cooldown: 0.65, block: 0 },

  // shields cannot attack, but halve what reaches you
  Round_Shield: { kind: 'shield', reach: 0, damage: 0, cooldown: 1, block: 0.45 },
  Badge_Shield: { kind: 'shield', reach: 0, damage: 0, cooldown: 1, block: 0.4 },
  Spike_Shield: { kind: 'shield', reach: 0, damage: 0, cooldown: 1, block: 0.45 },
  Rectangle_Shield: { kind: 'shield', reach: 0, damage: 0, cooldown: 1, block: 0.55 },
  Barbarian_Round_Shield: { kind: 'shield', reach: 0, damage: 0, cooldown: 1, block: 0.45 },

  // not a weapon; you may simply enjoy your drink
  Mug: { kind: 'none', reach: 0, damage: 0, cooldown: 1, block: 0 },
};

export const weaponOf = (item) => WEAPONS[item] ?? UNARMED;

// only things that can actually hurt someone are handed out on arrival
export const ARMED_ITEMS = Object.keys(WEAPONS).filter((k) => WEAPONS[k].damage > 0);

// A swing only counts if the target is roughly in front of you.
export const ATTACK_ARC = Math.PI / 3; // 60 degrees either side

// Which clip plays for a swing. Several melee options so repeated attacks do
// not look identical.
export const ATTACK_CLIPS = {
  unarmed: ['Unarmed_Melee_Attack_Punch_A', 'Unarmed_Melee_Attack_Punch_B', 'Unarmed_Melee_Attack_Kick'],
  melee1h: ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Stab'],
  melee2h: ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin'],
  ranged1h: ['1H_Ranged_Shoot'],
  ranged2h: ['2H_Ranged_Shoot'],
  throw: ['Throw'],
  cast: ['Spellcast_Shoot'],
  shield: ['Block'],
  none: ['Interact'],
};

// ---------- the peaceful ground ----------
//
// The exhibition and its surroundings. Nobody can be hurt here, and nobody
// resting anywhere can be hurt either — you can always put yourself somewhere
// that the fighting cannot reach.

export const SHOWROOM_Z = 8;
export const SHOWROOM_X = roadX(SHOWROOM_Z) + 15;
export const SAFE_RADIUS = 17;

export const inSafeZone = (x, z) =>
  Math.hypot(x - SHOWROOM_X, z - SHOWROOM_Z) < SAFE_RADIUS;

export const RESTING_ANIMS = new Set([ANIM.SIT_CHAIR, ANIM.SIT_FLOOR, ANIM.LIE]);

// Sitting down is a truce, wherever you are.
export const isProtected = (e) => inSafeZone(e.x, e.z) || RESTING_ANIMS.has(e.a);

// ---------- ranking ----------
//
// Deliberately weighted so the top of the board is whoever people liked, not
// whoever killed most: being waved at beats waving, which beats fighting.

export const SCORE_WEIGHTS = { waveGot: 4, waveGave: 2, kills: 1, deaths: -0.5 };

export function scoreOf(s) {
  return (
    (s.waveGot ?? 0) * SCORE_WEIGHTS.waveGot +
    (s.waveGave ?? 0) * SCORE_WEIGHTS.waveGave +
    (s.kills ?? 0) * SCORE_WEIGHTS.kills +
    (s.deaths ?? 0) * SCORE_WEIGHTS.deaths
  );
}

export const RESPAWN_MS = 3500;
export const WAVE_RANGE = 10;

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
