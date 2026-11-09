# Vendored anti-slop Oxlint plugin

Source: [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop), commit
`d2a9aea3b896ffcb291a85f2c1301aa2543ad8c8`, path `skills/install-anti-slop/assets/anti-slop`.
Installed by `.agents/skills/install-anti-slop/scripts/install.mjs`; the copied tree matched that commit
byte for byte.

## Installed paths

- `index.ts`: the generic plugin, registered in `.oxlintrc.json`.
- `rules/`, `shared/`: generic rules and helpers.
- `vendor/eslint-stylistic/`: vendored MIT rule with its `LICENSE` and `UPSTREAM.md`.

## Dependencies

`oxlint` and `@oxlint/plugins` pinned to the same exact version; upgrade both together.

## Local deviations

- `effect/` deleted: the Effect group is off (ADR 13) and the repo has no `effect` dependency.
- No rule source modified.

## Updating

Follow `.agents/skills/install-anti-slop/references/update.md`.
