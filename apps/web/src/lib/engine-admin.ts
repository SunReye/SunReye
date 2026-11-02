import { api } from "$lib/api";

/**
 * Endpoints only the 3.x engine serves, still on Eden. The Rust core serves neither (it reports
 * `restart` absent in its capabilities), so these leave with the engine.
 */

/**
 * Whether the admin has enabled the anonymous read-only dashboard. Public, so a
 * logged-out visitor can be shown the dashboard (true) or the login page (false)
 * without a session. Mirrors the server's `publicDashboard` access toggle.
 */
export async function publicDashboardEnabled(): Promise<boolean> {
  const { data } = await api.api["access-status"].get();
  return data?.publicDashboard ?? false;
}

/** Whether the server has answered again after a restart. */
async function serverIsUp(): Promise<boolean> {
  try {
    const { data } = await api.api["setup-status"].get();
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
  const { error } = await api.api.admin.restart.post();
  if (error) return false;
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
