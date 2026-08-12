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
    assert.match(CARD_VERSION, /^\d+\.\d+\.\d+$/);
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
    assert.equal(one.card.getCardSize(), 2);
    assert.equal(three.card.getCardSize(), 4);
    assert.ok(
      three.card.getGridOptions().rows > one.card.getGridOptions().rows,
      "three rooms should need more grid rows than one",
    );
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
    assert.ok(gap >= 3 && gap <= 8, `unexpected gap of ${gap.toFixed(1)}px`);
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
    // Two 38px squares plus their gap is the left column's natural height. Row
    // heights still vary a little with content, since the badge may wrap under
    // the target, but nothing should balloon.
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    await frame();
    for (const [i, row] of m.rows().entries()) {
      const h = row.getBoundingClientRect().height;
      assert.ok(h <= 115, `row ${i} grew to ${h}px`);
    }
    const col = m.refs(0).statusCol.getBoundingClientRect().height;
    assert.ok(col <= 85, `left column grew to ${col}px`);
  });

  it("does not push the target temperature into a mid-phrase wrap", async () => {
    const m = mount(DEMO_CONFIG, makeHass(), 520);
    await frame();
    const target = m.refs(0).target.getBoundingClientRect();
    assert.ok(target.height < 26, `"Target …" wrapped onto ${target.height}px of lines`);
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
    for (const w of [520, 430, 380, 320, 260, 220]) {
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
