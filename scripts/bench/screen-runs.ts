// fallow-ignore-file coverage-gaps -- opens screens on a live core; run by hand with `bun run bench`.
// Opening the screens once cold and 30 times warm (ADR 24), each read timed and kept by route.

import type { Core } from "./http.ts";
import { type Body, type Plant, pointsOf, type Read, type Screen } from "./reads.ts";
import { BUDGETS, measured, p95, route, type Row, slowest, type Timing } from "./report.ts";
import { SCREENS } from "./screens.ts";
import { log } from "./store.ts";

const WARM = 30;

/** Requests a browser has in flight to one host over HTTP/1.1. */
const CONCURRENCY = 6;

/** One screen opened. */
interface Opened {
  readonly ms: number;
  readonly reads: readonly Timing[];
  readonly errors: readonly string[];
  /** Data reads answered with no points, by route. */
  readonly empty: readonly string[];
}

type Task = () => Promise<Body>;

/** Runs tasks at most `n` at a time. */
function limiter(n: number): (task: Task) => Promise<Body> {
  let active = 0;
  const waiting: (() => void)[] = [];

  const limited = async (task: Task): Promise<Body> => {
    if (active >= n) {
      await new Promise<void>((resume) => {
        waiting.push(resume);
      });

      return limited(task);
    }

    active += 1;

    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };

  return limited;
}

/** Whether a history, statistics or forecasts read found nothing in its range. */
const noPoints = (path: string, body: string): boolean =>
  path.startsWith("/api/v1/devices/") && pointsOf(body).length === 0;

async function open(core: Core, screen: Screen, plant: Plant): Promise<Opened> {
  const limit = limiter(CONCURRENCY);
  const [reads, errors, empty]: [Timing[], string[], string[]] = [[], [], []];

  const read: Read = (path) =>
    limit(async () => {
      const answer = await core.time({ path });

      reads.push({ path, ms: answer.ms });

      if (answer.error !== null) errors.push(answer.error);
      else if (noPoints(path, answer.body)) empty.push(route(path));

      return answer.error === null ? answer.body : null;
    });

  const began = performance.now();

  await screen.open(read, plant);

  return { ms: performance.now() - began, reads, errors, empty };
}

/** Waits, if need be, before the next open. */
export type Pause = () => Promise<void>;

const noPause: Pause = async () => {};

/** Opens each of `screens` after the last: concurrent opens would share the CPU. */
async function inTurn(
  core: Core,
  screens: readonly Screen[],
  plant: Plant,
  pause: Pause,
): Promise<Opened[]> {
  const [screen, ...rest] = screens;

  if (screen === undefined) return [];

  await pause();

  const opened = await open(core, screen, plant);

  return [opened, ...(await inTurn(core, rest, plant, pause))];
}

function failure(opened: readonly Opened[]): string | null {
  const errors = opened.flatMap((o) => o.errors);

  return errors.length === 0 ? null : `${errors.length} refused, first: ${errors[0]}`;
}

function screenRows(screen: Screen, cold: Opened, warm: readonly Opened[]): Row[] {
  const empty = new Set([cold, ...warm].flatMap((o) => o.empty));

  if (empty.size > 0) log(`${screen.name}: answered with no points: ${[...empty].join(", ")}`);

  return [
    measured(`${screen.name}, cold`, BUDGETS.screenCold, cold.ms, failure([cold])),
    measured(
      `${screen.name}, warm p95`,
      BUDGETS.screenWarm,
      p95(warm.map((o) => o.ms)),
      failure(warm),
    ),
  ];
}

/** Each route's slowest request, by its p95 over the warm opens. */
function routeRows(warm: readonly Opened[]): Row[] {
  return slowest(warm.flatMap((o) => o.reads)).map((worst) => {
    if (worst.p95 > BUDGETS.read.max)
      log(`slowest ${worst.route}: ${decodeURIComponent(worst.path)}`);

    return {
      measurement: `GET ${worst.route.replace("/api/v1", "")}, slowest request's p95 of ${worst.samples}`,
      budget: BUDGETS.read,
      result: worst.p95,
    };
  });
}

export interface Screens {
  /** Opens every screen 30 times more, `pause` before each; the rows for every screen and route. */
  readonly warm: (pause: Pause) => Promise<Row[]>;
}

/** Opens every screen once, cold. */
export async function coldScreens(core: Core, plant: Plant): Promise<Screens> {
  const cold = await inTurn(core, SCREENS, plant, noPause);

  return {
    warm: async (pause) => {
      const warm = await inTurn(
        core,
        SCREENS.flatMap((screen) => Array.from({ length: WARM }, () => screen)),
        plant,
        pause,
      );

      const rows = SCREENS.flatMap((screen, i) => {
        const opened = cold[i];
        const runs = warm.slice(i * WARM, (i + 1) * WARM);

        return opened === undefined ? [] : screenRows(screen, opened, runs);
      });

      return [...rows, ...routeRows(warm)];
    },
  };
}
