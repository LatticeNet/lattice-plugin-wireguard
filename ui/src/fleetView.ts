import type { AgentCounts } from "./readiness";
import type { MeshReadiness, ReadinessGap, WireGuardNode } from "./wireguardModel";

/**
 * What the Fleet layer does with the node list before it is drawn: the page
 * arithmetic and the proof line. The query is listQuery.ts. DOM-free, so the
 * tests run without jsdom and the template stays a template.
 */

/** 50 rows is a screen and a half at 40px, and holds the whole fleet today; the pager takes over past it. */
export const PAGE_SIZE = 50;

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** The 1-based page that holds the item at `index`; a missing item is page 1. */
export function pageOf(index: number, size = PAGE_SIZE): number {
  return index < 0 ? 1 : Math.floor(index / size) + 1;
}

export function pageSlice<T>(items: readonly T[], page: number, size = PAGE_SIZE): T[] {
  const start = (Math.max(1, page) - 1) * size;
  return items.slice(start, start + size);
}

/** "09:05:07": the absolute time of the last read, for the proof line's title. */
export function formatClock(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
}

/** "41s", "12m", "3h", "2d": how old an instant is at `now`; "" when it does not parse. */
export function ageLabel(at: Date | string | undefined, now: number): string {
  const time = at instanceof Date ? at.getTime() : at ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** The proof line's title: the absolute instant its relative age counts from. */
export function proofTitle(observedAt: Date | undefined, locale?: string): string {
  if (!observedAt) return "";
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(observedAt);
  return `Fleet read at ${formatClock(observedAt, locale)} on ${day}. Refresh reads it again.`;
}

export interface ProofInput {
  readiness: MeshReadiness;
  agents: AgentCounts;
  /** When the last good read landed; absent until one has. */
  observedAt: Date | undefined;
  /** Why the newest read failed; empty when it did not. */
  error: string;
  /** Now, for the read's age. */
  now: number;
}

/**
 * The proof line under the header: when the fleet was last read, how many
 * nodes answered, how many agents are online and how many nodes are
 * mesh-ready. Agents online and mesh-ready are two facts and are counted
 * apart. The age is relative, the console's form ("observed 13s ago"), and
 * the absolute instant is the line's title (proofTitle).
 * A read that failed with nothing loaded states no count at all, and one that
 * failed after a good read says the counts are that read's.
 */
export function proofSegments(input: ProofInput): string[] {
  const { readiness, agents, observedAt, error, now } = input;
  if (!observedAt) return error ? [`not read: ${error}`] : ["reading the fleet"];
  const counts = [
    `${readiness.total} ${readiness.total === 1 ? "node" : "nodes"}`,
    `${agents.online} ${agents.online === 1 ? "agent" : "agents"} online`,
    ...(agents.disabled ? [`${agents.disabled} disabled`] : []),
    `${readiness.ready} mesh-ready`,
  ];
  if (error) return [`last good read ${ageLabel(observedAt, now)} ago`, ...counts, "refresh failed"];
  return [`observed ${ageLabel(observedAt, now)} ago`, ...counts];
}

/** The node's display name: the agent's name, or its id when it reported none. */
export function displayName(node: WireGuardNode): string {
  return node.name || node.node_id;
}

export type AgentState = "online" | "offline" | "disabled";

/** The word beside the dot. Colour is never the only carrier (design 4.7). */
export function agentState(node: WireGuardNode): AgentState {
  if (node.disabled) return "disabled";
  return node.online ? "online" : "offline";
}

/** The dot's tone. Offline is the console's offline red, not a warning amber. */
export function agentTone(node: WireGuardNode): "healthy" | "error" | "neutral" {
  const state = agentState(node);
  return state === "online" ? "healthy" : state === "offline" ? "error" : "neutral";
}

export interface FleetNotice {
  tone: "danger" | "warning";
  title: string;
  /** Only once rows stand behind it. With nothing loaded, the notice and the empty block are one state and dismissing it would leave a false empty fleet. */
  dismissible: boolean;
}

/** The page-level notice for a handshake or read failure; absent while nothing has failed. */
export function fleetNotice(state: { bootError: string; error: string; loaded: number }): FleetNotice | undefined {
  if (state.bootError) return { tone: "danger", title: "This page has no console session", dismissible: false };
  if (!state.error) return undefined;
  if (state.loaded > 0) return { tone: "warning", title: "The fleet below is the last good read, not the current one", dismissible: true };
  return { tone: "danger", title: "The fleet could not be read", dismissible: false };
}

/** "3m ago" beside the agent's state, or "never seen"; the absolute time goes in the cell's title. */
export function agentAge(node: WireGuardNode, now: number): string {
  const age = ageLabel(node.last_seen, now);
  return age ? `${age} ago` : "never seen";
}

/**
 * What a gap means for the mesh, said once on the group's shelf so the rows
 * under it carry only their own facts. Every group that cannot be planned
 * says so, which is why its rows draw no menu.
 */
export function gapConsequence(gap: ReadinessGap): string {
  switch (gap) {
    case "ready":
      return "In the mesh: each gets a host route to every other ready node";
    case "needs_key":
      return "Out of the mesh, and nothing to plan, until the agent reports its public key";
    case "needs_address":
      return "Out of the mesh, and nothing to plan, until the agent reports its WireGuard address";
    default:
      return "Out of the mesh, and nothing to plan, until the agent reports both";
  }
}

/** "34 nodes · 32 agents online", over the whole filtered fleet rather than one page. */
export function gapCountLine(total: { count: number; online: number }): string {
  return `${total.count} ${total.count === 1 ? "node" : "nodes"} · ${total.online} ${total.online === 1 ? "agent" : "agents"} online`;
}
