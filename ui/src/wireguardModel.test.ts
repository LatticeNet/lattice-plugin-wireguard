import { describe, expect, it } from "vitest";

import {
  PRIVATE_KEY_PLACEHOLDER,
  PLAN_UNKNOWNS,
  hostRoute,
  meshPeersFor,
  meshReadyNodes,
  normalizedPort,
  readinessGap,
  sortNodes,
  summarizeReadiness,
  type WireGuardNode,
} from "./wireguardModel";

const nodes: WireGuardNode[] = [
  { node_id: "a", name: "A", address: "10.66.0.1", public_key: "a".repeat(44), endpoint: "a.example:51820", online: true, configuration: "ready" },
  { node_id: "b", name: "B", address: "10.66.0.2/32", public_key: "b".repeat(44), online: true, configuration: "ready" },
];

describe("wireguardModel", () => {
  it("pins peer addresses to host routes", () => {
    expect(hostRoute("10.66.0.1")).toBe("10.66.0.1/32");
    expect(hostRoute("fd00::1")).toBe("fd00::1/128");
  });

  it("keeps the private-key placeholder as the only key token this plugin knows", () => {
    // The plugin no longer renders a wg0.conf at all: the control plane owns
    // the only renderer. The placeholder survives because the security band
    // names it, and it must stay a placeholder.
    expect(PRIVATE_KEY_PLACEHOLDER).toBe("__LATTICE_WG_PRIVATE_KEY__");
  });

  it("names every field the control plane decides and this plugin cannot show", () => {
    // If this list ever shrinks silently, the screen starts implying it knows
    // more about the applied config than it does.
    expect(PLAN_UNKNOWNS.some((item) => item.includes("interface address prefix"))).toBe(true);
    expect(PLAN_UNKNOWNS.some((item) => item.includes("PersistentKeepalive"))).toBe(true);
    expect(PLAN_UNKNOWNS.some((item) => item.includes("read scope"))).toBe(true);
  });

  it("bounds listen ports", () => {
    expect(normalizedPort("", 51111)).toBe(51111);
    expect(() => normalizedPort("70000")).toThrow("1 to 65535");
  });
});

describe("mesh readiness", () => {
  const node = (over: Partial<WireGuardNode>): WireGuardNode => ({
    node_id: over.node_id ?? "n", name: over.name ?? "n", online: false, configuration: "missing", ...over,
  });

  it("names which half of the pair a node is missing", () => {
    expect(readinessGap(node({ address: "10.66.0.1", public_key: "k".repeat(44) }))).toBe("ready");
    expect(readinessGap(node({ address: "10.66.0.1" }))).toBe("needs_key");
    expect(readinessGap(node({ public_key: "k".repeat(44) }))).toBe("needs_address");
    expect(readinessGap(node({}))).toBe("needs_both");
    expect(readinessGap(node({ address: "   ", public_key: "  " }))).toBe("needs_both");
  });

  it("breaks the fleet zero state down instead of reporting one number", () => {
    const summary = summarizeReadiness([
      node({ node_id: "a", address: "10.66.0.1", public_key: "k".repeat(44), online: true, endpoint: "a.example:51820" }),
      node({ node_id: "b", address: "10.66.0.2" }),
      node({ node_id: "c", public_key: "k".repeat(44) }),
      node({ node_id: "d" }),
      node({ node_id: "e", address: "10.66.0.5", public_key: "k".repeat(44), online: true, disabled: true }),
    ]);
    expect(summary).toMatchObject({
      total: 5, ready: 2, needsKey: 1, needsAddress: 1, needsBoth: 1,
      onlineReady: 1, endpoints: 1, disabled: 1,
    });
  });

  it("reports a whole fleet with nothing reported, which is the live state today", () => {
    const summary = summarizeReadiness(Array.from({ length: 35 }, (_, index) => node({ node_id: `n${index}` })));
    expect(summary.ready).toBe(0);
    expect(summary.needsBoth).toBe(35);
  });
});

describe("sortNodes", () => {
  const node = (over: Partial<WireGuardNode>): WireGuardNode => ({
    node_id: over.node_id ?? "n", name: over.name ?? "n", online: false, configuration: "missing", ...over,
  });

  it("orders by name in both directions", () => {
    const nodes = [node({ name: "beta" }), node({ name: "alpha" }), node({ name: "gamma" })];
    expect(sortNodes(nodes, "node", "asc").map((value) => value.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(sortNodes(nodes, "node", "desc").map((value) => value.name)).toEqual(["gamma", "beta", "alpha"]);
  });

  it("puts ready nodes first by configuration and disabled last by status", () => {
    const nodes = [
      node({ name: "missing", configuration: "missing" }),
      node({ name: "ready", configuration: "ready" }),
      node({ name: "partial", configuration: "partial" }),
    ];
    expect(sortNodes(nodes, "configuration", "asc").map((value) => value.name)).toEqual(["ready", "partial", "missing"]);

    const states = [node({ name: "off" }), node({ name: "dis", online: true, disabled: true }), node({ name: "on", online: true })];
    expect(sortNodes(states, "status", "asc").map((value) => value.name)).toEqual(["on", "off", "dis"]);
  });

  it("leaves the input untouched", () => {
    const nodes = [node({ name: "b" }), node({ name: "a" })];
    const result = sortNodes(nodes, "node", "asc");
    expect(result).not.toBe(nodes);
    expect(nodes.map((value) => value.name)).toEqual(["b", "a"]);
  });
});

describe("meshReadyNodes and meshPeersFor", () => {
  const fleet: WireGuardNode[] = [
    { node_id: "self", name: "self", address: "10.66.0.1", public_key: "s".repeat(44), online: true, configuration: "ready" },
    { node_id: "ok", name: "ok", address: "10.66.0.2", public_key: "o".repeat(44), online: true, configuration: "ready" },
    // The server called it ready; the address never arrived. BuildMesh skips a
    // peer with no mesh IP, so it must not be counted as one here either.
    { node_id: "claims-ready", name: "claims", public_key: "c".repeat(44), online: true, configuration: "ready" },
  ];

  it("applies the server's skip rule rather than trusting the configuration field", () => {
    expect(meshReadyNodes(fleet).map((node) => node.node_id)).toEqual(["self", "ok"]);
  });

  it("excludes the target from its own peer list", () => {
    expect(meshPeersFor(fleet[0], fleet).map((node) => node.node_id)).toEqual(["ok"]);
    expect(meshPeersFor(undefined, fleet)).toEqual([]);
  });
});
