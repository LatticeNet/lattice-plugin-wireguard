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

/**
 * The single host route a peer is pinned to in AllowedIPs.
 *
 * This is NOT a node's interface address. The server assigns the interface a
 * wider mesh prefix (ensureCIDR(WireGuardIP, 24) in
 * lattice-server/internal/wireguard), while every peer is pinned to one host
 * route so a node cannot impersonate another node's mesh IP. The two happen to
 * be derived from the same reported IP, which is exactly why they used to get
 * conflated here. Use this only where the label says AllowedIPs.
 */
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

/**
 * The listen port to send, from whatever the port field currently holds.
 *
 * Takes `unknown` on purpose. Vue applies the `.number` modifier implicitly to
 * `v-model` on an `<input type="number">`, so this field is a string until the
 * operator touches it and a number (or NaN, when cleared) afterwards. Typing
 * `value.trim()` against that threw "value.trim is not a function" the moment
 * anyone edited the port, and the failure landed in a page-level error slot
 * behind the dialog's own scrim, so the Generate button simply looked dead.
 */
export function normalizedPort(value: unknown, fallback = 51820): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") {
    // An emptied number input yields NaN, which means "unset", not "invalid".
    if (Number.isNaN(value)) return fallback;
    return assertPort(value);
  }
  const text = String(value).trim();
  if (!text) return fallback;
  return assertPort(Number(text));
}

function assertPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Listen port must be a whole number from 1 to 65535");
  }
  return port;
}

/**
 * The nodes a mesh can be compiled from, as far as this session can see.
 *
 * Matches the server's BuildMesh skip rule (a peer needs both a public key and
 * a mesh IP) for the set of nodes `overview` returned. It cannot match the
 * server's peer list outright, because `overview` filters nodes by the
 * session's wireguard:read scope while the plan is built from the whole node
 * store. A scope-limited operator therefore sees fewer peers here than the
 * plan will contain, and the screen has to say so rather than imply this is
 * the full set.
 */
export function meshReadyNodes(nodes: readonly WireGuardNode[]): WireGuardNode[] {
  return nodes.filter((node) => readinessGap(node) === "ready");
}

export function meshPeersFor(target: WireGuardNode | undefined, nodes: readonly WireGuardNode[]): WireGuardNode[] {
  if (!target) return [];
  return meshReadyNodes(nodes).filter((node) => node.node_id !== target.node_id);
}

/**
 * What this plugin cannot know about the configuration that gets applied.
 *
 * There is exactly one renderer for a wg0.conf and it lives in the server
 * (internal/wireguard, reachable only through the plan endpoint, which files an
 * approval as a side effect). Every one of these is a field the server decides
 * and never sends to this plugin, so any config this plugin drew would differ
 * from the one an operator approves. The list is rendered in the UI rather than
 * kept as a comment, because an unlabelled approximation of a security artefact
 * is the defect, not the specific octet.
 */
export const PLAN_UNKNOWNS: readonly string[] = [
  "the interface address prefix, which the control plane assigns and which is wider than a host route",
  "PersistentKeepalive, which the control plane sets on every peer",
  "MTU and DNS, when the control plane has them configured",
  "peers on nodes outside this session's read scope, which are still written into the plan",
];

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
