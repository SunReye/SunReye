// The reads that rarely change, asked once for every screen: a core's devices, layout,
// capabilities, timezone, series catalog, topology, module types and location; and range reads,
// held as `ranges.ts` says.
import type { Client, Problem } from "./client";
import type { Core } from "./core";
import type { Visibility } from "./live";
import { holding } from "./ranges";

const READS = [
  "devices",
  "layout",
  "capabilities",
  "timezone",
  "series",
  "topology",
  "moduleTypes",
  "location",
] as const;

type Read = (typeof READS)[number];

/** Whether an answer stands for the session: a success, or the admin's read refused a viewer. A
 * retry may well be answered otherwise. */
const lasting = ({ problem }: Readonly<Partial<Problem>>): boolean =>
  problem === undefined || problem === "auth.forbidden";

/** The series catalog's last instants move on with every reading: it is asked again this soon. */
const CATALOG_MS = 5 * 60_000;

/** One read, asked once for every caller until forgotten or `ms` old; only a lasting answer is
 * kept. */
function remembered<T extends object>(ask: () => Promise<T>, ms = Infinity) {
  let known: Promise<T> | undefined;
  let at = 0;

  const read = (): Promise<T> => {
    if (known && Date.now() - at <= ms) return known;

    const asked = ask();

    at = Date.now();

    // Only the read still kept is dropped: a change while it was in flight forgot it already.
    const drop = () => {
      if (known === asked) known = undefined;
    };

    known = asked;
    asked.then(
      (answer) => {
        if (!lasting(answer)) drop();

        return null;
      },
      () => {
        drop();
      },
    );

    return asked;
  };

  return {
    read,
    forget: () => {
      known = undefined;
    },
  };
}

/** Wraps a write, after which `reads` are asked again, whatever it answered; every read without. */
const changer =
  (forget: (reads?: readonly Read[]) => void) =>
  <A extends readonly unknown[], T>(write: (...args: A) => Promise<T>, reads?: readonly Read[]) =>
  async (...args: A): Promise<T> => {
    try {
      return await write(...args);
    } finally {
      forget(reads);
    }
  };

/** Each rarely changing read of `core`, remembered. */
const keep = (core: Readonly<Core>) =>
  ({
    devices: remembered(core.devices),
    layout: remembered(core.layout),
    capabilities: remembered(core.capabilities),
    timezone: remembered(core.timezone),
    series: remembered(core.series, CATALOG_MS),
    topology: remembered(core.topology),
    moduleTypes: remembered(core.moduleTypes),
    location: remembered(core.location),
  }) satisfies Record<Read, Readonly<{ forget: () => void }>>;

/**
 * Calls `all` when `page` is shown again, as another screen may have changed the plant meanwhile,
 * and `ranges` as any write through `client` is sent and again as it is answered, as a layout,
 * topology, timezone or import changes what the core computes for a past range (ADR 11).
 */
function watch(
  page: Visibility | undefined,
  client: Client,
  all: () => void,
  ranges: () => void,
): void {
  const written = ({ request }: Readonly<{ request: Request }>) => {
    if (request.method !== "GET") ranges();
  };

  page?.addEventListener("visibilitychange", () => {
    if (!page.hidden) all();
  });
  client.use({ onRequest: written, onResponse: written });
}

/**
 * `core` with its rarely changing reads remembered and its range reads held (ADR 11): callers at
 * once share one request, later ones none, until a write through it changes the read, or the page
 * is shown again, as another screen may have changed the plant meanwhile. A failure or a refusal
 * other than a viewer's is asked again.
 */
export function remembering(
  core: Readonly<Core>,
  page: Visibility | undefined,
  client: Client,
): Core {
  const kept = keep(core);
  const { forget: forgetRanges, ...ranges } = holding(core);

  // Whatever forgets a rarely changing read forgets the closed ranges too.
  const forget = (reads: readonly Read[] = READS) => {
    for (const read of reads) kept[read].forget();
    forgetRanges();
  };

  watch(page, client, forget, forgetRanges);

  const changing = changer(forget);

  return {
    ...core,
    ...ranges,
    devices: kept.devices.read,
    layout: kept.layout.read,
    capabilities: kept.capabilities.read,
    timezone: kept.timezone.read,
    series: kept.series.read,
    topology: kept.topology.read,
    moduleTypes: kept.moduleTypes.read,
    location: kept.location.read,
    changeLayout: changing(core.changeLayout, ["layout", "capabilities"]),
    addModuleType: changing(core.addModuleType, ["moduleTypes"]),
    setTimezone: changing(core.setTimezone, ["timezone"]),
    setLocation: changing(core.setLocation, ["location"]),
    changeTopology: changing(core.changeTopology, ["topology", "capabilities", "series"]),
    enable: changing(core.enable, ["capabilities"]),
    startImport: changing(core.startImport, ["series"]),
    // An import in progress writes series until it is done.
    importStatus: changing(core.importStatus, ["series"]),
    // Who asks, or what is registered: every read.
    signIn: changing(core.signIn),
    setPassword: changing(core.setPassword),
    addDevice: changing(core.addDevice),
    changeDevice: changing(core.changeDevice),
    removeDevice: changing(core.removeDevice),
    apply: changing(core.apply),
  };
}
