// The import of a v3 export (ADR 18): an archive under `/share` or uploaded, run by the core.
import { refusal, type Client, type Problem } from "./client";
import type { components } from "./schema";

export type ImportStatus = components["schemas"]["ImportStatus"];

export type ImportArchive = components["schemas"]["ImportArchive"];

export type SharedArchive = components["schemas"]["SharedArchive"];

export type ImportMapping = components["schemas"]["ImportMapping"];

type ImportStart = components["schemas"]["ImportStart"];

export interface Imports {
  /** The v3 archives under `/share`, with their devices; admin only. */
  importFiles(): Promise<readonly SharedArchive[] | Problem>;
  /** Stores an archive of at most 1 GiB for the next import; answers its devices. Admin only. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- fetch sends a plain Blob.
  uploadImport(archive: Blob): Promise<ImportArchive | Problem>;
  /** Starts importing the archive at `path` under `/share`, else the uploaded one; admin only. */
  startImport(
    path: string | undefined,
    devices: readonly Readonly<ImportMapping>[],
  ): Promise<ImportStatus | Problem>;
  /** Where the import stands; admin only. */
  importStatus(): Promise<ImportStatus | Problem>;
}

export function imports(client: Client): Imports {
  return {
    importFiles: async () => {
      const { data, error, response } = await client.GET("/api/v1/import/files");

      return data ? data.files : refusal(error, response.status);
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- fetch sends a plain Blob.
    uploadImport: async (archive) => {
      const { data, error, response } = await client.POST("/api/v1/import/upload", {
        // The generated type is the bytes' schema; the body crosses unchanged.
        body: [],
        bodySerializer: () => archive,
        headers: { "content-type": "application/gzip" },
      });

      return data ?? refusal(error, response.status);
    },
    startImport: async (path, devices) => {
      const body: ImportStart = { devices: [...devices] };

      if (path !== undefined) body.path = path;

      const { data, error, response } = await client.POST("/api/v1/import", { body });

      return data ?? refusal(error, response.status);
    },
    importStatus: async () => {
      const { data, error, response } = await client.GET("/api/v1/import");

      return data ?? refusal(error, response.status);
    },
  };
}
