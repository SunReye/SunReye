# syntax=docker/dockerfile:1

# The 4.0 core (crates/sunreye) with the dashboard embedded, on a glibc runtime. Monitoring only
# (ADR 0005); the store is one SQLite file under /data (ADR 0004), so no database server ships.
#
# Both stages that compile run on $BUILDPLATFORM and cross-compile to $TARGETARCH, so building the
# arm64 image needs no QEMU: no RUN instruction executes on the target architecture. The runtime
# stage has no RUN for the same reason.
#
#   docker build -f docker/rust-core/Dockerfile .      # or scripts/release-image <version>

# bun is the one 3.x's images compile with (scripts/packaging.test.ts keeps them equal).
FROM --platform=$BUILDPLATFORM oven/bun:1.4 AS spa
WORKDIR /app
ENV HUSKY=0 SKIP_ENV_VALIDATION=1 NODE_ENV=production

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
# crates/sunreye/build.rs refuses a release build without apps/web/build/index.html.
RUN cd apps/web && bun run build:static

# The tag is rust-toolchain.toml's channel; bookworm is the glibc the runtime stage ships.
FROM --platform=$BUILDPLATFORM rust:1.99.1-bookworm AS core
WORKDIR /app
ARG TARGETARCH
ARG BUILDARCH
ENV SQLX_OFFLINE=true CARGO_TERM_COLOR=never

# glibc has one linker per target; a cross gcc is installed only when the target differs.
RUN case "$TARGETARCH" in \
      amd64) TRIPLE=x86_64-unknown-linux-gnu; PKG=x86-64; PREFIX=x86_64 ;; \
      arm64) TRIPLE=aarch64-unknown-linux-gnu; PKG=aarch64; PREFIX=aarch64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    echo "$TRIPLE" > /triple && \
    if [ "$TARGETARCH" != "$BUILDARCH" ]; then \
      apt-get update && \
      apt-get install -y --no-install-recommends "gcc-${PKG}-linux-gnu" "libc6-dev-${TARGETARCH}-cross" && \
      rm -rf /var/lib/apt/lists/* && \
      { echo "export CARGO_TARGET_$(echo "$TRIPLE" | tr 'a-z-' 'A-Z_')_LINKER=${PREFIX}-linux-gnu-gcc"; \
        echo "export CC_$(echo "$TRIPLE" | tr - _)=${PREFIX}-linux-gnu-gcc"; } > /cross.env; \
    else : > /cross.env; fi && \
    rustup target add "$TRIPLE"

COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY .sqlx .sqlx
COPY crates crates
COPY --from=spa /app/apps/web/build apps/web/build

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target,id=sunreye-core-target-$TARGETARCH \
    . /cross.env && \
    cargo build --release --locked -p sunreye --target "$(cat /triple)" && \
    install -D "target/$(cat /triple)/release/sunreye" /out/sunreye && \
    install -d /out/data

# glibc, trust store and zone database; no shell. nonroot is uid 65532.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=core /out/sunreye /sunreye
# A fresh named volume mounted here inherits this ownership.
COPY --from=core --chown=65532:65532 /out/data /data
VOLUME /data
EXPOSE 8099
USER 65532:65532
# `docker run … <args>` replaces CMD: repeat --listen to change the port (clap refuses a repeated flag
# from the entrypoint), and add --trusted-origin or --secure-cookies after it.
ENTRYPOINT ["/sunreye", "--data-dir", "/data"]
CMD ["--listen", "0.0.0.0:8099"]
