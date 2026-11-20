# 26. Plant document and installer import

Status: accepted (2026-11-19)

## Context

A plant planned in SunReye Plan (ADR 25) should arrive in Home configured: the house, the modules, the strings and the devices. Only the installer or homeowner on site can enter how each device is reached. Home keeps its location rounded (ADR 17) and trusts nothing a browser computed (ADR 20).

## Decision

**Plant document.** One JSON document in the `pv` crate's schema family, with a `version`; the core refuses a version or a field it does not know. It holds:

- the plant's location, rounded to 0.01° as the core stores it (ADR 17). The address stays in Plan;
- module types, inverter types and battery types, copied by value (ADRs 17, 27);
- the PV layout with its scene (ADRs 17, 20);
- the devices: each a name, a kind, and its profile by id where one exists (ADR 5), never a connection, an address or a secret;
- optionally a tariff (ADR 12);
- credits: one line per open-data source the geometry was taken from, each its Land, licence and year.

**Unsigned.** A plant document is admin input. The core validates it exactly as it validates a layout, a scene and a tariff entered by hand, and it can do nothing the admin could not type. No key is added to ADR 8's.

**Import.** First-run setup offers "Import from installer" beside the setup scan (ADR 6); a plant with no devices and no layout may import later from the settings. The admin enters a handoff code or scans its QR code, and the core fetches the document over HTTPS from Plan, once, on that action; or the admin uploads the document as a file. Nothing is fetched on a timer. The import is one logged configuration change (ADR 19): it stores the location, the types, the devices and the layout, the layout applying from the instant of import.

**Handoff code.** Issued by a person in Plan for one design of one project. It is single-purpose, expires after 30 days and names no install. Plan logs every fetch.

**Pending device.** A device without a connection (ADR 6, amended). It has its id, name, kind and profile, so strings and equipment markers name it, and it is polled by nothing and stores nothing. The app shows it as waiting for its connection; giving it one makes it an ordinary device with the same id. A device whose inverter has no profile stays pending until a profile exists: it is planned, not yet monitorable (ADR 27).

**Credits.** The core stores the document's credits and the About page prints them, as the open-data licences require.

## Open before build

- The host the core fetches from, and whether a custom Plan host can be named.
- Whether a later design of the same project may be imported as a new layout version.
- The tariff's shape in the document once ADR 28 moves the arithmetic.

## Considered options

- **A signed document.** Rejected: it needs a key per installer organisation and a way for Home to trust it, to protect input the admin could enter by hand.
- **Delivery through the relay (ADR 16).** Rejected for now: the relay is not built, and a code over HTTPS needs none of it. "Share with my installer" arrives with the relay.
- **Devices as a to-do list.** Rejected: strings and equipment markers would have nothing to name.
- **The exact address in the document.** Rejected: Home needs no address; the scene is in metres from the house.
- **Connections in the document.** Rejected: an installer's cloud would hold a home's addresses and credentials.

## Consequences

The plant document is a published contract from its first version: Plan and every Home release must agree on it, so it is versioned and additive. A Home older than a document's version refuses it and says so.
