/**
 * chassis-copy: the same file is in lattice-plugin-netguard and
 * lattice-plugin-wireguard, and vpn-core and Sub-Store carry their own. The
 * rules, the init field and the outbound message are the bridge client's
 * since @latticenet/plugin-bridge 0.2.0; what is left here (the address
 * filter, the frame's own fallback and the paced sender) belongs in the
 * chassis too. Change every copy together until a chassis release exports
 * it, then delete them.
 *
 * pageState.ts, where the page's layer, open object and search live between
 * reloads.
 *
 * The frame URL cannot carry them: the console builds a content-addressed
 * frame URL with no query and rebuilds it on every reload. The console's own
 * address survives a reload and is what an operator pastes to someone else,
 * so the bridge moves the state there and back (design 22, "Plugin page state
 * in the console address"):
 *
 *   host to plugin  `lattice.host.init` carries `pageState`, the query of the
 *                   console's plugin route, filtered by the contract's rules
 *                   (HostInit.pageState);
 *   plugin to host  BridgeClient.sendState posts `lattice.plugin.state` with
 *                   the full state, which createStateSender below debounces
 *                   and paces, and the console replaces its query with it
 *                   (history replace, no frame reload).
 *
 * Both sides apply the same rules (validPageState in the bridge): at most 16
 * keys, keys `^[a-z][a-z0-9_]{0,23}$`, string values up to 256 characters,
 * nothing before init, and the console's reserved keys never cross in either
 * direction. A console that predates the contract sends no `pageState` and
 * ignores the message; the page then keeps its state in its own document
 * query, which survives only a reload of the frame itself and may be refused
 * in an opaque-origin frame, so that write is best effort.
 */

import {
  PAGE_STATE_KEY_PATTERN,
  PAGE_STATE_MAX_KEYS,
  PAGE_STATE_MAX_VALUE_LENGTH,
  PAGE_STATE_RESERVED_KEYS,
  validPageState,
  type PageState,
} from "@latticenet/plugin-bridge";

export { PAGE_STATE_MAX_VALUE_LENGTH, validPageState, type PageState };

function validEntry(key: string, value: unknown): value is string {
  return PAGE_STATE_KEY_PATTERN.test(key) && !PAGE_STATE_RESERVED_KEYS.has(key) &&
    typeof value === "string" && value.length <= PAGE_STATE_MAX_VALUE_LENGTH;
}

/**
 * An address query read as page state. The address may hold anything a hand
 * or an old link put there, so entries that break the rules are left out one
 * by one rather than failing the lot, a repeated key among them (one value
 * would be a guess). At most 16 are kept, in order.
 */
export function filterPageState(entries: Iterable<readonly [string, unknown]>): PageState {
  const list = [...entries];
  const seen = new Map<string, number>();
  for (const [key] of list) seen.set(key, (seen.get(key) ?? 0) + 1);
  const state: PageState = {};
  let kept = 0;
  for (const [key, value] of list) {
    if (kept >= PAGE_STATE_MAX_KEYS) break;
    if (seen.get(key) !== 1 || !validEntry(key, value)) continue;
    state[key] = value;
    kept += 1;
  }
  return state;
}

/** One spelling per state regardless of key order, for comparing states. */
export function pageStateKey(state: PageState): string {
  return JSON.stringify(Object.entries(state).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ── the fallback: the frame's own document query ──────────────────────────

export function documentPageState(): PageState {
  if (typeof location === "undefined") return {};
  return filterPageState(new URLSearchParams(location.search));
}

/** Replace the document's query with `state`. The hash carries the channel
 *  nonce and host origin and is kept as it is. */
export function writeDocumentState(state: PageState): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  const search = new URLSearchParams(state).toString();
  const next = `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
  if (next === `${location.pathname}${location.search}${location.hash}`) return;
  try {
    history.replaceState(history.state, "", next);
  } catch {
    // An opaque-origin frame may refuse; the state stays in memory.
  }
}

// ── sending ───────────────────────────────────────────────────────────────

export const STATE_DEBOUNCE_MS = 250;
/* The host takes at most 60 states in any 60 seconds and ignores the rest,
 * which would leave the address on an older state. Spacing sends a little over
 * a second apart keeps every window under that, and the last state of a burst
 * always goes out. */
export const STATE_MIN_INTERVAL_MS = 1_050;

export interface StateSender {
  /** The page's full current state. Sent once it has been quiet for the
   *  debounce and differs from what the host last had. */
  push(state: PageState): void;
  dispose(): void;
}

export function createStateSender(
  send: (state: PageState) => void,
  options: { baseline?: PageState; debounceMs?: number; minIntervalMs?: number; now?: () => number } = {},
): StateSender {
  const debounceMs = options.debounceMs ?? STATE_DEBOUNCE_MS;
  const minIntervalMs = options.minIntervalMs ?? STATE_MIN_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  let last = pageStateKey(options.baseline ?? {});
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: PageState | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const flush = () => {
    timer = undefined;
    const state = pending;
    pending = undefined;
    if (!state || disposed) return;
    const key = pageStateKey(state);
    if (key === last) return;
    last = key;
    lastSentAt = now();
    send(state);
  };

  return {
    push(state) {
      if (disposed) return;
      pending = { ...state };
      if (timer !== undefined) clearTimeout(timer);
      const wait = Math.max(debounceMs, lastSentAt + minIntervalMs - now());
      timer = setTimeout(flush, wait);
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}

/** Values longer than the contract allows are left out rather than cut, because
 *  a cut search or node id would name something else. */
export function putState(out: PageState, key: string, value: string, fallback = ""): void {
  if (value !== fallback && value.length <= PAGE_STATE_MAX_VALUE_LENGTH) out[key] = value;
}
