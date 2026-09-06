---
title: REST API
description: The auto-generated /api/v1 integration surface, generated from the inverter profile.
---

SunReye exposes a stable, third-party integration API under **`/api/v1`**. It is
**auto-generated from the active inverter's profile** — the entity catalog, current state,
per-entity history, and one *validated* write route per writable entity all derive from the
manifest. Adding a metric or a whole new inverter extends this API with zero route code.

:::tip[OpenAPI docs]
Interactive docs (Scalar UI) are served at **`/openapi`**, and the raw spec at
**`/openapi/json`**. Every `/api/v1` route — including the per-entity write routes — appears
there with its exact request/response schema.
:::

## Authentication

The `/api/v1` surface is guarded by API keys. Two credential sources are accepted, and a
request is authorized if it matches **either**:

1. **Admin-managed keys** — issued per user from **Settings → API Keys** (admin only). These
   are stored hashed in the database, can be given an expiry, and can be revoked at any time.
   This is the recommended way to hand out access. See [Users & Roles](/use/users/) for who
   can manage them.
2. **Static keys** — the `API_KEYS` [environment variable](/reference/environment/)
   (comma-separated). Useful for a fixed, deploy-time key with no database.

Fail-open / fail-closed behavior governs the **static** list when no managed key is present:

- **No static keys + development** → open (fail-open, for convenience).
- **No static keys + production** → requests without a valid key are rejected with `401`
  (fail-closed). Managed keys are still accepted.
- **Static keys configured** → every request must present a valid static **or** managed key.

Pass the key as either header:

```http
Authorization: Bearer <your-key>
```
```http
X-API-Key: <your-key>
```

An invalid, expired, disabled, or missing key returns `401`.

### Issuing a managed key

1. Sign in as an admin and open **Settings → API Keys**.
2. Pick the owning user, give the key a name, optionally choose an expiry, and **Create**.
3. Copy the key from the dialog — the full value is shown **only once**. Afterwards only a
   short prefix is stored for identification.

Revoking a key (from the same screen) takes effect immediately: the next request using it
returns `401`.

## Endpoints

All paths are relative to the server base URL (e.g. `http://localhost:3000`).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/entities` | Full entity catalog — the discovery endpoint. Returns profile identity, capabilities, and every entity's metadata. |
| `GET` | `/api/v1/state` | Latest value of every entity from the live poll cache. `503` if no sample has been read yet. |
| `GET` | `/api/v1/entities/:key` | One entity's metadata plus its latest value (`null` if unread). `404` if the key is unknown. |
| `GET` | `/api/v1/entities/:key/history` | Time series for one entity. |
| `PUT` | `/api/v1/entities/:key` | Write a writable entity (validated). One such route exists **per writable entity**. |

Entity keys are dotted, e.g. `settings.battery.grid_charge`, and appear literally in the
path.

### Entity history query parameters

`GET /api/v1/entities/:key/history` accepts:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `hours` | number ≥ 1 | `24` | Look-back window. |
| `limit` | 1–50000 | `5000` | Max points. |
| `bucket` | `minute` \| `hour` \| `day` | — | If set, returns downsampled rollups. |
| `source` | string | primary device | `plant` for the whole plant (members summed by role; a per-device metric such as a voltage is refused with 422), or a device slug. |
| `inverterId` | string | — | Alias of `source` for one release; a device slug. |

With `bucket`, each point is `{ time, avg, max, min }`; without it, raw `{ time, value }`.

### Writes

Each writable entity gets a generated `PUT /api/v1/entities/:key` route whose body schema is
derived from the entity's constraint:

- **Enum entities** accept only their allowed literal values.
- **Numeric entities** accept a number bounded by the entity's `min` / `max`.

```bash
curl -X PUT http://localhost:3000/api/v1/entities/settings.battery.max_charge_current \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "value": 40 }'
```

Success returns `{ "ok": true, "key": "...", "value": 40 }`. A value outside the entity's
constraint is rejected with `422` and a validation detail; the same validation guards writes
from the dashboard and MQTT.

## Errors

The `/api/v1` surface normalizes errors:

| Status | Meaning |
| --- | --- |
| `401` | Missing/invalid API key (or unconfigured in production). |
| `404` | Unknown entity key. |
| `422` | Validation error (value out of range / not an allowed enum). |
| `503` | No live sample available yet. |
| `500` | Internal error (sanitized message). |

## Internal dashboard API

The dashboard uses a separate `/api/*` surface (session-authenticated; mutations are
admin-only). It is not part of the stable integration contract, but is documented in
[Architecture Deep-Dive](/reference/internals/) for contributors. Prefer `/api/v1` for
third-party integrations.
