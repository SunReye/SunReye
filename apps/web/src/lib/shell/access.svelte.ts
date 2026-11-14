// What the shell shows around a screen: Controls for the admin, nothing around sign-in and setup.
import { createContext, onMount } from "svelte";
import type { Core } from "../api/core.ts";

export interface ShellAccess {
  admin: boolean;
  /** Sign-in or setup: no shell. */
  readonly bare: boolean;
  /** The home page checks its entry: bare meanwhile, unless the shell already frames a screen. */
  opening(): void;
  /** The home page's screen: the shell frames the dashboard, not sign-in or setup. */
  opened(framed: boolean): void;
  /** Checks whether this session is the admin's. */
  check(core: Readonly<Pick<Core, "devices">>): Promise<void>;
}

class Access implements ShellAccess {
  admin = $state(false);
  bare = $state(false);
  // Going bare for a check takes the bar or rail down and puts a new one up: a flash on every
  // change to the dashboard (#758).
  #framed = false;

  opening(): void {
    if (!this.#framed) this.bare = true;
  }

  opened(framed: boolean): void {
    this.#framed = framed;
    this.bare = !framed;
  }

  // The admin alone lists the devices (ADR 9).
  async check(core: Readonly<Pick<Core, "devices">>): Promise<void> {
    this.admin = !("problem" in (await core.devices()));
  }
}

const [getAccess, setAccess, hasAccess] = createContext<ShellAccess>();

/** For the root layout, as it is set up. */
export function provideAccess(): ShellAccess {
  const access = new Access();

  // A first screen other than the home page stands in the shell from the start.
  onMount(() => {
    if (!access.bare) access.opened(true);
  });

  return setAccess(access);
}

/** The shell's access; undefined for a screen rendered without the shell. */
export function access(): ShellAccess | undefined {
  return hasAccess() ? getAccess() : undefined;
}
