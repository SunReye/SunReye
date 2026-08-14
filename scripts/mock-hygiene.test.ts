import { describe, expect, test } from "bun:test";
import { callBody, violations } from "./mock-hygiene";

const at = (source: string) => violations(source, "some.test.ts").map((v) => v.specifier);

describe("callBody", () => {
  test("returns the call's text, balanced across nested parens", () => {
    expect(callBody(`mock.module("./a", () => ({ x: f(1) }));`, 0)).toBe(
      `("./a", () => ({ x: f(1) }))`,
    );
  });

  test("stops at the matching paren, not the first one", () => {
    expect(callBody(`a(b()) after`, 0)).toBe("(b())");
  });

  test("no paren at all yields nothing rather than throwing", () => {
    expect(callBody("no call here", 0)).toBe("");
  });

  test("unbalanced source yields the rest, so a truncated file cannot hide a mock", () => {
    expect(callBody(`mock.module("./a", () => ({ x: 1 })`, 0)).toContain("./a");
  });
});

describe("violations", () => {
  // The defect this encodes: a `./config` mock that returned only
  // `getMqttConfig` deleted `getInverterConfig` for every test file that ran
  // afterwards, because mock.module is process-global and permanent. A later
  // file died at import with "Export named 'getInverterConfig' not found",
  // which took down its own mock registrations and failed four unrelated tests
  // — on CI only, since it depends on the runner's file order.
  test("a workspace-local mock without a spread is a violation", () => {
    expect(at(`mock.module("./config", () => ({ getMqttConfig: async () => ({}) }));`)).toEqual([
      "./config",
    ]);
  });

  test("spreading the real module clears it", () => {
    expect(
      at(`mock.module("./config", () => ({ ...real, getMqttConfig: async () => ({}) }));`),
    ).toEqual([]);
  });

  test("workspace packages count as local", () => {
    expect(at(`mock.module("@SunReye/db", () => ({ db: fake }));`)).toEqual(["@SunReye/db"]);
    expect(at(`mock.module("@SunReye/db", () => ({ ...realDb, db: fake }));`)).toEqual([]);
  });

  test("subpath imports of a workspace package count too", () => {
    expect(at(`mock.module("@SunReye/db/tariff", () => ({ x: 1 }));`)).toEqual([
      "@SunReye/db/tariff",
    ]);
  });

  // Third-party modules are a different situation: a test stubs `mqtt` wholesale
  // precisely so nothing real is reachable, and there is no in-repo import chain
  // to break.
  test("third-party modules are not checked", () => {
    expect(at(`mock.module("mqtt", () => ({ default: { connect: () => fake } }));`)).toEqual([]);
    expect(at(`mock.module("node:fs", () => ({ readFileSync: () => "" }));`)).toEqual([]);
  });

  test("several mocks in one file are reported individually", () => {
    const source = [
      `mock.module("./a", () => ({ x: 1 }));`,
      `mock.module("./b", () => ({ ...realB, y: 2 }));`,
      `mock.module("./c", () => ({ z: 3 }));`,
    ].join("\n");
    expect(at(source)).toEqual(["./a", "./c"]);
  });

  test("a multi-line mock body is read whole, not line by line", () => {
    const source = [
      `mock.module("./config", () => ({`,
      `  ...realConfig,`,
      `  getMqttConfig: async () => ({ brokerUrl: "mqtt://broker.test:1883" }),`,
      `}));`,
    ].join("\n");
    expect(at(source)).toEqual([]);
  });

  test("a multi-line mock without a spread is still caught", () => {
    const source = [
      `mock.module("./config", () => ({`,
      `  getMqttConfig: async () => ({ brokerUrl: "mqtt://broker.test:1883" }),`,
      `}));`,
    ].join("\n");
    expect(at(source)).toEqual(["./config"]);
  });

  test("single quotes and extra whitespace are handled", () => {
    expect(at(`mock . module ( './config' , () => ({ a: 1 }) );`)).toEqual(["./config"]);
  });

  test("a file with no mocks has no violations", () => {
    expect(at(`import { test } from "bun:test";\ntest("x", () => {});`)).toEqual([]);
  });

  test("the violation carries the file and the line for the message", () => {
    const source = `const a = 1;\nmock.module("./config", () => ({ x: 1 }));`;
    const [found] = violations(source, "apps/server/src/evcc.test.ts");
    expect(found?.file).toBe("apps/server/src/evcc.test.ts");
    expect(found?.line).toBe(2);
  });

  // Some modules cannot be spread: importing the real one runs the very
  // initialization the suite mocks it to avoid (@SunReye/auth boots Better Auth,
  // which reads env and a DB). Those mocks stay knowingly partial, and the
  // suppression records who decided that and why.
  test("a suppression with a reason is honoured", () => {
    const source = [
      `// mock-hygiene-ignore-next-line -- importing real auth boots Better Auth`,
      `mock.module("@SunReye/auth", () => ({ auth: fake }));`,
    ].join("\n");
    expect(at(source)).toEqual([]);
  });

  test("a suppression without a reason does not count", () => {
    const source = [
      `// mock-hygiene-ignore-next-line`,
      `mock.module("@SunReye/auth", () => ({ auth: fake }));`,
    ].join("\n");
    expect(at(source)).toEqual(["@SunReye/auth"]);
  });

  test("a suppression only covers the line that follows it", () => {
    const source = [
      `// mock-hygiene-ignore-next-line -- boots a broker`,
      `mock.module("./a", () => ({ x: 1 }));`,
      `mock.module("./b", () => ({ y: 2 }));`,
    ].join("\n");
    expect(at(source)).toEqual(["./b"]);
  });

  // A spread belonging to a nested object inside the factory does not prove the
  // module itself was spread, but demanding a spread of the FIRST property would
  // reject legitimate orderings. Accepting any spread keeps the rule simple and
  // its failure mode is a false pass, not a false block.
  test("any spread in the factory body is accepted", () => {
    expect(at(`mock.module("./a", () => ({ nested: { ...bits }, x: 1 }));`)).toEqual([]);
  });
});
