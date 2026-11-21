// Motion values a few screens hold beside the shared tokens (ADR 21): each a token, which the still
// tier and reduced motion stop.
import { afterEach, expect, test } from "vitest";
import { cdp } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { ALL, graph } from "../flow/flow.harness.ts";
import FlowNode from "../flow/FlowNode.svelte";

afterEach(async () => {
  delete document.documentElement.dataset["motion"];
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** The motion values a few screens hold, beside the shared tokens, and their time on full. */
const NAMED = [
  ["--motion-flow-tile", "500ms"],
  ["--motion-flow-glow", "700ms"],
  ["--motion-flow-wash", "900ms"],
  ["--motion-flow-pulse", "2.6s"],
  ["--motion-mark-arrive", "700ms"],
  ["--motion-mark-float", "5s"],
  ["--motion-mark-turn", "24s"],
  ["--motion-light-drift", "4s"],
] as const;

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

test.each(NAMED)("%s runs for %s on full", (name, full) => {
  expect(token(name)).toBe(full);
});

test.each(NAMED)("%s stops on the still tier", (name) => {
  document.documentElement.dataset["motion"] = "still";

  expect(token(name)).toBe("0ms");
});

test.each(NAMED)("%s stops under reduced motion", async (name) => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  expect(token(name)).toBe("0ms");
});

/** A flow tile's fade, in s. */
async function tileFade(): Promise<string> {
  const screen = await render(FlowNode, {
    node: graph({ plant: { ...ALL, "pv.power": 1200 } }).nodes[0]!,
    tier: "full",
    onselect: () => {},
  });

  return getComputedStyle(screen.container.querySelector("div.transition-opacity")!)
    .transitionDuration;
}

test("a flow tile fades on its token on full", async () => {
  expect(await tileFade()).toBe("0.5s");
});

test("a flow tile's fade is instant on the still tier", async () => {
  document.documentElement.dataset["motion"] = "still";

  expect(await tileFade()).toBe("0s");
});
