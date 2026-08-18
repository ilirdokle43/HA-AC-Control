# Changelog

Releases from 2026.8.14 onwards are dated — `YYYY.M.D`, with a trailing counter
(`YYYY.M.D.1`) when there is more than one release on the same day. Earlier
releases used semantic versions.

## 2026.8.18.9

### Added

- **The card carries its own font.** Choco Cooky is embedded as Base64 WOFF2 and
  registered once for the document, so every card on a dashboard shares one face
  and none of them makes a network request for it. The family is applied at the
  card's host and reaches its text by inheritance, which means text the card
  gains later picks it up without a rule having to name it. Icons are left out
  deliberately.
- The font is **subset to Latin-1, Latin Extended-A, punctuation and the degree
  and arrow symbols** the card draws — 383 glyphs of the original 16,597, which
  are overwhelmingly Hangul. That is 36 KB embedded rather than 819 KB, and it
  adds 48 KB to the card. Text outside those ranges falls back to the dashboard
  font as before.

  Two things about wiring a font into a card that are easy to get wrong, and
  cost a broken deploy each here:

  - The family has to be handed over as an **inline property on the element**,
    not by an `ac-control-card{--acc-font:…}` rule in the document stylesheet.
    On a dashboard the card sits several shadow roots deep inside
    `hui-view`/`hui-card`, where a document rule never matches it — the property
    came out empty and the card kept the dashboard font. A card appended
    straight to the document *does* match that rule, so a test harness renders
    correctly throughout and only the live dashboard shows the fault. The
    `@font-face` itself stays in the document, since faces are global and one
    declared inside a shadow tree would be invisible to it.
  - It has to be set from `connectedCallback`, **not the constructor**. A custom
    element constructor may not give itself an attribute, and an inline style is
    one; doing it there makes every card on the dashboard fail to construct and
    render as a red configuration error.

### Fixed

- **The test suite waits for the embedded face before measuring glyph ink.** It
  loads with `font-display:swap`, so the card lays out in the fallback first and
  again when the face arrives, and any test comparing ink against a box was
  racing that second layout.

### Notes

- The status block is the one thing on the card centred against something that
  is not text, so it is the only part a change of font could move. Swept on the
  live dashboard from 440 to 700px, Choco Cooky moves it by 1 to 2px and it
  stays 4.5–6.6px from the rocket square's centre — so none of the width-fitted
  figures needed changing. A first attempt to correct a 5.5px shift was measured
  in the test harness instead, where a card in a bare container puts the square
  about eleven pixels lower relative to the text than a dashboard does; the
  shift was an artefact of that, and correcting for it made the live card worse.
  The suite now checks what the font *does* to the block rather than where the
  block lands, since only the delta means anything off a dashboard.

## 2026.8.18.5

### Fixed

- **A stacked card's text columns went back to the gap they had.** Broadening the
  text-block rules from `.rooms.multi` to `.rooms` in 2026.8.18.4 dropped their
  specificity from (0,3,0) to (0,2,0), which lost the `column-gap` to the wide
  tier's own `.roomtext` rule at (0,3,0): 8px became 10px on a 488px card and
  16px became 28px at 1400px, taking that width out of the status column. The
  rules are qualified with `.surface:not(.compact)` again so they outrank it.
- **The status offsets no longer depend on where they sit in the file.** They had
  come to tie the single-room lift they are meant to override, winning only on
  source order; the selector now carries `.roomtext` and outranks it outright.

## 2026.8.18.4

Spacing and layout of a card holding a single room. A stacked card is unchanged
throughout.

### Fixed

- **A one-room card no longer carries a band of empty card at its ends.** Its
  single row is both the first and the last, so it was taking a full row's
  padding at each end -- and from 470px up that came from the wide tier's
  shorthand, `clamp(11px, 2.1cqi, 18px)`, which out-specifies the 2px trim the
  base rules apply. It now uses the same `--acc-row-edge` a stacked card does.
  The surface's own vertical padding comes down with it, roughly 4px a side.

### Changed

- **A one-room card builds the same text block a stacked one does**, with the
  difference badge as its own grid item on the status row rather than stacked
  under the target. Stacking the two made `.targetline` 64px tall beside a 30px
  temperature and left about 27px of nothing below everything the card drew. On
  a 488px card the height goes 158 -> 133px, the ends even up at 14/13px, and
  the card keeps that height whether the unit is off or running.
- The status offsets are now shared by both kinds of card instead of a single
  room having a set of its own, so one calibration serves both.

## 2026.8.18.3

Vertical placement of the status block on the stacked (multi-room) card. A card
with one room is untouched.

### Fixed

- **The status block sits on the rocket square beside it, at every card width.**
  It was being placed by a single fixed offset, and the offset it needs is not
  fixed: measured on a real dashboard from 440 to 940px it runs 6.9, 3.5, 1.8,
  2.1, 4.2, 9.8, 17.7, 24.8, 26.0, 26.8px. The curve dips rather than climbing,
  because the left column's squares grow steadily with the card while the text
  beside them stops growing once its font clamps top out. One constant is
  therefore right at one width and wrong everywhere else — off by 25px at the
  extremes. It now follows the measured curve in four segments, landing within
  0.7px from 320 to 940px.
- **The difference badge moves with the status line it shares.** It is its own
  grid item, so shifting the status alone left the two out of line by the full
  offset on a wide card.

### Changed

- OFF is placed by the same rule as a running unit plus a small constant, rather
  than being aligned to a running unit's first line. The two states differ in
  height, so their rows differ in height, which puts the square each is measured
  against in a different place; one offset cannot centre both.

## 2026.8.18.2

Layout work on the stacked (multi-room) card. A card with one room is untouched
throughout — every change here hangs off a `multi` marker on the room list.

### Changed

- **A stacked card is 21–38px shorter.** The rules that pulled the first row up
  against the top padding and the last row down against the bottom were being
  overridden from 431px up by the wide tier's own row-padding shorthand, so the
  surface's padding and the row's were simply added together at both ends. The
  outer edges are trimmed again, and the space either side of the divider is a
  little smaller: at 520px a two-room card is 313.5 → 278.7px, at 1024px
  454.5 → 416.5px.
- **The difference badge moves onto the status line when rooms are stacked**, with
  `Target 20.0°` staying up beside the room temperature. It is the only one of
  the three arrangements that fits the widths this card is used at — putting the
  status, target and badge on one row needs about 566px of text column and there
  is at most 498px. A single-room card keeps the badge under the target.
- **The status is set over two lines** — mode and fan speed, then any special mode
  and the setpoint — and sits level with the boost square beside it.
- **OFF drops onto the line a running unit's status occupies**, by 6.5px at a phone
  width up to 12px at a desktop one. It is set at twice the size in a
  deliberately short line box, so it was riding that far above its neighbours.

### Fixed

- Two-line and single-line status now share one labelled helper
  (`_statusParts`), so the full card and the compact tile cannot describe a unit
  differently.

## 2026.8.18.1

### Changed

- **Tapping a room turns that unit on or off.** Every part of a room row counts —
  the fan, the name, either temperature, the difference badge, the status line —
  except the five buttons, which go on doing their own job: boost, −, +, power and
  AUTO. On a multi-room card the row under the pointer decides which unit is
  toggled, rather than the first room as before; a tap on the card's own padding
  toggles a single-room card and is ignored on a multi-room one, where there is no
  way to tell which unit was meant. `tap_action: more-info` restores the old
  behaviour.
- Each room row is now the focusable control, with its own `aria-pressed` and a
  label that says what a tap will do. The card body used to be one big button.
- The word `OFF` sits 10px higher again on cards up to 560px wide; wider cards are
  unchanged.

## 2026.8.18

### Added

- **A live status line on the compact tile.** `COOL · HIGH · BOOST · 17°`, built in
  priority order — mode, fan speed, special mode, target — from the climate
  entity's own `state`, `fan_mode`, `preset_mode` and `temperature`. It fits itself
  to the tile: when the width will not take the whole line it drops the target
  first, then the special mode, then the fan speed, so the mode word is the last
  thing standing. Nothing is ever trimmed while it fits, which is why tablet and
  desktop tiles always show all of it. Measured rather than guessed at, and re-fit
  whenever the tile changes width.
- **The difference badge on the compact tile**, immediately before the target, from
  the same helper the full card uses. `0°` stands in for the full card's
  `at target`, which is too long for a tile.
- Fan-speed labels are normalised the way the spin speed already was, so `medium`
  and `mid` both read `MID`, and any preset the unit reports is shown rather than
  boost alone — `ECO`, `SLEEP` and the rest.

### Changed

- **The four controls stack two-by-two** once they sit beside the room text —
  minus and plus above, power and AUTO below. Each button gains roughly 65% in
  area, and the block ends up 80–115px narrower than the old single row, which
  goes back to the temperatures.
- **The fan column now fills the row.** Its two squares are built from the same
  expression as the control block — two squares and a gap equal two buttons and
  theirs — so both sides come out exactly level at every width. The squares sit a
  little further apart than the buttons and pay for it out of their own size, so
  widening that gap cannot change the row height.
- The text scales with them: room temperature up to 40px, target 26px, status 19px,
  all capped so a very wide card does not keep growing.
- **Target and difference stack**, badge centred beneath the phrase, which let both
  be set larger without costing a pixel of height.
- A unit that is off says `OFF` at twice the status size. The line box is left at
  the normal height, so the bigger word does not make the card any taller.
- The compact tile's target keeps a decimal only when it has one — `19.5°` is no
  longer rounded to `20°`.
- Tapping a compact tile toggles the unit; it used to open the more-info dialog.
  Set `tap_action` to get the old behaviour back.

### Fixed

- **A white line flashed around the card on every view change.** `ha-card` animates
  its border, and before the theme's custom properties resolve the width falls back
  to its initial value — `medium`, 3px — in a near-white. The border is now
  restated with fallbacks that cannot resolve to a visible colour, and the blanket
  transition is off. A theme that sets a border still gets exactly the border it
  asked for.
- The fan-only mode no longer prints a setpoint it is not holding.

## 2026.8.14

### Fixed

- **The compact tile's temperatures were close to unreadable on a light theme.**
  The amber sat at roughly 1.7:1 against a white card. Both colours are now blended
  toward the theme's own text colour, which lifts them to about 3.6:1 on a light
  card while leaving the dark card at 10.7:1 and looking as it did before. The blend
  follows the *theme* rather than the operating system, since a dark Home Assistant
  theme on a light desktop is perfectly normal — `prefers-color-scheme` would get
  that case wrong. Setting `--acc-compact-current` or `--acc-compact-target` still
  overrides it outright.

### Changed

- Version scheme is now date-based; `CARD_VERSION` reports `2026.8.14`.

## 2.1.1

Documentation and packaging only — the card behaves exactly as it did in 2.1.0.

### Added

- A **Troubleshooting** section in the README covering caching after an update, the
  "custom element doesn't exist" error, missing entities, a stationary fan, a
  missing boost button, boost timing out on the unit itself, a greyed-out AUTO, and
  compact tiles stacking instead of sitting side by side.
- Compact mode in the feature list and in the HACS panel description.
- `ac-control-card.js` is attached to the GitHub release as a downloadable asset.

### Changed

- Every screenshot regenerated from the current build at 2× for sharper rendering.

### Added

- **Compact layout** — `layout: compact` (or `compact: true`) renders the card as a
  small dashboard tile: the fan, the room temperature, the room name and the AC's
  target, and nothing else. Tapping it opens that unit's full Home Assistant
  controls, so nothing is lost by shrinking it. The tile asks for a quarter of a
  section so four sit in a row on a desktop, and can be dragged down to two columns
  in the dashboard's own layout editor — the card does not fix the column count
  itself. The fan keeps its meaning across both layouts: it uses the same `m-*`
  palette and the same `_fanSpin()`, so it is muted when the unit is off, blue while
  cooling, and turns at the unit's real fan speed.
- `--acc-compact-current`, `--acc-compact-target` and `--acc-compact-radius` for
  theming the tile.
- A **Layout** dropdown in the GUI editor, so compact mode needs no hand-written
  YAML.

### Fixed

- **The GUI editor no longer loses focus after every character.** Typing a room
  name emits a config change on each keystroke, and `_emit()` forced a full
  rebuild of the editor — which replaced the input being typed in, so the caret
  jumped out and the field had to be clicked again. Field edits now refresh the
  existing forms in place (`_syncForms()` already updated both the values and the
  room titles); only structural changes — adding, removing or reordering a room —
  still rebuild.

The full layout is untouched: with no `layout` set, the card renders exactly as it
did in 2.0.1.

## 2.0.1

### Fixed

- **Cards no longer overlap each other in a sections dashboard.** `getGridOptions()`
  estimated the card's height as `28 + 78 × rooms`, which only ever described the
  wide layout. Below the 430px breakpoint the controls move onto their own line and
  every room row grows by about half, so a card in a narrow section column claimed
  two grid rows (120px) while rendering 162px — and the next card was drawn 42px
  into it. Three-room cards overlapped by 17px even at full width.

  The card now reports `rows: "auto"` so Home Assistant sizes the grid row from
  what is actually rendered, which is the only estimate that holds at every width.
  `getCardSize()` and the legacy `getLayoutOptions()` use measured per-layout
  heights (`11 + 106 × rooms` wide, `7 + 155 × rooms` narrow, `3 + 140 × rooms`
  below 280px) and assume the narrow layout when the width is not yet known, since
  guessing small is what causes the overlap.

### Added

- `--ac-control-card-gap` to add a margin below the card, for containers that add
  no spacing themselves such as `vertical-stack`. Defaults to `0`, since sections
  and masonry views already space cards apart.

## 2.0.0

Redesign around a single rounded card that holds every configured room.

### Added

- Multi-room support via a `rooms:` list, with a GUI editor that can add, reorder,
  edit and remove rooms.
- Temperature-difference badge — `▲ 6.5°` / `▼ 0.2°` / `at target`.
- HVAC status line: `OFF`, `COOL`, `HEAT`, `DRY`, `FAN` or `AUTO`, with the unit's
  fan speed and on-unit setpoint alongside it.
- Rounded-square fan icon that is tinted by HVAC mode, glows while the unit is
  producing heat or cold, and spins only while air is actually moving — `hvac_action`
  is honoured, so an idle unit shows a stationary fan.
- The boost control moved out of the right-hand control row and now sits directly
  beneath the fan as a matching rounded square — same size, radius and icon weight
  as the fan above it, rocket only, lit orange while that room is boosting. Same
  service, same entity, same `show_boost` option. The control row is now exactly
  four buttons — minus, plus, power, AUTO — which fit on one line at phone widths
  instead of wrapping AUTO onto a second row.
- The fan's `transform-origin` is pinned to its centre so the spin cannot wobble if
  Home Assistant's `<ha-icon>` sizes its box differently from the glyph.
- `temperature_step`, `show_name` and `show_boost` options, and `tap_action`.
- Explicit unavailable handling: muted rows, disabled controls, no invented values.
- Dependency-free test suite and visual preview under `tests/`.
- `info.md` for the HACS panel, an explicit MIT `LICENSE`, and desktop/mobile/narrow
  screenshots under `docs/`.

### Changed

- The +/- buttons now respect the target helper's own `min` / `max`, and rapid taps
  accumulate instead of resending the same value.
- The target temperature is shown to one decimal place (was two), and no longer
  breaks mid-phrase into `Target` / `20.0°` on a crowded row.
- The season tint on the target temperature applies only to rooms that configure a
  `season_entity`; other rooms render it neutral.
- `season_entity` is now optional and defaults to cooling.
- An incomplete configuration shows an in-card notice instead of a bare message, so
  the GUI editor stays usable while entities are being picked.

### Fixed

- The power button no longer keeps a previous mode's colour after the mode changes.
- A room whose target helper is missing no longer ends up with both season tints.

### Removed

- The gas-cylinder strip and every trace of it: the `gas_entity`, `gas_label`,
  `gas_warning` and `gas_critical` options, the editor fields, the rendering, the
  styles, the `--acc-gas*` theme variables and the demo data. This card covers air
  conditioning only. The first room now sits at the top of the card. Any leftover
  `gas_*` key in an existing config is simply ignored — nothing is rendered for it.
- `--acc-warm` is now `--acc-below`, to pair with the new `--acc-above`.

### Compatibility

The v1 flat single-room configuration still works unchanged — it is normalised into
a one-room list internally. All existing service calls, the automation-entity
derivation and the boost toggle behave exactly as before.

## 1.0.2

- Mode text no longer falls back to "Auto" for non-Midea climate entities.

## 1.0.1

- Target-temperature stepper increment changed from 0.05 to 0.5.

## 1.0.0

- Initial release: single-room AC card with a GUI config editor and HACS support.
