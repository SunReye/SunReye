---
title: Automations
description: Light control loops that write inverter settings from live data, the solar forecast, and day-ahead prices.
---

**Automations** (`/automations`) are control loops that steer the inverter on their own from
live readings, the solar forecast, and — optionally — day-ahead prices. The screen is an index:
one card per automation with its live run state, opening onto that automation's own page.

Nothing runs until the **master switch** is armed under
[Settings → Automations](/use/settings/#automations), which asks you to accept a disclaimer
once: automations write inverter registers, the configured limits must match your hardware and
grid contract, and you remain responsible for the plant. Whatever register an automation holds,
your previous value is restored when it lets go.

Today there is one automation.

## PV peak shaving & forecast charging

Steers the battery's **max charge current** from live PV, state of charge and the 15-minute
forecast: surplus above the export limit charges the battery, and headroom is reserved for the
midday peak instead of the pack filling at breakfast and having nowhere to put noon.

The page is a two-column split — configuration on the left, the live picture on the right (on a
phone: status, plan, charts, then settings) — with a live indicator that shows when the last
tick landed and how long the next one is.

<img class="sr-shot sr-light" src="/SunReye/screenshots/automations-light.png" alt="Peak shaving: settings on the left, live status, plan and decision history on the right." />
<img class="sr-shot sr-dark" src="/SunReye/screenshots/automations-dark.png" alt="Peak shaving: settings on the left, live status, plan and decision history on the right." />

### Modes

- **Maximize exports** — the battery only absorbs power *above* the export limit; everything
  below it is sold. When the forecast peak cannot fill the battery on its own, charging falls
  back to the configured rate.
- **Grid-friendly** — lowers midday feed-in: the inverter is held at a dynamic export level and
  the battery takes the difference, so the export curve sits *below* the limit rather than
  pinned at it. PV above the export budget is given up; that is the price of the flatter curve.
  Needs the profile's solar-sell max-power register. Its own tuning block adds a **plateau
  slew** and **charge ramp** (how fast the ceiling may move — stepping straight to the full
  ceiling swings kilowatts at the connection point, which is the thing this mode exists to
  avoid), a **minimum feed-in** the plateau never drops below, a **forecast trust** percentage,
  and whether to **reserve for EV demand**.

### Core settings

| Setting | What it does |
| --- | --- |
| **Safety buffer (W)** | Margin below the export limit at which shaving starts. |
| **Max charge current (A)** | Hard ceiling ever written to the inverter. |
| **Fallback charge current (A)** | Rate used when no headroom must be reserved. |
| **Top-balance floor (A)** | Kept near full so the BMS can finish balancing; 0 disables. |
| **Control interval (s)** | Seconds between decisions — a register write happens at most this often. |
| **Shadow mode (dry run)** | Decide and chart every tick without writing anything. Any register already held is handed back. |

**Shadow mode** is how you check what peak shaving *would* do before letting it steer: the
decision charts fill in as usual, and the tooltip puts the modelled export next to the measured
one.

### Negative-price windows

Off by default, and locked until a smart-meter gateway install date is set under
[Settings → Plant](/use/settings/#plant) — §51 only applies to plants that have one. With it
on, the battery makes room ahead of a window with a negative day-ahead price and absorbs the
surplus during it. Energy exported in those quarter-hours earns nothing under §51 EEG, so
storing it is the only way to keep its value. Needs a
[day-ahead price source](/use/settings/#day-ahead-prices).

- **Hold the battery low before a window** — charges as much as possible, as late as possible,
  rather than simply stopping: pre-window PV *is* paid for, and the reserve floor still applies.
- **Use the car as a sink** — borrows connected [EVCC](/integrations/evcc/) chargers for a
  window, in two steps. An idle charger is woken onto **surplus charging**, so it eats what
  would otherwise be exported for nothing; and while the battery is still too full to make room
  on its own, SunReye switches on EVCC's **battery boost**, which drains the house battery into
  the car — the only sink big enough, since a house alone cannot absorb enough in the hours
  before a window. Boost stops at the **battery boost floor**, and is switched off once the
  window starts: from then on the battery should be *filling* with energy that earns nothing. A
  charger you left on immediate charging is never touched, and everything borrowed is remembered
  on disk, so a restart mid-window still hands the car back.
- **Battery boost floor (%)** — how far the car may empty the house battery while boosting.
  EVCC holds the battery there rather than letting it oscillate, and the plant's own reserve
  applies on top, so this can only ever ask for *less* discharge than the inverter already
  allows.
- **Charge the battery from the grid** — buys from the grid during a window. Off by default and
  inert unless your **import** price follows the market ([Settings → Tariff](/use/settings/#tariff)):
  a negative wholesale price does not lower a fixed bill. Even on a spot tariff you still pay
  grid fees, levies and VAT, so this is about buying at the cheapest hour of the day, not about
  being paid to consume. Needs an inverter that exposes the grid-charge registers; where it
  doesn't, the switch has no effect.
- Thresholds for what counts as negative (0 EUR/MWh is the §51 rule exactly), the shortest
  window worth acting on, how far ahead to plan, how much feed-in to allow during a window, the
  grid-charge current, and a reserve margin.

Negative prices are usually driven by **wind**, and the deepest ones fall at night. The loop
normally parks itself when there is no sun and none coming; with price awareness on, a live
negative window keeps it awake — otherwise the one case grid-charging exists for could never
fire.

### Status, plan, and decision history

- **Status** names what the loop is doing and reports PV power, house load, battery headroom,
  the shave threshold, target and live register value, the last check and last write, and — in a
  window — the SOC ceiling in force, how much the window can absorb, and how much **cannot be
  rescued**. That last figure matters: withholding charge often cannot empty a pack in time, and
  shifting flexible load into the window is what closes the gap. Warnings surface the two ways
  the loop can be undermined: the charge ceiling being raised while the battery does not absorb
  (usually a sell-first work mode overriding it), and the current having been changed outside
  the automation.
- **Plan** replays the same rules over the remaining forecast, carrying state of charge forward:
  when charging starts, when the pack is full, the end-of-day SOC, what will be stored, exported
  and curtailed. **Today** joins the day as measured with the projection for what is left of it;
  **Tomorrow** replays tomorrow's forecast with tonight's drain modelled down to the reserve
  floor. It assumes the forecast holds and the load stays at its baseline; it does not guess when
  a car will charge.
- **Decision history** charts what the automation decided and wrote next to what the plant did
  with it — the decided ceiling, the register value, the power plane. The optimizer is a device,
  so its history is read back from the rollups under the `optimizer` slug.

### Blockers

The page refuses to pretend: if the active profile maps no battery SOC, no total PV power or no
max-charge-current setting, or if no battery or export limit is configured, it lists exactly
what is missing and links to the panel that fixes it.

## Related

- [Settings → Automations](/use/settings/#automations) — the master switch.
- [Statistics](/use/statistics/) — negative-price windows are shown there whether or not the
  automation acts on them.
- [EVCC](/integrations/evcc/) — the charger integration the car-as-a-sink step borrows.
