// fallow-ignore-file coverage-gaps -- drives a live core; run by hand with `bun run bench`.
// The benchmark's HTTP side (ADR 24): a signed-in admin, timed requests and latency probes.

const TIMEOUT = 60_000;

/** One timed answer. `error` is set unless it was a 2xx. */
export interface Timed {
  readonly ms: number;
  readonly error: string | null;
  readonly body: string;
}

export interface Request {
  readonly path: string;
  readonly method?: "GET" | "POST";
  /** JSON. */
  readonly body?: string;
  readonly timeout?: number;
}

export interface Core {
  readonly base: string;
  /** Signs in as the admin; throws when refused. */
  readonly signIn: (password: string) => Promise<void>;
  /** Sends a request and times it to the last byte of the answer. */
  readonly time: (request: Request) => Promise<Timed>;
  /** GETs `path`'s body, throwing on a refusal: for reads the harness itself depends on. */
  readonly get: (path: string) => Promise<string>;
}

async function timed(base: string, cookie: string, request: Request): Promise<Timed> {
  const began = performance.now();

  const init: RequestInit = {
    method: request.method ?? "GET",
    headers: { cookie, "content-type": "application/json" },
    signal: AbortSignal.timeout(request.timeout ?? TIMEOUT),
  };

  if (request.body !== undefined) init.body = request.body;

  try {
    const response = await fetch(`${base}${request.path}`, init);
    const body = await response.text();
    const ms = performance.now() - began;
    const error = response.ok ? null : `HTTP ${response.status} on ${request.path}`;

    return { ms, error, body };
  } catch (error) {
    return {
      ms: performance.now() - began,
      error: `${String(error)} on ${request.path}`,
      body: "",
    };
  }
}

/** The core listening on `listen`, as the admin once signed in. */
export function connect(listen: string): Core {
  const base = `http://${listen}`;
  let cookie = "";

  const time = (request: Request): Promise<Timed> => timed(base, cookie, request);

  return {
    base,
    signIn: async (password) => {
      const answer = await fetch(`${base}/api/v1/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(TIMEOUT),
      });

      if (answer.status !== 204) throw new Error(`login answered ${answer.status}`);

      cookie = (answer.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    },
    time,
    get: async (path) => {
      const answer = await time({ path });

      if (answer.error !== null) throw new Error(answer.error);

      return answer.body;
    },
  };
}

/**
 * Polls until the core answers anything; the ms since `began`. The listener is bound before the
 * store opens, so a request waits there and is answered the moment serving starts.
 */
export async function firstAnswer(base: string, began: number, limit: number): Promise<number> {
  const answered = await fetch(`${base}/api/v1/session`, {
    signal: AbortSignal.timeout(limit),
  }).then(
    () => true,
    () => false,
  );

  if (answered) return performance.now() - began;

  if (performance.now() - began > limit) throw new Error("the core never answered");

  await Bun.sleep(20);

  return firstAnswer(base, began, limit);
}

export interface Probe {
  /** Stops probing; the worst latency seen. */
  readonly stop: () => Promise<number>;
}

/**
 * GETs `path` until stopped, `gap` ms after each answer, and keeps the worst latency: a thread
 * held for longer than `gap` shows as one slow answer.
 */
export function probe(core: Core, path: string, gap: number): Probe {
  let [running, worst] = [true, 0];

  const loop = async (): Promise<void> => {
    if (!running) return;

    const answer = await core.time({ path });

    worst = Math.max(worst, answer.ms);
    await Bun.sleep(gap);

    return loop();
  };

  const done = loop();

  return {
    stop: async () => {
      running = false;
      await done;

      return worst;
    },
  };
}
