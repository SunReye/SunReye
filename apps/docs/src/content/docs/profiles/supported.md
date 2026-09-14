---
title: Supported Inverters
description: Which inverters SunReye ships support for, and how support grows.
---

Because inverters are [data, not code](/profiles/concept/), "supported" means "a profile
exists." The core ships **no** bundled profile — it's inverter-agnostic — and installs one
at runtime from a profile repository.

## The official profile repository

The [SunReye Official Profiles](https://github.com/SunReye/SunReye-Official-Profiles) repo
is baked in as a **default, protected source** (it can be disabled but not removed). On a
fresh install the admin browses it under **Settings → Profiles**, installs a profile, and
activates it. It currently includes the **Deye / Sunsynk** hybrid families, e.g.:

- `deye-sg05lp3` (SG05LP3, incl. 14/15/16/18/20K SKUs)
- `deye-sg01hp3` (SG01HP3 three-phase, incl. 5–25K SKUs)

A profile covers PV strings, battery, grid (per phase), backup load, generator, inverter
status/temperatures, and writable settings (charge/discharge currents, work mode, grid
charge, solar-sell, and a time-of-use schedule).

## Running without hardware

The core includes a generic, role-based **simulator**: any installed profile (or a bare
primitive set) produces plausible, energy-balanced, time-aware fake data — so you can try
SunReye before wiring up an inverter, with no profile-specific code.

## Fresh boot

With no profile installed yet, the server boots **onboarding-only** — that's the normal
first-run state, not a degraded one. Install a profile from the official source (or your
own) to bring the full dashboard online.

## Adding more

There are two ways support grows — both add **data**, never engine forks:

1. **Downloadable profiles** — browse and install profiles from git-hosted repositories at
   runtime, no redeploy. See [Distributing Profiles](/profiles/distribution/).
2. **Author your own** — describe any Modbus inverter with the typed profile SDK and either
   run it locally or publish it to a repo. See [Authoring a Profile](/profiles/authoring/).

If your inverter speaks Modbus TCP — natively, through an RS485 gateway as RTU-over-TCP, or
through the Solarman/IGEN WiFi logger stick it probably already has (port 8899) — and you
have its register map, you can write a profile for it. See the [Roadmap](/reference/roadmap/) for
what's planned around multi-inverter support and community profiles.
