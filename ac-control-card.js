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

const CARD_TYPE = "ac-control-card";
const CARD_VERSION = "2.1.0";

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
    // The compact tile has no controls and no status line, so it is one fixed
    // small height per room whatever the width.
    if (this._compact) return 12 + 56 * n;
    const w = this.getBoundingClientRect ? this.getBoundingClientRect().width : 0;
    if (w > 431) return 11 + 106 * n; // controls share the room's line
    if (w && w <= 280) return 3 + 140 * n; // compact everything
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

  _iconFor(room) {
    return room.icon || FAN_ICON;
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
    const cfg = this._cfg.tap_action || { action: "more-info" };
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
    line.append(target, delta);
    const status = el("div", "status");
    const statusMain = el("span", "statusmain", "—");
    const statusSub = el("span", "statussub");
    status.append(statusMain, statusSub);
    text.append(name, cur, line, status);
    return { text, name, cur, target, delta, status, statusMain, statusSub };
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
      const target = el("div", "ctarget");

      tile.append(box, cur, name, target);
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
      });
    }

    surface.appendChild(list);
    card.appendChild(surface);
    root.appendChild(card);
    this._built = true;
  }

  _build() {
    if (this._compact) return this._buildCompact();

    const root = this.shadowRoot;
    root.innerHTML = `<style>${AcControlCard.styles}</style>`;
    this.removeAttribute("data-layout");

    const card = document.createElement("ha-card");
    const surface = el("div", "surface");
    surface.setAttribute("role", "button");
    surface.tabIndex = 0;

    const notice = el("div", "notice");
    notice.hidden = true;
    surface.appendChild(notice);

    this._el = { surface, notice, rooms: [] };

    const list = el("div", "rooms");
    for (const room of this._rooms) {
      const row = el("div", "roomrow");
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
        minus: c.minus,
        plus: c.plus,
        power: c.power,
        auto: c.auto,
      });
    }
    surface.appendChild(list);

    surface.addEventListener("click", () => this._cardAction(this._rooms[0]));
    surface.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this._cardAction(this._rooms[0]);
      }
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
   * Compact tile contents. Deliberately only the four things the tile shows —
   * the numbers come from the same entities and the same helpers the full card
   * uses, so the two layouts can never disagree about a temperature.
   */
  _renderCompactRoom(refs, room) {
    const mode = this._mode(room);
    const deg = this._degree(room);

    refs.row.classList.toggle("unavailable", !mode.available);

    refs.modeIcon.className = `modeicon m-${mode.key}${this._running(room) ? " running" : ""}`;
    refs.modeGlyph.setAttribute("icon", this._iconFor(room));
    refs.modeGlyph.style.animation = this._fanSpin(room);

    const cur = this._roomState(room, "room_temp_entity");
    const curOk = cur && isNumeric(cur.state);
    refs.cur.textContent = curOk ? `${this._num(Number(cur.state))}${deg}` : "—";

    const tgt = this._roomState(room, "target_temp_entity");
    const tgtOk = !!(tgt && isNumeric(tgt.state));
    refs.target.textContent = tgtOk ? `${this._num(Number(tgt.state), 0)}${deg}` : "—";

    const name = this._roomName(room);
    if (this._cfg.show_name === false) {
      refs.name.hidden = true;
      refs.name.textContent = "";
    } else {
      refs.name.hidden = false;
      refs.name.textContent = name;
    }

    refs.row.setAttribute(
      "aria-label",
      `${name}. ${mode.label}. ` +
        `Current ${curOk ? this._num(Number(cur.state)) + deg : "unavailable"}, ` +
        `target ${tgtOk ? this._num(Number(tgt.state), 0) + deg : "unavailable"}. ` +
        "Opens the full controls.",
    );
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
    const climate = this._roomState(room, "climate_entity");
    const attrs = (climate && climate.attributes) || {};
    const heat = this._isHeat(room);

    refs.row.classList.toggle("unavailable", !mode.available);

    refs.modeIcon.className = `modeicon m-${mode.key}${this._running(room) ? " running" : ""}`;
    refs.modeGlyph.setAttribute("icon", this._iconFor(room));
    refs.modeGlyph.style.animation = this._fanSpin(room);

    // Status: mode word, then the unit's own fan speed and setpoint as muted
    // context (both carried over from v1's two-line mode text).
    refs.statusMain.textContent = mode.label;
    refs.status.className = `status m-${mode.key}`;
    const bits = [];
    if (mode.available && mode.on) {
      if (attrs.fan_mode) bits.push(String(attrs.fan_mode).toUpperCase());
      if (attrs.preset_mode === "boost") bits.push("BOOST");
      if (Number.isFinite(Number(attrs.temperature))) {
        bits.push(`${this._num(Number(attrs.temperature), 0)}${deg}`);
      }
    }
    refs.statusSub.textContent = bits.length ? ` · ${bits.join(" · ")}` : "";

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

    // Difference badge. Only ever rendered from two real numbers, so it can
    // never print NaN / unknown.
    const d = refs.delta;
    if (curOk && tgtOk) {
      const diff = tidy(Number(cur.state) - Number(tgt.state));
      d.hidden = false;
      if (Math.abs(diff) < 0.05) {
        d.textContent = "at target";
        d.className = "delta even";
      } else {
        d.textContent = `${diff > 0 ? "▲" : "▼"} ${this._num(Math.abs(diff))}${deg}`;
        d.className = `delta ${diff > 0 ? "above" : "below"}`;
      }
    } else {
      d.hidden = true;
      d.textContent = "";
    }

    refs.row.setAttribute(
      "aria-label",
      `${this._roomName(room)}. ${mode.label}. ` +
        `Current ${curOk ? this._num(Number(cur.state)) + deg : "unavailable"}, ` +
        `target ${tgtOk ? this._num(Number(tgt.state)) + deg : "unavailable"}.`,
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

      ha-card {
        container-type: inline-size;
        container-name: acc;
        overflow: hidden;
        height: 100%;
        box-sizing: border-box;
      }

      .surface {
        padding: 14px 16px;
        box-sizing: border-box;
        height: 100%;
        cursor: pointer;
        outline: none;
      }
      .surface:focus-visible {
        box-shadow: inset 0 0 0 2px var(--primary-color, #03a9f4);
        border-radius: var(--ha-card-border-radius, 12px);
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
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
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
          "name target";
        align-items: center;
        column-gap: 10px;
        row-gap: 2px;
        width: 100%;
        margin: 0;
        padding: 10px 13px;
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

      .ccur {
        grid-area: cur;
        justify-self: end;
        font-size: 17px;
        font-weight: 700;
        line-height: 1.15;
        white-space: nowrap;
        color: var(--acc-compact-current, #ffb74d);
      }
      .ctarget {
        grid-area: target;
        justify-self: end;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.15;
        white-space: nowrap;
        color: var(--acc-compact-target, #ffa726);
        opacity: 0.85;
      }
      .cname {
        grid-area: name;
        min-width: 0;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.15;
        color: var(--primary-text-color, #e1e1e1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Two tiles per row on a phone: shed a little size rather than wrap. */
      @container acc (max-width: 172px) {
        .ctile { padding: 9px 10px; column-gap: 7px; }
        .ccur { font-size: 15px; }
        .ctarget { font-size: 12px; }
        .cname { font-size: 11px; }
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
