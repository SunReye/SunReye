/**
 * The HTTP methods a cross-origin browser may use against the API. Same-origin
 * deployments never consult this; the Vite dev server and forwarded ports do,
 * at preflight, and a method missing here fails there with no server-side
 * trace. `cors-methods.test.ts` holds the list to what the routes register.
 */
export const CORS_METHODS: readonly string[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
