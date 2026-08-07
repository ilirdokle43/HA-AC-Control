// AC Control Card — custom Lovelace card for a Midea AC (climate entity)
// Drop this file in <config>/www/ and add it as a Lovelace resource:
//   URL: /local/ac-control-card.js   Type: JavaScript module
// Then add a card of type "custom:ac-control-card" via the dashboard UI
// (search "AC Control Card" in Add Card) and fill in entities in the editor.

const MODE_MAP = { 0: "off", 1: "auto", 2: "cool", 3: "dry", 4: "heat", 5: "fan_only" };
const SPEED_MAP = {
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
};

const REQUIRED_FIELDS = [
  "climate_entity",
  "room_temp_entity",
  "target_temp_entity",
  "season_entity",
];

class AcControlCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 3;
  }

  static getConfigElement() {
    return document.createElement("ac-control-card-editor");
  }

  static getStubConfig() {
    return {};
  }

  _base() {
    return (this._config.climate_entity || "").split(".")[1] || "";
  }

  _derived(key, domain, suffix) {
    return this._config[key] || `${domain}.${this._base()}${suffix}`;
  }

  _missingFields() {
    return REQUIRED_FIELDS.filter((f) => !this._config[f]);
  }

  _render() {
    if (!this._hass || !this._config) return;

    const missing = this._missingFields();
    if (missing.length) {
      this._built = false;
      this.shadowRoot.innerHTML = `
        <ha-card>
          <div style="padding:16px;color:var(--secondary-text-color);font-size:14px;">
            AC Control Card: please configure ${missing.join(", ")} in the card editor.
          </div>
        </ha-card>`;
      return;
    }

    if (!this._built) {
      this._buildDom();
      this._built = true;
    }
    this._update();
  }

  _buildDom() {
    const root = this.shadowRoot;
    root.innerHTML = `
      <style>
        :host { display: block; }
        .wrap {
          position: relative;
          padding: 10px 12px 12px;
          height: 140px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          cursor: pointer;
          container-type: inline-size;
          container-name: ac-card;
        }
        .header {
          display: flex;
          align-items: center;
          padding-bottom: 8px;
          margin-bottom: 8px;
          border-bottom: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
        }
        .toggle-btn { display: flex; z-index: 2; }
        .toggle-btn ha-icon { --mdc-icon-size: 34px; }
        .title {
          flex: 1;
          text-align: center;
          font-size: 21px;
          font-weight: bold;
        }
        .ac-setpoint {
          min-width: 34px;
          text-align: right;
          font-size: 13px;
          font-weight: bold;
          color: var(--primary-text-color);
          opacity: 0.75;
        }
        .body {
          flex: 1;
          display: grid;
          grid-template-columns: 70px 55px 1fr 70px;
          align-items: stretch;
          column-gap: 6px;
        }
        .col {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }
        .fan-wrap { cursor: pointer; }
        .fan-icon { --mdc-icon-size: 64px; display: inline-block; }
        .mode-text {
          font-size: 14px;
          line-height: 1.35;
          text-align: center;
        }
        .temp-col { gap: 0px; }
        .room-temp {
          font-size: 18px;
          font-weight: bold;
          color: #ffa31a;
          white-space: nowrap;
        }
        .target-row {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .target-row ha-icon {
          --mdc-icon-size: 32px;
          color: #ffa31a;
          cursor: pointer;
          padding: 8px 12px;
          box-sizing: content-box;
        }
        .target-temp {
          font-size: 24px;
          font-weight: bold;
          color: #ffa31a;
          white-space: nowrap;
          position: relative;
          top: -4px;
        }
        .boost-wrap { cursor: pointer; height: 100%; }
        .turbo { --mdc-icon-size: 56px; cursor: pointer; }
        @keyframes rotating {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @container ac-card (max-width: 440px) {
          .wrap { height: 130px; padding: 8px 8px 10px; }
          .toggle-btn ha-icon { --mdc-icon-size: 26px; }
          .title { font-size: 16px; }
          .ac-setpoint { min-width: 26px; font-size: 11px; }
          .body { grid-template-columns: 50px 42px 1fr 50px; column-gap: 3px; }
          .fan-icon { --mdc-icon-size: 44px; transform: translateY(-6px); }
          .mode-text { font-size: 10.5px; }
          .room-temp { font-size: 14px; }
          .target-row { transform: translateY(-6px); }
          .target-row ha-icon { --mdc-icon-size: 24px; padding: 8px; }
          .target-temp { font-size: 14px; top: 0; }
          .turbo { --mdc-icon-size: 38px; transform: translateX(-8px); }
        }
      </style>
      <ha-card class="wrap">
        <div class="header">
          <div class="toggle-btn"><ha-icon icon="mdi:toggle-switch"></ha-icon></div>
          <div class="title"></div>
          <div class="ac-setpoint"></div>
        </div>
        <div class="body">
          <div class="col fan-wrap"><ha-icon class="fan-icon" icon="mdi:fan"></ha-icon></div>
          <div class="col mode-text"></div>
          <div class="col temp-col">
            <div class="room-temp"></div>
            <div class="target-row">
              <ha-icon class="dec" icon="mdi:chevron-left"></ha-icon>
              <span class="target-temp"></span>
              <ha-icon class="inc" icon="mdi:chevron-right"></ha-icon>
            </div>
          </div>
          <div class="col boost-wrap"><ha-icon class="turbo" icon="mdi:rocket"></ha-icon></div>
        </div>
      </ha-card>
    `;

    this._el = {
      wrap: root.querySelector(".wrap"),
      acSetpoint: root.querySelector(".ac-setpoint"),
      title: root.querySelector(".title"),
      modeText: root.querySelector(".mode-text"),
      roomTemp: root.querySelector(".room-temp"),
      targetTemp: root.querySelector(".target-temp"),
      fanIcon: root.querySelector(".fan-icon"),
      fanWrap: root.querySelector(".fan-wrap"),
      toggleBtn: root.querySelector(".toggle-btn"),
      toggleIcon: root.querySelector(".toggle-btn ha-icon"),
      turboIcon: root.querySelector(".turbo"),
      boostWrap: root.querySelector(".boost-wrap"),
      dec: root.querySelector(".dec"),
      inc: root.querySelector(".inc"),
    };

    this._el.wrap.addEventListener("click", () => {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId: this._config.climate_entity },
          bubbles: true,
          composed: true,
        })
      );
    });

    this._el.fanWrap.addEventListener("click", (e) => {
      e.stopPropagation();
      this._hass.callService("homeassistant", "toggle", {
        entity_id: this._config.climate_entity,
      });
    });

    this._el.toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this._autoEntityId) {
        this._hass.callService("homeassistant", "toggle", {
          entity_id: this._autoEntityId,
        });
      }
    });

    const stepTarget = (delta) => {
      const cur = parseFloat(this._hass.states[this._config.target_temp_entity]?.state);
      if (!Number.isFinite(cur)) return;
      const next = Math.round((cur + delta) * 100) / 100;
      this._hass.callService("input_number", "set_value", {
        entity_id: this._config.target_temp_entity,
        value: next,
      });
    };
    this._el.inc.addEventListener("click", (e) => {
      e.stopPropagation();
      stepTarget(0.05);
    });
    this._el.dec.addEventListener("click", (e) => {
      e.stopPropagation();
      stepTarget(-0.05);
    });

    this._el.boostWrap.addEventListener("click", (e) => {
      e.stopPropagation();
      const cur = this._hass.states[this._config.climate_entity]?.attributes?.preset_mode;
      this._hass.callService("climate", "set_preset_mode", {
        entity_id: this._config.climate_entity,
        preset_mode: cur === "boost" ? "none" : "boost",
      });
    });
  }

  _update() {
    const hass = this._hass;
    const cfg = this._config;
    const climate = hass.states[cfg.climate_entity];
    const roomTemp = hass.states[cfg.room_temp_entity];
    const setTemp = hass.states[cfg.target_temp_entity];
    const season = hass.states[cfg.season_entity];
    const isHeat = season?.state === "on";

    const presetMode = climate?.attributes?.preset_mode;
    const fanMode = (climate?.attributes?.fan_mode || "").toString().toLowerCase();
    const modeCode = climate?.attributes?.mode;
    const modeText = MODE_MAP[modeCode] || "auto";
    const modeCap = modeText.charAt(0).toUpperCase() + modeText.slice(1);
    const displayName = cfg.name || climate?.attributes?.friendly_name || this._base();
    const unitSetpoint = climate?.attributes?.temperature;

    this._el.title.textContent = displayName;
    this._el.modeText.innerHTML = `${modeCap}<br>${fanMode || "—"}`;
    this._el.acSetpoint.textContent = Number.isFinite(unitSetpoint) ? `${unitSetpoint}°` : "—";

    const rt = parseFloat(roomTemp?.state);
    this._el.roomTemp.textContent = Number.isFinite(rt) ? `${rt.toFixed(1)} °C` : "—";
    const tt = parseFloat(setTemp?.state);
    this._el.targetTemp.textContent = Number.isFinite(tt) ? tt.toFixed(2) : "—";
    this._el.targetTemp.style.color = isHeat ? "#fc0000" : "#23aa08";

    const climateState = climate?.state;
    let color;
    if (!climateState || climateState === "unknown" || climateState === "unavailable") color = "#9e9e9e";
    else if (climateState === "off") color = "white";
    else color = isHeat ? "#fc0000" : "#0586f7";
    this._el.fanIcon.style.color = color;

    let anim = "none";
    if (climateState && climateState !== "off" && climateState !== "unknown" && climateState !== "unavailable") {
      let duration = SPEED_MAP[fanMode] || "1.6s";
      if (presetMode === "boost") duration = "0.5s";
      anim = `rotating ${duration} linear infinite`;
    }
    this._el.fanIcon.style.animation = anim;

    this._el.turboIcon.style.color = presetMode === "boost" ? "#ffa31a" : "gray";

    const autoEntityId = isHeat
      ? this._derived("automation_heat_entity", "automation", "_command_winter")
      : this._derived("automation_cool_entity", "automation", "_command");
    this._autoEntityId = autoEntityId;
    const autoState = hass.states[autoEntityId];
    const on = autoState?.state === "on";
    this._el.toggleIcon.setAttribute("icon", on ? "mdi:toggle-switch" : "mdi:toggle-switch-off-outline");
    this._el.toggleIcon.style.color = on ? "#23aa08" : "#fc0000";
  }
}

const LABELS = {
  name: "Display name",
  climate_entity: "AC (climate) entity",
  room_temp_entity: "Room temperature sensor",
  target_temp_entity: "Destination/target temperature (input_number)",
  season_entity: "Heat/Cool selector (on = heat, off = cool)",
  automation_cool_entity: "Automation — cool (optional, auto-derived)",
  automation_heat_entity: "Automation — heat (optional, auto-derived)",
};

const SCHEMA = [
  { name: "name", selector: { text: {} } },
  { name: "climate_entity", required: true, selector: { entity: { domain: "climate" } } },
  { name: "room_temp_entity", required: true, selector: { entity: { domain: "sensor" } } },
  { name: "target_temp_entity", required: true, selector: { entity: { domain: "input_number" } } },
  {
    name: "season_entity",
    required: true,
    selector: { entity: { domain: ["input_boolean", "binary_sensor"] } },
  },
  { name: "automation_cool_entity", selector: { entity: { domain: "automation" } } },
  { name: "automation_heat_entity", selector: { entity: { domain: "automation" } } },
];

class AcControlCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._config = ev.detail.value;
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config: this._config },
            bubbles: true,
            composed: true,
          })
        );
      });
      this.innerHTML = "";
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = SCHEMA;
    this._form.data = this._config;
    this._form.computeLabel = (schema) => LABELS[schema.name] || schema.name;
  }
}

customElements.define("ac-control-card", AcControlCard);
customElements.define("ac-control-card-editor", AcControlCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "ac-control-card",
  name: "AC Control Card",
  description: "Midea AC tile: room temp, target temp, fan animation, boost, and a heat/cool-aware automation toggle.",
});
