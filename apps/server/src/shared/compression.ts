/**
 * Response compression for everything the engine serves — the dashboard bundle
 * and the API alike.
 *
 * This replaces the `.br`/`.gz` variants that used to be built at pack time and
 * negotiated by hand in ../web/static. Compressing per request costs CPU on a
 * Raspberry-Pi-class host, so the encodings offered here are chosen by measured
 * cost, not by best ratio. On the real 2.37 MB bundle chunk (this dev machine,
 * best of three — a Pi is several times slower):
 *
 *     zstd default   655 kB  27.6%   15 ms
 *     brotli q4      639 kB  26.9%   42 ms
 *     gzip level 6   683 kB  28.8%   41 ms
 *     brotli q11     507 kB  21.4%  5403 ms   ← never per request
 *
 * So: zstd first, because it is both smaller than gzip and ~2.8x cheaper than
 * either alternative; brotli for clients that take it but not zstd (Safari);
 * gzip as the floor that every client has. `deflate` is left off — nothing
 * prefers it over gzip. Brotli stays at the plugin's q4 default: the q11 row
 * above is what the old build-time pack could afford and a live server cannot.
 *
 * Everything else is the plugin's own default and deliberately not restated
 * here: the 1 KB threshold, which content types are worth compressing, skipping
 * a response that already declares an encoding, and `Vary: Accept-Encoding`.
 * ./compression.test.ts asserts those rather than trusting them, because this
 * is a 2.0 beta and a missing `Vary` is invisible until a cache serves the
 * wrong body.
 */
import { compress } from "@elysia/compress";

/** Server-preference order; the client's `Accept-Encoding` still decides. */
const ENCODINGS = ["zstd", "br", "gzip"] as const;

export function compression() {
  return compress({ encodings: [...ENCODINGS] });
}
