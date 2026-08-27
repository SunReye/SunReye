/**
 * THE PORTABLE ARCHIVE — the file format, and every decision that can be made
 * about it without a database.
 *
 * ## Why this exists
 *
 * Before 2.0.0 the only way data left a SunReye instance was `pg_dump`. A dump
 * is schema-coupled by construction: it carries `metrics_raw`'s columns, the
 * continuous-aggregate definitions, the int2 device ids, the TimescaleDB
 * catalogue. That makes it a fine BACKUP of one version and useless as a
 * MIGRATION vehicle — which is why 2.0.0 is a one-time clean-slate reset rather
 * than the third of many, and why a schema change could cost someone their
 * history.
 *
 * This format is the answer to that, and it has exactly one design rule:
 *
 *   **NAMES, NEVER IDS.** A device is a `slug`, a metric is a `key`, a
 *   connection is a `name`. Not one integer in the file refers to a row. The
 *   int2 `device_id`/`metric_id` pair `metrics_raw` is keyed by is a STORAGE
 *   decision (see `./schema/metrics.ts` for the measured bytes) chosen for the
 *   write path; it is renumbered by nothing today only because nothing
 *   renumbers it. A stored id in a portable file would rot the first time a
 *   database was restored or a device re-added. The same rule
 *   `../../apps/server/src/shared/identity-sql.ts` enforces at the read edge is
 *   enforced here at the file edge.
 *
 * So the NEXT redesign can read this file, because the only thing it has to
 * agree with is the metric vocabulary — and that vocabulary is the external
 * contract already (MQTT topics, HA `unique_id`s, `/api/v1/entities/:key`,
 * `custom_charts.data`).
 *
 * ## Why `source_tier` is a field and not an implementation detail
 *
 * A reading that came out of an hourly bucket is not a poll. It is one value
 * claimed to have been held for an hour, and the importer has to know that to
 * put it back through the bucket replay (`./replay.ts`) rather than treat it as
 * a sample. Keeping the tier is also the only thing that makes a
 * PARTIAL-COVERAGE UNION expressible at all: a 2.0.0 instance whose minute tier
 * was frozen has minute buckets for the old span and raw rows for the recent
 * one, and a file that flattened both to "a reading" could not say which was
 * which. Do not drop it.
 *
 * ## What is deliberately NOT in the file
 *
 * **No auth tables.** No `user`, no `account`, no `session`, no `apikey`.
 * Password hashes and live session tokens in a file that is designed to be
 * copied off the box and mailed around are a liability, and recreating the admin
 * account is a 30-second onboarding step. This is a decision, not an omission,
 * and `./archive.test.ts` pins it so it cannot be "fixed" by accident.
 *
 * **No per-bucket min/max for a replayed span.** Not this file's loss — it is
 * the bucket replay's, documented in `./replay.ts`, and it is inherited because
 * an hourly bucket's mean cannot be un-averaged.
 *
 * ## Why tar, and why the readings member is spooled rather than streamed inline
 *
 * A tar header must declare its member's SIZE before the body, and the manifest
 * (which carries the per-stream row counts an importer verifies against) is only
 * knowable after every row has been read. Both facts point the same way: the
 * readings are compressed to a spool file first, then the container is assembled
 * around them. Memory stays constant either way, which is the constraint that
 * actually matters on a 2 GB Home Assistant box; see `./archive-export.ts`.
 *
 * Pure: this module touches no database and no filesystem, so every branch is
 * unit-tested (`./archive.test.ts`).
 */

/** The marker that says "this is one of ours". Checked before anything else. */
export const ARCHIVE_FORMAT = "sunreye-archive";

/**
 * The format version this build WRITES and is the newest it can READ.
 *
 * Bump it only for a change a v1 reader would get WRONG — a renamed field, a
 * changed unit, a new required member. An additive optional field does not need
 * a bump, because a v1 reader ignoring it is still correct.
 */
export const ARCHIVE_FORMAT_VERSION = 1;

/**
 * The members of a v1 archive, in the order they are written.
 *
 * Order is load-bearing for a streaming reader: `manifest.json` first so a
 * refusal happens before anything large has been read, and `readings.ndjson.gz`
 * last because it is the only unbounded one.
 */
export const MEMBERS = {
  manifest: "manifest.json",
  config: "config.json",
  configLog: "config-log.ndjson.gz",
  readings: "readings.ndjson.gz",
} as const;

/**
 * Where a reading came from. `raw` is a poll (or an interval row already in
 * `metrics_raw`); the other three are materialized aggregate buckets, and their
 * `dur_ms` is the bucket width.
 */
export const SOURCE_TIERS = ["raw", "minute", "hourly", "daily"] as const;

export type SourceTier = (typeof SOURCE_TIERS)[number];

const TIER_SET: ReadonlySet<string> = new Set(SOURCE_TIERS);

/** One line of `readings.ndjson`. */
export interface ReadingRow {
  time: Date;
  deviceSlug: string;
  metricKey: string;
  value: number;
  /**
   * How long the value is claimed to have been held, ms — `null` where the
   * source row had none (`metrics_raw.dur_ms` is nullable, and a NULL there
   * means "unknown", which is not the same as zero).
   */
  durMs: number | null;
  sourceTier: SourceTier;
}

/** One line of `config-log.ndjson` — a configuration register CHANGE. */
export interface ConfigLogRow {
  time: Date;
  deviceSlug: string;
  metricKey: string;
  value: number;
}

/**
 * The wire names. Spelled out rather than abbreviated: the file is read by
 * software that does not exist yet, and gzip erases the cost of a long repeated
 * key almost entirely (the keys are the most compressible bytes in the file).
 */
interface ReadingLine {
  time: string;
  device_slug: string;
  metric_key: string;
  value: number;
  dur_ms: number | null;
  source_tier: string;
}

/**
 * `JSON.stringify` of a string never emits a raw newline (it escapes to `\n`),
 * which is what keeps the file line-delimited even for a slug containing one.
 * Asserted rather than assumed, because the whole reader depends on it.
 */
export function encodeReading(row: ReadingRow): string {
  return JSON.stringify({
    time: row.time.toISOString(),
    device_slug: row.deviceSlug,
    metric_key: row.metricKey,
    value: row.value,
    dur_ms: row.durMs,
    source_tier: row.sourceTier,
  } satisfies ReadingLine);
}

export function encodeConfigLog(row: ConfigLogRow): string {
  return JSON.stringify({
    time: row.time.toISOString(),
    device_slug: row.deviceSlug,
    metric_key: row.metricKey,
    value: row.value,
  });
}

/** A blank line — the trailing newline of the file, chiefly. */
const isBlank = (line: string) => line.trim().length === 0;

function parseLine(line: string, lineNo: number, member: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`${member}: line ${lineNo} is not a readable row: ${why}`);
  }
}

/**
 * A required field, refused rather than defaulted.
 *
 * `0` is a reading (a PV string at night, a battery at rest) and a negative
 * value is a reading (export power, discharge), so a truthiness check here would
 * silently discard the two boundaries this codebase cares about most. Only
 * `undefined`/`null` and a non-finite number are refusals.
 */
function requireNumber(
  row: Record<string, unknown>,
  field: string,
  lineNo: number,
  member: string,
): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `${member}: line ${lineNo} has no readable ${field} (${JSON.stringify(value)})`,
    );
  }
  return value;
}

function requireString(
  row: Record<string, unknown>,
  field: string,
  lineNo: number,
  member: string,
): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `${member}: line ${lineNo} has no readable ${field} (${JSON.stringify(value)})`,
    );
  }
  return value;
}

/**
 * A timestamp, refusing what it cannot read.
 *
 * The same refusal `./replay.ts` makes about a bucket, for the same reason: a
 * silent `Invalid Date` reaches the insert as a NULL on a NOT NULL column at
 * best, and as a row stamped at the epoch at worst.
 */
function requireTime(row: Record<string, unknown>, lineNo: number, member: string): Date {
  const raw = requireString(row, "time", lineNo, member);
  const time = new Date(raw);
  if (Number.isNaN(time.getTime())) {
    throw new Error(`${member}: line ${lineNo} has an unreadable time ${JSON.stringify(raw)}`);
  }
  return time;
}

/** One `readings.ndjson` line, or `null` for a blank one. */
export function decodeReading(line: string, lineNo: number): ReadingRow | null {
  if (isBlank(line)) return null;
  const member = MEMBERS.readings;
  const row = parseLine(line, lineNo, member);
  const tier = requireString(row, "source_tier", lineNo, member);
  if (!TIER_SET.has(tier)) {
    // Refused, never guessed: an unknown tier has an unknown bucket width, and a
    // wrong width is a wrong kWh figure rather than a missing one.
    throw new Error(
      `${member}: line ${lineNo} has source_tier ${JSON.stringify(tier)}, which this build does ` +
        `not know (expected one of ${SOURCE_TIERS.join(", ")})`,
    );
  }
  const durMs = row.dur_ms;
  if (durMs !== null && (typeof durMs !== "number" || !Number.isFinite(durMs))) {
    throw new Error(`${member}: line ${lineNo} has an unreadable dur_ms ${JSON.stringify(durMs)}`);
  }
  return {
    time: requireTime(row, lineNo, member),
    deviceSlug: requireString(row, "device_slug", lineNo, member),
    metricKey: requireString(row, "metric_key", lineNo, member),
    value: requireNumber(row, "value", lineNo, member),
    durMs,
    sourceTier: tier as SourceTier,
  };
}

/** One `config-log.ndjson` line, or `null` for a blank one. */
export function decodeConfigLog(line: string, lineNo: number): ConfigLogRow | null {
  if (isBlank(line)) return null;
  const member = MEMBERS.configLog;
  const row = parseLine(line, lineNo, member);
  return {
    time: requireTime(row, lineNo, member),
    deviceSlug: requireString(row, "device_slug", lineNo, member),
    metricKey: requireString(row, "metric_key", lineNo, member),
    value: requireNumber(row, "value", lineNo, member),
  };
}

/**
 * Per-stream row counts — what an importer verifies what it actually inserted
 * against, so a truncated readings member is caught by arithmetic rather than by
 * a chart that is quietly short.
 */
export interface StreamCounts {
  raw: number;
  minute: number;
  hourly: number;
  daily: number;
  /** `metrics_config_log` rows, counted separately: they are not readings. */
  configLog: number;
}

export const emptyStreamCounts = (): StreamCounts => ({
  raw: 0,
  minute: 0,
  hourly: 0,
  daily: 0,
  configLog: 0,
});

/**
 * The schema the archive came out of.
 *
 * Not a version string, because a version string is a claim and this is
 * evidence: the newest drizzle journal entry the database had applied, plus the
 * TimescaleDB structural files `timescale_migrations` records. An importer prints
 * it; a human reading a file from an unknown box can tell exactly what wrote it.
 */
export interface SourceFingerprint {
  /** App version that wrote the file, or `1.2.0-legacy` for a pre-2.0.0 read. */
  app: string;
  /** Newest journal tag applied, or null for a pre-journal (1.x) database. */
  drizzleTag: string | null;
  /** That entry's `when`, the monotonic part. */
  drizzleWhen: number | null;
  /** Applied `timescale/*.sql` file names, in order. */
  timescaleFiles: string[];
}

export interface ManifestInput {
  createdAt: Date;
  source: SourceFingerprint;
  /**
   * The PLANT time zone, not the display one. Every bucket boundary in the
   * exported history was computed in it (`./plant.ts`'s `getPlantTimeZone`), so
   * a file that did not carry it could not be checked against its own daily
   * totals on the other side.
   */
  plantTimeZone: string;
  streams: StreamCounts;
  span: { from: Date | null; to: Date | null };
  /** Every device slug that appears in the readings. */
  devices: string[];
  /** Every metric key that appears in the readings. */
  metrics: string[];
}

export interface ArchiveManifest {
  format: string;
  formatVersion: number;
  createdAt: string;
  source: SourceFingerprint;
  plantTimeZone: string;
  streams: StreamCounts;
  /** Total READING rows across the four tiers. `configLog` is not a reading. */
  rows: number;
  span: { from: string | null; to: string | null };
  devices: string[];
  metrics: string[];
}

const READING_STREAMS = ["raw", "minute", "hourly", "daily"] as const;

/** Total reading rows a set of stream counts describes. */
export const totalReadings = (streams: StreamCounts): number =>
  READING_STREAMS.reduce((sum, key) => sum + streams[key], 0);

export function buildManifest(input: ManifestInput): ArchiveManifest {
  return {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    createdAt: input.createdAt.toISOString(),
    source: input.source,
    plantTimeZone: input.plantTimeZone,
    streams: input.streams,
    rows: totalReadings(input.streams),
    span: {
      from: input.span.from?.toISOString() ?? null,
      to: input.span.to?.toISOString() ?? null,
    },
    devices: input.devices,
    metrics: input.metrics,
  };
}

const MANIFEST_FIELDS = [
  "createdAt",
  "source",
  "plantTimeZone",
  "streams",
  "rows",
  "span",
  "devices",
  "metrics",
] as const;

/**
 * Everything wrong with a candidate manifest, as sentences.
 *
 * Separate from {@link parseManifest} so the version RULE is testable directly:
 * an older version is accepted (the whole point of the file is to be read by a
 * later build) and a newer one is not.
 */
export function manifestProblems(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [`${MEMBERS.manifest}: not a JSON object`];
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.format !== ARCHIVE_FORMAT) {
    return [
      `${MEMBERS.manifest}: not a SunReye archive — expected format ` +
        `${JSON.stringify(ARCHIVE_FORMAT)}, found ${JSON.stringify(manifest.format)}`,
    ];
  }
  const version = manifest.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return [`${MEMBERS.manifest}: formatVersion ${JSON.stringify(version)} is not an integer`];
  }
  if (version > ARCHIVE_FORMAT_VERSION) {
    // REFUSED, LOUDLY. A newer file may have renamed a field or changed a unit,
    // and an importer that reads what it recognises and ignores the rest writes
    // wrong history while reporting success. Upgrading is the answer.
    return [
      `${MEMBERS.manifest}: this archive is format version ${version}, and this build only ` +
        `understands ${ARCHIVE_FORMAT_VERSION}. Upgrade SunReye to import it — guessing at a ` +
        `newer format would import wrong history and report success.`,
    ];
  }
  return MANIFEST_FIELDS.filter((field) => manifest[field] === undefined).map(
    (field) => `${MEMBERS.manifest}: missing required field ${field}`,
  );
}

/** Parse and validate `manifest.json`, throwing the first problem it finds. */
export function parseManifest(text: string): ArchiveManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${MEMBERS.manifest} is not readable JSON — the archive is truncated or corrupt: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  const problems = manifestProblems(parsed);
  if (problems.length > 0) throw new Error(problems.join("; "));
  return parsed as ArchiveManifest;
}

/**
 * Identities the archive names that the target database does not hold.
 *
 * Reported ALL AT ONCE and before a single row is inserted, for the same reason
 * `replay-run.ts`'s `unregisteredMetrics` refuses up front: a `join metric_keys`
 * that finds no match drops the row, and history that disappears because a join
 * missed is the quietest possible data loss. One run therefore names every gap,
 * rather than the operator discovering them one restart at a time.
 */
export function unknownIdentities(
  archive: { devices: readonly string[]; metrics: readonly string[] },
  known: { devices: ReadonlySet<string>; metrics: ReadonlySet<string> },
): string[] {
  return [
    ...archive.devices
      .filter((slug) => !known.devices.has(slug))
      .map(
        (slug) =>
          `unknown device slug ${JSON.stringify(slug)}: the archive holds readings for it, but ` +
          `no such device exists in the target plant`,
      ),
    ...archive.metrics
      .filter((key) => !known.metrics.has(key))
      .map(
        (key) =>
          `unknown metric key ${JSON.stringify(key)}: the archive holds readings for it, but it ` +
          `is not registered in metric_keys`,
      ),
  ];
}

// ---------------------------------------------------------------------------
// The tar container.
//
// A hand-rolled USTAR writer/reader rather than a dependency, and it is ~80
// lines because the format this uses is a strict subset: four members, all
// regular files, all with short ASCII names, no links, no sparse files, no
// extended headers. What a library would add here is surface, not capability —
// and the reader is the half that has to be paranoid, because a corrupt archive
// is one of the boundaries this feature is judged on.
// ---------------------------------------------------------------------------

/** One tar block. Everything in the format is a multiple of it. */
export const TAR_BLOCK = 512;

/** Bytes of zero padding a body of `size` needs to reach a block boundary. */
export const tarPadding = (size: number): number => (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK;

/** The two zero blocks that mark end-of-archive — their absence means truncated. */
export const tarEnd = (): Uint8Array => new Uint8Array(TAR_BLOCK * 2);

/** The tar name field is 100 bytes with no continuation in the subset we write. */
const NAME_LIMIT = 100;

/**
 * A refusal ceiling on a declared member size: 8 GiB, which is the largest a
 * 12-byte octal field can express anyway.
 *
 * The ceiling is the belt. The real check on a corrupt size cannot live in a
 * header parser at all — a size is implausible relative to the LENGTH OF THE
 * FILE, which only the reader knows, so `readTar` refuses a member claiming more
 * bytes than remain. What this parser owns is the unparseable case: a size field
 * of spaces or garbage yields NaN, and a reader that believed it would slice
 * `[offset, offset + NaN)` and hand back an EMPTY member with no error at all.
 */
const SIZE_LIMIT = 8 * 1024 ** 3;

const CHECKSUM_OFFSET = 148;
const CHECKSUM_LENGTH = 8;

const ascii = (text: string, length: number): Uint8Array => {
  const out = new Uint8Array(length);
  out.set(new TextEncoder().encode(text).subarray(0, length));
  return out;
};

/** `size`/`mtime`-style octal field: zero-padded, NUL-terminated. */
const octal = (value: number, length: number): Uint8Array =>
  ascii(value.toString(8).padStart(length - 1, "0"), length);

/**
 * The header checksum: the unsigned sum of every byte, with the checksum field
 * itself counted as eight spaces. Written as six octal digits, a NUL and a
 * space — the form GNU tar and bsdtar both accept.
 */
function writeChecksum(header: Uint8Array): void {
  header.fill(32, CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_LENGTH);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.set(ascii(`${sum.toString(8).padStart(6, "0")}\0 `, CHECKSUM_LENGTH), CHECKSUM_OFFSET);
}

/** A 512-byte USTAR header for a regular file. */
export function tarHeader(name: string, size: number): Uint8Array {
  if (name.length === 0 || name.length > NAME_LIMIT) {
    throw new Error(
      `archive: member name ${JSON.stringify(name)} does not fit the ${NAME_LIMIT}-byte tar name field`,
    );
  }
  if (!Number.isInteger(size) || size < 0) {
    throw new Error(`archive: member ${name} has an invalid size ${size}`);
  }
  const header = new Uint8Array(TAR_BLOCK);
  header.set(ascii(name, NAME_LIMIT), 0);
  header.set(octal(0o644, 8), 100); // mode
  header.set(octal(0, 8), 108); // uid
  header.set(octal(0, 8), 116); // gid
  header.set(octal(size, 12), 124);
  // mtime 0: the export's real timestamp is in the manifest, and a zero here is
  // what makes the container BYTE-REPRODUCIBLE for a given payload.
  header.set(octal(0, 12), 136);
  header[156] = 0x30; // typeflag '0' — regular file
  header.set(ascii("ustar", 6), 257);
  header.set(ascii("00", 2), 263);
  writeChecksum(header);
  return header;
}

/** Header + body + padding: one complete member, ready to concatenate. */
export function tarMember(name: string, body: Uint8Array): Uint8Array {
  const header = tarHeader(name, body.length);
  const pad = tarPadding(body.length);
  const out = new Uint8Array(TAR_BLOCK + body.length + pad);
  out.set(header, 0);
  out.set(body, TAR_BLOCK);
  return out;
}

const decoder = new TextDecoder();

const cstring = (bytes: Uint8Array): string => {
  const end = bytes.indexOf(0);
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end));
};

/**
 * Read one header block: `{ name, size }`, or `null` at the end marker.
 *
 * Every refusal here is a corruption the alternative would hide. The CHECKSUM is
 * verified because it is the only integrity signal a tar header carries, and a
 * gzip whose tail was lost decompresses to a plausible-looking prefix. The SIZE
 * is bounded because believing a garbage octal is how a reader ends up allocating
 * a terabyte or seeking past the end of the file.
 */
export function parseTarHeader(block: Uint8Array): { name: string; size: number } | null {
  if (block.length < TAR_BLOCK) {
    throw new Error(
      `archive: truncated tar header — ${block.length} bytes where a ${TAR_BLOCK}-byte block was expected`,
    );
  }
  if (block.every((byte) => byte === 0)) return null;
  verifyChecksum(block);
  const name = cstring(block.subarray(0, NAME_LIMIT));
  return { name, size: parseSize(block, name) };
}

/**
 * The header checksum: the unsigned sum of every byte with the checksum field
 * itself counted as eight spaces.
 *
 * Verified because it is the ONLY integrity signal a tar header carries, and a
 * gzip whose tail was lost decompresses to a plausible-looking prefix.
 */
function verifyChecksum(block: Uint8Array): void {
  // `cstring`, not a NUL-stripping regex: the field is NUL-terminated, so
  // everything after the NUL is padding rather than content to filter.
  const storedText = cstring(block.subarray(CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_LENGTH));
  const stored = Number.parseInt(storedText.trim(), 8);
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) {
    sum +=
      i >= CHECKSUM_OFFSET && i < CHECKSUM_OFFSET + CHECKSUM_LENGTH ? 32 : (block[i] as number);
  }
  if (!Number.isFinite(stored) || stored !== sum) {
    throw new Error(
      `archive: tar header checksum ${storedText.trim()} does not match ${sum.toString(8)} — the file is corrupt`,
    );
  }
}

/**
 * The declared member size.
 *
 * The unparseable case is what this owns: a size field of spaces or garbage
 * yields NaN, and a reader that believed it would slice `[offset, offset + NaN)`
 * and hand back an EMPTY member with no error at all. Whether a size is
 * implausible RELATIVE TO THE FILE is `archive-file.ts`'s check, because only it
 * knows the file length.
 */
function parseSize(block: Uint8Array, name: string): number {
  const sizeText = cstring(block.subarray(124, 136)).trim();
  const size = Number.parseInt(sizeText, 8);
  if (!Number.isInteger(size) || size < 0 || size > SIZE_LIMIT) {
    throw new Error(
      `archive: member ${JSON.stringify(name)} declares an unreadable size ${JSON.stringify(sizeText)} — refusing to read it`,
    );
  }
  return size;
}
