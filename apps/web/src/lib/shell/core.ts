// The one core the app talks to: the root layout connects it and hands it to every page.
import { getContext, setContext } from "svelte";
import { connect, http, type Core } from "../api/core.ts";

const KEY = Symbol("core");

/** Connects the core that served the page and hands it to every page below. */
export function connectCore(): Core {
  // The page's directory is the core's root, under an ingress prefix too (ADR 11).
  return setContext(KEY, connect(http(new URL(".", document.baseURI).href)));
}

/** The core the root layout connected. */
export function useCore(): Core {
  const core = getContext<Core | undefined>(KEY);

  if (core === undefined) throw new Error("useCore: no core above this page");

  return core;
}

/** The context that hands `core` to a page rendered without the root layout. */
export function coreContext(core: Readonly<Core>): Map<symbol, Readonly<Core>> {
  return new Map([[KEY, core]]);
}
