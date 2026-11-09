import { expect, test } from "bun:test";

const packed = Bun.spawnSync(["bun", "pm", "pack", "--dry-run"], {
  cwd: new URL("..", import.meta.url).pathname,
});

const listing = packed.stdout.toString();

test("the package ships the profile WASM and the TypeScript over it, without its tests", () => {
  expect(packed.exitCode, packed.stderr.toString()).toBe(0);

  for (const file of ["dist/profile.wasm", "src/index.ts", "src/generated.ts", "src/define.ts"]) {
    expect(listing).toContain(file);
  }

  expect(listing).not.toContain(".test.ts");
});
