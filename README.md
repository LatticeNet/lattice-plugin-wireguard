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

The page has three layers in one tab row. Overview opens with why the mesh
cannot form (on a fleet where no agent reports a WireGuard address or key:
"0 of 34 ready: 34 report no WireGuard address or public key") and the step
that changes it, then one readiness bar split into ready, one half reported
and nothing reported. Agent liveness is a separate count: an agent online says
nothing about the mesh. Fleet lists every node the session may read, grouped
by what it lacks; a column shows only when some node reports a value for it.
Mesh lists the ready nodes with the host route each is pinned to in
`AllowedIPs`.

A row opens the node in a side panel: the interface as reported, its peers,
and Plan, which asks for the listen port and files a pending approval. When
Plan is disabled, the panel and the row menu say why beside it. The layer,
the open node and the Fleet search live in the console address through the
page-state contract (design 22), so a reload or a pasted link lands on the
same panel. A failed read shows no counts. The page reads when it opens and
when Refresh is pressed, never on a timer; one clock re-renders the relative
ages every 5 seconds while the page is visible and stops while it is hidden.

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
(1440, 2423, 375) and theme. Every other key in the harness URL is the
plugin's page state, sent in init the way the console sends it:
`?scenario=rich&view=fleet&open=node_metix-dmit-1` opens that node's panel on
the Fleet layer, and a reload lands in the same place. `readonly=1` grants the
read method only, `oldhost=1` plays a console that keeps no page state, and
`plugin=lens%3Dmesh` passes a document query to the plugin the way an old
link did.

The page is built on the shared plugin chassis, `@latticenet/plugin-bridge/chassis`
(see `docs/design-plugin-chassis.md` in the `lattice` repo). Until the bridge
release that carries the chassis is published to the registry, `ui/package.json`
points at `ui/vendor/latticenet-plugin-bridge-0.1.0-alpha.2.tgz`, an `npm pack`
of the bridge's `feat/plugin-chassis` branch; swap the dependency back to the
registry version once it is published and delete the tarball.

Build and sign with Go `1.26.4`, Node `22`, the deterministic plugin packer, and
the trusted LatticeNet Ed25519 publisher seed. Never commit the seed.
