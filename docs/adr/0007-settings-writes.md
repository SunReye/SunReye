# 7. Settings writes

Status: proposed (2026-11-08)

## Context

A write can reach a grid-tied inverter or battery. Vendors differ: unlock codes, enable registers, silently ignored writes (SunSpec, Fronius), exceptions that stop a block with earlier registers already written (SunSpec, SMA), flash with a stated limit of about 1,000,000 writes (SolaX), and lockouts after a wrong code (SMA: 30 s, then 15 min). v3 had one choke point and no read-back.

## Decision

**One funnel.** The only code that issues a write. It rejects before touching a device unless the setting exists, is writable, the value fits the profile's range, step or enum, the profile's writes are enabled (ADR 8) and every precondition holds. A rejection is a validation error, never a device fault.

**Recipes.** A setting is an ordered list of steps declared by the profile (ADR 5 lists the kinds). It runs inside the endpoint's task between polls, stops at the first failing step and names it. `finally` steps (relock) run even after a failure. The default `write` step is function code 16, since Deye ignores 6 on its settings registers (measured live).

**Outcomes.** `verified`, `mismatch`, `unknown`, `partial`, and `unchanged` when the current value already equals the request and nothing was written.

- A recipe declares what to read back, which may differ from the register written. Silent ignores make read-back mandatory; a lint rejects a recipe without one unless the setting is declared write-only, which always reports `unknown`.
- A timeout is `unknown`, followed by a read-back attempt. It is never retried automatically, because a retry can double-apply a relative setting. A mismatch is shown as an error and not retried.
- There is no rollback; the device's state after `partial` is uncertain and the admin is told so.
- An unlock failure is never retried automatically.

**Audit.** Every attempt is appended to a write log: time, device, setting, value before, value requested, outcome, failing step, actor. It is kept long and not rolled up.

**Wear.** A profile declares each register's class (`persistent` or `volatile`) and a minimum interval between writes. A write whose value equals the current one is skipped.

**Secrets.** Unlock codes, passwords and tokens belong to a connection. A recipe refers to them by name. They never appear in a profile, a log, the write log or an API response; the API reports only set or not set.

**Who.** Only an authenticated admin, through the API. No integration commands a register. EVCC settings (ADR 10) are admin actions through this same funnel.

**No live control.** A recipe must set any revert timeout to none, and a lint rejects one that needs a refresher, naming the reason. A grid-feed limit with revert time 0 (Fronius `WMaxLimPct`) is a setting; a Sungrow external-EMS heartbeat is not.

**Composite settings.** `preset` is kept: each write goes through the funnel, outcomes are per write, no rollback. `snapshotToggle` is dropped for the first release: it is stateful, and closer to an automation. The official Deye profiles must be checked for it before this ADR is accepted.

## Considered options

- **Automatic retry on timeout.** Rejected for the double-apply risk.
- **Rollback.** Rejected: the core cannot know a half-configured device's state.
- **Writing without read-back.** Rejected: several vendors ignore bad writes without an error.

## Consequences

Setting changes are slow and visible. Features that need a control loop (battery dispatch from EVCC, price-driven charging) need their own ADR and a separate safety case.
