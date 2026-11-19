// The core's OpenAPI document, for the API reference (ADR 9, 11). It is served beside the API,
// not in it, so it is read through the transport rather than the generated client.
import { refusal, type Problem } from "./client";
import type { Transport } from "./core";

/** An OpenAPI document as the core serves it; its other members ride along unread. */
export interface ApiDocument {
  readonly openapi: string;
  readonly servers: readonly Readonly<{ url: string }>[];
}

export interface Reference {
  /** The core's OpenAPI document, its server the core's root under any prefix. */
  reference(): Promise<ApiDocument | Problem>;
}

function isDocument(value: unknown): value is Omit<ApiDocument, "servers"> {
  return value instanceof Object && "openapi" in value && String(value.openapi) === value.openapi;
}

export function reference({ base, fetch }: Transport): Reference {
  return {
    reference: async () => {
      const response = await fetch(new Request(new URL("openapi.json", base)));

      if (!response.ok) return refusal("", response.status);

      const document: unknown = await response.json();

      // A proxy may answer with a page of its own.
      if (!isDocument(document)) return refusal("", 502);

      // Its paths start with `/`, so the root goes without its own.
      return {
        ...document,
        servers: [{ url: base.replace(/\/$/u, "") }],
      };
    },
  };
}
