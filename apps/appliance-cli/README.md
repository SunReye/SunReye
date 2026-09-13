# `sunreye-setup`

The appliance's configuration CLI. It edits `/etc/nixos/site.json` — the single
JSON document the box's own flake reads — and then rebuilds.

It lives in the monorepo rather than in `nixos/` for two reasons. The TDD gate
(`scripts/require-tests.ts`) treats `apps/*/src/**` as source, so a behaviour
change here cannot land without a test; and `bun build --compile` fetches the
target runtime at build time, which the Nix sandbox forbids, so the Nix side
wraps these sources with `pkgs.bun` instead of packaging a binary.

Everything that touches the world — reading and writing `site.json`, running
`nixos-rebuild`, asking whether a time zone exists — is injected (see the `Io`
type in `src/main.ts`), so the suite never rebuilds a system.
