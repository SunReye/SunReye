# SunReye

SunReye reads home solar inverters, batteries and meters over the local network, keeps their history, and shows it on a dashboard without a cloud.

## Plant and devices

**Plant**:
The installation at one site: its devices and the figures they add up to.
_Avoid_: site, system, installation

**Device**:
One inverter, battery, meter or other unit SunReye reads, described by a profile.
_Avoid_: inverter (for any device), unit

**Connection**:
The network path to one or more devices: host, port and transport.
_Avoid_: endpoint, link

**Transport**:
The framing a connection speaks: Modbus TCP, Modbus RTU over TCP, or Solarman V5.
_Avoid_: protocol

**Logger**:
The box between the network and a device's serial port: a Solarman stick or a Modbus gateway.
_Avoid_: dongle, Wi-Fi stick

**Profile**:
The data describing one device model's registers and how to decode them.
_Avoid_: driver, register map, definition

**Profile source**:
A base URL and path to an index of profiles.
_Avoid_: profile repo, registry

**Role**:
What a reading means in the plant (PV power, grid import, battery state of charge), independent of device model.
_Avoid_: channel, signal

## Data

**Reading**:
One decoded value from one device at one instant.
_Avoid_: sample, data point, measurement

**Metric**:
The named quantity a reading measures.
_Avoid_: key, field, sensor

**Gauge**:
A metric that states a level at an instant, such as power or state of charge.
_Avoid_: instantaneous value

**Counter**:
A metric that only grows, such as lifetime energy, until the device restarts it.
_Avoid_: total, accumulator

**Tier**:
One resolution of stored history: raw, minute, hourly or daily.
_Avoid_: level, granularity

**Rollup**:
A UTC bucket of one tier computed from the tier below: its time-weighted average, max and min, for gauges
and counters alike. A counter's delta is computed when statistics are read.
_Avoid_: aggregate, continuous aggregate, summary

**Retention**:
How long a tier is kept before its oldest buckets are dropped.
_Avoid_: TTL, expiry

**Plant time zone**:
The time zone statistics days, months and years are cut in, from hourly rollups; it labels rollup buckets,
which are UTC.
_Avoid_: local time, server time

**Display time zone**:
The time zone a viewer renders times in; never moves a bucket.
_Avoid_: user time zone

**Archive**:
The portable export of a plant: its configuration and its readings in every tier. The format for backups and for moving between editions.
_Avoid_: backup file, dump, export

## Product

**Core**:
The Rust program that polls devices, stores readings, computes rollups and serves the web app; the same program on every target.
_Avoid_: server, backend, engine (the 3.x TypeScript program)

**Target**:
A platform the core is built for: Linux or Android.
_Avoid_: platform, host

**Edition**:
A way SunReye ships to a user: the Home Assistant add-on, the Docker image, the NixOS appliance or the Android app.
_Avoid_: flavour, distribution, variant

**Capability**:
A feature the running core reports it provides; the web app hides what is absent.
_Avoid_: feature flag

**Account**:
A person who signs in to the core. Only an admin account changes settings; the first account is one.
_Avoid_: user role (a role is a reading's meaning)

**API key**:
A secret starting `sunreye_` that an admin issues to an account for an integration; it opens `/api/v1` and nothing else.
_Avoid_: token, access key

**Kiosk view**:
The public read-only dashboard for wall displays.
_Avoid_: public dashboard, wall mode

**Budget**:
The memory, binary size and CPU ceilings a target's build must stay within.
_Avoid_: limit, quota

**Soak**:
A long, unattended, read-only run against a plant that proves the core stays within budget and loses no readings.
_Avoid_: burn-in, endurance test

**Oracle fixture**:
A recorded input together with the output the 3.x engine produced for it; the only source of golden values.
_Avoid_: golden file, snapshot, test vector

**Control**:
Writing registers to change how a device behaves. Not part of 4.0.
_Avoid_: steering, automation (the 3.x feature that used it)
