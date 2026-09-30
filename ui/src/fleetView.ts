import type { AgentCounts } from "./readiness";
import { hostRoute, type MeshReadiness, type WireGuardNode } from "./wireguardModel";

/**
 * What the Fleet layer does with the node list before it is drawn: the
 * search, the page arithmetic and the proof line. DOM-free, so the tests run
 * without jsdom and the template stays a template.
 */

/** 50 rows is a screen and a half at 40px, and holds the whole fleet today; the pager takes over past it. */
export const PAGE_SIZE = 50;

/**
 * The search covers what the placeholder promises: node name and id, the
 * reported address and the host route derived from it, the endpoint, the
 * public key (the full value, since the cell shows it redacted) and the public
 * IP. Case-insensitive substring; an empty term matches everything.
 */
export function matchesSearch(node: WireGuardNode, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [node.name, node.node_id, node.address, hostRoute(node.address), node.endpoint, node.public_key, node.public_ip];
  return haystack.some((value) => !!value && value.toLowerCase().includes(needle));
}

export function filterNodes(nodes: readonly WireGuardNode[], term: string): WireGuardNode[] {
  if (!term.trim()) return [...nodes];
  return nodes.filter((node) => matchesSearch(node, term));
}

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

/** "09:05:07": the absolute time of the last read, for the proof line. */
export function formatClock(date: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
}

export interface ProofInput {
  readiness: MeshReadiness;
  agents: AgentCounts;
  /** When the last good read landed; absent until one has. */
  observedAt: Date | undefined;
  /** Why the newest read failed; empty when it did not. */
  error: string;
  locale?: string;
}

/**
 * The proof line under the header: when the fleet was last read, how many
 * nodes answered, how many agents are online and how many nodes are
 * mesh-ready. Agents online and mesh-ready are two facts and are counted
 * apart. No timer runs behind it; the time names the read, not the present.
 * A read that failed with nothing loaded states no count at all, and one that
 * failed after a good read says the counts are that read's.
 */
export function proofSegments(input: ProofInput): string[] {
  const { readiness, agents, observedAt, error, locale } = input;
  if (!observedAt) return error ? [`not read: ${error}`] : ["reading the fleet"];
  const counts = [
    `${readiness.total} ${readiness.total === 1 ? "node" : "nodes"}`,
    `${agents.online} ${agents.online === 1 ? "agent" : "agents"} online`,
    ...(agents.disabled ? [`${agents.disabled} disabled`] : []),
    `${readiness.ready} mesh-ready`,
  ];
  if (error) return [`last good read at ${formatClock(observedAt, locale)}`, ...counts, "refresh failed"];
  return [`observed at ${formatClock(observedAt, locale)}`, ...counts];
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
