# The core's image, the Home Assistant add-on's and the bare binary (ADR 13), from the repository
# root, after the SPA build the core embeds (ADR 11):
#   bun run --cwd apps/web build
#   docker build -f packaging/Dockerfile --target core .
# Every architecture is compiled on the build host, never emulated, so arm64 needs no QEMU.
FROM --platform=$BUILDPLATFORM rust:1.99.1-alpine AS build
ARG TARGETARCH
WORKDIR /src
# arm64: clang and lld build the bundled C (SQLite, ring) against Alpine's aarch64 musl headers,
# which apk unpacks without running anything. Rust links its own musl (link-self-contained).
RUN if [ "$TARGETARCH" = arm64 ]; then \
      apk add --no-cache clang lld \
      && apk add --root /sysroot --arch aarch64 --initdb --no-scripts --allow-untrusted \
           --repositories-file /etc/apk/repositories musl-dev \
      && rustup target add aarch64-unknown-linux-musl; \
    fi
ENV CC_aarch64_unknown_linux_musl=clang \
    CFLAGS_aarch64_unknown_linux_musl="--target=aarch64-alpine-linux-musl --sysroot=/sysroot" \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=clang \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_RUSTFLAGS="-C link-self-contained=yes -C link-arg=--target=aarch64-alpine-linux-musl -C link-arg=-fuse-ld=lld -C link-arg=-Wno-unused-command-line-argument"
COPY . .
# Alpine's Rust targets musl and links statically (ADR 2).
RUN case "$TARGETARCH" in \
      amd64) triple=x86_64-unknown-linux-musl ;; \
      arm64) triple=aarch64-unknown-linux-musl ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && cargo build --release --locked -p sunreye-core --target "$triple" \
 && mkdir -p /out/data /out/tmp \
 && chmod 1777 /out/tmp \
 && cp "target/$triple/release/sunreye" /out/

# The bare static binary, for `--output type=local`.
FROM scratch AS binary
COPY --from=build /out/sunreye /sunreye

FROM scratch AS core
COPY --from=build /out/ /
ENV SUNREYE_DATA_DIR=/data
EXPOSE 8099
ENTRYPOINT ["/sunreye"]

# The Supervisor mounts /data and proxies ingress from its own address (ADR 9).
FROM core AS addon
ARG VERSION=5.0.0
LABEL io.hass.type="addon" io.hass.version="${VERSION}"
ENV SUNREYE_INGRESS=172.30.32.2
