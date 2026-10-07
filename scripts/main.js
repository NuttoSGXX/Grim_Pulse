/**
 * Grim Pulse - Combat Turn Tracker
 * Foundry VTT V13 / V14, written against the dnd5e system.
 *
 * The strip is a plain DOM element driven by Foundry's own Combat document.
 * It never keeps its own turn order: every render reads game.combat again.
 */

const MODULE_ID = "grim-pulse";
const DEFAULT_POSITION = { left: 130, top: 90 };
const BEAT_WIDTH = 120; // px width of one heartbeat in the ECG line. Keep in sync with the CSS keyframes.
const ECG_BEATS = 4;
const ACTIVE_STATUS_LIMIT = 6;
const QUEUED_STATUS_LIMIT = 4;
const BANNER_MS = 2600;
const MYSTERY_IMG = "icons/svg/mystery-man.svg";

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

/** Five splatter groups. Group b1 appears under 50% HP, one more for every further 10% lost. */
const BLOOD_SVG = `<svg class="gp-blood" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><g filter="url(#gp-rough)">
<g class="gp-b1"><circle cx="8" cy="10" r="10"/><circle cx="21" cy="6" r="3"/><circle cx="5" cy="26" r="3.5"/><circle cx="25" cy="19" r="2"/><rect x="7" y="14" width="3.2" height="24" rx="1.6"/></g>
<g class="gp-b2"><circle cx="91" cy="89" r="12"/><circle cx="76" cy="95" r="4"/><circle cx="97" cy="72" r="3"/><circle cx="81" cy="77" r="2"/></g>
<g class="gp-b3"><circle cx="89" cy="8" r="9"/><rect x="86" y="10" width="3.2" height="32" rx="1.6"/><circle cx="72" cy="5" r="3"/><circle cx="96" cy="24" r="2.5"/><rect x="93" y="12" width="2.2" height="17" rx="1.1"/></g>
<g class="gp-b4"><ellipse cx="4" cy="60" rx="8" ry="13"/><circle cx="15" cy="68" r="3"/><circle cx="11" cy="45" r="2"/><rect x="3" y="64" width="2.8" height="28" rx="1.4"/><circle cx="20" cy="92" r="6"/></g>
<g class="gp-b5"><ellipse cx="50" cy="97" rx="30" ry="8"/><circle cx="40" cy="84" r="3"/><circle cx="52" cy="3" r="8"/><rect x="50" y="5" width="3.2" height="24" rx="1.6"/><circle cx="64" cy="11" r="3.5"/><circle cx="35" cy="9" r="2.5"/></g>
</g></svg>`;

/** One shared filter that roughens the blood shapes so they do not read as clean circles. */
const SHARED_DEFS = `<svg id="grim-pulse-defs" width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
<filter id="gp-rough" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.085" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter>
</defs></svg>`;

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
      dead: false, blood: 0, beat: 1.4, amp: 0.6, canEndTurn: false
    };
  }

  const actor = combatant.actor;
  const dispo = DISPOSITION.get(combatant.token?.disposition ?? 0) ?? "neutral";
  const secret = dispo === "secret" && !isGM && !combatant.isOwner;
  const hp = readHp(actor);
  const pct = hp ? hp.pct : 1;
  const dead = Boolean(combatant.isDefeated) || (hp ? hp.value <= 0 : false);
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
    blood: dead ? 5 : bloodLevel(pct),
    beat: (1 + (1 - pct) * 2).toFixed(2), // seconds per heartbeat: 1s at full HP, 3s near death
    amp: (0.25 + 0.75 * pct).toFixed(2), // heartbeat height: full at full HP, a quarter near death
    canEndTurn: !isGM && combatant.isOwner
  };
}

/* ------------------------------------------------------------------ */
/*  The strip                                                          */
/* ------------------------------------------------------------------ */

class GrimPulse {
  constructor() {
    this.el = null;
    this.list = null;
    this.timer = null;
    this.rounds = new Map();
  }

  mount() {
    if (!document.getElementById("grim-pulse-defs")) document.body.insertAdjacentHTML("beforeend", SHARED_DEFS);

    const el = document.createElement("section");
    el.id = "grim-pulse";
    el.hidden = true;
    const gmButtons = game.user.isGM
      ? `<button type="button" data-action="prev" data-tooltip="${esc(loc("PrevTurn"))}" aria-label="${esc(loc("PrevTurn"))}"><i class="fa-solid fa-chevron-up"></i></button>
         <button type="button" data-action="next" data-tooltip="${esc(loc("NextTurn"))}" aria-label="${esc(loc("NextTurn"))}"><i class="fa-solid fa-chevron-down"></i></button>`
      : "";
    el.innerHTML = `
      <header class="gp-handle" data-tooltip="${esc(loc("HandleHint"))}">
        <i class="fa-solid fa-grip-vertical gp-grip"></i>
        <span class="gp-round"></span>
        <span class="gp-turn"></span>
        ${gmButtons}
      </header>
      <ol class="gp-list"></ol>`;
    document.body.appendChild(el);

    this.el = el;
    this.list = el.querySelector(".gp-list");
    this.applyTheme();
    this.applyScale();
    this.applyPosition(getSetting("position"));
    this.#bindDrag(el.querySelector(".gp-handle"));
    this.#bindList();
    window.addEventListener("resize", () => this.applyPosition(getSetting("position")));

    for (const combat of game.combats ?? []) this.rounds.set(combat.id, combat.round ?? 0);
    this.render();
  }

  /* ---------- appearance ---------- */

  applyTheme() {
    this.el.dataset.theme = getSetting("theme");
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
      if (ev.button !== 0 || ev.target.closest("button")) return;
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

    handle.addEventListener("dblclick", (ev) => {
      if (ev.target.closest("button")) return;
      this.applyPosition(DEFAULT_POSITION);
      game.settings.set(MODULE_ID, "position", { ...DEFAULT_POSITION });
    });

    handle.addEventListener("click", (ev) => {
      const action = ev.target.closest("button")?.dataset.action;
      if (action === "prev") game.combat?.previousTurn();
      if (action === "next") game.combat?.nextTurn();
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
      if (ev.target.closest('[data-action="end-turn"]')) {
        game.combat?.nextTurn();
        return;
      }
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
    const items = shown.map((name) => `<li>${esc(name)}</li>`).join("");
    const tail = more ? `<li class="gp-more">${esc(loc("MoreStatus", { n: more }))}</li>` : "";
    return `<ul class="gp-status">${items}${tail}</ul>`;
  }

  #rowHTML(entry) {
    const d = describe(entry);
    const stats = [];

    if (d.showNumbers && d.hp) {
      const temp = d.hp.temp ? ` <em>(+${d.hp.temp})</em>` : "";
      stats.push(`<span class="gp-hp"><i class="fa-solid fa-heart"></i>${d.hp.value}/${d.hp.max}${temp}</span>`);
    }
    if (entry.active && d.showNumbers && d.ac !== null) {
      stats.push(`<span class="gp-ac"><i class="fa-solid fa-shield-halved"></i>${d.ac}</span>`);
    }
    if (!entry.masked) {
      stats.push(`<span class="gp-init"><i class="fa-solid fa-dice-d20"></i>${d.init ?? "-"}</span>`);
    }

    const endTurn = entry.active && d.canEndTurn
      ? `<button type="button" class="gp-end" data-action="end-turn">${esc(loc("EndTurn"))}</button>`
      : "";

    const classes = ["gp-row", entry.active ? "gp-active" : "gp-queued"];
    if (d.dead) classes.push("gp-dead");

    return `
      <li class="${classes.join(" ")}" data-key="${esc(d.id)}" data-combatant-id="${esc(d.id)}"
          data-dispo="${d.dispo}" data-blood="${d.blood}" style="--gp-beat:${d.beat}s;--gp-amp:${d.amp}">
        <span class="gp-mark"></span>
        <div class="gp-card">
          <div class="gp-portrait"><img src="${esc(d.img)}" alt="" draggable="false">${d.blood ? BLOOD_SVG : ""}</div>
          <div class="gp-panel">
            ${d.dead ? ECG_FLAT : ECG_LIVE}
            <div class="gp-name">${esc(d.name)}</div>
            <div class="gp-stats">${stats.join("")}</div>
            ${endTurn}
          </div>
        </div>
        ${this.#statusHTML(d.statuses, entry.active ? ACTIVE_STATUS_LIMIT : QUEUED_STATUS_LIMIT)}
      </li>`;
  }

  render() {
    if (!this.el) return;
    const combat = game.combat;
    if (!combat?.started || !combat.turns?.length) {
      this.el.hidden = true;
      this.list.innerHTML = "";
      return;
    }
    this.el.hidden = false;

    const entries = this.#entries(combat);
    this.el.querySelector(".gp-round").textContent = loc("Round", { n: combat.round });
    this.el.querySelector(".gp-turn").textContent = `${(combat.turn ?? 0) + 1}/${combat.turns.length}`;

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

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
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

  /* ---------- round banner ---------- */

  onCombatUpdate(combat, changed) {
    if ("round" in changed) {
      const previous = this.rounds.get(combat.id) ?? 0;
      const round = combat.round ?? 0;
      const isMine = combat.id === game.combat?.id;
      const allowed = getSetting("roundBanner") && (round >= 2 || getSetting("bannerRoundOne"));
      if (isMine && combat.started && round > previous && allowed) this.showBanner(round);
    }
    this.rounds.set(combat.id, combat.round ?? 0);
    this.schedule();
  }

  showBanner(round) {
    document.getElementById("grim-pulse-banner")?.remove();
    const sparks = Array.from({ length: 16 }, () => {
      const left = 18 + Math.random() * 64;
      const top = -15 + Math.random() * 130;
      const delay = 0.45 + Math.random() * 1.1;
      const size = 8 + Math.random() * 14;
      return `<i class="gpb-spark" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;width:${size.toFixed(0)}px;height:${size.toFixed(0)}px;animation-delay:${delay.toFixed(2)}s"></i>`;
    }).join("");

    const banner = document.createElement("div");
    banner.id = "grim-pulse-banner";
    banner.dataset.theme = getSetting("theme");
    banner.innerHTML = `
      <div class="gpb-shade"></div>
      <div class="gpb-band">
        <div class="gpb-rule"></div>
        <div class="gpb-text">${esc(loc("Round", { n: round }))}</div>
        <div class="gpb-rule"></div>
        ${sparks}
      </div>`;
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), BANNER_MS + 200);
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

  game.settings.register(MODULE_ID, "theme", {
    name: `${S}.Theme.Name`, hint: `${S}.Theme.Hint`, scope: "client", config: true, type: String, default: "crimson",
    choices: { crimson: `${S}.Theme.Crimson`, ash: `${S}.Theme.Ash`, amethyst: `${S}.Theme.Amethyst`, abyss: `${S}.Theme.Abyss` },
    onChange: () => tracker?.applyTheme()
  });
  game.settings.register(MODULE_ID, "scale", {
    name: `${S}.Scale.Name`, hint: `${S}.Scale.Hint`, scope: "client", config: true, type: Number, default: 1,
    range: { min: 0.7, max: 1.5, step: 0.05 },
    onChange: () => tracker?.applyScale()
  });
  game.settings.register(MODULE_ID, "maxTurns", {
    name: `${S}.MaxTurns.Name`, hint: `${S}.MaxTurns.Hint`, scope: "world", config: true, type: Number, default: 8,
    range: { min: 3, max: 12, step: 1 }, onChange: rerender
  });
  game.settings.register(MODULE_ID, "playerNumbers", {
    name: `${S}.PlayerNumbers.Name`, hint: `${S}.PlayerNumbers.Hint`, scope: "world", config: true, type: String, default: "party",
    choices: { party: `${S}.PlayerNumbers.Party`, all: `${S}.PlayerNumbers.All` }, onChange: rerender
  });
  game.settings.register(MODULE_ID, "imageSource", {
    name: `${S}.ImageSource.Name`, hint: `${S}.ImageSource.Hint`, scope: "world", config: true, type: String, default: "actor",
    choices: { actor: `${S}.ImageSource.Actor`, token: `${S}.ImageSource.Token` }, onChange: rerender
  });
  game.settings.register(MODULE_ID, "roundBanner", {
    name: `${S}.RoundBanner.Name`, hint: `${S}.RoundBanner.Hint`, scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "bannerRoundOne", {
    name: `${S}.BannerRoundOne.Name`, hint: `${S}.BannerRoundOne.Hint`, scope: "world", config: true, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "hideCoreTracker", {
    name: `${S}.HideCoreTracker.Name`, hint: `${S}.HideCoreTracker.Hint`, scope: "world", config: true, type: Boolean, default: false,
    onChange: applyCoreTrackerVisibility
  });
  game.settings.register(MODULE_ID, "position", {
    scope: "client", config: false, type: Object, default: { ...DEFAULT_POSITION }
  });
});

Hooks.once("ready", () => {
  tracker = new GrimPulse();
  tracker.mount();
  applyCoreTrackerVisibility();
  game.modules.get(MODULE_ID).api = { tracker, showBanner: (round) => tracker.showBanner(round) };

  Hooks.on("updateCombat", (combat, changed) => tracker.onCombatUpdate(combat, changed));

  const refreshOn = [
    "createCombat", "deleteCombat", "combatStart",
    "createCombatant", "updateCombatant", "deleteCombatant",
    "updateActor", "updateToken",
    "createActiveEffect", "updateActiveEffect", "deleteActiveEffect",
    "renderCombatTracker", "canvasReady"
  ];
  for (const hook of refreshOn) Hooks.on(hook, () => tracker.schedule());
});
