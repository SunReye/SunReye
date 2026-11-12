import { mode, setMode } from "mode-watcher";
import { createRawSnippet } from "svelte";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Layout from "./+layout.svelte";

const children = createRawSnippet(() => ({ render: () => "<p>page</p>" }));

afterEach(() => {
  localStorage.clear();
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
