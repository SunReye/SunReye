// Git for the release scripts, run in a given checkout.

/** Whether git succeeds in `cwd`. A git hook exports `GIT_DIR` and kin, which would aim every
 * command at the checkout running the hook, so they are dropped. */
export function tryGit(cwd: string, args: readonly string[]): Bun.SyncSubprocess<"pipe", "pipe"> {
  const env = Object.fromEntries(
    Object.keys(process.env)
      .filter((name) => !name.startsWith("GIT_"))
      .map((name) => [name, process.env[name]]),
  );

  return Bun.spawnSync(["git", ...args], { cwd, env });
}

/** Git's output in `cwd`; throws with its stderr when it fails. */
export function git(cwd: string, args: readonly string[]): string {
  const done = tryGit(cwd, args);

  if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr.toString()}`);

  return done.stdout.toString();
}
