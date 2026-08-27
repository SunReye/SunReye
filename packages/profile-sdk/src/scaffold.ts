import {
  bindingFor,
  type MetricDataDef,
  type ProfileData,
  type RegisterType,
} from "@SunReye/inverter-core";

export interface ScaffoldMeta {
  id: string;
  name: string;
  manufacturer: string;
  version: string;
}

const REGISTER_TYPES: RegisterType[] = ["U_WORD", "S_WORD", "U_DWORD", "RAW"];

/**
 * Build a starter {@link ProfileData} from a vendor register table pasted as
 * CSV. Roles are left unmapped — that semantic mapping is the author's job (run
 * `coverage` afterwards to see what's still needed) — but the register map (the
 * tedious transcription) comes across in one shot.
 *
 * Expected header columns (order-independent): `topic,label,unit,group,addr,
 * type,scale,access`. Multi-register `addr` (U_DWORD/RAW) is `|`-separated,
 * e.g. `534|535`.
 */
export function scaffoldFromCsv(csv: string, meta: ScaffoldMeta): ProfileData {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("CSV needs a header row and at least one data row");

  const header = splitRow(lines[0]!).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const topicCol = col("topic");
  if (topicCol < 0) throw new Error('CSV must have a "topic" column');

  const metrics: MetricDataDef[] = lines.slice(1).map((line, i) => {
    const cells = splitRow(line);
    const get = (name: string): string | undefined => {
      const c = col(name);
      return c >= 0 ? cells[c]?.trim() : undefined;
    };
    const topic = get("topic");
    if (!topic) throw new Error(`row ${i + 2}: missing topic`);

    const type = parseType(get("type"));
    const unit = get("unit");
    const def: MetricDataDef = {
      key: topic.replaceAll("/", "."),
      topic,
      label: get("label") || topic,
      unit: unit && unit.length > 0 ? unit : null,
      group: get("group") || "inverter",
      type,
      addresses: parseAddresses(get("addr"), type),
      scale: Number(get("scale") ?? "1") || 1,
      access: get("access") === "rw" ? "rw" : "r",
    };
    return { ...def, binding: bindingFor(def) };
  });

  return { schemaVersion: 2, ...meta, metrics };
}

/** Minimal CSV row split (no quoted-field support — register tables don't need it). */
function splitRow(line: string): string[] {
  return line.split(",").map((c) => c.trim());
}

function parseType(raw: string | undefined): RegisterType {
  const t = (raw ?? "U_WORD").toUpperCase();
  return (REGISTER_TYPES as string[]).includes(t) ? (t as RegisterType) : "U_WORD";
}

function parseAddresses(raw: string | undefined, type: RegisterType): number[] {
  if (!raw) return [];
  const parts = raw
    .split(/[|]/)
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n));
  // U_WORD/S_WORD are single-register; keep only the first even if more given.
  return type === "U_WORD" || type === "S_WORD" ? parts.slice(0, 1) : parts;
}
