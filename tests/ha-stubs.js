/**
 * Minimal stand-ins for the Home Assistant frontend elements the card uses,
 * plus a fake `hass` object. Enough to exercise the card in a plain browser
 * with no Home Assistant, no build step and no dependencies.
 *
 * Every entity id here is a made-up demo id.
 */

/* ------------------------------------------------------------- <ha-icon> */

/**
 * The handful of Material Design Icons this card asks for, inlined so the
 * preview and the tests make no network requests at all.
 * Paths from @mdi/svg (Apache-2.0 / Pictogrammers Free License).
 */
const MDI = {
  minus: "M19,13H5V11H19V13Z",
  plus: "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z",
  power:
    "M16.56,5.44L15.11,6.89C16.84,7.94 18,9.83 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12C6,9.83 7.16,7.94 8.88,6.88L7.44,5.44C5.36,6.88 4,9.28 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,9.28 18.64,6.88 16.56,5.44M13,3H11V13H13",
  "rocket-launch":
    "M13.13 22.19L11.5 18.36C13.07 17.78 14.54 17 15.9 16.09L13.13 22.19M5.64 12.5L1.81 10.87L7.91 8.1C7 9.46 6.22 10.93 5.64 12.5M21.61 2.39C21.61 2.39 16.66 .269 11 5.93C8.81 8.12 7.5 10.53 6.65 12.64C6.37 13.39 6.56 14.21 7.11 14.77L9.24 16.89C9.79 17.45 10.61 17.63 11.36 17.35C13.5 16.53 15.88 15.19 18.07 13C23.73 7.34 21.61 2.39 21.61 2.39M14.54 9.46C13.76 8.68 13.76 7.41 14.54 6.63S16.59 5.85 17.37 6.63C18.14 7.41 18.15 8.68 17.37 9.46C16.59 10.24 15.32 10.24 14.54 9.46M8.88 16.53L7.47 15.12L8.88 16.53M6.24 22L9.88 18.36C9.54 18.27 9.21 18.12 8.91 17.91L4.83 22H6.24M2 22H3.41L8.18 17.24L6.76 15.83L2 20.59V22M2 19.17L6.09 15.09C5.88 14.79 5.73 14.47 5.64 14.12L2 17.76V19.17Z",
  snowflake:
    "M20.79,13.95L18.46,14.57L16.46,13.44V10.56L18.46,9.43L20.79,10.05L21.31,8.12L19.54,7.65L20,5.88L18.07,5.36L17.45,7.69L15.45,8.82L13,7.38V5.12L14.71,3.41L13.29,2L12,3.29L10.71,2L9.29,3.41L11,5.12V7.38L8.5,8.82L6.5,7.69L5.92,5.36L4,5.88L4.47,7.65L2.7,8.12L3.22,10.05L5.55,9.43L7.55,10.56V13.45L5.55,14.58L3.22,13.96L2.7,15.89L4.47,16.36L4,18.12L5.93,18.64L6.55,16.31L8.55,15.18L11,16.62V18.88L9.29,20.59L10.71,22L12,20.71L13.29,22L14.7,20.59L13,18.88V16.62L15.5,15.17L17.5,16.3L18.12,18.63L20,18.12L19.53,16.35L21.3,15.88L20.79,13.95M9.5,10.56L12,9.11L14.5,10.56V13.44L12,14.89L9.5,13.44V10.56Z",
  fire:
    "M17.66 11.2C17.43 10.9 17.15 10.64 16.89 10.38C16.22 9.78 15.46 9.35 14.82 8.72C13.33 7.26 13 4.85 13.95 3C13 3.23 12.17 3.75 11.46 4.32C8.87 6.4 7.85 10.07 9.07 13.22C9.11 13.32 9.15 13.42 9.15 13.55C9.15 13.77 9 13.97 8.8 14.05C8.57 14.15 8.33 14.09 8.14 13.93C8.08 13.88 8.04 13.83 8 13.76C6.87 12.33 6.69 10.28 7.45 8.64C5.78 10 4.87 12.3 5 14.47C5.06 14.97 5.12 15.47 5.29 15.97C5.43 16.57 5.7 17.17 6 17.7C7.08 19.43 8.95 20.67 10.96 20.92C13.1 21.19 15.39 20.8 17.03 19.32C18.86 17.66 19.5 15 18.56 12.72L18.43 12.46C18.22 12 17.66 11.2 17.66 11.2M14.5 17.5C14.22 17.74 13.76 18 13.4 18.1C12.28 18.5 11.16 17.94 10.5 17.28C11.69 17 12.4 16.12 12.61 15.23C12.78 14.43 12.46 13.77 12.33 13C12.21 12.26 12.23 11.63 12.5 10.94C12.69 11.32 12.89 11.7 13.13 12C13.9 13 15.11 13.44 15.37 14.8C15.41 14.94 15.43 15.08 15.43 15.23C15.46 16.05 15.1 16.95 14.5 17.5H14.5Z",
  "water-percent":
    "M12,3.25C12,3.25 6,10 6,14C6,17.32 8.69,20 12,20A6,6 0 0,0 18,14C18,10 12,3.25 12,3.25M14.47,9.97L15.53,11.03L9.53,17.03L8.47,15.97M9.75,10A1.25,1.25 0 0,1 11,11.25A1.25,1.25 0 0,1 9.75,12.5A1.25,1.25 0 0,1 8.5,11.25A1.25,1.25 0 0,1 9.75,10M14.25,14.5A1.25,1.25 0 0,1 15.5,15.75A1.25,1.25 0 0,1 14.25,17A1.25,1.25 0 0,1 13,15.75A1.25,1.25 0 0,1 14.25,14.5Z",
  fan:
    "M12,11A1,1 0 0,0 11,12A1,1 0 0,0 12,13A1,1 0 0,0 13,12A1,1 0 0,0 12,11M12.5,2C17,2 17.11,5.57 14.75,6.75C13.76,7.24 13.32,8.29 13.13,9.22C13.61,9.42 14.03,9.73 14.35,10.13C18.05,8.13 22.03,8.92 22.03,12.5C22.03,17 18.46,17.1 17.28,14.73C16.78,13.74 15.72,13.3 14.79,13.11C14.59,13.59 14.28,14 13.88,14.34C15.87,18.03 15.08,22 11.5,22C7,22 6.91,18.42 9.27,17.24C10.25,16.75 10.69,15.71 10.89,14.79C10.4,14.59 9.97,14.27 9.65,13.87C5.96,15.85 2,15.07 2,11.5C2,7 5.56,6.89 6.74,9.26C7.24,10.25 8.29,10.68 9.22,10.87C9.41,10.39 9.73,9.97 10.14,9.65C8.15,5.96 8.94,2 12.5,2Z",
  autorenew:
    "M12,6V9L16,5L12,1V4A8,8 0 0,0 4,12C4,13.57 4.46,15.03 5.24,16.26L6.7,14.8C6.25,13.97 6,13 6,12A6,6 0 0,1 12,6M18.76,7.74L17.3,9.2C17.74,10.04 18,11 18,12A6,6 0 0,1 12,18V15L8,19L12,23V20A8,8 0 0,0 20,12C20,10.43 19.54,8.97 18.76,7.74Z",
};

export class HaIconStub extends HTMLElement {
  static get observedAttributes() {
    return ["icon"];
  }
  connectedCallback() {
    this._paint();
  }
  attributeChangedCallback() {
    this._paint();
  }
  _paint() {
    const name = (this.getAttribute("icon") || "").replace(/^mdi:/, "");
    this.style.display = "inline-flex";
    this.style.alignItems = "center";
    this.style.justifyContent = "center";
    this.style.width = "var(--mdc-icon-size, 24px)";
    this.style.height = "var(--mdc-icon-size, 24px)";
    const path = MDI[name];
    this.innerHTML = path
      ? `<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:currentColor"><path d="${path}"/></svg>`
      : "";
  }
}

/* ------------------------------------------------------------- <ha-card> */

export class HaCardStub extends HTMLElement {
  connectedCallback() {
    this.style.display = "block";
    this.style.background = "var(--card-background-color, #1c1f26)";
    this.style.borderRadius = "var(--ha-card-border-radius, 14px)";
    // Only the style: the real ha-card's width and colour come from theme
    // custom properties and are overridable by the card, so leaving them to the
    // card's own rule is what the browser actually does here.
    this.style.borderStyle = "solid";
    this.style.boxShadow = "0 2px 10px rgba(0,0,0,.45)";
  }
}

/* ------------------------------------------------------------- <ha-form> */

/** Only needs to exist so `getConfigElement()` resolves; not exercised here. */
export class HaFormStub extends HTMLElement {}

export function installStubs() {
  if (!customElements.get("ha-icon")) customElements.define("ha-icon", HaIconStub);
  if (!customElements.get("ha-card")) customElements.define("ha-card", HaCardStub);
  if (!customElements.get("ha-form")) customElements.define("ha-form", HaFormStub);
}

/* ------------------------------------------------------------------ hass */

export function climate(state, attrs = {}) {
  return {
    state,
    attributes: {
      friendly_name: "Demo AC",
      fan_mode: "high",
      preset_mode: "none",
      preset_modes: ["none", "boost", "eco"],
      temperature: 22,
      ...attrs,
    },
  };
}

export function sensor(state, attrs = {}) {
  return { state: String(state), attributes: { unit_of_measurement: "°C", ...attrs } };
}

export function number(state, attrs = {}) {
  return { state: String(state), attributes: { min: 16, max: 30, step: 0.5, ...attrs } };
}

export function toggle(state) {
  return { state, attributes: {} };
}

/** A three-room demo house. All ids are fictional. */
export function demoStates() {
  return {
    "climate.demo_bedroom_ac": climate("off", { friendly_name: "Bedroom AC" }),
    "sensor.demo_bedroom_temperature": sensor(26.5),
    "input_number.demo_bedroom_target": number(20),
    "input_boolean.demo_heating_season": toggle("off"),
    "automation.demo_bedroom_ac_command": toggle("off"),

    "climate.demo_office_ac": climate("off", { friendly_name: "Office AC" }),
    "sensor.demo_office_temperature": sensor(19.8),
    "input_number.demo_office_target": number(20),
    "automation.demo_office_ac_command": toggle("off"),

    "climate.demo_living_room_ac": climate("off", { friendly_name: "Living Room AC" }),
    "sensor.demo_living_room_temperature": sensor(24),
    "input_number.demo_living_room_target": number(19),
    "automation.demo_living_room_ac_command": toggle("off"),
  };
}

/**
 * A fake `hass`. Service calls are recorded in `calls`, and the ones the card
 * relies on are reflected back into `states` so the UI visibly reacts.
 */
export function makeHass(states = demoStates()) {
  const hass = {
    states,
    calls: [],
    locale: { language: "en" },
    config: { unit_system: { temperature: "°C" } },
    callService(domain, service, data = {}, target = {}) {
      hass.calls.push({ domain, service, data, target });
      const id = target.entity_id || data.entity_id;
      const cur = states[id];
      if (!cur) return;
      if (domain === "input_number" && service === "set_value") {
        states[id] = { ...cur, state: String(data.value) };
      } else if (domain === "climate" && service === "set_preset_mode") {
        states[id] = { ...cur, attributes: { ...cur.attributes, preset_mode: data.preset_mode } };
      } else if (service === "toggle") {
        const off = cur.state === "off";
        const next = off ? (id.startsWith("climate.") ? "cool" : "on") : "off";
        states[id] = { ...cur, state: next };
      }
      if (hass.onChange) hass.onChange();
    },
  };
  return hass;
}

/** The demo config used by the preview and the tests. */
export const DEMO_CONFIG = Object.freeze({
  type: "custom:ac-control-card",
  rooms: [
    {
      room_name: "Bedroom",
      climate_entity: "climate.demo_bedroom_ac",
      room_temp_entity: "sensor.demo_bedroom_temperature",
      target_temp_entity: "input_number.demo_bedroom_target",
      season_entity: "input_boolean.demo_heating_season",
    },
    {
      room_name: "Office",
      climate_entity: "climate.demo_office_ac",
      room_temp_entity: "sensor.demo_office_temperature",
      target_temp_entity: "input_number.demo_office_target",
    },
    {
      room_name: "Living Room",
      climate_entity: "climate.demo_living_room_ac",
      room_temp_entity: "sensor.demo_living_room_temperature",
      target_temp_entity: "input_number.demo_living_room_target",
    },
  ],
});
