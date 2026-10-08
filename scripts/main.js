/**
 * Grim Pulse - Combat Turn Tracker  (v0.2.4)
 * Foundry VTT V13 / V14, written against the dnd5e system.
 *
 * Two DOM roots, both plain elements:
 *   #grim-pulse        the draggable turn strip
 *   #grim-pulse-stage  full-screen layer for banners, the death save die and its result
 *
 * The strip never keeps its own turn order: every render reads game.combat again.
 * Anything every player must see at the same moment (Reaction, death announcements,
 * death save results) travels over the module socket.
 */

const MODULE_ID = "grim-pulse";
const SOCKET = `module.${MODULE_ID}`;
const DEFAULT_POSITION = { left: 130, top: 90 };
const BEAT_WIDTH = 120; // px width of one heartbeat. Keep in sync with @keyframes gp-ecg.
const ECG_BEATS = 4;
const ACTIVE_STATUS_LIMIT = 6;
const QUEUED_STATUS_LIMIT = 4;
const STATUS_WRAP_AT = 10; // characters per line before the next word drops to a new line
const MYSTERY_IMG = "icons/svg/mystery-man.svg";
const HEAL_MS = 1700;
const REVIVE_MS = 2800;
const DICE_WAIT_MS = 10000; // longest we wait for Dice So Nice before showing the result anyway
const DIM_MAX_MS = 15000; // the roll dim never outlives this, whatever happens

/* ------------------------------------------------------------------ */
/*  Flavour lines. Edit freely: one is picked at random each time.     */
/* ------------------------------------------------------------------ */

const PHRASES = {
  /** Under a character's name when the Reaction button is pressed. */
  reaction: [
    "But in that very instant...",
    "Not so fast...",
    "Before the blow could land...",
    "In the blink of an eye...",
    "But fate had other plans...",
    "Quicker than thought..."
  ],
  /** Under a player character's name after the third failed death save. */
  fallen: [
    "Returns to the embrace of the gods.",
    "Walks now among the stars.",
    "Has gone where no blade can follow.",
    "Rests, their story ended.",
    "Answers the final call.",
    "Passes beyond the veil."
  ],
  /** Skull button, hostile tokens. Harsh on purpose. */
  slainHostile: [
    "No second chances.",
    "Cut down without mercy.",
    "Slain where they stood.",
    "Sent screaming into the dark.",
    "Dead, and not coming back.",
    "Nothing left but the body."
  ],
  /** Skull button, neutral, secret and friendly tokens. */
  slainOther: [
    "The light fades from their eyes.",
    "Gone before their story was told.",
    "Fallen, with secrets unspoken.",
    "Silence takes them.",
    "Lost to the dark.",
    "No one will know what they wanted."
  ]
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const DISPOSITION = new Map([
  [-2, "secret"],
  [-1, "hostile"],
  [0, "neutral"],
  [1, "friendly"]
]);

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

const getSetting = (key) => game.settings.get(MODULE_ID, key);

const loc = (key, data) =>
  data ? game.i18n.format(`GRIMPULSE.${key}`, data) : game.i18n.localize(`GRIMPULSE.${key}`);

const isVideo = (src) => /\.(webm|mp4|m4v|ogv)(\?|$)/i.test(src ?? "");

const reducedMotion = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** Is Dice So Nice installed, enabled and ready on this client? */
const hasDice3d = () => Boolean(game.modules.get("dice-so-nice")?.active && game.dice3d);

/**
 * Resolves when Dice So Nice has finished animating the roll in this chat message.
 * Resolves at once if there is no message or no Dice So Nice, and never waits longer than DICE_WAIT_MS.
 */
async function waitForDice(messageId) {
  if (!messageId || !hasDice3d() || typeof game.dice3d.waitFor3DAnimationByMessageID !== "function") return;
  const timeout = new Promise((resolve) => setTimeout(resolve, DICE_WAIT_MS));
  try {
    await Promise.race([game.dice3d.waitFor3DAnimationByMessageID(messageId), timeout]);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not wait for Dice So Nice`, err);
  }
}

/** "Concentrating: Haste" becomes two lines: a word moves down once the line would pass STATUS_WRAP_AT. */
function wrapStatus(name) {
  const lines = [];
  let line = "";
  for (const word of String(name).split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length > STATUS_WRAP_AT) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map(esc).join("<br>");
}

/* ------------------------------------------------------------------ */
/*  Art: heartbeat, frames, blood, skull, wings, die                   */
/* ------------------------------------------------------------------ */

function ecgPath() {
  let d = "M0 20";
  for (let i = 0; i < ECG_BEATS; i++) {
    const x = i * BEAT_WIDTH;
    d += ` H${x + 34} l5 -4 l5 4 h8 l3 5 l5 -24 l6 32 l4 -13 h9 q6 -8 12 0 H${x + BEAT_WIDTH}`;
  }
  return d;
}

const ECG_WIDTH = BEAT_WIDTH * ECG_BEATS;
const ECG_LIVE = `<div class="gp-ecg"><svg width="${ECG_WIDTH}" viewBox="0 0 ${ECG_WIDTH} 40" preserveAspectRatio="none" aria-hidden="true"><path d="${ecgPath()}"/></svg></div>`;
const ECG_FLAT = `<div class="gp-ecg gp-ecg-flat"><svg width="${ECG_WIDTH}" viewBox="0 0 ${ECG_WIDTH} 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 20 H${ECG_WIDTH}"/></svg></div>`;

/** Layered frame for the active turn: outer line, inner line, portrait divider, diamonds. 276 x 100. */
const FRAME_ACTIVE = `<svg class="gp-frame" viewBox="0 0 276 100" aria-hidden="true">
<polygon class="gp-f-out" points="11,1 265,1 275,11 275,89 265,99 11,99 1,89 1,11"/>
<polygon class="gp-f-temp" pathLength="100" points="11,1 265,1 275,11 275,89 265,99 11,99 1,89 1,11"/>
<polygon class="gp-f-in" points="12.5,5 263.5,5 271,12.5 271,87.5 263.5,95 12.5,95 5,87.5 5,12.5"/>
<path class="gp-f-out" d="M101.5 1 V99"/><path class="gp-f-in" d="M105 5 V95"/>
<path class="gp-f-dia" d="M101.5 43.5 l6.5 6.5 -6.5 6.5 -6.5 -6.5 Z"/>
<path class="gp-f-dia" d="M188 -3.5 l4.5 4.5 -4.5 4.5 -4.5 -4.5 Z M188 94.5 l4.5 4.5 -4.5 4.5 -4.5 -4.5 Z"/>
</svg>`;

/** Layered frame for a queued turn: pointed right end, inner line, one diamond. 200 x 46. */
const FRAME_QUEUED = `<svg class="gp-frame" viewBox="0 0 200 46" aria-hidden="true">
<polygon class="gp-f-out" points="1,1 187,1 199,23 187,45 1,45"/>
<polygon class="gp-f-temp" pathLength="100" points="1,1 187,1 199,23 187,45 1,45"/>
<polygon class="gp-f-in" points="4.5,4.5 185,4.5 194.5,23 185,41.5 4.5,41.5"/>
<path class="gp-f-dia" d="M189 19.5 l3.5 3.5 -3.5 3.5 -3.5 -3.5 Z"/>
</svg>`;

/** Hexagonal plate behind "Round N". 190 x 40. */
const FRAME_PLATE = `<svg class="gp-frame" viewBox="0 0 190 40" aria-hidden="true">
<polygon class="gp-f-out" points="14,1 176,1 189,20 176,39 14,39 1,20"/>
<polygon class="gp-f-in" points="16,5 174,5 183.5,20 174,35 16,35 6.5,20"/>
<path class="gp-f-dia" d="M25 15.5 l4.5 4.5 -4.5 4.5 -4.5 -4.5 Z M165 15.5 l4.5 4.5 -4.5 4.5 -4.5 -4.5 Z"/>
</svg>`;

/** Five splatter groups. b1 appears under 50% HP, one more for every further 10% lost. */
const BLOOD_SVG = `<svg class="gp-blood" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g filter="url(#gp-rough)">
<g class="gp-b1"><circle cx="8" cy="10" r="10"/><circle cx="21" cy="6" r="3"/><circle cx="5" cy="26" r="3.5"/><circle cx="25" cy="19" r="2"/><rect x="7" y="14" width="3.2" height="24" rx="1.6"/></g>
<g class="gp-b2"><circle cx="91" cy="89" r="12"/><circle cx="76" cy="95" r="4"/><circle cx="97" cy="72" r="3"/><circle cx="81" cy="77" r="2"/></g>
<g class="gp-b3"><circle cx="89" cy="8" r="9"/><rect x="86" y="10" width="3.2" height="32" rx="1.6"/><circle cx="72" cy="5" r="3"/><circle cx="96" cy="24" r="2.5"/><rect x="93" y="12" width="2.2" height="17" rx="1.1"/></g>
<g class="gp-b4"><ellipse cx="4" cy="60" rx="8" ry="13"/><circle cx="15" cy="68" r="3"/><circle cx="11" cy="45" r="2"/><rect x="3" y="64" width="2.8" height="28" rx="1.4"/><circle cx="20" cy="92" r="6"/></g>
<g class="gp-b5"><ellipse cx="50" cy="97" rx="30" ry="8"/><circle cx="40" cy="84" r="3"/><circle cx="52" cy="3" r="8"/><rect x="50" y="5" width="3.2" height="24" rx="1.6"/><circle cx="64" cy="11" r="3.5"/><circle cx="35" cy="9" r="2.5"/></g>
</g></svg>`;

/**
 * Skull and wing art are image files in assets/, so they can be swapped without touching code:
 *   assets/skull.png  the skull silhouette (eye and nose holes are transparent)
 *   assets/wing.png   the right wing, white. The left wing is the same image mirrored.
 * Everything below places them in one coordinate space where the skull is 200 units wide.
 * If you replace skull.png with a different skull, update SKULL_H, EYES and the crack paths to match it.
 */
const assetUrl = (name) => {
  const path = `modules/${MODULE_ID}/assets/${name}`;
  return globalThis.foundry?.utils?.getRoute ? foundry.utils.getRoute(path) : path;
};

const SKULL_H = 210; // skull.png is 333 x 350, drawn 200 wide
const SKULL_VIEWBOX = `0 0 200 ${SKULL_H}`;
const SKULL_CORE = `<image href="${assetUrl("skull.png")}" x="0" y="0" width="200" height="${SKULL_H}" preserveAspectRatio="none"/>`;

/**
 * Light in an eye socket. Not a drawn flame: a blurred glow, a hot core, a wisp that
 * stretches up out of the socket, and embers that drift upward and die out.
 */
const EYES = [[57.3, 133.6], [141.8, 133.7]]; // centres of the eye holes in skull.png

function eyeFx(cx, cy, cls) {
  const embers = [0, 1, 2, 3, 4, 5, 6]
    .map((i) => {
      const x = cx - 13 + ((i * 37) % 27);
      const drift = ((i * 53) % 22) - 11;
      return `<circle class="gps-ember" cx="${x}" cy="${cy + 6}" r="${(1.6 + (i % 3) * 0.8).toFixed(1)}" fill="#fff3c4" style="--ex:${drift}px;animation-delay:${(i * 0.21).toFixed(2)}s"/>`;
    })
    .join("");
  return `
<g class="gps-eye ${cls}">
<circle class="gps-eye-halo" cx="${cx}" cy="${cy}" r="32" fill="url(#gp-g-orb) #ffc94d" filter="url(#gp-blur)"/>
<ellipse class="gps-eye-wisp" cx="${cx}" cy="${cy - 16}" rx="10" ry="28" fill="url(#gp-g-orb) #ffc94d" filter="url(#gp-blur)"/>
<circle class="gps-eye-core" cx="${cx}" cy="${cy + 2}" r="8" fill="#ffffff" filter="url(#gp-blur-s)"/>
<circle class="gps-eye-ring" cx="${cx}" cy="${cy}" r="14" fill="none" stroke="#fff6d6" stroke-width="3"/>
${embers}
</g>`;
}

const crack = (n, d) => `<path class="gps-crack gps-crack-${n}" pathLength="1" d="${d}" fill="none" stroke="#1b0a0c" stroke-width="3.2" stroke-linejoin="miter"/>`;
const CRACKS = [
  crack(1, "M112 17 L104 40 L116 58 L100 76 L106 98 M104 40 L88 52"), // first failure
  crack(2, "M116 58 L140 50 L152 66 M34 84 L52 78 L48 62 L64 50 M100 76 L84 82"), // second failure
  crack(3, "M152 66 L168 74 M64 50 L74 30 M52 78 L58 96 M140 50 L146 32 M106 98 L100 120 L92 138 L98 148") // third, just before it bursts
];

/** The right wing sits behind the skull with its root low at the jaw; the left is its mirror image. */
const WING = `<image href="${assetUrl("wing.png")}" x="127.8" y="-67" width="252.4" height="267" preserveAspectRatio="none"/>`;
const WINGS = `<g class="gps-wing gps-wing-r">${WING}</g><g transform="translate(200 0) scale(-1 1)"><g class="gps-wing gps-wing-l">${WING}</g></g>`;
const WINGS_VIEWBOX = "-190 -76 580 296";

/** A d20 seen face-on. Face shades are mixed from the theme colour in CSS. */
const D20 = `<svg viewBox="0 0 200 200" aria-hidden="true">
<polygon class="gps-face f1" points="100,8 20,54 100,48"/><polygon class="gps-face f2" points="100,8 180,54 100,48"/>
<polygon class="gps-face f3" points="20,54 48,138 100,48"/><polygon class="gps-face f4" points="180,54 152,138 100,48"/>
<polygon class="gps-face f5" points="20,54 20,146 48,138"/><polygon class="gps-face f6" points="180,54 180,146 152,138"/>
<polygon class="gps-face f7" points="20,146 100,192 48,138"/><polygon class="gps-face f8" points="180,146 100,192 152,138"/>
<polygon class="gps-face f9" points="100,192 152,138 48,138"/><polygon class="gps-face f0" points="100,48 152,138 48,138"/>
<text x="100" y="118" text-anchor="middle" class="gps-pips">20</text></svg>`;

/** Shared gradients, filters and symbols. Lives in the always-mounted stage so references never break. */
const SHARED_DEFS = `<svg id="grim-pulse-defs" width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
<filter id="gp-rough" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.085" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="gp-blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="gp-blur-s" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2"/></filter>
<linearGradient id="gp-g-bone" gradientUnits="userSpaceOnUse" x1="60" y1="10" x2="130" y2="245"><stop offset="0" stop-color="#fffdf7"/><stop offset="0.6" stop-color="#f3ead8"/><stop offset="1" stop-color="#dccfb4"/></linearGradient>
<linearGradient id="gp-g-shade" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" stop-color="#3a2a1c" stop-opacity="0"/><stop offset="1" stop-color="#3a2a1c" stop-opacity="0.5"/></linearGradient>
<radialGradient id="gp-g-socket" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="#000000"/><stop offset="0.7" stop-color="#1a0a0d"/><stop offset="1" stop-color="#40191e"/></radialGradient>
<linearGradient id="gp-g-tooth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf5"/><stop offset="1" stop-color="#cdbf9f"/></linearGradient>
<linearGradient id="gp-g-feather" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="0.55" stop-color="#f3efe5"/><stop offset="1" stop-color="#c3cad8"/></linearGradient>
<linearGradient id="gp-g-feather2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3ddcd"/></linearGradient>
<radialGradient id="gp-g-orb"><stop offset="0" stop-color="#ffffff"/><stop offset="0.25" stop-color="#ffe9a6"/><stop offset="0.55" stop-color="#ffb02e"/><stop offset="1" stop-color="#ff7800" stop-opacity="0"/></radialGradient>
<linearGradient id="gp-g-glint" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<mask id="gp-mask-skull" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="${SKULL_H}">${SKULL_CORE}</mask>
<symbol id="gp-skull-sym" viewBox="${SKULL_VIEWBOX}">${SKULL_CORE}</symbol>
</defs></svg>`;

const SKULL_ICON = `<svg class="gp-skullicon" viewBox="${SKULL_VIEWBOX}" aria-hidden="true"><use href="#gp-skull-sym"/></svg>`;

/* ------------------------------------------------------------------ */
/*  Reading the combatant                                              */
/* ------------------------------------------------------------------ */

function readHp(actor) {
  const hp = actor?.system?.attributes?.hp;
  if (!hp) return null;
  const baseMax = Number(hp.max ?? 0) + Number(hp.tempmax ?? 0);
  const max = Math.max(0, Number(hp.effectiveMax ?? baseMax));
  if (!Number.isFinite(max) || max <= 0) return null;
  const value = Math.max(0, Number(hp.value ?? 0));
  return { value, max, temp: Math.max(0, Number(hp.temp ?? 0)), pct: Math.min(1, value / max) };
}

function readAc(actor) {
  const ac = actor?.system?.attributes?.ac;
  const value = typeof ac === "object" ? ac?.value : ac;
  return Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null;
}

function readDeath(actor) {
  const death = actor?.system?.attributes?.death ?? {};
  return { success: Number(death.success ?? 0), failure: Number(death.failure ?? 0) };
}

const isPlayerCharacter = (actor) => actor?.type === "character";

function isStable(actor) {
  if (actor?.statuses?.has?.("stable")) return true;
  const death = readDeath(actor);
  return Boolean(actor?.getFlag?.(MODULE_ID, "stable")) && death.failure === 0;
}

/** dead = out of the fight for good. A player character at 0 HP is dying, not dead, until the third failure. */
function isDead(combatant) {
  const actor = combatant.actor;
  if (combatant.isDefeated || actor?.statuses?.has?.("dead")) return true;
  const hp = readHp(actor);
  if (!hp || hp.value > 0) return false;
  return isPlayerCharacter(actor) ? readDeath(actor).failure >= 3 : true;
}

/** A turn the End turn button jumps over: any non-player combatant at 0 HP. */
function isSkippable(combatant) {
  const actor = combatant?.actor;
  if (!actor || isPlayerCharacter(actor) || actor.hasPlayerOwner) return false;
  const hp = readHp(actor);
  return Boolean(combatant.isDefeated) || Boolean(hp && hp.value <= 0);
}

/** Does this combatant owe a death saving throw at the start of its turn? */
function needsDeathSave(combatant) {
  const actor = combatant?.actor;
  if (!actor || !isPlayerCharacter(actor) || combatant.isDefeated) return false;
  const hp = readHp(actor);
  if (!hp || hp.value > 0) return false;
  if (actor.statuses?.has?.("dead") || readDeath(actor).failure >= 3) return false;
  return !isStable(actor);
}

/**
 * Conditions (Stunned, Prone...) plus running effects such as Rage or Innate Sorcery.
 * Passive effects that live on items and feats are left out on purpose.
 */
function readStatuses(actor) {
  if (!actor) return [];
  const names = new Set();
  const add = (effect) => {
    if (!effect || effect.disabled || effect.isSuppressed) return;
    const name = String(effect.name ?? effect.label ?? "").trim();
    if (name) names.add(name);
  };
  try {
    for (const effect of actor.temporaryEffects ?? []) add(effect);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read temporary effects`, err);
  }
  try {
    for (const effect of actor.effects ?? []) add(effect);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read actor effects`, err);
  }
  return [...names];
}

function pickImage(combatant) {
  const actorImg = combatant.actor?.img;
  const tokenImg = combatant.token?.texture?.src ?? combatant.img;
  const order = getSetting("imageSource") === "token" ? [tokenImg, actorImg] : [actorImg, tokenImg];
  return order.find((src) => src && !isVideo(src) && src !== MYSTERY_IMG) ?? MYSTERY_IMG;
}

/** Blood level 0-5. Level 1 starts under 50% HP, then one more level for each further 10% lost. */
function bloodLevel(pct) {
  if (pct >= 0.5) return 0;
  return Math.min(5, 1 + Math.floor((0.5 - pct) * 10 + 1e-9));
}

function describe(entry) {
  const { combatant, masked } = entry;
  const isGM = game.user.isGM;

  if (masked) {
    return {
      id: combatant.id, name: loc("Unknown"), img: MYSTERY_IMG, dispo: "unknown",
      hp: null, ac: null, init: null, showNumbers: false, statuses: [],
      dead: false, dying: false, stable: false, death: null, blood: 0, beat: 1.4, amp: 0.6, temp: false
    };
  }

  const actor = combatant.actor;
  const dispo = DISPOSITION.get(combatant.token?.disposition ?? 0) ?? "neutral";
  const secret = dispo === "secret" && !isGM && !combatant.isOwner;
  const hp = readHp(actor);
  const pct = hp ? hp.pct : 1;
  const dead = isDead(combatant);
  const dying = !dead && Boolean(hp && hp.value <= 0);
  const showNumbers = isGM || getSetting("playerNumbers") === "all" || Boolean(actor?.hasPlayerOwner);

  return {
    id: combatant.id,
    name: secret ? loc("Unknown") : combatant.name,
    img: pickImage(combatant),
    dispo,
    hp,
    ac: readAc(actor),
    init: combatant.initiative,
    showNumbers,
    statuses: readStatuses(actor),
    dead,
    dying,
    stable: dying && isStable(actor),
    death: dying && isPlayerCharacter(actor) ? readDeath(actor) : null,
    blood: dead || dying ? 5 : bloodLevel(pct),
    beat: (1 + (1 - pct) * 2).toFixed(2), // seconds per heartbeat: 1s at full HP, 3s near death
    amp: (0.25 + 0.75 * pct).toFixed(2), // heartbeat height: full at full HP, a quarter near death
    temp: Boolean(hp?.temp)
  };
}

/* ------------------------------------------------------------------ */
/*  Stage: banners, announcements, the death save die and its result   */
/* ------------------------------------------------------------------ */

class Stage {
  constructor() {
    this.el = null;
    this.queue = [];
    this.playing = false;
    this.prompt = null; // { combatantId, node }
    this.dim = null;
    this.dimTimer = null;
    this.uid = 0;
  }

  mount() {
    const el = document.createElement("div");
    el.id = "grim-pulse-stage";
    el.innerHTML = SHARED_DEFS;
    document.body.appendChild(el);
    this.el = el;
    this.applyTheme();
  }

  applyTheme() {
    this.el.dataset.theme = getSetting("theme");
  }

  /** Scenes play one after another so two announcements never cover each other. */
  play(html, duration) {
    this.queue.push({ html, duration });
    if (!this.playing) this.#next();
  }

  #next() {
    const scene = this.queue.shift();
    if (!scene) {
      this.playing = false;
      return;
    }
    this.playing = true;
    const node = document.createElement("div");
    node.className = "gps-layer";
    node.innerHTML = scene.html;
    this.el.appendChild(node);
    setTimeout(() => {
      node.remove();
      this.#next();
    }, scene.duration);
  }

  /* ---------- simple text scenes ---------- */

  round(n) {
    const sparks = Array.from({ length: 16 }, () => {
      const size = (8 + Math.random() * 14).toFixed(0);
      return `<i class="gps-spark" style="left:${(18 + Math.random() * 64).toFixed(1)}%;top:${(-15 + Math.random() * 130).toFixed(1)}%;width:${size}px;height:${size}px;animation-delay:${(0.45 + Math.random() * 1.1).toFixed(2)}s"></i>`;
    }).join("");
    this.play(`
      <div class="gps-scene gps-round">
        <div class="gps-shade"></div>
        <div class="gps-band"><div class="gps-rule"></div><div class="gps-title">${esc(loc("Round", { n }))}</div><div class="gps-rule"></div>${sparks}</div>
      </div>`, 2600);
  }

  reaction(name, line) {
    this.play(`
      <div class="gps-scene gps-reaction">
        <div class="gps-shade"></div>
        <div class="gps-streak"></div>
        <div class="gps-stack"><div class="gps-title">${esc(name)}</div><div class="gps-sub">${esc(line)}</div></div>
      </div>`, 2800);
  }

  slain(names, line, tone) {
    this.play(`
      <div class="gps-scene gps-slain" data-tone="${tone === "hostile" ? "hostile" : "other"}">
        <div class="gps-shade"></div>
        <div class="gps-stack">
          <svg class="gps-skull-small" viewBox="${SKULL_VIEWBOX}" aria-hidden="true"><use href="#gp-skull-sym"/></svg>
          <div class="gps-title">${names.map(esc).join("<br>")}</div>
          <div class="gps-rule"></div>
          <div class="gps-sub">${esc(line)}</div>
        </div>
      </div>`, 3600);
  }

  encounterEnd() {
    this.play(`
      <div class="gps-scene gps-end">
        <div class="gps-shade"></div>
        <div class="gps-stack"><div class="gps-rule"></div><div class="gps-title">${esc(loc("EncounterEnd"))}</div><div class="gps-rule"></div></div>
      </div>`, 5600);
  }

  /* ---------- death save: the die ---------- */

  openDeathPrompt(combatant, onRoll) {
    this.closeDeathPrompt();
    const canRoll = Boolean(combatant.actor?.isOwner);
    const node = document.createElement("div");
    node.className = "gps-layer gps-prompt";
    node.innerHTML = `
      <div class="gps-shade"></div>
      <div class="gps-stack">
        <div class="gps-title">${esc(combatant.name)}</div>
        <div class="gps-sub">${esc(loc("Death.Title"))}</div>
        <button type="button" class="gps-die" ${canRoll ? "" : "disabled"} aria-label="${esc(loc("Death.Roll"))}">${D20}</button>
        <div class="gps-hint">${esc(loc(canRoll ? "Death.Roll" : "Death.Wait"))}</div>
        <button type="button" class="gps-hide">${esc(loc("Death.Hide"))}</button>
      </div>`;
    this.el.appendChild(node);
    this.prompt = { combatantId: combatant.id, node };

    node.querySelector(".gps-hide").addEventListener("click", () => this.closeDeathPrompt());
    if (canRoll) {
      const die = node.querySelector(".gps-die");
      die.addEventListener("click", () => {
        if (die.disabled) return;
        die.disabled = true;
        die.classList.add("gps-rolling");
        setTimeout(() => onRoll(combatant.id), reducedMotion() ? 0 : 650);
      }, { once: true });
    }
  }

  closeDeathPrompt() {
    this.prompt?.node.remove();
    this.prompt = null;
  }

  /**
   * A light dim while Dice So Nice rolls. It is its own element, layered under the 3D dice,
   * because the stage itself sits above them and would cover the roll.
   */
  showDim() {
    this.hideDim();
    const dim = document.createElement("div");
    dim.id = "grim-pulse-dim";
    document.body.appendChild(dim);
    this.dim = dim;
    this.dimTimer = setTimeout(() => this.hideDim(), DIM_MAX_MS);
  }

  hideDim() {
    clearTimeout(this.dimTimer);
    this.dim?.remove();
    this.dim = null;
  }

  /* ---------- death save: the result ---------- */

  /**
   * kind: "success" | "fail" | "revive"
   * success / failure: the totals after this roll (0-3)
   */
  deathResult({ name, kind, success, failure, line }) {
    const id = `gps-clip-${++this.uid}`;
    const burst = kind === "fail" && failure >= 3;
    const winged = kind === "revive" || (kind === "success" && success >= 3);
    const litEyes = winged ? 2 : Math.min(2, success);
    const newEye = kind === "success" && success <= 2 ? success : 0; // which eye lights up now

    let cracks = "";
    for (let i = 0; i < Math.min(3, failure); i++) cracks += CRACKS[i];

    const eyes =
      (litEyes >= 1 ? eyeFx(...EYES[0], newEye === 1 ? "gps-ignite" : "") : "") +
      (litEyes >= 2 ? eyeFx(...EYES[1], newEye === 2 ? "gps-ignite" : "") : "");

    // Stable or revived: the skull goes white, a glint crosses it, and sparkles blink around it.
    let shimmer = "";
    if (winged) {
      const stars = Array.from({ length: 12 }, () => {
        const x = (-170 + Math.random() * 540).toFixed(0);
        const y = (-60 + Math.random() * 260).toFixed(0);
        const size = (0.6 + Math.random() * 1.1).toFixed(2);
        return `<g transform="translate(${x} ${y}) scale(${size})"><path class="gps-star" d="M0 -10 L2.2 -2.2 L10 0 L2.2 2.2 L0 10 L-2.2 2.2 L-10 0 L-2.2 -2.2 Z" fill="#ffffff" style="animation-delay:${(1.2 + Math.random() * 1.8).toFixed(2)}s"/></g>`;
      }).join("");
      shimmer = `<g mask="url(#gp-mask-skull)"><g transform="skewX(-18)"><rect class="gps-glint" x="-10" y="0" width="70" height="220" fill="url(#gp-g-glint) #ffffff"/></g></g>${stars}`;
    }

    // For the burst, the same skull is drawn once per wedge and each wedge flies off on its own.
    let shards = "";
    let clips = "";
    if (burst) {
      const wedges = 10;
      for (let i = 0; i < wedges; i++) {
        const a0 = (i / wedges) * Math.PI * 2;
        const a1 = ((i + 1) / wedges) * Math.PI * 2;
        const mid = (a0 + a1) / 2;
        const p = (a) => `${(100 + Math.cos(a) * 300).toFixed(1)},${(110 + Math.sin(a) * 300).toFixed(1)}`;
        const dist = 150 + Math.random() * 130;
        clips += `<clipPath id="${id}-${i}"><polygon points="100,110 ${p(a0)} ${p(a1)}"/></clipPath>`;
        shards += `<g class="gps-shard" clip-path="url(#${id}-${i})" style="--dx:${(Math.cos(mid) * dist).toFixed(0)}px;--dy:${(Math.sin(mid) * dist).toFixed(0)}px;--rot:${((Math.random() - 0.5) * 220).toFixed(0)}deg">${SKULL_CORE}${cracks}</g>`;
      }
    }

    let caption;
    if (kind === "revive") caption = loc("Death.Revive");
    else if (burst) caption = line;
    else if (kind === "success") caption = success >= 3 ? loc("Death.Stable") : loc("Death.Success", { n: success });
    else caption = loc("Death.Failure", { n: failure });

    const classes = ["gps-scene", "gps-death", `gps-${kind}`];
    if (burst) classes.push("gps-burst");
    if (winged) classes.push("gps-winged");
    if (kind === "fail") classes.push(`gps-newcrack-${Math.min(3, failure)}`);

    this.play(`
      <div class="${classes.join(" ")}">
        <div class="gps-shade"></div>
        <div class="gps-stack">
          <svg class="gps-skull" viewBox="${WINGS_VIEWBOX}" aria-hidden="true">
            <defs>${clips}</defs>
            ${winged ? WINGS : ""}
            <g class="gps-skull-whole">${SKULL_CORE}${eyes}${cracks}</g>
            ${shimmer}
            ${shards}
          </svg>
          <div class="gps-caption"><div class="gps-title">${esc(name)}</div><div class="gps-sub">${esc(caption)}</div></div>
        </div>
      </div>`, burst ? 5600 : winged ? 4200 : 3400);
  }
}

/* ------------------------------------------------------------------ */
/*  The strip                                                          */
/* ------------------------------------------------------------------ */

class GrimPulse {
  constructor(stage) {
    this.stage = stage;
    this.el = null;
    this.list = null;
    this.timer = null;
    this.rounds = new Map(); // combat id -> last round seen
    this.hpSeen = new Map(); // combatant id -> last HP value seen
    this.barSeen = new Map(); // combatant id -> last bar width drawn (0-100)
    this.fx = new Map(); // combatant id -> [{ kind, amount, start }]
  }

  mount() {
    const el = document.createElement("section");
    el.id = "grim-pulse";
    el.hidden = true;
    const slainButton = game.user.isGM
      ? `<button type="button" class="gp-btn gp-btn-icon" data-action="slain" data-tooltip="${esc(loc("SlainHint"))}" aria-label="${esc(loc("SlainHint"))}">${SKULL_ICON}</button>`
      : "";
    el.innerHTML = `
      <header class="gp-head" data-tooltip="${esc(loc("HandleHint"))}">
        <div class="gp-plate">${FRAME_PLATE}<span class="gp-round"></span></div>
        <div class="gp-tab"><span class="gp-turn"></span></div>
      </header>
      <ol class="gp-list"></ol>
      <footer class="gp-foot">
        <button type="button" class="gp-btn gp-btn-main" data-action="end-turn"><i class="fa-solid fa-forward-step"></i><span>${esc(loc("EndTurn"))}</span></button>
        <button type="button" class="gp-btn" data-action="reaction"><i class="fa-solid fa-bolt"></i><span>${esc(loc("Reaction"))}</span></button>
        ${slainButton}
      </footer>`;
    document.body.appendChild(el);

    this.el = el;
    this.list = el.querySelector(".gp-list");
    this.applyTheme();
    this.applyScale();
    this.applyPosition(getSetting("position"));
    this.#bindDrag(el.querySelector(".gp-head"));
    this.#bindList();
    this.#bindFoot(el.querySelector(".gp-foot"));
    window.addEventListener("resize", () => this.applyPosition(getSetting("position")));

    for (const combat of game.combats ?? []) this.rounds.set(combat.id, combat.round ?? 0);
    this.render();
  }

  /* ---------- appearance ---------- */

  applyTheme() {
    this.el.dataset.theme = getSetting("theme");
    this.stage.applyTheme();
  }

  applyScale() {
    this.el.style.setProperty("--gp-scale", String(getSetting("scale")));
  }

  applyPosition(pos) {
    const left = Number(pos?.left ?? DEFAULT_POSITION.left);
    const top = Number(pos?.top ?? DEFAULT_POSITION.top);
    const maxLeft = Math.max(0, window.innerWidth - 80);
    const maxTop = Math.max(0, window.innerHeight - 60);
    this.el.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
    this.el.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
  }

  /* ---------- dragging ---------- */

  #bindDrag(handle) {
    let start = null;

    handle.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const rect = this.el.getBoundingClientRect();
      start = { dx: ev.clientX - rect.left, dy: ev.clientY - rect.top };
      handle.setPointerCapture(ev.pointerId);
      this.el.classList.add("gp-dragging");
    });

    handle.addEventListener("pointermove", (ev) => {
      if (!start) return;
      this.applyPosition({ left: ev.clientX - start.dx, top: ev.clientY - start.dy });
    });

    const finish = (ev) => {
      if (!start) return;
      start = null;
      this.el.classList.remove("gp-dragging");
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      game.settings.set(MODULE_ID, "position", {
        left: parseFloat(this.el.style.left) || 0,
        top: parseFloat(this.el.style.top) || 0
      });
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);

    handle.addEventListener("dblclick", () => {
      this.applyPosition(DEFAULT_POSITION);
      game.settings.set(MODULE_ID, "position", { ...DEFAULT_POSITION });
    });
  }

  /* ---------- clicks and hovers on the turn frames ---------- */

  #tokenFor(target) {
    const id = target.closest(".gp-row")?.dataset.combatantId;
    const token = id ? game.combat?.combatants.get(id)?.token?.object : null;
    return token?.visible ? token : null;
  }

  #bindList() {
    this.list.addEventListener("click", (ev) => {
      if (!ev.target.closest(".gp-card")) return;
      const token = this.#tokenFor(ev.target);
      if (!token) return;
      canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 350 });
      if (token.isOwner) token.control({ releaseOthers: true });
    });

    this.list.addEventListener("pointerover", (ev) => {
      if (!ev.target.closest(".gp-card")) return;
      try {
        this.#tokenFor(ev.target)?._onHoverIn?.(ev, { hoverOutOthers: true });
      } catch (err) { /* highlight is cosmetic */ }
    });

    this.list.addEventListener("pointerout", (ev) => {
      if (!ev.target.closest(".gp-card")) return;
      try {
        this.#tokenFor(ev.target)?._onHoverOut?.(ev);
      } catch (err) { /* highlight is cosmetic */ }
    });
  }

  #bindFoot(foot) {
    foot.addEventListener("click", (ev) => {
      const action = ev.target.closest("button")?.dataset.action;
      if (action === "end-turn") this.endTurn();
      if (action === "reaction") this.announceReaction();
      if (action === "slain") this.announceSlain();
    });
  }

  /* ---------- the three buttons ---------- */

  async endTurn() {
    const combat = game.combat;
    if (!combat?.started) return;
    if (game.user.isGM) {
      await combat.nextTurn();
      await this.skipDead(combat);
      return;
    }
    if (!combat.combatant?.isOwner) return;
    await combat.nextTurn();
    // A player may only end their own turn, so the GM's client does the skipping.
    if (getSetting("skipDead")) game.socket.emit(SOCKET, { type: "skipDead", combatId: combat.id });
  }

  /** GM only: keep stepping while the turn belongs to a non-player combatant at 0 HP. */
  async skipDead(combat) {
    if (!getSetting("skipDead") || !game.user.isGM || !combat?.started) return;
    let guard = combat.turns.length;
    while (guard-- > 0 && isSkippable(combat.combatant)) await combat.nextTurn();
  }

  announceReaction() {
    const controlled = canvas.tokens?.controlled ?? [];
    const name = controlled[0]?.document?.name ?? game.user.character?.name ?? (game.user.isGM ? null : game.user.name);
    if (!name) {
      ui.notifications.warn(loc("Warn.SelectToken"));
      return;
    }
    this.send({ type: "reaction", name, line: pick(PHRASES.reaction) });
  }

  announceSlain() {
    if (!game.user.isGM) return;
    const controlled = canvas.tokens?.controlled ?? [];
    if (!controlled.length) {
      ui.notifications.warn(loc("Warn.SelectToken"));
      return;
    }
    // Two Bandits read as one "Bandit". Hostile tokens get the harsh lines, everyone else the quiet ones.
    const hostile = new Set();
    const other = new Set();
    for (const token of controlled) {
      const name = token.document?.name ?? token.name;
      if (!name) continue;
      (token.document?.disposition === -1 ? hostile : other).add(name);
    }
    const groups = [];
    if (hostile.size) groups.push({ tone: "hostile", names: [...hostile], line: pick(PHRASES.slainHostile) });
    if (other.size) groups.push({ tone: "other", names: [...other], line: pick(PHRASES.slainOther) });
    if (groups.length) this.send({ type: "slain", groups });
  }

  /* ---------- socket ---------- */

  /** Tell every other client, then do the same thing here (a socket never echoes to its sender). */
  send(data) {
    game.socket.emit(SOCKET, data);
    this.receive(data);
  }

  receive(data) {
    if (!data || typeof data !== "object") return;
    switch (data.type) {
      case "reaction":
        this.stage.reaction(String(data.name ?? ""), String(data.line ?? ""));
        break;
      case "slain":
        for (const group of Array.isArray(data.groups) ? data.groups : []) {
          const names = (Array.isArray(group.names) ? group.names : []).map(String).slice(0, 12);
          if (names.length) this.stage.slain(names, String(group.line ?? ""), group.tone);
        }
        break;
      case "deathRolling":
        // The die was clicked: clear the screen so the Dice So Nice roll is seen by everyone.
        this.stage.closeDeathPrompt();
        if (hasDice3d()) this.stage.showDim();
        break;
      case "deathClose":
        this.stage.closeDeathPrompt();
        this.stage.hideDim();
        break;
      case "deathResult":
        this.stage.closeDeathPrompt();
        this.stage.hideDim();
        this.stage.deathResult({
          name: String(data.name ?? ""),
          kind: ["success", "fail", "revive"].includes(data.kind) ? data.kind : "fail",
          success: Math.min(3, Math.max(0, Number(data.success) || 0)),
          failure: Math.min(3, Math.max(0, Number(data.failure) || 0)),
          line: String(data.line ?? "")
        });
        break;
      case "skipDead":
        if (game.users.activeGM?.isSelf) this.skipDead(game.combats.get(data.combatId));
        break;
    }
  }

  /* ---------- death saves ---------- */

  maybeDeathPrompt(combat) {
    this.stage.closeDeathPrompt();
    if (!getSetting("deathSavePrompt")) return;
    const combatant = combat?.combatant;
    if (!combatant || !needsDeathSave(combatant)) return;
    if (!game.user.isGM && (combatant.hidden || combatant.token?.hidden)) return;
    this.stage.openDeathPrompt(combatant, (id) => this.rollDeathSave(id));
  }

  async rollDeathSave(combatantId) {
    const actor = game.combat?.combatants.get(combatantId)?.actor;
    if (!actor?.isOwner) return;
    const state = () => ({ ...readDeath(actor), hp: readHp(actor)?.value ?? 0 });
    const before = state();

    this.send({ type: "deathRolling" });

    // Catch the chat message this roll creates, so we know which Dice So Nice animation to wait for.
    let messageId = null;
    const hookId = Hooks.on("createChatMessage", (message) => {
      const author = message.author ?? message.user;
      if (!messageId && author?.id === game.user.id && message.rolls?.length) messageId = message.id;
    });

    let result;
    try {
      result = await actor.rollDeathSave({}, { configure: false });
    } catch (err) {
      console.error(`${MODULE_ID} | death save failed`, err);
      ui.notifications.error(loc("Warn.DeathSave"));
      this.send({ type: "deathClose" });
      return;
    } finally {
      Hooks.off("createChatMessage", hookId);
    }
    const roll = Array.isArray(result) ? result[0] : result;
    if (!roll) {
      this.send({ type: "deathClose" }); // cancelled
      return;
    }

    // Let the 3D die land before the skull gives the result away.
    await waitForDice(messageId);

    // The system has already written the outcome to the actor: read it back rather than re-deriving the rules.
    const after = state();
    let kind;
    let success = after.success;
    let failure = after.failure;
    const passed = Number(roll.total) >= 10;

    if (after.hp > 0) kind = "revive";
    else if (after.failure > before.failure) kind = "fail";
    else if (after.success > before.success) kind = "success";
    else if (passed) {
      // dnd5e clears both counters on the third success, so the totals read 0/0 here.
      kind = "success";
      success = Math.min(3, before.success + 1);
      failure = before.failure;
    } else {
      kind = "fail";
      failure = Math.min(3, before.failure + (roll.isFumble ? 2 : 1));
    }

    if (kind === "success" && success >= 3) {
      try {
        await actor.setFlag(MODULE_ID, "stable", true);
      } catch (err) {
        console.warn(`${MODULE_ID} | could not mark the actor stable`, err);
      }
    }

    this.send({ type: "deathResult", name: actor.name, kind, success, failure, line: pick(PHRASES.fallen) });
  }

  /* ---------- reacting to data changes ---------- */

  onCombatUpdate(combat, changed) {
    const isMine = combat.id === game.combat?.id;

    if ("round" in changed) {
      const previous = this.rounds.get(combat.id) ?? 0;
      const round = combat.round ?? 0;
      const allowed = getSetting("roundBanner") && (round >= 2 || getSetting("bannerRoundOne"));
      if (isMine && combat.started && round > previous && allowed) this.stage.round(round);
    }
    this.rounds.set(combat.id, combat.round ?? 0);

    if (isMine && ("turn" in changed || "round" in changed)) this.maybeDeathPrompt(combat);
    this.schedule();
  }

  onCombatDelete(combat) {
    this.stage.closeDeathPrompt();
    this.stage.hideDim();
    this.rounds.delete(combat.id);
    if ((combat.round ?? 0) > 0 && getSetting("encounterEnd")) this.stage.encounterEnd();
    this.schedule();
  }

  onActorUpdate(actor) {
    const combat = game.combat;
    if (combat?.started) {
      for (const combatant of combat.combatants) {
        if (combatant.actor?.uuid !== actor.uuid) continue;
        const hp = readHp(actor);
        const seen = this.hpSeen.get(combatant.id);
        if (hp && seen !== undefined && hp.value > seen) {
          const list = this.fx.get(combatant.id) ?? [];
          list.push({ kind: "heal", amount: hp.value - seen, start: Date.now() });
          if (seen <= 0) list.push({ kind: "revive", amount: 0, start: Date.now() });
          this.fx.set(combatant.id, list);
        }
        if (hp) this.hpSeen.set(combatant.id, hp.value);

        // The die is no longer needed once the character is up, stable or dead.
        if (this.stage.prompt?.combatantId === combatant.id && !needsDeathSave(combatant)) this.stage.closeDeathPrompt();
      }
    }

    // Our own "stable" marker ends when the character is healed or hurt again.
    if (game.users.activeGM?.isSelf && actor.getFlag?.(MODULE_ID, "stable")) {
      const hp = readHp(actor);
      if ((hp && hp.value > 0) || readDeath(actor).failure > 0) actor.unsetFlag(MODULE_ID, "stable");
    }
    this.schedule();
  }

  /* ---------- rendering ---------- */

  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.render();
    }, 40);
  }

  /** The current turn first, then the turns after it, wrapping into the next round. */
  #entries(combat) {
    const turns = combat.turns;
    const count = turns.length;
    const current = Math.min(Math.max(0, combat.turn ?? 0), count - 1);
    const limit = getSetting("maxTurns");
    const isGM = game.user.isGM;
    const out = [];

    for (let i = 0; i < count && out.length < limit; i++) {
      const combatant = turns[(current + i) % count];
      const hiddenFromMe = !isGM && (combatant.hidden || combatant.token?.hidden);
      // A hidden combatant still holds the top frame on its own turn, but masked.
      if (hiddenFromMe && i !== 0) continue;
      out.push({ combatant, active: i === 0, nextRound: current + i >= count, masked: hiddenFromMe });
    }
    return out;
  }

  #statusHTML(statuses, limit) {
    if (!statuses.length) return "";
    let shown = statuses;
    let more = 0;
    if (statuses.length > limit) {
      shown = statuses.slice(0, limit - 1);
      more = statuses.length - shown.length;
    }
    const items = shown.map((name) => `<li>${wrapStatus(name)}</li>`).join("");
    const tail = more ? `<li class="gp-more">${wrapStatus(loc("MoreStatus", { n: more }))}</li>` : "";
    return `<ul class="gp-status">${items}${tail}</ul>`;
  }

  /** Effects still running for this combatant, each with how far along it is. */
  #activeFx(id) {
    const now = Date.now();
    const list = (this.fx.get(id) ?? []).filter((fx) => now - fx.start < (fx.kind === "heal" ? HEAL_MS : REVIVE_MS));
    if (list.length) this.fx.set(id, list);
    else this.fx.delete(id);
    return list.map((fx) => ({ ...fx, elapsed: now - fx.start }));
  }

  #savesHTML(d) {
    if (d.stable) return `<span class="gp-stable">${esc(loc("Death.Stable"))}</span>`;
    if (!d.death) return "";
    const dots = (count, cls) => [0, 1, 2].map((i) => `<b class="${cls}${i < count ? " gp-on" : ""}"></b>`).join("");
    return `<span class="gp-saves" aria-label="${esc(loc("Death.Title"))}">${dots(d.death.success, "gp-s")}<i></i>${dots(d.death.failure, "gp-f")}</span>`;
  }

  #rowHTML(entry) {
    const d = describe(entry);
    const active = entry.active;
    const numbers = d.showNumbers && d.hp;

    // HP line, bar, then AC and initiative. Players only get the bar for combatants whose numbers they may see.
    let hpBlock = "";
    if (numbers) {
      const pct = Math.round(d.hp.pct * 100);
      const from = this.barSeen.get(d.id) ?? pct;
      this.barSeen.set(d.id, pct);
      const tempPct = Math.min(100, Math.round((d.hp.temp / d.hp.max) * 100));
      const temp = d.hp.temp ? `<em>+${d.hp.temp}</em>` : "";
      hpBlock = `
        <div class="gp-hpnum">${d.hp.value}/${d.hp.max}${temp}</div>
        <div class="gp-bar"><span class="gp-bar-fill" style="width:${from}%" data-to="${pct}"></span>${tempPct ? `<span class="gp-bar-temp" style="width:${tempPct}%"></span>` : ""}</div>`;
    }

    const stats = [];
    if (active && d.showNumbers && d.ac !== null) stats.push(`<span class="gp-ac"><i class="fa-solid fa-shield-halved"></i>${esc(loc("AC"))} ${d.ac}</span>`);
    if (!entry.masked) stats.push(`<span class="gp-init"><i class="fa-solid fa-dice-d20"></i>${active ? `${esc(loc("Init"))} ` : ""}${d.init ?? "-"}</span>`);
    const saves = this.#savesHTML(d);
    if (saves) stats.push(saves);

    // Transient effects. A negative animation-delay resumes them mid-way if the strip redraws.
    const fx = this.#activeFx(d.id);
    const heal = fx.find((f) => f.kind === "heal");
    const revive = fx.find((f) => f.kind === "revive");
    let healHTML = "";
    if (heal) {
      const pluses = [0, 1, 2, 3, 4, 5]
        .map((i) => `<i class="gp-plus" style="left:${8 + i * 16}%;animation-delay:${i * 120 - heal.elapsed}ms">+</i>`)
        .join("");
      const amount = d.showNumbers ? `<b class="gp-plus gp-plus-amount" style="animation-delay:${-heal.elapsed}ms">+${heal.amount}</b>` : "";
      healHTML = `<div class="gp-heal" style="animation-delay:${-heal.elapsed}ms"></div>${pluses}${amount}`;
    }
    const wingsHTML = revive
      ? `<svg class="gp-wings" viewBox="${WINGS_VIEWBOX}" aria-hidden="true" style="--gp-fx-delay:${-revive.elapsed}ms">${WINGS.replaceAll("gps-wing", "gp-wing")}</svg>`
      : "";

    const classes = ["gp-row", active ? "gp-active" : "gp-queued"];
    if (d.dead) classes.push("gp-dead");
    if (d.dying) classes.push("gp-dying");
    if (d.temp) classes.push("gp-temp");

    return `
      <li class="${classes.join(" ")}" data-key="${esc(d.id)}" data-combatant-id="${esc(d.id)}"
          data-dispo="${d.dispo}" data-blood="${d.blood}" style="--gp-beat:${d.beat}s;--gp-amp:${d.amp}">
        <span class="gp-mark"></span>
        ${wingsHTML}
        <div class="gp-card">
          <div class="gp-body">
            <div class="gp-portrait"><img src="${esc(d.img)}" alt="" draggable="false">${d.blood ? BLOOD_SVG : ""}${d.dead ? SKULL_ICON : ""}</div>
            <i class="gp-dispo"></i>
            <div class="gp-panel">
              ${d.dead ? ECG_FLAT : ECG_LIVE}
              <div class="gp-name">${esc(d.name)}</div>
              ${hpBlock}
              <div class="gp-stats">${stats.join("")}</div>
            </div>
            <div class="gp-wash"></div>
            ${heal ? `<div class="gp-heal-in" style="animation-delay:${-heal.elapsed}ms"></div>` : ""}
          </div>
          ${active ? FRAME_ACTIVE : FRAME_QUEUED}
          ${healHTML}
        </div>
        ${this.#statusHTML(d.statuses, active ? ACTIVE_STATUS_LIMIT : QUEUED_STATUS_LIMIT)}
      </li>`;
  }

  render() {
    if (!this.el) return;
    const combat = game.combat;
    if (!combat?.started || !combat.turns?.length) {
      this.el.hidden = true;
      this.list.innerHTML = "";
      this.hpSeen.clear();
      this.barSeen.clear();
      this.fx.clear();
      return;
    }
    this.el.hidden = false;

    // Remember every combatant's HP, including the ones off the end of the strip, so healing can be noticed.
    for (const combatant of combat.combatants) {
      const hp = readHp(combatant.actor);
      if (hp) this.hpSeen.set(combatant.id, hp.value);
    }

    const entries = this.#entries(combat);
    this.el.querySelector(".gp-round").textContent = loc("Round", { n: combat.round });
    this.el.querySelector(".gp-turn").textContent = loc("TurnOf", { n: (combat.turn ?? 0) + 1, total: combat.turns.length });
    this.el.querySelector('[data-action="end-turn"]').disabled = !(game.user.isGM || combat.combatant?.isOwner);

    // Remember where every frame was, so frames can slide up to their new place.
    const before = new Map();
    for (const node of this.list.querySelectorAll("[data-key]")) before.set(node.dataset.key, node.getBoundingClientRect());

    let html = "";
    let dividerPlaced = false;
    entries.forEach((entry, index) => {
      if (entry.nextRound && !dividerPlaced && index > 0) {
        html += `<li class="gp-divider" data-key="divider"><span>${esc(loc("Round", { n: combat.round + 1 }))}</span></li>`;
        dividerPlaced = true;
      }
      html += this.#rowHTML(entry);
    });
    this.list.innerHTML = html;

    // HP bars were drawn at their old width: let them travel to the new one.
    for (const fill of this.list.querySelectorAll(".gp-bar-fill")) {
      void fill.offsetWidth;
      fill.style.width = `${fill.dataset.to}%`;
    }

    if (reducedMotion()) return;
    const scale = Number(getSetting("scale")) || 1;
    for (const node of this.list.querySelectorAll("[data-key]")) {
      const old = before.get(node.dataset.key);
      if (!old) {
        if (before.size) node.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "ease-out" });
        continue;
      }
      const dy = (old.top - node.getBoundingClientRect().top) / scale;
      if (Math.abs(dy) > 1) {
        node.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 460, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Settings and hooks                                                 */
/* ------------------------------------------------------------------ */

let tracker = null;

function applyCoreTrackerVisibility() {
  const hide = getSetting("hideCoreTracker") && !game.user.isGM;
  document.body.classList.toggle("gp-hide-core-tracker", Boolean(hide));
}

Hooks.once("init", () => {
  const S = "GRIMPULSE.Settings";
  const rerender = () => tracker?.schedule();
  const toggle = (key, initial) =>
    game.settings.register(MODULE_ID, key, {
      name: `${S}.${key}.Name`, hint: `${S}.${key}.Hint`, scope: "world", config: true, type: Boolean, default: initial
    });

  // World scope: the GM picks the theme and every player's strip follows.
  game.settings.register(MODULE_ID, "theme", {
    name: `${S}.theme.Name`, hint: `${S}.theme.Hint`, scope: "world", config: true, type: String, default: "crimson",
    choices: { crimson: `${S}.theme.Crimson`, ash: `${S}.theme.Ash`, amethyst: `${S}.theme.Amethyst`, abyss: `${S}.theme.Abyss` },
    onChange: () => tracker?.applyTheme()
  });
  game.settings.register(MODULE_ID, "scale", {
    name: `${S}.scale.Name`, hint: `${S}.scale.Hint`, scope: "client", config: true, type: Number, default: 1,
    range: { min: 0.7, max: 1.5, step: 0.05 },
    onChange: () => tracker?.applyScale()
  });
  game.settings.register(MODULE_ID, "maxTurns", {
    name: `${S}.maxTurns.Name`, hint: `${S}.maxTurns.Hint`, scope: "world", config: true, type: Number, default: 8,
    range: { min: 3, max: 12, step: 1 }, onChange: rerender
  });
  game.settings.register(MODULE_ID, "playerNumbers", {
    name: `${S}.playerNumbers.Name`, hint: `${S}.playerNumbers.Hint`, scope: "world", config: true, type: String, default: "party",
    choices: { party: `${S}.playerNumbers.Party`, all: `${S}.playerNumbers.All` }, onChange: rerender
  });
  game.settings.register(MODULE_ID, "imageSource", {
    name: `${S}.imageSource.Name`, hint: `${S}.imageSource.Hint`, scope: "world", config: true, type: String, default: "actor",
    choices: { actor: `${S}.imageSource.Actor`, token: `${S}.imageSource.Token` }, onChange: rerender
  });
  toggle("skipDead", true);
  toggle("deathSavePrompt", true);
  toggle("roundBanner", true);
  toggle("bannerRoundOne", false);
  toggle("encounterEnd", true);
  game.settings.register(MODULE_ID, "hideCoreTracker", {
    name: `${S}.hideCoreTracker.Name`, hint: `${S}.hideCoreTracker.Hint`, scope: "world", config: true, type: Boolean, default: false,
    onChange: applyCoreTrackerVisibility
  });
  game.settings.register(MODULE_ID, "position", {
    scope: "client", config: false, type: Object, default: { ...DEFAULT_POSITION }
  });
});

Hooks.once("ready", () => {
  const stage = new Stage();
  stage.mount();
  tracker = new GrimPulse(stage);
  tracker.mount();
  applyCoreTrackerVisibility();
  game.modules.get(MODULE_ID).api = { tracker, stage, PHRASES };

  game.socket.on(SOCKET, (data) => tracker.receive(data));

  Hooks.on("updateCombat", (combat, changed) => tracker.onCombatUpdate(combat, changed));
  Hooks.on("deleteCombat", (combat) => tracker.onCombatDelete(combat));
  Hooks.on("updateActor", (actor) => tracker.onActorUpdate(actor));

  const refreshOn = [
    "createCombat", "combatStart",
    "createCombatant", "updateCombatant", "deleteCombatant",
    "updateToken",
    "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
    "renderCombatTracker", "canvasReady"
  ];
  for (const hook of refreshOn) Hooks.on(hook, () => tracker.schedule());
});
