<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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

import { BridgeClient, canCall, type HostInit } from "@latticenet/plugin-bridge";
import { useHandshakeTimeout } from "./handshakeTimeout";
import { MIN_ANCHOR_TOP, anchorTopFrom, clampAnchorTop, isInsideOverlay } from "./overlayAnchor";
import {
  PRIVATE_KEY_PLACEHOLDER,
  hostRoute,
  normalizedPort,
  PLAN_UNKNOWNS,
  meshPeersFor,
  meshReadyNodes,
  readinessGap,
  readinessGapLabel,
  redactedKey,
  safeErrorMessage,
  sortNodes,
  summarizeReadiness,
  type NodeSortKey,
  type SortDirection,
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
  bridge = new BridgeClient({ window, expectedPluginId: "latticenet.wireguard", expectedRoutes: ["networks"], idPrefix: "wireguard" });
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
const readiness = computed(() => summarizeReadiness(nodes.value));
// One definition of "ready" for the strip, the peer grid, the peer count and
// the rendered preview. The server's `configuration` field is the same rule and
// is still what the table column reports.
const readyNodes = computed(() => meshReadyNodes(nodes.value));
const previewNode = computed(() => nodes.value.find((node) => node.node_id === selectedNodeID.value) ?? readyNodes.value[0]);
const visiblePeers = computed(() => meshPeersFor(previewNode.value, nodes.value));
const peerCount = computed(() => Math.max(0, readyNodes.value.length - 1));

// ── fleet table ordering ─────────────────────────────────────────────────
const sortKey = ref<NodeSortKey>("status");
const sortDirection = ref<SortDirection>("asc");
const sortedNodes = computed(() => sortNodes(nodes.value, sortKey.value, sortDirection.value));

const NODE_COLUMNS: Array<{ key: NodeSortKey | ""; label: string }> = [
  { key: "node", label: "Node" },
  { key: "address", label: "Address" },
  { key: "", label: "Public key" },
  { key: "endpoint", label: "Endpoint" },
  { key: "configuration", label: "Configuration" },
  { key: "status", label: "Status" },
];

function toggleSort(key: NodeSortKey): void {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    return;
  }
  sortKey.value = key;
  sortDirection.value = "asc";
}

function ariaSort(key: NodeSortKey | ""): "ascending" | "descending" | "none" {
  if (!key || sortKey.value !== key) return "none";
  return sortDirection.value === "asc" ? "ascending" : "descending";
}

function sortMark(key: NodeSortKey | ""): string {
  if (!key || sortKey.value !== key) return "↕";
  return sortDirection.value === "asc" ? "↑" : "↓";
}

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
// Errors raised while a dialog is open belong in that dialog. The page-level
// alert sits behind the scrim, thousands of pixels up a frame the operator is
// not looking at, so writing there reads as the button doing nothing.
const planError = ref("");
interface Approval { id: string; node_id: string; plugin: string; action: string; plan: string; status: string; created_at?: string }
const approval = ref<Approval>();

function openPlan(node: WireGuardNode): void {
  planNode.value = node;
  planError.value = "";
  listenPort.value = node.listen_port ? String(node.listen_port) : "51820";
}

async function createPlan(): Promise<void> {
  if (!planNode.value || planning.value) return;
  planning.value = true;
  planError.value = "";
  try {
    const port = normalizedPort(listenPort.value, planNode.value.listen_port || 51820);
    approval.value = await call<Approval>("plan", { node_id: planNode.value.node_id, listen_port: port });
    notice.value = `Approval ${approval.value.id} created; no host changes were applied`;
    planNode.value = undefined;
  } catch (cause) {
    // Includes the port validation error from normalizedPort, which is about
    // the field two rows above and has to appear next to it.
    planError.value = safeErrorMessage(cause, "WireGuard plan could not be created");
  } finally {
    planning.value = false;
    await resize();
  }
}

// Copy belongs on the plan the control plane rendered, not on anything this
// plugin drew. That document is the one an operator approves and applies.
const copied = ref(false);
const copyFailed = ref(false);
const planBlock = ref<HTMLElement>();

async function copyPlan(value: string): Promise<void> {
  copyFailed.value = false;
  try {
    await navigator.clipboard.writeText(value);
    copied.value = true;
    window.setTimeout(() => { copied.value = false; }, 1400);
  } catch {
    // The sandbox can withhold clipboard-write. Selecting the block leaves the
    // operator one keystroke from the same result instead of a dead end.
    copyFailed.value = true;
    selectPlan();
  }
}

function selectPlan(): void {
  const block = planBlock.value;
  if (!block) return;
  const range = document.createRange();
  range.selectNodeContents(block);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function resize(): Promise<void> { await nextTick(); bridge?.resize(document.documentElement.scrollHeight); }

// ── overlays ─────────────────────────────────────────────────────────────
// The frame is not a viewport: the host sizes it to this document, so a fixed,
// "centred" sheet lands wherever the middle of the frame happens to be rather
// than in front of the operator. See src/overlayAnchor.ts.
const overlayAnchorTop = ref(MIN_ANCHOR_TOP);
const overlayStyle = computed(() => ({ "--overlay-anchor-top": `${overlayAnchorTop.value}px` }));
// Which overlay is open, not merely whether one is. Generating a plan closes
// the form and opens the review in the same tick; a boolean stays true across
// that swap, so the review would never be focused or clamped.
const openOverlayKey = computed(() => (approval.value ? "approval" : planNode.value ? "plan" : ""));
const overlayOpen = computed(() => openOverlayKey.value !== "");

function recordAnchor(event: Event): void {
  if (overlayOpen.value || isInsideOverlay(event.target)) return;
  overlayAnchorTop.value = anchorTopFrom(event);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !overlayOpen.value) return;
  if (approval.value) approval.value = undefined;
  else planNode.value = undefined;
}

let overlayReturnFocus: HTMLElement | undefined;

watch(openOverlayKey, async (key) => {
  if (!key) {
    // Hand focus back to whatever opened the overlay. Without this the
    // keyboard operator lands on the body and starts again from the top.
    const target = overlayReturnFocus;
    overlayReturnFocus = undefined;
    if (target?.isConnected) target.focus();
    return;
  }
  const active = document.activeElement;
  if (!overlayReturnFocus && active instanceof HTMLElement && !isInsideOverlay(active)) {
    overlayReturnFocus = active;
  }
  await nextTick();
  const panel = document.querySelector<HTMLElement>(".overlay-scrim .modal");
  if (!panel) return;
  overlayAnchorTop.value = clampAnchorTop(overlayAnchorTop.value, panel.offsetHeight, document.documentElement.scrollHeight);
  panel.focus();
  await resize();
});

const handshakeExpired = useHandshakeTimeout(init);

function reloadFrame(): void {
  window.location.reload();
}

let observer: ResizeObserver | undefined;
let poller: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => { void resize(); });
  observer.observe(document.body);
  poller = setInterval(() => { if (!loading.value && !overlayOpen.value) void refresh(true); }, 20_000);
  document.addEventListener("pointerdown", recordAnchor, true);
  window.addEventListener("keydown", onKeydown);
  void resize();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  if (poller) clearInterval(poller);
  document.removeEventListener("pointerdown", recordAnchor, true);
  window.removeEventListener("keydown", onKeydown);
  bridge?.dispose();
});
</script>

<template>
  <main class="workspace">
    <header class="page-header">
      <div class="title-mark"><Spline :size="19" aria-hidden="true" /></div>
      <div class="title-copy">
        <div class="title-line"><h1>WireGuard Networks</h1><span class="plugin-label">WireGuard plugin</span></div>
        <p>Secret-free mesh topology, node readiness and approval-bound configuration plans.</p>
      </div>
      <button class="button secondary" type="button" :disabled="loading || refreshing" @click="refresh(true)">
        <LoaderCircle v-if="refreshing" class="spin" :size="15" aria-hidden="true" />
        <RefreshCw v-else :size="15" aria-hidden="true" />
        Refresh
      </button>
    </header>

    <div v-if="bootError || error" class="alert" role="alert">
      <CircleAlert :size="17" aria-hidden="true" />
      <span><strong>{{ bootError ? 'The plugin host is unavailable' : 'WireGuard state could not be loaded' }}</strong>{{ bootError || error }}</span>
      <button v-if="!bootError" class="button secondary compact" type="button" :disabled="refreshing" @click="refresh(true)">
        <LoaderCircle v-if="refreshing" class="spin" :size="13" aria-hidden="true" /> Try again
      </button>
      <button class="icon-button" type="button" aria-label="Dismiss error" title="Dismiss error" @click="error = ''; bootError = ''"><X :size="15" /></button>
    </div>
    <div v-if="notice" class="alert success" aria-live="polite">
      <CheckCircle2 :size="17" aria-hidden="true" /><span>{{ notice }}</span>
      <button class="icon-button" type="button" aria-label="Dismiss notice" title="Dismiss notice" @click="notice = ''"><X :size="15" /></button>
    </div>

    <section class="security-band">
      <ShieldCheck :size="19" aria-hidden="true" />
      <div>
        <strong>Private keys never leave their nodes</strong>
        <p>Plans contain <code>{{ PRIVATE_KEY_PLACEHOLDER }}</code>. The agent substitutes its local key during an approved apply, under rollback watchdog and control-plane self-check.</p>
      </div>
    </section>

    <div v-if="handshakeExpired && !init && !bootError" class="empty-state">
      <CircleAlert :size="26" aria-hidden="true" />
      <strong>The console has not answered</strong>
      <p>This page loads inside the Lattice console and waits for it to hand over a session. That handover has not arrived, so there is nothing to show and nothing has failed either: the page is still listening. Opened outside the console, it will always look like this.</p>
      <div class="empty-actions"><button class="button secondary" type="button" @click="reloadFrame"><RefreshCw :size="15" aria-hidden="true" /> Reload the page</button></div>
    </div>

    <template v-else-if="loading">
      <div class="skeleton-strip" aria-hidden="true">
        <div v-for="cell in 4" :key="cell"><span class="skeleton-bar short" /><span class="skeleton-bar tall" /></div>
      </div>
      <div class="node-panel" role="status" aria-label="Loading WireGuard state">
        <div class="skeleton-rows" aria-hidden="true">
          <div v-for="row in 6" :key="row"><span class="skeleton-bar" /><span class="skeleton-bar short" /><span class="skeleton-bar short" /><span class="skeleton-bar short" /></div>
        </div>
      </div>
    </template>

    <div v-else-if="(bootError || error) && !nodes.length" class="empty-state">
      <CircleAlert :size="26" aria-hidden="true" />
      <strong>Nothing could be loaded</strong>
      <p>The overview request did not come back, so this is not an empty fleet: it is an unanswered question. The message above is what the control plane said.</p>
      <div v-if="!bootError" class="empty-actions"><button class="button secondary" type="button" :disabled="refreshing" @click="refresh(true)"><RefreshCw :size="15" aria-hidden="true" /> Try again</button></div>
    </div>

    <template v-else>
      <section class="summary-strip" aria-label="Mesh summary">
        <div :data-tone="readiness.total && !readiness.ready ? 'warning' : undefined">
          <span>Ready nodes</span><strong>{{ readiness.ready }} / {{ readiness.total }}</strong>
          <small>{{ readiness.total - readiness.ready }} still missing an address or a key</small>
        </div>
        <div><span>Online mesh</span><strong>{{ readiness.onlineReady }}</strong><small>Ready, reachable, not disabled</small></div>
        <div><span>Public endpoints</span><strong>{{ readiness.endpoints }}</strong><small>Reachable from outside the mesh</small></div>
        <div><span>Partial setup</span><strong>{{ readiness.needsKey + readiness.needsAddress }}</strong><small>One half of the pair reported</small></div>
      </section>

      <section class="topology-panel">
        <header>
          <div><h2>Full-mesh readiness</h2><p>Each ready peer receives every other ready peer as a host route.</p></div>
          <Network :size="18" aria-hidden="true" />
        </header>
        <div v-if="readyNodes.length" class="mesh">
          <div class="mesh-core">
            <Spline :size="23" aria-hidden="true" />
            <strong>{{ readyNodes.length }} peers</strong>
            <span>{{ peerCount }} peer blocks each</span>
          </div>
          <button
            v-for="node in readyNodes"
            :key="node.node_id"
            type="button"
            class="peer"
            :aria-pressed="previewNode?.node_id === node.node_id"
            :title="`${node.name || node.node_id}, reported ${node.address}`"
            @click="selectedNodeID = node.node_id"
          >
            <span class="online-dot" :data-online="node.online && !node.disabled" />
            <strong>{{ node.name || node.node_id }}</strong>
            <small>{{ node.address }}</small>
          </button>
        </div>

        <!-- The live state on this fleet. A zero here is not an error, it is a
             fleet whose agents have not reported the two fields a mesh needs,
             so the panel counts which field is missing where. -->
        <div v-else class="empty-state">
          <Spline :size="26" aria-hidden="true" />
          <strong>No node is mesh-ready</strong>
          <p v-if="!readiness.total">No node reports WireGuard metadata at all. Nodes appear here once their agent has checked in.</p>
          <template v-else>
            <p>A node becomes mesh-ready when the control plane holds both a WireGuard address and the public key its agent reported. Both arrive from the node's own agent report, so a node stays out of the mesh until it has a WireGuard interface configured on the host.</p>
            <ul class="readiness-breakdown">
              <li><strong>{{ readiness.needsBoth }}</strong> report neither</li>
              <li><strong>{{ readiness.needsKey }}</strong> have an address, no key</li>
              <li><strong>{{ readiness.needsAddress }}</strong> have a key, no address</li>
              <li v-if="readiness.disabled"><strong>{{ readiness.disabled }}</strong> disabled</li>
            </ul>
            <p class="field-help">The fleet table below lists every node and what it is missing.</p>
          </template>
        </div>
      </section>

      <section v-if="previewNode" class="config-layout">
        <article class="interface-panel">
          <header>
            <div><h2>Selected interface</h2><p>{{ previewNode.name || previewNode.node_id }}</p></div>
            <span class="status" :data-tone="previewNode.online && !previewNode.disabled ? 'healthy' : 'warning'">{{ previewNode.disabled ? 'disabled' : previewNode.online ? 'online' : 'offline' }}</span>
          </header>
          <dl>
            <!-- The reported address, verbatim. The prefix the interface is
                 actually given is assigned by the control plane, so printing a
                 host route under an "Address" label was a guess wearing a fact's
                 clothes. -->
            <div><dt>Reported address</dt><dd :title="previewNode.address || 'not reported'">{{ previewNode.address || 'not reported' }}</dd></div>
            <div><dt>Pinned as peer</dt><dd :title="hostRoute(previewNode.address) || 'not reported'">{{ hostRoute(previewNode.address) || 'not reported' }}</dd></div>
            <div><dt>Listen port</dt><dd>{{ previewNode.listen_port || 51820 }}</dd></div>
            <div><dt>Public key</dt><dd :title="redactedKey(previewNode.public_key)">{{ redactedKey(previewNode.public_key) }}</dd></div>
            <div><dt>Endpoint</dt><dd :title="previewNode.endpoint || 'not reported'">{{ previewNode.endpoint || 'not reported' }}</dd></div>
            <div><dt>Last seen</dt><dd :title="formatDate(previewNode.last_seen)">{{ formatDate(previewNode.last_seen) }}</dd></div>
            <div><dt>Key source</dt><dd>node-local file</dd></div>
            <div v-if="readinessGap(previewNode) !== 'ready'"><dt>Mesh readiness</dt><dd :title="readinessGapLabel(readinessGap(previewNode))">{{ readinessGapLabel(readinessGap(previewNode)) }}</dd></div>
          </dl>
        </article>
        <!-- This panel used to draw a wg0.conf. It was not the wg0.conf that
             gets applied: the control plane renders the real one and assigns
             the interface a wider prefix than the host route shown here, plus
             a keepalive this plugin never sees. Reviewing one document and
             approving another is the defect, so the drawing is gone. What is
             left is only what the overview call actually returned. -->
        <article class="preview-panel">
          <header>
            <div>
              <h2>Mesh membership</h2>
              <p>The peers this session can see for {{ previewNode.name || previewNode.node_id }}. Not the applied configuration.</p>
            </div>
            <span class="status" data-tone="neutral">{{ visiblePeers.length }} visible</span>
          </header>
          <div v-if="visiblePeers.length" class="peer-table-wrap">
            <table class="peer-table">
              <caption class="sr-only">Peers visible to this session</caption>
              <thead><tr><th>Peer</th><th>AllowedIPs</th><th>Endpoint</th></tr></thead>
              <tbody>
                <tr v-for="peer in visiblePeers" :key="peer.node_id">
                  <td><strong :title="peer.name || peer.node_id">{{ peer.name || peer.node_id }}</strong><small :title="redactedKey(peer.public_key)">{{ redactedKey(peer.public_key) }}</small></td>
                  <td class="mono" :title="hostRoute(peer.address)">{{ hostRoute(peer.address) }}</td>
                  <td class="mono" :title="peer.endpoint || 'dial-out only, no public endpoint'">{{ peer.endpoint || 'dial-out only' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty-state">
            <FileCode2 :size="24" aria-hidden="true" />
            <strong>No peers to list</strong>
            <p v-if="readinessGap(previewNode) !== 'ready'">{{ previewNode.name || previewNode.node_id }} is not mesh-ready itself. {{ readinessGapLabel(readinessGap(previewNode)) }}.</p>
            <p v-else>No other node is mesh-ready, so this node would be given a mesh with no peers in it.</p>
          </div>
          <div class="plan-caveat">
            <strong>The applied configuration is rendered by the control plane, not here.</strong>
            <p>It is shown in full on the approval, before anything reaches a node. This panel cannot show:</p>
            <ul>
              <li v-for="item in PLAN_UNKNOWNS" :key="item">{{ item }}</li>
            </ul>
          </div>
        </article>
      </section>

      <section class="node-panel">
        <header>
          <div><h2>Fleet nodes</h2><p>Readiness reflects the control-plane fields available for mesh compilation.</p></div>
          <span class="status" data-tone="neutral">{{ readiness.total }} nodes</span>
        </header>
        <div v-if="nodes.length" class="table-wrap">
          <table>
            <thead><tr>
              <th v-for="column in NODE_COLUMNS" :key="column.label" :aria-sort="ariaSort(column.key)">
                <button v-if="column.key" class="sort-button" type="button" @click="toggleSort(column.key as NodeSortKey)">
                  {{ column.label }}<span class="sort-mark" aria-hidden="true">{{ sortMark(column.key) }}</span>
                </button>
                <template v-else>{{ column.label }}</template>
              </th>
              <th class="actions">Actions</th>
            </tr></thead>
            <tbody>
              <tr v-for="node in sortedNodes" :key="node.node_id">
                <td><strong :title="node.name || node.node_id">{{ node.name || node.node_id }}</strong><small :title="node.node_id">{{ node.node_id }}</small></td>
                <td class="mono" :title="node.address ? `reported ${node.address}, pinned as peer to ${hostRoute(node.address)}` : 'no address reported'">{{ node.address || '-' }}</td>
                <td class="mono" :title="node.public_key ? 'Public key, shown truncated' : 'The agent has not reported a public key'">{{ redactedKey(node.public_key) }}</td>
                <td class="mono" :title="node.endpoint || 'not reported'">{{ node.endpoint || '-' }}</td>
                <td>
                  <span class="status" :data-tone="node.configuration === 'ready' ? 'healthy' : node.configuration === 'partial' ? 'warning' : 'neutral'">{{ node.configuration }}</span>
                  <small v-if="readinessGap(node) !== 'ready'">{{ readinessGapLabel(readinessGap(node)) }}</small>
                </td>
                <td>
                  <span class="status" :data-tone="node.online && !node.disabled ? 'healthy' : 'warning'">{{ node.disabled ? 'disabled' : node.online ? 'online' : 'offline' }}</span>
                  <small :title="formatDate(node.last_seen)">{{ formatDate(node.last_seen) }}</small>
                </td>
                <td class="actions">
                  <button
                    v-if="canPlan"
                    class="button secondary compact"
                    type="button"
                    :disabled="readinessGap(node) !== 'ready'"
                    :title="readinessGap(node) !== 'ready' ? readinessGapLabel(readinessGap(node)) : 'Create configuration plan'"
                    @click="openPlan(node)"
                  >
                    <FileCode2 :size="14" aria-hidden="true" />Plan
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="empty-state">
          <Network :size="26" aria-hidden="true" />
          <strong>No visible nodes</strong>
          <p>WireGuard metadata appears after agents report their node state. If the fleet has nodes and none is listed here, this session may not be allowed to read them.</p>
        </div>
      </section>
    </template>

    <div v-if="planNode" class="overlay-scrim" :style="overlayStyle" @mousedown.self="planNode = undefined">
      <section tabindex="-1" class="modal" role="dialog" aria-modal="true" aria-labelledby="plan-title">
        <header>
          <div><h2 id="plan-title">Create mesh configuration plan</h2><p>{{ planNode.name || planNode.node_id }}</p></div>
          <button class="icon-button" type="button" aria-label="Close" @click="planNode = undefined"><X :size="17" /></button>
        </header>
        <div class="plan-body">
          <label>
            <span>Listen port</span>
            <input v-model="listenPort" type="number" min="1" max="65535" />
            <small class="field-help">The port this node listens on. Peers reach it at its endpoint, not at this port directly.</small>
          </label>
          <div class="plan-facts">
            <div><Route :size="16" aria-hidden="true" /><span><strong>{{ peerCount }} peers</strong><small>Each allowed as /32 or /128</small></span></div>
            <div><KeyRound :size="16" aria-hidden="true" /><span><strong>Private key placeholder</strong><small>Substituted only on the target node</small></span></div>
            <div><ShieldCheck :size="16" aria-hidden="true" /><span><strong>Pending approval</strong><small>No direct apply from this plugin page</small></span></div>
          </div>
          <div v-if="planError" class="alert" role="alert">
            <CircleAlert :size="17" aria-hidden="true" /><span>{{ planError }}</span>
          </div>
          <div v-if="peerCount">
            <p class="field-help">Peers this session can see, which the plan will contain:</p>
            <ul class="plan-peers" aria-label="Peers visible to this session">
              <li v-for="peer in meshPeersFor(planNode, nodes)" :key="peer.node_id">
                {{ peer.name || peer.node_id }} · {{ hostRoute(peer.address) }}
              </li>
            </ul>
          </div>
          <!-- The control plane builds the plan from the whole node store; this
               page only ever saw the nodes the session may read. So this list
               is a lower bound, and saying otherwise would under-report peers. -->
          <p class="field-help">The control plane builds the plan from every node in the fleet. If this session cannot read some of them, the plan will contain peers that are not listed above. The full document is on the approval.</p>
        </div>
        <footer>
          <button class="button secondary" type="button" @click="planNode = undefined">Cancel</button>
          <button class="button primary" type="button" :disabled="planning" @click="createPlan">
            <LoaderCircle v-if="planning" class="spin" :size="15" aria-hidden="true" />
            <FileCode2 v-else :size="15" aria-hidden="true" />Generate plan
          </button>
        </footer>
      </section>
    </div>

    <div v-if="approval" class="overlay-scrim" :style="overlayStyle" @mousedown.self="approval = undefined">
      <section tabindex="-1" class="modal wide plan-review" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <header>
          <div><h2 id="approval-title">Plan ready for approval</h2><p>{{ approval.id }} / {{ approval.status }} / {{ approval.node_id }}</p></div>
          <div class="approval-actions">
            <button class="icon-button bordered" type="button" :aria-label="copied ? 'Copied' : 'Copy the rendered plan'" :title="copied ? 'Copied' : 'Copy the rendered plan'" @click="copyPlan(approval.plan)">
              <CheckCircle2 v-if="copied" :size="15" />
              <Copy v-else :size="15" />
            </button>
            <button class="icon-button" type="button" aria-label="Close" @click="approval = undefined"><X :size="17" /></button>
          </div>
        </header>
        <p class="approval-banner">
          <ShieldCheck :size="17" aria-hidden="true" />
          <span>The control plane rendered this document and it is what an approved apply writes. It carries public peer keys and a private-key placeholder, and it has not been applied. Approve it in Operations, then Approvals.</span>
        </p>
        <p v-if="copyFailed" class="approval-banner" role="status">
          <CircleAlert :size="15" aria-hidden="true" />
          <span>The sandbox refused clipboard access. The document is selected: copy it with the keyboard.</span>
        </p>
        <pre ref="planBlock">{{ approval.plan }}</pre>
        <footer><button class="button primary" type="button" @click="approval = undefined">Done</button></footer>
      </section>
    </div>
  </main>
</template>
