import { core } from "$lib/core-api";
import { byPath, refused } from "$lib/core-by-path";

/** The restart route only the 3.x engine serves (the Rust core reports `restart` absent), so it leaves with the engine. */

/** Whether the server has answered again after a restart. */
async function serverIsUp(): Promise<boolean> {
  try {
    const { data } = await core.GET("/api/setup-status");
    return data != null;
  } catch {
    return false;
  }
}

/**
 * Ask the server to restart (to apply a boot-time change like a newly activated
 * profile), then poll until it answers again and reload the page. Resolves
 * `false` if it never comes back within {@link timeoutMs} — e.g. run without a
 * supervisor to relaunch it — so the caller can prompt a manual restart. On
 * success the page reloads and the promise never settles.
 */
export async function restartServer(timeoutMs = 30_000): Promise<boolean> {
  if (refused(await byPath.POST("/api/admin/restart"))) return false;
  // Let it actually go down before polling, so we don't see the pre-exit server.
  await new Promise((r) => setTimeout(r, 1200));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverIsUp()) {
      location.reload();
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
