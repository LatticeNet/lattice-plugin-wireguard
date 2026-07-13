import { describe, expect, it } from "vitest";

import { PRIVATE_KEY_PLACEHOLDER, hostRoute, normalizedPort, previewConfig, type WireGuardNode } from "./wireguardModel";

const nodes: WireGuardNode[] = [
  { node_id: "a", name: "A", address: "10.66.0.1", public_key: "a".repeat(44), endpoint: "a.example:51820", online: true, configuration: "ready" },
  { node_id: "b", name: "B", address: "10.66.0.2/32", public_key: "b".repeat(44), online: true, configuration: "ready" },
];

describe("wireguardModel", () => {
  it("pins peer addresses to host routes", () => {
    expect(hostRoute("10.66.0.1")).toBe("10.66.0.1/32");
    expect(hostRoute("fd00::1")).toBe("fd00::1/128");
  });

  it("renders a secret-free preview with the private-key placeholder", () => {
    const config = previewConfig(nodes[0], nodes, 51820);
    expect(config).toContain(`PrivateKey = ${PRIVATE_KEY_PLACEHOLDER}`);
    expect(config).toContain("AllowedIPs = 10.66.0.2/32");
    expect(config).not.toContain("private-secret");
  });

  it("bounds listen ports", () => {
    expect(normalizedPort("", 51111)).toBe(51111);
    expect(() => normalizedPort("70000")).toThrow("1 to 65535");
  });
});
