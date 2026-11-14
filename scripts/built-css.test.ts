import { expect, test } from "bun:test";
import { unblurred } from "./built-css.ts";

test("a rule left with only the prefixed backdrop filter is found: Chromium ignores it", () => {
  const css =
    ".glass-ambient{background-image:var(--noise);-webkit-backdrop-filter:blur(8px)}" +
    ".glass-modal{-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}";

  expect(unblurred(css)).toEqual([".glass-ambient"]);
});

test("a rule inside an at-rule is read by its own selector", () => {
  const css = "@layer utilities{.a\\!{-webkit-backdrop-filter:blur(8px)!important}.b{color:red}}";

  expect(unblurred(css)).toEqual([".a\\!"]);
});

test("rules with both forms, or neither, pass", () => {
  const css = ".a{backdrop-filter:none;-webkit-backdrop-filter:none}.b{color:red}";

  expect(unblurred(css)).toEqual([]);
});
