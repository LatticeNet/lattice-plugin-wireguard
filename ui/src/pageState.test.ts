import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PAGE_STATE_MAX_VALUE_LENGTH,
  createStateSender,
  filterPageState,
  pageStateKey,
  validPageState,
  type PageState,
} from "./pageState";
import { DEFAULT_WG_STATE, decodeWgState, encodeWgState, type WgPageState } from "./viewState";

// The contract's rules themselves (validPageState) are the bridge client's
// and are tested in @latticenet/plugin-bridge.
describe("page state rules", () => {
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
    [state({ view: "mesh", q: "-endpoint:* sort:address" }), { view: "mesh", q: "-endpoint:* sort:address" }],
    [state({ open: "node-x" }), { open: "node-x" }],
  ])("round-trips %#", (value, encoded) => {
    expect(encodeWgState(value)).toEqual(encoded);
    expect(validPageState(encodeWgState(value))).toEqual(encoded);
    expect(decodeWgState(encoded)).toEqual(value);
  });

  it("carries the query of the list layer in view, and none on the Overview", () => {
    expect(encodeWgState(state({ view: "mesh", q: "hkg" }))).toEqual({ view: "mesh", q: "hkg" });
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
