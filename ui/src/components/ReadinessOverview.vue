<script setup lang="ts">
/**
 * The Overview: why the mesh cannot form and the step that changes it, then
 * one readiness bar in place of four equal tiles. Only the first item's first
 * action is filled: one primary on the screen, the step that matters most. The bar splits the fleet
 * into ready, one half reported, and nothing reported, and prints each count
 * beside its swatch, so colour is never the only carrier. Agent liveness is a
 * separate line under it: an agent online says nothing about the mesh.
 */
import { PcButton, PcPanel, PcPanelHeader } from "@latticenet/plugin-bridge/chassis";

import type { AgentCounts, AttentionActionKind, AttentionItem, BarSegment } from "../readiness";

defineProps<{
  items: readonly AttentionItem[];
  bar: readonly BarSegment[];
  total: number;
  agents: AgentCounts;
  canNavigate: boolean;
}>();

const emit = defineEmits<{ (event: "act", kind: AttentionActionKind): void }>();
</script>

<template>
  <section v-if="items.length" class="wg-attention" aria-labelledby="wg-attention-title">
    <h2 id="wg-attention-title" class="pc-sr-only">Why the mesh cannot form</h2>
    <ul>
      <li v-for="(item, itemIndex) in items" :key="item.key" :data-tone="item.tone">
        <div class="wg-attention-copy">
          <strong>{{ item.claim }}</strong>
          <span>{{ item.proof }}</span>
        </div>
        <div class="wg-attention-actions">
          <template v-for="(action, index) in item.actions" :key="action.kind">
            <PcButton v-if="action.kind !== 'tasks' || canNavigate" compact :variant="itemIndex === 0 && index === 0 ? 'primary' : 'secondary'" @click="emit('act', action.kind)">{{ action.label }}</PcButton>
          </template>
        </div>
      </li>
    </ul>
  </section>

  <PcPanel label="Mesh readiness">
    <PcPanelHeader title="Mesh readiness" :description="`${total} ${total === 1 ? 'node' : 'nodes'}. A node joins once the control plane holds both its WireGuard address and its public key.`" />
    <div class="wg-bar-body">
      <div class="wg-bar" role="img" :aria-label="bar.map((segment) => `${segment.count} ${segment.label}`).join(', ')">
        <span v-for="segment in bar" :key="segment.key" :data-segment="segment.key" :style="{ width: `${segment.share}%` }" />
      </div>
      <ul class="wg-bar-legend">
        <li v-for="segment in bar" :key="segment.key" :data-segment="segment.key">
          <strong>{{ segment.count }}</strong> {{ segment.label }}
        </li>
      </ul>
      <p class="wg-agents">
        Agents: <strong>{{ agents.online }}</strong> online · <strong>{{ agents.offline }}</strong> offline<template v-if="agents.disabled"> · <strong>{{ agents.disabled }}</strong> disabled</template><template v-if="agents.never"> · <strong>{{ agents.never }}</strong> never reported</template>. An agent online says nothing about the mesh on its own.
      </p>
    </div>
  </PcPanel>
</template>
