# 16. Cloud relay

Status: proposed (2026-11-08)

## Context

Homeowners who cannot set up a VPN want an app, and businesses that sold the software want to watch many installs. The operator must not be able to read a home's data, no home should open an inbound port, and nobody wants to handle passwords.

## Decision

**Where.** `apps/cloud` in this monorepo, TypeScript on Cloudflare Workers. One Durable Object per install id is the rendezvous, using WebSocket hibernation so an idle connection costs little. The cloud account is optional; the core's local login (ADR 9) works without it.

**Security model.** The cloud login grants routing only. A signed-in account can reach the Durable Objects of its installs, nothing more. The core accepts only device keys it trusts, so a hijacked identity-provider account or a compromised cloud can route traffic but never read or write a home's data.

**Login.** Social login only: Google, Apple and Microsoft over OpenID Connect, in the Worker. No passwords, no email signup, nothing password-derived stored.

**Tunnel.** The core keeps one outbound WebSocket to its Durable Object. A client opens a WebSocket to the same object, which splices frames per session and never decrypts. Inside, client and core run a Noise handshake (the `snow` crate), with the core's static key pinned; clients run the same crate compiled to WASM. The relay sees ciphertext, sizes and timing. It stores routing metadata only: install id, account, and whether the core is connected.

**Keys.**

- Each account has a key pair. The private key is stored in the cloud wrapped by a passkey's PRF secret, so any device with the account's synced passkey can unwrap it.
- Each browser or app generates its own device key and signs it with the account key. The core accepts device keys signed by an account it trusts.
- A lost device is revoked by a signed revocation the core checks. "Revoke all" rotates the account key and needs one more connect at home.
- There is no recovery key: the cloud holds no data, so losing every passkey means a new account key and one more connect at home.
- A browser without PRF support is paired as a single device at home instead, by one click or a QR code.

**Connect at home.** In the local SPA, "connect to cloud" opens the web app in the same browser with a one-time code and the core's public key in the URL fragment, which browsers never send to a server. The homeowner confirms with the passkey; the web app signs the code with the account key and sends it through the relay; the core checks the code and trusts the account as `admin`. On a phone, a QR code from the local SPA replaces the link. A relay that never sees the code shown at home cannot substitute its own key.

**Businesses.** A business is an account. The homeowner grants it in the local SPA by entering the business's share code, which carries the business key's fingerprint, so a substituted key is detected. The default role is `viewer`. The business key signs its staff's device keys; a staff revocation is signed by the business key and checked by the core. The homeowner revokes the business at the core.

**Clients.** The web app is the same SPA as the local one, with the tunnel as its transport (ADR 11). It is built reproducibly from the repo, every release is signed with the project key, and it is served by a static deployment separate from the relay Worker. A service worker pins the installed version and accepts an update only if its signature verifies against the key it was installed with. The local SPA shows the expected bundle hash. The first load and a hard reload that bypasses the service worker trust the server; the product says so. The native app (Android first) has no such gap.

**Writes.** A device key trusted as `admin` writes through the funnel (ADR 7), audited as "admin via" the device's name.

**On the core.** The relay connection is an integration, off by default, enabled by "connect to cloud".

## Considered options

- **A cloud that stores readings.** Rejected: the operator could read them, and it carries a GDPR processing burden.
- **Password accounts with a password-wrapped key.** Rejected: the owner will not handle password encryption, and passkeys are more convenient.
- **Pairing every device at home.** Kept only as the fallback for browsers without PRF.
- **VPN only.** Rejected: the audience cannot set one up.
- **Inbound port forwarding.** Rejected: exposes the core.
- **TLS inside the WebSocket.** Rejected: browsers cannot pin a self-signed certificate inside a WebSocket stream; Noise runs in WASM on both sides.

## Consequences

Cross-install history needs each install online. Passkey PRF support varies by browser and platform; the per-device fallback covers the gap. The relay depends on Cloudflare, but its protocol is a plain WebSocket carrying Noise, so another host can replace it. Workers WebSocket messages have a size limit (1 MiB, as I understand it, unverified), so large responses are streamed in chunks.
