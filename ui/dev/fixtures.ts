/**
 * Canned answers shaped like the wire, for looking at the plugin in a browser.
 *
 * The default scenario is the fleet the owner actually has on 2026-09-30:
 * 34 nodes, 32 agents online, none of them mesh-ready, no public endpoints.
 * That zero state is the primary experience today, so it is the default here
 * rather than an afterthought. The counts are production's; the names are
 * invented, shaped like the fleet's (owner tag in brackets, then provider
 * and site), long enough to test the pinned node column at 375.
 *
 * Never imported by src/; the shipped bundle is built from index.html alone.
 */

export type Scenario = "production" | "rich" | "empty" | "failing";

const NAMES = [
  "[Metix]-DMIT-1", "[Metix]-DMIT-2", "[Metix]-DMIT-3", "[Metix]-DMIT-4", "[Metix]-RackNerd-1",
  "[Metix]-RackNerd-2", "[Metix]-Vultr-TYO", "[Metix]-Vultr-SGP", "[Metix]-AWS-HKG", "[Metix]-AWS-FRA",
  "[Metix]-VDS-LAX", "[Metix]-VDS-SJC", "[Metix]-GCP-TPE",
  "[cd]-homeserver", "[cd]-nas", "[cd]-build-1", "[cd]-build-2", "[cd]-lab-1", "[cd]-lab-2",
  "[cd]-mac-air", "[cd]-pi-zero", "[cd]-Aaitr-HK", "[cd]-Aaitr-SH", "[cd]-NAT-GZ", "[cd]-NAT-BJ",
  "[cd]-DMIT-LAX", "[cd]-Oracle-OSA", "[cd]-Oracle-SEL", "[cd]-Hetzner-HEL",
  "[openjobs-vpn]-HK-1", "[openjobs-vpn]-HK-2", "[openjobs-vpn]-SG-1", "[OpenJobs-Data]-SZ", "[OpenJobs-Data]-SH",
];

/** Production has 2 of 34 agents offline. */
const OFFLINE = new Set(["[cd]-pi-zero", "[Metix]-DMIT-4"]);

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
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return {
      node_id: `node_${slug}`,
      name,
      address: hasAddress ? `10.66.0.${index + 1}` : undefined,
      public_key: hasKey ? key(index + 1) : undefined,
      endpoint: scenario === "rich" && index % 5 === 0 ? `${slug}.example.invalid:51820` : undefined,
      listen_port: scenario === "rich" && index % 5 === 0 ? 51820 : undefined,
      public_ip: `203.0.113.${index + 1}`,
      online: scenario === "rich" ? index % 6 !== 1 : !OFFLINE.has(name),
      disabled: scenario === "rich" && index % 11 === 4,
      // Invented times: online agents reported this morning, offline ones days ago.
      last_seen: new Date(OFFLINE.has(name) && scenario !== "rich" ? Date.UTC(2026, 8, 24, 3, index % 60) : Date.UTC(2026, 8, 30, 9, index % 60)).toISOString(),
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
      // Mirrors lattice-server/internal/wireguard GenerateConfig exactly: the
      // interface takes the wider mesh prefix the server assigns, the field
      // order is Address / ListenPort / PrivateKey, peers sort by AllowedIPs,
      // and every peer carries PersistentKeepalive. The harness has to answer
      // what the server answers, or it cannot expose a preview that drifts
      // from the applied config, which is exactly the bug that shipped here.
      const peers = nodes
        .filter((node) => node.configuration === "ready" && node.node_id !== node_id && node.address)
        .map((peer) => ({ ...peer, allowed: `${peer.address}/32` }))
        .sort((left, right) => left.allowed.localeCompare(right.allowed));
      const plan = [
        "[Interface]",
        `Address = ${target.address}/24`,
        `ListenPort = ${listen_port}`,
        "PrivateKey = __LATTICE_WG_PRIVATE_KEY__",
        ...peers.flatMap((peer) => [
          "",
          "[Peer]",
          `# ${peer.name}`,
          `PublicKey = ${peer.public_key}`,
          `AllowedIPs = ${peer.allowed}`,
          ...(peer.endpoint ? [`Endpoint = ${peer.endpoint}`] : []),
          "PersistentKeepalive = 25",
        ]),
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
