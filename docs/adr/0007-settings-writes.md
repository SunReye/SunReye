# 7. Settings writes

Status: accepted (2026-11-08), amended (2026-11-09)

## Context

A write can reach a grid-tied inverter or battery. Vendors differ: unlock codes, enable registers, silently ignored writes (SunSpec, Fronius), exceptions that stop a block with earlier registers already written (SunSpec, SMA), flash with a stated limit of about 1,000,000 writes (SolaX), and lockouts after a wrong code (SMA: 30 s, then 15 min). v3 had one choke point and no read-back.

## Decision

**One funnel.** The only code that issues a write. It rejects before touching a device unless the setting exists, is writable, the value fits the profile's range, step or enum, the device's writes are switched on, the profile's writes are enabled (ADR 8) and every precondition holds. A rejection is a validation error, never a device fault. Preconditions are read first, in the endpoint's task; one that does not hold is refused as `setting.precondition`, is not logged and does not start the interval. One that cannot be read writes nothing and reports `unknown`.

**Recipes.** A setting is an ordered list of steps declared by the profile (ADR 5 lists the kinds). It runs inside the endpoint's task between polls, stops at the first failing step and names it. `finally` steps (relock) run once the unlock was sent, even after a failure, each once; a failing one is named counting on from the recipe's last step. An acknowledged unlock or relock is not a write of the setting. The default `write` step is function code 16, since Deye ignores 6 on its settings registers (measured live).

**Outcomes.** `verified`, `mismatch`, `unknown`, `partial`, and `unchanged` when the current value already equals the request and nothing was written.

- A recipe declares what to read back, which may differ from the register written. Silent ignores make read-back mandatory; a lint rejects a recipe without one unless the setting is declared write-only, which always reports `unknown`.
- A timeout is `unknown`, followed by a read-back attempt. It is never retried automatically, because a retry can double-apply a relative setting. A mismatch is shown as an error and not retried.
- The current value is read before writing, and the equal-value skip compares register words. A failed read writes nothing and reports `unknown`.
- A device that refuses a step with an exception before any write was acknowledged is a `mismatch`; any step failing after an acknowledged write is `partial`.
- There is no rollback; the device's state after `partial` is uncertain and the admin is told so.
- An unlock failure is never retried automatically.

**Audit.** Every attempt that reaches the device is appended to a write log: time, device, setting, value before, value requested, value read back, outcome, failing step (counted from 1), actor, and `via`: the trusted device key a remote write came through (ADR 16). It is kept long and not rolled up.

**Wear.** A profile declares each register's class (`persistent` or `volatile`) and a minimum interval between writes. A write whose value equals the current one is skipped. The interval runs from the setting's last attempt with any outcome but `unchanged`; a clock stepped back still waits.

**Secrets.** Unlock codes, passwords and tokens belong to a connection. A recipe refers to them by name. They never appear in a profile, a log, the write log or an API response; the API reports only set or not set. They live in their own table, unencrypted: a key on the same disk would add nothing. The data directory is mode 0700 and the database 0600. A backup excludes them unless the admin includes them explicitly; a write whose unlock names a secret its connection does not hold is refused as `secret.missing`, and one whose secret is not a decimal code of the step's type as `secret.value`; neither touches the device or is logged, and a restored connection without its secret reports `secret.missing`.

**Switch.** Each device has a `writes enabled` switch, off by default, turned on by an admin per device. A community profile, and an official setting not verified on hardware, also needs each setting enabled (ADR 5, 8).

**Actors.** Every write carries an actor: `admin`, or a named controller (a future EMS). An admin acts through the authenticated API. A controller holds an exclusive lease on the settings it controls, shown in the SPA and revocable by the admin; while a lease is held, an admin write to that setting is refused with a code naming the holder. Controller writes run through this same funnel, audit log and wear limits. No integration commands a register; EVCC settings (ADR 10) are admin actions through this funnel.

**Live control.** A recipe that needs a refresher, or sets a revert timeout other than none, is a live-control point (ADR 5). An admin cannot invoke one; a controller under a lease can. The core, not the controller, owns the refresh timer, and stops refreshing when the controller stops, so the device falls back to its own default. The first release has no controller. A grid-feed limit with revert time 0 (Fronius `WMaxLimPct`) is an ordinary setting.

**Composite settings.** Two kinds, each write going through the funnel with its own outcome and no rollback.

- `snapshot-toggle` is kept: all 20 official Deye profiles use it once, as a battery discharge lock that writes `maximum_discharge_current = 0` and restores the previous value on release. Engaging reads the target's current value and stores it in the store, not in a settings blob, before writing. Releasing with no stored value is refused with a stable code. The lock persists on the device and needs no refresher, so it is a setting, not live control.
- `preset` writes a fixed list of values. No official profile uses it yet; it stays out of the schema until one does.

## Considered options

- **Automatic retry on timeout.** Rejected for the double-apply risk.
- **Rollback.** Rejected: the core cannot know a half-configured device's state.
- **Writing without read-back.** Rejected: several vendors ignore bad writes without an error.

## Consequences

Setting changes are slow and visible. A control loop (battery dispatch from EVCC, price-driven charging) is a controller with its own ADR and safety case; the refresh timer and its watchdog live once, in the core.
