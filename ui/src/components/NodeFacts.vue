<script setup lang="ts">
/**
 * One node in its side panel: the interface as reported, whether it can join
 * the mesh and what it lacks, the peers this session can see for it, and the
 * one action, Plan, which says beside itself why it is disabled when it is.
 *
 * The panel does not draw a wg0.conf. The control plane renders the one that
 * gets applied and decides fields this page never receives, so it lists what
 * it cannot know and points at the approval for the full document.
 */
import { computed } from "vue";
import { FileCode2 } from "@lucide/vue";

import { PcButton, PcStatePill } from "@latticenet/plugin-bridge/chassis";

import { agentState, displayName } from "../fleetView";
import { PLAN_UNKNOWNS, hostRoute, meshPeersFor, readinessGap, readinessGapLabel, redactedKey, type WireGuardNode } from "../wireguardModel";

const props = defineProps<{
  node: WireGuardNode;
  nodes: readonly WireGuardNode[];
  canPlan: boolean;
}>();

const emit = defineEmits<{ (event: "plan"): void }>();

const gap = computed(() => readinessGap(props.node));
const peers = computed(() => meshPeersFor(props.node, props.nodes));
const planReason = computed(() => {
  if (!props.canPlan) return "This session cannot plan: wireguard:admin and network:plan are needed.";
  if (gap.value !== "ready") return `${readinessGapLabel(gap.value)}, so there is nothing to plan yet. The agent reports what LATTICE_WG_IP and LATTICE_WG_PUBKEY hold.`;
  return "";
});

function lastSeen(value?: string): string {
  if (!value) return "not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not reported";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
</script>

<template>
  <div class="wg-node">
    <div class="wg-node-action">
      <PcButton variant="primary" :disabled="Boolean(planReason)" @click="emit('plan')">
        <template #icon><FileCode2 :size="15" aria-hidden="true" /></template>
        Plan configuration…
      </PcButton>
      <p v-if="planReason" class="wg-inline-reason">{{ planReason }}</p>
    </div>

    <section>
      <h3>Mesh readiness</h3>
      <p class="wg-readiness-line">
        <PcStatePill :tone="gap === 'ready' ? 'healthy' : gap === 'needs_both' ? 'neutral' : 'warning'" :label="gap === 'ready' ? 'ready' : gap === 'needs_both' ? 'missing' : 'partial'" />
        <span>{{ gap === 'ready' ? 'Address and public key both reported.' : `${readinessGapLabel(gap)}.` }}</span>
      </p>
    </section>

    <section>
      <h3>Interface as reported</h3>
      <dl class="facts">
        <!-- The reported address, verbatim. The prefix the interface is
             actually given is assigned by the control plane, so printing a
             host route under an "Address" label would be a guess. -->
        <dt>Reported address</dt><dd :title="node.address || 'not reported'">{{ node.address || 'not reported' }}</dd>
        <dt>AllowedIPs on every peer</dt><dd :title="hostRoute(node.address) || 'not reported'">{{ hostRoute(node.address) || 'not reported' }}</dd>
        <dt>Listen port</dt><dd>{{ node.listen_port || '51820 (default)' }}</dd>
        <dt>Public key</dt><dd :title="redactedKey(node.public_key)">{{ redactedKey(node.public_key) }}</dd>
        <dt>Endpoint</dt><dd :title="node.endpoint || 'not reported'">{{ node.endpoint || 'not reported: dial-out only' }}</dd>
        <dt>Agent</dt><dd>{{ agentState(node) }}, last seen {{ lastSeen(node.last_seen) }}</dd>
        <dt>Key source</dt><dd>node-local file</dd>
      </dl>
    </section>

    <section class="detail-caveat">
      <h3>Mesh membership</h3>
      <template v-if="peers.length">
        <p><strong>{{ peers.length }} visible {{ peers.length === 1 ? 'peer' : 'peers' }}</strong>The peers this session can see for {{ displayName(node) }}, not the applied configuration.</p>
        <ul class="wg-peers">
          <li v-for="peer in peers" :key="peer.node_id">
            <span>{{ displayName(peer) }}</span>
            <span class="wg-mono">{{ hostRoute(peer.address) }}</span>
            <span class="wg-mono">{{ peer.endpoint || 'dial-out only' }}</span>
          </li>
        </ul>
      </template>
      <p v-else-if="gap !== 'ready'"><strong>No peers to list</strong>{{ displayName(node) }} is not mesh-ready itself.</p>
      <p v-else><strong>No peers to list</strong>No other node is mesh-ready, so this node would be given a mesh with no peers in it.</p>
      <p><strong>The applied configuration is rendered by the control plane, not here.</strong>It is shown in full on the approval, before anything reaches a node. This page cannot show:</p>
      <ul>
        <li v-for="item in PLAN_UNKNOWNS" :key="item">{{ item }}</li>
      </ul>
    </section>
  </div>
</template>
