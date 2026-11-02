import { afterEach, describe, expect, it } from "bun:test";
import { cn, downloadText } from "./utils";

describe("cn", () => {
  it("joins classes and drops falsy entries", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });

  it("lets the later Tailwind utility win a conflict", () => {
    expect(cn("p-2 text-sm", "p-4")).toBe("text-sm p-4");
  });
});

describe("downloadText", () => {
  const realDocument = globalThis.document;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  afterEach(() => {
    globalThis.document = realDocument;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  });

  it("clicks a transient anchor named for the file, then cleans up", () => {
    const log: string[] = [];
    const anchor = {
      href: "",
      download: "",
      click: () => log.push(`click ${anchor.download} ${anchor.href}`),
      remove: () => log.push("remove"),
    };
    globalThis.document = {
      createElement: () => anchor,
      body: { appendChild: () => log.push("append") },
    } as unknown as Document;
    let blob: Blob | undefined;
    URL.createObjectURL = (b) => {
      blob = b as Blob;
      return "blob:x";
    };
    URL.revokeObjectURL = (u) => void log.push(`revoke ${u}`);

    downloadText("log.txt", "hello");

    expect(log).toEqual(["append", "click log.txt blob:x", "remove", "revoke blob:x"]);
    expect(blob?.type).toBe("text/plain;charset=utf-8");
    expect(blob?.size).toBe(5);
  });
});
