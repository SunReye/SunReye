// How one-owner (`one-owner.ts`) finds a copy in a source: each finder gives where the first one
// starts, if the source holds one.

/** The first match of `pattern`, unless the file holds the shared piece itself (`composes`). */
export const first =
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the patterns are only read.
  (pattern: RegExp, composes?: RegExp) =>
    (source: string): number | undefined =>
      composes?.test(source) === true ? undefined : pattern.exec(source)?.index;

/** The source with its comments blanked, every offset kept. */
const uncommented = (source: string): string =>
  source.replaceAll(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|(?<![:"'`\w])\/\/.*$/gmu, (comment) =>
    comment.replaceAll(/[^\n]/gu, " "),
  );

/** The first `glass-ambient` outside a comment: the kit card draws it, so no file names it. */
export const glass = (source: string): number | undefined =>
  /glass-ambient/u.exec(uncommented(source))?.index;

/**
 * Every opening tag, whole: up to its first `>` outside a quoted value and outside an expression,
 * whose braces may nest three deep (an arrow function with an object in a call).
 */
const TAG =
  /<([A-Za-z][\w.:-]*)(?=[\s/>])(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}|[^>"'{])*>/gu;

/** The first tag but the kit card's that draws a card's corner and its edge or fill by hand. */
export function handCard(commented: string): number | undefined {
  const source = uncommented(commented);

  for (const { 0: tag, 1: name, index } of source.matchAll(TAG)) {
    const corner = /(?<![\w-])rounded-xl(?![\w-])/u.test(tag);
    const edge = /(?<![\w-])(?:border|bg-card)(?![\w-])/u.test(tag);

    if (name !== "Card.Root" && corner && edge) return index;
  }

  return undefined;
}

/** A duration or easing written as a literal in a class: Tailwind's `duration-300`, `ease-in`. */
const CLASS_MOTION = /(?<![\w-])(?:duration-\d|ease-(?:in-out|in|out|linear)(?![\w-]))/u;

/** A transition or animation declared with a literal time or a keyword ease; `linear` is a
 * constant speed, no motion value. */
const STYLE_MOTION =
  /(?:transition|animation)[\w-]*\s*:[^;{}]*?(?:(?<![\w-])\d+(?:\.\d+)?m?s(?![\w-])|(?<![\w-])ease(?:-in-out|-in|-out)?(?![\w-]))/u;

/** The first motion value not from the motion tokens, in a class or in a `<style>`. */
export function literalMotion(commented: string): number | undefined {
  const source = uncommented(commented);
  const styles = [...source.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gu)];

  const outside = styles.reduce(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a match, only read.
    (text, style) =>
      text.slice(0, style.index) +
      style[0].replaceAll(/[^\n]/gu, " ") +
      text.slice(style.index + style[0].length),
    source,
  );

  const found = [
    CLASS_MOTION.exec(outside)?.index,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a match, only read.
    ...styles.map((style) => {
      const at = STYLE_MOTION.exec(style[0])?.index;

      return at === undefined ? undefined : style.index + at;
    }),
  ].filter((at) => at !== undefined);

  return found.length === 0 ? undefined : Math.min(...found);
}

/** The first pulse or spin whose own class string does not stop it under reduced motion. */
export function unstopped(commented: string): number | undefined {
  const source = uncommented(commented);

  for (const { index } of source.matchAll(/(?<![\w:-])animate-(?:pulse|spin)(?![\w-])/gu)) {
    const open = Math.max(...['"', "'", "`"].map((quote) => source.lastIndexOf(quote, index)));

    const close = source.indexOf(source.charAt(open), index);

    if (!source.slice(open, close).includes("motion-reduce:animate-none")) return index;
  }

  return undefined;
}
