// Writes schema.d.ts from the core's OpenAPI document, which the crates generate (ADR 9): the
// scene's, the layout's and a module type's schemas and every schema they name, each a readonly
// named type. Writes scene-schema.js from it too: the scene's JSON Schema, for a consumer that
// validates a stored scene, and the package version it was made at (ADR 25).
// `bun run --cwd packages/scene types` rewrites it.

import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";
import ts from "typescript";

/** The schemas the package publishes; everything they name comes with them. */
const ROOTS = ["Scene", "Layout", "LayoutChange", "ModuleType"];

/** What openapi-typescript writes for an API, which a document of schemas alone leaves empty. */
const EMPTY = new Set(["paths", "webhooks", "$defs", "operations"]);

const HEADER =
  "// Generated from apps/home/core/openapi.json by `bun run --cwd packages/scene types`. Do not edit.\n\n";

/** A schema's name where another schema refers to it. */
const REF = /(?<="\$ref":"#\/components\/schemas\/)[^"]+/gu;

const source = new URL("../../apps/home/core/openapi.json", import.meta.url);

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
function reached(
  refs: (name: string) => readonly string[],
  roots: readonly string[] = ROOTS,
): string[] {
  const kept = new Set<string>();
  const pending = [...roots];

  for (let name = pending.pop(); name !== undefined; name = pending.pop())
    if (!kept.has(name)) {
      kept.add(name);
      pending.push(...refs(name));
    }

  return [...kept].toSorted();
}

/** The OpenAPI document in `text`. */
function parsed(text: string): Document {
  const document: unknown = JSON.parse(text);

  if (!isDocument(document)) throw new TypeError("apps/home/core/openapi.json has no schemas");

  return document;
}

/** `roots` and every schema they name in `all`, by name. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- openapi-typescript's own types, only read.
function named(all: Readonly<Schemas>, roots: readonly string[] = ROOTS): Schemas {
  const schemas: Schemas = {};

  const refs = (name: string) => JSON.stringify(all[name] ?? {}).match(REF) ?? [];

  for (const name of reached(refs, roots)) {
    const schema = all[name];

    if (schema === undefined) throw new Error(`the OpenAPI document has no schema ${name}`);

    schemas[name] = schema;
  }

  return schemas;
}

/** The document in `text`, keeping only the roots and every schema they name. */
function published(text: string): Document {
  const document = parsed(text);
  const schemas = named(document.components.schemas);

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

/** A number's width, which JSON Schema has no format for: it is the crates' concern. */
const WIDTH =
  /,"format":"(?:u?int(?:8|16|32|64)|double|float)"|"format":"(?:u?int(?:8|16|32|64)|double|float)",?/gu;

/** scene-schema.js as the core's OpenAPI document generates it now. */
export async function sceneSchema(): Promise<string> {
  const document = parsed(await Bun.file(source).text());
  const manifest: unknown = await Bun.file(new URL("package.json", import.meta.url)).json();

  const version =
    manifest instanceof Object && "version" in manifest ? String(manifest.version) : "";

  const defs = JSON.stringify(named(document.components.schemas, ["Scene"]))
    .replaceAll("#/components/schemas/", "#/$defs/")
    .replaceAll(WIDTH, "");

  const parsedDefs: unknown = JSON.parse(defs);

  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $ref: "#/$defs/Scene",
    $defs: parsedDefs,
  };

  return `${HEADER}/** The scene's JSON Schema (2020-12), as the core reads a stored scene. */
export const SCENE_SCHEMA = ${JSON.stringify(schema, null, 2)};

/** The version of @sunreye/scene the schema was generated at. */
export const SCENE_SCHEMA_VERSION = ${JSON.stringify(version)};
`;
}

if (import.meta.main) {
  await Bun.write(new URL("schema.d.ts", import.meta.url), await generate());
  await Bun.write(new URL("scene-schema.js", import.meta.url), await sceneSchema());
}
