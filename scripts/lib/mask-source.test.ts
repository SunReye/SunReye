import { describe, expect, test } from "bun:test";
import { keepOnly, maskRust, maskTs } from "./mask-source";

describe("maskRust", () => {
  const sleep = "thread::sleep(d)";

  test("keeps length and line breaks", () => {
    const source = `a // x\n"s\nt" /* c\n */ b`;
    const masked = maskRust(source);
    expect(masked).toHaveLength(source.length);
    expect(masked.split("\n")).toHaveLength(source.split("\n").length);
  });

  test("blanks line and nested block comments", () => {
    expect(maskRust(`// ${sleep}\nx`)).not.toContain("sleep");
    expect(maskRust(`/* a /* ${sleep} */ ${sleep} */ x`)).not.toContain("sleep");
  });

  test("blanks strings, raw strings and char literals", () => {
    expect(maskRust(`let s = "${sleep}";`)).not.toContain("sleep");
    expect(maskRust(`let s = r#"${sleep} "quoted""#;`)).not.toContain("sleep");
    expect(maskRust(`let s = "a\\"${sleep}";`)).not.toContain("sleep");
    expect(maskRust(`let c = '{'; let d = '"'; ${sleep}`)).toContain("sleep");
    expect(maskRust(`let c = '{'; let d = '"'; ${sleep}`)).not.toContain("{'");
  });

  test("blanks byte strings and byte raw strings", () => {
    expect(maskRust(`let s = b"${sleep}";`)).not.toContain("sleep");
    expect(maskRust(`let s = br"${sleep}";`)).not.toContain("sleep");
    expect(maskRust(`let s = br#"${sleep} "quoted""#;`)).not.toContain("sleep");
    expect(maskRust(`let s = br##"${sleep} "# "quoted""##;`)).not.toContain("sleep");
  });

  test("a byte raw string with an unbalanced quote does not leak into the code after it", () => {
    const source = `a(br#"{"error":"Admin only"#); ${sleep};`;
    const masked = maskRust(source);
    expect(masked).toBe(`a(br#"${" ".repeat(20)}"#); ${sleep};`);
  });

  test("an identifier ending in r before a quote-hash is not a raw string", () => {
    const blanks = " ".repeat(sleep.length);
    expect(maskRust(`bar#"${sleep}"`)).toBe(`bar#"${blanks}"`);
    expect(maskRust(`abr#"${sleep}"#`)).toBe(`abr#"${blanks}"#`);
  });

  test("leaves lifetimes alone", () => {
    expect(maskRust(`fn f<'a>(x: &'a str) { ${sleep} }`)).toContain("sleep");
  });
});

describe("maskTs", () => {
  test("keeps length and line breaks", () => {
    const source = "a // x\n`s\nt` /* c\n */ b";
    const masked = maskTs(source);
    expect(masked).toHaveLength(source.length);
    expect(masked.split("\n")).toHaveLength(source.split("\n").length);
  });

  test("blanks comments and strings", () => {
    expect(maskTs("// Bun.sleep(1)\nx")).not.toContain("sleep");
    expect(maskTs("/* Bun.sleep(1) */ x")).not.toContain("sleep");
    expect(maskTs(`const s = "Bun.sleep(1)";`)).not.toContain("sleep");
    expect(maskTs(`const s = 'it\\'s Bun.sleep(1)';`)).not.toContain("sleep");
    expect(maskTs("const s = `Bun.sleep(1)`;")).not.toContain("sleep");
  });

  test("keeps code inside a template placeholder", () => {
    expect(maskTs("const s = `a ${Bun.sleep(1)} b`;")).toContain("Bun.sleep(1)");
  });

  test("a quote inside a regex literal does not open a string", () => {
    expect(maskTs(`const r = /"/; Bun.sleep(1);`)).toContain("Bun.sleep(1)");
  });

  test("division is not a regex", () => {
    expect(maskTs(`const r = a / 2; const q = b / 3; Bun.sleep(1);`)).toContain("Bun.sleep(1)");
  });
});

describe("keepOnly", () => {
  test("blanks what is outside the ranges and keeps offsets and line breaks", () => {
    expect(keepOnly("ab\ncd\nef", [[3, 4]])).toBe("  \ncd\n  ");
  });
});
