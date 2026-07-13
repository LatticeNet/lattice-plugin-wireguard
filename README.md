# lattice-plugin-wireguard

Official LatticeNet WireGuard mesh plugin. This repository owns the signed
Bundle v2 manifest, Linux runtime, sandbox UI, deterministic packer, and tests.
Current prerelease: `v0.1.0-alpha.7`.

## Current operator surface

The plugin contributes one Extensions page with:

- fleet WireGuard address, public-key, endpoint, online and readiness state;
- a secret-free full-mesh topology preview;
- exact per-peer `/32` or `/128` `AllowedIPs` host-route previews;
- per-node listen-port selection;
- authoritative `wg0.conf` plan creation and pending-approval review.

The UI is built and released here. Deactivation removes the navigation and
iframe; the base Dashboard has no WireGuard page implementation.

## Key and apply boundary

Private keys never reach the server, plugin subprocess, manifest, browser, or
plan. Core rendering writes `__LATTICE_WG_PRIVATE_KEY__`; the node agent replaces
that placeholder from its local key file only during an approved apply.

`latticenet.wireguard/networks` is an in-core service owned by this plugin:

- `overview` requires `node:read` and returns only public/operational metadata;
- `plan` requires `network:plan` and creates a pending WireGuard approval;
- no iframe method applies configuration directly.

Apply continues through validation, snapshot, dead-man rollback watchdog,
`wg syncconf`/`wg-quick`, and control-plane self-check. Global plugin views fail
closed for access tokens restricted to a node allowlist.

Named networks, device QR issuance, route advertisement, and existing-config
adoption are intentionally not shown as pretend controls until their server and
agent contracts ship.

## Verification

```sh
go test -race ./system-go/...
go test -race ./tools/pluginpack/...
cd ui
npm ci
npm test
npm run typecheck
npm run build
npm run verify:build
```

Build and sign with Go `1.26.4`, Node `22`, the deterministic plugin packer, and
the trusted LatticeNet Ed25519 publisher seed. Never commit the seed.
