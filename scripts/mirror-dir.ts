import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

/**
 * Makes `to` hold exactly what `from` holds, writing only files whose bytes differ. An unchanged
 * file keeps its mtime: cargo reruns a build script when anything under its watched directory is
 * newer, and a copy that touched every file would rebuild the release binary each run.
 */
export function mirrorDir(from: string, to: string): void {
  if (!existsSync(from)) throw new Error(`cannot mirror ${from}: it does not exist`);
  mkdirSync(to, { recursive: true });
  const wanted = new Set(readdirSync(from));
  for (const name of readdirSync(to)) {
    if (!wanted.has(name)) rmSync(join(to, name), { recursive: true, force: true });
  }
  for (const name of wanted) mirrorEntry(join(from, name), join(to, name));
}

function mirrorEntry(from: string, to: string): void {
  if (lstatSync(from).isDirectory()) {
    if (existsSync(to) && !lstatSync(to).isDirectory()) rmSync(to, { force: true });
    mirrorDir(from, to);
  } else if (!sameFile(from, to)) {
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to);
  }
}

function sameFile(from: string, to: string): boolean {
  return existsSync(to) && lstatSync(to).isFile() && readFileSync(from).equals(readFileSync(to));
}
