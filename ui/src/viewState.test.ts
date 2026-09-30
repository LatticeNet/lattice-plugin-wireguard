import { describe, expect, it } from "vitest";

import { nodePanelState } from "./viewState";

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
