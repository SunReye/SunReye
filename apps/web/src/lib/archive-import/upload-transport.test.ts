import { expect, test } from "bun:test";
import { uploadTransport, type XhrLike } from "./upload-transport";

/** The slice of XMLHttpRequest the transport drives; the test plays the network. */
class FakeXhr {
  upload: XhrLike["upload"] = { onprogress: null };
  onload: XhrLike["onload"] = null;
  onerror: XhrLike["onerror"] = null;
  withCredentials = false;
  status = 0;
  responseText = "";
  opened: [string, string] | null = null;
  headers: Record<string, string> = {};
  sent: unknown = null;
  open(method: string, url: string) {
    this.opened = [method, url];
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.sent = body;
  }
  getAllResponseHeaders() {
    return "content-type: application/json\r\nx-other: 1\r\n";
  }
  /** Delivers `onload` / `onerror`, whose event the transport ignores. */
  fire(handler: "onload" | "onerror") {
    (this[handler] as (e: unknown) => void)?.(undefined);
  }
  progress(loaded: number, total: number, lengthComputable = true) {
    const event = { lengthComputable, loaded, total } as ProgressEvent;
    (this.upload.onprogress as ((e: ProgressEvent) => void) | null)?.(event);
  }
}

const asXhr = (xhr: FakeXhr) => () => xhr as unknown as XhrLike;

const request = () =>
  new Request("http://core.test/api/admin/import", {
    method: "POST",
    headers: { "Content-Type": "application/gzip" },
    body: "ignored",
    credentials: "include",
  });

test("sends the file itself with the request's method, url, headers and credentials", async () => {
  const xhr = new FakeXhr();
  const file = new File(["archive bytes"], "a.tar.gz");
  const answered = uploadTransport(file, () => {}, asXhr(xhr))(request());
  expect(xhr.opened).toEqual(["POST", "http://core.test/api/admin/import"]);
  expect(xhr.headers["content-type"]).toBe("application/gzip");
  expect(xhr.withCredentials).toBe(true);
  expect(xhr.sent).toBe(file);
  xhr.status = 202;
  xhr.responseText = '{"sha256":"ab"}';
  xhr.fire("onload");
  const response = await answered;
  expect(response.status).toBe(202);
  expect(response.headers.get("content-type")).toBe("application/json");
  expect(await response.json()).toEqual({ sha256: "ab" });
});

test("reports the bytes sent of the bytes in all, and nothing while the total is unknown", () => {
  const xhr = new FakeXhr();
  const seen: [number, number][] = [];
  void uploadTransport(
    new File(["x"], "a"),
    (sent, total) => seen.push([sent, total]),
    asXhr(xhr),
  )(request());
  xhr.progress(0, 40);
  xhr.progress(10, 0, false);
  xhr.progress(40, 40);
  expect(seen).toEqual([
    [0, 40],
    [40, 40],
  ]);
});

test("a dropped connection rejects as fetch does, a TypeError", async () => {
  const xhr = new FakeXhr();
  const answered = uploadTransport(new File(["x"], "a"), () => {}, asXhr(xhr))(request());
  xhr.fire("onerror");
  await expect(answered).rejects.toBeInstanceOf(TypeError);
});
