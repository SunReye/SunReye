import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

/**
 * The appliance updates itself by rebuilding its own `/etc/nixos` flake, and
 * every part of that path is a string in a different file: the CLI switches to
 * an attribute, the nightly timer bumps an input by name, the image workflow
 * advances a branch, and the flake the box actually evaluates has to declare
 * all three. Nothing evaluates them together — `nix flake check ./nixos` builds
 * the repo's flake, not the box's — so a mismatch is invisible until a unit
 * nobody can reach stops updating.
 *
 * These assertions are that wiring. What the configuration evaluates to is
 * `checks.eval`; what it does when it boots is the VM test.
 */

const read = (path: string) => readFileSync(`${import.meta.dir}/../${path}`, "utf8");

const TEMPLATE = "nixos/template/flake.nix";

describe("the box's own flake", () => {
  // Without it, `nixos-rebuild --flake /etc/nixos` has nothing to evaluate, so
  // neither the nightly upgrade nor `sunreye-setup apply` can work at all — and
  // seed.nix's `if [ ! -e /etc/nixos/flake.nix ]` guard never becomes false, so
  // every boot copies the template back over the owner's site.json.
  test("the template ships one", () => {
    expect(existsSync(`${import.meta.dir}/../${TEMPLATE}`)).toBe(true);
  });

  test("it declares the attribute the CLI rebuilds", () => {
    const cli = read("apps/appliance-cli/src/main.ts");
    const attr = cli.match(/\$\{CONFIG_DIR\}#(\w+)/)?.[1];
    expect(attr).toBeTruthy();

    expect(read(TEMPLATE)).toContain(`nixosConfigurations.${attr}`);
  });

  // identity.nix leaves networking.hostName empty on purpose, and a bare
  // `--flake /etc/nixos` resolves the attribute from `$(hostname)`. On a box
  // named sr-1a2b3c that is `nixosConfigurations."sr-1a2b3c"`, which no flake
  // here declares, so the nightly rebuild fails every night in silence.
  test("the nightly upgrade names that attribute too", () => {
    const cli = read("apps/appliance-cli/src/main.ts");
    const attr = cli.match(/\$\{CONFIG_DIR\}#(\w+)/)?.[1];
    const flake = read("nixos/modules/sunreye/seed.nix").match(
      /flake\s*=\s*lib\.mkDefault\s*"([^"]+)"/,
    )?.[1];

    expect(flake).toBe(`/etc/nixos#${attr}`);
  });

  test("the input the nightly bumps is one the template declares", () => {
    const seed = read("nixos/modules/sunreye/seed.nix");
    const input = seed.match(/"--update-input"\s+"([^"]+)"/)?.[1];
    expect(input).toBeTruthy();

    // Comments stripped first: the file documents how to pin the input to a
    // tag, and an example of the declaration reads exactly like the declaration.
    const declarations = read(TEMPLATE)
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");

    // `inputs.sunreye.url = …` or an `inputs = { sunreye = { … } }` block.
    expect(declarations).toMatch(
      new RegExp(`\\binputs(\\.${input}\\b|\\s*=[^;]*\\b${input}\\s*=)`),
    );
  });

  // The image workflow force-pushes `stable` only after the container images
  // for that version are in GHCR. A box tracking any other ref can pull a
  // configuration whose image tag does not exist yet.
  test("it follows the branch the image workflow advances", () => {
    const ref = read(".github/workflows/nixos-image.yml").match(
      /push --force origin HEAD:(\w+)/,
    )?.[1];
    expect(ref).toBe("stable");

    expect(read(TEMPLATE)).toContain(`/${ref}?dir=nixos`);
  });
});
