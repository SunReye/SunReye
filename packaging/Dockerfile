# The core's image and the Home Assistant add-on's (ADR 13), from the repository root, after the
# SPA build the core embeds (ADR 11):
#   bun run --cwd apps/web build
#   docker build -f packaging/Dockerfile --target core .
FROM rust:1.99.1-alpine AS build
WORKDIR /src
COPY . .
# Alpine's Rust targets musl and links statically (ADR 2).
RUN cargo build --release --locked -p sunreye-core \
 && mkdir -p /out/data /out/tmp \
 && chmod 1777 /out/tmp \
 && cp target/release/sunreye /out/

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
