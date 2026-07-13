<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import {
  CheckCircle2,
  CircleAlert,
  Copy,
  FileCode2,
  KeyRound,
  LoaderCircle,
  Network,
  RefreshCw,
  Route,
  ShieldCheck,
  Spline,
  X,
} from "@lucide/vue";

import { BridgeClient, canCall, type HostInit } from "./bridge";
import {
  PRIVATE_KEY_PLACEHOLDER,
  hostRoute,
  normalizedPort,
  previewConfig,
  redactedKey,
  safeErrorMessage,
  type WireGuardNode,
} from "./wireguardModel";

const SERVICE = "latticenet.wireguard/networks";
const init = ref<HostInit>();
const nodes = ref<WireGuardNode[]>([]);
const loading = ref(true);
const refreshing = ref(false);
const error = ref("");
const notice = ref("");
const bootError = ref("");
const selectedNodeID = ref("");

let bridge: BridgeClient | undefined;
try {
  bridge = new BridgeClient(window);
  bridge.init.then(async (value) => {
    init.value = value;
    await refresh();
  }).catch((cause) => {
    bootError.value = safeErrorMessage(cause, "Plugin host unavailable");
    loading.value = false;
  });
} catch (cause) {
  bootError.value = safeErrorMessage(cause, "Plugin host unavailable");
  loading.value = false;
}

const canPlan = computed(() => canCall(init.value, SERVICE, "plan"));
const sortedNodes = computed(() => [...nodes.value].sort((left, right) => {
  if (left.online !== right.online) return left.online ? -1 : 1;
  return (left.name || left.node_id).localeCompare(right.name || right.node_id);
}));
const readyNodes = computed(() => nodes.value.filter((node) => node.configuration === "ready"));
const partialNodes = computed(() => nodes.value.filter((node) => node.configuration === "partial"));
const onlineReady = computed(() => nodes.value.filter((node) => node.configuration === "ready" && node.online && !node.disabled));
const endpointCount = computed(() => nodes.value.filter((node) => !!node.endpoint).length);
const previewNode = computed(() => nodes.value.find((node) => node.node_id === selectedNodeID.value) ?? readyNodes.value[0]);
const preview = computed(() => previewConfig(previewNode.value, readyNodes.value));

async function call<T>(method: string, payload: unknown = {}): Promise<T> {
  if (!bridge || !canCall(init.value, SERVICE, method)) throw new Error(`Method ${method} is not available for this session`);
  return bridge.call<T>(SERVICE, method, payload).promise;
}

async function refresh(background = false): Promise<void> {
  if (!init.value) return;
  if (background) refreshing.value = true; else loading.value = true;
  error.value = "";
  try {
    const result = await call<{ nodes: WireGuardNode[] }>("overview");
    nodes.value = result.nodes ?? [];
    if (!selectedNodeID.value || !nodes.value.some((node) => node.node_id === selectedNodeID.value)) {
      selectedNodeID.value = nodes.value.find((node) => node.configuration === "ready")?.node_id ?? nodes.value[0]?.node_id ?? "";
    }
  } catch (cause) {
    error.value = safeErrorMessage(cause, "WireGuard network state could not be loaded");
  } finally {
    loading.value = false;
    refreshing.value = false;
    await resize();
  }
}

const planNode = ref<WireGuardNode>();
const listenPort = ref("");
const planning = ref(false);
interface Approval { id: string; node_id: string; plugin: string; action: string; plan: string; status: string; created_at?: string }
const approval = ref<Approval>();

function openPlan(node: WireGuardNode): void {
  planNode.value = node;
  listenPort.value = node.listen_port ? String(node.listen_port) : "51820";
}

async function createPlan(): Promise<void> {
  if (!planNode.value || planning.value) return;
  planning.value = true;
  error.value = "";
  try {
    const port = normalizedPort(listenPort.value, planNode.value.listen_port || 51820);
    approval.value = await call<Approval>("plan", { node_id: planNode.value.node_id, listen_port: port });
    notice.value = `Approval ${approval.value.id} created; no host changes were applied`;
    planNode.value = undefined;
  } catch (cause) {
    error.value = safeErrorMessage(cause, "WireGuard plan could not be created");
  } finally {
    planning.value = false;
    await resize();
  }
}

const copied = ref(false);
async function copyPreview(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1400);
  } catch {
    error.value = "Clipboard access is unavailable in this sandbox";
  }
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function resize(): Promise<void> { await nextTick(); bridge?.resize(document.documentElement.scrollHeight); }
let observer: ResizeObserver | undefined;
let poller: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => { void resize(); });
  observer.observe(document.body);
  poller = setInterval(() => { if (!loading.value && !planNode.value && !approval.value) void refresh(true); }, 20_000);
  void resize();
});
onBeforeUnmount(() => { observer?.disconnect(); if (poller) clearInterval(poller); bridge?.dispose(); });
</script>

<template>
  <main class="workspace">
    <header class="page-header">
      <div class="title-mark"><Spline :size="19" /></div>
      <div class="title-copy"><div class="title-line"><h1>WireGuard Networks</h1><span class="plugin-label">WireGuard plugin</span></div><p>Secret-free mesh topology, node readiness and approval-bound configuration plans.</p></div>
      <button class="button secondary" type="button" :disabled="loading || refreshing" @click="refresh(true)"><LoaderCircle v-if="refreshing" class="spin" :size="15" /><RefreshCw v-else :size="15" />Refresh</button>
    </header>

    <div v-if="bootError || error" class="alert" role="alert"><CircleAlert :size="17" /><span>{{ bootError || error }}</span><button class="icon-button" type="button" aria-label="Dismiss error" @click="error = ''; bootError = ''"><X :size="15" /></button></div>
    <div v-if="notice" class="alert success" aria-live="polite"><CheckCircle2 :size="17" /><span>{{ notice }}</span><button class="icon-button" type="button" aria-label="Dismiss notice" @click="notice = ''"><X :size="15" /></button></div>

    <section class="security-band"><ShieldCheck :size="19" /><div><strong>Private keys never leave their nodes</strong><p>Plans contain <code>{{ PRIVATE_KEY_PLACEHOLDER }}</code>. The agent substitutes its local key during an approved apply, under rollback watchdog and control-plane self-check.</p></div></section>

    <section class="summary-strip"><div><span>Ready nodes</span><strong>{{ readyNodes.length }} / {{ nodes.length }}</strong></div><div><span>Online mesh</span><strong>{{ onlineReady.length }}</strong></div><div><span>Public endpoints</span><strong>{{ endpointCount }}</strong></div><div><span>Partial setup</span><strong>{{ partialNodes.length }}</strong></div></section>

    <div v-if="loading" class="loading-state"><LoaderCircle class="spin" :size="20" />Loading WireGuard state</div>
    <template v-else>
      <section class="topology-panel">
        <header><div><h2>Full-mesh readiness</h2><p>Each ready peer receives every other ready peer as a host route.</p></div><Network :size="18" /></header>
        <div v-if="readyNodes.length" class="mesh"><div class="mesh-core"><Spline :size="23" /><strong>{{ readyNodes.length }} peers</strong><span>10.66 mesh</span></div><button v-for="node in readyNodes" :key="node.node_id" type="button" class="peer" :class="{ selected: previewNode?.node_id === node.node_id }" @click="selectedNodeID = node.node_id"><span class="online-dot" :data-online="node.online && !node.disabled" /><strong>{{ node.name || node.node_id }}</strong><small>{{ hostRoute(node.address) }}</small></button></div>
        <div v-else class="empty-state"><Spline :size="28" /><strong>No mesh-ready nodes</strong><span>A node needs both a WireGuard address and public key.</span></div>
      </section>

      <section v-if="previewNode" class="config-layout">
        <article class="interface-panel"><header><div><h2>Selected interface</h2><p>{{ previewNode.name || previewNode.node_id }}</p></div><span class="status" :data-tone="previewNode.online ? 'healthy' : 'warning'">{{ previewNode.online ? 'online' : 'offline' }}</span></header><dl><div><dt>Address</dt><dd>{{ hostRoute(previewNode.address) }}</dd></div><div><dt>Listen port</dt><dd>{{ previewNode.listen_port || 51820 }}</dd></div><div><dt>Public key</dt><dd>{{ redactedKey(previewNode.public_key) }}</dd></div><div><dt>Endpoint</dt><dd>{{ previewNode.endpoint || 'not reported' }}</dd></div><div><dt>Key source</dt><dd>node-local file</dd></div></dl></article>
        <article class="preview-panel"><header><div><h2>Secret-free config preview</h2><p>{{ Math.max(0, readyNodes.length - 1) }} peer blocks / host-route AllowedIPs</p></div><button class="icon-button bordered" type="button" :aria-label="copied ? 'Copied' : 'Copy preview'" :title="copied ? 'Copied' : 'Copy preview'" @click="copyPreview(preview)"><CheckCircle2 v-if="copied" :size="15" /><Copy v-else :size="15" /></button></header><pre>{{ preview }}</pre></article>
      </section>

      <section class="node-panel"><header><div><h2>Fleet nodes</h2><p>Readiness reflects the control-plane fields available for mesh compilation.</p></div></header><div class="table-wrap"><table><thead><tr><th>Node</th><th>Address</th><th>Public key</th><th>Endpoint</th><th>Configuration</th><th>Status</th><th class="actions">Actions</th></tr></thead><tbody><tr v-for="node in sortedNodes" :key="node.node_id"><td><strong>{{ node.name || node.node_id }}</strong><small>{{ node.node_id }}</small></td><td class="mono">{{ hostRoute(node.address) || '-' }}</td><td class="mono">{{ redactedKey(node.public_key) }}</td><td class="mono">{{ node.endpoint || '-' }}</td><td><span class="status" :data-tone="node.configuration === 'ready' ? 'healthy' : node.configuration === 'partial' ? 'warning' : 'neutral'">{{ node.configuration }}</span></td><td><span class="status" :data-tone="node.online && !node.disabled ? 'healthy' : 'warning'">{{ node.disabled ? 'disabled' : node.online ? 'online' : 'offline' }}</span><small>{{ formatDate(node.last_seen) }}</small></td><td class="actions"><button v-if="canPlan" class="button secondary compact" type="button" :disabled="node.configuration !== 'ready'" :title="node.configuration !== 'ready' ? 'Address and public key are required' : 'Create configuration plan'" @click="openPlan(node)"><FileCode2 :size="14" />Plan</button></td></tr></tbody></table></div><div v-if="!nodes.length" class="empty-state"><Network :size="28" /><strong>No visible nodes</strong><span>WireGuard metadata appears after agents report their node state.</span></div></section>
    </template>

    <div v-if="planNode" class="modal-backdrop" @mousedown.self="planNode = undefined"><section class="modal" role="dialog" aria-modal="true"><header><div><h2>Create mesh configuration plan</h2><p>{{ planNode.name || planNode.node_id }}</p></div><button class="icon-button" type="button" aria-label="Close" @click="planNode = undefined"><X :size="17" /></button></header><div class="plan-body"><label><span>Listen port</span><input v-model="listenPort" type="number" min="1" max="65535" /></label><div class="plan-facts"><div><Route :size="16" /><span><strong>{{ Math.max(0, readyNodes.length - 1) }} peers</strong><small>Each allowed as /32 or /128</small></span></div><div><KeyRound :size="16" /><span><strong>Private key placeholder</strong><small>Substituted only on the target node</small></span></div><div><ShieldCheck :size="16" /><span><strong>Pending approval</strong><small>No direct apply from this plugin page</small></span></div></div></div><footer><button class="button secondary" type="button" @click="planNode = undefined">Cancel</button><button class="button primary" type="button" :disabled="planning" @click="createPlan"><LoaderCircle v-if="planning" class="spin" :size="15" /><FileCode2 v-else :size="15" />Generate plan</button></footer></section></div>

    <div v-if="approval" class="modal-backdrop" @mousedown.self="approval = undefined"><section class="modal wide plan-review" role="dialog" aria-modal="true"><header><div><h2>Plan ready for approval</h2><p>{{ approval.id }} / {{ approval.status }} / {{ approval.node_id }}</p></div><button class="icon-button" type="button" aria-label="Close" @click="approval = undefined"><X :size="17" /></button></header><div class="approval-banner"><ShieldCheck :size="17" /><span>This plan contains public peer keys and a private-key placeholder. It has not been applied.</span></div><pre>{{ approval.plan }}</pre><footer><button class="button primary" type="button" @click="approval = undefined">Done</button></footer></section></div>
  </main>
</template>
