/**
 * The Fleet table, rendered. Each case renders the real single-file
 * component through Vue's server renderer with the props the page passes,
 * and reads the markup it produced, so a claim here is about what the
 * operator is shown, not about which strings a source file contains.
 */
import { describe, expect, it } from "vitest";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";

import FleetTable from "./components/FleetTable.vue";
import { agentAge, gapConsequence, gapCountLine } from "./fleetView";
import { idAddsInformation } from "./identity";
import { gapGroups, reportedColumns } from "./readiness";
import type { WireGuardNode } from "./wireguardModel";

async function render(component: Component, props: Record<string, unknown>): Promise<string> {
  const html = await renderToString(createSSRApp({ render: () => h(component, props) }));
  return html.replace(/<!--[^>]*-->/g, "");
}

const NOW = Date.parse("2026-10-04T16:00:00Z");

function node(over: Partial<WireGuardNode> & { node_id: string; name: string }): WireGuardNode {
  return { online: true, configuration: "missing", last_seen: "2026-10-04T15:57:00Z", ...over };
}

const production = [
  node({ node_id: "node_cd-aaitr-hk", name: "[cd]-Aaitr-HK" }),
  node({ node_id: "node_metix-dmit-4", name: "[Metix]-DMIT-4", online: false, last_seen: "2026-09-27T16:00:00Z" }),
];

const rich = [
  node({ node_id: "node_metix-dmit-1", name: "[Metix]-DMIT-1", address: "10.66.0.1", public_key: "HUhu7IVi0000000000000000000000000000001CPcp=", configuration: "ready" }),
  node({ node_id: "node_cd-oracle-sel", name: "[cd]-Oracle-SEL", address: "10.66.0.28", configuration: "partial" }),
];

function props(nodes: WireGuardNode[], canPlan = true) {
  const groups = gapGroups(nodes);
  return {
    groups,
    totals: new Map(groups.map((group) => [group.gap, { count: group.nodes.length, online: group.online }])),
    columns: reportedColumns(nodes),
    activeId: "",
    canPlan,
    now: NOW,
    sortKey: "status",
    sortDirection: "asc",
  };
}

describe("the Fleet table, rendered", () => {
  it("says once on the shelf what a group lacks, so its rows carry only their own facts", async () => {
    const html = await render(FleetTable, props(production));
    expect(html.match(/class="wg-shelf"/g)).toHaveLength(1);
    expect(html).toContain("No address and no public key");
    expect(html).toContain("2 nodes · 1 agent online");
    expect(html).toContain("Out of the mesh, and nothing to plan, until the agent reports both");
    // The ids are the names' slugs, so they are not printed a second time.
    expect(html).not.toMatch(/<small[^>]*>node_cd-aaitr-hk<\/small>/);
  });

  it("puts each agent's state and age on one line, offline in words as well as colour", async () => {
    const html = await render(FleetTable, props(production));
    expect(html).toMatch(/data-tone="healthy"[^>]*>online<\/span><span class="wg-agent-age">3m ago<\/span>/);
    expect(html).toMatch(/data-tone="error"[^>]*>offline<\/span><span class="wg-agent-age">7d ago<\/span>/);
  });

  it("draws no actions column when nothing on the page can be planned", async () => {
    const html = await render(FleetTable, props(production));
    expect(html).not.toContain("pc-actions");
    expect(html).not.toContain("rm-trigger");
  });

  it("offers Plan only on a mesh-ready row, and says why to a screen reader on the others", async () => {
    const html = await render(FleetTable, props(rich));
    expect(html.match(/class="pc-icon-button rm-trigger"/g)).toHaveLength(1);
    expect(html).toContain('<span class="pc-sr-only">No public key reported, so there is nothing to plan yet</span>');
    expect(html).not.toContain("wg-row-reason");
  });

  it("offers no Plan at all to a session that may only read", async () => {
    const html = await render(FleetTable, props(rich, false));
    expect(html).not.toContain("rm-trigger");
  });
});

describe("the Fleet helpers", () => {
  it("counts a group over the whole fleet, in the singular and the plural", () => {
    expect(gapCountLine({ count: 1, online: 1 })).toBe("1 node · 1 agent online");
    expect(gapCountLine({ count: 34, online: 32 })).toBe("34 nodes · 32 agents online");
  });

  it("says nothing can be planned on every gap but ready", () => {
    expect(gapConsequence("ready")).not.toContain("nothing to plan");
    for (const gap of ["needs_key", "needs_address", "needs_both"] as const) expect(gapConsequence(gap)).toContain("nothing to plan");
  });

  it("ages an agent, and says when it was never seen", () => {
    expect(agentAge(production[0]!, NOW)).toBe("3m ago");
    expect(agentAge(node({ node_id: "n", name: "n", last_seen: undefined }), NOW)).toBe("never seen");
  });

  it("prints a node id only when it is not the name's slug", () => {
    expect(idAddsInformation("[cd]-Aaitr-HK", "node_cd-aaitr-hk")).toBe(false);
    expect(idAddsInformation("[cd]-homeserver", "node_cd-nas-old")).toBe(true);
    expect(idAddsInformation("", "node_cd-nas")).toBe(false);
  });
});
