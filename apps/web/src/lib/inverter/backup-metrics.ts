import type { ManifestMetric } from "./types";

/**
 * The rows the Backup section renders.
 *
 * Two shapes exist and the profile decides which: a device that meters its
 * islanded output apart from the house maps `backup.*`, and one whose backup
 * output *is* its load output (a whole-home UPS — every published Deye) meters
 * it once, as house load, and states the output through
 * `declares.backupOutput`. So prefer the dedicated metrics and fall back to the
 * load group, which is what that second shape has to show.
 *
 * Whether the section renders at all is the `backupLoad` capability's call, not
 * this list's — a grid-tied plant with a consumption meter has load metrics and
 * no backup output.
 */
export function backupSectionMetrics(metrics: ManifestMetric[]): ManifestMetric[] {
  const metered = metrics.filter((m) => m.role?.startsWith("backup."));
  return metered.length > 0 ? metered : metrics.filter((m) => m.group === "load");
}
