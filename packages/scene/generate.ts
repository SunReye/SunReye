// Writes schema.d.ts from the core's OpenAPI document, which the crates generate (ADR 9): the
// scene's, the layout's and a module type's schemas and every schema they name, each a readonly
// named type.
// `bun run --cwd packages/scene types` rewrites it.

import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";
import ts from "typescript";

/** The schemas the package publishes; everything they name comes with them. */
const ROOTS = ["Scene", "Layout", "LayoutChange", "ModuleType"];

/** What openapi-typescript writes for an API, which a document of schemas alone leaves empty. */
const EMPTY = new Set(["paths", "webhooks", "$defs", "operations"]);

const HEADER =
  "// Generated from crates/core/openapi.json by `bun run --cwd packages/scene types`. Do not edit.\n\n";

/** A schema's name where another schema refers to it. */
const REF = /(?<="\$ref":"#\/components\/schemas\/)[^"]+/gu;

const source = new URL("../../crates/core/openapi.json", import.meta.url);

type Schemas = NonNullable<NonNullable<OpenAPI3["components"]>["schemas"]>;

interface Document extends OpenAPI3 {
  readonly components: { readonly schemas: Schemas };
}

function isDocument(value: unknown): value is Document {
  return (
    value instanceof Object &&
    "openapi" in value &&
    "info" in value &&
    "components" in value &&
    value.components instanceof Object &&
    "schemas" in value.components &&
    value.components.schemas instanceof Object
  );
}

/** The roots and every schema they name, by `refs`, sorted by name. */
function reached(refs: (name: string) => readonly string[]): string[] {
  const kept = new Set<string>();
  const pending = [...ROOTS];

  for (let name = pending.pop(); name !== undefined; name = pending.pop())
    if (!kept.has(name)) {
      kept.add(name);
      pending.push(...refs(name));
    }

  return [...kept].toSorted();
}

/** The document in `text`, keeping only the roots and every schema they name. */
function published(text: string): Document {
  const document: unknown = JSON.parse(text);

  if (!isDocument(document)) throw new TypeError("crates/core/openapi.json has no schemas");

  const all = document.components.schemas;
  const schemas: Schemas = {};

  const refs = (name: string) => JSON.stringify(all[name] ?? {}).match(REF) ?? [];

  for (const name of reached(refs)) {
    const schema = all[name];

    if (schema === undefined) throw new Error(`the OpenAPI document has no schema ${name}`);

    schemas[name] = schema;
  }

  return { openapi: document.openapi, info: document.info, paths: {}, components: { schemas } };
}

/** schema.d.ts as the core's OpenAPI document generates it now. */
export async function generate(): Promise<string> {
  const nodes = await openapiTS(published(await Bun.file(source).text()), {
    immutable: true,
    rootTypes: true,
    rootTypesNoSchemaPrefix: true,
  });

  const kept: ts.Node[] = [];

  for (const node of nodes)
    if (!ts.isTypeAliasDeclaration(node) || !EMPTY.has(node.name.text)) kept.push(node);

  return HEADER + astToString(kept);
}

if (import.meta.main) {
  await Bun.write(new URL("schema.d.ts", import.meta.url), await generate());
}
