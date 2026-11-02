import { type Readable, writable } from "svelte/store";
import { apiErrorText } from "$lib/api-error";
import { core } from "$lib/core-api";
import type { components } from "$lib/core-api.gen";

export type AppUser = components["schemas"]["Account"];
export type AppSession = { data: { user: AppUser } | null; isPending: boolean };

export type AuthResult = { ok: true } | { ok: false; message?: string };

const store = writable<AppSession>({ data: null, isPending: true });
let loading = false;

function hold(account: AppUser | null): void {
  loading = true;
  store.set({ data: account ? { user: account } : null, isPending: false });
}

/** Ask the core who the cookie belongs to; a 401 or an unreachable core is anonymous. */
// fallow-ignore-next-line unused-export -- the load `useAppSession` starts, called directly by session.test.ts and app-sidebar.svelte.test.ts to reload between cases; test files aren't traced as consumers
export async function refreshSession(): Promise<void> {
  try {
    const { data } = await core.GET("/api/auth/session");
    hold(data ?? null);
  } catch {
    hold(null);
  }
}

/**
 * The signed-in account, shared by the shell and the sidebar. An unauthenticated visitor has
 * `data: null`, so the app-shell gate routes them to `/login`. The first caller loads it.
 */
export function useAppSession(): Readable<AppSession> {
  if (!loading) {
    loading = true;
    void refreshSession();
  }
  return { subscribe: store.subscribe };
}

/** Sign-in and sign-up both answer the account and start its session. */
async function start(request: Promise<{ data?: AppUser; error?: unknown }>): Promise<AuthResult> {
  try {
    const { data, error } = await request;
    if (!data) return { ok: false, message: apiErrorText(error, "") };
    hold(data);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function signIn(body: components["schemas"]["LoginRequest"]): Promise<AuthResult> {
  return start(core.POST("/api/auth/login", { body }));
}

export function signUp(body: components["schemas"]["SignUpRequest"]): Promise<AuthResult> {
  return start(core.POST("/api/auth/sign-up", { body }));
}

/** A core that refuses leaves the account signed in, since its session is still live. */
export async function signOut(): Promise<AuthResult> {
  try {
    const { error } = await core.DELETE("/api/auth/session");
    if (error !== undefined) return { ok: false, message: apiErrorText(error, "") };
  } catch {
    // Unreachable core: the cookie expires on its own.
  }
  hold(null);
  return { ok: true };
}
