import { core } from "$lib/core-api";

/** Whether the admin has the kiosk view on. Public: the shell and login page ask before any session. */
export async function kioskEnabled(): Promise<boolean> {
  try {
    const { data } = await core.GET("/api/kiosk");
    return data?.enabled ?? false;
  } catch {
    return false;
  }
}

/** Admin only; `true` once the core holds the new state. */
export async function setKiosk(enabled: boolean): Promise<boolean> {
  try {
    const { data } = await core.PUT("/api/settings/kiosk", { body: { enabled } });
    return data !== undefined;
  } catch {
    return false;
  }
}
