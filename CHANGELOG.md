# Changelog

## Unreleased

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
