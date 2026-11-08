# 16. Cloud relay

Status: proposed (2026-11-08)

## Context

Homeowners who cannot set up a VPN want an app, and businesses that sold the software want to watch many installs. The operator must not be able to read a home's data, and no home should open an inbound port.

## Decision

- **Where.** `apps/cloud` in this monorepo, TypeScript on Cloudflare Workers. One Durable Object per install id is the rendezvous, using WebSocket hibernation so an idle connection costs little.
- **Tunnel.** The core keeps one outbound WebSocket to its Durable Object. A client opens a WebSocket to the same object, which splices frames per session and never decrypts. Inside, client and core run a Noise handshake (the `snow` crate), with the core's static key pinned at pairing; the client runs the same crate compiled to WASM. The relay sees ciphertext, sizes and timing.
- **No readings in the cloud.** It stores routing metadata only: install id, the public keys of paired clients, and whether the core is connected. Clients use the core's own API (ADR 9) through the tunnel. A business view across installs queries each core live; an offline install shows as offline, with no data.
- **Pairing.** The local SPA shows a QR code with the install id, the core's public key and a one-time code. The homeowner names the client and grants `viewer` or `admin`; a business is a client the homeowner grants, usually `viewer`. Revocation happens at the core and takes effect immediately, whatever the relay does.
- **Writes.** An `admin` client writes through the funnel (ADR 7), audited as "admin via" the client's name.
- **Clients.** The native app (Android first) is the end-to-end client. A web client served from the cloud is offered with the caveat stated in the product: whoever runs the cloud could serve altered code to a browser.
- **On the core.** The relay connection is an integration, off by default, enabled by the homeowner.

## Considered options

- **A cloud that stores readings.** Rejected: the operator could read them, and it carries a GDPR processing burden.
- **VPN only.** Rejected: the audience cannot set one up.
- **Inbound port forwarding.** Rejected: exposes the core.
- **TLS inside the WebSocket.** Rejected: browsers cannot pin a self-signed certificate inside a WebSocket stream; Noise runs in WASM on both sides.

## Consequences

Cross-install history needs each install online. The relay depends on Cloudflare, but its protocol is a plain WebSocket carrying Noise, so another host can replace it. Workers WebSocket messages have a size limit (1 MiB, as I understand it, unverified), so large responses are streamed in chunks.
