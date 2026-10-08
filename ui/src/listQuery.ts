/**
 * The Fleet and Mesh layers' list query: the console's search, filter and
 * sort grammar (@latticenet/plugin-bridge/query), over the fields this page's
 * rows carry.
 *
 * A row is what `overview` returns for one node (lattice-server
 * wireGuardNetworkView): the node's id, name, public IP, agent liveness and
 * last report, which the shared node fields read under the console's names,
 * and the WireGuard facts the agent reported, which this page declares
 * itself. The payload has no role, tags, groups, agent version or geo, so
 * those node fields stay out of the menu, and no handshake or transfer
 * figure, because the plugin does not read the interface.
 *
 * Built once at module load, as the bridge asks, so the field index is not
 * rebuilt per keystroke. DOM-free, so the tests run without jsdom.
 */
import {
  nodeQueryFields,
  type NodeFieldKey,
  type PluginNodeFacts,
  type QueryField,
  type QuerySchema,
  type QuerySort,
} from "@latticenet/plugin-bridge/query";
import type { QueryExample } from "@latticenet/plugin-bridge/chassis";

import { hostRoute, readinessGap, type NodeSortKey, type SortDirection, type WireGuardNode } from "./wireguardModel";

/** The node facts the shared fields read, under the control plane's names. */
export function nodeFacts(node: WireGuardNode): PluginNodeFacts {
  return {
    id: node.node_id,
    name: node.name,
    online: node.online,
    disabled: node.disabled,
    last_seen: node.last_seen,
    public_ip: node.public_ip,
  };
}

/*
 * The shared fields this payload can answer. `degraded` and `reporting` are
 * left out: with no server status word the status is rebuilt from online,
 * disabled and last_seen, which never yields degraded. `never` stays: the
 * server sends the zero time for a node that never reported.
 */
const NODE_FIELDS: readonly NodeFieldKey[] = ["name", "id", "ip", "status", "online", "offline", "disabled", "never", "last_seen"];

/** What the agent has not reported yet, in the words `lacks:` takes. */
export function lacking(node: WireGuardNode): string[] {
  switch (readinessGap(node)) {
    case "needs_key": return ["key"];
    case "needs_address": return ["address"];
    case "needs_both": return ["address", "key"];
    default: return [];
  }
}

const present = (value: string | undefined): string | undefined => (value?.trim() ? value : undefined);

/*
 * `address` is the WireGuard address, as the Address column and the panel
 * name it. The shared `ip` field also answers to `address`; listed first,
 * this one wins the name and `ip` keeps the public address.
 */
const address: QueryField<WireGuardNode> = {
  key: "address",
  aliases: ["allowedips", "wg_ip"],
  type: "list",
  hint: "WireGuard address as reported, and the host route peers pin it to",
  get: (node) => (present(node.address) ? [node.address!, hostRoute(node.address)] : undefined),
  sort: (node) => (present(node.address) ? hostRoute(node.address) : undefined),
};

const endpoint: QueryField<WireGuardNode> = {
  key: "endpoint",
  type: "string",
  hint: "Endpoint peers dial; none on a dial-out-only node",
  get: (node) => present(node.endpoint),
};

const port: QueryField<WireGuardNode> = {
  key: "port",
  aliases: ["listen_port"],
  type: "number",
  unit: "plain",
  hint: "Listen port, when the agent reported one",
  get: (node) => node.listen_port || undefined,
};

const publicKey: QueryField<WireGuardNode> = {
  key: "key",
  aliases: ["public_key", "pubkey"],
  type: "string",
  hint: "WireGuard public key",
  get: (node) => present(node.public_key),
  sort: false,
};

const nodeFields = nodeQueryFields<WireGuardNode>(nodeFacts, { only: NODE_FIELDS });

/** The words a bare search reads: what the old search box covered, the full key included. */
function text(node: WireGuardNode): (string | undefined)[] {
  return [node.name, node.node_id, node.address, hostRoute(node.address), node.endpoint, node.public_key, node.public_ip];
}

/** Fleet: every node, so readiness is a question worth asking. */
export const FLEET_SCHEMA: QuerySchema<WireGuardNode> = {
  fields: [
    {
      key: "config",
      aliases: ["configuration"],
      type: "enum",
      values: ["ready", "partial", "missing"],
      hint: "Mesh configuration: ready, partial or missing",
      get: (node) => node.configuration,
    },
    {
      key: "lacks",
      aliases: ["gap"],
      type: "list",
      hint: "What the agent has not reported: address, key",
      get: (node) => {
        const missing = lacking(node);
        return missing.length ? missing : undefined;
      },
      suggest: () => ["address", "key"],
      sort: false,
    },
    {
      key: "ready",
      aliases: ["mesh_ready"],
      type: "bool",
      flag: true,
      hint: "Mesh-ready: address and public key both reported",
      get: (node) => readinessGap(node) === "ready",
      sort: false,
    },
    address,
    endpoint,
    port,
    publicKey,
    ...nodeFields,
  ],
  text,
};

/** Mesh: only ready nodes, so readiness would match every row and is left out. */
export const MESH_SCHEMA: QuerySchema<WireGuardNode> = {
  fields: [address, endpoint, port, publicKey, ...nodeFields],
  text,
};

export const FLEET_EXAMPLES: readonly QueryExample[] = [
  { query: "lacks:key", note: "Nodes whose agent has not reported a public key" },
  { query: "config:partial sort:name", note: "Nodes halfway to the mesh, by name" },
  { query: "is:offline last_seen>1d", note: "Agents silent for more than a day" },
];

export const MESH_EXAMPLES: readonly QueryExample[] = [
  { query: "-endpoint:*", note: "Ready nodes no peer can dial: dial-out only" },
  { query: "is:offline OR is:disabled", note: "Ready nodes whose agent is not up" },
  { query: "sort:address", note: "The mesh in AllowedIPs order" },
];

/** The Fleet columns a query's sort can stand for, by the query field's key. */
const COLUMN_OF: Readonly<Record<string, NodeSortKey>> = {
  name: "node",
  address: "address",
  endpoint: "endpoint",
  config: "configuration",
  status: "status",
};

/**
 * Which Fleet header shows the order while the query sorts: the column of
 * the query's first sort key, or none when that key has no column. The
 * header then marks what the rows actually follow.
 */
export function querySortMark(sorts: readonly QuerySort<WireGuardNode>[]): { key: NodeSortKey; direction: SortDirection } | undefined {
  const first = sorts[0];
  const key = first ? COLUMN_OF[first.field.key] : undefined;
  return key ? { key, direction: first!.desc ? "desc" : "asc" } : undefined;
}
