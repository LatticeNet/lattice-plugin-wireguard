export const PRIVATE_KEY_PLACEHOLDER = "__LATTICE_WG_PRIVATE_KEY__";

export interface WireGuardNode {
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

export function hostRoute(address?: string): string {
  if (!address) return "";
  if (address.includes("/")) return address;
  return address.includes(":") ? `${address}/128` : `${address}/32`;
}

export function redactedKey(key?: string): string {
  if (!key) return "not reported";
  if (key.length <= 16) return "reported";
  return `${key.slice(0, 8)}...${key.slice(-6)}`;
}

export function normalizedPort(value: string, fallback = 51820): number {
  if (!value.trim()) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Listen port must be an integer from 1 to 65535");
  return port;
}

/**
 * The nodes a mesh can actually be compiled from.
 *
 * One definition, used by the summary, the peer grid, and the rendered
 * preview. Two definitions is how "17 peer blocks" ends up over a config that
 * carries sixteen.
 */
export function meshReadyNodes(nodes: readonly WireGuardNode[]): WireGuardNode[] {
  return nodes.filter((node) => readinessGap(node) === "ready");
}

export function previewConfig(target: WireGuardNode | undefined, peers: WireGuardNode[], port?: number): string {
  if (!target?.address) return "";
  const lines = [
    "[Interface]",
    `PrivateKey = ${PRIVATE_KEY_PLACEHOLDER}`,
    `Address = ${hostRoute(target.address)}`,
    `ListenPort = ${port || target.listen_port || 51820}`,
  ];
  for (const peer of meshReadyNodes(peers).filter((value) => value.node_id !== target.node_id)) {
    lines.push("", "[Peer]", `# ${peer.name || peer.node_id}`, `PublicKey = ${peer.public_key}`, `AllowedIPs = ${hostRoute(peer.address)}`);
    if (peer.endpoint) lines.push(`Endpoint = ${peer.endpoint}`);
  }
  return lines.join("\n");
}

export function safeErrorMessage(value: unknown, fallback = "Request failed"): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  return fallback;
}

// ── fleet readiness ──────────────────────────────────────────────────────
// A node is mesh-ready once the control plane holds both a WireGuard address
// and a public key for it, and both of those arrive from the node's own agent
// report. "Ready nodes 0 / 35" is the fleet's normal starting state, so the
// screen has to be able to say which half is missing rather than print a zero.

export type ReadinessGap = "ready" | "needs_key" | "needs_address" | "needs_both";

export function readinessGap(node: WireGuardNode): ReadinessGap {
  const hasAddress = !!node.address?.trim();
  const hasKey = !!node.public_key?.trim();
  if (hasAddress && hasKey) return "ready";
  if (hasAddress) return "needs_key";
  if (hasKey) return "needs_address";
  return "needs_both";
}

export function readinessGapLabel(gap: ReadinessGap): string {
  return {
    ready: "Ready",
    needs_key: "No public key reported",
    needs_address: "No WireGuard address",
    needs_both: "No address and no public key",
  }[gap];
}

export interface MeshReadiness {
  total: number;
  ready: number;
  needsKey: number;
  needsAddress: number;
  needsBoth: number;
  onlineReady: number;
  endpoints: number;
  disabled: number;
}

export function summarizeReadiness(nodes: readonly WireGuardNode[]): MeshReadiness {
  const summary: MeshReadiness = {
    total: nodes.length, ready: 0, needsKey: 0, needsAddress: 0, needsBoth: 0,
    onlineReady: 0, endpoints: 0, disabled: 0,
  };
  for (const node of nodes) {
    switch (readinessGap(node)) {
      case "ready": summary.ready += 1; break;
      case "needs_key": summary.needsKey += 1; break;
      case "needs_address": summary.needsAddress += 1; break;
      case "needs_both": summary.needsBoth += 1; break;
    }
    if (readinessGap(node) === "ready" && node.online && !node.disabled) summary.onlineReady += 1;
    if (node.endpoint?.trim()) summary.endpoints += 1;
    if (node.disabled) summary.disabled += 1;
  }
  return summary;
}

// ── fleet table ordering ─────────────────────────────────────────────────

export type NodeSortKey = "node" | "address" | "endpoint" | "configuration" | "status";
export type SortDirection = "asc" | "desc";

const CONFIG_ORDER: Record<string, number> = { ready: 0, partial: 1, missing: 2 };

function nodeSortValue(node: WireGuardNode, key: NodeSortKey): string | number {
  switch (key) {
    case "node": return (node.name || node.node_id).toLowerCase();
    case "address": return hostRoute(node.address).toLowerCase();
    case "endpoint": return (node.endpoint || "").toLowerCase();
    case "configuration": return CONFIG_ORDER[node.configuration] ?? 3;
    // Disabled sorts after offline: an offline node may come back on its own,
    // a disabled one will not.
    case "status": return node.disabled ? 2 : node.online ? 0 : 1;
  }
}

export function sortNodes(nodes: readonly WireGuardNode[], key: NodeSortKey, direction: SortDirection): WireGuardNode[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...nodes].sort((left, right) => {
    const a = nodeSortValue(left, key);
    const b = nodeSortValue(right, key);
    // The tie-break deliberately does not follow the primary direction:
    // reversing "configuration" should reverse the readiness groups, not
    // shuffle the nodes inside each one.
    if (a === b) return (left.name || left.node_id).localeCompare(right.name || right.node_id);
    if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
    return String(a).localeCompare(String(b)) * sign;
  });
}
