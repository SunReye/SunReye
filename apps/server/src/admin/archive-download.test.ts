/**
 * THE EXPORT DOWNLOAD's decisions, without a database or a filesystem.
 *
 * Two of them are load-bearing on the box this has to run on:
 *
 *  * WHERE THE SPOOL GOES. `/tmp` is a TMPFS on a Home Assistant box, so
 *    spooling a full export there does not use disk — it uses RAM, on a 2 GB
 *    machine, which is the exact failure the streaming design exists to avoid.
 *  * WHAT THE FILE IS CALLED. It lands in `/share`, which is read over Samba, so
 *    a colon in the name makes it unopenable on a Windows client.
 */
import { describe, expect, test } from "bun:test";

import { SPOOL_CANDIDATES, exportFilename, isStaleSpool, pickSpoolRoot } from "./archive-download";

describe("pickSpoolRoot", () => {
  test("prefers a persistent candidate over the system temp dir", () => {
    // On the addon `/data` is the persistent datadir and `/tmp` is a tmpfs.
    expect(pickSpoolRoot(["/data", "/var/tmp"], (path) => path === "/data")).toBe("/data");
  });

  test("the PRIVATE directory is preferred over the LAN-visible one", () => {
    // `/share` is served to the whole LAN by the Samba add-on. The download spool
    // is transient and has no business being visible there, even briefly.
    expect(SPOOL_CANDIDATES[0]).toBe("/data");
    expect(SPOOL_CANDIDATES.indexOf("/data")).toBeLessThan(SPOOL_CANDIDATES.indexOf("/share"));
  });

  test("falls through to the next candidate when the first is absent", () => {
    expect(pickSpoolRoot(["/data", "/var/tmp"], (path) => path === "/var/tmp")).toBe("/var/tmp");
  });

  test("returns null when no candidate exists, so the caller can use os.tmpdir()", () => {
    expect(pickSpoolRoot(["/data"], () => false)).toBeNull();
  });

  test("an empty candidate list is null rather than an empty path", () => {
    expect(pickSpoolRoot([], () => true)).toBeNull();
  });

  test("the order of the candidates is the priority, and it is honoured", () => {
    expect(pickSpoolRoot(["/a", "/b"], () => true)).toBe("/a");
  });
});

describe("exportFilename", () => {
  test("carries the date, so two exports do not collide in a shared folder", () => {
    expect(exportFilename(new Date("2026-08-27T19:41:58.476Z"))).toContain("2026-08-27");
  });

  test("is a .tar.gz", () => {
    expect(exportFilename(new Date())).toEndWith(".tar.gz");
  });

  test("has no character Samba or Windows would refuse", () => {
    const name = exportFilename(new Date("2026-08-27T19:41:58.476Z"));
    expect(name).not.toMatch(/[:*?"<>|\\/\s]/);
  });

  test("is deterministic for one instant", () => {
    const at = new Date("2026-08-27T19:41:58.476Z");
    expect(exportFilename(at)).toBe(exportFilename(at));
  });
});

describe("isStaleSpool", () => {
  const now = new Date("2026-08-27T12:00:00Z").getTime();
  const HOUR = 3_600_000;

  test("a spool from a finished download is stale and can be swept", () => {
    expect(isStaleSpool({ mtimeMs: now - 3 * HOUR }, now)).toBe(true);
  });

  test("a spool a download may still be streaming from is NOT swept", () => {
    // Deleting it mid-stream would truncate the operator's download with no error.
    expect(isStaleSpool({ mtimeMs: now - 60_000 }, now)).toBe(false);
  });

  test("a spool from the future is not stale — a clock jump must not delete live work", () => {
    expect(isStaleSpool({ mtimeMs: now + HOUR }, now)).toBe(false);
  });

  test("exactly at the boundary is not yet stale", () => {
    expect(isStaleSpool({ mtimeMs: now - HOUR }, now)).toBe(false);
  });
});
