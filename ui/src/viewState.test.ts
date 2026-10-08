import { describe, expect, it } from "vitest";

import { listPanelStale, nodePanelState } from "./viewState";

describe("the node panel's state", () => {
  it("says a node is missing only after a read that landed", () => {
    expect(nodePanelState({ found: false, loading: false, readFailed: false })).toBe("missing");
  });

  it("says the node was not read when the read that lists nodes failed", () => {
    // Not "missing": a 503 says nothing about whether the node exists.
    expect(nodePanelState({ found: false, loading: false, readFailed: true })).toBe("unread");
  });

  it("loads until a read lands or fails, and never spins after a failure", () => {
    expect(nodePanelState({ found: false, loading: true, readFailed: false })).toBe("loading");
    expect(nodePanelState({ found: false, loading: false, readFailed: true })).not.toBe("loading");
  });

  it("shows a node that is listed, whatever a later read did", () => {
    expect(nodePanelState({ found: true, loading: false, readFailed: true })).toBe("found");
  });
});

describe("a list layer's panel while the query does not read", () => {
  it("is dimmed and inert while it shows rows of the last query that read", () => {
    expect(listPanelStale({ invalid: true, rows: 3 })).toBe(true);
  });

  it("stays live over the no-match state, so Clear the query works", () => {
    expect(listPanelStale({ invalid: true, rows: 0 })).toBe(false);
  });

  it("is never dimmed while the query reads", () => {
    expect(listPanelStale({ invalid: false, rows: 3 })).toBe(false);
    expect(listPanelStale({ invalid: false, rows: 0 })).toBe(false);
  });
});
