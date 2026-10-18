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

/**
 * The server the answers are shaped like. "status" is lattice-server from the
 * release after alpha-0.2.2a138: each row carries the agent's status word and
 * no last_seen for a node that never reported. "a138" is that server and
 * older: no status, and the Go zero time in last_seen.
 */
export type Wire = "status" | "a138";

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
  status?: string;
  online: boolean;
  disabled?: boolean;
  last_seen?: string;
  configuration: "ready" | "partial" | "missing";
}

/** The server's rule (lattice-server deriveNodeStatus, without degraded): disabled, then never, then offline. */
function statusOf(node: { disabled: boolean; online: boolean; lastSeen?: number }, now: number): string {
  if (node.disabled) return "disabled";
  if (node.lastSeen === undefined) return "never_reported";
  if (!node.online || now - node.lastSeen > 90_000) return "offline";
  return "online";
}

function build(scenario: Scenario, wire: Wire): FixtureNode[] {
  if (scenario === "empty") return [];
  return NAMES.map((name, index) => {
    // production: nothing reported, which is the live fleet.
    // rich: a spread across every readiness and status combination.
    const hasAddress = scenario === "rich" && index % 3 !== 2;
    const hasKey = scenario === "rich" && index % 4 !== 3;
    const configuration = hasAddress && hasKey ? "ready" : hasAddress || hasKey ? "partial" : "missing";
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    // rich also holds an agent that never reported, and one whose beat went
    // stale before the liveness sweep flipped its flag: the server's status
    // already calls it offline.
    const never = scenario === "rich" && index % 13 === 7;
    const stale = scenario === "rich" && index === 2;
    const online = never ? false : scenario === "rich" ? index % 6 !== 1 : !OFFLINE.has(name);
    const disabled = scenario === "rich" && index % 11 === 4;
    const now = Date.now();
    // Invented times, counted back from now so the relative ages read the
    // way production's do: an online agent reported seconds ago, inside the
    // server's 90 s offline threshold, an offline one days ago.
    const lastSeen = never ? undefined : now - (stale ? 150 : online ? 5 + index * 2 : 6 * 86_400 + index * 3_600) * 1000;
    return {
      node_id: `node_${slug}`,
      name,
      address: hasAddress ? `10.66.0.${index + 1}` : undefined,
      public_key: hasKey ? key(index + 1) : undefined,
      endpoint: scenario === "rich" && index % 5 === 0 ? `${slug}.example.invalid:51820` : undefined,
      listen_port: scenario === "rich" && index % 5 === 0 ? 51820 : undefined,
      public_ip: `203.0.113.${index + 1}`,
      ...(wire === "status" ? { status: statusOf({ disabled, online, lastSeen }, now) } : {}),
      online,
      disabled,
      last_seen: lastSeen !== undefined ? new Date(lastSeen).toISOString() : wire === "a138" ? "0001-01-01T00:00:00Z" : undefined,
      configuration,
    };
  });
}

export function handlers(scenario: Scenario, wire: Wire = "status"): Record<string, (payload: any) => unknown> {
  const nodes = build(scenario, wire);
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
