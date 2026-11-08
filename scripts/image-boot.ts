/** Pure parts of the local boot check (`scripts/image-boot-check`). */

/** Neither the dev database's 5432 nor the core's own 8099, which a live install may hold. */
export const BOOT_PORT = 8197;

const REFUSED_PORTS = [5432, 8099];

export function bootRunArgs(options: {
  image: string;
  name: string;
  volume: string;
  port: number;
}): string[] {
  const { image, name, volume, port } = options;
  if (REFUSED_PORTS.includes(port)) throw new Error(`port ${port} belongs to a live install`);
  return [
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "host",
    "--platform",
    "linux/amd64",
    "--volume",
    `${volume}:/data`,
    image,
    "--listen",
    `0.0.0.0:${port}`,
  ];
}

/** Whether a tar listing of `/data` holds the core's SQLite file (`store.rs` FILE). */
export function holdsStore(entries: readonly string[]): boolean {
  return entries.includes("data/sunreye.db");
}
