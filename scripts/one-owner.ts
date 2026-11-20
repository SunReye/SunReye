// A behaviour met on more than one screen lives in one component (ADR 21 "One behaviour, one
// component", #836): no file of the SPA outside its owner rebuilds a segmented control, tabs in
// another look, a haptic, a transition or a chart's entrance. A gate step;
// `bun scripts/one-owner.ts` lists the copies.

import { Glob } from "bun";

const LIB = "apps/web/src/lib/";

export interface Copy {
  readonly rule: string;
  readonly line: number;
}

interface Rule {
  readonly name: string;
  readonly found: RegExp;
  /** Paths under `lib/` that own the behaviour, as prefixes. */
  readonly owners: readonly string[];
  /** The file holds the shared piece itself, so the match is no copy. */
  readonly composes?: RegExp;
}

// Fired by the user's own gesture in places no shared component covers yet. The list only shrinks.
const HAPTICS_HELD = [
  "analytics/StringsPanel.svelte",
  "dashboard/CameraLock.svelte",
  "explore/",
  "forecast/LinePicker.svelte",
  "history/FigureTabs.svelte",
  "history/NotesCard.svelte",
  "history/PeaksCard.svelte",
  "settings/DisplaySettings.svelte",
  "settings/HapticsRow.svelte",
  "setup/",
  "shell/",
];

const RULES: readonly Rule[] = [
  {
    name: "toggle group outside the segmented control",
    found: /ui\/toggle-group/u,
    owners: [
      "components/",
      "gallery/",
      // Navigation, swatches, a list of paths and a debug overlay: none is a choice of a few words.
      "shell/Bar.svelte",
      "builder/ColourRow.svelte",
      "settings/ImportSources.svelte",
      "scene/PerfOverlay.svelte",
    ],
  },
  {
    name: "tabs list not segmented",
    found: /<Tabs\.List\b(?![^>]*variant="segmented")[^>]*>/u,
    owners: ["components/ui/", "gallery/"],
  },
  {
    name: "haptics outside a shared component",
    found: /from "[./#a-z]*haptics(?:\.ts)?"/u,
    owners: [
      "components/",
      "range/",
      "builder/",
      "feedback.ts",
      "controls/apply.ts",
      ...HAPTICS_HELD,
    ],
  },
  {
    name: "transition outside the motion modules",
    found: /from "svelte\/transition"/u,
    owners: [
      "motion.ts",
      "motion/",
      "shell/route-slide.ts",
      "detail/day-slide.ts",
      "components/ui/",
    ],
  },
  {
    name: "chart without the chart entrance",
    found: /<(?:Chart|BarChart|LineChart|AreaChart|canvas)\b/u,
    // The 3D scene's canvases are no chart.
    owners: [
      "components/ui/",
      "gallery/",
      "builder/SceneCanvas.svelte",
      "dashboard/SceneStandIn.svelte",
    ],
    composes: /\bChartEntrance\b/u,
  },
];

/** Whether the rules hold for this file: SPA source, not a test or a harness. */
function covered(path: string): boolean {
  return path.startsWith(LIB) && !/\.test\.ts$|\.harness\./u.test(path);
}

/** Every copy of an owned behaviour in one file. */
export function copies(path: string, source: string): Copy[] {
  if (!covered(path)) return [];

  const inLib = path.slice(LIB.length);

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a rule's patterns are only read.
  return RULES.flatMap((rule) => {
    if (rule.owners.some((owner) => inLib.startsWith(owner))) return [];

    if (rule.composes?.test(source) === true) return [];

    const match = rule.found.exec(source);

    return match
      ? [{ rule: rule.name, line: source.slice(0, match.index).split("\n").length }]
      : [];
  });
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  const paths = [...new Glob(`${LIB}**/*.{svelte,ts}`).scanSync(root)].toSorted();

  const sources = await Promise.all(paths.map((path) => Bun.file(`${root}${path}`).text()));

  const findings = paths.flatMap((path, index) =>
    copies(path, sources[index] ?? "").map((found) => `${path}:${found.line} ${found.rule}`),
  );

  for (const finding of findings) process.stderr.write(`${finding}\n`);

  if (findings.length > 0) {
    process.stderr.write(
      `\n${findings.length} copies of a shared behaviour: use its component (ADR 21, #836).\n`,
    );
    process.exitCode = 1;
  }
}
