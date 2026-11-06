import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import createClient from "openapi-fetch";
import type { paths } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";
import { confirmArchive, type ImportReport, uploadArchive } from "./import-client";

/** What 2.x's replay of `current-2.x` reports, recorded in the oracle fixture. */
const ORACLE = JSON.parse(
  readFileSync(
    join(
      import.meta.dir,
      "../../../../../fixtures/oracle/archives/current-2.x/expected-import.json",
    ),
    "utf8",
  ),
) as {
  result: {
    inserted: Record<string, number>;
    replays: { gaps: { start: string; end: string }[] }[];
  };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const REPORT: ImportReport = {
  read: ORACLE.result.inserted as ImportReport["read"],
  gaps: ORACLE.result.replays[0]!.gaps.map((g) => ({ device: "oracle-archive-inverter", ...g })),
  conflicts: 0,
  firstConflict: null,
};

/** The real openapi-fetch client over a canned transport; `sent` holds each request. */
function core(answer: (request: Request) => Response | Promise<Response>) {
  const sent: Request[] = [];
  const transport = async (request: Request) => {
    sent.push(request.clone());
    return answer(request);
  };
  const client = createClient<paths>({ baseUrl: "http://core.test", fetch: transport });
  return { client, sent, transport };
}

const archive = () => new File([new Uint8Array([0x1f, 0x8b, 8])], "archive.tar.gz");
const noProgress = () => {};

test("an archive without automation imports on upload: the report is the core's", async () => {
  const { client, sent, transport } = core(() => json(REPORT));
  const outcome = await uploadArchive(client, archive(), noProgress, transport);
  expect(outcome).toEqual({ kind: "imported", report: REPORT });
  expect(sent).toHaveLength(1);
  expect(sent[0]!.method).toBe("POST");
  expect(new URL(sent[0]!.url).pathname).toBe("/api/admin/import");
  expect(sent[0]!.headers.get("content-type")).toBe("application/gzip");
});

test("a 202 is the guard: its sha256 and the held values, nothing imported", async () => {
  const guarded = {
    sha256: "81b55f824dd684d899d49d1d1388b8e62a7328f51b185b0e4bdd20c350d1f5bb",
    held: [{ key: "1:peak-shaving", value: 60, capturedAt: "2026-05-01T10:00:00.000Z" }],
  };
  const { client, transport } = core(() => json(guarded, 202));
  expect(await uploadArchive(client, archive(), noProgress, transport)).toEqual({
    kind: "guarded",
    guarded,
  });
});

test("a refusal names what the core names: 400 the member, 408, 409 and 413 each their own sentence", async () => {
  const asked = async (status: number, error: string) => {
    const { client, transport } = core(() => json({ error }, status));
    return uploadArchive(client, archive(), noProgress, transport);
  };
  const reasons = {
    400: "readings.ndjson.gz: truncated at line 3",
    409: "An archive import is running: try again when it ends",
    413: "An archive is at most 536870912 bytes",
  };
  const refused = (outcome: Awaited<ReturnType<typeof asked>>) => {
    if (outcome.kind !== "refused") throw new Error(`not refused: ${outcome.kind}`);
    return outcome.message;
  };
  const texts = {
    400: refused(await asked(400, reasons[400])),
    408: refused(await asked(408, "The upload stalled: send the archive again")),
    409: refused(await asked(409, reasons[409])),
    413: refused(await asked(413, reasons[413])),
  };
  expect(texts[400]).toBe(m.import_err_400({ reason: reasons[400] }));
  expect(texts[400]).toContain("readings.ndjson.gz");
  expect(texts[408]).toBe(m.import_err_408());
  expect(texts[409]).toBe(m.import_err_409({ reason: reasons[409] }));
  expect(texts[413]).toBe(m.import_err_413({ reason: reasons[413] }));
  expect(new Set(Object.values(texts)).size).toBe(4);
});

test("a session the core refuses is told apart from a failed import", async () => {
  const asked = async (status: number) => {
    const { client, transport } = core(() => json({ error: "forbidden" }, status));
    return uploadArchive(client, archive(), noProgress, transport);
  };
  expect(await asked(403)).toEqual({ kind: "refused", message: m.import_err_denied() });
  expect(await asked(401)).toEqual({ kind: "refused", message: m.import_err_denied() });
  expect(await asked(500)).toEqual({
    kind: "refused",
    message: m.import_err_other({ reason: "forbidden" }),
  });
});

test("a body that is not the core's error still reads as a sentence, never an object", async () => {
  const { client, transport } = core(() => new Response("bad gateway", { status: 502 }));
  const outcome = await uploadArchive(client, archive(), noProgress, transport);
  expect(outcome).toEqual({
    kind: "refused",
    message: m.import_err_other({ reason: "bad gateway" }),
  });
});

test("a dropped connection mid-upload is its own message and a retry", async () => {
  const { client, transport } = core(() => Promise.reject(new TypeError("Failed to fetch")));
  expect(await uploadArchive(client, archive(), noProgress, transport)).toEqual({
    kind: "refused",
    message: m.import_err_network(),
  });
});

test("a zero-byte file is refused before anything is sent, a one-byte file is not", async () => {
  const { client, sent, transport } = core(() => json(REPORT));
  const empty = new File([], "empty.tar.gz");
  expect(await uploadArchive(client, empty, noProgress, transport)).toEqual({
    kind: "refused",
    message: m.import_empty_file(),
  });
  expect(sent).toHaveLength(0);
  const one = await uploadArchive(
    client,
    new File([new Uint8Array([1])], "one.tar.gz"),
    noProgress,
    transport,
  );
  expect(one.kind).toBe("imported");
});

test("confirming sends the sha256 it was given and nothing else", async () => {
  const { client, sent } = core(() => json(REPORT));
  const sha256 = "81b55f824dd684d899d49d1d1388b8e62a7328f51b185b0e4bdd20c350d1f5bb";
  expect(await confirmArchive(client, sha256)).toEqual({ kind: "imported", report: REPORT });
  expect(new URL(sent[0]!.url).pathname).toBe("/api/admin/import/confirm");
  expect(await sent[0]!.json()).toEqual({ sha256 });
});

test("a confirmation the core does not hold is a 409 sentence, and a drop is a retry", async () => {
  const held = core(() =>
    json({ error: "No upload awaits confirmation for that archive: upload it again" }, 409),
  );
  expect(await confirmArchive(held.client, "ab")).toEqual({
    kind: "refused",
    message: m.import_err_409({
      reason: "No upload awaits confirmation for that archive: upload it again",
    }),
  });
  const dropped = core(() => Promise.reject(new TypeError("Failed to fetch")));
  expect(await confirmArchive(dropped.client, "ab")).toEqual({
    kind: "refused",
    message: m.import_err_network(),
  });
});
