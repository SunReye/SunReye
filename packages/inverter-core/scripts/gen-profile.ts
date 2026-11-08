/**
 * The core's read model of a profile and the role catalogue, from the Rust core's OpenAPI document
 * (`crates/sunreye/openapi_snapshot.json`). `bun run gen:profile` rewrites `src/profile.gen.ts`;
 * `src/profile-gen.test.ts` fails while the committed file is stale.
 */
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";

const DOCUMENT = new URL("../../../crates/sunreye/openapi_snapshot.json", import.meta.url);
export const PROFILE_TYPES_FILE = new URL("../src/profile.gen.ts", import.meta.url);

type Schemas = Record<string, unknown>;

const SCHEMA_REF = /"\$ref":"#\/components\/schemas\/([^"]+)"/g;

function refsOf(node: unknown): string[] {
  return [...JSON.stringify(node).matchAll(SCHEMA_REF)].map((match) => match[1] ?? "");
}

/** `roots` and every schema they reach: the web client's own types stay out of the SDK. */
function reachable(all: Schemas, roots: string[]): Schemas {
  const keep = new Set<string>();
  const queue = [...roots];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    if (keep.has(name)) continue;
    keep.add(name);
    queue.push(...refsOf(all[name]));
  }
  return Object.fromEntries(Object.entries(all).filter(([name]) => keep.has(name)));
}

// The names the engine and the SDK use; the schemas stay behind `components`.
const ALIASES = [
  ["CoreProfile", "Profile"],
  ["CoreMetric", "Metric"],
  ["CoreBinding", "Binding"],
  ["RoleSpec", "RoleSpec"],
  ["CanonicalRole", "Role"],
]
  .map(([alias, schema]) => `export type ${alias} = components["schemas"]["${schema}"];`)
  .join("\n");

export async function renderProfileTypes(): Promise<string> {
  const document = (await Bun.file(DOCUMENT).json()) as OpenAPI3;
  const all = document.components?.schemas as Schemas;
  const schemas = reachable(all, ["Profile", "Role", "RoleSpec"]);
  const types = astToString(
    await openapiTS({
      openapi: "3.1.0",
      info: { title: "SunReye profile", version: "0" },
      components: { schemas },
    } as OpenAPI3),
  );
  const role = schemas.Role as { enum: string[]; "x-roles": Record<string, unknown> };
  // The enum keeps the core's catalogue order; the specs map is sorted by name.
  const catalogue = role.enum
    .map((name) => `  ${JSON.stringify(name)}: ${JSON.stringify(role["x-roles"][name])},`)
    .join("\n");
  return `${types}\n${ALIASES}
/** The canonical roles and what each asks of its metric; the core's \`ROLES\`. */
export const ROLE_CATALOG = {
${catalogue}
} as const satisfies Record<CanonicalRole, RoleSpec>;

export const ROLE_NAMES = Object.keys(ROLE_CATALOG) as [CanonicalRole, ...CanonicalRole[]];
`;
}

if (import.meta.main) {
  await Bun.write(PROFILE_TYPES_FILE, await renderProfileTypes());
}
