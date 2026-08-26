/**
 * Scaffold a new profile-authoring project: the layout an author works in to
 * define profiles as code and then `profile build` into an installable repo.
 * Pure — returns the file set as data; the CLI (`cmdInit`) decides where to
 * write it and whether to install deps / init git.
 */

export interface InitOptions {
  /** package.json `name` for the authoring project. */
  packageName: string;
  /** Display name baked into the `build` script (becomes `index.json.name`). */
  repoName: string;
  /** Optional maintainer baked into the `build` script (`index.json.maintainer`). */
  maintainer?: string;
  /** The starter profile stub written to `src/profiles.ts`. */
  profile: { id: string; name: string; manufacturer: string };
  /** Version of `@sunreye/profile-sdk` to depend on (usually the running CLI's). */
  sdkVersion: string;
}

/**
 * Build the file set for a new authoring project. Keys are repo-relative paths;
 * values are file contents (each newline-terminated to match `buildRepo`).
 */
export function scaffoldProject(opts: InitOptions): Record<string, string> {
  const { packageName, repoName, maintainer, profile, sdkVersion } = opts;
  const esc = (s: string) => s.replace(/"/g, '\\"');
  const buildCmd =
    `profile build ./src/profiles.ts --out . --name "${esc(repoName)}"` +
    (maintainer ? ` --maintainer "${esc(maintainer)}"` : "");

  const pkg = {
    name: packageName,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      build: buildCmd,
    },
    devDependencies: {
      "@sunreye/profile-sdk": `^${sdkVersion}`,
      "@types/bun": "latest",
      typescript: "^5",
    },
  };

  const tsconfig = {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: ["bun"],
    },
    include: ["src"],
  };

  return {
    "package.json": `${JSON.stringify(pkg, null, 2)}\n`,
    "tsconfig.json": `${JSON.stringify(tsconfig, null, 2)}\n`,
    ".gitignore": ["node_modules", "*.log", ""].join("\n"),
    "README.md": readmeTemplate(packageName, repoName),
    "src/profiles.ts": profilesTemplate(profile),
    // Cross-tool AI guidance (AGENTS.md + a CLAUDE.md that imports it).
    ...Object.fromEntries(aiGuideFiles().map((f) => [f.path, f.contents])),
  };
}

/**
 * How `profile upgrade` treats an existing copy of a managed guide file:
 * - `managed`       — fully ours (`AGENTS.md`); a local edit is "diverged" and
 *   only overwritten with `--force`.
 * - `ensure-import` — we only need the file to *contain* our content (the
 *   `CLAUDE.md` → `@AGENTS.md` import); a richer user file is left untouched.
 *
 * @internal
 */
export interface GuideFile {
  path: string;
  contents: string;
  mode: "managed" | "ensure-import";
}

/**
 * The cross-tool AI authoring guide dropped into a project: `AGENTS.md` (the
 * portable standard every assistant reads) plus a one-line `CLAUDE.md` that
 * imports it, since Claude Code reads `CLAUDE.md`, not `AGENTS.md`. Shared by
 * {@link scaffoldProject} and `profile upgrade` so both stay in sync.
 */
export function aiGuideFiles(): GuideFile[] {
  return [
    { path: "AGENTS.md", contents: agentsTemplate(), mode: "managed" },
    { path: "CLAUDE.md", contents: "@AGENTS.md\n", mode: "ensure-import" },
  ];
}

export type UpgradeStatus =
  /** File was absent — written fresh. */
  | "created"
  /** Managed file differed and `--force` overwrote it. */
  | "updated"
  /** Already current (managed match, or import already present). */
  | "unchanged"
  /** Managed file has local edits; left as-is (re-run with `--force`). */
  | "diverged"
  /** `CLAUDE.md` exists without the `@AGENTS.md` import; the author must add it. */
  | "manual";

export interface UpgradeAction {
  path: string;
  status: UpgradeStatus;
  /** Contents to write, or `null` to leave the file untouched. */
  write: string | null;
}

/**
 * Decide what `profile upgrade` should do for each managed guide file, given
 * the current on-disk contents (`null` = absent) and whether `--force` is set.
 * Pure, so the policy is unit-tested without touching the filesystem.
 */
export function planUpgrade(
  existing: Record<string, string | null>,
  force: boolean,
): UpgradeAction[] {
  return aiGuideFiles().map((f) => {
    const current = existing[f.path] ?? null;
    if (current === null) return { path: f.path, status: "created", write: f.contents };
    if (f.mode === "ensure-import") {
      return current.includes(f.contents.trim())
        ? { path: f.path, status: "unchanged", write: null }
        : { path: f.path, status: "manual", write: null };
    }
    if (current === f.contents) return { path: f.path, status: "unchanged", write: null };
    return force
      ? { path: f.path, status: "updated", write: f.contents }
      : { path: f.path, status: "diverged", write: null };
  });
}

/**
 * Derive a safe JS identifier from a profile id, e.g. `acme-hybrid` → `acmeHybrid`.
 *
 * @internal
 */
export function toIdentifier(id: string): string {
  const parts = id.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "profile";
  const camel =
    parts[0]!.replace(/^[0-9]+/, "") +
    parts
      .slice(1)
      .map((p) => p[0]!.toUpperCase() + p.slice(1))
      .join("");
  return /^[a-zA-Z_$]/.test(camel) ? camel : `p${camel}`;
}

/** Title-case a profile id for a default display name, e.g. `acme-hybrid` → `Acme Hybrid`. */
export function titleFromId(id: string): string {
  const words = id
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1));
  return words.length > 0 ? words.join(" ") : id;
}

function profilesTemplate(profile: InitOptions["profile"]): string {
  const ident = toIdentifier(profile.id);
  const modelId = `${profile.id}-lite`;
  return [
    `import { defineFamily, metric } from "@sunreye/profile-sdk";`,
    ``,
    `// A family = one shared register map + per-model tweaks. Picking a role forces`,
    `// you to supply exactly what that role needs, or this won't compile. Each entry`,
    `// in 'models' becomes its own self-contained profile (keyed by its id), so a`,
    `// user picks their exact model in the UI and its limits follow. Run`,
    `// 'bun run build' to emit an installable repo (index.json + profiles/*.json).`,
    `//`,
    `// defineFamily returns [base, ...models]; exporting it lets 'profile build' pick`,
    `// up every profile at once.`,
    `export const ${ident} = defineFamily({`,
    `  id: ${JSON.stringify(profile.id)},`,
    `  name: ${JSON.stringify(profile.name)},`,
    `  manufacturer: ${JSON.stringify(profile.manufacturer)},`,
    `  version: "0.1.0",`,
    `  metrics: [`,
    `    metric("dc/pv1/power", {`,
    `      label: "PV1 Power",`,
    `      group: "solar",`,
    `      role: "pv.string.power",`,
    `      index: 1,`,
    `      addr: 672,`,
    `      unit: "W",`,
    `    }),`,
    `    metric("dc/pv2/power", {`,
    `      label: "PV2 Power",`,
    `      group: "solar",`,
    `      role: "pv.string.power",`,
    `      index: 2,`,
    `      addr: 673,`,
    `      unit: "W",`,
    `    }),`,
    `    metric("battery/soc", {`,
    `      label: "Battery SoC",`,
    `      group: "battery",`,
    `      role: "battery.soc",`,
    `      addr: 588,`,
    `      unit: "%",`,
    `    }),`,
    `    metric("settings/battery/maximum_discharge_current", {`,
    `      label: "Max battery discharge current",`,
    `      group: "settings",`,
    `      role: "setting.battery.max_discharge_current",`,
    `      access: "rw",`,
    `      addr: 109,`,
    `      unit: "A",`,
    `      range: { min: 0, max: 300 }, // generic ceiling; models tighten it below`,
    `    }),`,
    `  ],`,
    `  // Keys autocomplete from the base map; a mistyped patch/remove target`,
    `  // throws when you 'bun run build'.`,
    `  models: {`,
    `    // A smaller SKU: one PV string, a lower discharge ceiling.`,
    `    ${JSON.stringify(modelId)}: {`,
    `      name: ${JSON.stringify(`${profile.name} Lite`)},`,
    `      metrics: {`,
    `        "dc.pv2.power": null, // drop a PV string -> capabilities show 1`,
    `        "settings.battery.maximum_discharge_current": { max: 120 }, // 0-120 A slider + write clamp`,
    `      },`,
    `    },`,
    `  },`,
    `});`,
    ``,
  ].join("\n");
}

function readmeTemplate(packageName: string, repoName: string): string {
  return [
    `# ${repoName}`,
    ``,
    `SunReye inverter profiles authored with [\`@sunreye/profile-sdk\`](https://github.com/SunReye/SunReye/tree/master/packages/profile-sdk).`,
    ``,
    `## Develop`,
    ``,
    "```sh",
    `bun install`,
    `bun run build   # validate every profile in src/profiles.ts and emit index.json + profiles/*.json`,
    "```",
    ``,
    `Edit \`src/profiles.ts\` — every profile you export is picked up, including each`,
    `model of a \`defineFamily(...)\` (one self-contained profile per SKU). \`bun run build\``,
    `validates them and writes the installable repo layout into this directory.`,
    ``,
    `## Publish`,
    ``,
    `Commit \`index.json\` and \`profiles/*.json\`, push to a public git repo, then install`,
    `it in SunReye from Settings → Profiles.`,
    ``,
    `## AI-assisted authoring`,
    ``,
    `This project ships an AI authoring guide in \`AGENTS.md\` (with a \`CLAUDE.md\` that imports`,
    `it, so Claude Code reads it too). Open the folder in any AI coding assistant — Claude`,
    `Code, Cursor, Copilot — and ask it to *"help me create a profile for my <make> <model>"*.`,
    `It walks you through mapping your inverter's register map to metrics, assigning roles, and`,
    `building the repo. Have your vendor Modbus register map ready.`,
    ``,
    `_Scaffolded by \`profile init\` into \`${packageName}\`._`,
    ``,
  ].join("\n");
}

/**
 * A self-contained, cross-tool AI guide written to the scaffolded project's
 * `AGENTS.md` (the portable standard any assistant reads; `CLAUDE.md` imports
 * it). Kept accurate to the SDK surface (roles, `metric`, `computeExpr`/`sumOf`,
 * families) so the agent needn't fetch docs to be useful, with links for the
 * full reference.
 */
function agentsTemplate(): string {
  return [
    "# Authoring SunReye inverter profiles",
    "",
    "This repository defines SunReye inverter profiles as typed code with",
    "`@sunreye/profile-sdk` and builds them into an installable profile repo. When the user",
    "asks to **create, add, extend, or debug a profile for their inverter** (Deye, Sunsynk,",
    "Growatt, SMA, Victron, …), follow this guide.",
    "",
    "You are helping someone describe their inverter to SunReye **as typed code** with",
    "`@sunreye/profile-sdk`, then compile it to a validated, installable profile repo. A",
    "profile is **pure data** — it can never execute code — and the SDK makes it *correct by",
    "construction*: pick a role and the types force exactly the fields that role needs, or it",
    "won't compile.",
    "",
    "## Get these from the user first",
    "",
    "1. **Make & model**, e.g. `Deye SUN-12K-SG04LP3`.",
    "2. **The vendor Modbus/holding-register map** — a PDF/CSV of register address, name,",
    "   unit, scale, and data type. This is the most important input; without it you are",
    "   guessing. Ask for it. Vendors often publish one, and community maps exist for common",
    "   brands.",
    "3. **Which values matter** to them (solar, battery, grid, load, key settings) so you map",
    "   the roles the UI renders before diagnostic extras.",
    "",
    "**Never invent register addresses.** If an address is unknown, leave the metric out — a",
    "wrong address ships a wrong number. Where the user has a live reading, sanity-check your",
    "`scale`/`offset` against it.",
    "",
    "## Workflow",
    "",
    '1. (Optional) `bunx profile scaffold ./registers.csv --id <id> --name "<Name>" --manufacturer <M>`',
    "   turns a register CSV into a starter `ProfileData` with roles left blank. Columns:",
    "   `topic,label,unit,group,addr,type,scale,access` (order-independent; `topic` required;",
    "   multi-register `addr` is `|`-separated).",
    "2. Edit `src/profiles.ts`: one `metric(topic, opts)` per register, assigning a **role**",
    "   wherever SunReye should render it.",
    "3. Add **computed** metrics (totals, efficiency) with `computeExpr` / `sumOf`.",
    "4. If the vendor ships several SKUs on one register map, author a `defineFamily` with a",
    "   per-model overlay instead of copying the map.",
    "5. Run `bun run build` (or `bunx profile validate` / `bunx profile coverage`) until it",
    "   validates and covers the roles the user cares about.",
    "6. Commit `index.json` + `profiles/*.json`, push to a public git repo, install from",
    "   SunReye → Settings → Profiles.",
    "",
    "## Defining a metric",
    "",
    "```ts",
    'import { defineProfile, metric, sumOf } from "@sunreye/profile-sdk";',
    "",
    'metric("dc/pv1/power", {',
    '  label: "PV1 Power", group: "solar", unit: "W",',
    '  role: "pv.string.power", index: 1,   // indexed role → index required',
    "  addr: 672,                            // holding-register address",
    "});",
    "```",
    "",
    "`metric(topic, opts)` derives the entity `key` from the topic (`dc/pv1/power` →",
    "`dc.pv1.power`) and defaults `type` (`U_WORD`), `scale` (`1`), `access` (`r`), `unit`",
    "(`null`).",
    "",
    "### Roles force their shape",
    "",
    "The `role` is the inverter-agnostic concept the UI renders against. Choosing one narrows",
    "the required fields:",
    "",
    "- **indexed** role (`pv.string.power`, `grid.phase.power`, …) → `index` required (1-based).",
    "- **enum/status** role (`inverter.status`, `setting.battery.grid_charge`, …) → `enumLabels`",
    '  required (`{ 0: "Off", 1: "On" }`).',
    '- **writable setting** role (`setting.*`) → `access: "rw"` required.',
    "",
    "Omit any and it's a compile error. A metric with **no role** is allowed — a diagnostic",
    "value that just isn't rendered by role. See the full catalog of role names and their",
    "expected units in the concept doc (link below), or run `bunx profile coverage` to see",
    "which roles you've mapped and which are missing.",
    "",
    "### House load vs. backup output",
    "",
    "`load.*` is **whole-house consumption**, wherever your device measures it: a hybrid's",
    "load output, a grid-tied plant's consumption meter, or a computed residual. It says",
    "nothing about a UPS.",
    "",
    "The islanded (EPS/backup) output is hardware, so the profile states it:",
    "",
    "```ts",
    "defineProfile({",
    '  id: "acme-hybrid", name: "ACME Hybrid", manufacturer: "ACME", version: "1.0.0",',
    "  declares: { backupOutput: true },   // renders the Backup section",
    "  metrics,",
    "});",
    "```",
    "",
    "Map the `backup.*` roles **only** when the output is metered separately from the house",
    "(a critical-loads sub-panel). On a whole-home UPS the two are the same registers —",
    "map them as `load.*` and declare the output.",
    "",
    "### Registers & encoding gotchas",
    "",
    "- `U_WORD`/`S_WORD` → one address; `U_DWORD` → `[low, high]`; `RAW` → N words.",
    "- `scale` multiplies the raw value; `offset` is added **after** scaling",
    "  (`raw * scale + offset`).",
    "- Watch vendor encodings. Example: a temperature stored as °C×10 + 1000 decodes with",
    "  `scale: 0.1, offset: -100` (raw 1250 → 25 °C).",
    "- A value that flows both ways (battery charge/discharge, grid import/export) is usually",
    '  `type: "S_WORD"` with a `flow: { positive: "Discharging", negative: "Charging" }` label.',
    "",
    "## Computed metrics",
    "",
    "Derived values use a small **closed** set — never arbitrary code — and carry no `addr`:",
    "",
    "| Expression | Meaning |",
    "| --- | --- |",
    '| `{ sum: ["a", "b"] }` | add the listed keys |',
    '| `{ diff: ["a", "b"] }` | `a − b` |',
    '| `{ scale: ["a", k] }` | `a × k` |',
    "| `{ combine: { add: [...], sub: [...] } }` | Σadd − Σsub (`sub` optional) |",
    "| `{ ratio: { num: [...], den: [...], scale? } }` | (Σnum / Σden) × scale; zero den reads 0 |",
    "",
    "A missing referenced key reads as `0`; a computed metric may only reference metrics defined",
    "**earlier** in the list.",
    "",
    "### Prefer `sumOf` for homogeneous totals",
    "",
    "A hand-listed `sum` drifts the moment a model adds or drops a member. `sumOf` declares the",
    "**intent** once and resolves it to a concrete `{ sum: [...] }` against the final metric set",
    "at build time:",
    "",
    "```ts",
    'metric("dc/total_power", {',
    '  label: "PV Total", group: "solar", unit: "W", role: "pv.total.power",',
    '  computeExpr: sumOf({ role: "pv.string.power" }),   // every PV-string power',
    "});",
    '// also: sumOf({ keyPrefix: "battery.bank" })  — exact key + every `${prefix}.` child',
    "```",
    "",
    "Matching zero metrics is a **build error** (never a silent empty sum). In a family it",
    "self-heals: a model that drops a string re-derives the correct total with no per-model",
    "patch.",
    "",
    "## Families (multi-SKU)",
    "",
    "`defineFamily({ id, name, manufacturer, version, metrics, models })` shares one register",
    "map and returns `[base, ...models]` — the generic base plus one self-contained profile per",
    "SKU. Each `models[id].metrics` overlay is keyed by canonical metric key, one rule per",
    "entry:",
    "",
    "| Entry | Effect |",
    "| --- | --- |",
    '| `"key": { max: 280 }` (or any `metric()` field) | **patch** — merge fields; `min`/`max` set `range` |',
    '| `"key": null` | **remove** that metric |',
    '| `"prefix.*": null` | **remove** every metric under the prefix (a whole PV string) |',
    '| `"new.key": { …full definition… }` | **add** a metric |',
    "",
    "Keys autocomplete from the base map; a mistyped patch/remove target throws at build time.",
    "**Removing a metric another one references is reconciled automatically:** a removed key in",
    "a variadic compute list (`sum`, `combine.add`/`sub`, `ratio.num`/`den`) is pruned, while a",
    "removed key in a fixed-arity expr (`diff`/`scale`), one that would empty a required list,",
    "or a control target, throws — naming both metrics — rather than shipping a wrong value.",
    "Pair with `sumOf` and the base needs no explicit key list at all.",
    "",
    "## Versioning (SDK-managed)",
    "",
    "`profile build` owns version numbers so you don't have to hand-bump every SKU. On each",
    "build it fingerprints every profile's content and diffs it against the previously built",
    "`profiles/*.json`:",
    "",
    "- **Content changed** → the profile is auto-bumped (patch by default; `--bump minor|major`",
    "  for the whole build). A change to one family model bumps only that model, never its siblings.",
    "- **Content unchanged** → the published version is kept as-is.",
    "- The `version` you pass to `defineProfile`/`defineFamily` is just the **initial seed / floor**.",
    "  To cut an intentional minor/major, raise it *above* the current published version and the",
    "  build honors it (`author-bumped`); otherwise leave it and let the SDK increment.",
    "",
    "So **commit the built `index.json` + `profiles/*.json`** — they're the baseline the next",
    "build diffs against. A content change against a non-semver published version fails the build",
    "(set a semver version to enable auto-bumping).",
    "",
    "## Validate, score, ship",
    "",
    "- `bunx profile validate <file>` — strict schema + semantic lints, non-zero exit on failure.",
    "- `bunx profile coverage <file>` — how many canonical roles are mapped and which are missing.",
    "- `bun run build` — validate everything and emit the installable repo (`index.json` +",
    "  `profiles/*.json`).",
    "- In a test, `exerciseProfile(profile)` runs it end to end offline (validate → hydrate →",
    "  manifest → capabilities → one simulated sample) — assert identity/capabilities with zero",
    "  hardware.",
    "",
    "## References",
    "",
    "- Authoring guide: https://sunreye.github.io/SunReye/profiles/authoring/",
    "- Roles & concepts (full role catalog): https://sunreye.github.io/SunReye/profiles/concept/",
    "- Distribution: https://sunreye.github.io/SunReye/profiles/distribution/",
    "",
  ].join("\n");
}
