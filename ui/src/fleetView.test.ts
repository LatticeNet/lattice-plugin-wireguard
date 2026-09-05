import { describe, expect, it } from "vitest";

import { agentState, filterNodes, fleetNotice, formatClock, lensFrom, matchesSearch, meshTileTitle, pageCount, pageOf, pageSlice, peerSubline, proofSegments } from "./fleetView";
import { summarizeReadiness, type WireGuardNode } from "./wireguardModel";

function node(overrides: Partial<WireGuardNode> = {}): WireGuardNode {
  return { node_id: "node-hkg-edge-01", name: "hkg-edge-01", online: true, configuration: "missing", ...overrides };
}

describe("lensFrom", () => {
  it("names the mesh lens and falls back to the fleet for anything else", () => {
    expect(lensFrom("mesh")).toBe("mesh");
    expect(lensFrom("fleet")).toBe("fleet");
    expect(lensFrom("devices")).toBe("fleet");
    expect(lensFrom(null)).toBe("fleet");
  });
});

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
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
    expect(pageCount(35)).toBe(2);
  });

  it("finds the page that holds an index and treats a missing item as page one", () => {
    expect(pageOf(0)).toBe(1);
    expect(pageOf(24)).toBe(1);
    expect(pageOf(25)).toBe(2);
    expect(pageOf(-1)).toBe(1);
    expect(pageOf(7, 5)).toBe(2);
  });

  it("slices the page and clamps a page below one", () => {
    const items = Array.from({ length: 35 }, (_, index) => index);
    expect(pageSlice(items, 1)).toHaveLength(25);
    expect(pageSlice(items, 2)).toEqual(items.slice(25));
    expect(pageSlice(items, 0)).toEqual(items.slice(0, 25));
    expect(pageSlice(items, 3)).toEqual([]);
  });
});

describe("proof line", () => {
  it("prints the clock on a 24-hour cycle", () => {
    expect(formatClock(new Date(2026, 0, 1, 9, 5, 7), "en-GB")).toBe("09:05:07");
    expect(formatClock(new Date(2026, 0, 1, 0, 0, 0), "en-GB")).toBe("00:00:00");
  });

  it("names the read, the population, the ready count and the online count", () => {
    const nodes = [
      node({ address: "10.66.0.1", public_key: "k".repeat(44), online: true }),
      node({ node_id: "n2", address: "10.66.0.2", public_key: "k".repeat(44), online: false }),
      node({ node_id: "n3" }),
    ];
    const segments = proofSegments(summarizeReadiness(nodes), new Date(2026, 7, 18, 23, 21, 14), "en-GB");
    expect(segments).toEqual(["observed at 23:21:14", "3 nodes", "2 mesh-ready", "1 online"]);
  });

  it("says so before the first read has landed, and uses the singular for one node", () => {
    expect(proofSegments(summarizeReadiness([]), undefined)[0]).toBe("not observed yet");
    expect(proofSegments(summarizeReadiness([node()]), undefined)[1]).toBe("1 node");
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
    expect(failed.title).toBe("The fleet could not be refreshed");
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
  it("is printed wherever the dot is: mesh tiles carry it in the title as well", () => {
    const ready = { address: "10.66.0.7", public_key: "k".repeat(44) };
    expect(agentState(node({ ...ready, online: true }))).toBe("online");
    expect(agentState(node({ ...ready, online: false }))).toBe("offline");
    expect(agentState(node({ ...ready, online: true, disabled: true }))).toBe("disabled");
    expect(meshTileTitle(node({ ...ready, online: false }))).toBe("hkg-edge-01, offline, reported 10.66.0.7. Open it in the fleet list.");
    expect(meshTileTitle(node({ ...ready, name: "", online: true }))).toBe("node-hkg-edge-01, online, reported 10.66.0.7. Open it in the fleet list.");
  });
});

describe("a peer row names its owner", () => {
  it("leads the id line with the node it folds under, so the owner survives when it has scrolled off", () => {
    const owner = node({ node_id: "node-ams-hub-01", name: "ams-hub-01" });
    const peer = node({ node_id: "node-vie-relay-01", name: "vie-relay-01" });
    expect(peerSubline(owner, peer)).toBe("peer of ams-hub-01 · node-vie-relay-01");
    expect(peerSubline(node({ node_id: "node-x", name: "" }), peer)).toBe("peer of node-x · node-vie-relay-01");
  });
});
