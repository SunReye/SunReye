# SunReye — deploy from published images

Runs SunReye using the container image built and pushed to GHCR by the CI
pipeline. No source checkout or local build required — just Docker.

One image, `ghcr.io/sunreye/sunreye-server`, is the whole application:

| what | how |
| --- | --- |
| dashboard | the SvelteKit build is embedded in the binary |
| REST API + OpenAPI + live socket | same process, same port |
| schema migrator | the same image, run as `migrate` |

It is a single compiled binary on an empty (`scratch`) filesystem — no shell, no
package manager, no JS runtime, ~35 MB — and multi-arch (`linux/amd64`,
`linux/arm64`). The separate `sunreye-web` and `sunreye-migrate` images are
retired; they cost a Node runtime and a 430 MB bun toolchain respectively, and
having one artifact is what makes schema-vs-code skew impossible.

## Quick start

```bash
cp .env.example .env
# edit .env — at minimum set BETTER_AUTH_SECRET and POSTGRES_PASSWORD
docker compose up -d
```

Everything is on <http://localhost:3000> — dashboard, API and OpenAPI docs.

> The embedded dashboard is the **hash-router** build (the same one the Home
> Assistant addon serves, so it survives a reverse-proxy path prefix). Routes
> therefore read `http://localhost:3000/#/statistics`.

Defaults to a simulated inverter (`INVERTER_SIMULATE=true`), so it runs with no
hardware. Point it at a real inverter by setting `INVERTER_SIMULATE=false` and
the `INVERTER_HOST` / `INVERTER_PORT` / `INVERTER_UNIT_ID` values.

## Pinning a version

`SUNREYE_TAG` selects the image tag (default `latest`):

```bash
SUNREYE_TAG=v1.2.3 docker compose up -d
```

> Keep the compose file and the image tag from the same era. This compose file
> runs migrations as `sunreye-server migrate`, which only exists in releases
> that ship the argv dispatcher; against an older tag that argument is ignored
> and the container boots a *second server* instead of migrating. It also
> healthchecks with `/app/server --healthcheck`, which older images lack. Either
> upgrade the tag or check out the matching older compose file.

## Database schema

Handled automatically. A one-shot **`migrate`** service — the server image with
`command: ["migrate"]` — runs the journaled migration runner against the
database, and the `server` waits for it to finish
(`service_completed_successfully`) before starting. No repo checkout or manual
step needed.

It re-runs safely on every `docker compose up` (applied migrations are skipped
via the journal), so bumping `SUNREYE_TAG` to a newer release brings the schema
forward automatically. Databases created by older releases (the pre-journal
`db:push` era) are baselined in place on the first run. The runner refuses to
run an older release against a database migrated by a newer one — restore a
backup to downgrade. A failed migration exits non-zero with the cause in
`docker compose logs migrate`, and the server never starts. Data persists in
the `sunreye_pg` volume across restarts.

## Notes

- **Leave `CORS_ORIGIN` unset.** The dashboard is served by the server itself,
  so this stack is same-origin and browsers enforce that for you. Set it only if
  you serve the dashboard from a different host.
- **Set `TZ`.** Days, months and tariff-band boundaries are cut in the server's
  local clock; left on UTC, a peak-rate evening lands on the following day.
- The image has no shell or curl, so the server probes *itself*:
  `/app/server --healthcheck` fetches `/healthz`, which round-trips the
  database. That is the healthcheck compose uses, and dependents can rely on
  `service_healthy`.
- Pulling private GHCR packages requires `docker login ghcr.io` first. If the
  packages are public, no login is needed.
