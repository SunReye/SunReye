import { isOfficialSource } from "@SunReye/db/profiles";
import { listProfiles } from "@SunReye/inverter-core";
import { Elysia, t } from "elysia";
import { getActiveProfileOrNull } from "../inverter/inverter";
import {
  browseAvailable,
  getProfileSources,
  getUpdateCheck,
  installProfile,
  listInstalled,
  setActiveProfile,
  setProfileSources,
  uninstallProfile,
} from "../inverter/profiles";
import { adminGuard } from "./admin-guard";

// Profile management: registered profiles, git repo sources, and the
// browse/install/activate flow for downloadable profiles.
export const profileRoutes = new Elysia({ name: "profile-routes" })
  .use(adminGuard)
  // Registered profiles (built-in + DB-installed) with active/installed/version.
  // A profile registered but absent from `installed_profiles` is a built-in
  // (shipped in-repo), which the UI badges "Built in".
  .get("/api/profiles", { requireAdmin: true }, async () => {
    const activeId = getActiveProfileOrNull()?.id ?? null;
    const installed = new Map((await listInstalled()).map((p) => [p.id, p]));
    return listProfiles().map((p) => ({
      id: p.id,
      name: p.name,
      manufacturer: p.manufacturer,
      active: p.id === activeId,
      installed: installed.has(p.id),
      builtin: !installed.has(p.id),
      version: installed.get(p.id)?.version,
    }));
  })
  // Repo sources: admin read + write (config surface). Each source is tagged
  // `official` (the protected default) so the UI can hide its Remove action
  // without re-deriving the check client-side.
  .get("/api/settings/profile-sources", { requireAdmin: true }, async () => {
    const { sources } = await getProfileSources();
    return { sources: sources.map((s) => ({ ...s, official: isOfficialSource(s.url) })) };
  })
  .put(
    "/api/settings/profile-sources",
    { requireAdmin: true, body: t.Unknown() },
    async ({ body, status }) => {
      try {
        return await setProfileSources(body);
      } catch (error) {
        return status(400, { error: error instanceof Error ? error.message : "Invalid sources" });
      }
    },
  )
  // Cached result of the background update checker (see `startUpdateChecks`).
  // Public read — just version info; the checker itself runs server-side.
  .get("/api/profiles/updates", () => getUpdateCheck())
  // Browse profiles across enabled repos (clones/pulls each — admin only).
  .get("/api/profiles/available", { requireAdmin: true }, () => browseAvailable())
  // Download + validate + persist a profile, registering it immediately so it
  // shows in the installed list right away. Activating it needs a restart.
  .post(
    "/api/profiles/install",
    { requireAdmin: true, body: t.Object({ source: t.String(), id: t.String() }) },
    async ({ body, status }) => {
      try {
        return await installProfile(body.source, body.id);
      } catch (error) {
        return status(400, { error: error instanceof Error ? error.message : "Install failed" });
      }
    },
  )
  // Uninstall a profile (cannot remove the currently active one).
  .delete(
    "/api/profiles/:id",
    { requireAdmin: true, params: t.Object({ id: t.String() }) },
    async ({ params, status }) => {
      if (params.id === getActiveProfileOrNull()?.id) {
        return status(409, { error: "Cannot uninstall the active profile" });
      }
      await uninstallProfile(params.id);
      return { ok: true, id: params.id };
    },
  )
  // Set the active profile. Applies on the next restart (it shapes boot-time
  // routes/manifest/topics), so signal that to the UI.
  .put(
    "/api/settings/active-profile",
    { requireAdmin: true, body: t.Object({ id: t.String() }) },
    async ({ body, status }) => {
      try {
        const { id } = await setActiveProfile(body);
        return { id, restartRequired: id !== getActiveProfileOrNull()?.id };
      } catch (error) {
        return status(400, { error: error instanceof Error ? error.message : "Invalid profile" });
      }
    },
  );
