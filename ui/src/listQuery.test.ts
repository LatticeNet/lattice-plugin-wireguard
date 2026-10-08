import { describe, expect, it } from "vitest";

import { applyQuery, compileQuery, describeFields, type QuerySchema } from "@latticenet/plugin-bridge/query";

import { FLEET_EXAMPLES, FLEET_SCHEMA, MESH_EXAMPLES, MESH_SCHEMA, lacking, nodeFacts, querySortMark } from "./listQuery";
import type { WireGuardNode } from "./wireguardModel";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

function node(id: string, overrides: Partial<WireGuardNode> = {}): WireGuardNode {
  return { node_id: `node_${id}`, name: id, online: true, last_seen: ago(20), configuration: "missing", ...overrides };
}

const KEY = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg=";

// One row per readiness gap and agent state, in the server's name order.
const FLEET: WireGuardNode[] = [
  node("hkg-1", { address: "10.66.0.2", public_key: KEY, endpoint: "hkg-1.example.invalid:51820", listen_port: 51820, public_ip: "203.0.113.2", configuration: "ready" }),
  node("hkg-2", { address: "10.66.0.10", public_key: "Zz" + KEY.slice(2), listen_port: 41641, public_ip: "203.0.113.10", configuration: "ready", online: false, last_seen: ago(3 * 86_400) }),
  node("lax-1", { address: "10.66.0.3", configuration: "partial", public_ip: "203.0.113.3" }),
  node("lax-2", { public_key: "Yy" + KEY.slice(2), configuration: "partial", disabled: true, online: false }),
  node("sjc-1", { configuration: "missing", online: false, last_seen: ago(600) }),
  node("tyo-1", { configuration: "missing", online: false, last_seen: "0001-01-01T00:00:00Z" }),
];

function run(schema: QuerySchema<WireGuardNode>, text: string, rows = FLEET): string[] {
  const compiled = compileQuery(text, schema);
  if (!compiled.ok) throw new Error(`${text}: ${compiled.error.code}`);
  return applyQuery(rows, compiled.query, NOW).map((row) => row.name);
}

function errorOf(schema: QuerySchema<WireGuardNode>, text: string) {
  const compiled = compileQuery(text, schema);
  return compiled.ok ? undefined : compiled.error;
}

describe("the Fleet query's own fields", () => {
  it("reads config as the server's enum and sorts it ready first", () => {
    expect(run(FLEET_SCHEMA, "config:partial")).toEqual(["lax-1", "lax-2"]);
    expect(run(FLEET_SCHEMA, "configuration:=ready")).toEqual(["hkg-1", "hkg-2"]);
    expect(run(FLEET_SCHEMA, "sort:config,name")).toEqual(["hkg-1", "hkg-2", "lax-1", "lax-2", "sjc-1", "tyo-1"]);
  });

  it("lists what the agent has not reported, so a node lacking both answers to each", () => {
    expect(lacking(FLEET[0]!)).toEqual([]);
    expect(lacking(FLEET[4]!)).toEqual(["address", "key"]);
    expect(run(FLEET_SCHEMA, "lacks:key")).toEqual(["lax-1", "sjc-1", "tyo-1"]);
    expect(run(FLEET_SCHEMA, "lacks:address")).toEqual(["lax-2", "sjc-1", "tyo-1"]);
    expect(run(FLEET_SCHEMA, "-lacks:*")).toEqual(["hkg-1", "hkg-2"]);
  });

  it("flags mesh-ready nodes under is:", () => {
    expect(run(FLEET_SCHEMA, "is:ready")).toEqual(["hkg-1", "hkg-2"]);
    expect(run(FLEET_SCHEMA, "-is:ready is:online")).toEqual(["lax-1"]);
  });

  it("takes address as the WireGuard address and its host route, not the public IP", () => {
    expect(run(FLEET_SCHEMA, "address:10.66.0.1")).toEqual(["hkg-2"]);
    expect(run(FLEET_SCHEMA, "address:=10.66.0.3/32")).toEqual(["lax-1"]);
    expect(run(FLEET_SCHEMA, "address:203.0.113")).toEqual([]);
    expect(run(FLEET_SCHEMA, "ip:203.0.113.3")).toEqual(["lax-1"]);
  });

  it("orders addresses numerically, and rows without one last either way", () => {
    expect(run(FLEET_SCHEMA, "sort:address")).toEqual(["hkg-1", "lax-1", "hkg-2", "lax-2", "sjc-1", "tyo-1"]);
    expect(run(FLEET_SCHEMA, "sort:-address").slice(0, 3)).toEqual(["hkg-2", "lax-1", "hkg-1"]);
  });

  it("finds dial-out-only nodes by a missing endpoint, and compares ports as numbers", () => {
    expect(run(FLEET_SCHEMA, "is:ready -endpoint:*")).toEqual(["hkg-2"]);
    expect(run(FLEET_SCHEMA, "port>50000")).toEqual(["hkg-1"]);
    expect(run(FLEET_SCHEMA, "sort:-port").slice(0, 2)).toEqual(["hkg-1", "hkg-2"]);
  });

  it("matches a pasted public key, whole or in part", () => {
    expect(run(FLEET_SCHEMA, `key:"${KEY}"`)).toEqual(["hkg-1"]);
    expect(run(FLEET_SCHEMA, "pubkey:Yy")).toEqual(["lax-2"]);
  });
});

describe("the shared node fields on WireGuard rows", () => {
  it("maps a row to the control plane's node names", () => {
    expect(nodeFacts(FLEET[0]!)).toEqual({ id: "node_hkg-1", name: "hkg-1", online: true, disabled: undefined, last_seen: FLEET[0]!.last_seen, public_ip: "203.0.113.2" });
  });

  it("rebuilds the status: offline, disabled, and never for the zero time the server sends", () => {
    expect(run(FLEET_SCHEMA, "status:offline")).toEqual(["hkg-2", "sjc-1"]);
    expect(run(FLEET_SCHEMA, "is:disabled")).toEqual(["lax-2"]);
    expect(run(FLEET_SCHEMA, "status:never")).toEqual(["tyo-1"]);
    expect(run(FLEET_SCHEMA, "is:never")).toEqual(["tyo-1"]);
  });

  it("reads last_seen as an age, and a never-reported node has none", () => {
    expect(run(FLEET_SCHEMA, "is:offline last_seen>1d")).toEqual(["hkg-2"]);
    expect(run(FLEET_SCHEMA, "last_seen<5m")).toEqual(["hkg-1", "lax-1", "lax-2"]);
  });

  it("offers only the fields this payload can answer", () => {
    const keys = describeFields(FLEET_SCHEMA, FLEET).map((field) => field.key);
    expect(keys).toEqual(["config", "lacks", "ready", "address", "endpoint", "port", "key", "name", "id", "ip", "status", "online", "offline", "disabled", "never", "last_seen"]);
    for (const absent of ["tag", "agent", "degraded", "reporting", "group"]) expect(keys).not.toContain(absent);
    expect(errorOf(FLEET_SCHEMA, "is:degraded")?.code).toBe("unknownFlag");
  });
});

describe("the grammar over the Fleet", () => {
  it("binds OR tighter than the space and negates a group", () => {
    expect(run(FLEET_SCHEMA, "lacks:key status:offline OR is:disabled")).toEqual(["sjc-1"]);
    expect(run(FLEET_SCHEMA, "is:offline OR is:disabled -(lacks:address)")).toEqual(["hkg-2"]);
    expect(run(FLEET_SCHEMA, "NOT config:missing sort:-name")).toEqual(["lax-2", "lax-1", "hkg-2", "hkg-1"]);
  });

  it("searches bare words over what the old search box covered, and ranks them", () => {
    expect(run(FLEET_SCHEMA, "10.66.0.3/32")).toEqual(["lax-1"]);
    expect(run(FLEET_SCHEMA, "qrstuvwx")).toEqual(["hkg-1", "hkg-2", "lax-2"]);
    expect(run(FLEET_SCHEMA, "203.0.113.10")).toEqual(["hkg-2"]);
    expect(run(FLEET_SCHEMA, "lax")).toEqual(["lax-1", "lax-2"]);
  });

  it("names the field and the characters of a mistake", () => {
    const typo = errorOf(FLEET_SCHEMA, "stauts:offline");
    expect(typo).toMatchObject({ code: "unknownField", start: 0, end: 6 });
    expect(errorOf(FLEET_SCHEMA, "config:done")?.code).toBe("unknownValue");
    expect(errorOf(FLEET_SCHEMA, "port>many")?.code).toBe("badNumber");
    expect(errorOf(FLEET_SCHEMA, "(lacks:key")?.code).toBe("unclosedParen");
  });
});

describe("the Mesh query", () => {
  const mesh = FLEET.filter((row) => row.configuration === "ready");

  it("leaves readiness out, since every row is ready", () => {
    expect(errorOf(MESH_SCHEMA, "lacks:key")?.code).toBe("unknownField");
    expect(errorOf(MESH_SCHEMA, "is:ready")?.code).toBe("unknownFlag");
    expect(describeFields(MESH_SCHEMA, mesh).map((field) => field.key).slice(0, 4)).toEqual(["address", "endpoint", "port", "key"]);
  });

  it("answers its examples", () => {
    expect(run(MESH_SCHEMA, "-endpoint:*", mesh)).toEqual(["hkg-2"]);
    expect(run(MESH_SCHEMA, "is:offline OR is:disabled", mesh)).toEqual(["hkg-2"]);
    expect(run(MESH_SCHEMA, "sort:-address", mesh)).toEqual(["hkg-2", "hkg-1"]);
  });
});

describe("the examples", () => {
  it("all compile against the layer they are shown on", () => {
    for (const example of FLEET_EXAMPLES) expect(errorOf(FLEET_SCHEMA, example.query), example.query).toBeUndefined();
    for (const example of MESH_EXAMPLES) expect(errorOf(MESH_SCHEMA, example.query), example.query).toBeUndefined();
  });
});

describe("querySortMark", () => {
  const sortsOf = (text: string) => {
    const compiled = compileQuery(text, FLEET_SCHEMA);
    if (!compiled.ok) throw new Error(text);
    return compiled.query.sorts;
  };

  it("marks the column the query's first sort key stands for", () => {
    expect(querySortMark(sortsOf("sort:name"))).toEqual({ key: "node", direction: "asc" });
    expect(querySortMark(sortsOf("sort:-status,name"))).toEqual({ key: "status", direction: "desc" });
    expect(querySortMark(sortsOf("sort:config"))).toEqual({ key: "configuration", direction: "asc" });
  });

  it("marks none when the key has no column or nothing sorts", () => {
    expect(querySortMark(sortsOf("sort:port"))).toBeUndefined();
    expect(querySortMark(sortsOf("lacks:key"))).toBeUndefined();
  });
});
