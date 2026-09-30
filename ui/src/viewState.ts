/**
 * The WireGuard page's own state, as the console address carries it.
 *
 * `view` is the layer (Overview is the default and is left out of the
 * address), `open` the node whose panel is open, and `q` the Fleet search.
 * Links from before the layers still land: `lens=mesh` is the Mesh layer,
 * `lens=fleet` the Fleet, and `expand=<id>` opens that node's panel.
 */
import { putState, type PageState } from "./pageState";

export type WgView = "overview" | "fleet" | "mesh";
export const WG_VIEWS: readonly WgView[] = ["overview", "fleet", "mesh"];

export interface WgPageState {
  view: WgView;
  open: string;
  q: string;
}

export const DEFAULT_WG_STATE: Readonly<WgPageState> = { view: "overview", open: "", q: "" };

const LEGACY_LENS: Record<string, WgView> = { fleet: "fleet", mesh: "mesh" };

function pick<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** State to address entries. Defaults stay out, so the default layer has a bare address. */
export function encodeWgState(state: WgPageState): PageState {
  const out: PageState = {};
  putState(out, "view", state.view, DEFAULT_WG_STATE.view);
  putState(out, "open", state.open);
  // Only Fleet has a search field; a search typed there is not carried into another layer's link.
  if (state.view === "fleet") putState(out, "q", state.q.trim());
  return out;
}

/** Address entries back to state; anything unknown falls back to the default. */
export function decodeWgState(state: PageState): WgPageState {
  const view = pick(state.view, WG_VIEWS) ?? LEGACY_LENS[state.lens ?? ""] ?? DEFAULT_WG_STATE.view;
  const legacyNode = (state.expand ?? "").split(",").map((id) => id.trim()).find(Boolean) ?? "";
  return { view, open: state.open ?? legacyNode, q: state.q ?? "" };
}

/** What the node panel on `open=<id>` can honestly show. */
export type NodePanelState = "found" | "loading" | "unread" | "missing";

/**
 * "missing" is a claim that the node is not in the fleet, so only a read that
 * landed may make it. While nothing has landed or failed the panel is
 * loading; once the read that lists nodes has failed, the node was not read.
 */
export function nodePanelState(input: { found: boolean; loading: boolean; readFailed: boolean }): NodePanelState {
  if (input.found) return "found";
  if (input.loading) return "loading";
  return input.readFailed ? "unread" : "missing";
}

/** The panel title for a node the panel could not show; a found node titles the panel with its name. */
export const PANEL_TITLE: Record<NodePanelState, string> = {
  found: "",
  loading: "Loading node",
  unread: "Node not read",
  missing: "Node not found",
};
