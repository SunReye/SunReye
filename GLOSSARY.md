# SunReye

A local-first monitor for home solar, battery and meter hardware: it reads devices, stores history, shows it, and writes a device's settings on request.

## Plant and devices

**Plant**:
The one site being monitored. It has one timezone and one location, set by the admin.
_Avoid_: Site, installation, system

**Device**:
One physical or logical unit that produces readings: an inverter, a battery, a meter, a wallbox.
_Avoid_: Inverter (as the general term), asset

**Connection**:
How the core reaches one or more devices: an endpoint, broker or HTTP host, plus its credentials.
_Avoid_: Integration, source

**Endpoint**:
A request/response network address with its transport (Modbus TCP, RTU over TCP, Solarman). One task serialises all traffic to it, for every device behind it.
_Avoid_: Port, link

**Device address**:
Where a device sits behind its connection: a Modbus unit id, an EVCC loadpoint index or a topic root. It belongs to the device.
_Avoid_: Slave id

**Integration**:
An outbound adapter for a neighbour: the role endpoint, the MQTT publisher with Home Assistant discovery, the cloud relay.
_Avoid_: Connection, plugin

**Transport**:
The wire framing on an endpoint: Modbus TCP, RTU over TCP, Solarman V5, or `sim`.
_Avoid_: Protocol, driver

## Profiles

**Profile**:
A declarative file describing one device model: its quantities, how to read them and which settings it may write.
_Avoid_: Driver, template, map

**Official profile**:
A profile signed by the profile key and backed by a replayable capture of a real device. Its settings are `verified` one by one, once written on real hardware.
_Avoid_: Verified profile

**Community profile**:
Any other profile. It loads read-only until an admin enables a write.
_Avoid_: Custom profile, unofficial profile

**Index**:
A hosted `index.json` listing profiles with their hashes and signatures.
_Avoid_: Source, registry, repository

**Schema**:
The integer version of the profile format. The core supports the current schema and the previous one. It bumps only on a breaking change; additive features are capabilities.
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

**Series**:
One role at one index, such as `pv.mppt.power[2]`; an unindexed role is its own series. The key of storage, rollups and history reads.
_Avoid_: Channel, metric

**Change point**:
A stored value and the instant it began. History is a series of change points and gaps.
_Avoid_: Row, sample

**Interval**:
The span from one change point to the next change point or gap. Derived, never stored.
_Avoid_: Period

**Bucket**:
A 60 second slot aligned to the Unix epoch: the unit of a flush.
_Avoid_: Window, tick

**Rollup**:
An hourly (UTC hour) or daily (plant-local day) aggregate built from intervals.
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
A write the device reverts unless it is refreshed. Only a controller under a lease may use it.
_Avoid_: Remote control, setpoint

**Controller**:
A named automation that writes settings through the funnel. None exists in the first release.
_Avoid_: Automation engine, bot

**Lease**:
A controller's exclusive, revocable hold on the settings it controls.
_Avoid_: Lock, ownership

## Plant model

**Measurement point**:
A place in the plant where a device measures a flow, with a parent point. The root is the grid connection.
_Avoid_: Node, meter position

**MPPT input**:
One maximum-power-point tracker input of an inverter: the finest level at which PV is measured.
_Avoid_: PV1 (a vendor label), string

**String**:
Modules in series on one plane, wired to one MPPT input. Strings on one input are in parallel.
_Avoid_: Array, panel group

**Module type**:
The datasheet values of one PV module model.
_Avoid_: Panel model

**Computed device**:
A device whose readings the core computes or fetches instead of polling hardware: a tariff, a price feed, a forecast, the plant aggregates.
_Avoid_: Virtual device, coded device

**Forecast**:
A value issued at one time about a later target time.
_Avoid_: Prediction, projection

## Remote access

**Install id**:
The globally unique identity of one install, created at first run. One install is one plant.
_Avoid_: Plant id, serial

**Relay**:
The cloud service that carries encrypted traffic between a core and its paired clients without reading it.
_Avoid_: Cloud backend, proxy, tunnel server

**Account**:
A cloud identity, signed in by social login, that routes to installs and holds a passkey-wrapped key.
_Avoid_: User (a user is local), profile

**Device key**:
The X25519 key pair one browser or app generates, used as its Noise static key; the core trusts it when an account it trusts has signed it.
_Avoid_: Session key, token

**Share code**:
The code a business gives a homeowner to grant access; it carries the business key's fingerprint.
_Avoid_: Invite, referral

## Platform

**Feature module**:
A part of the core that owns its tables and is reached only through its interface: commands, queries and the events it publishes.
_Avoid_: Service, component

**Capability**:
A statement of what the core, a profile or a device supports, published in one document.
_Avoid_: Feature flag
