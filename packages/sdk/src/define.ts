import type { Profile } from "./generated.ts";

/** `T` with every property and array readonly, so an `as const` profile type-checks. */
export type Frozen<T> = T extends readonly (infer U)[]
  ? readonly Frozen<U>[]
  : T extends object
    ? { readonly [K in keyof T]: Frozen<T[K]> }
    : T;

/** A profile as written: typed by the format's Rust types, so an editor completes and checks it. */
export function defineProfile(profile: Frozen<Profile>): Frozen<Profile> {
  return profile;
}
