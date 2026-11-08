import { expect, test } from "bun:test";
import pkg from "../../package.json";

const declared = (): string[] =>
  [pkg.dependencies, pkg.devDependencies, (pkg as { peerDependencies?: object }).peerDependencies]
    .flatMap((group) => Object.keys(group ?? {}))
    .sort();

// The SPA talks to the Rust core over its OpenAPI client and a plain WebSocket: the Elysia
// client and the server package it types against are gone, and accounts are the core's own.
test.each(["@elysia/eden", "server", "better-auth"])("apps/web does not depend on %s", (name) => {
  expect(declared()).not.toContain(name);
});
