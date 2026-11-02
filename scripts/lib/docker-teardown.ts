/** Throwaway containers go with their anonymous volumes: the image's VOLUME outlives `docker rm -f`. */
export const removeContainerArgs = (name: string): string[] => ["rm", "-fv", name];

// CLI for scripts/ci: `bun scripts/lib/docker-teardown.ts <container>`; exits with docker's code.
if (import.meta.main) {
  const run = Bun.spawnSync(["docker", ...removeContainerArgs(Bun.argv[2] ?? "")], {
    stdout: "ignore",
    stderr: "inherit",
  });
  process.exit(run.exitCode);
}
