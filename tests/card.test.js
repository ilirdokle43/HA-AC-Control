/**
 * Test suite for ac-control-card.
 *
 * Runs in any browser, no test framework and no dependencies: open
 * `tests/index.html` through a local web server. Covers the state logic, the
 * service calls, per-room independence and the responsive layout.
 *
 * All entity ids are fictional demo ids.
 */

import { installStubs, makeHass, demoStates, climate, sensor, number, toggle, DEMO_CONFIG } from "./ha-stubs.js";
import { CARD_VERSION, AcControlCard } from "../ac-control-card.js";

installStubs();

/* ------------------------------------------------------------- framework */

const suites = [];
let current = null;

function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}

function it(name, fn) {
  current.tests.push({ name, fn });
}

function fail(msg) {
  throw new Error(msg);
}

const assert = {
  ok(v, msg) {
    if (!v) fail(msg || `expected truthy, got ${JSON.stringify(v)}`);
  },
  notOk(v, msg) {
    if (v) fail(msg || `expected falsy, got ${JSON.stringify(v)}`);
  },
  equal(a, b, msg) {
    if (a !== b) fail(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  close(a, b, tol, msg) {
    if (!(Math.abs(a - b) <= (tol === undefined ? 0.001 : tol))) {
      fail(msg || `expected ~${b}, got ${a}`);
    }
  },
  match(str, re, msg) {
    if (!re.test(str)) fail(msg || `expected ${JSON.stringify(str)} to match ${re}`);
  },
  throws(fn, msg) {
    let threw = false;
    try {
      fn();
    } catch (_e) {
      threw = true;
    }
    if (!threw) fail(msg || "expected the call to throw");
  },
};

/* ---------------------------------------------------------------- helpers */

function stage() {
  let s = document.getElementById("stage");
  if (!s) {
    s = document.createElement("div");
    s.id = "stage";
    document.body.appendChild(s);
  }
  return s;
}

/** Mount a card at a given CSS width and return handy accessors. */
function mount(config, hass, width = 520) {
  const host = document.createElement("div");
  host.style.width = `${width}px`;
  host.style.margin = "0 0 12px";
  stage().appendChild(host);

  const card = document.createElement("ac-control-card");
  card.setConfig(config);
  card.hass = hass;
  host.appendChild(card);

  // Emulate HA pushing a new state object after each service call.
  hass.onChange = () => {
    card.hass = hass;
  };

  const sr = card.shadowRoot;
  return {
    card,
    host,
    hass,
    q: (sel) => sr.querySelector(sel),
    qa: (sel) => Array.from(sr.querySelectorAll(sel)),
    rows: () => Array.from(sr.querySelectorAll(".roomrow")),
    row: (i) => sr.querySelectorAll(".roomrow")[i],
    refs(i) {
      const r = sr.querySelectorAll(".roomrow")[i];
      return {
        row: r,
        name: r.querySelector(".name"),
        cur: r.querySelector(".big.cur"),
        target: r.querySelector(".target"),
        delta: r.querySelector(".delta"),
        status: r.querySelector(".status"),
        statusMain: r.querySelector(".statusmain"),
        icon: r.querySelector(".modeicon"),
        glyph: r.querySelector(".modeicon ha-icon"),
        statusCol: r.querySelector(".statuscol"),
        boost: r.querySelector(".ctl.boost"),
        minus: r.querySelector(".ctl.minus"),
        plus: r.querySelector(".ctl.plus"),
        power: r.querySelector(".ctl.power"),
        auto: r.querySelector(".ctl.auto"),
        controls: r.querySelector(".controls"),
        text: r.querySelector(".roomtext"),
      };
    },
  };
}

/**
 * Let layout settle. Deliberately a timer rather than requestAnimationFrame:
 * rAF is paused in a background or non-compositing tab, which would hang the
 * whole suite. Reading a bounding box forces layout anyway.
 */
const frame = () => new Promise((r) => setTimeout(r, 40));

/** A one-room config over the demo bedroom entities. */
function oneRoom(extra = {}) {
  return { type: "custom:ac-control-card", rooms: [{ ...DEMO_CONFIG.rooms[0], ...extra }] };
}

function rects(a, b) {
  const x = a.getBoundingClientRect();
  const y = b.getBoundingClientRect();
  const overlap = !(x.right <= y.left + 0.5 || y.right <= x.left + 0.5 || x.bottom <= y.top + 0.5 || y.bottom <= x.top + 0.5);
  return { x, y, overlap };
}

/* ============================================================== the tests */

describe("registration", () => {
  it("defines both custom elements", () => {
    assert.ok(customElements.get("ac-control-card"), "card element missing");
    assert.ok(customElements.get("ac-control-card-editor"), "editor element missing");
  });

  it("registers itself in window.customCards exactly once", () => {
    const mine = (window.customCards || []).filter((c) => c.type === "ac-control-card");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].name, "AC Control Card");
  });

  it("exports a version string", () => {
    // Date-based: YYYY.M.D, with a trailing counter for a second release the
    // same day (YYYY.M.D.1). Older semver releases match the same shape.
    assert.match(CARD_VERSION, /^\d+\.\d+\.\d+(\.\d+)?$/);
  });
});

describe("config", () => {
  it("normalises a flat v1 config into one room", () => {
    const rooms = AcControlCard.normaliseRooms({
      name: "Bedroom",
      climate_entity: "climate.demo_bedroom_ac",
      room_temp_entity: "sensor.demo_bedroom_temperature",
      target_temp_entity: "input_number.demo_bedroom_target",
      season_entity: "input_boolean.demo_heating_season",
    });
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].climate_entity, "climate.demo_bedroom_ac");
    assert.equal(rooms[0].name, "Bedroom");
  });

  it("keeps every room from a rooms: list", () => {
    assert.equal(AcControlCard.normaliseRooms(DEMO_CONFIG).length, 3);
  });

  it("renders a v1 flat config unchanged (backwards compatibility)", () => {
    const m = mount(
      {
        type: "custom:ac-control-card",
        name: "Bedroom",
        climate_entity: "climate.demo_bedroom_ac",
        room_temp_entity: "sensor.demo_bedroom_temperature",
        target_temp_entity: "input_number.demo_bedroom_target",
        season_entity: "input_boolean.demo_heating_season",
      },
      makeHass(),
    );
    assert.equal(m.rows().length, 1);
    assert.equal(m.refs(0).name.textContent, "Bedroom");
    assert.match(m.refs(0).cur.textContent, /26\.5/);
  });

  it("throws on structurally invalid config", () => {
    const card = document.createElement("ac-control-card");
    assert.throws(() => card.setConfig(null), "null config should throw");
    assert.throws(() => card.setConfig({ rooms: "nope" }), "rooms must be a list");
    assert.throws(() => card.setConfig({ rooms: [] }), "empty rooms should throw");
    assert.throws(
      () => card.setConfig({ rooms: [{ climate_entity: "not-an-entity-id" }] }),
      "bad entity id should throw",
    );
    assert.throws(
      () => card.setConfig({ ...oneRoom(), temperature_step: -1 }),
      "negative step should throw",
    );
  });

  it("does not throw on an incomplete config, so the GUI editor stays usable", () => {
    const card = document.createElement("ac-control-card");
    card.setConfig({ type: "custom:ac-control-card", rooms: [{ room_name: "New" }] });
    card.hass = makeHass();
    assert.ok(card.shadowRoot.querySelector(".notice"));
    assert.notOk(card.shadowRoot.querySelector(".notice").hidden, "notice should be visible");
    assert.match(card.shadowRoot.querySelector(".notice").textContent, /Not configured yet/);
  });

  it("sizes itself from the number of rooms", () => {
    const one = mount(oneRoom(), makeHass());
    const three = mount(DEMO_CONFIG, makeHass());
    assert.ok(
      three.card.getCardSize() > one.card.getCardSize(),
      "three rooms should count for more than one",
    );
    assert.ok(
      three.card.getLayoutOptions().grid_rows > one.card.getLayoutOptions().grid_rows,
      "three rooms should need more grid rows than one",
    );
  });

  it("lets a sections view size the row from the real card", () => {
    // A fixed row count cannot be right at every width, so the card must not
    // name one. Naming one too small is what let neighbouring cards overlap it.
    assert.equal(mount(DEMO_CONFIG, makeHass()).card.getGridOptions().rows, "auto");
  });

  it("never claims fewer grid rows than it renders, at any width", () => {
    // Below 430px the controls drop onto their own line and every room row
    // grows by ~50%. An estimate blind to that overlaps the card below it.
    for (const width of [260, 300, 380, 520, 700]) {
      for (const config of [oneRoom(), DEMO_CONFIG]) {
        const m = mount(config, makeHass(), width);
        const real = m.card.getBoundingClientRect().height;
        const rows = m.card.getLayoutOptions().grid_rows;
        const held = rows * 56 + (rows - 1) * 8;
        assert.ok(
          held >= real,
          `at ${width}px: ${rows} rows hold ${held}px but the card renders ${Math.round(real)}px`,
        );
      }
    }
  });
});

describe("temperatures", () => {
  it("shows the room temperature to one decimal", () => {
    const m = mount(oneRoom(), makeHass());
    assert.equal(m.refs(0).cur.textContent, "26.5°");
  });

  it("shows the target to one decimal", () => {
    const m = mount(oneRoom(), makeHass());
    assert.equal(m.refs(0).target.textContent, "Target 20.0°");
  });

  it("shows a dash rather than a fake number when the sensor is unavailable", () => {
    const s = demoStates();
    s["sensor.demo_bedroom_temperature"] = sensor("unavailable");
    const m = mount(oneRoom(), makeHass(s));
    assert.equal(m.refs(0).cur.textContent, "—");
    assert.notOk(/NaN|undefined|unknown/i.test(m.refs(0).cur.textContent));
  });

  it("never carries both season colours at once", () => {
    // Regression: classList.toggle(name, undefined) toggles instead of forcing,
    // so an unavailable target used to accumulate .heat and .cool together.
    const s = demoStates();
    delete s["input_number.demo_bedroom_target"];
    const m = mount(oneRoom(), makeHass(s));
    for (let i = 0; i < 3; i += 1) m.card.hass = m.hass; // several renders
    const cl = m.refs(0).target.classList;
    assert.notOk(cl.contains("heat") && cl.contains("cool"), "both season classes applied");
    assert.equal(m.refs(0).target.textContent, "Target —");
  });

  it("colours the target green when cooling and red in the heating season", () => {
    const cool = mount(oneRoom(), makeHass());
    assert.ok(cool.refs(0).target.classList.contains("cool"));

    const s = demoStates();
    s["input_boolean.demo_heating_season"] = toggle("on");
    const heat = mount(oneRoom(), makeHass(s));
    assert.ok(heat.refs(0).target.classList.contains("heat"));
  });

  it("leaves the target neutral when no season entity is configured", () => {
    const m = mount(oneRoom({ season_entity: undefined }), makeHass());
    const cl = m.refs(0).target.classList;
    assert.notOk(cl.contains("cool"));
    assert.notOk(cl.contains("heat"));
  });
});

describe("difference badge", () => {
  const badge = (cur, tgt) => {
    const s = demoStates();
    s["sensor.demo_bedroom_temperature"] = sensor(cur);
    s["input_number.demo_bedroom_target"] = number(tgt);
    return mount(oneRoom(), makeHass(s)).refs(0).delta;
  };

  it("points up and reads blue when the room is warmer", () => {
    const d = badge(26.5, 20);
    assert.equal(d.hidden, false);
    assert.equal(d.textContent, "▲ 6.5°");
    assert.ok(d.classList.contains("above"));
  });

  it("points down and reads orange when the room is colder", () => {
    const d = badge(19.8, 20);
    assert.equal(d.textContent, "▼ 0.2°");
    assert.ok(d.classList.contains("below"));
  });

  it("always shows exactly one decimal", () => {
    assert.equal(badge(24, 19).textContent, "▲ 5.0°");
    assert.equal(badge(20.05, 20).textContent, "▲ 0.1°");
  });

  it("says 'at target' instead of a zero arrow", () => {
    const d = badge(20, 20);
    assert.equal(d.textContent, "at target");
    assert.ok(d.classList.contains("even"));
  });

  it("hides rather than printing NaN when a value is missing", () => {
    const s = demoStates();
    s["sensor.demo_bedroom_temperature"] = sensor("unknown");
    const d = mount(oneRoom(), makeHass(s)).refs(0).delta;
    assert.equal(d.hidden, true);
    assert.equal(d.textContent, "");
  });
});

describe("hvac status and icon", () => {
  const forMode = (state, attrs) => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate(state, attrs);
    return mount(oneRoom(), makeHass(s)).refs(0);
  };

  it("maps every hvac mode to its label", () => {
    assert.equal(forMode("off").statusMain.textContent, "OFF");
    assert.equal(forMode("cool").statusMain.textContent, "COOL");
    assert.equal(forMode("heat").statusMain.textContent, "HEAT");
    assert.equal(forMode("dry").statusMain.textContent, "DRY");
    assert.equal(forMode("fan_only").statusMain.textContent, "FAN");
    assert.equal(forMode("auto").statusMain.textContent, "AUTO");
    assert.equal(forMode("heat_cool").statusMain.textContent, "AUTO");
  });

  it("says UNAVAILABLE and mutes the row when the climate entity is down", () => {
    const r = forMode("unavailable");
    assert.equal(r.statusMain.textContent, "UNAVAILABLE");
    assert.ok(r.row.classList.contains("unavailable"));
  });

  it("colours the icon by mode", () => {
    assert.ok(forMode("cool").icon.classList.contains("m-cool"));
    assert.ok(forMode("heat").icon.classList.contains("m-heat"));
    assert.ok(forMode("dry").icon.classList.contains("m-dry"));
    assert.ok(forMode("fan_only").icon.classList.contains("m-fan"));
    assert.ok(forMode("off").icon.classList.contains("m-off"));
    assert.ok(forMode("unavailable").icon.classList.contains("m-na"));
  });

  it("marks the icon as running only when the unit is actually working", () => {
    assert.ok(forMode("cool", { hvac_action: "cooling" }).icon.classList.contains("running"));
    assert.notOk(forMode("cool", { hvac_action: "idle" }).icon.classList.contains("running"));
    assert.notOk(forMode("off").icon.classList.contains("running"));
  });

  it("always uses the fan glyph, whatever the mode", () => {
    for (const state of ["off", "cool", "heat", "dry", "fan_only", "auto", "unavailable"]) {
      assert.equal(
        forMode(state).glyph.getAttribute("icon"),
        "mdi:fan",
        `${state} should still show the fan`,
      );
    }
  });

  it("lets a room override the glyph", () => {
    const m = mount(oneRoom({ icon: "mdi:air-conditioner" }), makeHass());
    assert.equal(m.refs(0).glyph.getAttribute("icon"), "mdi:air-conditioner");
  });

  it("spins the fan only while air is actually moving", () => {
    const spins = (state, attrs) => forMode(state, attrs).glyph.style.animationName === "acc-spin";

    assert.ok(spins("cool", { hvac_action: "cooling" }), "cooling should spin");
    assert.ok(spins("heat", { hvac_action: "heating" }), "heating should spin");
    assert.ok(spins("fan_only", { hvac_action: "fan" }), "fan-only moves air, so it spins");
    assert.ok(spins("cool"), "no hvac_action reported: on means blowing");

    assert.notOk(spins("cool", { hvac_action: "idle" }), "idle must not spin");
    assert.notOk(spins("cool", { hvac_action: "off" }), "action off must not spin");
    assert.notOk(spins("off"), "a unit that is off must not spin");
    assert.notOk(spins("unavailable"), "an unavailable unit must not spin");
  });

  it("spins the icon at the reported fan speed, faster on boost", () => {
    assert.match(forMode("cool", { fan_mode: "low" }).icon.querySelector("ha-icon").style.animation, /3s/);
    assert.match(forMode("cool", { fan_mode: "high" }).icon.querySelector("ha-icon").style.animation, /1\.2s/);
    assert.match(
      forMode("cool", { fan_mode: "high", preset_mode: "boost" }).icon.querySelector("ha-icon").style.animation,
      /0\.5s/,
    );
    // Browsers expand the `animation` shorthand on read-back, so check the name.
    assert.equal(forMode("off").icon.querySelector("ha-icon").style.animationName, "none");
  });

  it("spins about its own centre", () => {
    const r = forMode("cool", { hvac_action: "cooling" });
    const glyph = r.glyph;
    const cs = getComputedStyle(glyph);
    const [ox, oy] = cs.transformOrigin.split(" ").map(parseFloat);
    const w = parseFloat(cs.width);
    const h = parseFloat(cs.height);
    assert.close(ox, w / 2, 0.5, `x origin ${ox} is not half of ${w}`);
    assert.close(oy, h / 2, 0.5, `y origin ${oy} is not half of ${h}`);
  });

  it("centres the fan inside its square", async () => {
    const m = mount(oneRoom(), makeHass(), 520);
    await frame();
    const r = m.refs(0);
    // Measured while stationary: a mid-spin bounding box is a rotated square,
    // which is wider than the glyph but shares its centre.
    const box = r.icon.getBoundingClientRect();
    const glyph = r.glyph.getBoundingClientRect();
    assert.close(glyph.x + glyph.width / 2, box.x + box.width / 2, 0.5, "off centre horizontally");
    assert.close(glyph.y + glyph.height / 2, box.y + box.height / 2, 0.5, "off centre vertically");
  });

  it("keeps the fan speed and unit setpoint visible next to the mode", () => {
    const r = forMode("cool", { fan_mode: "high", temperature: 17 });
    assert.match(r.status.textContent, /COOL/);
    assert.match(r.status.textContent, /HIGH/);
    assert.match(r.status.textContent, /17°/);
  });
});

describe("target temperature controls", () => {
  it("steps by 0.5 by default", () => {
    const m = mount(oneRoom(), makeHass());
    m.refs(0).plus.click();
    const call = m.hass.calls.at(-1);
    assert.equal(call.domain, "input_number");
    assert.equal(call.service, "set_value");
    assert.equal(call.target.entity_id, "input_number.demo_bedroom_target");
    assert.close(call.data.value, 20.5);

    m.refs(0).minus.click();
    assert.close(m.hass.calls.at(-1).data.value, 20);
  });

  it("honours a custom temperature_step", () => {
    const m = mount({ ...oneRoom(), temperature_step: 1 }, makeHass());
    m.refs(0).plus.click();
    assert.close(m.hass.calls.at(-1).data.value, 21);
  });

  it("accumulates rapid presses instead of resending the same value", () => {
    const hass = makeHass();
    const m = mount(oneRoom(), hass);
    hass.onChange = null; // no round trip yet
    m.refs(0).plus.click();
    m.refs(0).plus.click();
    m.refs(0).plus.click();
    const values = hass.calls.map((c) => c.data.value);
    assert.equal(values.length, 3);
    assert.close(values[0], 20.5);
    assert.close(values[1], 21);
    assert.close(values[2], 21.5);
  });

  it("never drifts past the helper's own min/max", () => {
    const s = demoStates();
    s["input_number.demo_bedroom_target"] = number(30, { min: 16, max: 30 });
    const m = mount(oneRoom(), makeHass(s));
    assert.equal(m.refs(0).plus.disabled, true, "plus should be disabled at max");
    m.refs(0).plus.click();
    assert.equal(m.hass.calls.length, 0, "no service call at the ceiling");

    const s2 = demoStates();
    s2["input_number.demo_bedroom_target"] = number(16, { min: 16, max: 30 });
    const m2 = mount(oneRoom(), makeHass(s2));
    assert.equal(m2.refs(0).minus.disabled, true, "minus should be disabled at min");
  });

  it("disables both steppers when the helper is unavailable", () => {
    const s = demoStates();
    s["input_number.demo_bedroom_target"] = { state: "unavailable", attributes: {} };
    const m = mount(oneRoom(), makeHass(s));
    assert.equal(m.refs(0).plus.disabled, true);
    assert.equal(m.refs(0).minus.disabled, true);
    m.refs(0).plus.click();
    assert.equal(m.hass.calls.length, 0);
  });
});

describe("power button", () => {
  it("toggles the climate entity", () => {
    const m = mount(oneRoom(), makeHass());
    m.refs(0).power.click();
    const call = m.hass.calls.at(-1);
    assert.equal(call.domain, "homeassistant");
    assert.equal(call.service, "toggle");
    assert.equal(call.target.entity_id, "climate.demo_bedroom_ac");
  });

  it("shows an on state only while the unit is on", () => {
    const off = mount(oneRoom(), makeHass());
    assert.notOk(off.refs(0).power.classList.contains("on"));

    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("cool");
    const on = mount(oneRoom(), makeHass(s));
    assert.ok(on.refs(0).power.classList.contains("on"));
    assert.ok(on.refs(0).power.classList.contains("m-cool"), "adopts the mode colour");
  });

  it("carries exactly one mode colour after the mode changes", () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("cool");
    const m = mount(oneRoom(), makeHass(s));
    assert.ok(m.refs(0).power.classList.contains("m-cool"));

    s["climate.demo_bedroom_ac"] = climate("heat");
    m.card.hass = m.hass;
    const cl = m.refs(0).power.classList;
    assert.ok(cl.contains("m-heat"), "should adopt the new mode colour");
    assert.notOk(cl.contains("m-cool"), "stale mode colour left behind");
  });

  it("is disabled and inert when the climate entity is unavailable", () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("unavailable");
    const m = mount(oneRoom(), makeHass(s));
    assert.equal(m.refs(0).power.disabled, true);
    m.refs(0).power.click();
    assert.equal(m.hass.calls.length, 0);
  });
});

describe("AUTO button", () => {
  it("targets the cool automation derived from the climate entity", () => {
    const m = mount(oneRoom(), makeHass());
    m.refs(0).auto.click();
    assert.equal(m.hass.calls.at(-1).target.entity_id, "automation.demo_bedroom_ac_command");
  });

  it("switches to the winter automation during the heating season", () => {
    const s = demoStates();
    s["input_boolean.demo_heating_season"] = toggle("on");
    s["automation.demo_bedroom_ac_command_winter"] = toggle("off");
    const m = mount(oneRoom(), makeHass(s));
    m.refs(0).auto.click();
    assert.equal(m.hass.calls.at(-1).target.entity_id, "automation.demo_bedroom_ac_command_winter");
  });

  it("respects an explicit automation override", () => {
    const s = demoStates();
    s["automation.demo_custom"] = toggle("on");
    const m = mount(oneRoom({ automation_cool_entity: "automation.demo_custom" }), makeHass(s));
    m.refs(0).auto.click();
    assert.equal(m.hass.calls.at(-1).target.entity_id, "automation.demo_custom");
  });

  it("shows a coloured active state", () => {
    const s = demoStates();
    s["automation.demo_bedroom_ac_command"] = toggle("on");
    const on = mount(oneRoom(), makeHass(s));
    assert.ok(on.refs(0).auto.classList.contains("on"));
    assert.equal(on.refs(0).auto.getAttribute("aria-pressed"), "true");

    const off = mount(oneRoom(), makeHass());
    assert.ok(off.refs(0).auto.classList.contains("off"));
    assert.equal(off.refs(0).auto.getAttribute("aria-pressed"), "false");
  });

  it("is disabled when the automation does not exist", () => {
    const s = demoStates();
    delete s["automation.demo_bedroom_ac_command"];
    const m = mount(oneRoom(), makeHass(s));
    assert.equal(m.refs(0).auto.disabled, true);
    m.refs(0).auto.click();
    assert.equal(m.hass.calls.length, 0);
  });
});

describe("boost control", () => {
  const forState = (state, attrs) => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate(state, attrs);
    return mount(oneRoom(), makeHass(s)).refs(0);
  };

  it("lives under the fan, not in the control row", () => {
    const m = mount(oneRoom(), makeHass());
    assert.ok(m.refs(0).statusCol.contains(m.refs(0).boost), "boost belongs to the left column");
    assert.notOk(
      m.refs(0).controls.contains(m.refs(0).boost),
      "boost must not sit in the right-hand control row",
    );
  });

  it("leaves exactly four buttons in the control row", () => {
    const m = mount(DEMO_CONFIG, makeHass());
    for (let i = 0; i < 3; i += 1) {
      const buttons = m.refs(i).controls.querySelectorAll("button");
      assert.equal(buttons.length, 4, `room ${i} should have minus, plus, power, AUTO`);
      const classes = Array.from(buttons).map((b) => b.classList[1]);
      assert.equal(classes.join(","), "minus,plus,power,auto");
    }
  });

  it("sits directly beneath the fan and stays centred with it", async () => {
    const m = mount(oneRoom(), makeHass(), 520);
    await frame();
    const r = m.refs(0);
    const fan = r.icon.getBoundingClientRect();
    const boost = r.boost.getBoundingClientRect();
    assert.ok(boost.top >= fan.bottom - 0.5, "boost should sit below the fan");
    const dx = Math.abs((boost.left + boost.width / 2) - (fan.left + fan.width / 2));
    assert.ok(dx < 2, `boost should be centred under the fan, off by ${dx.toFixed(1)}px`);
  });

  it("is the same square as the fan button above it", async () => {
    for (const w of [520, 380, 250]) {
      const m = mount(oneRoom(), makeHass(), w);
      await frame();
      const r = m.refs(0);
      const fan = r.icon.getBoundingClientRect();
      const boost = r.boost.getBoundingClientRect();
      assert.close(boost.width, fan.width, 0.5, `width differs at ${w}px`);
      assert.close(boost.height, fan.height, 0.5, `height differs at ${w}px`);
      assert.close(boost.width, boost.height, 0.5, `not square at ${w}px`);
      const radius = (e) => getComputedStyle(e).borderTopLeftRadius;
      assert.equal(radius(r.boost), radius(r.icon), `radius differs at ${w}px`);
    }
  });

  it("holds only the rocket — no BOOST text", () => {
    const m = mount(oneRoom(), makeHass());
    const b = m.refs(0).boost;
    assert.equal(b.textContent.trim(), "", `found leftover label text: ${b.textContent}`);
    assert.equal(b.querySelectorAll("ha-icon").length, 1);
    assert.equal(b.querySelector("ha-icon").getAttribute("icon"), "mdi:rocket-launch");
  });

  it("draws its rocket at the same size as the fan glyph", async () => {
    const m = mount(oneRoom(), makeHass(), 520);
    await frame();
    const r = m.refs(0);
    const size = (e) => getComputedStyle(e.querySelector("ha-icon")).width;
    assert.equal(size(r.boost), size(r.icon), "icon sizes differ");
  });

  it("keeps equal spacing between the two squares", async () => {
    const m = mount(oneRoom(), makeHass(), 520);
    await frame();
    const r = m.refs(0);
    const gap = r.boost.getBoundingClientRect().top - r.icon.getBoundingClientRect().bottom;
    // What the column asked for is what shows: no stray margin on either
    // square. The size itself is a design choice and is checked with the rest
    // of the stacked layout.
    const cs = getComputedStyle(r.statusCol);
    const asked = parseFloat(cs.rowGap || cs.gap) || 0;
    assert.close(gap, asked, 0.6, `gap of ${gap.toFixed(1)}px against a ${asked}px rule`);
    assert.ok(gap >= 3 && gap <= 30, `unexpected gap of ${gap.toFixed(1)}px`);
  });

  it("still calls the same service on the same entity", () => {
    const m = mount(oneRoom(), makeHass());
    m.refs(0).boost.click();
    const call = m.hass.calls.at(-1);
    assert.equal(call.domain, "climate");
    assert.equal(call.service, "set_preset_mode");
    assert.equal(call.data.preset_mode, "boost");
    assert.equal(call.target.entity_id, "climate.demo_bedroom_ac");
  });

  it("turns boost off again when it is already on", () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("cool", { preset_mode: "boost" });
    const m = mount(oneRoom(), makeHass(s));
    assert.ok(m.refs(0).boost.classList.contains("on"));
    m.refs(0).boost.click();
    assert.equal(m.hass.calls.at(-1).data.preset_mode, "none");
  });

  it("is highlighted only while that room is in boost", () => {
    assert.ok(forState("cool", { preset_mode: "boost" }).boost.classList.contains("on"));
    assert.notOk(forState("cool").boost.classList.contains("on"));
  });

  it("is disabled, muted and inert when the room is unavailable", () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("unavailable", { preset_mode: "boost" });
    const m = mount(oneRoom(), makeHass(s));
    assert.equal(m.refs(0).boost.disabled, true);
    assert.notOk(m.refs(0).boost.classList.contains("on"), "must not claim boost on a dead entity");
    m.refs(0).boost.click();
    assert.equal(m.hass.calls.length, 0);
  });

  it("disappears on units without a boost preset", () => {
    assert.equal(forState("cool", { preset_modes: ["none", "eco"] }).boost.hidden, true);
  });

  it("can be switched off globally", () => {
    const m = mount({ ...oneRoom(), show_boost: false }, makeHass());
    assert.equal(m.refs(0).boost.hidden, true);
  });

  it("keeps every room's boost state and action independent", () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("cool", { preset_mode: "boost" });
    s["climate.demo_office_ac"] = climate("cool", { preset_mode: "none" });
    s["climate.demo_living_room_ac"] = climate("unavailable", { preset_mode: "boost" });
    const m = mount(DEMO_CONFIG, makeHass(s));

    assert.ok(m.refs(0).boost.classList.contains("on"), "bedroom is in boost");
    assert.notOk(m.refs(1).boost.classList.contains("on"), "office must not inherit it");
    assert.notOk(m.refs(2).boost.classList.contains("on"), "unavailable room must not claim it");

    m.refs(1).boost.click();
    assert.equal(m.hass.calls.at(-1).target.entity_id, "climate.demo_office_ac");
  });

  it("stays under the fan on mobile instead of joining the control row", async () => {
    for (const w of [380, 300, 250]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const r = m.refs(0);
      const fan = r.icon.getBoundingClientRect();
      const boost = r.boost.getBoundingClientRect();
      assert.ok(boost.height > 0, `boost must stay visible at ${w}px`);
      assert.ok(boost.top >= fan.bottom - 0.5, `boost drifted beside the fan at ${w}px`);
      assert.notOk(r.controls.contains(r.boost), `boost joined the control row at ${w}px`);
    }
  });

  it("keeps rows compact", async () => {
    // The left column is exactly the two squares plus their gap — whatever size
    // the container has scaled them to — and the rows follow it. Asserted
    // against the measured square rather than a fixed 38px, since above 470px
    // the squares grow with the container by design.
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    await frame();
    const square = m.refs(0).icon.getBoundingClientRect().height;
    const cs = getComputedStyle(m.refs(0).statusCol);
    const gap = parseFloat(cs.rowGap || cs.gap) || 0;
    const col = m.refs(0).statusCol.getBoundingClientRect().height;
    assert.close(
      col,
      square * 2 + gap,
      1.5,
      `left column is not two ${Math.round(square)}px squares plus a ${gap}px gap`,
    );
    // A row is only ever as tall as its tallest column plus the row's own
    // padding. Measured against all three columns rather than the left one:
    // above 430px the stacked control block is the tallest of them by design,
    // and pinning this to the fan column would just be pinning the old
    // four-across arrangement.
    for (const [i, row] of m.rows().entries()) {
      const refs = m.refs(i);
      const tallest = Math.max(
        refs.statusCol.getBoundingClientRect().height,
        refs.text.getBoundingClientRect().height,
        refs.controls.getBoundingClientRect().height,
      );
      // Read the row's own padding and separator rather than assuming them:
      // both are fluid above 470px.
      const rs = getComputedStyle(row);
      const chrome =
        parseFloat(rs.paddingTop) + parseFloat(rs.paddingBottom) +
        parseFloat(rs.borderTopWidth) + parseFloat(rs.borderBottomWidth) +
        parseFloat(rs.marginTop || 0) + parseFloat(rs.marginBottom || 0);
      const h = row.getBoundingClientRect().height;
      assert.ok(
        h <= tallest + chrome + 2,
        `row ${i} is ${Math.round(h)}px around a ${Math.round(tallest)}px column ` +
          `plus ${Math.round(chrome)}px of padding`,
      );
    }
  });

  it("does not push the target temperature into a mid-phrase wrap", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    await frame();
    const el = m.refs(0).target;
    const target = el.getBoundingClientRect();
    // One line, whatever size that line is: the phrase grew with the card, so
    // a fixed pixel ceiling would only be measuring the old type scale.
    const line = parseFloat(getComputedStyle(el).fontSize) * 1.45;
    assert.ok(target.height < line, `"Target …" wrapped onto ${target.height.toFixed(1)}px of lines`);
  });
});

describe("no gas anywhere", () => {
  it("renders no gas node, bar or header", () => {
    const m = mount(DEMO_CONFIG, makeHass());
    for (const sel of [".gas", ".bar", ".fill", ".head", ".unit"]) {
      assert.equal(m.q(sel), null, `${sel} should not exist`);
    }
    assert.notOk(/gas/i.test(m.q(".surface").textContent), "no gas text on the card");
  });

  it("starts the first room at the top of the card", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    await frame();
    const surface = m.q(".surface").getBoundingClientRect();
    const first = m.row(0).getBoundingClientRect();
    const gap = first.top - surface.top;
    assert.ok(gap < 20, `first room should sit near the top, found ${gap.toFixed(1)}px of space`);
  });

  it("ignores stray gas options instead of rendering anything for them", () => {
    const m = mount({ ...DEMO_CONFIG, gas_entity: "sensor.whatever" }, makeHass());
    assert.equal(m.q(".gas"), null);
    assert.equal(m.rows().length, 3);
  });
});

describe("room independence", () => {
  it("does not let an unavailable room affect its neighbours", () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("unavailable");
    s["sensor.demo_bedroom_temperature"] = sensor("unavailable");
    s["climate.demo_office_ac"] = climate("cool", { fan_mode: "low" });
    const m = mount(DEMO_CONFIG, makeHass(s));

    assert.ok(m.refs(0).row.classList.contains("unavailable"));
    assert.notOk(m.refs(1).row.classList.contains("unavailable"), "office must stay normal");
    assert.equal(m.refs(1).statusMain.textContent, "COOL");
    assert.equal(m.refs(1).power.disabled, false);
    assert.equal(m.refs(1).cur.textContent, "19.8°");
    assert.equal(m.refs(2).statusMain.textContent, "OFF");
  });

  it("computes each room's badge from its own two entities", () => {
    const m = mount(DEMO_CONFIG, makeHass());
    assert.equal(m.refs(0).delta.textContent, "▲ 6.5°"); // 26.5 vs 20
    assert.equal(m.refs(1).delta.textContent, "▼ 0.2°"); // 19.8 vs 20
    assert.equal(m.refs(2).delta.textContent, "▲ 5.0°"); // 24.0 vs 19
  });

  it("sends each room's service calls to that room's entities only", () => {
    const m = mount(DEMO_CONFIG, makeHass());
    m.refs(1).plus.click();
    assert.equal(m.hass.calls.at(-1).target.entity_id, "input_number.demo_office_target");
    m.refs(2).power.click();
    assert.equal(m.hass.calls.at(-1).target.entity_id, "climate.demo_living_room_ac");
  });

  it("keeps each room on its own season", () => {
    const s = demoStates();
    s["input_boolean.demo_heating_season"] = toggle("on");
    const m = mount(DEMO_CONFIG, makeHass(s));
    assert.ok(m.refs(0).target.classList.contains("heat"), "bedroom follows the season entity");
    assert.notOk(
      m.refs(1).target.classList.contains("heat"),
      "office has no season entity and must not inherit the bedroom's",
    );
  });
});

describe("responsive layout", () => {
  it("keeps room text left and controls right on a wide card", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    await frame();
    const r = m.refs(0);
    const { x, y, overlap } = rects(r.text, r.controls);
    assert.notOk(overlap, "text and controls must not overlap");
    assert.ok(x.right <= y.left + 0.5, "controls sit to the right of the text");
  });

  it("drops the controls onto their own line on a phone-width card", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 380);
    await frame();
    const r = m.refs(0);
    const { x, y, overlap } = rects(r.text, r.controls);
    assert.notOk(overlap, "text and controls must not overlap");
    assert.ok(y.top >= x.bottom - 0.5, "controls sit below the text");
  });

  it("never scrolls horizontally at any width", async () => {
    for (const w of [1024, 900, 792, 768, 700, 665, 600, 520, 430, 380, 320, 260, 220]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const surface = m.q(".surface");
      assert.ok(
        surface.scrollWidth <= surface.clientWidth + 1,
        `horizontal overflow at ${w}px (${surface.scrollWidth} > ${surface.clientWidth})`,
      );
      const host = m.card.getBoundingClientRect();
      assert.ok(host.width <= w + 0.5, `card wider than its slot at ${w}px`);
    }
  });

  it("keeps every control a comfortable tap target, even at 220px", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 220);
    await frame();
    const r = m.refs(0);
    for (const [label, btn] of Object.entries({
      minus: r.minus,
      plus: r.plus,
      power: r.power,
      auto: r.auto,
    })) {
      const box = btn.getBoundingClientRect();
      assert.ok(box.height >= 36, `${label} only ${box.height.toFixed(1)}px tall`);
      assert.ok(box.width >= 36, `${label} only ${box.width.toFixed(1)}px wide`);
    }
  });

  it("keeps rows from colliding with each other", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 360);
    await frame();
    const [a, b, c] = m.rows().map((r) => r.getBoundingClientRect());
    assert.ok(b.top >= a.bottom - 0.5, "row 2 overlaps row 1");
    assert.ok(c.top >= b.bottom - 0.5, "row 3 overlaps row 2");
  });

  it("grows in height with the number of rooms", async () => {
    const one = mount(oneRoom(), makeHass(), 400);
    const three = mount(DEMO_CONFIG, makeHass(), 400);
    await frame();
    assert.ok(
      three.card.getBoundingClientRect().height > one.card.getBoundingClientRect().height,
      "three rooms should be taller than one",
    );
  });
});

/* ------------------------------------------------------------------- run */

describe("heating season", () => {
  const heating = (states) => {
    const s = states || demoStates();
    s["input_boolean.demo_heating_season"] = toggle("on");
    return s;
  };

  it("paints a running fan red whatever mode the unit reports", () => {
    for (const mode of ["cool", "dry", "fan_only", "auto", "heat"]) {
      const s = heating();
      s["climate.demo_bedroom_ac"] = climate(mode, { hvac_action: "heating", fan_mode: "high" });
      const m = mount(oneRoom(), makeHass(s), 520);
      assert.match(
        m.refs(0).icon.className,
        /m-heat/,
        `${mode} should still show a red fan during the heating season`,
      );
    }
  });

  it("leaves the fan on its own mode colour outside the heating season", () => {
    const s = demoStates();
    s["input_boolean.demo_heating_season"] = toggle("off");
    s["climate.demo_bedroom_ac"] = climate("dry", { hvac_action: "drying" });
    const m = mount(oneRoom(), makeHass(s), 520);
    assert.match(m.refs(0).icon.className, /m-dry/, "cooling season keeps the mode colour");
  });

  it("does not colour a unit that is off or unavailable", () => {
    const off = heating();
    off["climate.demo_bedroom_ac"] = climate("off");
    assert.match(mount(oneRoom(), makeHass(off), 520).refs(0).icon.className, /m-off/);

    const na = heating();
    na["climate.demo_bedroom_ac"] = climate("unavailable");
    assert.match(mount(oneRoom(), makeHass(na), 520).refs(0).icon.className, /m-na/);
  });

  it("applies to the compact tile too", () => {
    const s = heating();
    s["climate.demo_bedroom_ac"] = climate("cool", { hvac_action: "cooling" });
    const m = mount({ ...oneRoom(), layout: "compact" }, makeHass(s), 220);
    assert.match(m.q(".modeicon").className, /m-heat/, "compact fan should follow the season");
  });

  it("only repaints the fan, not the status word", () => {
    // The status line still reports what the unit is actually doing.
    const s = heating();
    s["climate.demo_bedroom_ac"] = climate("cool", { hvac_action: "cooling" });
    const m = mount(oneRoom(), makeHass(s), 520);
    assert.equal(m.refs(0).statusMain.textContent, "COOL");
    assert.match(m.refs(0).status.className, /m-cool/);
  });
});

describe("wide containers", () => {
  const box = (m, sel) => m.q(sel).getBoundingClientRect();
  const font = (m, sel) => parseFloat(getComputedStyle(m.q(sel)).fontSize);

  it("grows the controls with the container instead of leaving dead space", async () => {
    // The old layout dumped every extra pixel into the text column and left the
    // buttons phone-sized, which is what a widened dashboard column exposed.
    const narrow = mount(DEMO_CONFIG, makeHass(), 520);
    const wide = mount(DEMO_CONFIG, makeHass(), 768);
    await frame();
    assert.ok(
      box(wide, ".controls .ctl").width > box(narrow, ".controls .ctl").width + 8,
      "a control should be clearly bigger on a wide card",
    );
    assert.ok(
      box(wide, ".controls").width > box(narrow, ".controls").width + 40,
      "the control row should claim some of the extra width",
    );
    assert.ok(font(wide, ".big.cur") > font(narrow, ".big.cur"), "the temperature should scale up");
  });

  it("enters the wide tier without a jump", async () => {
    // 470px is the entry point, and every clamp is tuned so its fluid term
    // equals the base there -- crossing the boundary must not resize anything.
    const below = mount(DEMO_CONFIG, makeHass(), 468);
    const at = mount(DEMO_CONFIG, makeHass(), 472);
    await frame();
    assert.close(box(at, ".modeicon").width, box(below, ".modeicon").width, 1, "fan jumps at the boundary");
    assert.close(
      box(at, ".controls .ctl").height,
      box(below, ".controls .ctl").height,
      1,
      "control height jumps at the boundary",
    );
    assert.close(font(at, ".big.cur"), font(below, ".big.cur"), 1, "temperature jumps at the boundary");
    // Below 470 the stacked tier's floors are already in force, which is half
    // of why the crossing is smooth. The base 38px square belongs to the phone
    // tier now, not to everything under 470.
    assert.close(box(below, ".modeicon").width, 45.5, 0.6, "stacked-tier floor below 470");
  });

  it("stops growing rather than becoming cartoonish", async () => {
    const a = mount(DEMO_CONFIG, makeHass(), 792);
    const b = mount(DEMO_CONFIG, makeHass(), 1024);
    await frame();
    assert.close(box(a, ".modeicon").width, box(b, ".modeicon").width, 0.6, "fan is capped");
    assert.close(box(a, ".controls .ctl").height, box(b, ".controls .ctl").height, 0.6, "controls capped");
    assert.ok(box(b, ".modeicon").width <= 76.5, "fan never exceeds its cap");
    assert.ok(box(b, ".controls .ctl").height <= 76.5, "controls never exceed their cap");
  });

  it("keeps the fan and boost squares identical at wide widths", async () => {
    for (const w of [600, 700, 900]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const fan = box(m, ".modeicon");
      const boost = box(m, ".ctl.boost");
      assert.close(fan.width, boost.width, 0.6, `fan and boost differ in width at ${w}px`);
      assert.close(fan.height, boost.height, 0.6, `fan and boost differ in height at ${w}px`);
      const fanCentre = fan.left + fan.width / 2;
      const boostCentre = boost.left + boost.width / 2;
      assert.close(fanCentre, boostCentre, 0.6, `boost not centred under the fan at ${w}px`);
    }
  });

  it("centres its content rather than stretching into a void when very wide", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 1024);
    await frame();
    const rooms = m.q(".rooms").getBoundingClientRect();
    const host = m.card.getBoundingClientRect();
    assert.ok(rooms.width <= 821, `content should cap, got ${Math.round(rooms.width)}px`);
    const leftGap = rooms.left - host.left;
    const rightGap = host.right - rooms.right;
    assert.close(leftGap, rightGap, 2, "capped content should sit centred");
    // ...and a normal dashboard column must still fill edge to edge.
    const normal = mount(DEMO_CONFIG, makeHass(), 768);
    await frame();
    const nRooms = normal.q(".rooms").getBoundingClientRect();
    assert.ok(nRooms.width > 700, `768px card should still fill its width, got ${Math.round(nRooms.width)}px`);
  });

  it("keeps room text left and controls right on a very wide card", async () => {
    for (const w of [700, 900]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const text = box(m, ".roomtext");
      const controls = box(m, ".controls");
      // Measured against the content box, not the card: past 880px the content
      // is capped and centred, so the card's own edge is no longer the anchor.
      const content = m.q(".rooms").getBoundingClientRect();
      assert.ok(text.left < content.left + content.width / 2, `text stays left at ${w}px`);
      assert.ok(controls.right > content.right - 40, `controls stay right at ${w}px`);
      assert.ok(controls.left > text.left, `controls stay after the text at ${w}px`);
    }
  });

  it("does not let the wide tier reach compact mode", async () => {
    const small = mount({ ...oneRoom(), layout: "compact" }, makeHass(), 300);
    const big = mount({ ...oneRoom(), layout: "compact" }, makeHass(), 900);
    await frame();
    assert.close(
      big.card.getBoundingClientRect().height,
      small.card.getBoundingClientRect().height,
      1.5,
      "a wide compact tile must stay the same height as a narrow one",
    );
    assert.close(box(big, ".modeicon").width, box(small, ".modeicon").width, 0.6, "tile fan must not grow");
    assert.notOk(big.q(".controls"), "compact never grows a control row");
  });
});

describe("compact layout", () => {
  const compact = (extra = {}) => ({ ...oneRoom(), layout: "compact", ...extra });

  it("renders a tile per room and none of the full card's furniture", () => {
    const m = mount(compact(), makeHass(), 200);
    assert.equal(m.qa(".ctile").length, 1);
    assert.equal(m.qa(".ctl").length, 0, "compact carries no buttons of its own");
    assert.notOk(m.q(".controls"), "no control row");
    assert.notOk(m.q(".ctl.boost"), "no boost button");
    assert.notOk(m.q(".status"), "no status line");
  });

  it("shows the room temperature, the target and the name", () => {
    const m = mount(compact(), makeHass(), 200);
    assert.equal(m.q(".ccur").textContent, "26.5°");
    assert.equal(m.q(".ctarget").textContent, "20°");
    assert.equal(m.q(".cname").textContent, "Bedroom");
  });

  it("keeps a half-step target's decimal but never invents one", () => {
    const half = demoStates();
    half["input_number.demo_bedroom_target"] = number(19.5);
    const m = mount(compact(), makeHass(half), 200);
    assert.equal(m.q(".ctarget").textContent, "19.5°", "19.5 must not round away to 20");
    assert.match(m.q(".ctile").getAttribute("aria-label"), /target 19\.5°/);

    const whole = demoStates();
    whole["input_number.demo_bedroom_target"] = number(19);
    const w = mount(compact(), makeHass(whole), 200);
    assert.equal(w.q(".ctarget").textContent, "19°", "a whole target stays whole");

    // The measured room temperature keeps its own one-decimal formatting.
    assert.equal(w.q(".ccur").textContent, "26.5°");
  });

  it("accepts `compact: true` as a shorthand", () => {
    const m = mount({ ...oneRoom(), compact: true }, makeHass(), 200);
    assert.ok(m.q(".ctile"), "compact: true should select the compact layout");
  });

  it("rejects an unknown layout", () => {
    assert.throws(() => {
      document.createElement("ac-control-card").setConfig({ ...oneRoom(), layout: "tiny" });
    });
  });

  it("takes its fan colour and spin from the same logic as the full card", () => {
    const states = demoStates();
    states["climate.demo_bedroom_ac"] = climate("cool", { hvac_action: "cooling", fan_mode: "high" });
    const on = mount(compact(), makeHass(states), 200);
    assert.match(on.q(".modeicon").className, /m-cool/);
    assert.ok(on.q(".modeicon").classList.contains("running"), "cooling should glow");
    // Browsers expand the `animation` shorthand on read-back, so check the name.
    assert.equal(on.q(".modeicon ha-icon").style.animationName, "acc-spin");

    const off = mount(compact(), makeHass(), 200);
    assert.match(off.q(".modeicon").className, /m-off/);
    assert.equal(
      off.q(".modeicon ha-icon").style.animationName,
      "none",
      "an off unit does not spin",
    );
  });

  it("mutes the tile when the unit is unavailable", () => {
    const states = demoStates();
    states["climate.demo_bedroom_ac"] = climate("unavailable");
    states["sensor.demo_bedroom_temperature"] = sensor("unavailable");
    const m = mount(compact(), makeHass(states), 200);
    assert.ok(m.q(".ctile").classList.contains("unavailable"));
    assert.equal(m.q(".ccur").textContent, "—", "never invents a temperature");
  });

  it("toggles its own room's unit when tapped", () => {
    const hass = makeHass();
    const m = mount(compact(), hass, 200);
    m.q(".ctile").click();
    assert.equal(hass.calls.length, 1);
    const call = hass.calls[0];
    assert.equal(`${call.domain}.${call.service}`, "homeassistant.toggle");
    assert.equal(call.target.entity_id, "climate.demo_bedroom_ac");
  });

  it("gives every room its own tile and toggles only that room", () => {
    const hass = makeHass();
    const m = mount({ ...DEMO_CONFIG, layout: "compact" }, hass, 220);
    const tiles = m.qa(".ctile");
    assert.equal(tiles.length, 3);
    tiles.forEach((t) => t.click());
    assert.equal(
      hass.calls.map((c) => c.target.entity_id).join(","),
      "climate.demo_bedroom_ac,climate.demo_office_ac,climate.demo_living_room_ac",
    );
    assert.ok(
      hass.calls.every((c) => `${c.domain}.${c.service}` === "homeassistant.toggle"),
      "every tile should toggle",
    );
  });

  it("still honours an explicit tap_action", () => {
    const m = mount({ ...compact(), tap_action: { action: "more-info" } }, makeHass(), 200);
    let opened = null;
    m.card.addEventListener("hass-more-info", (e) => {
      opened = e.detail.entityId;
    });
    m.q(".ctile").click();
    assert.equal(opened, "climate.demo_bedroom_ac", "more-info should still be configurable");
  });

  it("toggles the unit when the full card body is tapped", () => {
    const hass = makeHass();
    const m = mount(oneRoom(), hass, 520);
    m.q(".surface").click();
    assert.equal(hass.calls.length, 1);
    assert.equal(`${hass.calls[0].domain}.${hass.calls[0].service}`, "homeassistant.toggle");
    assert.equal(hass.calls[0].target.entity_id, "climate.demo_bedroom_ac");
  });

  it("toggles from anywhere on a row that is not a button", () => {
    const spots = [".roomrow", ".roomtext", ".name", ".big.cur", ".target", ".status", ".modeicon", ".statuscol"];
    for (const sel of spots) {
      const hass = makeHass();
      const m = mount(oneRoom(), hass, 520);
      const el = m.q(sel);
      assert.ok(el, `${sel} should exist`);
      el.click();
      assert.equal(hass.calls.length, 1, `clicking ${sel} should toggle once`);
      assert.equal(hass.calls[0].target.entity_id, "climate.demo_bedroom_ac", sel);
    }
  });

  it("leaves boost, minus, plus, power and AUTO doing their own job", () => {
    const expected = {
      boost: "climate.set_preset_mode",
      minus: "input_number.set_value",
      plus: "input_number.set_value",
      power: "homeassistant.toggle",
      auto: "homeassistant.toggle",
    };
    for (const [name, service] of Object.entries(expected)) {
      const hass = makeHass();
      const m = mount(oneRoom(), hass, 520);
      m.refs(0)[name].click();
      assert.equal(hass.calls.length, 1, `${name} should fire one call, not two`);
      const c = hass.calls[0];
      assert.equal(`${c.domain}.${c.service}`, service, name);
    }
  });

  it("toggles the room that was tapped, not the first one", () => {
    const hass = makeHass();
    const m = mount(DEMO_CONFIG, hass, 520);
    m.rows()[2].click();
    assert.equal(hass.calls.length, 1);
    assert.equal(hass.calls[0].target.entity_id, "climate.demo_living_room_ac");
  });

  it("ignores a tap on the padding of a multi-room card, where it is ambiguous", () => {
    const hass = makeHass();
    const m = mount(DEMO_CONFIG, hass, 520);
    m.q(".surface").click();
    assert.equal(hass.calls.length, 0, "no room could be meant, so nothing happens");
  });

  it("still honours an explicit tap_action on the full card", () => {
    const hass = makeHass();
    const m = mount({ ...oneRoom(), tap_action: { action: "more-info" } }, hass, 520);
    let opened = null;
    m.card.addEventListener("hass-more-info", (e) => {
      opened = e.detail.entityId;
    });
    m.q(".roomrow").click();
    assert.equal(opened, "climate.demo_bedroom_ac");
    assert.equal(hass.calls.length, 0, "more-info must not also toggle");
  });

  it("makes every row a keyboard control", () => {
    const hass = makeHass();
    const m = mount(DEMO_CONFIG, hass, 520);
    for (const row of m.rows()) {
      assert.equal(row.getAttribute("role"), "button");
      assert.equal(row.getAttribute("tabindex"), "0");
      assert.ok(row.hasAttribute("aria-pressed"), "a row should say whether its unit is on");
    }
    m.rows()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(hass.calls.length, 1);
    assert.equal(hass.calls[0].target.entity_id, "climate.demo_office_ac");
  });

  it("asks for a narrow, content-sized slot so several sit in a row", () => {
    const g = mount(compact(), makeHass(), 200).card.getGridOptions();
    assert.equal(g.columns, 3, "a quarter of a section by default");
    assert.equal(g.min_columns, 2, "can be dragged down to two per row");
    assert.equal(g.rows, "auto");
  });

  // The bar was half the full card when the tile carried two rows; the status
  // line is a deliberate third, so the ratio moved. It is still the point of
  // the layout that a tile is dramatically shorter than the full card.
  it("is much shorter than the full card", async () => {
    const c = mount(compact(), makeHass(), 200);
    const f = mount(oneRoom(), makeHass(), 200);
    await frame();
    const ch = c.card.getBoundingClientRect().height;
    const fh = f.card.getBoundingClientRect().height;
    assert.ok(ch < fh * 0.6, `compact ${Math.round(ch)}px should be well under full ${Math.round(fh)}px`);
  });

  it("leaves the full card completely alone when layout is not set", () => {
    const m = mount(oneRoom(), makeHass(), 520);
    assert.notOk(m.q(".ctile"), "no compact tile");
    assert.notOk(m.card.getAttribute("data-layout"), "no compact marker on the host");
    assert.ok(m.q(".controls"), "control row still there");
    assert.equal(m.qa(".controls .ctl").length, 4, "still four controls");
    assert.ok(m.q(".ctl.boost"), "boost still there");
    assert.ok(m.q(".status"), "status line still there");
  });
});

describe("two-line status", () => {
  const forState = (state, attrs, w = 520) => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate(state, attrs);
    return mount(oneRoom(), makeHass(s), w);
  };
  const lines = (m) =>
    [...m.q(".status").querySelectorAll(".statusline")].map((l) => l.textContent.trim());

  it("puts mode and fan on the first line, the rest on the second", () => {
    const m = forState("cool", { fan_mode: "high", preset_mode: "boost", temperature: 17 });
    const [one, two] = lines(m);
    assert.equal(one.replace(/s+/g, " "), "COOL · HIGH");
    assert.equal(two, "BOOST · 17°");
  });

  it("drops to the setpoint alone when there is no special mode", () => {
    const m = forState("cool", { fan_mode: "low", preset_mode: "none", temperature: 22 });
    const [one, two] = lines(m);
    assert.equal(one.replace(/s+/g, " "), "COOL · LOW");
    assert.equal(two, "22°");
  });

  it("says one word on the first line and nothing on the second when off", () => {
    const m = forState("off", {});
    const [one, two] = lines(m);
    assert.equal(one, "OFF");
    assert.equal(two, "", "an off unit has nothing for the second line");
  });

  it("holds the second line open so an off room is the same height as a running one", async () => {
    for (const w of [470, 520, 620, 820, 1024]) {
      const off = forState("off", {}, w);
      const run = forState("cool", { fan_mode: "high", preset_mode: "boost", temperature: 17 }, w);
      await frame();
      const a = off.card.getBoundingClientRect().height;
      const b = run.card.getBoundingClientRect().height;
      assert.ok(
        Math.abs(a - b) <= 2.5,
        `off ${a.toFixed(1)}px vs running ${b.toFixed(1)}px at ${w}px`,
      );
    }
  });

  it("keeps the compact tile on one line", () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("cool", { fan_mode: "high", preset_mode: "boost", temperature: 17 });
    const m = mount({ ...oneRoom(), layout: "compact" }, makeHass(s), 230);
    assert.notOk(m.q(".statusline"), "the tile does not take the two-line treatment");
    const bits = m.qa(".cstatus .cbit").filter((b) => !b.hidden && b.textContent);
    assert.equal(bits.map((b) => b.textContent).join(" · "), "COOL · HIGH · BOOST · 17°");
  });

  it("clips each line on its own, so a long preset cannot disturb the other", () => {
    const m = forState("cool", { fan_mode: "silent", preset_mode: "extra_long_preset_name", temperature: 17.5 }, 470);
    const [one] = lines(m);
    assert.equal(one.replace(/s+/g, " "), "COOL · SILENT", "the first line is untouched");
    const two = m.q(".statusline.two");
    assert.equal(getComputedStyle(two).overflow, "hidden");
    assert.equal(getComputedStyle(two).textOverflow, "ellipsis");
  });
});


describe("stacked rooms", () => {
  const pad = (el) => {
    const cs = getComputedStyle(el);
    return { top: parseFloat(cs.paddingTop), bottom: parseFloat(cs.paddingBottom) };
  };

  it("marks the list so the stylesheet can tell one room from several", () => {
    assert.notOk(
      mount(oneRoom(), makeHass(), 520).q(".rooms").classList.contains("multi"),
      "a single room is not a stack",
    );
    assert.ok(mount(DEMO_CONFIG, makeHass(), 520).q(".rooms").classList.contains("multi"));
  });

  it("trims the outer edges of a stack, not the gaps between its rows", async () => {
    for (const w of [380, 520, 700, 1024]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const rows = m.rows();
      const first = pad(rows[0]);
      const middle = pad(rows[1]);
      const last = pad(rows[rows.length - 1]);
      assert.ok(first.top <= 3.5, `first row keeps ${first.top}px above it at ${w}px`);
      assert.ok(last.bottom <= 3.5, `last row keeps ${last.bottom}px below it at ${w}px`);
      // The divider still gets real space either side, and the same on both.
      assert.ok(middle.top >= 7, `divider is cramped at ${w}px`);
      assert.close(first.bottom, middle.top, 0.6, `divider not centred at ${w}px`);
      assert.close(middle.bottom, last.top, 0.6, `divider not centred at ${w}px`);
    }
  });

  it("moves the badge onto the status line once rooms are stacked", async () => {
    for (const w of [380, 520, 700, 1024]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const r = m.refs(0);
      assert.equal(r.delta.parentElement.className, "roomtext", "badge is its own grid item");
      const badge = r.delta.getBoundingClientRect();
      const status = r.status.getBoundingClientRect();
      const target = r.target.getBoundingClientRect();
      // Beside the status, not under the target.
      assert.ok(badge.top >= target.bottom - 0.5, `badge still sits with the target at ${w}px`);
      assert.ok(
        badge.top < status.bottom - 0.5 && status.top < badge.bottom - 0.5,
        `badge is not on the status line at ${w}px`,
      );
      assert.ok(badge.left >= status.right - 0.5, `badge overlaps the status text at ${w}px`);
    }
  });

  /** Middle of a line's glyphs, relative to its row. Boxes are no use here:
   *  the OFF line box is deliberately shorter than the word inside it. */
  function lineCentre(row) {
    const el = row.querySelector(".statusline.one");
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const tm = ctx.measureText(el.textContent);
    const range = document.createRange();
    range.selectNodeContents(el);
    const box = range.getBoundingClientRect();
    const base =
      box.top +
      (box.height - (tm.fontBoundingBoxAscent + tm.fontBoundingBoxDescent)) / 2 +
      tm.fontBoundingBoxAscent;
    const centre = base + (tm.actualBoundingBoxDescent - tm.actualBoundingBoxAscent) / 2;
    return centre - row.getBoundingClientRect().top;
  }

  /** The vertical part of an element's transform, in px. */
  function ty(el) {
    const t = getComputedStyle(el).transform;
    if (!t || t === "none") return 0;
    const parts = t.slice(t.indexOf("(") + 1, t.lastIndexOf(")")).split(",");
    return parts.length === 6 ? parseFloat(parts[5]) : 0;
  }

  /* Where the status ends up optically -- centred on the rocket square beside
     it -- is checked against a real dashboard, not here. This page stubs
     ha-icon, so its squares are not the size the frontend draws and the rocket
     lands several pixels from where a dashboard puts it: about 4.6px out on a
     380px card and 7.1px on a 520px one, growing with width. Measuring
     centring here would only be measuring the stub.

     What this page can check is the contract behind it, and every one of these
     would have caught a real bug that shipped: that both states are nudged at
     all, that OFF gets more than a running unit and by how much, that the
     badge moves with the line it shares, and that the amount follows the card
     width instead of being one constant that is right at a single size. */
  it("nudges both states, badge included, by an amount that follows the card", async () => {
    const seen = {};
    for (const w of [380, 520, 700, 1024]) {
      const s = demoStates();
      s["climate.demo_bedroom_ac"] = climate("off");
      s["climate.demo_office_ac"] = climate("cool", {
        hvac_action: "cooling", fan_mode: "high", preset_mode: "boost", temperature: 17,
      });
      const m = mount(DEMO_CONFIG, makeHass(s), w);
      await frame();
      // The compact tier is a different layout with no rocket square to line up
      // against, so these rules deliberately do not reach it.
      if (m.q(".surface").classList.contains("compact")) continue;
      const off = m.refs(0);
      const run = m.refs(1);
      const offTy = ty(off.status);
      const runTy = ty(run.status);

      assert.ok(offTy > 0, `OFF should be nudged at ${w}px`);
      assert.ok(runTy > 0, `a running status should be nudged too at ${w}px`);
      assert.ok(offTy > runTy, `OFF should need more than a running unit at ${w}px`);

      const extra = offTy - runTy;
      assert.ok(
        extra >= 6 && extra <= 14,
        `OFF's extra is ${extra.toFixed(1)}px at ${w}px, outside the measured 6-14px band`,
      );

      assert.equal(
        ty(run.delta).toFixed(1),
        runTy.toFixed(1),
        `the badge should move with the status line it shares at ${w}px`,
      );

      seen[w] = runTy;
    }
    assert.ok(
      seen[1024] !== undefined && seen[520] !== undefined && seen[1024] > seen[520],
      "the drop should follow the card's width, not be a single constant",
    );
  });

  it("nudges a running status too, and leaves the single-room card its own lift", async () => {
    const running = () => {
      const s = demoStates();
      s["climate.demo_bedroom_ac"] = climate("cool", { hvac_action: "cooling", fan_mode: "high" });
      return makeHass(s);
    };
    const stacked = mount(DEMO_CONFIG, running(), 520);
    await frame();
    assert.ok(
      getComputedStyle(stacked.refs(0).status).transform !== "none",
      "a running status is nudged in a stack too, so it centres on its rocket square",
    );
    assert.equal(
      getComputedStyle(stacked.refs(0).delta).transform,
      getComputedStyle(stacked.refs(0).status).transform,
      "the badge moves with the status line it shares a row with",
    );
    const single = mount(oneRoom(), running(), 520);
    await frame();
    assert.ok(
      getComputedStyle(single.refs(0).status).transform !== "none",
      "the single-room card keeps its own lift",
    );
  });


  it("gives a one-room card the same status offsets a stacked one gets", async () => {
    // The two used to be placed by different rules -- a lift of its own for a
    // single room, a drop for a stack. They build the same text block now, so
    // the same figures have to serve both; anything else and one of them sits
    // off its rocket square.
    const shift = (el) => {
      const t = getComputedStyle(el).transform;
      if (!t || t === "none") return 0;
      const parts = t.slice(t.indexOf("(") + 1, t.lastIndexOf(")")).split(",");
      return parts.length === 6 ? parseFloat(parts[5]) : 0;
    };
    for (const w of [500, 620, 720, 1024]) {
      for (const [label, state] of [["off", climate("off")], ["running", climate("cool", {
        hvac_action: "cooling", fan_mode: "high", preset_mode: "boost", temperature: 17,
      })]]) {
        const s1 = demoStates();
        s1["climate.demo_bedroom_ac"] = state;
        const one = mount(oneRoom(), makeHass(s1), w);
        const many = mount(DEMO_CONFIG, makeHass(s1), w);
        await frame();
        if (one.q(".surface").classList.contains("compact")) continue;
        assert.close(
          shift(one.refs(0).status),
          shift(many.refs(0).status),
          0.6,
          `${label}: one room and a stack disagree at ${w}px`,
        );
        assert.ok(shift(one.refs(0).status) > 0, `${label}: no offset at all at ${w}px`);
        assert.close(
          shift(one.refs(0).delta),
          shift(many.refs(0).delta),
          0.6,
          `${label}: the badge disagrees at ${w}px`,
        );
      }
    }
  });

  it("puts the badge on the status row whatever the room count", async () => {
    // One room and several rooms build the same text block now. A lone room
    // stacking the target over the badge made .targetline twice as tall as the
    // temperature beside it, and left the card with a band of nothing below
    // everything it draws.
    for (const [label, cfg] of [["one room", oneRoom()], ["several rooms", DEMO_CONFIG]]) {
      const m = mount(cfg, makeHass(), 520);
      await frame();
      assert.equal(
        m.refs(0).delta.parentElement.className,
        "roomtext",
        `${label}: the badge should be its own grid item`,
      );
    }
  });


  it("trims a single-room card's ends the way a stacked one's are trimmed", async () => {
    // A lone row is both the first and the last, so it was taking a full row's
    // padding at each end -- and from 470px up that came from the wide tier's
    // shorthand, which out-specifies the base 2px trim. It now uses the same
    // --acc-row-edge the stacked card does: 2px, and 3px from 431px up.
    const want = { 380: [2, 2], 520: [3, 3], 700: [3, 3], 1024: [3, 3] };
    for (const [w, [top, bottom]] of Object.entries(want)) {
      const m = mount(oneRoom(), makeHass(Number(w)), Number(w));
      await frame();
      const p0 = pad(m.rows()[0]);
      assert.close(p0.top, top, 0.6, `single-room top padding at ${w}px`);
      assert.close(p0.bottom, bottom, 0.6, `single-room bottom padding at ${w}px`);
      assert.equal(p0.top, p0.bottom, `single-room ends are uneven at ${w}px`);
    }
  });

  it("is shorter than it was, without cramping anything", async () => {
    for (const w of [380, 520, 700, 1024]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const rows = m.rows();
      // Rows must not touch each other, and the controls must clear the divider.
      for (let i = 1; i < rows.length; i++) {
        const above = rows[i - 1].getBoundingClientRect();
        const here = rows[i].getBoundingClientRect();
        assert.ok(here.top >= above.bottom - 0.5, `rows ${i - 1}/${i} collide at ${w}px`);
      }
      for (const [i] of rows.entries()) {
        const r = m.refs(i);
        assert.notOk(rects(r.text, r.controls).overlap, `text meets controls in row ${i} at ${w}px`);
        assert.notOk(rects(r.statusCol, r.text).overlap, `fan column meets text in row ${i} at ${w}px`);
      }
      const surface = m.q(".surface");
      assert.ok(surface.scrollWidth <= surface.clientWidth + 1, `horizontal overflow at ${w}px`);
    }
  });
});


describe("embedded font", () => {
  const STYLE_ID = "ha-ac-control-embedded-font";

  it("injects nothing while no font is embedded", () => {
    mount(DEMO_CONFIG, makeHass(), 520);
    assert.notOk(
      document.getElementById(STYLE_ID),
      "with no font data there should be no style node at all",
    );
  });

  it("leaves every text element inheriting until a font is embedded", () => {
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    for (const sel of [".name", ".big.cur", ".target", ".delta", ".status", ".ctl"]) {
      const el = m.q(sel);
      assert.ok(el, sel + " should exist");
      // --acc-font is unset, so the declaration resolves to inherit and the
      // family is whatever the dashboard uses -- not a hard-coded stack.
      assert.equal(
        getComputedStyle(el).fontFamily,
        getComputedStyle(m.card).fontFamily,
        sel + " should still inherit the page font",
      );
    }
  });

  it("registers the face once for the whole document, not once per card", () => {
    // Stand in for the embedded data: the registration path is what matters,
    // and it is identical whatever bytes are in the URL.
    const inject = () => {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent =
        "@font-face{font-family:'Choco Cooky';src:url(data:font/woff2;base64,AAAA) format('woff2')}" +
        "ac-control-card{--acc-font:'Choco Cooky';}";
      document.head.appendChild(style);
    };
    try {
      for (let i = 0; i < 5; i++) inject();
      assert.equal(
        document.querySelectorAll("#" + STYLE_ID).length,
        1,
        "five registrations should leave exactly one style node",
      );

      // And the property crosses the shadow boundary onto the card's text.
      const m = mount(DEMO_CONFIG, makeHass(), 520);
      assert.match(getComputedStyle(m.q(".name")).fontFamily, /Choco Cooky/);
      assert.match(getComputedStyle(m.q(".status")).fontFamily, /Choco Cooky/);
      // Icons must not be dragged into it.
      const icon = m.q(".modeicon ha-icon");
      assert.notOk(
        /Choco Cooky/.test(getComputedStyle(icon).fontFamily),
        "an icon element must not take the text font",
      );
    } finally {
      const node = document.getElementById(STYLE_ID);
      if (node) node.remove();
    }
  });

  it("ships with the markers the build script writes between", () => {
    const src = AcControlCard.styles;
    assert.ok(typeof src === "string", "styles should be a string");
    assert.ok(src.includes("var(--acc-font, inherit)"), "text elements read the font variable");
  });
});


describe("card chrome", () => {
  // Regression: ha-card animates its border over 0.3s, and before the theme's
  // custom properties resolve the border computes to its initial value -- 3px
  // in a near-white -- which then faded out as a white line flashing round the
  // card on every view change.
  const cardRule = (m) => {
    const css = m.card.shadowRoot.querySelector("style").textContent;
    const at = css.indexOf("ha-card {");
    return css.slice(at, css.indexOf("}", at));
  };

  it("cannot let the border fall back to a visible colour", () => {
    const rule = cardRule(mount(oneRoom(), makeHass(), 520));
    assert.match(
      rule,
      /border-width:\s*var\(--ha-card-border-width,\s*1px\)/,
      "border-width needs an explicit fallback, or it resolves to medium (3px)",
    );
    assert.match(
      rule,
      /border-color:\s*var\(--ha-card-border-color,\s*var\(--divider-color,\s*transparent\)\)/,
      "the last border-color fallback must be transparent, not a light grey",
    );
    assert.match(rule, /transition:\s*none/, "ha-card's blanket transition must be off");
  });

  it("applies the same guard to the compact tile", () => {
    const rule = cardRule(mount({ ...oneRoom(), layout: "compact" }, makeHass(), 200));
    assert.match(rule, /border-width:\s*var\(--ha-card-border-width,\s*1px\)/);
    assert.match(rule, /transition:\s*none/);
  });

  it("still gives a theme that asks for a border exactly what it asked for", () => {
    for (const cfg of [oneRoom(), { ...oneRoom(), layout: "compact" }]) {
      const m = mount(cfg, makeHass(), 320);
      const card = m.q("ha-card");
      card.style.setProperty("--ha-card-border-width", "2px");
      card.style.setProperty("--ha-card-border-color", "rgb(10, 20, 30)");
      const cs = getComputedStyle(card);
      assert.equal(cs.borderTopWidth, "2px", "theme width honoured");
      assert.equal(cs.borderTopColor, "rgb(10, 20, 30)", "theme colour honoured");
    }
  });

  it("falls back to a 1px divider-coloured border, never to 3px", () => {
    const m = mount(oneRoom(), makeHass(), 320);
    const cs = getComputedStyle(m.q("ha-card"));
    assert.equal(cs.borderTopWidth, "1px", "an unthemed card must not render a 3px edge");
    assert.equal(cs.transitionProperty, "none", "no fade to flash on the way out");
  });
});

describe("stacked controls", () => {
  const grid = (m) => {
    const r = m.refs(0);
    const btns = [r.minus, r.plus, r.power, r.auto].map((b) => ({
      el: b,
      box: b.getBoundingClientRect(),
    }));
    const rows = [...new Set(btns.map((b) => Math.round(b.box.top)))].sort((a, b) => a - b);
    return { btns, rows, r };
  };

  it("puts minus and plus above power and AUTO once the controls sit beside the text", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    await frame();
    const { btns, rows } = grid(m);
    assert.equal(rows.length, 2, `expected two rows of buttons, got ${rows.length}`);

    const [minus, plus, power, auto] = btns;
    assert.equal(Math.round(minus.box.top), rows[0], "minus belongs on the top row");
    assert.equal(Math.round(plus.box.top), rows[0], "plus belongs on the top row");
    assert.equal(Math.round(power.box.top), rows[1], "power belongs on the bottom row");
    assert.equal(Math.round(auto.box.top), rows[1], "AUTO belongs on the bottom row");
    assert.ok(minus.box.right <= plus.box.left + 0.5, "minus left of plus");
    assert.ok(power.box.right <= auto.box.left + 0.5, "power left of AUTO");
  });

  it("leaves the phone layout as one row of four on its own line", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 380);
    await frame();
    const { rows } = grid(m);
    assert.equal(rows.length, 1, "a phone-width card keeps the single row");
  });

  it("makes every button bigger than the old four-across row", async () => {
    for (const w of [470, 520, 700, 1024]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const { btns } = grid(m);
      for (const b of btns) {
        assert.ok(b.box.width >= 61, `only ${b.box.width.toFixed(1)}px wide at ${w}px`);
        assert.ok(b.box.height >= 47, `only ${b.box.height.toFixed(1)}px tall at ${w}px`);
      }
    }
  });

  it("hands the width it saves back to the temperatures", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    await frame();
    const r = m.refs(0);
    assert.ok(
      r.controls.getBoundingClientRect().width < r.text.getBoundingClientRect().width,
      "two columns should take less room than the text block beside them",
    );
  });

  it("does not disturb the boost square, which belongs to the fan above it", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    await frame();
    const r = m.refs(0);
    const boost = r.boost.getBoundingClientRect();
    const fan = m.q(".modeicon").getBoundingClientRect();
    assert.close(boost.width, boost.height, 0.6, "boost must stay square");
    assert.close(boost.width, fan.width, 0.6, "boost must match the fan icon");
    assert.notOk(r.controls.contains(r.boost), "boost is not one of the stacked controls");
  });

  it("keeps the block clear of the text and inside the card at every width", async () => {
    for (const w of [431, 470, 520, 600, 700, 820, 1024, 1400]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const r = m.refs(0);
      assert.notOk(rects(r.text, r.controls).overlap, `controls overlap the text at ${w}px`);
      const surface = m.q(".surface");
      assert.ok(
        surface.scrollWidth <= surface.clientWidth + 1,
        `horizontal overflow at ${w}px`,
      );
      const c = r.controls.getBoundingClientRect();
      const row = r.row.getBoundingClientRect();
      assert.ok(c.right <= row.right + 0.5, `controls escape the row at ${w}px`);
    }
  });

  it("stops growing once the card is very wide", async () => {
    const a = mount(DEMO_CONFIG, makeHass(), 1024);
    const b = mount(DEMO_CONFIG, makeHass(), 1400);
    await frame();
    const ba = a.refs(0).power.getBoundingClientRect();
    const bb = b.refs(0).power.getBoundingClientRect();
    assert.close(ba.width, bb.width, 0.6, "width capped");
    assert.close(ba.height, bb.height, 0.6, "height capped");
  });

  // Stacking the buttons made the right-hand block the tallest thing in the
  // row; the fan column has to keep up or the left of the card reads empty.
  it("fills the left column to exactly the height of the control block", async () => {
    for (const w of [470, 520, 600, 700, 820, 1024, 1400]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const r = m.refs(0);
      const left = r.statusCol.getBoundingClientRect().height;
      const right = r.controls.getBoundingClientRect().height;
      assert.close(left, right, 1, `left column ${left.toFixed(1)}px vs controls ${right.toFixed(1)}px at ${w}px`);
    }
  });

  it("keeps the fan and boost squares square and identical to each other", async () => {
    for (const w of [470, 700, 1024]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const fan = m.q(".modeicon").getBoundingClientRect();
      const boost = m.q(".ctl.boost").getBoundingClientRect();
      const btn = m.refs(0).power.getBoundingClientRect();
      assert.close(fan.width, fan.height, 0.6, `fan not square at ${w}px`);
      assert.close(fan.width, boost.width, 0.6, `fan and boost differ at ${w}px`);
      assert.close(fan.height, boost.height, 0.6, `fan and boost differ at ${w}px`);
      // They give up a little size for the wider gap between them, so a square
      // is smaller than a button -- but never by much.
      assert.ok(fan.height <= btn.height, `square outgrew a button at ${w}px`);
      assert.ok(fan.height >= btn.height - 6, `square shrank too far at ${w}px`);
    }
  });

  it("sits the fan and boost further apart than the buttons, at no cost in height", async () => {
    for (const w of [470, 520, 700, 820, 1024, 1400]) {
      const m = mount(DEMO_CONFIG, makeHass(), w);
      await frame();
      const r = m.refs(0);
      const fan = m.q(".modeicon").getBoundingClientRect();
      const boost = m.q(".ctl.boost").getBoundingClientRect();
      const cs = getComputedStyle(r.controls);
      const btnGap = parseFloat(cs.rowGap || cs.gap) || 0;
      const fanGap = boost.top - fan.bottom;
      assert.ok(fanGap > btnGap + 3, `fan gap ${fanGap.toFixed(1)} vs button gap ${btnGap} at ${w}px`);
      // The whole point: the column is still exactly the control block's height.
      assert.close(
        r.statusCol.getBoundingClientRect().height,
        r.controls.getBoundingClientRect().height,
        1,
        `widening the gap changed the column height at ${w}px`,
      );
    }
  });

  // A running unit throughout: an off one prints its status at double size,
  // which would be measuring the OFF rule rather than the type scale.
  const runningStates = () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("cool", { hvac_action: "cooling" });
    return s;
  };

  it("grows the text along with them, and still caps it", async () => {
    const font = (m, sel) => parseFloat(getComputedStyle(m.q(sel)).fontSize);
    const narrow = mount(oneRoom(), makeHass(runningStates()), 470);
    const wide = mount(oneRoom(), makeHass(runningStates()), 820);
    const wider = mount(oneRoom(), makeHass(runningStates()), 1400);
    await frame();
    for (const sel of [".big", ".name", ".targetline", ".status"]) {
      assert.ok(font(wide, sel) > font(narrow, sel), `${sel} should grow with the card`);
      assert.close(font(wide, sel), font(wider, sel), 0.6, `${sel} should stop growing`);
    }
    // Still a hierarchy: the room temperature leads, the status line trails.
    assert.ok(font(wide, ".big") > font(wide, ".targetline"), "temperature leads the target");
    assert.ok(font(wide, ".targetline") > font(wide, ".status"), "target leads the status line");
  });

  // Single-room only: with rooms stacked the badge moves down to the status
  // line, where it is the one thing narrow enough to share that row.
  it("sets the difference beside the status, clear of the target", async () => {
    for (const w of [470, 520, 700, 1024]) {
      const m = mount(oneRoom(), makeHass(), w);
      await frame();
      const r = m.refs(0);
      const tgt = r.target.getBoundingClientRect();
      const d = r.delta.getBoundingClientRect();
      const status = r.status.getBoundingClientRect();
      assert.ok(d.top >= tgt.bottom - 0.5, `badge still sits with the target at ${w}px`);
      assert.ok(
        d.top < status.bottom - 0.5 && status.top < d.bottom - 0.5,
        `badge is not on the status line at ${w}px`,
      );
      assert.ok(d.left >= status.right - 0.5, `badge overlaps the status text at ${w}px`);
      // The phrase still lines up with the big temperature beside it.
      const big = m.q(".big.cur").getBoundingClientRect();
      assert.ok(Math.abs(tgt.top - big.top) < big.height * 0.5, `target lost its baseline at ${w}px`);
    }
  });

  it("sets the target and the difference larger now that they stack", async () => {
    const font = (m, sel) => parseFloat(getComputedStyle(m.q(sel)).fontSize);
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    await frame();
    assert.ok(font(m, ".target") >= 21, `target only ${font(m, ".target").toFixed(1)}px`);
    assert.ok(font(m, ".delta") >= 17, `badge only ${font(m, ".delta").toFixed(1)}px`);
    assert.ok(font(m, ".target") > font(m, ".delta"), "the target still leads its own badge");
  });

  it("runs the status line 20% larger than the size it was tuned to", async () => {
    // The old scale was clamp(12px, 2.65cqi, 16px); this is that times 1.2, so
    // the floor and the cap are the numbers to check.
    const font = (m, sel) => parseFloat(getComputedStyle(m.q(sel)).fontSize);
    const floor = mount(oneRoom(), makeHass(runningStates()), 440);
    const cap = mount(oneRoom(), makeHass(runningStates()), 1024);
    await frame();
    assert.close(font(floor, ".status"), 14.4, 0.3, "status floor should be 12 x 1.2");
    assert.close(font(cap, ".status"), 19.2, 0.3, "status cap should be 16 x 1.2");
  });

  it("says OFF at twice the size of a running unit's status line", async () => {
    const font = (m) => parseFloat(getComputedStyle(m.q(".status")).fontSize);
    for (const w of [470, 520, 700, 1024]) {
      const s = demoStates();
      s["climate.demo_bedroom_ac"] = climate("cool", { hvac_action: "cooling" });
      const running = mount(oneRoom(), makeHass(s), w);

      const t = demoStates();
      t["climate.demo_bedroom_ac"] = climate("off");
      const off = mount(oneRoom(), makeHass(t), w);
      await frame();

      assert.equal(off.q(".statusmain").textContent, "OFF");
      assert.close(font(off), font(running) * 2, 0.4, `OFF is not double at ${w}px`);
    }
  });

  it("does not blow up UNAVAILABLE, which is a much longer word", async () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("unavailable");
    const m = mount(oneRoom(), makeHass(s), 520);
    const r = demoStates();
    r["climate.demo_bedroom_ac"] = climate("cool", { hvac_action: "cooling" });
    const running = mount(oneRoom(), makeHass(r), 520);
    await frame();
    const f = (x) => parseFloat(getComputedStyle(x.q(".status")).fontSize);
    assert.equal(m.q(".statusmain").textContent, "UNAVAILABLE");
    assert.close(f(m), f(running), 0.4, "UNAVAILABLE should stay at the normal size");
  });

  it("keeps the enlarged OFF inside the card and clear of the controls", async () => {
    for (const w of [470, 520, 700, 820, 1024, 1400]) {
      const s = demoStates();
      s["climate.demo_bedroom_ac"] = climate("off");
      const m = mount(oneRoom(), makeHass(s), w);
      await frame();
      const r = m.refs(0);
      assert.notOk(rects(r.text, r.controls).overlap, `OFF row overlaps the controls at ${w}px`);
      const surface = m.q(".surface");
      assert.ok(surface.scrollWidth <= surface.clientWidth + 1, `horizontal overflow at ${w}px`);
    }
  });

  const offHass = () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("off");
    return makeHass(s);
  };


  it("centres that block on the boost square at the widths it was tuned for", async () => {
    for (const w of [500, 560, 620]) {
      const s = demoStates();
      s["climate.demo_bedroom_ac"] = climate("cool", {
        hvac_action: "cooling", fan_mode: "high", preset_mode: "boost", temperature: 17,
      });
      const m = mount(oneRoom(), makeHass(s), w);
      await frame();
      const one = inkRect(m.q(".statusline.one"));
      const two = inkRect(m.q(".statusline.two"));
      const boost = m.refs(0).boost.getBoundingClientRect();
      const off = (one.top + two.bottom) / 2 - (boost.top + boost.height / 2);
      // Roughly level, not exactly: where the block lands moves a few pixels
      // between a bare page and this one, so the check is that it sits with
      // the square rather than a line below it. It used to be a full line adrift.
      assert.ok(Math.abs(off) <= 10, `status is ${off.toFixed(1)}px off the boost centre at ${w}px`);
    }
  });




  /**
   * Middle of the word, by glyph ink rather than by box. The line box is
   * deliberately far shorter than the text, so a bounding rect says nothing
   * about where OFF actually looks like it sits.
   */
  function inkCentre(el) {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const tm = ctx.measureText(el.textContent);
    const range = document.createRange();
    range.selectNodeContents(el);
    const box = range.getBoundingClientRect();
    const baseline =
      box.top +
      (box.height - (tm.fontBoundingBoxAscent + tm.fontBoundingBoxDescent)) / 2 +
      tm.fontBoundingBoxAscent;
    return baseline + (tm.actualBoundingBoxDescent - tm.actualBoundingBoxAscent) / 2;
  }

  /**
   * The rectangle the text of an element actually paints into: the range gives
   * the horizontal extent, font metrics give the vertical. Element boxes are
   * useless here -- the status line's box is far taller than its text and
   * overlaps its neighbours by design.
   */
  function inkRect(el) {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const tm = ctx.measureText(el.textContent);
    const range = document.createRange();
    range.selectNodeContents(el);
    const box = range.getBoundingClientRect();
    const base =
      box.top +
      (box.height - (tm.fontBoundingBoxAscent + tm.fontBoundingBoxDescent)) / 2 +
      tm.fontBoundingBoxAscent;
    return {
      left: box.left,
      right: box.right,
      top: base - tm.actualBoundingBoxAscent,
      bottom: base + tm.actualBoundingBoxDescent,
    };
  }

  /** Top and bottom of the glyph ink, for comparing what is actually drawn. */
  function inkEdges(el) {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const tm = ctx.measureText(el.textContent);
    const range = document.createRange();
    range.selectNodeContents(el);
    const box = range.getBoundingClientRect();
    const base =
      box.top +
      (box.height - (tm.fontBoundingBoxAscent + tm.fontBoundingBoxDescent)) / 2 +
      tm.fontBoundingBoxAscent;
    return { top: base - tm.actualBoundingBoxAscent, bottom: base + tm.actualBoundingBoxDescent };
  }
  const inkTop = (el) => inkEdges(el).top;
  const inkBottom = (el) => inkEdges(el).bottom;

  /** Right edge of the glyph ink, for the same reason inkCentre exists. */
  function inkRight(el) {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const tm = ctx.measureText(el.textContent);
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().left + tm.actualBoundingBoxRight;
  }
  it("keeps OFF clear of the target phrase beside it", async () => {
    // Where OFF sits vertically is not asserted here. This page stubs ha-icon,
    // so its squares are not the size the frontend draws and the rocket lands a
    // few pixels from where a dashboard puts it -- 4.6px out on a 380px card,
    // 7.1px on a 520px one, widening with the card. Measuring centring here
    // would measure the stub. That the offsets match a stacked card's is
    // covered by the parity test above, and the optical result is checked
    // against a real dashboard.
    //
    // The horizontal clearance is a genuine invariant: OFF and the target
    // phrase share a band of the card and only the gap keeps them apart.
    for (const w of [500, 520, 560]) {
      const m = mount(oneRoom(), offHass(), w);
      await frame();
      const gap = m.refs(0).target.getBoundingClientRect().left - inkRight(m.q(".statusmain"));
      assert.ok(gap > 40, `only ${gap.toFixed(1)}px between OFF and the target phrase at ${w}px`);
    }
  });

  // The word is twice the size; the line box it sits in is not. Growing the
  // card was the one thing the bigger OFF was not allowed to do.
  it("does not make the card any taller than a running unit's", async () => {
    for (const w of [470, 520, 600, 700, 820, 1024, 1400]) {
      const off = demoStates();
      off["climate.demo_bedroom_ac"] = climate("off");
      const a = mount(oneRoom(), makeHass(off), w);

      const on = demoStates();
      on["climate.demo_bedroom_ac"] = climate("cool", { hvac_action: "cooling" });
      const b = mount(oneRoom(), makeHass(on), w);
      await frame();

      const ah = a.card.getBoundingClientRect().height;
      const bh = b.card.getBoundingClientRect().height;
      assert.close(ah, bh, 1.5, `off card ${ah.toFixed(1)}px vs running ${bh.toFixed(1)}px at ${w}px`);

      // And the word still has to clear the line above it.
      const status = a.refs(0).status.getBoundingClientRect();
      const above = a.refs(0).target.getBoundingClientRect();
      assert.ok(status.top >= above.bottom - 0.5, `OFF rides up into the target at ${w}px`);
    }
  });

  it("leaves the phone layout's squares and type alone", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 380);
    await frame();
    const fan = m.q(".modeicon").getBoundingClientRect();
    assert.close(fan.width, 38, 0.6, "the phone tier keeps its 38px squares");
    assert.close(parseFloat(getComputedStyle(m.q(".big")).fontSize), 22, 0.6, "and its 22px temperature");
  });
});

describe("compact difference badge", () => {
  const compact = (extra = {}) => ({ ...oneRoom(), layout: "compact", ...extra });

  function withTemps(cur, target, width = 230) {
    const s = demoStates();
    s["sensor.demo_bedroom_temperature"] = cur === null ? sensor("unavailable") : sensor(cur);
    s["input_number.demo_bedroom_target"] = target === null ? number("unknown") : number(target);
    return mount(compact(), makeHass(s), width);
  }

  it("shows how far the room is from its target, before the target", () => {
    const m = withTemps(22.5, 20);
    assert.equal(m.q(".delta").textContent, "▲ 2.5°");
    assert.ok(m.q(".delta").classList.contains("above"));
    // Document order is what puts it before the number.
    const kids = [...m.q(".cright").children];
    assert.equal(kids[0], m.q(".delta"), "badge first");
    assert.equal(kids[1], m.q(".ctarget"), "target second");
    assert.ok(
      m.q(".delta").getBoundingClientRect().right <= m.q(".ctarget").getBoundingClientRect().left + 0.5,
      "the badge must sit to the left of the target",
    );
  });

  it("points the other way when the room is colder than its target", () => {
    const m = withTemps(18.4, 20);
    assert.equal(m.q(".delta").textContent, "▼ 1.6°");
    assert.ok(m.q(".delta").classList.contains("below"));
  });

  it("says 0° at target rather than the full card's phrase", () => {
    const m = withTemps(20, 20);
    assert.equal(m.q(".delta").textContent, "0°", "a tile has no room for 'at target'");
    assert.ok(m.q(".delta").classList.contains("even"));
    // The full card keeps its wording.
    const s = demoStates();
    s["sensor.demo_bedroom_temperature"] = sensor(20);
    s["input_number.demo_bedroom_target"] = number(20);
    assert.equal(mount(oneRoom(), makeHass(s), 520).refs(0).delta.textContent, "at target");
  });

  it("uses the same dead band and arithmetic as the full card", () => {
    for (const [cur, target] of [[22.5, 20], [18.4, 20], [20.02, 20], [21, 19.5]]) {
      const s = demoStates();
      s["sensor.demo_bedroom_temperature"] = sensor(cur);
      s["input_number.demo_bedroom_target"] = number(target);
      const full = mount(oneRoom(), makeHass(s), 520).refs(0).delta;
      const comp = mount(compact(), makeHass(s), 230).q(".delta");
      assert.equal(comp.className, full.className, `class differs for ${cur}/${target}`);
      if (!full.classList.contains("even")) {
        assert.equal(comp.textContent, full.textContent, `text differs for ${cur}/${target}`);
      }
    }
  });

  it("hides itself rather than inventing a difference", () => {
    const noCur = withTemps(null, 20);
    assert.ok(noCur.q(".delta").hidden, "no room temperature means no badge");
    assert.equal(noCur.q(".delta").textContent, "");
    assert.equal(noCur.q(".ctarget").textContent, "20°", "the target still shows");

    const noTgt = withTemps(22.5, null);
    assert.ok(noTgt.q(".delta").hidden, "no target means no badge");
  });

  it("does not make the tile taller, whether the badge is there or not", async () => {
    const withBadge = withTemps(22.5, 20);
    const without = withTemps(null, 20);
    const atTarget = withTemps(20, 20);
    await frame();
    const hs = [withBadge, without, atTarget].map((m) => m.q(".ctile").getBoundingClientRect().height);
    const spread = Math.max(...hs) - Math.min(...hs);
    assert.ok(spread < 0.75, `tiles differ by ${spread.toFixed(2)}px: ${hs.join(", ")}`);
  });

  it("never pushes the target or itself out of the tile", async () => {
    for (const w of [420, 300, 230, 200, 172, 160, 148, 132, 120]) {
      const m = withTemps(28.4, 16.5, w);
      await frame();
      const tile = m.q(".ctile").getBoundingClientRect();
      for (const sel of [".delta", ".ctarget"]) {
        const b = m.q(sel).getBoundingClientRect();
        assert.ok(b.left >= tile.left - 0.5 && b.right <= tile.right + 0.5, `${sel} escapes at ${w}px`);
      }
      assert.notOk(rects(m.q(".cright"), m.q(".cname")).overlap, `badge overlaps the name at ${w}px`);
      assert.ok(m.card.scrollWidth <= m.card.clientWidth + 0.5, `card scrolls at ${w}px`);
    }
  });

  it("stays quieter than the target it annotates", () => {
    const m = withTemps(22.5, 20);
    assert.ok(
      parseFloat(getComputedStyle(m.q(".delta")).fontSize) <
        parseFloat(getComputedStyle(m.q(".ctarget")).fontSize),
      "the badge must not outweigh the target",
    );
  });
});

describe("compact status line", () => {
  const compact = (extra = {}) => ({ ...oneRoom(), layout: "compact", ...extra });

  /** Mount one compact tile over a given climate state. */
  function tile(state, attrs = {}, width = 200, extra = {}) {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate(state, attrs);
    const m = mount(compact(extra), makeHass(s), width);
    return {
      ...m,
      line: m.q(".cstatus"),
      bits: () => m.qa(".cstatus .cbit").filter((b) => !b.hidden && b.textContent !== ""),
      text: () =>
        m
          .qa(".cstatus .cbit")
          .filter((b) => !b.hidden && b.textContent !== "")
          .map((b) => b.textContent)
          .join(" · "),
    };
  }

  it("prints MODE · FAN · SPECIAL · TARGET in that order", () => {
    const t = tile("cool", { fan_mode: "high", preset_mode: "boost", temperature: 17 });
    assert.equal(t.text(), "COOL · HIGH · BOOST · 17°");
  });

  it("builds every combination from the entity, never from a fixed string", () => {
    assert.equal(tile("cool", { fan_mode: "low", temperature: 22 }).text(), "COOL · LOW · 22°");
    assert.equal(tile("cool", { fan_mode: "high", temperature: 17 }).text(), "COOL · HIGH · 17°");
    assert.equal(tile("cool", { fan_mode: "medium", temperature: 20 }).text(), "COOL · MID · 20°");
    assert.equal(tile("dry", { fan_mode: "low", temperature: 19 }).text(), "DRY · LOW · 19°");
    assert.equal(tile("heat", { fan_mode: "auto", temperature: 22 }).text(), "HEAT · AUTO · 22°");
    assert.equal(tile("heat_cool", { fan_mode: "auto", temperature: 21 }).text(), "AUTO · AUTO · 21°");
  });

  it("leaves the setpoint off a fan-only unit, which is not holding one", () => {
    assert.equal(tile("fan_only", { fan_mode: "high", temperature: 22 }).text(), "FAN · HIGH");
  });

  it("says only OFF when the unit is off", () => {
    const t = tile("off", { fan_mode: "high", preset_mode: "boost", temperature: 17 });
    assert.equal(t.text(), "OFF", "no stale mode/speed/setpoint next to OFF");
    assert.ok(t.line.classList.contains("muted"), "OFF reads as secondary");
    assert.match(t.q(".modeicon").className, /m-off/, "the muted fan behaviour is unchanged");
  });

  it("says only UNAVAILABLE when the entity is down", () => {
    const t = tile("unavailable", { fan_mode: "high", temperature: 17 });
    assert.equal(t.text(), "UNAVAILABLE");
    assert.ok(t.line.classList.contains("muted"));
  });

  it("skips whatever the integration does not report", () => {
    assert.equal(
      tile("cool", { fan_mode: undefined, temperature: 18 }).text(),
      "COOL · 18°",
      "a unit with no fan_mode still shows mode and setpoint",
    );
    assert.equal(
      tile("cool", { fan_mode: "high", preset_mode: undefined, temperature: 18 }).text(),
      "COOL · HIGH · 18°",
      "no preset attribute means no special mode",
    );
    assert.equal(
      tile("cool", { fan_mode: "high", temperature: null }).text(),
      "COOL · HIGH",
      "a missing setpoint is left out rather than printed as NaN",
    );
    assert.equal(
      tile("cool", { fan_mode: "unknown", preset_mode: "none", temperature: 18 }).text(),
      "COOL · 18°",
      "unknown/none are not values to display",
    );
  });

  it("shows a special mode other than boost when the unit reports one", () => {
    assert.equal(tile("cool", { fan_mode: "low", preset_mode: "eco", temperature: 24 }).text(), "COOL · LOW · ECO · 24°");
    assert.equal(tile("heat", { fan_mode: "auto", preset_mode: "sleep", temperature: 21 }).text(), "HEAT · AUTO · SLEEP · 21°");
  });

  it("keeps a decimal setpoint and drops a meaningless one", () => {
    assert.equal(tile("cool", { fan_mode: "high", temperature: 17.5 }).text(), "COOL · HIGH · 17.5°");
    assert.equal(tile("cool", { fan_mode: "high", temperature: 17 }).text(), "COOL · HIGH · 17°");
  });

  it("takes the setpoint from the AC, not from the card's target helper", () => {
    // The demo target helper is 20; the unit is holding 17.
    const t = tile("cool", { fan_mode: "high", temperature: 17 });
    assert.equal(t.q(".ctarget").textContent, "20°", "the tile's own target row is untouched");
    assert.equal(t.q(".ccur").textContent, "26.5°", "the room temperature is untouched");
    assert.match(t.text(), /17°$/, "the status line carries the unit's setpoint");
  });

  it("colours the line like the fan above it, season override included", () => {
    const cool = tile("cool", { fan_mode: "high", hvac_action: "cooling" });
    assert.match(cool.line.className, /m-cool/);

    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("cool", { hvac_action: "cooling", fan_mode: "high" });
    s["input_boolean.demo_heating_season"] = toggle("on");
    const heat = mount(compact(), makeHass(s), 200);
    assert.match(heat.q(".cstatus").className, /m-heat/, "heating season paints the words red too");
    assert.match(heat.q(".modeicon").className, /m-heat/);
  });

  it("is derived from the same helper the full card uses", () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("cool", { fan_mode: "high", preset_mode: "boost", temperature: 17 });

    const full = mount(oneRoom(), makeHass(s), 520).refs(0);
    const comp = tile("cool", { fan_mode: "high", preset_mode: "boost", temperature: 17 });

    assert.equal(full.statusMain.textContent, "COOL");
    // The full card sets it over two lines, so read them as lines and rejoin.
    const fullLines = [...full.status.querySelectorAll(".statusline")]
      .filter((l) => !l.hidden && l.textContent)
      .map((l) => l.textContent.trim().replace(/^·s*/, ""));
    assert.equal(fullLines.join(" · "), "COOL · HIGH · BOOST · 17°");
    assert.equal(comp.text(), fullLines.join(" · "), "one implementation, two layouts");
  });

  it("announces the whole status even when the visible line is trimmed", async () => {
    const t = tile("cool", { fan_mode: "high", preset_mode: "boost", temperature: 17 }, 132);
    await frame();
    assert.match(t.q(".ctile").getAttribute("aria-label"), /COOL, HIGH, BOOST, 17°/);
  });

  it("never overflows its tile, at any width we design for", async () => {
    const attrs = { fan_mode: "silent", preset_mode: "boost", temperature: 17.5 };
    for (const w of [420, 380, 340, 300, 260, 230, 200, 172, 160, 148, 132, 120]) {
      const t = tile("cool", attrs, w);
      await frame();
      const line = t.q(".cstatus");
      const tileBox = t.q(".ctile").getBoundingClientRect();
      const lineBox = line.getBoundingClientRect();
      assert.ok(
        line.scrollWidth <= line.clientWidth,
        `status overflows its box at ${w}px (${line.scrollWidth} > ${line.clientWidth})`,
      );
      assert.ok(
        lineBox.right <= tileBox.right + 0.5 && lineBox.left >= tileBox.left - 0.5,
        `status escapes the tile at ${w}px`,
      );
      assert.ok(
        t.card.scrollWidth <= t.card.clientWidth + 0.5,
        `the card scrolls horizontally at ${w}px`,
      );
    }
  });

  it("keeps everything at tablet and desktop widths, trimming only when it must", async () => {
    const attrs = { fan_mode: "silent", preset_mode: "boost", temperature: 17.5 };
    for (const w of [420, 340, 260, 230]) {
      const t = tile("cool", attrs, w);
      await frame();
      assert.equal(t.bits().length, 4, `dropped a bit at ${w}px, where it all fits`);
    }
  });

  it("drops the lowest priority first when it truly cannot fit", async () => {
    const attrs = { fan_mode: "silent", preset_mode: "boost", temperature: 17.5 };
    const wide = tile("cool", attrs, 300);
    const narrow = tile("cool", attrs, 108);
    await frame();
    const kept = narrow.bits().map((b) => b.textContent);
    assert.equal(wide.bits().length, 4, "the wide tile keeps everything");
    assert.ok(kept.length >= 1, "the mode word always survives");
    assert.equal(kept[0], "COOL", "MODE is never the thing that goes");
    assert.ok(kept.length < 4, "something had to give at 108px");
    // Whatever survived must be a priority-ordered prefix of the full line.
    assert.equal(
      kept.join(" · "),
      ["COOL", "SILENT", "BOOST", "17.5°"].slice(0, kept.length).join(" · "),
      "bits must drop from the tail, never from the middle",
    );
  });

  it("does not overlap the name, the fan or either temperature", async () => {
    const t = tile("cool", { fan_mode: "silent", preset_mode: "boost", temperature: 17.5 }, 190);
    await frame();
    const line = t.q(".cstatus");
    for (const sel of [".cname", ".ccur", ".ctarget", ".modeicon"]) {
      assert.notOk(rects(line, t.q(sel)).overlap, `status overlaps ${sel}`);
    }
  });

  it("keeps every tile the same height whatever its unit is doing", async () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("off");
    s["climate.demo_office_ac"] = climate("cool", {
      fan_mode: "high",
      preset_mode: "boost",
      temperature: 17,
    });
    s["climate.demo_living_room_ac"] = climate("unavailable");
    const m = mount({ ...DEMO_CONFIG, layout: "compact" }, makeHass(s), 230);
    await frame();
    const heights = m.qa(".ctile").map((el) => el.getBoundingClientRect().height);
    const spread = Math.max(...heights) - Math.min(...heights);
    assert.ok(spread < 0.75, `tiles differ in height by ${spread.toFixed(2)}px: ${heights.join(", ")}`);
  });

  it("stays compact -- one extra line, not a second card", async () => {
    const s = demoStates();
    s["climate.demo_bedroom_ac"] = climate("cool", { fan_mode: "high", preset_mode: "boost" });
    const withStatus = mount(compact(), makeHass(s), 230);
    const full = mount(oneRoom(), makeHass(s), 230);
    await frame();
    const ch = withStatus.card.getBoundingClientRect().height;
    assert.ok(ch <= 80, `compact tile grew to ${Math.round(ch)}px`);
    const fh = full.card.getBoundingClientRect().height;
    assert.ok(ch < fh * 0.6, `compact ${Math.round(ch)}px vs full ${Math.round(fh)}px`);
  });

  it("scales the type with the tile and never below the floor", async () => {
    const sizes = {};
    for (const w of [420, 260, 200, 160, 120]) {
      const t = tile("cool", { fan_mode: "high", temperature: 17 }, w);
      await frame();
      sizes[w] = parseFloat(getComputedStyle(t.q(".cstatus")).fontSize);
    }
    assert.ok(sizes[120] >= 9.4, `floor breached: ${sizes[120]}px at 120px`);
    assert.ok(sizes[420] <= 12.1, `cap breached: ${sizes[420]}px at 420px`);
    assert.ok(sizes[260] >= sizes[160], "wider tiles never use smaller type");
    // Secondary information: never louder than the room name above it.
    const t = tile("cool", { fan_mode: "high", temperature: 17 }, 260);
    await frame();
    assert.ok(
      parseFloat(getComputedStyle(t.q(".cstatus")).fontSize) <=
        parseFloat(getComputedStyle(t.q(".cname")).fontSize),
      "the status line must not shout over the room name",
    );
  });
});

describe("editor", () => {
  function editor(config) {
    const ed = document.createElement("ac-control-card-editor");
    stage().appendChild(ed);
    ed.setConfig(config);
    ed.hass = makeHass();
    return ed;
  }

  const type = (form, patch) =>
    form.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: patch },
        bubbles: true,
        composed: true,
      }),
    );

  it("does not tear down the field being typed in", () => {
    // Every keystroke emits a config change. Rebuilding the editor there
    // replaces the input mid-word and the caret jumps out of the field.
    const ed = editor(oneRoom());
    const form = ed.querySelector(".acc-room-body ha-form");
    assert.ok(form, "the open room should have a form");

    type(form, { room_name: "P" });
    assert.equal(ed.querySelector(".acc-room-body ha-form"), form, "form survives one keystroke");

    type(form, { room_name: "Pa" });
    assert.equal(ed.querySelector(".acc-room-body ha-form"), form, "and the next");
  });

  it("keeps the card-level form alive too", () => {
    const ed = editor(oneRoom());
    const gForm = ed.querySelector("ha-form");
    type(gForm, { temperature_step: 1 });
    assert.equal(ed.querySelector("ha-form"), gForm);
  });

  it("still shows what was typed in the room's title", () => {
    const ed = editor(oneRoom());
    type(ed.querySelector(".acc-room-body ha-form"), { room_name: "Pa" });
    assert.equal(ed.querySelector(".acc-room-title b").textContent, "Pa");
  });

  it("reports the edit upwards", () => {
    const ed = editor(oneRoom());
    let emitted = null;
    ed.addEventListener("config-changed", (e) => {
      emitted = e.detail.config;
    });
    type(ed.querySelector(".acc-room-body ha-form"), { room_name: "Pa" });
    assert.equal(emitted.rooms[0].room_name, "Pa");
  });

  it("does rebuild when the set of rooms changes", () => {
    const ed = editor(oneRoom());
    const before = ed.querySelector(".acc-room-body ha-form");
    ed.querySelector(".acc-add").click();
    assert.equal(ed.querySelectorAll(".acc-room").length, 2, "a second room should appear");
    assert.notOk(
      ed.contains(before),
      "adding a room has to rebuild, so the old form is gone",
    );
  });
});

export async function run(report) {
  let pass = 0;
  let failed = 0;
  for (const suite of suites) {
    report.suite(suite.name);
    for (const t of suite.tests) {
      try {
        await t.fn();
        pass += 1;
        report.pass(t.name);
      } catch (e) {
        failed += 1;
        report.fail(t.name, e && e.message ? e.message : String(e));
      }
    }
  }
  report.done(pass, failed);
  return { pass, failed };
}
