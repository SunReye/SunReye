# 21. Look, feel and navigation

Status: accepted (2026-11-10), amended (2026-11-12)

## Context

The first integration build rendered browser defaults: plain links for navigation, bare form fields, overlapping 3D labels. The owner wants the SPA to feel premium: glass, the motion and tactility of the kbase components, easy to operate, with in-depth analytics. Master's (v4) dashboard layout is liked; its flat controls list is not. ADR 11 fixes the stack and the copied components; this ADR fixes how the result looks, moves and navigates.

## Decision

**Shell by input and width, not by device name.**

- Mouse or trackpad, any width: a slim floating glass **icon rail** (about 56 px) at the left edge, always visible. Hovering near it, or moving keyboard focus into it, expands it to labels over the content without pushing the content aside. It collapses about 300 ms after the cursor leaves. A pin keeps it open, kept per browser.
- Touch and at least 768 px wide: the same rail, always expanded with icons and labels. A tap on the logo collapses it.
- Touch and narrower: a sticky floating glass **bottom bar** inside the safe area, never hiding on scroll, with exactly five items: Dashboard · History · Forecast · Tariff · More. More opens a bottom sheet: Controls (admin only, first), Settings, Devices, Builder, Status.
- Controls has its own rail entry, visible to admins only.

**Dashboard.** Master's layout:
- **Landscape tablet and desktop:** the page fills the screen and never scrolls. The hero (the 3D scene, or the 2D flow, ADR 11) takes the left ~53 %. The right column stacks:
  - a "now" strip: the current price and the forecast PV still to come today;
  - weather;
  - the today-energy cards (production, consumption, feed-in, purchase, with € and the autarky and self-consumption meters);
  - a small day chart, actual against forecast;
  - EV.
- **Phone:** the same blocks scroll in that order, hero first.
- **3D/2D toggle:** sits in the hero's corner.

**Details by drilling down.** The dashboard answers "now and today". Every figure on it opens its detail:
- **Detail sheets:** a glass side sheet on desktop and tablet, a bottom sheet on the phone. Each has its own hash route, so back closes it, and ends with "Open in history →" at the same range.
- **Range control:** detail pages share one: day, week, month, year, custom, with swipe or arrows to step.
- **Live graph:** a power figure's detail sheet opens with v3's live graph (`live-area`, `live-window`, `live-cursor`), restyled here. It shows a fixed two-minute window anchored to the newest sample, so its data, scales and tooltip index change only when a sample lands. Between samples one transform scrolls the marks, on a cursor that eases linearly across the feed's own sample spacing (clamped to 250 ms–5 s) with a slight overshoot, snapped to quarter pixels. The plot keeps a few samples of buffer past its left edge and is downsampled to its pixel budget. Grid power fills diverging around zero.
- **Deep analytics** (heatmaps, the hourly-block grid, per-string comparison) live in tabs on detail pages, never on the dashboard.

**2D power flow.** Ported from v3 (`dev` at `780b4e2`: `power-flow-diagram`, `power-graph`, `flow-pulse`, `plant-ceiling`) and restyled here.
- **Layout:** chosen from the hero's aspect ratio. In portrait, sources stack above the hub and sinks below it. In landscape, sources fan in from the left and the grid from the right. Anchors are fractions of a safe box inset by one caption stack, so captions never clip.
- **Hub and nodes:** the hub is the inverter, showing DC input, its own draw and its efficiency. The nodes are PV, battery (with an SOC gauge), house, generator, grid and EV (with the vehicle's SOC).
- **Data:** values come from the `plant` device (ADR 14) and the `ev` roles (ADR 10). A node shows only when its role exists.
- **Rails:** one cable per segment, carrying one comet charge: a chain of beads, each on its own `animateMotion` along the cable, so the comet bends with the curve. The comet's speed, size and bloom show the rail's share of the remembered plant peak.
  - The remembered peak rises at once, halves over six hours, never drops below 1 kW, and is kept per browser.
  - Crossing times are quantised to quarter seconds, so an unchanged reading never restarts an animation.
  - A rail that reverses fades out and back in. The bloom's blur is static and never animates.
- **Tapping:** a node opens its detail sheet.

**Drill-in navigation for Controls and Settings.**
- **Pattern:** one component. A root list of groups, each row summarising its current values. Tapping a row slides its page in from the right while the parent shifts left and dims. Each level is a hash route, so browser back and the edge-swipe go back. At most two levels deep.
- **Control groups:** come from the role namespace (`battery.*` → Battery, `grid.*` → Grid & export), labelled by Paraglide. Settings without a role go into Advanced. Profiles carry no groups.
- **Writes:** there is no page lock; ADR 7's writes switch is the lock. With writes off, every control is read-only, under a banner explaining why.

**Value editor.** No sliders in Controls or Settings.
- **Opening:** tapping a setting row opens the value editor: a bottom drawer on touch at any width, an anchored glass popover beside the row with a mouse.
- **Header:** the setting's name, its limits, and a large value whose digits roll up or down with the motion.
- **Bounded stepped numbers** use a wheel. Bounds and step come from the profile for inverter settings and from the setting itself in the app.
  - A momentum drum: a fling coasts, then a spring snaps it to the nearest step. Off-centre rows shrink and fade.
  - Fling speed scales with the range.
  - The current value keeps a faint marker.
  - A `selection` tick plays per step crossing the centre, at most about 30 per second.
  - Tapping the large number lets you type the value directly.
  - Arrows move one step, Page Up and Page Down ten, and the mouse wheel one notch per step.
  - Screen readers see a `spinbutton` with its value and unit.
- **Times** use two wheels, hours and minutes, with minutes at the step the profile allows.
- **Enums** use a list with kbase's sliding `active-indicator`.
- **Free-form values** (prices, coordinates, names) keep a text field.
- **Applying:** "Apply 100 A → 80 A" runs ADR 7's write. The editor shows pending until the read-back, then closes with the outcome: confirmed, refused with its reason, or mismatch, linked to the write log. There is no separate confirmation step.
- **Builder time slider:** stays, because it scrubs time rather than setting a value.

**Glass.**
- **Two levels:**
  - *Overlay glass* (menus, dialogs, sheets) keeps kbase's tokens.
  - *Ambient glass* (rail, bottom bar, dashboard cards, 3D label chips) is lighter, about 72 % opaque in light and 78 % in dark, with the strong blur.
- **Backdrop:** both sit over kbase's `bg-spotlight`, its tint following the sun at the plant: warm at dawn and dusk, clear by day, indigo at night. It is recomputed every 15 minutes and never animated; without a location it stays indigo. No grid pattern anywhere.
- **Opaque fallback:** `prefers-reduced-transparency` and the low-power switch turn every glass surface opaque.

**Colour.**
- **Theme:** dark by default and designed dark-first. Light is fully supported, with a manual override.
- **Energy colours:** each flow has one fixed colour everywhere: charts, tiles, the 2D flow and the 3D scene. Solar amber, battery green, grid import rose-red, export teal, consumption neutral, EV violet. The palette is validated for colour-blind contrast.
- **Brand:** SunReye's v3 mark, a flat sun of eight rays around a disc, in blue-600 (`#2563eb`; a lighter blue in dark mode). The brand colour marks controls only, never data, which is why no energy flow is blue.

**Surfaces.** Boxy: a 2 px corner radius (`--radius: 0.125rem`) on every surface and control. kbase's rules apply:
- a card must do something;
- summary figures sit in a strip divided by hairlines;
- a list is one surface with dividers;
- no visible scrollbars, with edges that fade where more content waits;
- data loads in `load`, so pages never flash a skeleton.

**Motion.**
- **Source:** kbase's motion vocabulary, from `theme.css`, the motion parts of `app.css`, `animated-number`, and `active-indicator` (kbase `8e6db9e`), plus these curves:
  - *Movement between two resting places* (drill-in, rail, sheet travel, camera flight, chart range change): `--motion-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`, 280–350 ms.
  - *Entrances:* kbase's ease-out, 180–250 ms.
  - *Exits:* ease-in, about 150 ms, shorter than their entrance.
  - *Presses:* kbase's 80 ms scale press, released with its spring.
- **Interruptible:** anything a user can interrupt runs on Svelte `Spring`/`Tween` or CSS transitions, never keyframes. A reversed motion continues from where it is. Sheets and back-swipes follow the finger 1:1, then a spring takes over at the release velocity and settles at a snap point.
- **Jank rules:** animate only `transform` and `opacity`. Never animate `backdrop-filter` or layout properties. Numbers use tabular figures. Charts tween between data sets. Sizes are reserved before data arrives.
- **Live ticks:** numbers, gauges, flow-line thickness and 3D tints ease to each tick for slightly longer than the tick interval, so values glide. When the stream stalls they stop, and the connection chip shows the stall.
- **Tiers:** v3's full, lite and still. A device starts on full. About 4 s after the page settles, a frame watch measures strain and drops a struggling device to lite. On lite, each flow rail is one travelling dashed cable instead of a comet chain, and the 3D ambient-occlusion pass is off. The measured strain is kept per device, so a slow wall tablet starts lean the next day. There is no motion setting.
- **Off switches:** reduced motion and the low-power switch force still: all of it is instant and nothing moves.

**Smoothness is measured.** A deliberate e2e journey (outside the gate, ADR 11) runs each signature transition under 4× CPU throttling and records Long Animation Frames: drill-in, sheet, rail, route change, camera flight, live tick, value-editor fling. It fails if any frame exceeds 50 ms or the 95th percentile exceeds 20 ms.

**Haptics.**
- **Library:** `web-haptics` (MIT), pinned to an exact version and wrapped in one `haptics` module that exposes only these events:

  | Event | Preset |
  |---|---|
  | Toggle, segment or tab change | `selection` |
  | Sheet snap, drill-in commit, rail pin | `soft` |
  | Press on a primary action | `light` |
  | Write confirmed by read-back | `success` |
  | Refusal, mismatch, failed sign-in | `error` |
  | A value editor opens | `nudge` |
  | A value-editor wheel crosses a step | `selection` |

  Nothing else vibrates.
- **Setting:** a per-browser switch under Settings › Display. It defaults to on for touch devices and is forced off by the low-power switch and reduced motion.

## Considered options

- **A fully hidden desktop sidebar.** Rejected: it can't be found, and it can't be reached by keyboard or by touch.
- **KPI cards floating over a full-screen 3D scene.** Rejected for master's two-column layout, which the owner prefers.
- **Settings groups declared in profiles.** Rejected: a profile schema change for what role namespaces already give.
- **A lock switch on the controls page.** Rejected: it duplicates ADR 7's writes switch.
- **Sliders and a separate confirmation sheet for writes.** Rejected: a slider is imprecise on touch and has no feel. The value editor shows old → new and applies in one step.
- **A new 2D flow or new live charts.** Rejected: v3's encode magnitude against a remembered plant peak, glide at sample cadence, and survive slow devices. They took long tuning and are kept.
- **v3's per-device motion setting (auto, full, lite, still).** Rejected: the frame watch decides, and the low-power switch is the manual override.
- **Moving particles in the 3D scene.** Rejected: they need a continuous render loop (ADR 20). Particles stay in the 2D flow.
- **Vendoring `web-haptics`.** Rejected for now: nothing to change. The wrapper keeps a later swap to one file.

## Consequences

- **iOS haptics:** iOS gets haptics only through `web-haptics`' switch trick and only inside a user gesture, so `success` after a slow read-back may not fire there, and the wheel's per-step ticks during a scroll may not either. Without them the rolling digits and the snap still carry the feel. It must be checked on a real iPhone.
- **Version risk:** `web-haptics` is pre-1.0 and has one author. An upgrade is a deliberate diff.
- **Design file:** the SPA's short design file is a checklist linking here.
