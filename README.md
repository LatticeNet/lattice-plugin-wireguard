# lattice-plugin-wireguard

Official LatticeNet WireGuard mesh plugin. It shows an operator which fleet
nodes can join the WireGuard mesh, which are still missing a piece, and it
creates the configuration plan that an approved apply writes to a node. This
repository owns the signed Bundle v2 manifest, Linux runtime, sandbox UI,
deterministic packer, and tests. The released version is the one in
`manifest.json`.

The plugin adds a single Extensions entry to the Lattice console, rendered as a
sandboxed iframe. Deactivation removes the navigation entry and the iframe: the
base Dashboard has no WireGuard page of its own.

## Operator surface

- Fleet readiness: address, public key, endpoint, online state and last check-in
  for every node the session may read. A node is mesh-ready once the control
  plane holds both its WireGuard address and its public key, and the page says
  which of the two is missing rather than printing a zero.
- Mesh membership for one selected node: the peers this session can see and the
  `/32` or `/128` host route each is pinned to in `AllowedIPs`.
- Per-node listen port, and plan creation, which files a pending approval.

The page does not render a `wg0.conf`. The control plane renders the one that
gets applied, and it decides fields this plugin never receives (the interface
prefix, PersistentKeepalive, MTU and DNS, and peers on nodes outside the
session's read scope). Reviewing a drawing here and approving a different
document elsewhere is the failure this avoids, so the page lists what it cannot
know and points at the approval for the full text.

## Key and apply boundary

Private keys never reach the server, the plugin subprocess, the manifest, the
browser, or the plan. Core rendering writes `__LATTICE_WG_PRIVATE_KEY__`, and
the node agent replaces that placeholder from its local key file only during an
approved apply.

`latticenet.wireguard/networks` is an in-core service owned by this plugin:

- `overview` requires `wireguard:read` and returns only public and operational
  metadata;
- `plan` requires `wireguard:admin` and `network:plan`, and creates a pending
  WireGuard approval;
- no iframe method applies configuration directly.

Apply continues through validation, snapshot, dead-man rollback watchdog,
`wg syncconf` or `wg-quick`, and a control-plane self-check. Global plugin views
fail closed for access tokens restricted to a node allowlist.

Named networks, device QR issuance, route advertisement, and adoption of an
existing config are deliberately absent rather than shown as controls that do
nothing, until their server and agent contracts ship.

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

To drive the UI in a browser, `ui/dev.html` runs the real build inside a real
iframe and speaks the real bridge protocol at it, with the frame sized to fill
the console's main region the way the dashboard sizes it. There is no `dev`
script in `ui/package.json`, so start it with `npx vite --open /dev.html` from
`ui`. The bar switches data (`production`, `rich`, `empty`, `failing`), width
(1440, 2423, 375) and theme; `?q=lens=mesh&expand=node-hkg-edge-01` in the
harness URL passes a document query to the plugin.

The page is built on the shared plugin chassis, `@latticenet/plugin-bridge/chassis`
(see `docs/design-plugin-chassis.md` in the `lattice` repo). Until the bridge
release that carries the chassis is published to the registry, `ui/package.json`
points at `ui/vendor/latticenet-plugin-bridge-0.1.0-alpha.2.tgz`, an `npm pack`
of the bridge's `feat/plugin-chassis` branch; swap the dependency back to the
registry version once it is published and delete the tarball.

Build and sign with Go `1.26.4`, Node `22`, the deterministic plugin packer, and
the trusted LatticeNet Ed25519 publisher seed. Never commit the seed.
