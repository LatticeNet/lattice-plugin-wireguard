<script setup lang="ts">
/**
 * The fleet grouped by what each node lacks. A group row says what its
 * members are missing and how many of their agents are online, so the rows
 * under it need not repeat it. A column shows only when some node reports a
 * value for it; on a fleet where none does, the head says which left and why.
 *
 * A row has one click target, the node's panel. A mesh-ready row has one
 * menu, with Plan; a row with nothing to plan has no menu, and its actions
 * cell says so in words, while its group row says what it lacks. With no
 * row to plan on the page the actions column is left out. The
 * columns stay at every width; below 720px the node column pins to the left
 * edge and the table scrolls sideways under it, unless only the node and its
 * agent are left, when the table fits the frame.
 */
import { computed } from "vue";

import {
  PcActionsCell,
  PcGroupRow,
  PcRow,
  PcStateDot,
  PcTable,
  PcTd,
  PcTh,
  type SortState,
} from "@latticenet/plugin-bridge/chassis";

import { agentState, agentTone, displayName, seenLabel } from "../fleetView";
import type { GapGroup, ReportedColumns } from "../readiness";
import type { MenuItem } from "../rowMenu";
import { hostRoute, readinessGap, readinessGapLabel, redactedKey, type NodeSortKey, type WireGuardNode } from "../wireguardModel";
import RowMenu from "./RowMenu.vue";

const props = defineProps<{
  groups: readonly GapGroup[];
  /** Group sizes over the whole filtered fleet, not just this page. */
  totals: ReadonlyMap<string, { count: number; online: number }>;
  columns: ReportedColumns;
  activeId: string;
  canPlan: boolean;
  /** Now, for the agents' ages. */
  now: number;
  sortKey: NodeSortKey;
  sortDirection: "asc" | "desc";
}>();

const emit = defineEmits<{
  (event: "open", nodeId: string): void;
  (event: "plan", node: WireGuardNode): void;
  (event: "sort", key: NodeSortKey): void;
}>();

/* Only the node and its agent left (no node reports an address, a key or an
 * endpoint, which is production today): the table fits any frame, so it
 * stops scrolling sideways and the node column takes the room the dropped
 * columns left instead of a pinned 38vw sliver. */
const fits = computed(() => !props.columns.address && !props.columns.publicKey && !props.columns.endpoint);
/* A menu only where it would hold something enabled: Plan, on a mesh-ready node, for a session that may plan. */
const hasMenus = computed(() => props.canPlan && props.groups.some((group) => group.nodes.some((node) => readinessGap(node) === "ready")));
const columnCount = computed(() => 2 + (props.columns.address ? 1 : 0) + (props.columns.publicKey ? 1 : 0) + (props.columns.endpoint ? 1 : 0) + (hasMenus.value ? 1 : 0));
const minWidth = computed(() => fits.value ? 0 : 360 + (props.columns.address ? 150 : 0) + (props.columns.publicKey ? 170 : 0) + (props.columns.endpoint ? 220 : 0) + (hasMenus.value ? 120 : 0));

function sortFor(key: NodeSortKey): SortState {
  if (props.sortKey !== key) return "none";
  return props.sortDirection === "asc" ? "ascending" : "descending";
}

function lastSeen(value?: string): string {
  if (!value) return "not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not reported";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const PLAN_MENU: MenuItem[] = [{ key: "plan", label: "Plan configuration…" }];

function nothingToPlan(node: WireGuardNode): string {
  return `${readinessGapLabel(readinessGap(node))}, so there is nothing to plan yet`;
}

/** What the gap means for the mesh, so the group row says it once for every member. */
function consequence(group: GapGroup): string {
  switch (group.gap) {
    case "ready":
      return "In the mesh: each gets a host route to every other ready node";
    case "needs_key":
      return "Out of the mesh until the agent reports its public key";
    case "needs_address":
      return "Out of the mesh until the agent reports its WireGuard address";
    default:
      return "Out of the mesh, and nothing to plan, until the agent reports both";
  }
}

function groupNote(group: GapGroup): string {
  const total = props.totals.get(group.gap) ?? { count: group.nodes.length, online: group.online };
  return `${total.count} ${total.count === 1 ? "node" : "nodes"} · ${total.online} ${total.online === 1 ? "agent" : "agents"} online`;
}

/** A click anywhere on the row opens it; focus goes to the name button first so closing the panel returns it there. */
function openRow(event: MouseEvent, nodeId: string): void {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  (event.currentTarget as HTMLElement | null)?.closest("tr")?.querySelector<HTMLButtonElement>(".wg-row-open")?.focus({ preventScroll: true });
  emit("open", nodeId);
}
</script>

<template>
  <PcTable class="wg-fleet-table" :class="{ 'wg-fleet-fit': fits }" :min-width="minWidth" :stacked="false" label="Fleet nodes by what they lack">
    <template #head>
      <PcTh name sortable :sort="sortFor('node')" @sort="emit('sort', 'node')">Node</PcTh>
      <PcTh v-if="columns.address" sortable :sort="sortFor('address')" @sort="emit('sort', 'address')">Address</PcTh>
      <PcTh v-if="columns.publicKey">Public key</PcTh>
      <PcTh v-if="columns.endpoint" sortable :sort="sortFor('endpoint')" @sort="emit('sort', 'endpoint')">Endpoint</PcTh>
      <PcTh sortable :sort="sortFor('status')" @sort="emit('sort', 'status')">Agent</PcTh>
      <PcTh v-if="hasMenus" actions><span class="pc-sr-only">Actions</span></PcTh>
    </template>

    <tbody v-for="group in groups" :key="group.gap">
      <PcGroupRow :id="`gap-${group.gap}`" expanded>
        <td class="pc-name" data-stack="name">
          <div class="pc-name-line"><strong>{{ group.label }}</strong></div>
          <small>{{ groupNote(group) }}</small>
        </td>
        <td :colspan="columnCount - 1" data-stack="summary" class="wg-group-note">
          <span class="pc-group-summary">{{ consequence(group) }}</span>
        </td>
      </PcGroupRow>
      <PcRow
        v-for="node in group.nodes"
        :id="`node-${node.node_id}`"
        :key="node.node_id"
        class="wg-click-row"
        :selected="activeId === node.node_id"
        @click="openRow($event, node.node_id)"
      >
        <td class="pc-name" data-level="1" data-stack="name">
          <div class="pc-name-line">
            <button class="wg-row-open" type="button" :title="`Open ${displayName(node)}`" @click.stop="openRow($event, node.node_id)">{{ displayName(node) }}</button>
          </div>
          <small :title="node.node_id">{{ node.node_id }}</small>
        </td>
        <PcTd v-if="columns.address" label="Address" mono :title="node.address ? `reported ${node.address}, pinned into peer AllowedIPs as ${hostRoute(node.address)}` : 'no address reported'">
          <span :class="node.address ? undefined : 'wg-absent'">{{ node.address || 'not reported' }}</span>
        </PcTd>
        <PcTd v-if="columns.publicKey" label="Public key" mono :title="node.public_key ? 'Public key, shown truncated' : 'no public key reported'">
          <span :class="node.public_key ? undefined : 'wg-absent'">{{ node.public_key ? redactedKey(node.public_key) : 'not reported' }}</span>
        </PcTd>
        <PcTd v-if="columns.endpoint" label="Endpoint" mono :title="node.endpoint || 'No public endpoint reported, so peers cannot dial in to this node'">
          <span :class="node.endpoint ? undefined : 'wg-absent'">{{ node.endpoint || 'dial-out only' }}</span>
        </PcTd>
        <PcTd label="Agent" :title="`${agentState(node)}, last seen ${lastSeen(node.last_seen)}`">
          <PcStateDot :tone="agentTone(node)" :label="agentState(node)" />
          <small>{{ seenLabel(node, now) }}</small>
        </PcTd>
        <PcActionsCell v-if="hasMenus">
          <RowMenu v-if="readinessGap(node) === 'ready'" :label="`Actions for ${displayName(node)}`" :items="PLAN_MENU" @select="emit('plan', node)" />
          <span v-else class="wg-row-reason" :title="nothingToPlan(node)">nothing to plan</span>
        </PcActionsCell>
      </PcRow>
    </tbody>
  </PcTable>
</template>
