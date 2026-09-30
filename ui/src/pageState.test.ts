import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_STATE_MAX_VALUE_LENGTH,
  channelFromHash,
  createStateSender,
  filterPageState,
  listenForInitPageState,
  pageStateKey,
  stateMessage,
  validPageState,
  type PageState,
} from "./pageState";
import { DEFAULT_WG_STATE, decodeWgState, encodeWgState, type WgPageState } from "./viewState";

const NONCE = "nonce-0123456789abcdef";
const HOST = "https://console.example.test";

describe("page state rules", () => {
  it("accepts a state inside the contract and drops the whole state on any bad entry", () => {
    expect(validPageState({ view: "fleet", open: "node-hkg-edge-01" })).toEqual({ view: "fleet", open: "node-hkg-edge-01" });
    expect(validPageState({})).toEqual({});
    expect(validPageState({ view: "fleet", Open: "x" })).toBeUndefined();
    expect(validPageState({ "9lives": "x" })).toBeUndefined();
    expect(validPageState({ ["a".repeat(25)]: "x" })).toBeUndefined();
    expect(validPageState({ ["a".repeat(24)]: "x" })).toEqual({ ["a".repeat(24)]: "x" });
    expect(validPageState({ q: "x".repeat(PAGE_STATE_MAX_VALUE_LENGTH + 1) })).toBeUndefined();
    expect(validPageState({ q: "x".repeat(PAGE_STATE_MAX_VALUE_LENGTH) })).toBeDefined();
    expect(validPageState({ view: 1 })).toBeUndefined();
    expect(validPageState({ token: "abc" })).toBeUndefined();
    expect(validPageState(null)).toBeUndefined();
    expect(validPageState(["view", "fleet"])).toBeUndefined();
    const seventeen = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`k${index}`, "v"]));
    expect(validPageState(seventeen)).toBeUndefined();
    delete seventeen.k16;
    expect(validPageState(seventeen)).toBeDefined();
  });

  it("filters an address entry by entry, leaving out repeats, reserved keys and extras past 16", () => {
    const query = new URLSearchParams(`view=fleet&Bad=1&expand=a&expand=b&next=/x&q=${"x".repeat(257)}&open=n1`);
    expect(filterPageState(query)).toEqual({ view: "fleet", open: "n1" });
    const many = Array.from({ length: 20 }, (_, index) => [`k${index}`, "v"] as const);
    expect(Object.keys(filterPageState(many))).toEqual(many.slice(0, 16).map(([key]) => key));
  });

  it("compares states regardless of key order", () => {
    expect(pageStateKey({ view: "fleet", q: "pg" })).toBe(pageStateKey({ q: "pg", view: "fleet" }));
    expect(pageStateKey({ view: "fleet" })).not.toBe(pageStateKey({ view: "mesh" }));
  });

  it("spells the outbound message the way the contract does", () => {
    expect(stateMessage(NONCE, { view: "mesh" })).toEqual({ type: "lattice.plugin.state", nonce: NONCE, state: { view: "mesh" } });
  });
});

describe("the channel from the frame fragment", () => {
  it("reads a nonce and an exact http(s) origin, and nothing else", () => {
    expect(channelFromHash(`#lattice_nonce=${NONCE}&host_origin=${encodeURIComponent(`${HOST}/path`)}`)).toEqual({ nonce: NONCE, hostOrigin: HOST });
    expect(channelFromHash(`#lattice_nonce=short&host_origin=${encodeURIComponent(HOST)}`)).toBeNull();
    expect(channelFromHash(`#lattice_nonce=${NONCE}`)).toBeNull();
    expect(channelFromHash(`#lattice_nonce=${NONCE}&host_origin=javascript%3Aalert(1)`)).toBeNull();
    expect(channelFromHash(`#lattice_nonce=${NONCE}&host_origin=not%20a%20url`)).toBeNull();
  });
});

describe("page state off the init message", () => {
  type Listener = (event: MessageEvent) => void;
  function fakeWindow() {
    const parent = {};
    const listeners = new Set<Listener>();
    return {
      parent,
      listeners,
      addEventListener: (_type: "message", listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: "message", listener: Listener) => listeners.delete(listener),
      deliver(data: unknown, options: { source?: unknown; origin?: string } = {}) {
        const event = { data, source: options.source ?? parent, origin: options.origin ?? HOST } as unknown as MessageEvent;
        for (const listener of listeners) listener(event);
      },
    };
  }
  const init = (extra: Record<string, unknown>) => ({ type: "lattice.host.init", nonce: NONCE, version: "1", ...extra });

  it("hands over the host's state, with a reserved key dropped on its own", () => {
    const win = fakeWindow();
    const seen: Array<PageState | undefined> = [];
    listenForInitPageState(win, { nonce: NONCE, hostOrigin: HOST }, (state) => seen.push(state));
    win.deliver(init({ pageState: { view: "fleet", open: "n1", next: "/evil" } }));
    expect(seen).toEqual([{ view: "fleet", open: "n1" }]);
  });

  it("says undefined when the host keeps no page state or breaks the rules", () => {
    const win = fakeWindow();
    const seen: Array<PageState | undefined> = [];
    listenForInitPageState(win, { nonce: NONCE, hostOrigin: HOST }, (state) => seen.push(state));
    win.deliver(init({}));
    win.deliver(init({ pageState: { View: "fleet" } }));
    win.deliver(init({ pageState: "view=fleet" }));
    expect(seen).toEqual([undefined, undefined, undefined]);
  });

  it("ignores a message from another window, another origin, another nonce, or of another type", () => {
    const win = fakeWindow();
    const seen: Array<PageState | undefined> = [];
    const stop = listenForInitPageState(win, { nonce: NONCE, hostOrigin: HOST }, (state) => seen.push(state));
    win.deliver(init({ pageState: { view: "fleet" } }), { source: {} });
    win.deliver(init({ pageState: { view: "fleet" } }), { origin: "https://elsewhere.test" });
    win.deliver({ ...init({ pageState: { view: "fleet" } }), nonce: "another-nonce-0000000" });
    win.deliver({ ...init({ pageState: { view: "fleet" } }), type: "lattice.host.theme" });
    expect(seen).toEqual([]);
    stop();
    expect(win.listeners.size).toBe(0);
  });
});

describe("sending state to the host", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends once the page has been quiet for the debounce, and only the latest state", () => {
    vi.useFakeTimers();
    const sent: PageState[] = [];
    const sender = createStateSender((value) => sent.push(value));
    sender.push({ view: "fleet" });
    vi.advanceTimersByTime(200);
    sender.push({ view: "fleet", q: "p" });
    vi.advanceTimersByTime(200);
    sender.push({ view: "fleet", q: "postgres" });
    vi.advanceTimersByTime(249);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([{ view: "fleet", q: "postgres" }]);
  });

  it("sends nothing when the state is what the host already has", () => {
    vi.useFakeTimers();
    const sent: PageState[] = [];
    const sender = createStateSender((value) => sent.push(value), { baseline: { view: "fleet", open: "n1" } });
    sender.push({ open: "n1", view: "fleet" });
    vi.advanceTimersByTime(2_000);
    expect(sent).toEqual([]);
    sender.push({});
    vi.advanceTimersByTime(2_000);
    expect(sent).toEqual([{}]);
  });

  it("spaces sends so a minute never holds more than the host's 60, and the last state lands", () => {
    vi.useFakeTimers();
    const sent: Array<{ at: number; state: PageState }> = [];
    const start = Date.now();
    const sender = createStateSender((value) => sent.push({ at: Date.now() - start, state: value }));
    for (let index = 0; index < 400; index += 1) {
      sender.push({ view: index % 2 ? "fleet" : "mesh", q: String(index) });
      vi.advanceTimersByTime(300);
    }
    vi.advanceTimersByTime(5_000);
    for (const { at } of sent) {
      expect(sent.filter((other) => other.at > at - 60_000 && other.at <= at).length).toBeLessThanOrEqual(60);
    }
    expect(sent.at(-1)?.state).toEqual({ view: "fleet", q: "399" });
  });

  it("sends nothing after dispose", () => {
    vi.useFakeTimers();
    const sent: PageState[] = [];
    const sender = createStateSender((value) => sent.push(value));
    sender.push({ view: "mesh" });
    sender.dispose();
    vi.advanceTimersByTime(2_000);
    expect(sent).toEqual([]);
  });
});

describe("the WireGuard page's own state", () => {
  const state = (patch: Partial<WgPageState> = {}): WgPageState => ({ ...DEFAULT_WG_STATE, ...patch });

  it.each<[WgPageState, PageState]>([
    [state(), {}],
    [state({ view: "fleet" }), { view: "fleet" }],
    [state({ view: "fleet", q: "hkg", open: "node-hkg-edge-01" }), { view: "fleet", open: "node-hkg-edge-01", q: "hkg" }],
    [state({ view: "mesh" }), { view: "mesh" }],
    [state({ open: "node-x" }), { open: "node-x" }],
  ])("round-trips %#", (value, encoded) => {
    expect(encodeWgState(value)).toEqual(encoded);
    expect(validPageState(encodeWgState(value))).toEqual(encoded);
    expect(decodeWgState(encoded)).toEqual(value);
  });

  it("keeps the Fleet search out of another layer's link", () => {
    expect(encodeWgState(state({ view: "mesh", q: "hkg" }))).toEqual({ view: "mesh" });
    expect(encodeWgState(state({ view: "overview", q: "hkg" }))).toEqual({});
    expect(encodeWgState(state({ view: "fleet", q: "  hkg  " }))).toEqual({ view: "fleet", q: "hkg" });
    expect(encodeWgState(state({ view: "fleet", q: "x".repeat(PAGE_STATE_MAX_VALUE_LENGTH + 1) }))).toEqual({ view: "fleet" });
  });

  it("opens old links on the layer they meant", () => {
    expect(decodeWgState({ lens: "mesh" }).view).toBe("mesh");
    expect(decodeWgState({ lens: "fleet" }).view).toBe("fleet");
    expect(decodeWgState({ view: "mesh", lens: "fleet" }).view).toBe("mesh");
    expect(decodeWgState({ expand: "node-a,node-b" }).open).toBe("node-a");
    expect(decodeWgState({ view: "planet" })).toEqual(state());
  });
});
