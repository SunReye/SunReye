/**
 * Does a drizzle declaration still describe the relation the database actually
 * has?
 *
 * Some relations here cannot be managed by drizzle at all. TimescaleDB
 * continuous aggregates need `WITH (timescaledb.continuous)`, which drizzle-kit
 * cannot express, so they are created by the SQL in `timescale/` and declared to
 * drizzle only as `.existing()` views — a hand-maintained mirror that nothing
 * verifies. Same for the hypertable's own columns against the shipped
 * migrations.
 *
 * Without a check, a rename in the SQL leaves the declaration describing a
 * relation that no longer exists, and the failure surfaces as a runtime error in
 * whichever query happens to run first. This module is the comparison; a
 * database to compare against lives in `apps/server/db-tests`.
 *
 * Pure: it diffs two lists of columns, so every branch is unit-tested.
 */

import { getTableColumns, getViewSelectedFields, isView } from "drizzle-orm";

/** One column, as Postgres names and types it. */
export interface ColumnShape {
  name: string;
  /** Matches `information_schema.columns.data_type` (e.g. "double precision"). */
  dataType: string;
}

/** Anything drizzle can enumerate columns for: a table, or a declared view. */
export type Relation =
  | Parameters<typeof getTableColumns>[0]
  | Parameters<typeof getViewSelectedFields>[0];

/**
 * The columns a declaration claims, in declaration order.
 *
 * Tables expose columns as own properties; a view keeps its selected fields
 * behind a symbol and needs a different accessor. Callers should not have to
 * know which they are holding.
 */
export function declaredColumns(relation: Relation): ColumnShape[] {
  const fields = isView(relation)
    ? getViewSelectedFields(relation)
    : getTableColumns(relation as Parameters<typeof getTableColumns>[0]);
  return Object.values(fields as Record<string, { name: string; getSQLType(): string }>).map(
    (column) => ({ name: column.name, dataType: column.getSQLType() }),
  );
}

/**
 * Every way `declared` and `actual` disagree, as human-readable lines.
 *
 * Order is deliberately not compared: a `select` names its columns, and an
 * aggregate's ordinal positions are an implementation detail. Both directions
 * are — a column the database gained is the quieter and more dangerous drift,
 * because every existing read keeps working while the declaration silently stops
 * describing the relation.
 */
export function diffColumns(
  relation: string,
  declared: readonly ColumnShape[],
  actual: readonly ColumnShape[],
): string[] {
  if (actual.length === 0) {
    return [`${relation}: does not exist in the database, or has no columns`];
  }

  const actualByName = new Map(actual.map((c) => [c.name, c]));
  const declaredByName = new Map(declared.map((c) => [c.name, c]));
  const problems: string[] = [];

  for (const column of declared) {
    const match = actualByName.get(column.name);
    if (!match) {
      problems.push(`${relation}.${column.name}: declared, but the database has no such column`);
      continue;
    }
    if (match.dataType !== column.dataType) {
      problems.push(
        `${relation}.${column.name}: declared ${column.dataType}, database has ${match.dataType}`,
      );
    }
  }

  for (const column of actual) {
    if (!declaredByName.has(column.name)) {
      problems.push(`${relation}.${column.name}: exists in the database but is not declared`);
    }
  }

  return problems;
}
