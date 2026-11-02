/**
 * Booting the Rust core as a process, shared by the harnesses that drive it (`./route-smoke-run.ts`,
 * `./budgets-run.ts`). Processes and sockets: running a harness is the test.
 */

/** The core on a free port; resolves once it logs the address it listens on. */
export async function boot(binary: string, dataDir: string) {
  const core = Bun.spawn(
    [binary, "--listen", "127.0.0.1:0", "--log-level", "info", "--data-dir", dataDir],
    { stdout: "ignore", stderr: "pipe" },
  );
  const reader = core.stderr.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`the core exited before listening:\n${seen}`);
    seen += decoder.decode(value);
    // Colour codes sit between the field name and the address.
    const port = /sunreye listening.*?127\.0\.0\.1:(\d+)/.exec(seen)?.[1];
    if (port) {
      // Keep draining, or a full pipe would stall the core's logging.
      void (async () => {
        while (!(await reader.read()).done);
      })();
      return { core, base: `http://127.0.0.1:${port}` };
    }
  }
}

/** `name=value` of the session cookie a sign-in answer set. */
function sessionCookie(response: Response, what: string): string {
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (cookie.length === 0) throw new Error(`${what} returned no session cookie`);
  return cookie.join("; ");
}

/** Throws with the answer's body unless it is 2xx. */
export async function requireOk(response: Response, what: string): Promise<void> {
  if (!response.ok)
    throw new Error(`${what} failed (${response.status}): ${await response.text()}`);
}

export async function signIn(
  base: string,
  path: string,
  body: object,
  what: string,
): Promise<string> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await requireOk(response, what);
  return sessionCookie(response, what);
}
