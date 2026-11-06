/** The slice of `XMLHttpRequest` the transport drives. */
export type XhrLike = Pick<
  XMLHttpRequest,
  | "open"
  | "setRequestHeader"
  | "send"
  | "getAllResponseHeaders"
  | "withCredentials"
  | "status"
  | "responseText"
  | "onload"
  | "onerror"
> & { upload: Pick<XMLHttpRequestUpload, "onprogress"> };

function responseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return headers;
}

/**
 * A `fetch` for one request that sends `file` and reports upload progress, for `openapi-fetch`'s
 * per-request `fetch`. XHR upload events, not a stream wrapper: a streamed request body needs HTTP/2
 * (`duplex: "half"`) and Firefox and Safari lack it, while the core serves HTTP/1.1.
 *
 * `file` goes out as it is, so memory does not hold the archive; the `Request` only supplies method, url,
 * headers and credentials. A dropped connection rejects with a `TypeError`, as `fetch` does.
 */
export function uploadTransport(
  file: Blob,
  onProgress: (sent: number, total: number) => void,
  make: () => XhrLike = () => new XMLHttpRequest(),
): (request: Request) => Promise<Response> {
  return (request) =>
    new Promise((resolve, reject) => {
      const xhr = make();
      xhr.open(request.method, request.url);
      request.headers.forEach((value, name) => xhr.setRequestHeader(name, value));
      xhr.withCredentials = request.credentials === "include";
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
      xhr.onload = () =>
        resolve(
          new Response(xhr.responseText, {
            status: xhr.status,
            headers: responseHeaders(xhr.getAllResponseHeaders()),
          }),
        );
      xhr.onerror = () => reject(new TypeError("Network error"));
      xhr.send(file);
    });
}
