# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# The whole of SunReye in one image: dashboard, REST API, live socket and the
# schema migrator, as a single compiled executable on an empty filesystem.
#
#   docker run … ghcr.io/sunreye/sunreye-server            # serve
#   docker run … ghcr.io/sunreye/sunreye-server migrate    # migrate, then exit
#
# There is no separate web image (the binary embeds the SvelteKit build) and no
# separate migrate image (`src/main.ts` dispatches on argv). Both used to exist
# and cost a Node runtime and a 430 MB bun toolchain respectively; folding them
# in also makes schema-vs-code skew impossible, because there is only one
# artifact to tag.
# ─────────────────────────────────────────────────────────────────────────────

# ─── Build: pinned to the *build* platform so multi-arch cross-compiles ──────
# natively rather than emulating the toolchain under QEMU.
FROM --platform=$BUILDPLATFORM oven/bun:1.4 AS build
WORKDIR /app
ENV HUSKY=0 SKIP_ENV_VALIDATION=1 NODE_ENV=production

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

# The dashboard the binary serves. Must run BEFORE the compile below: --asset
# reads the directory at build time, and a missing one is a hard build error.
RUN cd apps/web && bun run build:static

ARG TARGETARCH
# musl targets, to match the scratch runtime below, which carries musl's loader
# and nothing else. The pairing is not free-standing: a glibc binary here fails
# to exec with a bare "No such file or directory" — the missing file being the
# interpreter, not the binary — so the two are asserted together in
# scripts/packaging.test.ts.
RUN case "$TARGETARCH" in \
      amd64) BUN_TARGET=bun-linux-x64-musl ;; \
      arm64) BUN_TARGET=bun-linux-arm64-musl ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    cd apps/server && \
    # --external serialport: modbus-serial only requires it inside its
    # RTU-over-serial connectors (never used — SunReye speaks TCP), and bun's
    # bundler emits a syntax error into the bundled @serialport/bindings-cpp
    # wrapper that breaks parsing of the whole binary at startup.
    # --asset embeds the whole build tree; bun keeps only its BASENAME, so it
    # arrives as build/… inside the binary — see src/web/loaded.ts.
    bun build --compile --minify --external serialport --target="$BUN_TARGET" --asset ../web/build ./src/main.ts --outfile /app/server

# ─── Runtime libraries ──────────────────────────────────────────────────────
# A compiled bun binary is not static: it still needs musl's loader and the
# C++/GCC runtimes, and it reads the trust store and the zone database from the
# filesystem. This stage collects exactly those and nothing else.
#
# Deliberately NOT pinned to $BUILDPLATFORM: the loader and libraries must be
# the TARGET architecture's, which is what the default (target platform) gives.
FROM alpine:3.22 AS runtime-libs
RUN apk add --no-cache ca-certificates tzdata libstdc++
RUN mkdir -p /out/lib /out/etc/ssl/certs /out/usr/share /out/tmp \
    # ld-musl is arch-named (…-x86_64 / …-aarch64), hence the glob.
    && cp /lib/ld-musl-*.so.1 /out/lib/ \
    && cp /usr/lib/libstdc++.so.6 /usr/lib/libgcc_s.so.1 /out/lib/ \
    # Without the trust store every outbound HTTPS call — spot prices, solar
    # forecast, profile updates — fails, and only at runtime.
    && cp /etc/ssl/certs/ca-certificates.crt /out/etc/ssl/certs/ \
    # Without the zone database TZ resolves to nothing and every day, month and
    # tariff-band boundary is cut in UTC.
    && cp -r /usr/share/zoneinfo /out/usr/share/ \
    # scratch has no /tmp and nothing to create one at runtime.
    && chmod 1777 /out/tmp \
    # Nor any passwd/group, so a numeric USER would resolve to no name.
    && echo 'sunreye:x:65532:65532::/app:/sbin/nologin' > /out/etc/passwd \
    && echo 'sunreye:x:65532:' > /out/etc/group

# ─── Runtime: nothing but the above ─────────────────────────────────────────
# No shell, no package manager, no libc utilities: nothing to exploit and
# nothing to patch. Costs ~20 % fewer bytes than distroless/base-debian12 as
# well, but the posture is the point.
FROM scratch AS runtime
WORKDIR /app
COPY --from=runtime-libs /out/ /
COPY --from=build /app/server /app/server
# The migrator reads its SQL as plain files — a compiled binary bundles
# modules, not data — so the journals ship alongside it.
COPY --from=build /app/packages/db/src/migrations /app/db/migrations
COPY --from=build /app/packages/db/src/timescale /app/db/timescale
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/db/migrations \
    TIMESCALE_DIR=/app/db/timescale
USER 65532:65532
EXPOSE 3000
ENTRYPOINT ["/app/server"]
