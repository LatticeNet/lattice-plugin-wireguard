import { hostRoute, type MeshReadiness, type WireGuardNode } from "./wireguardModel";

/**
 * What the fleet lens does with the node list before it is drawn: the lens
 * names, the search, the page arithmetic and the proof line. DOM-free, so the
 * tests run without jsdom and the template stays a template.
 */

export type Lens = "fleet" | "mesh";

/** The lens the document query names; anything unknown is the fleet. */
export function lensFrom(value: string | null | undefined): Lens {
  return value === "mesh" ? "mesh" : "fleet";
}

/** Lines paginates its fleet at 25 groups a page; the same rhythm here. */
export const PAGE_SIZE = 25;

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

/**
 * The proof line under the header: when the fleet was last read, how many
 * nodes answered, how many of them are mesh-ready and how many of those are
 * online. No timer runs behind it; the time stays true for as long as the tab
 * is open because it names the read, not the present.
 */
export function proofSegments(readiness: MeshReadiness, observedAt: Date | undefined, locale?: string): string[] {
  return [
    observedAt ? `observed at ${formatClock(observedAt, locale)}` : "not observed yet",
    `${readiness.total} ${readiness.total === 1 ? "node" : "nodes"}`,
    `${readiness.ready} mesh-ready`,
    `${readiness.onlineReady} online`,
  ];
}
