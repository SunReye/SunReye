// fallow-ignore-file coverage-gaps -- shared by the Docker checks, which run by hand.
// Helpers for the checks that drive real processes: image smoke and release rehearsal.

export type Check = readonly [name: string, ok: boolean];

/** Runs `command` in `cwd` and returns its trimmed stdout; throws when it fails. */
export async function run(command: readonly string[], cwd = "."): Promise<string> {
  const child = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();

  if ((await child.exited) !== 0) throw new Error(`failed: ${command.join(" ")}`);

  return output.trim();
}

/** Whether `url` answers, polling every 100 ms for up to `attempts` tries. */
export async function answers(url: string, attempts: number): Promise<boolean> {
  const up = await fetch(url).then(
    (response) => response.ok,
    () => false,
  );

  if (up || attempts <= 1) return up;

  await Bun.sleep(100);

  return answers(url, attempts - 1);
}

/** Prints each check; returns the exit code: 0 when all passed. */
export function report(checks: readonly Check[]): number {
  for (const [name, ok] of checks) process.stderr.write(`${ok ? "ok  " : "FAIL"} ${name}\n`);

  return checks.every(([, ok]) => ok) ? 0 : 1;
}
