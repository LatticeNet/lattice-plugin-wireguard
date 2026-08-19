/**
 * Canned answers shaped like the wire, for looking at the plugin in a browser.
 *
 * The default scenario is the fleet the owner actually has: 35 nodes, none of
 * them mesh-ready, no public endpoints. That zero state is the primary
 * experience today, so it is the default here rather than an afterthought.
 *
 * Never imported by src/; the shipped bundle is built from index.html alone.
 */

export type Scenario = "production" | "rich" | "empty" | "failing";

const NAMES = [
  "hkg-edge-01", "hkg-edge-02", "hkg-edge-03", "sin-edge-01", "sin-edge-02",
  "nrt-edge-01", "nrt-edge-02", "icn-edge-01", "tpe-edge-01", "syd-edge-01",
  "lax-exit-01", "lax-exit-02", "sjc-exit-01", "sea-exit-01", "ord-exit-01",
  "iad-exit-01", "atl-exit-01", "dfw-exit-01", "yyz-exit-01", "gru-exit-01",
  "fra-hub-01", "fra-hub-02", "ams-hub-01", "lhr-hub-01", "cdg-hub-01",
  "waw-hub-01", "sto-hub-01", "hel-hub-01", "mad-hub-01", "mil-hub-01",
  "dub-relay-01", "osl-relay-01", "zrh-relay-01", "vie-relay-01", "prg-relay-01",
];

function key(seed: number): string {
  // Shaped like a base64 WireGuard public key. Public keys are not secret;
  // nothing here resembles a private key, and the plugin never handles one.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let index = 0; index < 43; index += 1) out += alphabet[(seed * 7 + index * 13) % alphabet.length];
  return `${out}=`;
}

interface FixtureNode {
  node_id: string;
  name: string;
  address?: string;
  public_key?: string;
  endpoint?: string;
  listen_port?: number;
  public_ip?: string;
  online: boolean;
  disabled?: boolean;
  last_seen?: string;
  configuration: "ready" | "partial" | "missing";
}

function build(scenario: Scenario): FixtureNode[] {
  if (scenario === "empty") return [];
  return NAMES.map((name, index) => {
    // production: nothing reported, which is the live fleet.
    // rich: a spread across every readiness and status combination.
    const hasAddress = scenario === "rich" && index % 3 !== 2;
    const hasKey = scenario === "rich" && index % 4 !== 3;
    const configuration = hasAddress && hasKey ? "ready" : hasAddress || hasKey ? "partial" : "missing";
    return {
      node_id: `node-${name}`,
      name,
      address: hasAddress ? `10.66.0.${index + 1}` : undefined,
      public_key: hasKey ? key(index + 1) : undefined,
      endpoint: scenario === "rich" && index % 5 === 0 ? `${name}.example.invalid:51820` : undefined,
      listen_port: scenario === "rich" && index % 5 === 0 ? 51820 : undefined,
      public_ip: `203.0.113.${index + 1}`,
      online: scenario === "rich" ? index % 6 !== 1 : index % 4 !== 0,
      disabled: scenario === "rich" && index % 11 === 4,
      last_seen: new Date(Date.UTC(2026, 7, 18, 9, index % 60)).toISOString(),
      configuration,
    };
  });
}

export function handlers(scenario: Scenario): Record<string, (payload: any) => unknown> {
  const nodes = build(scenario);
  return {
    "networks/overview": () => ({ nodes }),
    "networks/plan": ({ node_id, listen_port }: { node_id: string; listen_port: number }) => {
      const target = nodes.find((node) => node.node_id === node_id);
      if (!target) throw new Error(`node "${node_id}" was not found`);
      const peers = nodes.filter((node) => node.configuration === "ready" && node.node_id !== node_id);
      const plan = [
        "# wireguard plan (dry run, no host changes made here)",
        "[Interface]",
        "PrivateKey = __LATTICE_WG_PRIVATE_KEY__",
        `Address = ${target.address}/32`,
        `ListenPort = ${listen_port}`,
        ...peers.flatMap((peer) => ["", "[Peer]", `# ${peer.name}`, `PublicKey = ${peer.public_key}`, `AllowedIPs = ${peer.address}/32`, ...(peer.endpoint ? [`Endpoint = ${peer.endpoint}`] : [])]),
        "",
      ].join("\n");
      return {
        id: `apr_wg_${node_id.slice(-4)}`,
        node_id,
        plugin: "latticenet.wireguard",
        action: "wireguard.apply",
        plan,
        status: "pending",
        created_at: "2026-08-18T09:00:00Z",
      };
    },
  };
}
