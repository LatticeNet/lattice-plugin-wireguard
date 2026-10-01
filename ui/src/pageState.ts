/**
 * chassis-copy: the same file is in lattice-plugin-netguard and
 * lattice-plugin-wireguard, and vpn-core and Sub-Store carry their own. It
 * belongs in @latticenet/plugin-bridge/chassis as a pageState helper (the
 * client already owns init); change every copy together until the chassis
 * release that exports it, then delete them.
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
 *                   console's plugin route, filtered by the rules below;
 *   plugin to host  `lattice.plugin.state` carries the full state, debounced,
 *                   and the console replaces its query with it (history
 *                   replace, no frame reload).
 *
 * Both sides apply the same rules: at most 16 keys, keys
 * `^[a-z][a-z0-9_]{0,23}$`, string values up to 256 characters, nothing before
 * init, and the console's reserved keys never cross in either direction.
 *
 * The bridge client this plugin vendors (0.1.0-alpha.2) rebuilds init from
 * the fields it knows and drops `pageState`, so the field is read here from
 * the same message, behind the same checks the client applies (the parent
 * window, the pinned host origin, the frame's nonce), and the state message
 * is posted the same way the client posts its own. A console that predates
 * the contract sends no `pageState` and ignores the message; the page then
 * keeps its state in its own document query, which survives only a reload of
 * the frame itself and may be refused in an opaque-origin frame, so that
 * write is best effort.
 */

export type PageState = Record<string, string>;

export const PAGE_STATE_MESSAGE = "lattice.plugin.state";
export const PAGE_STATE_MAX_KEYS = 16;
export const PAGE_STATE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,23}$/;
export const PAGE_STATE_MAX_VALUE_LENGTH = 256;
/** The console's own query keys. They never cross the bridge either way. */
export const RESERVED_PAGE_STATE_KEYS: ReadonlySet<string> = new Set([
  "redirect", "next", "code", "state", "token", "sso_error", "totp_challenge", "mfa",
]);

function validEntry(key: string, value: unknown): value is string {
  return PAGE_STATE_KEY_PATTERN.test(key) && !RESERVED_PAGE_STATE_KEYS.has(key) &&
    typeof value === "string" && value.length <= PAGE_STATE_MAX_VALUE_LENGTH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The entries of a record without the console's reserved keys. */
export function withoutReservedKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !RESERVED_PAGE_STATE_KEYS.has(key)));
}

/**
 * The state if every entry keeps the rules, otherwise undefined. One bad entry
 * drops the whole state, as the host drops the whole message, so a state is
 * never applied by halves.
 */
export function validPageState(value: unknown): PageState | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > PAGE_STATE_MAX_KEYS) return undefined;
  const state: PageState = {};
  for (const [key, entry] of entries) {
    if (!validEntry(key, entry)) return undefined;
    state[key] = entry;
  }
  return state;
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

// ── the channel ───────────────────────────────────────────────────────────

/** The frame's channel as the URL fragment names it, or null when it does not. */
export interface Channel {
  nonce: string;
  hostOrigin: string;
}

/**
 * The nonce and host origin from the frame URL fragment, fail-closed the way
 * the bridge client reads them: an absent nonce, or a host origin that is not
 * an absolute http(s) origin, is no channel at all.
 */
export function channelFromHash(hash: string): Channel | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const nonce = params.get("lattice_nonce") ?? "";
  if (nonce.length < 16 || nonce.length > 128) return null;
  const raw = params.get("host_origin")?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return { nonce, hostOrigin: url.origin };
}

interface MessageWindow {
  parent: unknown;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/**
 * `pageState` off the host's init message: the state when the host keeps page
 * state, undefined when it sent none (a console from before the contract) or
 * sent a state that breaks the rules (a host fault, set aside rather than
 * failing the start). A reserved key is dropped on its own on the way in.
 *
 * Register this before constructing the bridge client. The browser runs
 * microtasks between two listeners of one message, so a listener added after
 * the client's would hear init only after the page had already reacted to it.
 */
export function listenForInitPageState(
  win: MessageWindow,
  channel: Channel,
  onState: (state: PageState | undefined) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== win.parent || event.origin !== channel.hostOrigin) return;
    const data = event.data as unknown;
    if (!isRecord(data) || data.nonce !== channel.nonce || data.type !== "lattice.host.init") return;
    if (data.pageState === undefined) {
      onState(undefined);
      return;
    }
    onState(validPageState(isRecord(data.pageState) ? withoutReservedKeys(data.pageState) : data.pageState));
  };
  win.addEventListener("message", onMessage);
  return () => win.removeEventListener("message", onMessage);
}

/** The outbound message, exactly as the contract spells it. */
export function stateMessage(nonce: string, state: PageState): { type: string; nonce: string; state: PageState } {
  return { type: PAGE_STATE_MESSAGE, nonce, state };
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
