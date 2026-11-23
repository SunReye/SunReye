// The value editor as the builder ships it (ADR 25 "What is not the kit"): the app's wraps it with
// its write log, and a screen without one opens it as it is.
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../../app.css";
import { editable } from "@sunreye/builder/values";
import { ValueEditor } from "@sunreye/builder/controls";

test("the builder's value editor opens on its caller's setting, without the app's write log", async () => {
  // The row it opens beside, at the left edge, so the popover fits the viewport.
  const anchor = document.createElement("div");

  anchor.style.cssText = "position: fixed; left: 0; top: 0; width: 8px; height: 8px";
  document.body.append(anchor);

  await render(ValueEditor, {
    props: {
      key: "k",
      edit: editable({
        key: "soc",
        name: "Ladestand",
        unit: "%",
        range: { min: 0, max: 100 },
        step: 1,
      }),
      current: 40,
      anchor,
      open: true,
      onapply: () => Promise.resolve({ kind: "confirmed" as const }),
    },
  });

  await expect
    .element(page.getByRole("spinbutton", { name: "Ladestand" }))
    .toHaveAttribute("aria-valuenow", "40");
});
