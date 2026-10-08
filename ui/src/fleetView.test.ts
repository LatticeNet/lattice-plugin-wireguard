import { describe, expect, it } from "vitest";

import { ageLabel, agentState, agentTone, fleetNotice, formatClock, pageCount, pageOf, pageSlice, proofSegments, proofTitle } from "./fleetView";
import { agentCounts } from "./readiness";
import { summarizeReadiness, type WireGuardNode } from "./wireguardModel";

function node(overrides: Partial<WireGuardNode> = {}): WireGuardNode {
  return { node_id: "node-hkg-edge-01", name: "hkg-edge-01", online: true, configuration: "missing", ...overrides };
}

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
    const read = new Date(2026, 7, 18, 23, 21, 14);
    const segments = proofSegments({ readiness: summarizeReadiness(nodes), agents: agentCounts(nodes), observedAt: read, error: "", now: read.getTime() + 13_000 });
    expect(segments).toEqual(["observed 13s ago", "4 nodes", "2 agents online", "1 disabled", "2 mesh-ready"]);
  });

  it("prints production's fleet the way production has it: agents online, nothing ready", () => {
    const nodes = Array.from({ length: 34 }, (_, index) => node({ node_id: `n${index}`, online: index > 1 }));
    const read = new Date(2026, 8, 30, 9, 23, 44);
    const segments = proofSegments({ readiness: summarizeReadiness(nodes), agents: agentCounts(nodes), observedAt: read, error: "", now: read.getTime() + 125_000 });
    expect(segments).toEqual(["observed 2m ago", "34 nodes", "32 agents online", "0 mesh-ready"]);
  });

  it("states no count when a read failed with nothing loaded, and names the read the counts come from after one landed", () => {
    const empty = { readiness: summarizeReadiness([]), agents: agentCounts([]), now: 0 };
    expect(proofSegments({ ...empty, observedAt: undefined, error: "503 service unavailable" })).toEqual(["not read: 503 service unavailable"]);
    expect(proofSegments({ ...empty, observedAt: undefined, error: "" })).toEqual(["reading the fleet"]);
    const nodes = [node({ online: true })];
    const read = new Date(2026, 0, 1, 8, 0, 0);
    expect(proofSegments({ readiness: summarizeReadiness(nodes), agents: agentCounts(nodes), observedAt: read, error: "503", now: read.getTime() + 3 * 3_600_000 })).toEqual([
      "last good read 3h ago",
      "1 node",
      "1 agent online",
      "0 mesh-ready",
      "refresh failed",
    ]);
  });
});

describe("ages and the agent column", () => {
  it("prints an age in the largest whole unit and puts the instant in the proof title", () => {
    const at = new Date(2026, 8, 30, 9, 0, 0);
    expect(ageLabel(at, at.getTime() + 41_000)).toBe("41s");
    expect(ageLabel(at, at.getTime() + 12 * 60_000)).toBe("12m");
    expect(ageLabel(at, at.getTime() + 3 * 3_600_000)).toBe("3h");
    expect(ageLabel(at, at.getTime() + 7 * 86_400_000)).toBe("7d");
    expect(ageLabel("not a time", 0)).toBe("");
    expect(proofTitle(at, "en-GB")).toBe("Fleet read at 09:00:00 on 30 Sept 2026. Refresh reads it again.");
  });

  it("draws offline in the console's red", () => {
    expect(agentTone(node({ online: true }))).toBe("healthy");
    expect(agentTone(node({ online: false }))).toBe("error");
    expect(agentTone(node({ online: true, disabled: true }))).toBe("neutral");
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
