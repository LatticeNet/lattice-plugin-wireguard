import { describe, expect, it } from "vitest";

import { agentState, filterNodes, fleetNotice, formatClock, matchesSearch, pageCount, pageOf, pageSlice, proofSegments } from "./fleetView";
import { agentCounts } from "./readiness";
import { summarizeReadiness, type WireGuardNode } from "./wireguardModel";

function node(overrides: Partial<WireGuardNode> = {}): WireGuardNode {
  return { node_id: "node-hkg-edge-01", name: "hkg-edge-01", online: true, configuration: "missing", ...overrides };
}

describe("matchesSearch", () => {
  const ready = node({
    address: "10.66.0.7",
    public_key: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg=",
    endpoint: "hkg-edge-01.example.invalid:51820",
    public_ip: "203.0.113.7",
  });

  it("matches everything on an empty or blank term", () => {
    expect(matchesSearch(ready, "")).toBe(true);
    expect(matchesSearch(ready, "   ")).toBe(true);
  });

  it("matches name, id, address, host route, endpoint, key and public IP, case-insensitively", () => {
    expect(matchesSearch(ready, "HKG-EDGE")).toBe(true);
    expect(matchesSearch(ready, "node-hkg")).toBe(true);
    expect(matchesSearch(ready, "10.66.0.7")).toBe(true);
    expect(matchesSearch(ready, "10.66.0.7/32")).toBe(true);
    expect(matchesSearch(ready, ":51820")).toBe(true);
    expect(matchesSearch(ready, "qrstuvwx")).toBe(true);
    expect(matchesSearch(ready, "203.0.113.7")).toBe(true);
  });

  it("does not match a node that reports none of the fields", () => {
    expect(matchesSearch(node(), "10.66")).toBe(false);
    expect(matchesSearch(node(), "51820")).toBe(false);
  });

  it("filters a list without reordering it", () => {
    const nodes = [node({ name: "a-1", node_id: "n1" }), node({ name: "b-1", node_id: "n2", address: "10.0.0.2" }), node({ name: "a-2", node_id: "n3" })];
    expect(filterNodes(nodes, "a-").map((item) => item.node_id)).toEqual(["n1", "n3"]);
    expect(filterNodes(nodes, "").map((item) => item.node_id)).toEqual(["n1", "n2", "n3"]);
  });
});

describe("paging", () => {
  it("never reports fewer than one page", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(34)).toBe(1);
  });

  it("finds the page that holds an index and treats a missing item as page one", () => {
    expect(pageOf(0)).toBe(1);
    expect(pageOf(49)).toBe(1);
    expect(pageOf(50)).toBe(2);
    expect(pageOf(-1)).toBe(1);
    expect(pageOf(7, 5)).toBe(2);
  });

  it("slices the page and clamps a page below one", () => {
    const items = Array.from({ length: 70 }, (_, index) => index);
    expect(pageSlice(items, 1)).toHaveLength(50);
    expect(pageSlice(items, 2)).toEqual(items.slice(50));
    expect(pageSlice(items, 0)).toEqual(items.slice(0, 50));
    expect(pageSlice(items, 3)).toEqual([]);
  });
});

describe("proof line", () => {
  it("prints the clock on a 24-hour cycle", () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5, 7), "en-GB")).toBe("09:05:07");
    expect(formatClock(new Date(2026, 0, 1, 0, 0, 0), "en-GB")).toBe("00:00:00");
  });

  it("counts agents online and mesh-ready nodes apart", () => {
    const nodes = [
      node({ address: "10.66.0.1", public_key: "k".repeat(44), online: true }),
      node({ node_id: "n2", address: "10.66.0.2", public_key: "k".repeat(44), online: false }),
      node({ node_id: "n3", online: true }),
      node({ node_id: "n4", online: true, disabled: true }),
    ];
    const segments = proofSegments({ readiness: summarizeReadiness(nodes), agents: agentCounts(nodes), observedAt: new Date(2026, 7, 18, 23, 21, 14), error: "", locale: "en-GB" });
    expect(segments).toEqual(["observed at 23:21:14", "4 nodes", "2 agents online", "1 disabled", "2 mesh-ready"]);
  });

  it("prints production's fleet the way production has it: agents online, nothing ready", () => {
    const nodes = Array.from({ length: 34 }, (_, index) => node({ node_id: `n${index}`, online: index > 1 }));
    const segments = proofSegments({ readiness: summarizeReadiness(nodes), agents: agentCounts(nodes), observedAt: new Date(2026, 8, 30, 9, 23, 44), error: "", locale: "en-GB" });
    expect(segments).toEqual(["observed at 09:23:44", "34 nodes", "32 agents online", "0 mesh-ready"]);
  });

  it("states no count when a read failed with nothing loaded, and names the read the counts come from after one landed", () => {
    const empty = { readiness: summarizeReadiness([]), agents: agentCounts([]) };
    expect(proofSegments({ ...empty, observedAt: undefined, error: "503 service unavailable" })).toEqual(["not read: 503 service unavailable"]);
    expect(proofSegments({ ...empty, observedAt: undefined, error: "" })).toEqual(["reading the fleet"]);
    const nodes = [node({ online: true })];
    expect(proofSegments({ readiness: summarizeReadiness(nodes), agents: agentCounts(nodes), observedAt: new Date(2026, 0, 1, 8, 0, 0), error: "503", locale: "en-GB" })).toEqual([
      "last good read at 08:00:00",
      "1 node",
      "1 agent online",
      "0 mesh-ready",
      "refresh failed",
    ]);
  });
});

describe("the page notice", () => {
  it("is absent while nothing has failed", () => {
    expect(fleetNotice({ bootError: "", error: "", loaded: 0 })).toBeUndefined();
    expect(fleetNotice({ bootError: "", error: "", loaded: 3 })).toBeUndefined();
  });

  it("cannot be dismissed while nothing has loaded: the notice and the empty block are one state", () => {
    // Dismissing it dropped the page through to the loaded branch, which then
    // claimed an empty fleet and hinted at a permission problem for a 503.
    const boot = fleetNotice({ bootError: "no session", error: "", loaded: 0 })!;
    expect(boot.tone).toBe("danger");
    expect(boot.title).toBe("This page has no console session");
    expect(boot.dismissible).toBe(false);

    const failed = fleetNotice({ bootError: "", error: "503", loaded: 0 })!;
    expect(failed.tone).toBe("danger");
    expect(failed.title).toBe("The fleet could not be read");
    expect(failed.dismissible).toBe(false);
  });

  it("can be dismissed once rows stand behind it, where it only says the read is stale", () => {
    const stale = fleetNotice({ bootError: "", error: "503", loaded: 35 })!;
    expect(stale.tone).toBe("warning");
    expect(stale.title).toBe("The fleet below is the last good read, not the current one");
    expect(stale.dismissible).toBe(true);
  });
});

describe("the agent state word", () => {
  it("is printed wherever the dot is", () => {
    const ready = { address: "10.66.0.7", public_key: "k".repeat(44) };
    expect(agentState(node({ ...ready, online: true }))).toBe("online");
    expect(agentState(node({ ...ready, online: false }))).toBe("offline");
    expect(agentState(node({ ...ready, online: true, disabled: true }))).toBe("disabled");
  });
});
