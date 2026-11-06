import type { Client } from "openapi-fetch";
import { apiErrorText } from "$lib/api-error";
import type { components, paths } from "$lib/core-api.gen";
import * as m from "$lib/paraglide/messages";
import { uploadTransport } from "./upload-transport";

export type Guarded = components["schemas"]["Guarded"];
export type ImportReport = components["schemas"]["ImportReport"];

/** What an upload or a confirmation came to; a refusal carries the sentence to show. */
export type Outcome =
  | { kind: "imported"; report: ImportReport }
  | { kind: "guarded"; guarded: Guarded }
  | { kind: "refused"; message: string };

/** The refusal for a file with nothing in it, or null. */
function emptyFileMessage(file: Blob): string | null {
  return file.size === 0 ? m.import_empty_file() : null;
}

/** One readable sentence per refusal the core makes; the core's own reason rides in where it names one. */
function refusalText(status: number, error: unknown): string {
  const reason = apiErrorText(error, String(status));
  switch (status) {
    case 400:
      return m.import_err_400({ reason });
    case 408:
      return m.import_err_408();
    case 409:
      return m.import_err_409({ reason });
    case 413:
      return m.import_err_413({ reason });
    case 401:
    case 403:
      return m.import_err_denied();
    default:
      return m.import_err_other({ reason });
  }
}

const refused = (message: string): Outcome => ({ kind: "refused", message });

/** A dead connection throws; the answer is a retry, whatever was sent. */
async function settle(
  send: () => Promise<{ data?: Guarded | ImportReport; error?: unknown; response: Response }>,
): Promise<Outcome> {
  try {
    const { data, error, response } = await send();
    if (data === undefined) return refused(refusalText(response.status, error));
    return "sha256" in data
      ? { kind: "guarded", guarded: data }
      : { kind: "imported", report: data };
  } catch {
    return refused(m.import_err_network());
  }
}

/**
 * Sends the archive file as it is, with `onProgress(sent, total)` as bytes leave. A zero-byte file never
 * leaves the page.
 */
export async function uploadArchive(
  client: Client<paths>,
  file: File,
  onProgress: (sent: number, total: number) => void,
  transport: (request: Request) => Promise<Response> = uploadTransport(file, onProgress),
): Promise<Outcome> {
  const empty = emptyFileMessage(file);
  if (empty) return refused(empty);
  return settle(() =>
    client.POST("/api/admin/import", {
      // The body is the file itself, sent by the transport; the serializer must not encode it.
      body: file as unknown as string,
      bodySerializer: (body) => body,
      headers: { "Content-Type": "application/gzip" },
      fetch: transport,
    }),
  );
}

/** Imports the upload the guard held: the confirmation names the sha256 the guard answered with. */
export function confirmArchive(client: Client<paths>, sha256: string): Promise<Outcome> {
  return settle(() => client.POST("/api/admin/import/confirm", { body: { sha256 } }));
}
