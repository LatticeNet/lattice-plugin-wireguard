# lattice-plugin-wireguard

Official LatticeNet **wireguard** system plugin: WireGuard networks,
topologies, and device peers for a Lattice fleet.

> Status: **alpha, unsigned.** The manifest carries no `digest_sha256` or
> `signature_ed25519` yet — see [Releasing](#releasing). A host-risk plugin
> without a trusted-publisher signature is refused by the loader unless the
> operator sets `allow_unsigned_host_risk` (dev only). That is the intended
> fail-closed behavior; do not work around it.

Designed in [`lattice/docs/designs/design-13`](https://github.com/LatticeNet/lattice/blob/main/docs/designs/design-13-wireguard-and-netguard-plugins.md).

## What it manages

- **Networks** — named WireGuard networks with a CIDR, a topology
  (`mesh`, `hub-and-spoke`, or `custom`), and defaults for listen port,
  keepalive, MTU, and DNS. A fleet may run several; a node may belong to more
  than one.
- **Memberships** — a node's role (`hub` / `spoke` / `peer`), its allocated
  address, per-member overrides, and — for hubs only — advertised routes such
  as a LAN CIDR or a full-tunnel exit route.
- **External device peers** — laptops and phones. The device config is
  rendered **once** with its private key and never persisted; only the public
  key and metadata survive.
- **Adoption** — existing on-box configs are discovered read-only
  (`wg show all dump` plus a redacting conf parser) and become managed only
  when an operator explicitly adopts them.

## Safety invariants

These are enforced in core and are not negotiable by this plugin:

- A peer's own address is always pinned to a **host route** (`/32`, `/128`).
  A member reporting `10.66.0.5/16` cannot intercept its peers' traffic.
- Only a **hub's reviewed** `extra_allowed_ips` widen a peer's `AllowedIPs`.
  A spoke's self-declared `0.0.0.0/0` is ignored.
- **Node private keys never reach the server** or this subprocess. The rendered
  config carries a placeholder the agent substitutes from a local 0600 key file
  at apply time.
- Apply is `wg-quick strip` validate → snapshot → dead-man watchdog → commit →
  control-plane selfcheck → disarm. If the change severs the operator's own
  path, the detached watchdog restores the previous interface. Peer-only
  changes take a `wg syncconf` fast path so established tunnels do not flap.

## What it does not do

This subprocess **never mutates a host.** It answers `describe`, `health`, and
`plan` over the system-plugin stdio contract, and nothing else. Topology
compilation, key handling, the approval flow, the watchdog, and the task
executor are **core** (ADR-001 D5/D6, design-13 D2). The plugin owns the domain
model and the dashboard information architecture — not the trust base.

It also declares **no `interfaces` yet**, deliberately: the networks read model
(store + API) is a later slice, and a manifest must never declare a service the
server cannot resolve.

## Dashboard navigation

The signed manifest contributes a dashboard-owned builtin view under its own
plugin domain:

```
Network Security
└─ wireguard (VPN networks)
   └─ Networks
```

That is intentionally separate from the base `Networking` section and from the
generic `Platform → Plugins` registry. The plugin contributes only navigation
metadata and a fixed `component_key`; the dashboard renders the first-party
WireGuard view and keeps all data access on the core REST API.

## Building

```sh
cd system-go
go test ./...
go build -trimpath -ldflags='-s -w' -o lattice-plugin-wireguard .
```

Zero dependencies, pure Go, no CGO.

## Releasing

The manifest must be signed by a **trusted publisher** before a host-risk
plugin will load. The publisher's ed25519 seed is operator-held and is never
committed:

```sh
# from a lattice-server checkout
go run ./cmd/pluginsign \
  -manifest ../lattice-plugin-wireguard/manifest.json \
  -artifact ../lattice-plugin-wireguard/system-go/lattice-plugin-wireguard \
  -seed /path/to/latticenet-seed.bin \
  -update-digest -write
```

Alpha releases must be cut as prereleases (`v0.1.0-alpha.N`) and must not
become GitHub `Latest`.

## Install

Installation is deliberately **not** remote. Drop the verified bundle on disk:

```
<LATTICE_PLUGIN_DIR>/wireguard/manifest.json
<LATTICE_PLUGIN_DIR>/wireguard/artifact      # the built binary, fixed filename
```

The loader re-verifies the digest at start, stages a 0700 copy, and executes
that copy in a confined working directory with an environment allowlist.

## License

MIT — see [LICENSE](LICENSE).
