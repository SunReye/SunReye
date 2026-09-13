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
# git, because the server SHELLS OUT to it: a profile repository is cloned with
# `git clone --depth 1` (apps/server/src/inverter/git-source.ts), and without it
# the official profile list answers `Executable not found in $PATH: "git"` — on
# compose, on the Home Assistant addon and on the appliance alike. Nothing was
# red, because the client reports an unreadable source, which reads like a
# network problem. A box whose profile list is empty is a box nobody can point
# at their inverter.
RUN apk add --no-cache ca-certificates tzdata libstdc++ git
RUN mkdir -p /out/lib /out/etc/ssl/certs /out/usr/share /out/tmp \
    # ld-musl is arch-named (…-x86_64 / …-aarch64), hence the glob.
    && cp /lib/ld-musl-*.so.1 /out/lib/ \
    && cp /usr/lib/libstdc++.so.6 /usr/lib/libgcc_s.so.1 /out/lib/ \
    # Without the trust store every outbound HTTPS call — spot prices, solar
    # forecast, profile updates — fails, and only at runtime.
    && cp /etc/ssl/certs/ca-certificates.crt /out/etc/ssl/certs/ \
    # AND /etc/ssl/cert.pem, which is where alpine's libcurl looks — a different
    # path from the one bun reads. With only the first, `git clone https://…`
    # dies with "error setting certificate file: /etc/ssl/cert.pem" while every
    # other HTTPS call on the box works. Found by running a real clone against
    # this stage; no reading of this file would have shown it.
    && cp -L /etc/ssl/cert.pem /out/etc/ssl/ \
    # Without the zone database TZ resolves to nothing and every day, month and
    # tariff-band boundary is cut in UTC.
    && cp -r /usr/share/zoneinfo /out/usr/share/ \
    # scratch has no /tmp and nothing to create one at runtime.
    && chmod 1777 /out/tmp \
    # Nor any passwd/group, so a numeric USER would resolve to no name.
    && echo 'sunreye:x:65532:65532::/app:/sbin/nologin' > /out/etc/passwd \
    && echo 'sunreye:x:65532:' > /out/etc/group
# git and everything it opens, resolved rather than listed.
#
# `git-remote-https` is a SEPARATE binary under libexec/git-core, and git execs
# it by path for any https:// remote — shipping /usr/bin/git alone yields
# "Unable to find remote helper for 'https'", which fails exactly like having no
# git at all. The library set is taken from ldd instead of being written out by
# hand, because that list is alpine's to change and a missing .so is a runtime
# failure on a box in somebody's cupboard.
RUN set -eux; \
    for bin in /usr/bin/git /usr/libexec/git-core/git-remote-https /usr/libexec/git-core/git-remote-http; do \
      cp -L --parents "$bin" /out/; \
      ldd "$bin" | awk '/=>/ { print $3 } /ld-musl/ { print $1 }' \
        | grep '^/' | sort -u | xargs -I{} cp -L --parents {} /out/; \
    done; \
    # git refuses to clone without its template directory.
    cp -r --parents /usr/share/git-core /out/ 2>/dev/null || true; \
    # HOME is unset for uid 65532 and git writes nothing, but it does read
    # /etc/gitconfig if present; an empty one keeps it from probing further.
    : > /out/etc/gitconfig

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
