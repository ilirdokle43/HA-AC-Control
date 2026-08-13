# AC Control Card

One Lovelace card for every air conditioner in the house. Each room gets a row with
a fan that spins while the unit is actually moving air, a boost button beneath it,
the room temperature, the target, a badge showing the difference, the HVAC status,
and four touch-sized controls.

![AC Control Card](https://raw.githubusercontent.com/ilirdokle43/HA-AC-Control/master/screenshot.png)

- Several rooms in one card, or a single room
- `▲ 6.5°` / `▼ 0.2°` difference badge, never `NaN` or `unknown`
- Fan tinted by HVAC mode; spins only while air is moving
- Boost, power, AUTO and ± target controls, per room
- **Compact mode** — `layout: compact` for a small dashboard tile, tap to open the
  full controls
- Unavailable rooms are muted and their unsafe controls disabled
- GUI editor — no hand-written YAML needed
- One file, no build step, no external dependencies

![Compact layout](https://raw.githubusercontent.com/ilirdokle43/HA-AC-Control/master/docs/compact.png)

```yaml
type: custom:ac-control-card
rooms:
  - room_name: Bedroom
    climate_entity: climate.demo_bedroom_ac
    room_temp_entity: sensor.demo_bedroom_temperature
    target_temp_entity: input_number.demo_bedroom_target
```

See the [README](https://github.com/ilirdokle43/HA-AC-Control) for every option.
