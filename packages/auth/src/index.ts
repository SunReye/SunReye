import { createDb } from "@SunReye/db";
import * as schema from "@SunReye/db/schema/auth";
import { env } from "@SunReye/env/server";
import { count } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin } from "better-auth/plugins/admin";
import { apiKey } from "@better-auth/api-key";
import { trustedOriginsFor } from "./trusted-origins";

/**
 * Build the Better Auth instance. Not exported: the package's public surface is
 * the singleton {@link auth} below, and a second instance would open a second
 * connection pool against the same database.
 */
function createAuth() {
  const db = createDb();

  /** Row count of the `user` table — drives first-run admin + closed signup. */
  const userCount = async () => {
    const [row] = await db.select({ n: count() }).from(schema.user);
    return row?.n ?? 0;
  };

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    // Origin allow-list for Better Auth's CSRF/origin check. Mirrors the server
    // CORS policy (apps/server/src/index.ts): a configured split-origin
    // dashboard (CORS_ORIGIN) plus any TRUSTED_ORIGINS, and outside production
    // any localhost port. Same-origin deployments — every shipped one now that
    // the server serves the dashboard — cannot enumerate their origin up front,
    // so a request whose Origin matches the Host it was sent to is trusted as
    // its own. See ./trusted-origins.ts for why that is sound.
    trustedOrigins: (request) =>
      trustedOriginsFor(request, {
        corsOrigin: env.CORS_ORIGIN,
        trustedOrigins: env.TRUSTED_ORIGINS,
        isProduction: env.NODE_ENV === "production",
      }),
    emailAndPassword: {
      enabled: true,
    },
    session: {
      // Long session lifetime so a "keep me signed in" login stays valid
      // effectively indefinitely: the default `updateAge` (1 day) rolls the
      // expiry forward on each visit, so an active user is never logged out.
      // Persistence is opt-in per login via the sign-in `rememberMe` flag — an
      // un-remembered session still uses a browser-session cookie and ends when
      // the browser closes, regardless of this server-side expiry.
      expiresIn: 60 * 60 * 24 * 365, // 1 year (seconds)
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      // `lax` fits every supported topology: same-origin reverse proxy (HA
      // ingress iframes are same-origin with the HA frontend) and top-level
      // navigation on split-origin setups. `Secure` is opt-in because direct
      // LAN access is commonly plain HTTP — a hardcoded `secure: true` would
      // silently drop the session cookie there.
      defaultCookieAttributes: {
        sameSite: "lax",
        secure: env.AUTH_SECURE_COOKIES,
        httpOnly: true,
      },
      useSecureCookies: env.AUTH_SECURE_COOKIES,
      // Behind a reverse proxy (HA ingress → nginx) the socket peer is the
      // proxy, so rate limiting falls back to one shared bucket for everyone.
      // Resolve the client from X-Forwarded-For instead — set by our nginx
      // and by HA ingress. Spoofable only on a directly exposed server, where
      // the alternative (a single shared bucket) is strictly worse anyway.
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
      },
    },
    databaseHooks: {
      user: {
        create: {
          // First registered account bootstraps the instance admin; everyone
          // else keeps the plugin default ("user").
          before: async (user) => {
            if ((await userCount()) === 0) {
              return { data: { ...user, role: "admin" } };
            }
            return { data: user };
          },
        },
      },
    },
    hooks: {
      // Invite-only after setup: only the first account may self-register. Later
      // accounts are created by an admin via the admin plugin's `/admin/*`
      // endpoints, which don't hit this matcher.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email" && (await userCount()) > 0) {
          throw new APIError("FORBIDDEN", { message: "Registration is closed" });
        }
      }),
    },
    plugins: [
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      // API keys for the generated /api/v1 integration surface. Keys reference a
      // `user` (default) via `referenceId`. Client self-service endpoints are
      // key-owner-scoped; admins manage keys for any user through the
      // admin-guarded /api/admin/api-keys routes in apps/server, which call
      // `auth.api.createApiKey` with an explicit userId.
      apiKey({ defaultPrefix: "sunreye_" }),
    ],
  });
}

export const auth = createAuth();
