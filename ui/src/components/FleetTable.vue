<script setup lang="ts">
/**
 * The fleet grouped by what each node lacks, one line per node.
 *
 * Each group opens on a shelf: one line across the table that names the gap,
 * counts the group's nodes and live agents, and says what the gap means for
 * the mesh, so the rows under it carry only their own facts. A column shows
 * only when some node reports a value for it; on a fleet where none does
 * (production today), only the node and its agent are left, and the node
 * column is held to a fixed width so the agent's state sits beside the name
 * instead of a frame's width away from it.
 *
 * A row has one click target, the node's panel. A mesh-ready row has one
 * menu, with Plan. A row with nothing to plan draws no menu: its shelf says
 * so, and the empty cell says it to a screen reader. With no row to plan on
 * the page the actions column is left out. Below 720px the node column pins
 * to the left edge and the table scrolls sideways under it. Below 480px a row
 * folds: with only the node and its agent left it is one line, the name at
 * the left and the agent at the right; with address, key or endpoint columns
 * it is two (node and menu, then the address and the agent), and the panel
 * holds the rest.
 */
import { computed } from "vue";

import { PcActionsCell, PcGroupRow, PcRow, PcStateDot, PcTable, PcTd, PcTh, type SortState } from "@latticenet/plugin-bridge/chassis";

import { agentAge, agentState, agentTone, displayName, gapConsequence, gapCountLine } from "../fleetView";
import { idAddsInformation } from "../identity";
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
  /** The column whose header marks the order; none while a query sorts by a field with no column. */
  sortKey?: NodeSortKey;
  sortDirection: "asc" | "desc";
}>();

const emit = defineEmits<{
  (event: "open", nodeId: string): void;
  (event: "plan", node: WireGuardNode): void;
  (event: "sort", key: NodeSortKey): void;
}>();

/* Only the node and its agent left (no node reports an address, a key or an
 * endpoint, which is production today): the table fits any frame, so it
 * neither scrolls sideways nor folds. */
const fits = computed(() => !props.columns.address && !props.columns.publicKey && !props.columns.endpoint);
/* A menu only where it would hold something enabled: Plan, on a mesh-ready node, for a session that may plan. */
const hasMenus = computed(() => props.canPlan && props.groups.some((group) => group.nodes.some((node) => readinessGap(node) === "ready")));
const columnCount = computed(() => 2 + (props.columns.address ? 1 : 0) + (props.columns.publicKey ? 1 : 0) + (props.columns.endpoint ? 1 : 0) + (hasMenus.value ? 1 : 0));
const minWidth = computed(() => (fits.value ? 0 : 360 + (props.columns.address ? 150 : 0) + (props.columns.publicKey ? 170 : 0) + (props.columns.endpoint ? 220 : 0) + (hasMenus.value ? 64 : 0)));

function sortFor(key: NodeSortKey): SortState {
  if (props.sortKey !== key) return "none";
  return props.sortDirection === "asc" ? "ascending" : "descending";
}

function lastSeen(value?: string): string {
  if (!value) return "not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not reported";
  // The server sends the zero time for a node that never reported.
  if (date.getUTCFullYear() < 2000) return "never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const PLAN_MENU: MenuItem[] = [{ key: "plan", label: "Plan configuration…" }];

function nothingToPlan(node: WireGuardNode): string {
  return `${readinessGapLabel(readinessGap(node))}, so there is nothing to plan yet`;
}

function countLine(group: GapGroup): string {
  return gapCountLine(props.totals.get(group.gap) ?? { count: group.nodes.length, online: group.online });
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
  <PcTable class="wg-fleet-table" :class="{ 'wg-fleet-fit': fits }" :min-width="minWidth" label="Fleet nodes by what they lack">
    <template #head>
      <PcTh name sortable :sort="sortFor('node')" @sort="emit('sort', 'node')">Node</PcTh>
      <PcTh v-if="columns.address" sortable :sort="sortFor('address')" @sort="emit('sort', 'address')">Address</PcTh>
      <PcTh v-if="columns.publicKey">Public key</PcTh>
      <PcTh v-if="columns.endpoint" sortable :sort="sortFor('endpoint')" @sort="emit('sort', 'endpoint')">Endpoint</PcTh>
      <PcTh class="wg-th-agent" sortable :sort="sortFor('status')" @sort="emit('sort', 'status')">Agent</PcTh>
      <PcTh v-if="hasMenus" actions><span class="pc-sr-only">Actions</span></PcTh>
    </template>

    <tbody v-for="group in groups" :key="group.gap">
      <PcGroupRow :id="`gap-${group.gap}`" expanded>
        <td :colspan="columnCount" class="wg-shelf" data-stack="summary">
          <p class="wg-shelf-line">
            <strong>{{ group.label }}</strong>
            <span class="wg-shelf-count">{{ countLine(group) }}</span>
            <span class="wg-shelf-note">{{ gapConsequence(group.gap) }}</span>
          </p>
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
            <button class="wg-row-open" type="button" :title="`Open ${displayName(node)} (${node.node_id})`" @click.stop="openRow($event, node.node_id)">{{ displayName(node) }}</button>
          </div>
          <small v-if="idAddsInformation(node.name, node.node_id)" :title="node.node_id">{{ node.node_id }}</small>
        </td>
        <PcTd v-if="columns.address" label="Address" mono stack="state" :title="node.address ? `reported ${node.address}, pinned into peer AllowedIPs as ${hostRoute(node.address)}` : 'no address reported'">
          <span :class="node.address ? undefined : 'wg-absent'">{{ node.address || 'not reported' }}</span>
        </PcTd>
        <PcTd v-if="columns.publicKey" label="Public key" mono :title="node.public_key ? 'Public key, shown truncated' : 'no public key reported'">
          <span :class="node.public_key ? undefined : 'wg-absent'">{{ node.public_key ? redactedKey(node.public_key) : 'not reported' }}</span>
        </PcTd>
        <PcTd v-if="columns.endpoint" label="Endpoint" mono :title="node.endpoint || 'No public endpoint reported, so peers cannot dial in to this node'">
          <span :class="node.endpoint ? undefined : 'wg-absent'">{{ node.endpoint || 'dial-out only' }}</span>
        </PcTd>
        <PcTd label="Agent" stack="state" class="wg-agent-cell" :title="`${agentState(node)}, last seen ${lastSeen(node.last_seen)}`">
          <span class="wg-agent">
            <PcStateDot :tone="agentTone(node)" :label="agentState(node)" />
            <span class="wg-agent-age">{{ agentAge(node, now) }}</span>
          </span>
        </PcTd>
        <PcActionsCell v-if="hasMenus">
          <RowMenu v-if="readinessGap(node) === 'ready'" :label="`Actions for ${displayName(node)}`" :items="PLAN_MENU" @select="emit('plan', node)" />
          <span v-else class="pc-sr-only">{{ nothingToPlan(node) }}</span>
        </PcActionsCell>
      </PcRow>
    </tbody>
  </PcTable>
</template>
