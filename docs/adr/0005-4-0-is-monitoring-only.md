# 5. 4.0 is monitoring-only

Status: accepted (2026-11-01)

## Context

3.x writes registers from three places through one funnel (`apps/server/src/inverter/control-writer.ts`):
manual controls, the MQTT `/set` bridge and the peak-shaving loop. The loop writes persistent registers
(Deye 108, 109, 143, 145) every 30 s and nothing reverts them when SunReye stops. Some inverters offer a
native revert (Deye three-phase LV remote mode 1100/1101, SolaX `RemoteCtrlTimeOut`, Victron ESS Mode 3,
Fronius `*_RvrtTms`); the profiles model none of it. A tablet or a board on a microSD card goes silent
more often than a server.

## Decision

4.0 reads and never writes: no manual controls, no MQTT `/set`, no automation, no optimizer. EVCC is
read-only ingest. Transports are IP only: Modbus TCP, RTU-over-TCP and Solarman V5.

## Consequences

- Scope: live readings, history, statistics, MQTT/Home Assistant export, login with the public kiosk
  view, then prices and costs, forecast, EVCC, battery health and amortisation where they fit a target's
  budget.
- Control returns only with a dead-man's switch: inverter-side revert registers where the device has
  them, commands whose stuck state is safe otherwise. That is a decision of its own.
- ADR 0001 applies to 3.x only.
