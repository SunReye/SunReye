# SunReye

A local-first monitor for home solar, battery and meter hardware: it reads devices, stores history, shows it, and writes a device's settings on request.

## Plant and devices

**Plant**:
The one site being monitored. It has one timezone, set by the admin.
_Avoid_: Site, installation, system

**Device**:
One physical or logical unit that produces readings: an inverter, a battery, a meter, a wallbox.
_Avoid_: Inverter (as the general term), asset

**Connection**:
How the core reaches one or more devices: host, port, transport, unit id, credentials.
_Avoid_: Integration, source

**Endpoint**:
A request/response network address (Modbus TCP, RTU over TCP, Solarman). One task serialises all traffic to it.
_Avoid_: Port, link

**Transport**:
The wire framing on an endpoint: Modbus TCP, RTU over TCP, Solarman V5, or `sim`.
_Avoid_: Protocol, driver

## Profiles

**Profile**:
A declarative file describing one device model: its quantities, how to read them and which settings it may write.
_Avoid_: Driver, template, map

**Official profile**:
A profile signed by the project key and backed by a replayable capture of a real device.
_Avoid_: Verified profile

**Community profile**:
Any other profile. It loads read-only until an admin enables a write.
_Avoid_: Custom profile, unofficial profile

**Index**:
A hosted `index.json` listing profiles with their hashes and signatures.
_Avoid_: Source, registry, repository

**Schema**:
The integer version of the profile format. The core supports the current schema and the previous one.
_Avoid_: Profile version (a profile has its own semver)

**Read plan**:
The list of register blocks the core compiles from a profile at load time.
_Avoid_: Poll list

## Quantities and storage

**Role**:
A brand-neutral quantity name with a unit and a sign convention, such as `battery.power`.
_Avoid_: Metric, point, entity

**Reading**:
One decoded value of a role from a device at an instant.
_Avoid_: Sample, datapoint

**Interval**:
A stored row: one value held for a duration within one bucket.
_Avoid_: Row, sample

**Bucket**:
A 60 second slot aligned to the Unix epoch. No interval crosses a bucket boundary.
_Avoid_: Window, tick

**Rollup**:
An hourly or daily aggregate built from intervals.
_Avoid_: Aggregate, summary

**Deadband**:
The smallest change in a role's unit that is stored. The stored series is never wrong by more than this.
_Avoid_: Threshold, tolerance

## Settings

**Setting**:
A device parameter the core may write, declared by a profile.
_Avoid_: Control, command, parameter

**Recipe**:
The ordered steps that apply one setting.
_Avoid_: Script, macro

**Outcome**:
The result of a write: `verified`, `mismatch`, `unknown`, `partial`, or `unchanged` when no write was needed.
_Avoid_: Status, result

**Live control**:
A write the device reverts unless it is refreshed. Out of scope.
_Avoid_: Remote control, setpoint

## Platform

**Capability**:
A statement of what the core, a profile or a device supports, published in one document.
_Avoid_: Feature flag
