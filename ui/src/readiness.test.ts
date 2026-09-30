import { describe, expect, it } from "vitest";

import { agentCounts, gapGroups, meshAttention, missingColumnsNote, readinessBar, reportedColumns } from "./readiness";
import { summarizeReadiness, type WireGuardNode } from "./wireguardModel";

function node(id: string, over: Partial<WireGuardNode> = {}): WireGuardNode {
  return { node_id: `node-${id}`, name: id, online: true, configuration: "missing", ...over };
}
const KEY = "k".repeat(43) + "=";
const ready = (id: string, over: Partial<WireGuardNode> = {}) => node(id, { address: `10.66.0.${id.length}`, public_key: KEY, configuration: "ready", ...over });

/** Production on 2026-09-30: 34 nodes, 32 agents online, none reports a WireGuard address or key. */
const production = Array.from({ length: 34 }, (_, index) => node(`n${index}`, { online: index > 1 }));

describe("why the mesh cannot form", () => {
  it("says production's state in one sentence, with the step that changes it", () => {
    const items = meshAttention(production, summarizeReadiness(production));
    expect(items).toHaveLength(1);
    expect(items[0]!.tone).toBe("danger");
    expect(items[0]!.claim).toBe("0 of 34 ready: 34 report no WireGuard address or public key");
    expect(items[0]!.proof).toMatch(/LATTICE_WG_IP and LATTICE_WG_PUBKEY/);
    expect(items[0]!.actions.map((action) => action.kind)).toEqual(["tasks", "fleet"]);
  });

  it("names each missing half, and says one ready node is not a mesh", () => {
    const nodes = [ready("a"), node("b", { address: "10.66.0.9" }), node("c", { public_key: KEY }), node("d")];
    expect(meshAttention(nodes, summarizeReadiness(nodes))[0]!.claim).toBe(
      "1 of 4 ready, and a mesh needs two: 1 report no WireGuard address or public key, 1 report an address but no public key, 1 report a public key but no address",
    );
  });

  it("with a mesh, warns when nobody can be dialled or a ready node is down, and lists the rest as information", () => {
    const nodes = [ready("a"), ready("bb", { online: false }), node("c")];
    const items = meshAttention(nodes, summarizeReadiness(nodes));
    expect(items.map((item) => [item.key, item.tone])).toEqual([
      ["no-endpoint", "warning"],
      ["ready-offline", "warning"],
      ["not-ready", "info"],
    ]);
    expect(items[1]!.proof).toBe("bb");
    expect(items[2]!.claim).toBe("1 of 3 not ready yet: 1 report no WireGuard address or public key");
  });

  it("says nothing once every node is ready, reachable and online, or when there is no fleet", () => {
    const nodes = [ready("a", { endpoint: "a.example.invalid:51820" }), ready("bb")];
    expect(meshAttention(nodes, summarizeReadiness(nodes))).toEqual([]);
    expect(meshAttention([], summarizeReadiness([]))).toEqual([]);
  });
});

describe("the readiness bar", () => {
  it("splits the fleet into ready, one half reported and nothing reported", () => {
    const nodes = [ready("a"), node("b", { address: "10.66.0.9" }), node("c"), node("d")];
    expect(readinessBar(summarizeReadiness(nodes)).map((segment) => [segment.key, segment.count, segment.share])).toEqual([
      ["ready", 1, 25],
      ["partial", 1, 25],
      ["missing", 2, 50],
    ]);
    expect(readinessBar(summarizeReadiness([])).every((segment) => segment.share === 0)).toBe(true);
  });
});

describe("agents", () => {
  it("counts online, offline and disabled apart from readiness", () => {
    expect(agentCounts(production)).toEqual({ total: 34, online: 32, offline: 2, disabled: 0 });
    expect(agentCounts([node("a", { disabled: true }), node("b", { online: false })])).toEqual({ total: 2, online: 0, offline: 1, disabled: 1 });
  });
});

describe("the fleet grouped by what each node lacks", () => {
  it("orders groups by the work they need and keeps each group's order", () => {
    const nodes = [ready("r1"), node("m1"), node("k1", { address: "10.66.0.3" }), node("m2", { online: false }), ready("r2")];
    const groups = gapGroups(nodes);
    expect(groups.map((group) => [group.gap, group.nodes.map((item) => item.name), group.online])).toEqual([
      ["needs_both", ["m1", "m2"], 1],
      ["needs_key", ["k1"], 1],
      ["ready", ["r1", "r2"], 2],
    ]);
  });

  it("drops a column that is blank on every row and says which", () => {
    expect(reportedColumns(production)).toEqual({ address: false, publicKey: false, endpoint: false });
    expect(missingColumnsNote(reportedColumns(production))).toBe("address, public key and endpoint not reported by any node");
    const some = [ready("a"), node("b")];
    expect(reportedColumns(some)).toEqual({ address: true, publicKey: true, endpoint: false });
    expect(missingColumnsNote(reportedColumns(some))).toBe("endpoint not reported by any node");
    expect(missingColumnsNote({ address: true, publicKey: true, endpoint: true })).toBe("");
  });
});
