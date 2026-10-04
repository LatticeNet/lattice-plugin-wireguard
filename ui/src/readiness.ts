/**
 * The Overview and the fleet grouping: why the mesh cannot form, what each
 * node lacks, and which columns hold anything at all.
 *
 * A node is mesh-ready once the control plane holds both its WireGuard
 * address and its public key. Both come from the node's own agent report, and
 * the agent reports exactly what `LATTICE_WG_IP` and `LATTICE_WG_PUBKEY` hold
 * in its environment (lattice-node-agent cmd/lattice-agent/main.go); nothing
 * in the product generates them yet. So on a fleet where no agent has them the
 * honest first screen is that sentence and the step that changes it, not four
 * tiles of zeros and a table of "not reported". DOM-free, so the tests run
 * without jsdom.
 */
import { readinessGap, type MeshReadiness, type ReadinessGap, type WireGuardNode } from "./wireguardModel";

// ── agents ────────────────────────────────────────────────────────────────

export interface AgentCounts {
  total: number;
  online: number;
  offline: number;
  disabled: number;
}

/** Agent liveness, which is a different fact from mesh readiness. */
export function agentCounts(nodes: readonly WireGuardNode[]): AgentCounts {
  const counts: AgentCounts = { total: nodes.length, online: 0, offline: 0, disabled: 0 };
  for (const node of nodes) {
    if (node.disabled) counts.disabled += 1;
    else if (node.online) counts.online += 1;
    else counts.offline += 1;
  }
  return counts;
}

// ── attention ─────────────────────────────────────────────────────────────

export type AttentionTone = "danger" | "warning" | "info";
export type AttentionActionKind = "tasks" | "fleet" | "mesh";

export interface AttentionItem {
  key: string;
  tone: AttentionTone;
  claim: string;
  proof: string;
  actions: { label: string; kind: AttentionActionKind }[];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "34 report no WireGuard address or public key, 1 no public key" */
function gapBreakdown(readiness: MeshReadiness): string {
  const parts: string[] = [];
  if (readiness.needsBoth) parts.push(`${readiness.needsBoth} report no WireGuard address or public key`);
  if (readiness.needsKey) parts.push(`${readiness.needsKey} report an address but no public key`);
  if (readiness.needsAddress) parts.push(`${readiness.needsAddress} report a public key but no address`);
  return parts.join(", ");
}

const REMEDY =
  "A node's agent reports what LATTICE_WG_IP and LATTICE_WG_PUBKEY hold. A reviewed task on the node can generate its key there, where it stays, set both, and restart the agent; its next report makes it ready.";

/**
 * What stops the mesh, in the order it has to be fixed: fewer than two ready
 * nodes means there is no mesh at all; two or more with no public endpoint
 * means nobody can dial anyone. Nodes still missing a piece on a working mesh
 * are information, listed but not alarming.
 */
export function meshAttention(nodes: readonly WireGuardNode[], readiness: MeshReadiness): AttentionItem[] {
  if (!readiness.total) return [];
  const items: AttentionItem[] = [];
  const notReady = readiness.total - readiness.ready;
  const remedyActions: AttentionItem["actions"] = [
    { label: "Open Tasks", kind: "tasks" },
    { label: "See what each node lacks", kind: "fleet" },
  ];

  if (readiness.ready < 2) {
    items.push({
      key: "no-mesh",
      tone: "danger",
      claim:
        readiness.ready === 0
          ? `0 of ${readiness.total} ready: ${gapBreakdown(readiness)}`
          : `1 of ${readiness.total} ready, and a mesh needs two: ${gapBreakdown(readiness)}`,
      proof: REMEDY,
      actions: remedyActions,
    });
    return items;
  }

  const ready = nodes.filter((node) => readinessGap(node) === "ready");
  const reachable = ready.filter((node) => node.endpoint?.trim());
  if (!reachable.length) {
    items.push({
      key: "no-endpoint",
      tone: "warning",
      claim: `${readiness.ready} nodes are ready, but none has a public endpoint, so no peer can dial in`,
      proof: "At least one node needs a reachable endpoint (LATTICE_WG_ENDPOINT on its agent) for the others to connect to it.",
      actions: [{ label: "Show the mesh", kind: "mesh" }],
    });
  }

  const offline = ready.filter((node) => !node.online || node.disabled);
  if (offline.length) {
    items.push({
      key: "ready-offline",
      tone: "warning",
      claim: `${plural(offline.length, "mesh-ready node is", "mesh-ready nodes are")} not online`,
      proof: offline.slice(0, 4).map((node) => node.name || node.node_id).join(", ") + (offline.length > 4 ? ` and ${offline.length - 4} more` : ""),
      actions: [{ label: "Show the mesh", kind: "mesh" }],
    });
  }

  if (notReady) {
    items.push({
      key: "not-ready",
      tone: "info",
      claim: `${notReady} of ${readiness.total} not ready yet: ${gapBreakdown(readiness)}`,
      proof: REMEDY,
      actions: remedyActions,
    });
  }
  return items;
}

// ── the readiness bar ─────────────────────────────────────────────────────

export interface BarSegment {
  key: "ready" | "partial" | "missing";
  label: string;
  count: number;
  /** Share of the fleet, 0 to 100. */
  share: number;
}

/** Ready, partial (one half of the pair reported), missing (neither). */
export function readinessBar(readiness: MeshReadiness): BarSegment[] {
  const partial = readiness.needsKey + readiness.needsAddress;
  const share = (count: number) => (readiness.total ? (count / readiness.total) * 100 : 0);
  return [
    { key: "ready", label: "ready", count: readiness.ready, share: share(readiness.ready) },
    { key: "partial", label: "one half reported", count: partial, share: share(partial) },
    { key: "missing", label: "nothing reported", count: readiness.needsBoth, share: share(readiness.needsBoth) },
  ];
}

// ── the fleet, grouped by what each node lacks ────────────────────────────

export interface GapGroup {
  gap: ReadinessGap;
  label: string;
  nodes: WireGuardNode[];
  online: number;
}

const GAP_ORDER: readonly ReadinessGap[] = ["needs_both", "needs_key", "needs_address", "ready"];
const GAP_LABEL: Record<ReadinessGap, string> = {
  needs_both: "No address and no public key",
  needs_key: "Address reported, no public key",
  needs_address: "Public key reported, no address",
  ready: "Mesh-ready",
};

/** Groups in the order they need work, each keeping the list's own order. Empty groups are left out. */
export function gapGroups(nodes: readonly WireGuardNode[]): GapGroup[] {
  return GAP_ORDER.map((gap) => {
    const members = nodes.filter((node) => readinessGap(node) === gap);
    return { gap, label: GAP_LABEL[gap], nodes: members, online: members.filter((node) => node.online && !node.disabled).length };
  }).filter((group) => group.nodes.length > 0);
}

export interface ReportedColumns {
  address: boolean;
  publicKey: boolean;
  endpoint: boolean;
}

/** A column shows only when at least one row has something in it (design 22 rule 3). */
export function reportedColumns(nodes: readonly WireGuardNode[]): ReportedColumns {
  return {
    address: nodes.some((node) => node.address?.trim()),
    publicKey: nodes.some((node) => node.public_key?.trim()),
    endpoint: nodes.some((node) => node.endpoint?.trim()),
  };
}

/**
 * The one line over the Fleet table that says which columns left and why:
 * "No node reports an address, a public key or an endpoint, so those
 * columns are left out." Empty when every column has something in it.
 */
export function missingColumnsNote(columns: ReportedColumns): string {
  const missing = [
    columns.address ? "" : "an address",
    columns.publicKey ? "" : "a public key",
    columns.endpoint ? "" : "an endpoint",
  ].filter(Boolean);
  if (!missing.length) return "";
  if (missing.length === 1) return `No node reports ${missing[0]}, so that column is left out.`;
  return `No node reports ${missing.slice(0, -1).join(", ")} or ${missing.at(-1)}, so those columns are left out.`;
}
