// Hands the browser a table as a CSV file to save (ADR 22): built here, never on the core.
import { csvOf, type Table } from "./csv.ts";

export function save(table: Table): void {
  const url = URL.createObjectURL(new Blob([csvOf(table)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = table.file;
  link.click();
  // The download has the blob by its address; it holds past this turn.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
