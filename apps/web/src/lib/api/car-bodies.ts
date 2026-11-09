// Uploaded car bodies (ADR 20): GLB files the admin uploads for a car place, named by digest.
import { refusal, type Client, type Problem } from "./client";

export interface CarBodies {
  /** Stores a GLB of at most 20 MB; answers its id. Admin only. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- fetch sends a plain Blob.
  uploadCarBody(glb: Blob): Promise<string | Problem>;
  /** An uploaded body's bytes. */
  carBody(id: string): Promise<ArrayBuffer | Problem>;
}

export function carBodies(client: Client): CarBodies {
  return {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- fetch sends a plain Blob.
    uploadCarBody: async (glb) => {
      const { data, error, response } = await client.POST("/api/v1/car-bodies", {
        // The generated type is the bytes' schema; the body crosses unchanged.
        body: [],
        bodySerializer: () => glb,
        headers: { "content-type": "model/gltf-binary" },
      });

      return data ? data.id : refusal(error, response.status);
    },
    carBody: async (id) => {
      const { data, error, response } = await client.GET("/api/v1/car-bodies/{id}", {
        params: { path: { id } },
        parseAs: "arrayBuffer",
      });

      return data ?? refusal(error, response.status);
    },
  };
}
