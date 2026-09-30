<script setup lang="ts">
/**
 * The mesh as a compact list: every mesh-ready node, the host route each is
 * pinned to in every peer's AllowedIPs, where peers can dial it, and whether
 * its agent is up. One row per node on the compact rhythm replaces the wall
 * of identical cards; a row opens the node's panel with its peers.
 */
import {
  PcRow,
  PcStateDot,
  PcTable,
  PcTd,
  PcTh,
} from "@latticenet/plugin-bridge/chassis";

import { agentState, agentTone, displayName } from "../fleetView";
import { hostRoute, type WireGuardNode } from "../wireguardModel";

defineProps<{
  nodes: readonly WireGuardNode[];
  activeId: string;
}>();

const emit = defineEmits<{ (event: "open", nodeId: string): void }>();

function openRow(event: MouseEvent, nodeId: string): void {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  (event.currentTarget as HTMLElement | null)?.closest("tr")?.querySelector<HTMLButtonElement>(".wg-row-open")?.focus({ preventScroll: true });
  emit("open", nodeId);
}
</script>

<template>
  <PcTable class="wg-mesh-table" :min-width="560" :stacked="false" density="compact" label="Mesh-ready nodes">
    <template #head>
      <PcTh name>Node</PcTh>
      <PcTh>AllowedIPs on every peer</PcTh>
      <PcTh>Endpoint</PcTh>
      <PcTh>Agent</PcTh>
    </template>
    <tbody>
      <PcRow
        v-for="node in nodes"
        :id="`mesh-${node.node_id}`"
        :key="node.node_id"
        class="wg-click-row"
        :selected="activeId === node.node_id"
        @click="openRow($event, node.node_id)"
      >
        <td class="pc-name" data-stack="name">
          <div class="pc-name-line">
            <button class="wg-row-open" type="button" :title="`Open ${displayName(node)}`" @click.stop="openRow($event, node.node_id)">{{ displayName(node) }}</button>
          </div>
        </td>
        <PcTd label="AllowedIPs" mono :title="`reported ${node.address}, pinned as ${hostRoute(node.address)}`">{{ hostRoute(node.address) }}</PcTd>
        <PcTd label="Endpoint" mono :title="node.endpoint || 'No public endpoint: this node dials out and cannot be dialled'">
          <span :class="node.endpoint ? undefined : 'wg-absent'">{{ node.endpoint || 'dial-out only' }}</span>
        </PcTd>
        <PcTd label="Agent"><PcStateDot :tone="agentTone(node)" :label="agentState(node)" /></PcTd>
      </PcRow>
    </tbody>
  </PcTable>
</template>
