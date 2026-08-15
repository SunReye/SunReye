import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type HygieneIo,
  afterAllBodies,
  callBody,
  liveRestores,
  main,
  productionIo,
  testFiles,
  unrestored,
  violations,
} from "./mock-hygiene";

const at = (source: string) => violations(source, "some.test.ts").map((v) => v.specifier);
const un = (source: string) => unrestored(source, "some.test.ts").map((v) => v.specifier);
const live = (source: string) => liveRestores(source, "some.test.ts").map((v) => v.specifier);

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

  // What proves a spread is the three-dot token, not any run of dots. A factory
  // that merely mentions a relative path still replaces the module wholesale, so
  // matching on ".." would let the exact bug this checker exists to catch pass.
  test("a relative path in the factory is not mistaken for a spread", () => {
    expect(at(`mock.module("./config", () => ({ fixture: load("../fixtures/a.json") }));`)).toEqual(
      ["./config"],
    );
  });
});

describe("afterAllBodies", () => {
  test("returns the text of each afterAll call, balanced across nested parens", () => {
    const source = `afterAll(() => { mock.module("./a", () => ({ ...realA })); });`;
    expect(afterAllBodies(source)).toEqual([
      `(() => { mock.module("./a", () => ({ ...realA })); })`,
    ]);
  });

  test("an async teardown is read the same way", () => {
    expect(afterAllBodies(`afterAll(async () => { await close(); });`)).toEqual([
      `(async () => { await close(); })`,
    ]);
  });

  test("several teardowns are each returned", () => {
    const source = [`afterAll(() => a());`, `describe("x", () => { afterAll(() => b()); });`].join(
      "\n",
    );
    expect(afterAllBodies(source)).toEqual(["(() => a())", "(() => b())"]);
  });

  test("a file with no teardown yields nothing", () => {
    expect(afterAllBodies(`afterEach(() => reset());`)).toEqual([]);
  });
});

describe("unrestored", () => {
  // The defect this encodes: `apps/server/src/prices/spot-price-job.test.ts`
  // stubbed `@SunReye/db/spot-price` with a correct spread — and the stub stayed
  // installed for the rest of the process, so `packages/db/src/spot-price.test.ts`,
  // the suite that unit-tests that very module, asserted against the double and
  // went 22-tests-red with "no query was issued", while passing in isolation.
  test("a first-party mock the file never hands back is a violation", () => {
    expect(un(`mock.module("./config", () => ({ ...real, getMqttConfig: stub }));`)).toEqual([
      "./config",
    ]);
  });

  test("restoring the same specifier in afterAll clears it", () => {
    const source = [
      `mock.module("./config", () => ({ ...real, getMqttConfig: stub }));`,
      `afterAll(() => {`,
      `  mock.module("./config", () => ({ ...realExports }));`,
      `});`,
    ].join("\n");
    expect(un(source)).toEqual([]);
  });

  // The rule is about a specifier being handed back, not about the file owning a
  // teardown: a suite with an unrelated afterAll still leaks its stub.
  test("a teardown that restores something else does not clear it", () => {
    const source = [
      `mock.module("./config", () => ({ ...real, getMqttConfig: stub }));`,
      `afterAll(() => {`,
      `  mock.module("./clock", () => ({ ...realClock }));`,
      `});`,
    ].join("\n");
    expect(un(source)).toEqual(["./config"]);
  });

  test("a teardown that re-mocks nothing does not clear it", () => {
    const source = [
      `mock.module("@SunReye/db/spot-price", () => ({ ...realDb, getSpotPrices: stub }));`,
      `afterAll(() => {`,
      `  globalThis.fetch = realFetch;`,
      `});`,
    ].join("\n");
    expect(un(source)).toEqual(["@SunReye/db/spot-price"]);
  });

  // `afterAll` written in prose, or as the name of something else, installs no
  // teardown — only a call does.
  test("the word afterAll outside a call does not count as a restore", () => {
    const source = [
      `// restored in afterAll below, honest`,
      `mock.module("./config", () => ({ ...real, stub }));`,
    ].join("\n");
    expect(un(source)).toEqual(["./config"]);
  });

  // Restoring inside afterEach would hand the module back between tests of this
  // very file, undoing the stub the rest of the suite depends on.
  test("a restore in afterEach is not a restore", () => {
    const source = [
      `mock.module("./config", () => ({ ...real, stub }));`,
      `afterEach(() => {`,
      `  mock.module("./config", () => ({ ...realExports }));`,
      `});`,
    ].join("\n");
    expect(un(source)).toEqual(["./config"]);
  });

  test("the restoring call inside the teardown does not itself demand a restore", () => {
    const source = [
      `afterAll(() => {`,
      `  mock.module("./config", () => ({ ...real }));`,
      `});`,
    ].join("\n");
    expect(un(source)).toEqual([]);
  });

  // Third-party modules are exempt exactly as they are from the spread rule:
  // nothing in this repo unit-tests `mqtt`, so nothing downstream can be fooled.
  test("third-party modules are not checked", () => {
    expect(un(`mock.module("mqtt", () => ({ connect: fake }));`)).toEqual([]);
    expect(un(`mock.module("node:fs", () => ({ readFileSync: () => "" }));`)).toEqual([]);
  });

  test("workspace packages and their subpaths count as first-party", () => {
    expect(un(`mock.module("@SunReye/db", () => ({ ...realDb, db: fake }));`)).toEqual([
      "@SunReye/db",
    ]);
    expect(un(`mock.module("@SunReye/db/tariff", () => ({ ...realTariff }));`)).toEqual([
      "@SunReye/db/tariff",
    ]);
  });

  test("each specifier is judged on its own, restored or not", () => {
    const source = [
      `mock.module("./a", () => ({ ...realA, x: 1 }));`,
      `mock.module("./b", () => ({ ...realB, y: 2 }));`,
      `afterAll(() => {`,
      `  mock.module("./b", () => ({ ...realBExports }));`,
      `});`,
    ].join("\n");
    expect(un(source)).toEqual(["./a"]);
  });

  // One restore discharges the obligation however many times the stub was
  // installed, so the same specifier is named once rather than per call site.
  test("a specifier mocked twice is reported once", () => {
    const source = [
      `mock.module("./a", () => ({ ...realA, x: 1 }));`,
      `mock.module("./a", () => ({ ...realA, x: 2 }));`,
    ].join("\n");
    expect(un(source)).toEqual(["./a"]);
  });

  test("a multi-line teardown with nested calls is read whole", () => {
    const source = [
      `mock.module("@SunReye/db/spot-price", () => ({ ...realDb, getSpotPrices: stub }));`,
      `afterAll(() => {`,
      `  globalThis.fetch = realFetch;`,
      `  table.clear();`,
      `  mock.module("@SunReye/db/spot-price", () => ({ ...realDbExports }));`,
      `});`,
    ].join("\n");
    expect(un(source)).toEqual([]);
  });

  test("single quotes and extra whitespace are handled on both sides", () => {
    const source = [
      `mock . module ( './config' , () => ({ ...real }) );`,
      `afterAll ( () => { mock.module('./config', () => ({ ...realExports })); } );`,
    ].join("\n");
    expect(un(source)).toEqual([]);
  });

  test("a file with no mocks has nothing to restore", () => {
    expect(un(`import { test } from "bun:test";\ntest("x", () => {});`)).toEqual([]);
  });

  test("the violation carries the file and the line of the install", () => {
    const source = `const a = 1;\nmock.module("./config", () => ({ ...real }));`;
    const [found] = unrestored(source, "apps/server/src/evcc.test.ts");
    expect(found?.file).toBe("apps/server/src/evcc.test.ts");
    expect(found?.line).toBe(2);
  });

  // A module that cannot be imported for real cannot be snapshotted for real
  // either, so the one escape hatch covers both rules.
  test("a suppression with a reason is honoured", () => {
    const source = [
      `// mock-hygiene-ignore-next-line -- importing real auth boots Better Auth`,
      `mock.module("@SunReye/auth", () => ({ auth: fake }));`,
    ].join("\n");
    expect(un(source)).toEqual([]);
  });

  test("a suppression without a reason does not count", () => {
    const source = [
      `// mock-hygiene-ignore-next-line`,
      `mock.module("@SunReye/auth", () => ({ auth: fake }));`,
    ].join("\n");
    expect(un(source)).toEqual(["@SunReye/auth"]);
  });
});

describe("liveRestores", () => {
  // The trap inside the fix, and the one the other two rules cannot see: the
  // mock spreads (rule one) and the file hands the module back (rule two), so
  // both checks pass — but the teardown hands back the LIVE namespace, and a
  // namespace is live, so by then `realDb.getSpotPrices` IS the stub. The
  // restore re-installs the double and the leak survives, silently.
  test("a restore that hands back the live namespace is a violation", () => {
    const source = [
      `const realDb = await import("@SunReye/db/spot-price");`,
      `mock.module("@SunReye/db/spot-price", () => ({ ...realDb, getSpotPrices: stub }));`,
      `afterAll(() => {`,
      `  mock.module("@SunReye/db/spot-price", () => ({ ...realDb }));`,
      `});`,
    ].join("\n");
    expect(live(source)).toEqual(["@SunReye/db/spot-price"]);
  });

  test("a restore that hands back a by-value snapshot is clean", () => {
    const source = [
      `const realDb = await import("@SunReye/db/spot-price");`,
      `const realDbExports = { ...realDb };`,
      `mock.module("@SunReye/db/spot-price", () => ({ ...realDb, getSpotPrices: stub }));`,
      `afterAll(() => {`,
      `  mock.module("@SunReye/db/spot-price", () => ({ ...realDbExports }));`,
      `});`,
    ].join("\n");
    expect(live(source)).toEqual([]);
  });

  // Snapshotting at the import itself is the same trick spelled shorter, and it
  // is just as sound: the object is built by value before any mock is installed.
  test("a snapshot taken at the import is clean", () => {
    const source = [
      `const realX = { ...(await import("./x")) };`,
      `mock.module("./x", () => ({ ...realX, doThing: stub }));`,
      `afterAll(() => {`,
      `  mock.module("./x", () => ({ ...realX }));`,
      `});`,
    ].join("\n");
    expect(live(source)).toEqual([]);
  });

  // Only the teardown is judged. The install is *supposed* to spread the live
  // namespace — that is what keeps the other exports alive.
  test("spreading the live namespace in the install is not a violation", () => {
    const source = [
      `const realDb = await import("@SunReye/db");`,
      `const realDbExports = { ...realDb };`,
      `mock.module("@SunReye/db", () => ({ ...realDb, db: fake }));`,
      `afterAll(() => mock.module("@SunReye/db", () => ({ ...realDbExports })));`,
    ].join("\n");
    expect(live(source)).toEqual([]);
  });

  test("a destructured import does not make a namespace binding", () => {
    const source = [
      `const { log } = await import("../shared/logging");`,
      `const realLogging = await import("../shared/logging");`,
      `const realLoggingExports = { ...realLogging };`,
      `mock.module("../shared/logging", () => ({ ...realLogging, log: stub }));`,
      `afterAll(() => mock.module("../shared/logging", () => ({ ...realLoggingExports })));`,
    ].join("\n");
    expect(live(source)).toEqual([]);
  });

  // Third-party modules are exempt from this rule for the same reason as the
  // other two: no suite here unit-tests `mqtt`, so no later file is fooled.
  test("third-party restores are not checked", () => {
    const source = [
      `const realMqtt = await import("mqtt");`,
      `afterAll(() => mock.module("mqtt", () => ({ ...realMqtt })));`,
    ].join("\n");
    expect(live(source)).toEqual([]);
  });

  test("each specifier is judged on its own", () => {
    const source = [
      `const realA = await import("./a");`,
      `const realB = await import("./b");`,
      `const realBExports = { ...realB };`,
      `afterAll(() => {`,
      `  mock.module("./a", () => ({ ...realA }));`,
      `  mock.module("./b", () => ({ ...realBExports }));`,
      `});`,
    ].join("\n");
    expect(live(source)).toEqual(["./a"]);
  });

  test("the violation carries the file and the line of the restore", () => {
    const source = [
      `const realDb = await import("@SunReye/db");`,
      `afterAll(() => {`,
      `  mock.module("@SunReye/db", () => ({ ...realDb }));`,
      `});`,
    ].join("\n");
    const [found] = liveRestores(source, "apps/server/src/cost.test.ts");
    expect(found?.file).toBe("apps/server/src/cost.test.ts");
    expect(found?.line).toBe(3);
  });

  test("a file with no teardown has no restore to judge", () => {
    const source = [
      `const realDb = await import("@SunReye/db");`,
      `mock.module("@SunReye/db", () => ({ ...realDb, db: fake }));`,
    ].join("\n");
    expect(live(source)).toEqual([]);
  });

  test("a suppression with a reason is honoured", () => {
    const source = [
      `const realAuth = await import("@SunReye/auth");`,
      `afterAll(() => {`,
      `  // mock-hygiene-ignore-next-line -- real auth boots Better Auth`,
      `  mock.module("@SunReye/auth", () => ({ ...realAuth }));`,
      `});`,
    ].join("\n");
    expect(live(source)).toEqual([]);
  });
});

describe("testFiles", () => {
  let root: string;

  // A miniature workspace: the walk has to find colocated tests at any depth,
  // and skip the trees that are not ours to police.
  const tree = [
    "apps/web/src/lib/api-payload.test.ts",
    "apps/web/src/lib/components/inverter/measured-day.test.ts",
    "apps/web/src/lib/api-payload.ts",
    "apps/web/src/lib/notes.md",
    "apps/web/node_modules/some-dep/index.test.ts",
    "apps/web/dist/lib/api-payload.test.ts",
    "packages/db/src/tariff.test.ts",
    "packages/db/src/tariff.test.js",
    "packages/db/src/tariff.test.d.ts",
    "scripts/mock-hygiene.test.ts",
    "scripts/coverage-floor.test.ts",
    "docs/examples/mocking.test.ts",
  ];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mock-hygiene-"));
    for (const file of tree) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), "");
    }
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("finds colocated tests at any depth under the workspace roots", async () => {
    expect(await testFiles(["apps", "packages", "scripts"], root)).toEqual([
      "apps/web/src/lib/api-payload.test.ts",
      "apps/web/src/lib/components/inverter/measured-day.test.ts",
      "packages/db/src/tariff.test.ts",
      "scripts/coverage-floor.test.ts",
    ]);
  });

  // A dependency's own tests are not ours to police, and build output is a copy
  // of a file already scanned — reporting it would name a path nobody can edit.
  test("dependencies and build output are not scanned", async () => {
    const found = await testFiles(["apps", "packages", "scripts"], root);
    expect(found.some((f) => f.includes("node_modules"))).toBe(false);
    expect(found.some((f) => f.includes("/dist/"))).toBe(false);
  });

  // This checker's own suite writes `mock.module(...)` out as string fixtures,
  // including deliberately partial ones. Scanning it would report the examples
  // it exists to describe.
  test("the checker's own suite is skipped, since its fixtures are the violations", async () => {
    expect(await testFiles(["scripts"], root)).toEqual(["scripts/coverage-floor.test.ts"]);
  });

  test("nothing outside the workspace roots is walked", async () => {
    expect(await testFiles(["docs"], root)).toEqual(["docs/examples/mocking.test.ts"]);
    expect(await testFiles(["apps", "packages", "scripts"], root)).not.toContain(
      "docs/examples/mocking.test.ts",
    );
  });

  test("a root with no tests contributes nothing rather than failing", async () => {
    expect(await testFiles(["apps/web/dist"], root)).toEqual([]);
    expect(await testFiles(["no-such-root"], root)).toEqual([]);
  });

  test("the walk is sorted, so the report reads the same on every machine", async () => {
    const found = await testFiles(["packages", "apps"], root);
    expect(found).toEqual([...found].sort());
  });
});

/** An in-memory workspace: `files` maps path to contents, plus captured output. */
function fakeIo(files: Record<string, string>) {
  const out: string[] = [];
  const err: string[] = [];
  const read: string[] = [];
  const io: HygieneIo = {
    testFiles: async () => Object.keys(files),
    read: async (file) => {
      read.push(file);
      return files[file] ?? "";
    },
    log: (m) => out.push(m),
    error: (m) => err.push(m),
  };
  return { io, out, err, read, stdout: () => out.join("\n"), stderr: () => err.join("\n") };
}

describe("main", () => {
  test("a workspace where every mock spreads and is handed back passes, and says so on stdout", async () => {
    const f = fakeIo({
      "apps/server/src/evcc.test.ts": [
        `mock.module("./config", () => ({ ...real, getMqttConfig: stub }));`,
        `afterAll(() => mock.module("./config", () => ({ ...realExports })));`,
      ].join("\n"),
      "apps/web/src/lib/api-payload.test.ts": `mock.module("mqtt", () => ({ connect: fake }));`,
    });
    expect(await main(f.io)).toBe(0);
    expect(f.stdout()).toContain("every workspace-module mock spreads the real module");
    expect(f.err).toEqual([]);
    expect(f.read).toEqual([
      "apps/server/src/evcc.test.ts",
      "apps/web/src/lib/api-payload.test.ts",
    ]);
  });

  test("an empty workspace passes rather than reading as unchecked", async () => {
    const f = fakeIo({});
    expect(await main(f.io)).toBe(0);
    expect(f.stdout()).toContain("✓");
  });

  test("a partial mock blocks, naming the file, the line and the specifier", async () => {
    const f = fakeIo({
      "apps/server/src/evcc.test.ts": [
        `import { mock } from "bun:test";`,
        `mock.module("./config", () => ({ getMqttConfig: stub }));`,
      ].join("\n"),
    });
    expect(await main(f.io)).toBe(1);
    expect(f.stderr()).toContain('apps/server/src/evcc.test.ts:2 — mock.module("./config")');
    expect(f.out).toEqual([]);
  });

  // The message has to carry the fix, because the failure it prevents surfaces
  // in an unrelated suite on a different machine.
  test("the failure explains the fix, not just the rule", async () => {
    const f = fakeIo({ "a.test.ts": `mock.module("./config", () => ({ x: 1 }));` });
    await main(f.io);
    expect(f.stderr()).toContain("process-global and permanent");
    expect(f.stderr()).toContain("...real");
  });

  test("every violating file is listed, not just the first", async () => {
    const f = fakeIo({
      "apps/server/src/a.test.ts": `mock.module("./one", () => ({ x: 1 }));`,
      "apps/server/src/b.test.ts": [
        `mock.module("@SunReye/db", () => ({ ...realDb, db: fake }));`,
        `afterAll(() => mock.module("@SunReye/db", () => ({ ...realDbExports })));`,
      ].join("\n"),
      "packages/db/src/c.test.ts": `mock.module("./two", () => ({ y: 2 }));`,
    });
    expect(await main(f.io)).toBe(1);
    expect(f.stderr()).toContain("apps/server/src/a.test.ts:1");
    expect(f.stderr()).toContain("packages/db/src/c.test.ts:1");
    expect(f.stderr()).not.toContain("b.test.ts");
  });

  test("one violation among many clean files is still a block", async () => {
    const f = fakeIo({
      "a.test.ts": [
        `mock.module("./a", () => ({ ...realA }));`,
        `afterAll(() => mock.module("./a", () => ({ ...realAExports })));`,
      ].join("\n"),
      "b.test.ts": `test("x", () => {});`,
      "c.test.ts": [
        `mock.module("./c", () => ({ c: 1 }));`,
        `afterAll(() => mock.module("./c", () => ({ ...realCExports })));`,
      ].join("\n"),
    });
    expect(await main(f.io)).toBe(1);
    expect(f.err.filter((l) => l.includes("mock.module("))).toHaveLength(2);
  });

  // The second rule: the mock is shaped correctly and still poisons the process,
  // because it is never handed back.
  test("a stub that is never restored blocks, naming the file, the line and the specifier", async () => {
    const f = fakeIo({
      "apps/server/src/prices/spot-price-job.test.ts": [
        `import { mock } from "bun:test";`,
        `mock.module("@SunReye/db/spot-price", () => ({ ...realDb, getSpotPrices: stub }));`,
      ].join("\n"),
    });
    expect(await main(f.io)).toBe(1);
    expect(f.stderr()).toContain(
      'apps/server/src/prices/spot-price-job.test.ts:2 — mock.module("@SunReye/db/spot-price")',
    );
    expect(f.out).toEqual([]);
  });

  // The trap inside the fix is the whole reason the message exists: restoring
  // with the namespace object restores the stub, because the namespace is live.
  test("the leak failure explains the snapshot-by-value restore and its trap", async () => {
    const f = fakeIo({
      "a.test.ts": `mock.module("@SunReye/db/spot-price", () => ({ ...real }));`,
    });
    await main(f.io);
    expect(f.stderr()).toContain("unit-tests");
    expect(f.stderr()).toContain("afterAll(");
    expect(f.stderr()).toContain("{ ...realDb }");
    expect(f.stderr()).toContain("...realDbExports");
    expect(f.stderr()).toContain("`() => realDb` restores the stub");
    expect(f.stderr()).toContain("namespace is live");
  });

  // The third rule: shaped right, handed back, and still poisoned — because the
  // teardown handed back the namespace, which by then holds the stub.
  test("a restore of the live namespace blocks, naming the file and the line", async () => {
    const f = fakeIo({
      "apps/server/src/energy/cost.test.ts": [
        `const realDb = await import("@SunReye/db");`,
        `mock.module("@SunReye/db", () => ({ ...realDb, db: fake }));`,
        `afterAll(() => {`,
        `  mock.module("@SunReye/db", () => ({ ...realDb }));`,
        `});`,
      ].join("\n"),
    });
    expect(await main(f.io)).toBe(1);
    expect(f.stderr()).toContain(
      'apps/server/src/energy/cost.test.ts:4 — mock.module("@SunReye/db")',
    );
    expect(f.out).toEqual([]);
  });

  test("the live-restore failure explains why the restore does nothing", async () => {
    const f = fakeIo({
      "a.test.ts": [
        `const realDb = await import("@SunReye/db");`,
        `afterAll(() => mock.module("@SunReye/db", () => ({ ...realDb })));`,
      ].join("\n"),
    });
    await main(f.io);
    expect(f.stderr()).toContain("read off the namespace IS the stub");
    expect(f.stderr()).toContain("...realDbExports");
  });

  test("both rules report in one run, and either one alone blocks", async () => {
    const f = fakeIo({
      "a.test.ts": `mock.module("./a", () => ({ x: 1 }));`,
      "b.test.ts": `mock.module("./b", () => ({ ...realB, y: 2 }));`,
    });
    expect(await main(f.io)).toBe(1);
    expect(f.stderr()).toContain("Partial mock of a workspace module");
    expect(f.stderr()).toContain("a.test.ts:1");
    expect(f.stderr()).toContain("b.test.ts:1");
  });
});

describe("productionIo", () => {
  /** The repo root, wherever the runner happened to be started from. */
  const repoRoot = join(import.meta.dir, "..");

  test("walks this repo's own test files, and never its own suite", async () => {
    const cwd = process.cwd();
    process.chdir(repoRoot);
    let found: string[];
    try {
      found = await productionIo.testFiles();
    } finally {
      process.chdir(cwd);
    }
    expect(found).toContain("scripts/coverage-floor.test.ts");
    expect(found).not.toContain("scripts/mock-hygiene.test.ts");
    expect(found.every((f) => f.endsWith(".test.ts"))).toBe(true);
    expect(found.some((f) => f.includes("node_modules"))).toBe(false);
  });

  test("reads a file's text off disk", async () => {
    const source = await productionIo.read(join(repoRoot, "scripts", "mock-hygiene.ts"));
    expect(source).toContain("mock-hygiene-ignore-next-line");
  });

  // The ✓ belongs on stdout so a clean run stays quiet in CI logs; the failure
  // belongs on stderr, where the hook and the workflow both look for it.
  test("the pass line goes to stdout and a violation to stderr", () => {
    const [log, error] = [console.log, console.error];
    const out: string[] = [];
    const err: string[] = [];
    console.log = (m: string) => out.push(m);
    console.error = (m: string) => err.push(m);
    try {
      productionIo.log("✓ clean");
      productionIo.error("✖ partial mock");
    } finally {
      console.log = log;
      console.error = error;
    }
    expect(out).toEqual(["✓ clean"]);
    expect(err).toEqual(["✖ partial mock"]);
  });
});
