/**
 * THE ARCHIVE CONTAINER on a filesystem: writing a `.tar.gz` in constant memory
 * and reading one back without ever holding the readings in RAM.
 *
 * Read `./archive.ts` first — it holds the format and every decision that can be
 * made without touching a disk. This file is the part that has to survive a 2 GB
 * Home Assistant box and a truncated download.
 *
 * ## Why the readings are spooled instead of streamed inline
 *
 * A tar header declares its member's SIZE before the body, and `manifest.json`
 * carries the per-stream row counts an importer verifies against — a number only
 * known once every row has been read. Both facts force the same shape: compress
 * the readings to a spool file as they are read (constant memory), then assemble
 * the container around the finished spool. What is bought for the transient disk
 * cost is that memory never scales with the export, and that the HTTP response
 * can carry a real `Content-Length` and be resumed.
 *
 * The alternative — buffering the readings to build the header — is the thing
 * that would actually break: a full export is ~9 M rows.
 *
 * ## Why the reader gunzips to a scratch file first
 *
 * A tar is read by seeking: header block, body, padding, next header. A gzip
 * stream cannot be seeked, so a streaming reader would have to decompress the
 * whole thing to reach `manifest.json`'s neighbour — and would then have to
 * decompress it AGAIN to read the readings. One pass to a scratch `.tar` makes
 * every member randomly addressable, which is what lets the readings member be
 * read as a byte RANGE piped through its own gunzip: constant memory, one pass
 * per member, and the manifest is validated before anything large is touched.
 */

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

import {
  type ArchiveManifest,
  MEMBERS,
  TAR_BLOCK,
  parseManifest,
  parseTarHeader,
  tarEnd,
  tarHeader,
  tarPadding,
} from "./archive";

/**
 * gzip level 6, the zlib default.
 *
 * Not 9: measured on the real fixture, level 9 buys single-digit percent on
 * NDJSON that is already dominated by repeated key names, for several times the
 * CPU — and the CPU is the scarce resource on the box this has to run on.
 */
const GZIP_LEVEL = 6;

/** A member whose bytes are already in memory — the small, structural ones. */
export interface InlineMember {
  name: string;
  bytes: Uint8Array;
}

/** A member whose bytes are a file on disk — the spooled, unbounded ones. */
export interface FileMember {
  name: string;
  path: string;
  /** Compressed bytes — what the tar header must declare. */
  size: number;
  /**
   * Lines written. Carried on the member rather than recounted, because it IS
   * the per-stream count `manifest.json` publishes and an importer verifies
   * against: re-deriving it would be a second chance to be wrong.
   */
  lines: number;
}

export type ArchiveMember = InlineMember | FileMember;

const isFileMember = (member: ArchiveMember): member is FileMember => "path" in member;

/**
 * A gzip spool: lines in, one `.gz` file out, constant memory.
 *
 * Lines are joined with `\n` and buffered to {@link SPOOL_BUFFER} before being
 * handed to the compressor, because a `write()` per row across 9 M rows is 9 M
 * trips through the stream machinery for no reason.
 */
const SPOOL_BUFFER = 1 << 20;

export interface LineSpool {
  /** Append one line. The newline is added here, so callers cannot forget it. */
  write(line: string): void;
  /** Flush, close, and report what was written. */
  close(): Promise<FileMember>;
  /** Lines written so far. */
  readonly lines: number;
}

export function createLineSpool(name: string, path: string): LineSpool {
  const gzip = createGzip({ level: GZIP_LEVEL });
  const out = createWriteStream(path);
  const done = pipeline(gzip, out);
  let pending: string[] = [];
  let pendingBytes = 0;
  let lines = 0;

  const flush = () => {
    if (pending.length === 0) return;
    gzip.write(pending.join(""));
    pending = [];
    pendingBytes = 0;
  };

  return {
    get lines() {
      return lines;
    },
    write(line) {
      lines += 1;
      pending.push(line, "\n");
      pendingBytes += line.length + 1;
      if (pendingBytes >= SPOOL_BUFFER) flush();
    },
    async close() {
      flush();
      gzip.end();
      await done;
      const { size } = await stat(path);
      return { name, path, size, lines };
    },
  };
}

/**
 * Assemble the members into a gzipped tar at `out`.
 *
 * Returns the finished file's size — the number the HTTP response needs as its
 * `Content-Length` and the number the operator wants to see.
 */
export async function writeArchive(
  out: string,
  members: readonly ArchiveMember[],
): Promise<number> {
  const gzip = createGzip({ level: GZIP_LEVEL });
  const done = pipeline(gzip, createWriteStream(out));
  for (const member of members) await writeMember(gzip, member);
  gzip.write(tarEnd());
  gzip.end();
  await done;
  return (await stat(out)).size;
}

/** Header, body, padding. A file member is streamed; it is the unbounded one. */
async function writeMember(
  sink: { write(chunk: Uint8Array): unknown },
  member: ArchiveMember,
): Promise<void> {
  const size = isFileMember(member) ? member.size : member.bytes.length;
  sink.write(tarHeader(member.name, size));
  if (isFileMember(member)) {
    for await (const chunk of createReadStream(member.path)) sink.write(chunk as Uint8Array);
  } else {
    sink.write(member.bytes);
  }
  const pad = tarPadding(size);
  if (pad > 0) sink.write(new Uint8Array(pad));
}

/** Where a member's body lives in the decompressed tar. */
export interface MemberLocation {
  name: string;
  offset: number;
  size: number;
}

/**
 * Walk the header blocks of a decompressed tar and index its members.
 *
 * The two refusals here are the ones a corrupt archive actually produces. A
 * member declaring more bytes than the file HOLDS is the signature of a
 * truncated download, and it is the check that cannot live in
 * `parseTarHeader` — only this function knows the file length. Missing END
 * BLOCKS are the other half of the same failure: a tar whose last member happens
 * to land exactly on a block boundary looks complete without them.
 */
export async function indexTar(path: string): Promise<MemberLocation[]> {
  const file = Bun.file(path);
  const total = file.size;
  const members: MemberLocation[] = [];
  let offset = 0;
  let sawEnd = false;
  while (offset + TAR_BLOCK <= total) {
    const block = new Uint8Array(await file.slice(offset, offset + TAR_BLOCK).arrayBuffer());
    const header = parseTarHeader(block);
    if (header === null) {
      sawEnd = true;
      break;
    }
    const body = offset + TAR_BLOCK;
    if (body + header.size > total) {
      throw new Error(
        `archive: member ${JSON.stringify(header.name)} claims ${header.size} bytes but only ` +
          `${Math.max(0, total - body)} remain — the archive is truncated`,
      );
    }
    members.push({ name: header.name, offset: body, size: header.size });
    offset = body + header.size + tarPadding(header.size);
  }
  if (!sawEnd) {
    throw new Error(
      "archive: no end-of-archive marker — the file was truncated before it finished writing",
    );
  }
  return members;
}

/** An archive opened for reading. `close()` removes the scratch directory. */
export interface OpenArchive {
  manifest: ArchiveManifest;
  /** The parsed `config.json`, or `null` when the archive carries none. */
  config: unknown;
  members: MemberLocation[];
  /**
   * The lines of a gzipped NDJSON member, one at a time, in constant memory.
   * An absent member yields nothing — an archive with no config changes is not
   * an error.
   */
  lines(name: string): AsyncGenerator<string>;
  close(): Promise<void>;
}

/**
 * Decompress `path` into `workDir` and validate its manifest.
 *
 * The manifest is read and checked BEFORE any other member is touched, so a
 * newer-format or non-SunReye file is refused having cost one gzip pass and
 * nothing else.
 */
export async function openArchive(path: string, workDir: string): Promise<OpenArchive> {
  await mkdir(workDir, { recursive: true });
  const tar = join(workDir, "archive.tar");
  try {
    await pipeline(createReadStream(path), createGunzip(), createWriteStream(tar));
  } catch (error) {
    // A truncated or non-gzip file fails HERE, and the message must say so
    // rather than leaving the operator with a raw zlib errno.
    throw new Error(
      `archive: ${path} is not a readable gzip stream — the file is corrupt or truncated ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const members = await indexTar(tar);
  const locate = (name: string) => members.find((m) => m.name === name);

  const manifestAt = locate(MEMBERS.manifest);
  if (!manifestAt) {
    throw new Error(
      `archive: no ${MEMBERS.manifest} — this is a tar.gz, but not a SunReye archive`,
    );
  }
  const manifest = parseManifest(
    await Bun.file(tar)
      .slice(manifestAt.offset, manifestAt.offset + manifestAt.size)
      .text(),
  );

  const configAt = locate(MEMBERS.config);
  const config = configAt
    ? (JSON.parse(
        await Bun.file(tar)
          .slice(configAt.offset, configAt.offset + configAt.size)
          .text(),
      ) as unknown)
    : null;

  async function* lines(name: string): AsyncGenerator<string> {
    const at = locate(name);
    if (!at || at.size === 0) return;
    // The node stream, iterated directly: `Readable.toWeb` would add a conversion
    // whose typing is a lie under bun's lib set, and a node stream is already an
    // async iterable of chunks.
    const stream = createReadStream(tar, {
      start: at.offset,
      end: at.offset + at.size - 1,
    }).pipe(createGunzip());
    const decoder = new TextDecoder();
    let carry = "";
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      carry += decoder.decode(chunk, { stream: true });
      let nl = carry.indexOf("\n");
      while (nl !== -1) {
        yield carry.slice(0, nl);
        carry = carry.slice(nl + 1);
        nl = carry.indexOf("\n");
      }
    }
    if (carry.length > 0) yield carry;
  }

  return {
    manifest,
    config,
    members,
    lines,
    close: () => rm(workDir, { recursive: true, force: true }),
  };
}
