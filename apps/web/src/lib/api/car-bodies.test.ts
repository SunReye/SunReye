/// <reference types="bun" />
import { expect, test } from "bun:test";
import { connect, type Transport } from "./core.ts";

const BASE = "http://core.test/prefix/";

/** A core that answers every request with `response` and keeps what it was sent. */
function answering(response: Response): Transport & { readonly sent: Request[] } {
  const sent: Request[] = [];

  return {
    base: BASE,
    sent,
    fetch: (request) => {
      sent.push(request);

      return Promise.resolve(response);
    },
  };
}

test("a car body uploads as a GLB under the prefix and answers its id", async () => {
  const transport = answering(Response.json({ id: "ab".repeat(32) }, { status: 201 }));
  const glb = new Blob([new Uint8Array([0x67, 0x6c, 0x54, 0x46])]);

  const id = await connect(transport).uploadCarBody(glb);

  const [request] = transport.sent;

  expect(id).toBe("ab".repeat(32));
  expect(request?.method).toBe("POST");
  expect(request?.url).toBe(`${BASE}api/v1/car-bodies`);
  expect(request?.headers.get("content-type")).toBe("model/gltf-binary");
  expect(new Uint8Array(await request!.arrayBuffer())).toEqual(
    new Uint8Array([0x67, 0x6c, 0x54, 0x46]),
  );
});

test("a car body reads back as its bytes, and a refusal reports its code", async () => {
  const id = "cd".repeat(32);
  const stored = answering(new Response(new Uint8Array([1, 2, 3])));

  const missing = answering(
    Response.json(
      { status: 404, code: "car.none" },
      { status: 404, headers: { "content-type": "application/problem+json" } },
    ),
  );

  const bytes = await connect(stored).carBody(id);

  expect(bytes instanceof ArrayBuffer ? [...new Uint8Array(bytes)] : bytes).toEqual([1, 2, 3]);
  expect(stored.sent[0]?.url).toBe(`${BASE}api/v1/car-bodies/${id}`);
  expect(await connect(missing).carBody(id)).toEqual({ problem: "car.none" });
});
