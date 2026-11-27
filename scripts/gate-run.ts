// Execution engine for `scripts/gate.ts`: runs serial step lists or dependency-aware parallel DAGs
// with input-hash caching and fail-fast cancellation of sibling subprocesses.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Reads } from "./gate-cache.ts";

export type Command = readonly string[];

/** A command and what it reads; without reads it builds for a later step, or asks the network. */
export interface Step {
  readonly id?: string;
  readonly after?: readonly string[];
  readonly cwd?: string;
  readonly run: Command;
  readonly reads?: Reads;
  readonly fast?: true;
}

/** Where green runs are kept, and what a step's inputs hash to; null runs the step every time. */
export interface Cache {
  readonly dir: string;
  readonly key: (step: Readonly<Step>) => string | null | Promise<string | null>;
}

/**
 * What a step's inputs are hashed under: its folder and command, and what it waits for that this
 * run leaves out, so a run that skips a build never stands in for one that waits for it.
 */
export function stepKey(step: Readonly<Step>, run: readonly Step[]): string {
  const missing = (step.after ?? [])
    .filter((dep) => !run.some((other) => other.id === dep))
    .toSorted();

  return `${step.cwd ?? ""}\0${step.run.join(" ")}\0${missing.join(" ")}`;
}

const root = new URL("..", import.meta.url).pathname;

const env = {
  ...process.env,
  PATH: `${root}node_modules/.bin:${process.env["PATH"] ?? ""}`,
  // Prefer kache (zero-copy content-addressed cache), falling back to sccache.
  RUSTC_WRAPPER: process.env["RUSTC_WRAPPER"] ?? Bun.which("kache") ?? Bun.which("sccache") ?? "",
};

function envFor(cwd: string) {
  return cwd === root ? env : { ...env, PATH: `${join(cwd, "node_modules/.bin")}:${env.PATH}` };
}

const recordOf = (cache: Readonly<Cache>, step: Readonly<Step>) =>
  join(
    cache.dir,
    createHash("sha256")
      .update(`${step.cwd ?? ""}\0${step.run.join("\0")}`)
      .digest("hex"),
  );

function inputsNow(cache: Cache | undefined, step: Readonly<Step>): Promise<string | null> {
  return Promise.resolve(cache === undefined ? null : cache.key(step));
}

function lastGreen(cache: Readonly<Cache>, step: Readonly<Step>): Promise<string | null> {
  return readFile(recordOf(cache, step), "utf8").catch(() => null);
}

async function saveGreen(cache: Cache | undefined, step: Readonly<Step>, inputs: string | null) {
  if (cache === undefined || inputs === null) return;

  await mkdir(cache.dir, { recursive: true });
  await writeFile(recordOf(cache, step), inputs);
}

async function runSerial(remaining: readonly Step[], cache?: Cache): Promise<number> {
  for (const step of remaining) {
    const shown = step.run.join(" ");

    // oxlint-disable-next-line no-await-in-loop -- serial steps execute one after another.
    const inputs = await inputsNow(cache, step);

    // oxlint-disable-next-line no-await-in-loop -- cache lookup gates execution.
    if (cache !== undefined && inputs !== null && (await lastGreen(cache, step)) === inputs) {
      process.stderr.write(`\n✓ ${shown} (unchanged)\n`);
      continue;
    }

    process.stderr.write(`\n▶ ${shown}\n`);

    const cwd = step.cwd === undefined ? root : join(root, step.cwd);

    // oxlint-disable-next-line no-await-in-loop -- serial steps wait for completion.
    const code = await Bun.spawn([...step.run], {
      cwd,
      env: envFor(cwd),
      stdio: ["inherit", "inherit", "inherit"],
    }).exited;

    if (code !== 0) return code;

    // oxlint-disable-next-line no-await-in-loop -- persist green hash before next step.
    await saveGreen(cache, step, inputs);
  }

  return 0;
}

interface DagState {
  readonly cache: Cache | undefined;
  readonly done: Set<string>;
  readonly started: Set<string>;
  readonly active: Set<ReturnType<typeof Bun.spawn>>;
  failed: number;
}

function collectStream(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- stream reader is stateful.
  stream: ReadableStream<Uint8Array>,
) {
  const reader = stream.getReader();

  const text = (async () => {
    const chunks: Uint8Array[] = [];

    try {
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- stream chunks arrive sequentially.
        const { done, value } = await reader.read();

        if (done) break;

        chunks.push(value);
      }
    } catch {
      // Stream cancelled when a sibling fails first.
    }

    return Buffer.concat(chunks).toString("utf8");
  })();

  return {
    text,
    cancel: () => {
      void reader.cancel().catch(() => {
        // Ignore cancellation errors on closed streams.
      });
    },
  };
}

async function spawnBuffered(
  step: Readonly<Step>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- tracks active children.
  active: Set<ReturnType<typeof Bun.spawn>>,
  cancelled: () => boolean,
): Promise<{ code: number; output: string }> {
  const cwd = step.cwd === undefined ? root : join(root, step.cwd);
  const proc = Bun.spawn([...step.run], { cwd, env: envFor(cwd), stdout: "pipe", stderr: "pipe" });

  active.add(proc);

  const out = collectStream(proc.stdout);
  const err = collectStream(proc.stderr);
  const code = await proc.exited;

  active.delete(proc);

  if (cancelled()) {
    out.cancel();
    err.cancel();

    return { code, output: "" };
  }

  return { code, output: `${await out.text}${await err.text}` };
}

function failDag(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- shared mutable DAG state.
  state: DagState,
  code: number,
  message: string,
): void {
  if (state.failed !== 0) return;

  state.failed = code;
  process.stderr.write(message);

  for (const sibling of state.active) sibling.kill();
}

async function runDagNode(
  step: Readonly<Step>,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- shared mutable DAG state.
  state: DagState,
): Promise<void> {
  const shown = step.run.join(" ");
  const inputs = await inputsNow(state.cache, step);

  if (state.failed !== 0) return;

  if (
    state.cache !== undefined &&
    inputs !== null &&
    (await lastGreen(state.cache, step)) === inputs
  ) {
    process.stderr.write(`✓ ${shown} (unchanged)\n`);

    return;
  }

  const t0 = performance.now();

  process.stderr.write(`▶ ${shown}\n`);

  const { code, output } = await spawnBuffered(step, state.active, () => state.failed !== 0);

  if (code !== 0) {
    failDag(state, code, `\n✗ ${shown} (exit ${code})\n${output}`);

    return;
  }

  const secs = ((performance.now() - t0) / 1000).toFixed(2);

  process.stderr.write(`✓ ${shown} (${secs}s)\n`);
  await saveGreen(state.cache, step, inputs);
}

const newDagState = (cache: Cache | undefined): DagState => ({
  cache,
  done: new Set(),
  started: new Set(),
  active: new Set(),
  failed: 0,
});

async function runParallel(steps: readonly Step[], cache?: Cache): Promise<number> {
  const ids = new Set(steps.map((step, i) => step.id ?? `#${i}`));
  const state = newDagState(cache);

  await new Promise<void>((finish) => {
    let inflight = 0;

    const launch = (id: string, step: Readonly<Step>) => {
      state.started.add(id);
      inflight += 1;

      void runDagNode(step, state)
        .catch((error) => {
          failDag(state, 1, `\n✗ ${step.run.join(" ")} (${String(error)})\n`);
        })
        .finally(() => {
          inflight -= 1;

          if (state.failed === 0) state.done.add(id);

          schedule();
        });
    };

    const schedule = () => {
      if (state.failed !== 0 || state.done.size === steps.length) {
        if (inflight === 0) finish();

        return;
      }

      for (const [i, step] of steps.entries()) {
        const id = step.id ?? `#${i}`;
        const deps = (step.after ?? []).filter((dep) => ids.has(dep));

        if (!state.started.has(id) && deps.every((dep) => state.done.has(dep))) launch(id, step);
      }
    };

    schedule();
  });

  return state.failed;
}

/** Runs steps in dependency order (parallel DAG when any step sets `id`/`after`, else serial). */
export function runGate(remaining: readonly Step[], cache?: Cache): Promise<number> {
  const isDag = remaining.some((step) => step.id !== undefined || step.after !== undefined);

  return isDag ? runParallel(remaining, cache) : runSerial(remaining, cache);
}
