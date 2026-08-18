/**
 * ac-control-card
 *
 * A compact Lovelace card for air-conditioning / heat-pump `climate` entities.
 * One rounded surface holds a row per room: a fan that spins with the unit and
 * a boost button beneath it, the room name, current temperature, target
 * temperature with a difference badge, operating status, and four controls.
 *
 * Supports one room (the original flat config) or several rooms via a `rooms:`
 * list, with a visual editor that can add, reorder, edit and remove rooms.
 *
 * No external dependencies: no button-card, no card-mod, no CDN, no fonts.
 * Icons come from Home Assistant's own <ha-icon>.
 *
 * Rendering note
 * --------------
 * A standalone `/local/` module cannot reliably obtain LitElement from the
 * Home Assistant frontend, and bundling a copy of Lit would mean shipping an
 * external library. So this is a plain custom element: it builds its shadow
 * DOM once, then performs targeted text/class/style updates. Nothing is ever
 * re-rendered wholesale, so a rapid sequence of +/- presses is never
 * interrupted mid-flight.
 *
 * Every room's state is computed only from that room's own entities. No value
 * is cached across rooms, so one unavailable room can never tint another.
 *
 * @license MIT
 */

/* -- embedded font: start (written by tools/embed-font.mjs) -- */
const FONT_DATA = "";
const FONT_FORMAT = "";
const FONT_MIME = "";
/* -- embedded font: end -- */

/**
 * Registers the embedded font once for the whole document, however many cards
 * are on the dashboard.
 *
 * The @font-face has to live in the document, not in a card's shadow root --
 * a face declared inside a shadow tree is not visible to it. The same style
 * node also sets --acc-font on every ac-control-card element, and that custom
 * property does cross into the shadow tree, which is how the card's own rules
 * pick the family up. With no font embedded nothing is injected at all and the
 * card inherits the dashboard's font exactly as it does today.
 */
const FONT_STYLE_ID = "ha-ac-control-embedded-font";

function installFont() {
  if (!FONT_DATA || typeof document === "undefined") return;
  if (document.getElementById(FONT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = FONT_STYLE_ID;
  style.textContent =
    "@font-face{font-family:'Choco Cooky';" +
    `src:url(data:${FONT_MIME};base64,${FONT_DATA}) format('${FONT_FORMAT}');` +
    "font-weight:normal;font-style:normal;font-display:swap}" +
    "ac-control-card{--acc-font:'Choco Cooky';}";
  (document.head || document.documentElement).appendChild(style);
}

installFont();

const CARD_TYPE = "ac-control-card";
const CARD_VERSION = "2026.8.18.4";

/* ------------------------------------------------------------------ config */

const DEFAULTS = Object.freeze({
  temperature_step: 0.5,
  show_name: true,
  show_boost: true,
  layout: "full",
});

/** Card layouts. `compact` is the small dashboard tile; `full` is the v1/v2 card. */
const LAYOUTS = Object.freeze(["full", "compact"]);

/** Per-room options. These may sit at the top level (single room) or in `rooms[]`. */
const ROOM_KEYS = [
  "room_name",
  "name",
  "icon",
  "climate_entity",
  "room_temp_entity",
  "target_temp_entity",
  "season_entity",
  "automation_cool_entity",
  "automation_heat_entity",
];

/** Per-room options that are entity ids. */
const ROOM_ENTITY_KEYS = ROOM_KEYS.filter((k) => k.endsWith("_entity"));

/** Options that apply to the whole card. */
const GLOBAL_KEYS = ["temperature_step", "show_name", "show_boost", "layout"];

/** Without these a room cannot render anything meaningful. */
const REQUIRED_ROOM_KEYS = ["climate_entity", "room_temp_entity", "target_temp_entity"];

/**
 * Fan-icon revolution time per `fan_mode`. Carried over unchanged from v1 so
 * the spin still reads as the unit's real fan speed.
 */
const SPEED_MAP = Object.freeze({
  silent: "4s",
  quiet: "3.2s",
  low: "3s",
  medium: "2s",
  mid: "2s",
  high: "1.2s",
  strong: "1s",
  full: "0.8s",
  max: "0.8s",
  turbo: "0.7s",
  auto: "1.6s",
});

const BOOST_SPEED = "0.5s";
const DEFAULT_SPEED = "1.6s";

/**
 * HVAC mode presentation. `key` is the CSS suffix, so colours live in the
 * stylesheet and stay themable through --acc-* custom properties. The glyph is
 * always the fan — only its colour and rotation change.
 */
const MODES = Object.freeze({
  off: { label: "OFF", key: "off" },
  cool: { label: "COOL", key: "cool" },
  heat: { label: "HEAT", key: "heat" },
  dry: { label: "DRY", key: "dry" },
  fan_only: { label: "FAN", key: "fan" },
  auto: { label: "AUTO", key: "auto" },
  heat_cool: { label: "AUTO", key: "auto" },
});

/**
 * Displayed word per `fan_mode`. Integrations spell the same speed differently,
 * so the label is normalised through the same vocabulary SPEED_MAP already uses
 * for the spin — `medium` and `mid` are one speed, and they read as one word.
 * Anything unlisted falls through as the integration's own value, upper-cased,
 * so a unit with its own names still shows what it actually reports.
 */
const FAN_LABELS = Object.freeze({
  silent: "SILENT",
  quiet: "QUIET",
  low: "LOW",
  medium: "MID",
  mid: "MID",
  middle: "MID",
  high: "HIGH",
  strong: "STRONG",
  full: "FULL",
  max: "MAX",
  turbo: "TURBO",
  auto: "AUTO",
});

/** `preset_mode` values that mean no special mode is running. */
const NEUTRAL_PRESETS = new Set(["none", "off", "normal", "standard", "default"]);

const FAN_ICON = "mdi:fan";

/** hvac_action values that mean the unit is sitting there doing nothing. */
const IDLE_ACTIONS = new Set(["off", "idle", "standby"]);

/** hvac_action values that move air without heating or cooling. */
const AIR_ONLY_ACTIONS = new Set(["fan", "drying", "dry"]);

/* ----------------------------------------------------------------- helpers */

const NON_VALUES = new Set(["unknown", "unavailable", "none", ""]);

/** True when `v` is a state string we can safely turn into a number. */
function isNumeric(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  if (s === "" || NON_VALUES.has(s.toLowerCase())) return false;
  return Number.isFinite(Number(s));
}

/** True when the entity exists and is not unavailable/unknown. */
function isAvailable(stateObj) {
  if (!stateObj) return false;
  const s = String(stateObj.state).toLowerCase();
  return s !== "unavailable" && s !== "unknown";
}

function clamp(n, lo, hi) {
  if (Number.isFinite(lo)) n = Math.max(lo, n);
  if (Number.isFinite(hi)) n = Math.min(hi, n);
  return n;
}

/** Kill float drift from repeated 0.5 additions (19.000000000000004). */
function tidy(n) {
  return Math.round(n * 1000) / 1000;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(name) {
  const i = document.createElement("ha-icon");
  if (name) i.setAttribute("icon", name);
  return i;
}

/* -------------------------------------------------------------------- card */

class AcControlCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._cfg = null;
    this._rooms = [];
    this._hass = null;
    this._built = false;
    this._el = {};
    /** Per-target-entity pending value, so rapid presses accumulate without
     *  ever being *displayed* before HA confirms them. */
    this._pending = new Map();
    /** Width watcher for the compact status lines; null in the full layout. */
    this._ro = null;
  }

  /* ------------------------------------------------------------- lifecycle */

  /**
   * Accepts either the flat single-room shape (v1, backwards compatible) or a
   * `rooms:` list. The flat shape is normalised into a one-entry list so the
   * rest of the card only ever deals with one code path.
   */
  static normaliseRooms(config) {
    if (Array.isArray(config.rooms)) {
      return config.rooms.map((r) => ({ ...r }));
    }
    const flat = {};
    for (const k of ROOM_KEYS) {
      if (config[k] !== undefined) flat[k] = config[k];
    }
    return [flat];
  }

  /**
   * Structural problems throw (the config is unusable); merely incomplete
   * configs do not, so the GUI editor stays usable while entities are still
   * being picked. Those surface as an in-card notice instead.
   */
  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error(`${CARD_TYPE}: configuration is missing.`);
    }
    if (config.rooms !== undefined && !Array.isArray(config.rooms)) {
      throw new Error(`${CARD_TYPE}: \`rooms\` must be a list.`);
    }

    const rooms = AcControlCard.normaliseRooms(config);
    if (!rooms.length) {
      throw new Error(
        `${CARD_TYPE}: \`rooms\` is empty. Add at least one room, or use the ` +
          "flat single-room form with climate_entity / room_temp_entity / " +
          "target_temp_entity.",
      );
    }

    rooms.forEach((room, i) => {
      const where = Array.isArray(config.rooms) ? `rooms[${i}]` : "config";
      for (const key of ROOM_ENTITY_KEYS) {
        const v = room[key];
        if (v !== undefined && v !== "" && (typeof v !== "string" || !v.includes("."))) {
          throw new Error(
            `${CARD_TYPE}: ${where}.${key} must be an entity id, got ${JSON.stringify(v)}.`,
          );
        }
      }
    });

    const step = Number(config.temperature_step);
    if (config.temperature_step !== undefined && (!Number.isFinite(step) || step <= 0)) {
      throw new Error(`${CARD_TYPE}: temperature_step must be a positive number.`);
    }

    if (config.layout !== undefined && !LAYOUTS.includes(config.layout)) {
      throw new Error(
        `${CARD_TYPE}: layout must be one of ${LAYOUTS.join(", ")}, got ` +
          `${JSON.stringify(config.layout)}.`,
      );
    }

    this._cfg = {
      ...DEFAULTS,
      ...config,
      temperature_step: Number.isFinite(step) && step > 0 ? step : DEFAULTS.temperature_step,
      // `compact: true` is accepted as a shorthand for `layout: compact`.
      layout: config.layout || (config.compact ? "compact" : DEFAULTS.layout),
    };
    this._rooms = rooms;

    this._built = false;
    this._pending.clear();
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  get hass() {
    return this._hass;
  }

  get _multi() {
    return this._rooms.length > 1;
  }

  /** True when the card renders as the small dashboard tile. */
  get _compact() {
    return !!this._cfg && this._cfg.layout === "compact";
  }

  /**
   * Roughly how tall the card renders, in px.
   *
   * A room row is not one fixed height: below the 430px breakpoint the controls
   * move onto their own line, which makes every row about 50% taller, and below
   * 280px everything shrinks again. Measuring the three layouts gives
   * `base + perRoom * rooms` in each case. The width is read from the element
   * when it is already on screen; before that we assume the *narrow* layout,
   * because guessing too small is what makes neighbouring cards overlap.
   */
  _estimatedHeightPx() {
    const n = this._rooms.length;
    const box = this.getBoundingClientRect ? this.getBoundingClientRect() : null;

    // Once the card is on screen its real height beats any formula, and above
    // the 520px tier it is the only thing that stays right: the type, the
    // controls and the padding all scale with the container there, so no fixed
    // per-room number describes every width.
    if (box && box.height > 0) return Math.ceil(box.height);

    // Before first layout, fall back to the measured shape of each tier.
    // A compact tile measures 71px on the narrow tier and 79px above it; the
    // larger number is the safe guess, since under-estimating is what makes
    // neighbouring cards overlap.
    if (this._compact) return 4 + 79 * n;
    const w = box ? box.width : 0;
    if (w > 520) return 46 + 151 * n; // wide tier, at its cap
    if (w > 431) return 11 + 106 * n; // controls share the room's line
    if (w && w <= 280) return 3 + 140 * n; // everything compact
    return 7 + 155 * n; // controls on their own line
  }

  /** Masonry counts in ~50px units. */
  getCardSize() {
    return Math.max(2, Math.ceil(this._estimatedHeightPx() / 50));
  }

  /**
   * Sections dashboard sizing. `rows: "auto"` asks Home Assistant to size the
   * grid row from what the card actually renders — the only thing that stays
   * right across the responsive breakpoints. A fixed row count cannot: the same
   * card is 117px wide-layout and 162px narrow-layout for a single room, so any
   * one number overlaps the neighbouring card at some width.
   */
  getGridOptions() {
    // The compact tile is a quarter of the section wide by default, so four sit
    // in a row on a desktop section. This is only the starting width -- the
    // dashboard's own layout editor owns it from there, and min_columns lets it
    // be dragged down to two per row.
    if (this._compact) {
      return { columns: 3, rows: "auto", min_columns: 2, min_rows: 1 };
    }
    return { columns: 12, rows: "auto", min_columns: 6, min_rows: 2 };
  }

  /** Pre-2024.11 name for the same thing, which has to name a row count. */
  getLayoutOptions() {
    const rows = this._gridRowsFor(this._estimatedHeightPx());
    if (this._compact) {
      return { grid_columns: 3, grid_rows: rows, grid_min_columns: 2, grid_min_rows: 1 };
    }
    return { grid_columns: 12, grid_rows: rows, grid_min_columns: 6, grid_min_rows: 2 };
  }

  /** HA grid rows are 56px tall with an 8px gap, so n rows hold 64n - 8 px. */
  _gridRowsFor(px) {
    return Math.max(2, Math.ceil((px + 8) / 64));
  }

  static getStubConfig() {
    return {
      type: `custom:${CARD_TYPE}`,
      rooms: [
        {
          room_name: "Room",
          climate_entity: "",
          room_temp_entity: "",
          target_temp_entity: "",
        },
      ],
    };
  }

  static async getConfigElement() {
    if (!customElements.get("ha-form")) return undefined;
    return document.createElement(`${CARD_TYPE}-editor`);
  }

  /* ------------------------------------------------------------ state read */

  _stateOf(id) {
    if (!id || !this._hass) return undefined;
    return this._hass.states[id];
  }

  _roomState(room, key) {
    return this._stateOf(room[key]);
  }

  _roomOn(room, key) {
    const s = this._roomState(room, key);
    return !!s && s.state === "on";
  }

  /** `on` on the season entity means heating season. Absent means cooling. */
  _isHeat(room) {
    return this._roomOn(room, "season_entity");
  }

  /**
   * Automation entity for the current season. The derivation is unchanged from
   * v1: `automation.<climate object id>_command` when cooling and
   * `..._command_winter` when heating, unless overridden.
   */
  _autoEntity(room) {
    const base = String(room.climate_entity || "").split(".")[1] || "";
    if (this._isHeat(room)) {
      return room.automation_heat_entity || (base ? `automation.${base}_command_winter` : "");
    }
    return room.automation_cool_entity || (base ? `automation.${base}_command` : "");
  }

  /**
   * Per-room HVAC descriptor, computed fresh from *this* room's climate entity
   * on every render. Never cached, never shared between rows.
   */
  _mode(room) {
    const s = this._roomState(room, "climate_entity");
    if (!isAvailable(s)) {
      return { label: "UNAVAILABLE", key: "na", on: false, available: false };
    }
    const m = MODES[s.state] || { label: String(s.state).toUpperCase(), key: "auto" };
    return { ...m, on: s.state !== "off", available: true };
  }

  /**
   * True when the unit is moving air: the fan spins for this, and only this.
   *
   * `hvac_action` is authoritative when the integration reports it, so a unit
   * that is on but coasting (idle) shows a stationary fan. Without it, being
   * in any mode other than `off` is the best signal available.
   */
  _blowing(room) {
    const s = this._roomState(room, "climate_entity");
    if (!isAvailable(s) || s.state === "off") return false;
    const action = s.attributes && s.attributes.hvac_action;
    if (action) return !IDLE_ACTIONS.has(String(action).toLowerCase());
    return true;
  }

  /** True when the unit is actually producing heat or cold (drives the glow). */
  _running(room) {
    if (!this._blowing(room)) return false;
    const s = this._roomState(room, "climate_entity");
    const action = s.attributes && s.attributes.hvac_action;
    if (action) return !AIR_ONLY_ACTIONS.has(String(action).toLowerCase());
    return true;
  }

  /** True when this room -- and only this room -- is in boost. */
  _boostActive(room) {
    const s = this._roomState(room, "climate_entity");
    if (!isAvailable(s)) return false;
    return (s.attributes && s.attributes.preset_mode) === "boost";
  }

  /**
   * What the unit is doing, as words, in descending priority:
   * MODE, FAN SPEED, SPECIAL MODE, TARGET.
   *
   * One list, two layouts. The full card prints `[0]` large and the rest as
   * muted context; the compact tile joins the lot into its status line and
   * drops from the tail when the tile is too narrow. Neither reads the climate
   * entity for itself, so the two can never disagree about what is running.
   *
   * A unit that is off or unavailable returns its single mode word and nothing
   * else — a stale fan speed next to OFF would be a lie.
   */
  /**
   * The same reading, labelled. The compact tile wants a flat list it can trim
   * from the tail; the full card wants to know which part is which so it can
   * put the mode and the fan on one line and the rest on the next.
   */
  _statusParts(room) {
    const mode = this._mode(room);
    const parts = { mode: mode.label, fan: null, special: null, target: null };
    if (!mode.available || !mode.on) return parts;

    const s = this._roomState(room, "climate_entity");
    const attrs = (s && s.attributes) || {};

    const fan = String(attrs.fan_mode === undefined ? "" : attrs.fan_mode).trim();
    if (fan && !NON_VALUES.has(fan.toLowerCase())) {
      parts.fan = FAN_LABELS[fan.toLowerCase()] || fan.toUpperCase();
    }

    // Whatever preset the integration says is running. Only presets that mean
    // "nothing special" are filtered out, so BOOST behaves exactly as before
    // while ECO / SLEEP / TURBO on units that expose them show up too. Nothing
    // is inferred: no preset attribute means no special mode.
    const preset = String(attrs.preset_mode === undefined ? "" : attrs.preset_mode).trim();
    const pre = preset.toLowerCase();
    if (preset && !NON_VALUES.has(pre) && !NEUTRAL_PRESETS.has(pre)) {
      parts.special = preset.toUpperCase().replace(/[_-]+/g, " ");
    }

    // The unit's own setpoint, which is not the same number as the card's
    // target helper: this is what the AC was actually told to hold. Skipped in
    // fan-only, where there is nothing to hold — some integrations still report
    // the last setpoint there, and printing it would read as a temperature the
    // unit is working towards.
    if (s.state !== "fan_only" && isNumeric(attrs.temperature)) {
      parts.target = this._setpointText(Number(attrs.temperature), this._degree(room));
    }
    return parts;
  }

  _statusBits(room) {
    const p = this._statusParts(room);
    return [p.mode, p.fan, p.special, p.target].filter(Boolean);
  }

  /**
   * How far the room is from its target, ready for the badge.
   *
   * Built only from two real numbers, so it can never print NaN or unknown;
   * `null` means one of them is missing and the badge stays hidden. The
   * at-target wording is passed in because a tile has no room for a phrase —
   * the arithmetic, the 0.05 dead band and the colour key are shared.
   */
  _delta(room, evenText) {
    const cur = this._roomState(room, "room_temp_entity");
    const tgt = this._roomState(room, "target_temp_entity");
    if (!(cur && isNumeric(cur.state)) || !(tgt && isNumeric(tgt.state))) return null;

    const diff = tidy(Number(cur.state) - Number(tgt.state));
    if (Math.abs(diff) < 0.05) return { text: evenText, key: "even" };
    return {
      text: `${diff > 0 ? "▲" : "▼"} ${this._num(Math.abs(diff))}${this._degree(room)}`,
      key: diff > 0 ? "above" : "below",
    };
  }

  /**
   * A temperature the user set, rather than one that was measured. These are
   * usually whole numbers, so the decimal is shown only when there really is
   * one: 19° stays 19°, and a half-step 19.5° is not rounded away to 20°.
   */
  _setpointText(value, deg) {
    return `${this._num(value, Number.isInteger(value) ? 0 : 1)}${deg}`;
  }

  _iconFor(room) {
    return room.icon || FAN_ICON;
  }

  /**
   * Palette key for the fan.
   *
   * The heating season paints every running fan red, whatever mode the unit
   * reports — a unit blowing warm air on `dry` or `auto` should not read as
   * cyan or purple. A unit that is off or unavailable keeps its muted colour,
   * since the season says nothing about a unit that is not running.
   */
  _iconKey(room, mode) {
    if (!mode.available || !mode.on) return mode.key;
    return this._isHeat(room) ? MODES.heat.key : mode.key;
  }

  _fanSpin(room) {
    if (!this._blowing(room)) return "none";
    const climate = this._roomState(room, "climate_entity");
    const attrs = (climate && climate.attributes) || {};
    const fan = String(attrs.fan_mode || "").toLowerCase();
    const duration = attrs.preset_mode === "boost" ? BOOST_SPEED : SPEED_MAP[fan] || DEFAULT_SPEED;
    return `acc-spin ${duration} linear infinite`;
  }

  _boostSupported(room) {
    if (this._cfg.show_boost === false) return false;
    const s = this._roomState(room, "climate_entity");
    const modes = s && s.attributes && s.attributes.preset_modes;
    if (Array.isArray(modes)) return modes.includes("boost");
    // Entity is unavailable or does not advertise its presets: keep the button
    // if boost is currently active, otherwise assume unsupported.
    return !!(s && s.attributes && s.attributes.preset_mode === "boost");
  }

  _tempUnit(room) {
    const cfgUnit =
      this._hass &&
      this._hass.config &&
      this._hass.config.unit_system &&
      this._hass.config.unit_system.temperature;
    if (cfgUnit) return cfgUnit;
    const s = room && this._roomState(room, "room_temp_entity");
    const u = s && s.attributes && s.attributes.unit_of_measurement;
    return u || "°C";
  }

  _degree(room) {
    const unit = this._tempUnit(room);
    return unit.startsWith("°") ? "°" : ` ${unit}`;
  }

  _locale() {
    const l = this._hass && this._hass.locale && this._hass.locale.language;
    return l || (typeof navigator !== "undefined" ? navigator.language : "en") || "en";
  }

  /** Locale-aware fixed-decimal number, e.g. "22,6" in de-DE. */
  _num(value, digits) {
    const d = digits === undefined ? 1 : digits;
    try {
      return new Intl.NumberFormat(this._locale(), {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      }).format(value);
    } catch (_e) {
      return Number(value).toFixed(d);
    }
  }

  _roomName(room) {
    if (room.room_name) return room.room_name;
    if (room.name) return room.name; // v1 spelling
    for (const k of ["climate_entity", "room_temp_entity", "target_temp_entity"]) {
      const s = this._roomState(room, k);
      if (s && s.attributes && s.attributes.friendly_name) return s.attributes.friendly_name;
    }
    const base = String(room.climate_entity || "").split(".")[1] || "";
    return base || "AC";
  }

  /* --------------------------------------------------------------- actions */

  _callService(domain, service, data, target) {
    if (!this._hass || typeof this._hass.callService !== "function") return;
    this._hass.callService(domain, service, data || {}, target);
  }

  /** Unchanged from v1: toggles the climate entity itself. */
  _pressPower(room, ev) {
    ev.stopPropagation();
    if (!room.climate_entity) return;
    if (!isAvailable(this._roomState(room, "climate_entity"))) return;
    this._callService("homeassistant", "toggle", {}, { entity_id: room.climate_entity });
  }

  /** Unchanged from v1: toggles the season-appropriate automation. */
  _pressAuto(room, ev) {
    ev.stopPropagation();
    const id = this._autoEntity(room);
    if (!id || !this._stateOf(id)) return;
    this._callService("homeassistant", "toggle", {}, { entity_id: id });
  }

  /** Unchanged from v1: flips the climate entity's boost preset. */
  _pressBoost(room, ev) {
    ev.stopPropagation();
    const s = this._roomState(room, "climate_entity");
    if (!isAvailable(s)) return;
    const cur = s.attributes && s.attributes.preset_mode;
    this._callService(
      "climate",
      "set_preset_mode",
      { preset_mode: cur === "boost" ? "none" : "boost" },
      { entity_id: room.climate_entity },
    );
  }

  /**
   * Step a room's target temperature.
   *
   * The new number is never written to the DOM -- the display only follows
   * `hass`. But the requested value is remembered per target entity so that
   * three fast taps go 19 -> 19.5 -> 20 -> 20.5 instead of sending 19.5 three
   * times while the round trip is still in flight.
   */
  _step(room, dir, ev) {
    ev.stopPropagation();
    const id = room.target_temp_entity;
    const s = this._stateOf(id);
    if (!isAvailable(s)) return;

    const attrs = s.attributes || {};
    const min = Number(attrs.min);
    const max = Number(attrs.max);
    const step = this._cfg.temperature_step;

    const base = this._effectiveTarget(room);
    if (!Number.isFinite(base)) return;

    const next = tidy(clamp(base + dir * step, min, max));
    if (next === base) return; // already at the limit

    this._pending.set(id, { value: next, at: Date.now() });
    this._callService("input_number", "set_value", { value: next }, { entity_id: id });
    this._syncStepButtons(this._refsFor(room), room);
  }

  /** Pending value if still fresh, else the confirmed state. */
  _effectiveTarget(room) {
    const id = room.target_temp_entity;
    const p = this._pending.get(id);
    if (p && Date.now() - p.at < 4000) return p.value;
    const s = this._stateOf(id);
    return s && isNumeric(s.state) ? Number(s.state) : NaN;
  }

  /** What a tap on the card body will do, for the row's aria-label. */
  _tapSays(mode) {
    const action = (this._cfg.tap_action && this._cfg.tap_action.action) || "toggle";
    if (action === "toggle") return mode.on ? "Turn off." : "Turn on.";
    if (action === "more-info") return "Opens the full controls.";
    return "";
  }

  /**
   * Which room a click landed on.
   *
   * The event path is walked rather than `target`, because the click may have
   * landed on a nested element inside the row -- or inside the shadow tree,
   * where `target` is retargeted to the host.
   *
   * A click on the card's own padding, outside any row, still counts for a
   * single-room card: there is only one unit it could mean. On a multi-room
   * card it is ignored, since guessing would toggle the wrong room.
   */
  _roomFromEvent(ev) {
    const path = typeof ev.composedPath === "function" ? ev.composedPath() : [];
    const row = path.find(
      (n) => n && n.classList && n.classList.contains("roomrow"),
    );
    if (row) {
      const i = this._el.rooms.findIndex((r) => r.row === row);
      if (i !== -1) return this._rooms[i];
    }
    return this._multi ? null : this._rooms[0];
  }

  _fireMoreInfo(entityId) {
    if (!entityId) return;
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        detail: { entityId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Minimal but correct support for HA's standard action config. */
  _cardAction(room) {
    // A tap anywhere that is not a button turns the unit on or off, in both
    // layouts. On the full card that is every part of a room row except boost,
    // minus, plus, power and AUTO, each of which stops the event itself.
    // Replaced outright by an explicit `tap_action`.
    const fallback = { action: "toggle" };
    const cfg = this._cfg.tap_action || fallback;
    const r = room || this._rooms[0] || {};
    const fallbackEntity = r.climate_entity || r.room_temp_entity || r.target_temp_entity;

    switch (cfg.action) {
      case "none":
        return;
      case "more-info":
        this._fireMoreInfo(cfg.entity || fallbackEntity);
        return;
      case "toggle": {
        const id = cfg.entity || r.climate_entity;
        if (id) this._callService("homeassistant", "toggle", {}, { entity_id: id });
        return;
      }
      case "navigate":
        if (cfg.navigation_path) {
          history.pushState(null, "", cfg.navigation_path);
          window.dispatchEvent(
            new CustomEvent("location-changed", { bubbles: true, composed: true }),
          );
        }
        return;
      case "url":
        if (cfg.url_path) window.open(cfg.url_path, cfg.new_tab === false ? "_self" : "_blank");
        return;
      case "call-service":
      case "perform-action": {
        const full = cfg.perform_action || cfg.service;
        if (!full || !full.includes(".")) return;
        const [d, s] = full.split(".");
        this._callService(d, s, cfg.data || cfg.service_data || {}, cfg.target);
        return;
      }
      default:
        this._fireMoreInfo(fallbackEntity);
    }
  }

  /* ----------------------------------------------------------------- build */

  _refsFor(room) {
    return this._el.rooms[this._rooms.indexOf(room)];
  }

  _buildControls(room) {
    const wrap = el("div", "controls");

    const mk = (cls, label, child) => {
      const b = el("button", `ctl ${cls}`);
      b.type = "button";
      b.title = label;
      if (typeof child === "string") b.textContent = child;
      else b.appendChild(child);
      b.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      });
      wrap.appendChild(b);
      return b;
    };

    const minus = mk("minus", "Lower target temperature", icon("mdi:minus"));
    const plus = mk("plus", "Raise target temperature", icon("mdi:plus"));
    const power = mk("power", "Toggle the air conditioner", icon("mdi:power"));
    const auto = mk("auto", "Toggle automatic control", "AUTO");

    minus.addEventListener("click", (e) => this._step(room, -1, e));
    plus.addEventListener("click", (e) => this._step(room, +1, e));
    power.addEventListener("click", (e) => this._pressPower(room, e));
    auto.addEventListener("click", (e) => this._pressAuto(room, e));

    return { wrap, minus, plus, power, auto };
  }

  /**
   * The far-left stack: the fan above, the boost control directly beneath it.
   *
   * Boost lives here rather than in the right-hand control row so that row
   * stays four buttons wide at every width -- on a phone the four fit one line
   * instead of wrapping AUTO onto a second.
   */
  _buildStatusCol(room) {
    const col = el("div", "statuscol");

    const box = el("div", "modeicon");
    box.setAttribute("aria-hidden", "true");
    box.appendChild(icon(FAN_ICON));

    const boost = el("button", "ctl boost");
    boost.type = "button";
    boost.title = "Toggle boost";
    boost.appendChild(icon("mdi:rocket-launch"));
    boost.addEventListener("click", (e) => this._pressBoost(room, e));
    boost.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") e.stopPropagation();
    });

    col.append(box, boost);
    return { col, box, glyph: box.firstChild, boost };
  }

  _buildRoomText() {
    const text = el("div", "roomtext");
    const name = el("div", "name");
    const cur = el("div", "big cur");
    const line = el("div", "targetline");
    const target = el("span", "target", "Target —");
    const delta = el("span", "delta");
    delta.hidden = true;
    line.append(target);
    const status = el("div", "status");
    const statusOne = el("div", "statusline one");
    const statusMain = el("span", "statusmain", "—");
    const statusSub = el("span", "statussub");
    statusOne.append(statusMain, statusSub);
    // Second line: the special mode and the setpoint. Hidden when there is
    // neither, so an off unit stays a single word.
    const statusTwo = el("div", "statusline two");
    status.append(statusOne, statusTwo);
    // The badge sits on the status line rather than under the target: it is the
    // one thing small enough to share that row, and moving it frees the line
    // the target was hanging from. Every card is built this way, however many
    // rooms it holds -- a lone room stacking the target over the badge made
    // .targetline 64px tall next to a 30px temperature, and left the card with
    // about 27px of nothing below everything it draws.
    text.append(name, cur, line, delta, status);
    return { text, name, cur, target, delta, status, statusMain, statusSub, statusTwo };
  }

  /**
   * The compact tile: fan, current temperature, room name, target. No controls,
   * no boost, no status line — tapping it opens the full controls instead.
   *
   * One tile per configured room, so a single-room card is a single tile and a
   * multi-room card flows them. The fan reuses the full card's `.modeicon`
   * classes and `_fanSpin()`, so its colour and its spin mean exactly the same
   * thing in both layouts.
   */
  _buildCompact() {
    const root = this.shadowRoot;
    root.innerHTML = `<style>${AcControlCard.styles}</style>`;
    // Lets the stylesheet reach the host, which is where the card radius lives.
    this.setAttribute("data-layout", "compact");

    const card = document.createElement("ha-card");
    card.className = "compact";

    const surface = el("div", "surface compact");
    const notice = el("div", "notice");
    notice.hidden = true;
    surface.appendChild(notice);

    this._el = { surface, notice, rooms: [] };

    const list = el("div", "ctiles");
    for (const room of this._rooms) {
      const tile = el("button", "ctile");
      tile.type = "button";

      const box = el("div", "modeicon");
      box.setAttribute("aria-hidden", "true");
      box.appendChild(icon(FAN_ICON));

      const cur = el("div", "ccur", "—");
      const name = el("div", "cname");

      // Badge and target share the right-hand slot so the badge sits directly
      // before the number it is the difference from, and the room name on the
      // left absorbs whatever width they need.
      const right = el("div", "cright");
      const delta = el("span", "delta");
      delta.hidden = true;
      const target = el("span", "ctarget");
      right.append(delta, target);

      // One flex line rather than two grid cells: the name is the only thing
      // here that may shrink, and a grid item cannot be pushed below its
      // min-content width -- the badge would sit on top of the name instead.
      const info = el("div", "cinfo");
      info.append(name, right);

      // Four fixed slots, one per status bit, so trimming a line that does not
      // fit is a matter of hiding the last few rather than rebuilding text.
      const status = el("div", "cstatus");
      const statusBits = [0, 1, 2, 3].map(() => {
        const b = el("span", "cbit");
        b.hidden = true;
        status.appendChild(b);
        return b;
      });

      tile.append(box, cur, info, status);
      tile.addEventListener("click", (e) => {
        e.stopPropagation();
        this._cardAction(room);
      });

      list.appendChild(tile);
      this._el.rooms.push({
        row: tile,
        modeIcon: box,
        modeGlyph: box.firstChild,
        cur,
        name,
        target,
        delta,
        status,
        statusBits,
      });
    }

    surface.appendChild(list);
    card.appendChild(surface);
    root.appendChild(card);
    this._observeWidth(card);
    this._built = true;
  }

  /**
   * Re-fit the status lines when the card changes width.
   *
   * Container queries handle the type size, but how much text fits is a
   * measurement, not a breakpoint — dragging a tile one column narrower has to
   * re-run it. Guarded because ResizeObserver is absent in some test runners.
   */
  _observeWidth(card) {
    this._unobserveWidth();
    if (typeof ResizeObserver !== "function") return;
    this._ro = new ResizeObserver(() => this._fitAllStatus());
    this._ro.observe(card);
  }

  _unobserveWidth() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
  }

  disconnectedCallback() {
    this._unobserveWidth();
  }

  connectedCallback() {
    if (!this._built || !this._compact) return;
    // Re-attaching a card that was moved in the DOM must not lose its observer.
    if (!this._ro) {
      const card = this.shadowRoot && this.shadowRoot.querySelector("ha-card");
      if (card) this._observeWidth(card);
    }
    // A card built before it was inserted measured zero and skipped its fit.
    // Doing it here rather than waiting for the observer keeps it correct on a
    // dashboard tab that is not visible yet, where the frame loop -- and with
    // it every ResizeObserver callback -- is parked.
    this._fitAllStatus();
  }

  _build() {
    if (this._compact) return this._buildCompact();

    this._unobserveWidth();
    const root = this.shadowRoot;
    root.innerHTML = `<style>${AcControlCard.styles}</style>`;
    this.removeAttribute("data-layout");

    const card = document.createElement("ha-card");
    const surface = el("div", "surface");

    const notice = el("div", "notice");
    notice.hidden = true;
    surface.appendChild(notice);

    this._el = { surface, notice, rooms: [] };

    const list = el("div", "rooms");
    // Lets the stylesheet treat a stack of rooms differently from a single
    // one without any of it depending on how many rooms there happen to be.
    list.classList.toggle("multi", this._multi);
    for (const room of this._rooms) {
      const row = el("div", "roomrow");
      // Each row is its own control: a tap anywhere on it that is not one of
      // the buttons toggles that room's unit. The buttons all stop
      // propagation, so they never reach this.
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          this._cardAction(room);
        }
      });
      const status = this._buildStatusCol(room);
      const t = this._buildRoomText();
      const c = this._buildControls(room);
      row.append(status.col, t.text, c.wrap);
      list.appendChild(row);
      this._el.rooms.push({
        row,
        statusCol: status.col,
        modeIcon: status.box,
        modeGlyph: status.glyph,
        boost: status.boost,
        name: t.name,
        cur: t.cur,
        target: t.target,
        delta: t.delta,
        status: t.status,
        statusMain: t.statusMain,
        statusSub: t.statusSub,
        statusTwo: t.statusTwo,
        minus: c.minus,
        plus: c.plus,
        power: c.power,
        auto: c.auto,
      });
    }
    surface.appendChild(list);

    surface.addEventListener("click", (e) => {
      const room = this._roomFromEvent(e);
      if (room) this._cardAction(room);
    });

    card.appendChild(surface);
    root.appendChild(card);
    this._built = true;
  }

  /* ---------------------------------------------------------------- render */

  _render() {
    if (!this._cfg || !this._hass) return;
    if (!this._built) this._build();

    this._renderNotice();
    this._rooms.forEach((room, i) => {
      const refs = this._el.rooms[i];
      if (this._compact) {
        this._renderCompactRoom(refs, room);
        return;
      }
      this._renderRoom(refs, room);
      this._renderControls(refs, room);
    });
  }

  /**
   * Compact tile contents. Deliberately only the few things the tile shows —
   * the numbers come from the same entities and the same helpers the full card
   * uses, so the two layouts can never disagree about a temperature.
   */
  _renderCompactRoom(refs, room) {
    const mode = this._mode(room);
    const deg = this._degree(room);
    const bits = this._statusBits(room);

    refs.row.classList.toggle("unavailable", !mode.available);

    refs.modeIcon.className =
      `modeicon m-${this._iconKey(room, mode)}${this._running(room) ? " running" : ""}`;
    refs.modeGlyph.setAttribute("icon", this._iconFor(room));
    refs.modeGlyph.style.animation = this._fanSpin(room);

    const cur = this._roomState(room, "room_temp_entity");
    const curOk = cur && isNumeric(cur.state);
    refs.cur.textContent = curOk ? `${this._num(Number(cur.state))}${deg}` : "—";

    const tgt = this._roomState(room, "target_temp_entity");
    const tgtOk = !!(tgt && isNumeric(tgt.state));
    refs.target.textContent = tgtOk ? this._setpointText(Number(tgt.state), deg) : "—";

    // Same badge as the full card, sitting just before the target. "at target"
    // is spelled 0° here: the tile cannot spare the width for the phrase.
    const delta = this._delta(room, `0${deg}`);
    refs.delta.hidden = !delta;
    refs.delta.textContent = delta ? delta.text : "";
    if (delta) refs.delta.className = `delta ${delta.key}`;

    const name = this._roomName(room);
    if (this._cfg.show_name === false) {
      refs.name.hidden = true;
      refs.name.textContent = "";
    } else {
      refs.name.hidden = false;
      refs.name.textContent = name;
    }

    // Live operating state. The colour follows the same palette key as the fan
    // above it — including the heating-season override — so a tile never shows
    // a blue word under a red fan. An off or unavailable unit gets exactly one
    // muted word.
    refs.status.className = `cstatus m-${this._iconKey(room, mode)}${mode.on ? "" : " muted"}`;
    refs.statusBits.forEach((span, i) => {
      span.textContent = bits[i] === undefined ? "" : bits[i];
      span.hidden = i >= bits.length;
    });
    this._fitStatus(refs);

    // Announce whatever the tap will actually do, so the label cannot drift
    // from a configured tap_action.
    const says = this._tapSays(mode);

    refs.row.setAttribute("aria-pressed", String(mode.available && mode.on));
    // Always the complete status, even when the visible line had to drop a bit
    // to fit: a narrow tile must not also mean less for a screen reader.
    refs.row.setAttribute(
      "aria-label",
      `${name}. ${bits.join(", ")}. ` +
        `Current ${curOk ? this._num(Number(cur.state)) + deg : "unavailable"}, ` +
        `target ${tgtOk ? this._setpointText(Number(tgt.state), deg) : "unavailable"}. ` +
        says,
    );
  }

  /**
   * Trim a status line until it fits its tile, dropping the lowest-priority
   * bit first: TARGET, then SPECIAL MODE, then FAN SPEED. The mode word is
   * index 0 and never goes — a tile always says what the unit is doing.
   *
   * Everything stays visible while it fits, which is why nothing is ever
   * dropped at tablet or desktop widths.
   */
  _fitStatus(refs) {
    const line = refs.status;
    if (!line || !refs.statusBits) return;
    const shown = refs.statusBits.filter((b) => b.textContent !== "");
    shown.forEach((b) => (b.hidden = false));

    // A card in a hidden pane, or one that has not been laid out yet, measures
    // zero. Trimming against that would hide information for no reason, and the
    // ResizeObserver re-runs this the moment it does have a width.
    if (line.clientWidth <= 0) return;

    for (let i = shown.length - 1; i > 0 && line.scrollWidth > line.clientWidth; i--) {
      shown[i].hidden = true;
    }
  }

  _fitAllStatus() {
    if (!this._compact || !this._el || !this._el.rooms) return;
    this._el.rooms.forEach((refs) => this._fitStatus(refs));
  }

  /**
   * Two different problems, one strip: entities named in the config that the
   * backend does not know about, and rooms that are not fully configured yet.
   */
  _renderNotice() {
    const missing = [];
    const unconfigured = [];

    this._rooms.forEach((room) => {
      const gaps = REQUIRED_ROOM_KEYS.filter((k) => !room[k]);
      if (gaps.length) {
        unconfigured.push(this._multi ? `${this._roomName(room)} (${gaps.join(", ")})` : gaps.join(", "));
      }
      for (const k of ROOM_ENTITY_KEYS) {
        if (room[k] && !this._hass.states[room[k]]) missing.push(room[k]);
      }
    });

    const lines = [];
    if (unconfigured.length) lines.push(`Not configured yet: ${unconfigured.join("; ")}`);
    if (missing.length) lines.push(`Entity not found: ${[...new Set(missing)].join(", ")}`);

    const n = this._el.notice;
    if (!lines.length) {
      n.hidden = true;
      n.textContent = "";
      return;
    }
    n.hidden = false;
    n.textContent = lines.join(" · ");
  }

  _renderRoom(refs, room) {
    const mode = this._mode(room);
    const deg = this._degree(room);
    const heat = this._isHeat(room);

    refs.row.classList.toggle("unavailable", !mode.available);

    refs.modeIcon.className =
      `modeicon m-${this._iconKey(room, mode)}${this._running(room) ? " running" : ""}`;
    refs.modeGlyph.setAttribute("icon", this._iconFor(room));
    refs.modeGlyph.style.animation = this._fanSpin(room);

    // Status over two lines: what it is doing and how hard on the first,
    // anything special and the setpoint on the second. Both come from the
    // labelled helper the compact tile also reads, so the two layouts can
    // never describe the unit differently.
    const parts = this._statusParts(room);
    refs.statusMain.textContent = parts.mode;
    refs.status.className = `status m-${mode.key}`;
    refs.statusSub.textContent = parts.fan ? ` · ${parts.fan}` : "";
    const second = [parts.special, parts.target].filter(Boolean).join(" · ");
    refs.statusTwo.textContent = second;
    // Left in place when empty rather than hidden: every row keeps the same
    // height whether its unit is running or off, which is the whole point of
    // the rows lining up across a multi-room card.
    refs.statusTwo.hidden = false;

    if (this._cfg.show_name === false) {
      refs.name.hidden = true;
    } else {
      refs.name.hidden = false;
      refs.name.textContent = this._roomName(room);
    }

    const cur = this._roomState(room, "room_temp_entity");
    const curOk = cur && isNumeric(cur.state);
    refs.cur.textContent = curOk ? `${this._num(Number(cur.state))}${deg}` : "—";

    const tgt = this._roomState(room, "target_temp_entity");
    // Must stay a real boolean: classList.toggle(name, undefined) *toggles*
    // rather than forcing, which would let both classes accumulate.
    const tgtOk = !!(tgt && isNumeric(tgt.state));
    refs.target.textContent = tgtOk ? `Target ${this._num(Number(tgt.state))}${deg}` : "Target —";
    // v1 tinted the destination temperature by season. Only rooms that
    // actually configure a season entity get the tint; the rest stay neutral.
    const seasonKnown = !!room.season_entity;
    refs.target.classList.toggle("heat", tgtOk && seasonKnown && heat);
    refs.target.classList.toggle("cool", tgtOk && seasonKnown && !heat);

    // Drop the pending value once HA confirms it.
    const p = this._pending.get(room.target_temp_entity);
    if (p && tgtOk && Number(tgt.state) === p.value) {
      this._pending.delete(room.target_temp_entity);
    }

    // Difference badge, from the same helper the compact tile uses.
    const d = refs.delta;
    const delta = this._delta(room, "at target");
    if (delta) {
      d.hidden = false;
      d.textContent = delta.text;
      d.className = `delta ${delta.key}`;
    } else {
      d.hidden = true;
      d.textContent = "";
    }

    refs.row.setAttribute("aria-pressed", String(mode.available && mode.on));
    refs.row.setAttribute(
      "aria-label",
      `${this._roomName(room)}. ${mode.label}. ` +
        `Current ${curOk ? this._num(Number(cur.state)) + deg : "unavailable"}, ` +
        `target ${tgtOk ? this._num(Number(tgt.state)) + deg : "unavailable"}. ` +
        this._tapSays(mode),
    );
  }

  _renderControls(refs, room) {
    const name = this._roomName(room);
    const mode = this._mode(room);

    // Power follows the climate entity only. Assigned wholesale so a mode
    // change cannot leave the previous mode's colour class behind.
    const powerOn = mode.available && mode.on;
    refs.power.disabled = !mode.available;
    refs.power.className = `ctl power m-${mode.key}${powerOn ? " on" : ""}`;
    refs.power.setAttribute("aria-pressed", String(powerOn));
    refs.power.setAttribute(
      "aria-label",
      `${name}: ${mode.label}. ${mode.on ? "Turn off" : "Turn on"}`,
    );

    // Boost lives under the fan but follows the climate entity only, exactly
    // as it did when it sat in the control row.
    const boostable = this._boostSupported(room);
    refs.boost.hidden = !boostable;
    if (boostable) {
      const boostOn = this._boostActive(room);
      refs.boost.disabled = !mode.available;
      refs.boost.classList.toggle("on", boostOn);
      refs.boost.setAttribute("aria-pressed", String(boostOn));
      refs.boost.setAttribute(
        "aria-label",
        `${name}: boost ${mode.available ? (boostOn ? "on" : "off") : "unavailable"}`,
      );
    }

    // AUTO follows its own automation entity, which may be fine even when the
    // climate entity is not.
    const autoId = this._autoEntity(room);
    const autoState = this._stateOf(autoId);
    const autoKnown = isAvailable(autoState);
    const autoOn = autoKnown && autoState.state === "on";
    refs.auto.hidden = !autoId;
    refs.auto.disabled = !autoKnown;
    refs.auto.classList.toggle("on", autoOn);
    refs.auto.classList.toggle("off", autoKnown && !autoOn);
    refs.auto.setAttribute("aria-pressed", String(autoOn));
    refs.auto.setAttribute(
      "aria-label",
      `${name}: automatic control ${autoKnown ? (autoOn ? "enabled" : "disabled") : "unavailable"}`,
    );
    refs.auto.title = autoKnown
      ? `Automatic control is ${autoOn ? "on" : "off"} — tap to toggle (${autoId})`
      : `Automation unavailable (${autoId})`;

    // +/- follow the target helper only.
    this._syncStepButtons(refs, room);
  }

  /** Disable +/- when the helper is unusable or already at its own min/max. */
  _syncStepButtons(refs, room) {
    if (!refs) return;
    const s = this._stateOf(room.target_temp_entity);
    if (!isAvailable(s)) {
      refs.plus.disabled = true;
      refs.minus.disabled = true;
      return;
    }
    const a = s.attributes || {};
    const min = Number(a.min);
    const max = Number(a.max);
    const cur = this._effectiveTarget(room);

    if (!Number.isFinite(cur)) {
      refs.plus.disabled = true;
      refs.minus.disabled = true;
      return;
    }
    const step = this._cfg.temperature_step;
    refs.plus.disabled = Number.isFinite(max) && tidy(cur + step) > max;
    refs.minus.disabled = Number.isFinite(min) && tidy(cur - step) < min;

    const deg = this._degree(room);
    const name = this._roomName(room);
    refs.plus.setAttribute("aria-label", `${name}: raise target by ${this._num(step)}${deg}`);
    refs.minus.setAttribute("aria-label", `${name}: lower target by ${this._num(step)}${deg}`);
  }

  /* ----------------------------------------------------------------- style */

  static get styles() {
    return `
      /* Sections and masonry views already space cards apart, so no margin by
         default. Set --ac-control-card-gap to add one inside a container that
         does not, such as vertical-stack. */
      :host {
        display: block;
        margin-bottom: var(--ac-control-card-gap, 0px);
      }

      /* ha-card's own border reads theme custom properties, and on the first
         paint after a view change those are not resolved yet: the width falls
         back to its initial value (medium, 3px) in a near-white, and ha-card's
         blanket 0.3s ease-out transition then fades it away. The result is a
         white line flashing around the card every time the view is opened.
         Restating the border here with fallbacks that cannot resolve to a
         visible colour, and dropping the transition, removes the flash without
         changing how the card looks once the theme has loaded — any theme that
         sets these properties still gets exactly the border it asked for. */
      ha-card {
        container-type: inline-size;
        container-name: acc;
        overflow: hidden;
        height: 100%;
        box-sizing: border-box;
        border-width: var(--ha-card-border-width, 1px);
        border-color: var(--ha-card-border-color, var(--divider-color, transparent));
        transition: none;
      }

      .surface {
        padding: 14px 16px;
        box-sizing: border-box;
        height: 100%;
        cursor: pointer;
        outline: none;
      }
      .roomrow:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--primary-color, #03a9f4);
        border-radius: 10px;
      }

      .notice {
        margin: 0 0 8px;
        padding: 5px 9px;
        border-radius: 8px;
        font-size: 12px;
        line-height: 1.3;
        color: var(--warning-color, #ffa726);
        background: rgba(255, 167, 38, 0.14);
      }

      section { min-width: 0; }
      [hidden] { display: none !important; }

      /* ============================================================== rooms */
      .rooms { display: flex; flex-direction: column; }

      /* First row sits against the top padding -- nothing above it. */
      .roomrow:first-child { padding-top: 2px; }
      .roomrow:last-child { padding-bottom: 2px; }

      .roomrow {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        /* Top-align so the icon relates to the name / temperature group rather
           than being centred against the whole row height. Controls opt back
           into centring. */
        align-items: start;
        gap: 12px;
        padding: 11px 0;
      }
      .roomrow + .roomrow {
        border-top: 1px solid var(--divider-color, rgba(128,128,128,0.25));
      }
      .roomrow > .controls { align-self: center; }
      .roomrow.unavailable .roomtext { opacity: 0.55; }

      .roomtext {
        min-width: 0;
        display: grid;
        grid-template-columns: auto auto;
        align-items: baseline;
        column-gap: 10px;
        row-gap: 1px;
      }
      .name { grid-column: 1 / -1; }
      .status { grid-column: 1 / -1; margin-top: 2px; }

      .big {
        font-size: 24px;
        font-weight: 600;
        line-height: 1.05;
        color: var(--primary-text-color, #e1e1e1);
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.01em;
      }
      .unit {
        font-size: 15px;
        font-weight: 500;
        font-style: normal;
        color: var(--secondary-text-color, #8a8a8a);
        margin-left: 2px;
      }
      .big.cur { margin-top: 1px; }

      .name {
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--secondary-text-color, #8a8a8a);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .targetline {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        font-size: 15px;
        font-weight: 600;
        color: var(--secondary-text-color, #8a8a8a);
        font-variant-numeric: tabular-nums;
      }
      /* Keep "Target 20.0°" whole -- it may wrap away from the badge, but it
         must never break into "Target" / "20.0°". */
      .target { white-space: nowrap; }
      /* v1 coloured the destination temperature by season. */
      .target.cool { color: var(--acc-target-cool, #23aa08); }
      .target.heat { color: var(--acc-target-heat, #fc0000); }

      .delta {
        font-size: 12px;
        font-weight: 700;
        padding: 1px 7px;
        border-radius: 999px;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .delta.above { color: var(--acc-above, #29b6f6); background: rgba(41,182,246,0.15); }
      .delta.below { color: var(--acc-below, #ffa726); background: rgba(255,167,38,0.16); }
      .delta.even  { color: var(--secondary-text-color, #8a8a8a); background: rgba(128,128,128,0.16); }

      .status {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--disabled-text-color, #6f6f6f);
        transition: color 0.3s ease;
      }
      /* Two lines: what it is doing and how hard, then anything special and the
         setpoint. Each clips on its own so a long preset name cannot push the
         other line about, and the second is simply absent when there is nothing
         to put on it. A tight line-height keeps the pair close enough to read
         as one block rather than two separate remarks. */
      .statusline {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.25;
      }
      /* Holds its line even while empty, so rows keep a common height. */
      .statusline.two { opacity: 0.85; min-height: 1.25em; }
      .statussub { opacity: 0.75; font-weight: 600; }

      /* ================================================= left status column */
      /* Fan above, boost read-out below. The column is narrower than the text
         block is tall, so the badge never adds to the row height. */
      .statuscol {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        margin-top: 2px;
        min-width: 0;
      }

      /* The boost control mirrors the fan square above it exactly: same box,
         same radius, same icon size. Icon only -- no label. */
      .ctl.boost {
        width: 38px;
        height: 38px;
        min-width: 38px;
        min-height: 38px;
        padding: 0;
        border-radius: 12px;
        display: grid;
        place-items: center;
      }
      .ctl.boost ha-icon { --mdc-icon-size: 22px; width: 22px; height: 22px; }
      .ctl.boost.on {
        color: var(--acc-boost, #ffa31a);
        background: rgba(255, 163, 26, 0.18);
      }

      /* ========================================================== mode icon */
      .modeicon {
        position: relative;
        flex: 0 0 auto;
        width: 38px;
        height: 38px;
        display: grid;
        place-items: center;
        border-radius: 12px;
        color: var(--disabled-text-color, #6f6f6f);
        transition: color 0.3s ease;
      }
      .modeicon::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: currentColor;
        opacity: 0.14;
        transition: opacity 0.3s ease;
      }
      .modeicon ha-icon {
        position: relative;
        display: block;
        --mdc-icon-size: 22px;
        width: 22px;
        height: 22px;
        line-height: 0;
        /* Pinned, not inherited: Home Assistant's own <ha-icon> can size its
           box differently from the glyph, and anything other than dead centre
           makes the spin wobble instead of turn. */
        transform-origin: 50% 50%;
      }

      /* One palette drives the icon, the status word and the power button. */
      .m-cool { color: var(--acc-cool, #0586f7); }
      .m-heat { color: var(--acc-heat, #fc0000); }
      .m-dry  { color: var(--acc-dry,  #26c6da); }
      .m-fan  { color: var(--acc-fan,  #66bb6a); }
      .m-auto { color: var(--acc-auto, #ab47bc); }
      .m-off, .m-na { color: var(--disabled-text-color, #6f6f6f); }

      .modeicon.running::after {
        content: "";
        position: absolute;
        inset: -7px;
        border-radius: 18px;
        background: radial-gradient(closest-side, currentColor, transparent 72%);
        opacity: 0.3;
        pointer-events: none;
        animation: acc-glow 2.8s ease-in-out infinite;
      }
      @keyframes acc-glow {
        0%, 100% { opacity: 0.18; transform: scale(0.95); }
        50%      { opacity: 0.4;  transform: scale(1.06); }
      }
      @keyframes acc-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }

      /* ======================================================= compact tile */
      /* The small dashboard tile. It reuses .modeicon and the m-* palette
         above -- so an off unit is muted and a cooling one is blue, exactly as
         in the full card -- and only drops the tinted square, because the tile
         shows the fan on its own. */
      /* Set through the variable ha-card itself reads, rather than overriding
         its border-radius from out here -- that way it works whether ha-card
         styles its own host or carries the radius inline. */
      :host([data-layout="compact"]) {
        --ha-card-border-radius: var(--acc-compact-radius, 22px);
      }

      .surface.compact { padding: 0; cursor: default; }
      .surface.compact .notice { margin: 8px 10px 0; }

      .ctiles { display: flex; flex-direction: column; }

      .ctile {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        grid-template-areas:
          "icon cur"
          "info info"
          "status status";
        align-items: center;
        column-gap: 10px;
        row-gap: 2px;
        width: 100%;
        margin: 0;
        padding: 9px 13px;
        border: 0;
        background: none;
        border-radius: inherit;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .ctile:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--primary-color, #03a9f4);
      }
      .ctile.unavailable { opacity: 0.55; }

      .ctile .modeicon {
        grid-area: icon;
        width: 26px;
        height: 26px;
        border-radius: 0;
      }
      .ctile .modeicon::before { content: none; }
      .ctile .modeicon ha-icon { --mdc-icon-size: 24px; width: 24px; height: 24px; }
      .ctile .modeicon.running::after { inset: -5px; border-radius: 50%; }

      /* Amber reads well on a dark card but washes out to roughly 1.7:1 on a
         white one. Blending it toward the theme's own text colour tracks the
         theme instead of the OS, since a dark Home Assistant theme is perfectly
         normal on a light desktop -- prefers-color-scheme would get that wrong.
         Setting either variable still wins outright. */
      .ccur {
        grid-area: cur;
        justify-self: end;
        font-size: 17px;
        font-weight: 700;
        line-height: 1.15;
        white-space: nowrap;
        color: var(
          --acc-compact-current,
          color-mix(in srgb, #ffb74d 62%, var(--primary-text-color, #e1e1e1))
        );
      }
      /* Room name on the left, badge and target on the right. Only the name
         gives way when the line is too narrow -- it already ellipsises, while
         a clipped temperature would be a wrong number. */
      .cinfo {
        grid-area: info;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .cright {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 5px;
        flex: 0 0 auto;
      }
      .cright > * { flex: 0 0 auto; }

      /* The full card's badge, scaled to the tile. Colours come from the
         shared .delta.above/.below/.even rules, so the two layouts agree on
         what "warmer than target" looks like. The line-height is what holds
         the row to the same height it had before the badge existed. */
      .ctile .delta {
        font-size: 10px;
        padding: 0 5px;
        line-height: 1.45;
      }

      .ctarget {
        font-size: 13px;
        font-weight: 600;
        line-height: 1.2;
        white-space: nowrap;
        color: var(
          --acc-compact-target,
          color-mix(in srgb, #ffa726 66%, var(--primary-text-color, #e1e1e1))
        );
        opacity: 0.85;
      }
      .cname {
        flex: 1 1 auto;
        min-width: 0;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.15;
        color: var(--primary-text-color, #e1e1e1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Live operating state, secondary to both temperatures: smaller, lighter
         and dimmed, so it reads as context rather than a third number.

         A min-height is what keeps a row of tiles level — an off unit prints
         one word and a boosting one prints four, and both must occupy exactly
         one line. Type scales gently with the tile (a hair under a third of the
         name's growth) between a readable 9.5px floor and a 12px cap, so it
         never starts competing with the room name. */
      .cstatus {
        grid-area: status;
        min-width: 0;
        display: flex;
        flex-wrap: nowrap;
        align-items: baseline;
        gap: 0.34em;
        overflow: hidden;
        white-space: nowrap;
        font-size: clamp(9.5px, 5.1cqi, 11.5px);
        font-weight: 700;
        letter-spacing: 0.04em;
        line-height: 1.2;
        min-height: 1.2em;
        opacity: 0.92;
        transition: color 0.3s ease;
      }
      .cbit { flex: 0 0 auto; }
      .cbit + .cbit::before {
        content: "·";
        margin-right: 0.34em;
        opacity: 0.5;
      }
      /* An off or unavailable unit says one quiet word and nothing more. */
      .cstatus.muted {
        color: var(--secondary-text-color, #8a8a8a);
        font-weight: 600;
        opacity: 0.75;
      }

      /* Two tiles per row on a phone: shed a little size rather than wrap. */
      @container acc (max-width: 172px) {
        .ctile { padding: 9px 10px; column-gap: 7px; }
        .ccur { font-size: 15px; }
        .ctarget { font-size: 12px; }
        .cname { font-size: 11px; }
        .cinfo { gap: 6px; }
        .cright { gap: 4px; }
        .ctile .delta { font-size: 9px; padding: 0 4px; }
        .cstatus { letter-spacing: 0.02em; gap: 0.28em; }
        .cbit + .cbit::before { margin-right: 0.28em; }
        .ctile .modeicon { width: 22px; height: 22px; }
        .ctile .modeicon ha-icon { --mdc-icon-size: 20px; width: 20px; height: 20px; }
      }

      /* =========================================================== controls */
      .controls {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(44px, auto);
        gap: 7px;
        justify-content: end;
      }

      .ctl {
        -webkit-tap-highlight-color: transparent;
        appearance: none;
        border: none;
        margin: 0;
        min-width: 44px;
        min-height: 40px;
        padding: 0 10px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: var(--primary-text-color, #e1e1e1);
        background: rgba(128, 128, 128, 0.16);
        transition: transform 0.12s ease, background-color 0.2s ease, color 0.2s ease;
      }
      .ctl ha-icon { --mdc-icon-size: 20px; width: 20px; height: 20px; }
      .ctl:hover:not(:disabled) { background: rgba(128, 128, 128, 0.26); }
      .ctl:active:not(:disabled) { transform: scale(0.93); }
      .ctl:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
      .ctl:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }

      /* Powered on: the button adopts the room's own mode colour. */
      .ctl.power.on { color: currentColor; background: rgba(128, 128, 128, 0.16); }
      .ctl.power.on.m-cool { color: var(--acc-cool, #0586f7); background: rgba(5, 134, 247, 0.18); }
      .ctl.power.on.m-heat { color: var(--acc-heat, #fc0000); background: rgba(252, 0, 0, 0.18); }
      .ctl.power.on.m-dry  { color: var(--acc-dry,  #26c6da); background: rgba(38, 198, 218, 0.18); }
      .ctl.power.on.m-fan  { color: var(--acc-fan,  #66bb6a); background: rgba(102, 187, 106, 0.18); }
      .ctl.power.on.m-auto { color: var(--acc-auto, #ab47bc); background: rgba(171, 71, 188, 0.18); }

      .ctl.auto.on  { color: var(--acc-auto-on, #1db954); background: rgba(29, 185, 84, 0.18); }
      .ctl.auto.off { color: var(--acc-auto-off, #e05252); background: rgba(224, 82, 82, 0.15); }

      /* ========================================================= responsive */
      @container acc (max-width: 430px) {
        .surface { padding: 12px 12px; }
        .roomrow {
          grid-template-columns: auto minmax(0, 1fr);
          row-gap: 9px;
          column-gap: 10px;
        }
        .controls {
          grid-column: 1 / -1;
          grid-auto-columns: minmax(44px, 1fr);
          justify-content: stretch;
        }
        .big.cur { font-size: 22px; }
      }

      @container acc (max-width: 280px) {
        .surface { padding: 10px; }
        .roomrow { column-gap: 8px; gap: 8px; }
        .modeicon { width: 32px; height: 32px; border-radius: 10px; }
        .modeicon ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; }
        .roomtext { grid-template-columns: minmax(0, 1fr); }
        .big.cur { font-size: 20px; }
        .targetline { font-size: 13px; }
        .controls { gap: 5px; grid-auto-columns: minmax(38px, 1fr); }
        .ctl { min-width: 38px; min-height: 38px; padding: 0 6px; font-size: 11px; }
        .ctl ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; }
        /* Boost keeps matching the fan square at every width. */
        .ctl.boost {
          width: 32px; height: 32px;
          min-width: 32px; min-height: 32px;
          border-radius: 10px; padding: 0;
        }
        .ctl.boost ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; }
      }

      /* ============================================== wide containers (full) */
      /* Home Assistant hands the card whatever its column allows — a widened
         sections view or a wall tablet can be 650-800px, where the old layout
         put every extra pixel into the text column and left the controls the
         same size they are on a phone.

         Everything below is clamp(base, N cqi, cap), where N is picked so the
         value equals its old base exactly at the 470px entry point. That means
         no jump at the boundary: sizes grow smoothly with the container from
         there and stop at a deliberate cap, so a very wide card gets a roomier
         card rather than a cartoonish one. The cqi unit is the container's own
         inline size, so this responds to the space the card is given, never to
         the viewport. Compact is excluded -- it stays small by design. */
      @container acc (min-width: 470px) {
        .surface:not(.compact) { padding: clamp(14px, 2.7cqi, 22px) clamp(16px, 3.1cqi, 26px); }

        .surface:not(.compact) .roomrow {
          column-gap: clamp(12px, 2.3cqi, 22px);
          padding: clamp(11px, 2.1cqi, 18px) 0;
        }
        /* Spread the temperature away from its target instead of leaving one
           dead gap between the text block and the controls. */
        .surface:not(.compact) .roomtext { column-gap: clamp(10px, 2cqi, 30px); }

        .surface:not(.compact) .big { font-size: clamp(24px, 5.06cqi, 35px); }
        .surface:not(.compact) .name { font-size: clamp(12px, 2.53cqi, 15px); }
        .surface:not(.compact) .targetline { font-size: clamp(15px, 3.19cqi, 20px); }
        .surface:not(.compact) .delta { font-size: clamp(12px, 2.53cqi, 15px); }
        .surface:not(.compact) .status { font-size: clamp(11px, 2.31cqi, 14px); }

        /* Touch targets grow with the card. */
        .surface:not(.compact) .controls {
          gap: clamp(7px, 1.35cqi, 14px);
          grid-auto-columns: minmax(clamp(44px, 9.31cqi, 70px), auto);
        }
        .surface:not(.compact) .ctl {
          min-width: clamp(44px, 9.31cqi, 70px);
          min-height: clamp(40px, 8.47cqi, 62px);
          font-size: clamp(12px, 2.53cqi, 15px);
          border-radius: clamp(12px, 2.3cqi, 16px);
        }
        .surface:not(.compact) .ctl ha-icon {
          --mdc-icon-size: clamp(20px, 4.24cqi, 29px);
          width: clamp(20px, 4.24cqi, 29px);
          height: clamp(20px, 4.24cqi, 29px);
        }

        /* The fan and the boost square below it must stay identical at every
           width, so both take the same expression. */
        .surface:not(.compact) .statuscol { gap: clamp(5px, 0.96cqi, 9px); }
        .surface:not(.compact) .modeicon,
        .surface:not(.compact) .ctl.boost {
          width: clamp(38px, 8.03cqi, 57px);
          height: clamp(38px, 8.03cqi, 57px);
          min-width: clamp(38px, 8.03cqi, 57px);
          min-height: clamp(38px, 8.03cqi, 57px);
          border-radius: clamp(12px, 2.3cqi, 16px);
        }
        .surface:not(.compact) .modeicon ha-icon,
        .surface:not(.compact) .ctl.boost ha-icon {
          --mdc-icon-size: clamp(22px, 4.65cqi, 33px);
          width: clamp(22px, 4.65cqi, 33px);
          height: clamp(22px, 4.65cqi, 33px);
        }
      }

      /* Past the point where the controls stop growing, more width would only
         stretch the gap between the text block and the controls into a void.
         Cap the content and centre it instead, so a very wide card reads as
         deliberate rather than sparse. Below this the card still fills its
         container completely, which covers every realistic dashboard column. */
      @container acc (min-width: 880px) {
        .surface:not(.compact) .rooms {
          max-width: 820px;
          margin-inline: auto;
        }
      }

      /* From the width where the controls sit beside the text, stack them two
         by two: minus and plus on top, power and AUTO beneath. The DOM is
         already in that order, so only the flow changes.

         Two columns instead of four roughly doubles the width each button can
         have, and the block ends up narrower overall than the old single row —
         the space it gives back goes to the temperatures. Last in the sheet on
         purpose: it has to win over the wide tier's four-across sizing. */
      @container acc (min-width: 431px) {
        .surface:not(.compact) .controls {
          grid-auto-flow: row;
          grid-template-columns: repeat(2, clamp(62px, 13cqi, 96px));
          justify-content: end;
          align-content: center;
        }
        /* The column owns the width now, so the button simply fills it. Only
           the ones in this block: the boost square keeps its own geometry,
           which is tied to the fan icon above it. */
        .surface:not(.compact) .controls .ctl {
          min-width: 0;
          width: 100%;
          min-height: clamp(48px, 10cqi, 76px);
        }

        /* Stacking the buttons made the right-hand block the tallest thing in
           the row and left the fan column short. The left column is built from
           the same two numbers the control block uses, so the two sides come
           out level at every width with no dead space beside the fan.

           The fan and the boost square sit further apart than the buttons do,
           and pay for it out of their own size: widen the gap by X and each
           square loses X/2, so two squares plus their gap still equals two
           buttons plus theirs. The column height -- and with it the row and the
           card -- is unchanged whatever X is set to. */
        .surface:not(.compact) .roomrow {
          --acc-stack-size: clamp(48px, 10cqi, 76px);
          --acc-stack-gap: clamp(7px, 1.35cqi, 14px);
          /* Caps at the same container width the square does (760px), so the
             whole left column stops growing in one step rather than two. */
          --acc-fan-extra: clamp(5px, 1cqi, 7.6px);
          --acc-fan-size: calc(var(--acc-stack-size) - var(--acc-fan-extra) / 2);
        }
        .surface:not(.compact) .statuscol {
          gap: calc(var(--acc-stack-gap) + var(--acc-fan-extra));
        }
        .surface:not(.compact) .modeicon,
        .surface:not(.compact) .ctl.boost {
          width: var(--acc-fan-size);
          height: var(--acc-fan-size);
          min-width: var(--acc-fan-size);
          min-height: var(--acc-fan-size);
        }
        /* The glyph keeps its share of the square it sits in. */
        .surface:not(.compact) .modeicon ha-icon,
        .surface:not(.compact) .ctl.boost ha-icon {
          --mdc-icon-size: clamp(28px, 5.8cqi, 44px);
          width: clamp(28px, 5.8cqi, 44px);
          height: clamp(28px, 5.8cqi, 44px);
        }

        /* The text grows with them, so the middle column does not read as
           small print between two larger blocks. */
        .surface:not(.compact) .big { font-size: clamp(26px, 5.8cqi, 40px); }
        .surface:not(.compact) .name { font-size: clamp(13px, 2.9cqi, 17px); }

        /* Target above, difference beneath it, instead of the two side by
           side. Stacking costs a line but buys the width back, so both can be
           set larger and still sit clear of the temperature beside them.
           .roomtext aligns on the baseline, so "Target ..." stays level with
           the big number and the badge hangs below it. */
        .surface:not(.compact) .targetline {
          flex-direction: column;
          align-items: center;
          gap: clamp(3px, 0.6cqi, 6px);
          font-size: clamp(18px, 4.2cqi, 26px);
        }
        .surface:not(.compact) .delta { font-size: clamp(15px, 3.4cqi, 20px); }

        /* The live operating state, 20% up from clamp(12px, 2.65cqi, 16px). */
        .surface:not(.compact) .status { font-size: clamp(14.4px, 3.18cqi, 19.2px); }

        /* The running status line rises a little too, so a row with a unit on
           does not read as bottom-heavy next to one showing OFF. Four pixels is
           what the headroom allows: there are only six to eight above it before
           it would run into the target block, and horizontally the two already
           overlap, so they cannot simply sit side by side. It does not close
           the gap to OFF -- that is twenty pixels up -- but it takes the edge
           off the difference. A transform again, so no row changes height. */
        /* Sit the pair of lines level with the boost square beside them, the
           way the single OFF word does. Splitting the status in two is what
           made this possible: the first line is now short enough to clear the
           difference badge horizontally, so it can rise past it. Twelve pixels
           does it between 500 and 620; above that the left column is tall
           enough that the block is already level, so it eases back to the
           four it had. Well clear of the room temperature above -- there are
           thirty to forty pixels between them at every width. */
        .surface:not(.compact) .status:not(.m-off) {
          transform: translateY(clamp(-27px, calc(23cqi - 169.6px), -4px));
        }

        /* A unit that is off has one word to say, so it says it at twice the
           size. Only the off state: a running unit's line is four items and
           UNAVAILABLE is a long word, and neither would survive the doubling.

           The line box stays the height of a normal status line -- 0.6 of a
           font that is twice as big is the same box -- so the word grows
           without the row growing with it, and the card keeps the height it
           had. That means the glyphs sit slightly proud of their line box,
           which is why overflow goes back to visible: the hidden default here
           is for ellipsising a long running status, and it would clip the top
           and bottom off this one. */
        .surface:not(.compact) .status.m-off .statusline {
          line-height: 0.6;
          overflow: visible;
        }
        /* The off state has nothing for the second line, but it still holds it
           open -- at the ordinary status size, not at twice it, or an off room
           would reserve twice the space a running one does and end up the
           taller of the two. */
        .surface:not(.compact) .status.m-off .statusline.two {
          font-size: clamp(14.4px, 3.18cqi, 19.2px);
          line-height: 1.25;
        }
        .surface:not(.compact) .status.m-off {
          font-size: clamp(28.8px, 6.36cqi, 38.4px);
          line-height: 0.6;
          overflow: visible;
          /* Sits a touch high in its own line box. A transform rather than a
             margin so the row keeps the height it was measured at.

             The lift tapers with the card. Up to a 560px card it is 20px,
             which carries the word clear of the boost square and up towards
             the target line -- measured from the glyph ink, not the line box,
             because a 0.6 line-height leaves the two far apart. From there it
             eases to 4px by 640px and stays there: on a wide card the fan
             column is tall enough that the word already reads level with it,
             and more lift would only pull it into the target line. */
          transform: translateY(clamp(-20px, calc(20cqi - 132px), -4px));
        }
      }

      /* ------------------------------------------------- stacked rooms */
      /* The padding that frames a single room becomes a band of empty card
         above the first row and below the last once rooms are stacked: the
         surface's own padding and the row's are simply added together at both
         ends. Trim just those two outer edges, and bring the rows a little
         closer to the divider between them.

         Only when there is more than one room. A single-room card keeps the
         roomier spacing it was tuned for, which is why this hangs off .multi
         rather than :first-child alone.

         Written last so it wins over the wide tier's own row padding, which is
         a shorthand and would otherwise put the outer edges back. */
      .rooms.multi {
        --acc-row-gap: 8px;
        --acc-row-edge: 2px;
      }
      .rooms.multi .roomrow {
        padding-top: var(--acc-row-gap);
        padding-bottom: var(--acc-row-gap);
      }
      .rooms.multi .roomrow:first-child { padding-top: var(--acc-row-edge); }
      .rooms.multi .roomrow:last-child { padding-bottom: var(--acc-row-edge); }

      /* The same trim for a card holding one room. Its single row is both the
         first and the last, so without this it takes a full row's padding at
         both ends -- and from 470px up that is the wide tier's shorthand,
         clamp(11px, 2.1cqi, 18px), which out-specifies the 2px trim the base
         rules apply. That is exactly the overlap the stacked card fixes just
         above; a single-room card was simply never included, which is why it
         carried 21px of space at each end on a 488px card where a stacked one
         carries 17px.

         Written with the same variable and the same values, so the two kinds of
         card end up with the same rhythm at their edges. */
      .rooms:not(.multi) { --acc-row-edge: 2px; }
      .rooms:not(.multi) .roomrow:first-child { padding-top: var(--acc-row-edge); }
      .rooms:not(.multi) .roomrow:last-child { padding-bottom: var(--acc-row-edge); }
      @container acc (min-width: 431px) {
        .surface:not(.compact) .rooms:not(.multi) { --acc-row-edge: 3px; }
      }

      @container acc (min-width: 431px) {
        .surface:not(.compact) .rooms.multi {
          /* Grows with the card like the row padding it replaces, just less of
             it: this is the space either side of the divider. */
          --acc-row-gap: clamp(8px, 1.6cqi, 14px);
          --acc-row-edge: 3px;
        }
      }

      /* ------------------------------------------- single room: tighter ends */
      /* A stacked card trims the band of empty card above the first row and
         below the last (see .rooms.multi above). A single-room card was left
         with the roomier original spacing, which reads as too much air around
         one row -- on a 341px card, 16px above the content and 14px below for a
         row only 136px tall.

         Only the vertical padding comes down, and only when there is one room:
         the horizontal is what keeps the text clear of the card edge, and the
         stacked card's ends are already handled. Selected with :has() rather
         than a new class so nothing in the render path changes; a browser
         without :has() simply keeps the padding it has today.

         The wide tier keeps growing with the card as before, just from a lower
         base and to a lower cap. */
      .surface:not(.compact):has(.rooms:not(.multi)) {
        padding-top: 10px;
        padding-bottom: 10px;
      }
      @container acc (max-width: 430px) {
        .surface:not(.compact):has(.rooms:not(.multi)) {
          padding-top: 8px;
          padding-bottom: 8px;
        }
      }
      @container acc (max-width: 280px) {
        .surface:not(.compact):has(.rooms:not(.multi)) {
          padding-top: 7px;
          padding-bottom: 7px;
        }
      }
      @container acc (min-width: 470px) {
        .surface:not(.compact):has(.rooms:not(.multi)) {
          padding-top: clamp(10px, 1.9cqi, 16px);
          padding-bottom: clamp(10px, 1.9cqi, 16px);
        }
      }

      /* --------------------------------- stacked rooms: badge on the status */
      /* The target stays with the temperature and the badge drops to the
         status line, which is the only arrangement of the three that fits the
         widths this card is used at: at 520px the text column is 271px, and
         the target and badge together with the temperature would need 360.
         Beside a short first status line the badge needs about 218px, so it
         fits from the narrowest supported width up.

         A single-room card keeps the badge under the target, where it was. */
      .rooms .roomtext {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
          "name   name"
          "cur    target"
          "status delta";
        column-gap: clamp(8px, 1.6cqi, 16px);
      }
      .rooms .name { grid-area: name; }
      .rooms .big.cur { grid-area: cur; }
      .rooms .status { grid-area: status; }
      .rooms .targetline {
        grid-area: target;
        justify-self: end;
        flex-wrap: nowrap;
      }
      .rooms .delta {
        grid-area: delta;
        justify-self: end;
        align-self: start;
      }
      /* The badge shares the status row now, so lifting the status alone would
         put the two out of line. Written to out-specify the lift itself, which
         is the .surface:not(.compact) .status:not(.m-off) rule, which would
         otherwise win and drag the text back over the temperature. */
      /* How far the whole status block drops to sit against the rocket square
         beside it, rather than tucked under the temperature. Measured, per
         width, as the gap between the centre of a running unit's two text
         lines and the centre of that square: 8.5px on a 430px card, 12.5px at
         488, 15.2px at 560, 18.2px at 616, then climbing steeply to 38px at
         792 and levelling off around 40px past 860 -- the left column's two
         squares grow with the card faster than the text beside them does,
         which is why it is not one straight line.

         One variable, added to both states, so moving the block cannot break
         the level relationship between an off row and a running one. */
      .surface:not(.compact) .rooms { --acc-status-drop: 0.5px; }
      /* The badge rides along. It shares the status's grid row, so moving the
         text without it would leave the two out of line -- by the full drop,
         which is up to 27px on a wide card. It takes the shared part only, not
         the extra that OFF adds on top: that is the same offset between the two
         that the card has always had, and the badge sits beside the word rather
         than on its centre line. */
      .surface:not(.compact) .rooms .status,
      .surface:not(.compact) .rooms .delta {
        transform: translateY(var(--acc-status-drop, 0px));
      }
      /* OFF is set at twice the size in a line box kept deliberately short, so
         it rides high in its row: left alone it floats above the rocket square
         it belongs beside. This drops it back until the word is centred on that
         square, the same place a running unit's two lines sit.

         It is a separate figure from the running state, and it has to be. A
         running status is two lines and an off one is a single word, so the two
         blocks differ in height, and their rows differ in height with them --
         which puts the rocket square itself at a different place in each. With
         one offset for both, whichever state it was tuned for is centred and
         the other is not.

         Every figure here was measured on the card as the dashboard actually
         renders it, not on a detached copy. That distinction matters: a copy
         built in a bare container puts the rocket square about eleven pixels
         further down relative to the text than the real thing does, so numbers
         taken that way are wrong by that much in the same direction for both
         states, and the card ends up sitting low everywhere.

         A transform, not a margin, so no row changes height. */
      .surface:not(.compact) .rooms .status.m-off {
        transform: translateY(calc(6.9px + var(--acc-status-drop, 0px)));
      }
      @container acc (min-width: 431px) {
        .surface:not(.compact) .rooms .status.m-off {
          transform: translateY(
            calc(clamp(10.5px, calc(1.55cqi + 3px), 12.5px) + var(--acc-status-drop, 0px))
          );
        }
      }

      /* How far the status block drops to centre on the rocket square beside it.
         It has to follow the card's width, and not in a straight line.
         Measured on the live dashboard, sweeping the card from 440 to 940px,
         the running state needs:

           440  6.9    470  3.5    488  1.8    540  2.1    600  4.2
           660  9.8     720 17.7    792 24.8    880 26.0    940 26.8

         A dip, not a slope. The left column's two squares grow steadily with
         the card, so the rocket's centre keeps moving down; the text beside it
         grows too, but its font clamps top out around a 720px card and the
         text block then stops descending while the square carries on. The two
         cross near 490px, which is where almost nothing is needed -- and, as it
         happens, the width both of this install's dashboards render at. A
         single constant tuned there is therefore the worst possible choice
         everywhere else, which is what an earlier attempt got wrong.

         Four segments, each a straight line through the measured points, so
         every width lands within about a pixel and a half. */
      @container acc (min-width: 431px) {
        .surface:not(.compact) .rooms {
          --acc-status-drop: clamp(1.8px, calc(53.5px - 10.6cqi), 6.9px);
        }
      }
      @container acc (min-width: 501px) {
        .surface:not(.compact) .rooms {
          --acc-status-drop: clamp(1.8px, calc(3.5cqi - 16.8px), 4.3px);
        }
      }
      @container acc (min-width: 621px) {
        .surface:not(.compact) .rooms {
          --acc-status-drop: clamp(4.3px, calc(13.2cqi - 77.3px), 23px);
        }
      }
      @container acc (min-width: 761px) {
        .surface:not(.compact) .rooms {
          --acc-status-drop: clamp(23px, calc(1.35cqi + 14.1px), 28px);
        }
      }

      /* --------------------------------------------------- embedded font */
      /* Only the elements that draw text. Icons are left out deliberately:
         ha-icon renders SVG here, but scoping this way means the card cannot
         break an icon font if Home Assistant ever changes that.

         var(--acc-font, inherit) is the inert half of this -- with no font
         embedded the property is never set, the declaration simply computes
         to inherit, and every one of these reads exactly as it does now. */
      .name, .big, .unit, .targetline, .target, .delta,
      .status, .statusline, .statusmain, .statussub,
      .ctl, .notice,
      .ccur, .ctarget, .cname, .cstatus, .cbit {
        font-family: var(--acc-font, inherit);
      }

      /* Safety net for engines without container queries. */
      @supports not (container-type: inline-size) {
        @media (max-width: 500px) {
          .roomrow { grid-template-columns: auto minmax(0, 1fr); row-gap: 9px; }
          .controls {
            grid-column: 1 / -1;
            grid-auto-columns: minmax(44px, 1fr);
            justify-content: stretch;
          }
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .modeicon.running::after { animation: none; opacity: 0.32; }
        .modeicon ha-icon { animation: none !important; }
        .fill, .ctl, .modeicon, .status { transition: none; }
        .ctl:active { transform: none; }
      }
    `;
  }
}

/* ------------------------------------------------------------------ editor */

const GLOBAL_SCHEMA = [
  {
    name: "layout",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "full", label: "Full — controls and status" },
          { value: "compact", label: "Compact — small tile, tap to open controls" },
        ],
      },
    },
  },
  {
    name: "temperature_step",
    selector: { number: { min: 0.1, max: 5, step: 0.1, mode: "box" } },
  },
  { name: "show_name", selector: { boolean: {} } },
  { name: "show_boost", selector: { boolean: {} } },
];

const ROOM_SCHEMA = [
  { name: "room_name", selector: { text: {} } },
  { name: "climate_entity", required: true, selector: { entity: { domain: ["climate"] } } },
  { name: "room_temp_entity", required: true, selector: { entity: { domain: ["sensor"] } } },
  {
    name: "target_temp_entity",
    required: true,
    selector: { entity: { domain: ["input_number"] } },
  },
  {
    name: "season_entity",
    selector: { entity: { domain: ["input_boolean", "binary_sensor"] } },
  },
  { name: "automation_cool_entity", selector: { entity: { domain: ["automation"] } } },
  { name: "automation_heat_entity", selector: { entity: { domain: ["automation"] } } },
  { name: "icon", selector: { icon: {} } },
];

const LABELS = {
  layout: "Layout",
  temperature_step: "Step (°)",
  show_name: "Show room names",
  show_boost: "Show boost button",
  room_name: "Room name",
  climate_entity: "AC (climate) entity",
  room_temp_entity: "Room temperature",
  target_temp_entity: "Target temperature",
  season_entity: "Heat/Cool selector (on = heat)",
  automation_cool_entity: "Automation — cool (optional)",
  automation_heat_entity: "Automation — heat (optional)",
  icon: "Icon override (optional)",
};

class AcControlCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._rooms = [];
    this._open = 0;
    this._built = false;
  }

  setConfig(config) {
    const rooms = AcControlCard.normaliseRooms(config || {});
    // HA may set `hass` before `setConfig`, in which case an empty shell has
    // already been built -- that must be rebuilt. Once the list is up, only a
    // change in room count needs a rebuild; anything else syncs in place so
    // typing in a field does not lose focus on every keystroke.
    const rebuild = !this._built || rooms.length !== this._rooms.length;
    this._config = { ...config };
    this._rooms = rooms;
    this._render(rebuild);
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._render(first && !this._built);
  }

  /**
   * Always emit the `rooms:` form so the shape is predictable once edited.
   *
   * `structural` is for changes that alter the *set* of rooms — added, removed
   * or reordered — which need the editor rebuilt. A plain field edit must not
   * rebuild: it fires on every keystroke, and replacing the inputs mid-word
   * takes the focus out of the field being typed in. `_syncForms()` already
   * pushes new values and room titles into the existing elements.
   */
  _emit(structural = false) {
    const out = { type: `custom:${CARD_TYPE}` };
    for (const k of GLOBAL_KEYS) {
      if (this._config[k] !== undefined && this._config[k] !== "") out[k] = this._config[k];
    }
    if (this._config.tap_action) out.tap_action = this._config.tap_action;
    out.rooms = this._rooms.map((r) => {
      const o = {};
      for (const k of ROOM_KEYS) if (r[k] !== undefined && r[k] !== "") o[k] = r[k];
      return o;
    });
    this._config = { ...out };
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: out },
        bubbles: true,
        composed: true,
      }),
    );
    this._render(structural);
  }

  _label(s) {
    return LABELS[s.name] || (s.name ? s.name.replace(/_/g, " ") : "");
  }

  _render(force) {
    if (!this._hass) return;
    if (!customElements.get("ha-form")) {
      this.textContent = "Edit this card in YAML — ha-form is unavailable.";
      return;
    }
    if (this._built && !force) {
      this._syncForms();
      return;
    }
    this.innerHTML = "";
    this._built = true;

    const style = document.createElement("style");
    style.textContent = `
      .acc-ed { display: flex; flex-direction: column; gap: 14px; }
      .acc-sec-title {
        font-size: 12px; font-weight: 700; letter-spacing: .06em;
        text-transform: uppercase; color: var(--secondary-text-color);
        margin: 4px 0 -4px;
      }
      .acc-room {
        border: 1px solid var(--divider-color); border-radius: 10px;
        overflow: hidden; background: var(--secondary-background-color, transparent);
      }
      .acc-room-head {
        display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 12px;
      }
      .acc-room-title { flex: 1; min-width: 0; }
      .acc-room-title b { display: block; font-size: 14px; }
      .acc-room-title span {
        display: block; font-size: 12px; color: var(--secondary-text-color);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .acc-room-body { padding: 0 12px 12px; }
      .acc-ico {
        appearance: none; border: none; background: transparent; cursor: pointer;
        color: var(--secondary-text-color); border-radius: 8px;
        width: 34px; height: 34px; display: grid; place-items: center; flex: 0 0 auto;
      }
      .acc-ico:hover { background: rgba(128,128,128,.18); color: var(--primary-text-color); }
      .acc-ico:disabled { opacity: .3; cursor: not-allowed; }
      .acc-ico.danger:hover { color: var(--error-color, #e05252); }
      .acc-add {
        appearance: none; cursor: pointer; font: inherit; font-size: 14px;
        padding: 9px 14px; border-radius: 10px; align-self: flex-start;
        border: 1px dashed var(--divider-color); background: transparent;
        color: var(--primary-color); display: flex; align-items: center; gap: 6px;
      }
      .acc-add:hover { background: rgba(128,128,128,.12); }
    `;
    this.appendChild(style);

    const wrap = document.createElement("div");
    wrap.className = "acc-ed";

    // ---- global options
    const gTitle = document.createElement("div");
    gTitle.className = "acc-sec-title";
    gTitle.textContent = "Card";
    wrap.appendChild(gTitle);

    const gForm = document.createElement("ha-form");
    gForm.hass = this._hass;
    gForm.schema = GLOBAL_SCHEMA;
    gForm.computeLabel = (s) => this._label(s);
    gForm.data = { ...DEFAULTS, ...this._config };
    gForm.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._config = { ...this._config, ...ev.detail.value };
      this._emit();
    });
    wrap.appendChild(gForm);
    this._gForm = gForm;

    // ---- rooms
    const rTitle = document.createElement("div");
    rTitle.className = "acc-sec-title";
    rTitle.textContent = `Rooms (${this._rooms.length})`;
    wrap.appendChild(rTitle);

    this._roomForms = [];
    this._roomHeads = [];
    this._rooms.forEach((room, i) => {
      wrap.appendChild(this._buildRoomEditor(room, i));
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "acc-add";
    const plusIcon = document.createElement("ha-icon");
    plusIcon.setAttribute("icon", "mdi:plus");
    add.append(plusIcon, document.createTextNode("Add room"));
    add.addEventListener("click", () => {
      this._rooms = [
        ...this._rooms,
        { room_name: "", climate_entity: "", room_temp_entity: "", target_temp_entity: "" },
      ];
      this._open = this._rooms.length - 1;
      this._emit(true);
    });
    wrap.appendChild(add);

    this.appendChild(wrap);
  }

  _buildRoomEditor(room, i) {
    const box = document.createElement("div");
    box.className = "acc-room";
    box.dataset.roomIndex = String(i);

    const head = document.createElement("div");
    head.className = "acc-room-head";

    const title = document.createElement("div");
    title.className = "acc-room-title";
    const b = document.createElement("b");
    b.textContent = room.room_name || room.name || `Room ${i + 1}`;
    const sub = document.createElement("span");
    sub.textContent = room.climate_entity || "not configured";
    title.append(b, sub);
    this._roomHeads[i] = { name: b, sub };

    const mkIco = (ic, label, cls) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `acc-ico${cls ? " " + cls : ""}`;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      const ie = document.createElement("ha-icon");
      ie.setAttribute("icon", ic);
      btn.appendChild(ie);
      return btn;
    };

    const up = mkIco("mdi:arrow-up", "Move up");
    up.disabled = i === 0;
    up.addEventListener("click", () => this._move(i, -1));

    const down = mkIco("mdi:arrow-down", "Move down");
    down.disabled = i === this._rooms.length - 1;
    down.addEventListener("click", () => this._move(i, +1));

    const isOpen = this._open === i;
    const edit = mkIco(
      isOpen ? "mdi:chevron-up" : "mdi:pencil",
      isOpen ? "Collapse" : "Edit room",
    );
    edit.addEventListener("click", () => {
      this._open = isOpen ? -1 : i;
      this._render(true);
    });

    const del = mkIco("mdi:close", "Remove room", "danger");
    del.disabled = this._rooms.length <= 1;
    del.addEventListener("click", () => {
      this._rooms = this._rooms.filter((_, j) => j !== i);
      if (this._open >= this._rooms.length) this._open = this._rooms.length - 1;
      this._emit(true);
    });

    head.append(title, up, down, edit, del);
    box.appendChild(head);

    if (isOpen) {
      const body = document.createElement("div");
      body.className = "acc-room-body";
      const form = document.createElement("ha-form");
      form.hass = this._hass;
      form.schema = ROOM_SCHEMA;
      form.computeLabel = (s) => this._label(s);
      form.data = { ...room };
      form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._rooms = this._rooms.map((r, j) => (j === i ? { ...r, ...ev.detail.value } : r));
        this._emit();
      });
      body.appendChild(form);
      box.appendChild(body);
      this._roomForms[i] = form;
    }

    return box;
  }

  _move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this._rooms.length) return;
    const next = [...this._rooms];
    [next[i], next[j]] = [next[j], next[i]];
    this._rooms = next;
    if (this._open === i) this._open = j;
    else if (this._open === j) this._open = i;
    this._emit(true);
  }

  _syncForms() {
    if (this._gForm) {
      this._gForm.hass = this._hass;
      this._gForm.data = { ...DEFAULTS, ...this._config };
    }
    (this._roomForms || []).forEach((form, i) => {
      if (!form) return;
      form.hass = this._hass;
      form.data = { ...this._rooms[i] };
    });
    (this._roomHeads || []).forEach((h, i) => {
      if (!h) return;
      const r = this._rooms[i] || {};
      h.name.textContent = r.room_name || r.name || `Room ${i + 1}`;
      h.sub.textContent = r.climate_entity || "not configured";
    });
  }
}

/* ---------------------------------------------------------------- register */

if (!customElements.get(CARD_TYPE)) customElements.define(CARD_TYPE, AcControlCard);
if (!customElements.get(`${CARD_TYPE}-editor`)) {
  customElements.define(`${CARD_TYPE}-editor`, AcControlCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === CARD_TYPE)) {
  window.customCards.push({
    type: CARD_TYPE,
    name: "AC Control Card",
    description:
      "One card for several air conditioners: temperature, target, difference badge, " +
      "mode status, a fan that spins with the unit, and touch controls.",
    preview: true,
    documentationURL: "https://github.com/ilirdokle43/HA-AC-Control",
  });
}

console.info(
  `%c ${CARD_TYPE.toUpperCase()} %c v${CARD_VERSION} `,
  "color:#0b1520;background:#29b6f6;font-weight:700;border-radius:3px 0 0 3px",
  "color:#29b6f6;background:#0b1520;font-weight:700;border-radius:0 3px 3px 0",
);

export { AcControlCard, AcControlCardEditor, CARD_VERSION };
