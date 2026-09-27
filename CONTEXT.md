# SunReye

A self-hosted monitor and controller for a home energy plant: it polls grid-tied inverters, batteries and chargers, keeps their history, prices it, and writes setpoints back.

## Language

### The plant and what it is made of

**Plant**:
The one installation SunReye watches and controls — its site, tariff, time zone and every device behind it. SunReye watches one; during first run there is none yet.
_Avoid_: site, system, installation

**Device**:
One physical or logical machine in the plant that has readings of its own, named by a stable slug. Controllers and gateways are devices too.
_Avoid_: inverter (for the general case), unit, node

**Role**:
What a device is to the plant — inverter, battery, controller, meter, loadpoint. The role decides whether its readings are summed into a plant total or are the total.
_Avoid_: type, class

**Retired device**:
A device that is no longer polled but keeps its history and its slug. Distinct from a deleted device, which only exists for a device that never recorded a reading.
_Avoid_: disabled, archived

**Roster**:
The plant's current list of devices, grouped by the connection they are reached through.
_Avoid_: device list, inventory

**Connection**:
An endpoint the plant reaches devices through — a Modbus gateway, a Solarman logger stick, an MQTT broker. One connection can carry many devices.
_Avoid_: transport (for the endpoint itself), link

**Transport**:
The framing spoken over a connection — Modbus TCP, RTU over TCP, Solarman V5.
_Avoid_: protocol, connection

**Unit id**:
Which device behind a connection a request addresses. It belongs to the connection, not the machine: the same inverter can answer as different unit ids through different connections.
_Avoid_: slave id, address

**Integration**:
A link to another system that runs over a connection or needs none — the Home Assistant export, an EVCC ingest.
_Avoid_: plugin, add-on

**Profile**:
The register map that describes how to talk to one model of device. A device outlives the profile that describes it.
_Avoid_: driver, definition

### Reading the plant

**Source**:
Whose readings a view shows: the plant as a whole, or one device by slug.
_Avoid_: target, scope (for this)

**Reading**:
One sampled value of one metric from one device at one instant.
_Avoid_: sample, datapoint, measurement

**Counter**:
A cumulative reading that only grows (energy totals); energy over a window is the difference between two counter readings, and a counter restart is not negative energy.
_Avoid_: meter reading, total

### Time

**Plant zone**:
The time zone the plant's days, months and tariff windows are counted in. Every bucket, day boundary and daily total uses it.
_Avoid_: server time zone, local time

**Display zone**:
The time zone a viewer's clock labels are drawn in. It never moves a bucket.
_Avoid_: plant zone, user time zone

**Plant day**:
The span from one plant-zone midnight to the next — 23 or 25 hours on the days the clocks change.
_Avoid_: calendar day, 24 hours

### Control

**Automation**:
A rule that decides setpoints from readings, forecast and prices, and writes them to a device.
_Avoid_: script, job

**Peak shaving**:
The automation that steers battery charge current so grid export stays under a cap, and so charging lands in the hours of surplus or of cheap and negative prices.
_Avoid_: export limiting

**Setpoint**:
A value SunReye writes to a device register to change what it does.
_Avoid_: command, control value
