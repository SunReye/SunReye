// `bun build --compile` embeds files imported with `with { type: "file" }` and
// hands the module a path to read them back through. TypeScript needs the shape.
// The default export is that shape, not a symbol anyone imports by name — see
// the `ignoreExports` entry for this file in .fallowrc.json.
declare module "*.pack" {
  const path: string;
  export default path;
}
