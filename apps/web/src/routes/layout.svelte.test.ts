import { mode, setMode } from "mode-watcher";
import { createRawSnippet } from "svelte";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { motionMs } from "../lib/motion.ts";
import { motion } from "../lib/motion/tier.svelte.ts";
import Layout from "./+layout.svelte";

const children = createRawSnippet(() => ({ render: () => "<p>page</p>" }));

afterEach(() => {
  localStorage.clear();
  motion.lowPower = false;
});

test("a first visit renders dark", async () => {
  localStorage.clear();
  await render(Layout, { props: { children } });

  await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(true);
});

test("a light override is kept per browser", async () => {
  const first = await render(Layout, { props: { children } });

  setMode("light");
  await first.unmount();

  await render(Layout, { props: { children } });

  await expect.poll(() => document.documentElement.classList.contains("dark")).toBe(false);
  expect(mode.current).toBe("light");
  expect(localStorage.getItem("mode-watcher-mode")).toBe("light");
});

test("on the still tier every motion is instant", async () => {
  await render(Layout, { props: { children } });
  const root = getComputedStyle(document.documentElement);

  expect(root.getPropertyValue("--motion-base").trim()).toBe("180ms");
  expect(motionMs(180)).toBe(180);

  motion.lowPower = true;

  await expect.poll(() => root.getPropertyValue("--motion-base").trim()).toBe("0ms");

  for (const token of ["--motion-fast", "--motion-slow", "--motion-press", "--motion-move"]) {
    expect(root.getPropertyValue(token).trim(), token).toBe("0ms");
  }

  expect(motionMs(180)).toBe(0);
});

test("the low-power switch turns every glass surface opaque", async () => {
  await render(Layout, { props: { children } });

  motion.lowPower = true;
  await expect.poll(() => document.documentElement.dataset["lowPower"]).toBe("");

  motion.lowPower = false;
  await expect.poll(() => document.documentElement.dataset["lowPower"]).toBeUndefined();
});
