// What the shell shows around a screen: Controls for the admin, nothing around sign-in and setup.
import { getContext, setContext } from "svelte";
import type { Core } from "../api/core.ts";

export interface ShellAccess {
  admin: boolean;
  /** Sign-in or setup: no shell. */
  bare: boolean;
  /** Checks whether this session is the admin's. */
  check(core: Readonly<Pick<Core, "devices">>): Promise<void>;
}

class Access implements ShellAccess {
  admin = $state(false);
  bare = $state(false);

  // The admin alone lists the devices (ADR 9).
  async check(core: Readonly<Pick<Core, "devices">>): Promise<void> {
    this.admin = !("problem" in (await core.devices()));
  }
}

const KEY = Symbol("access");

export function provideAccess(): ShellAccess {
  return setContext(KEY, new Access());
}

/** The shell's access; undefined for a screen rendered without the shell. */
export function access(): ShellAccess | undefined {
  return getContext<ShellAccess | undefined>(KEY);
}
