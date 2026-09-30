<script setup lang="ts">
/**
 * WireGuard: which fleet nodes can join the mesh, what each lacks, and the
 * plan that an approved apply writes to one of them.
 *
 * Layered like every console area (design 22 section 2): Overview first,
 * with why the mesh cannot form and the step that changes it, then one
 * readiness bar; then Fleet, the nodes grouped by what they lack; then Mesh,
 * the ready nodes as a compact list. A node opens in a side panel from any
 * layer, and the layer, the open node and the Fleet search live in the
 * console's address, so a reload or a pasted link lands on the same place.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CheckCircle2, Copy, FileCode2, KeyRound, LayoutDashboard, Network, RefreshCw, Route, Server, ShieldCheck, Spline } from "@lucide/vue";

import { BridgeClient, canCall, type HostInit } from "@latticenet/plugin-bridge";
import {
  PcButton,
  PcCount,
  PcEmptyState,
  PcLensTab,
  PcLensTabs,
  PcModal,
  PcNotice,
  PcPageHeader,
  PcPagination,
  PcPanel,
  PcPanelHeader,
  PcProofLine,
  PcSearchField,
  PcSidePanel,
  PcSkeleton,
  PcToolbar,
  PcWorkspace,
  overlayDepth,
  useOverlayEscape,
} from "@latticenet/plugin-bridge/chassis";

import FleetTable from "./components/FleetTable.vue";
import MeshList from "./components/MeshList.vue";
import NodeFacts from "./components/NodeFacts.vue";
import ReadinessOverview from "./components/ReadinessOverview.vue";
import { useFleetRead } from "./fleetRead";
import { PAGE_SIZE, agentState, displayName, filterNodes, fleetNotice, pageCount, pageSlice, proofSegments } from "./fleetView";
import { useHandshakeTimeout } from "./handshakeTimeout";
import { TASKS_ROUTE, postNavigate } from "./navigate";
import {
  channelFromHash,
  createStateSender,
  documentPageState,
  listenForInitPageState,
  stateMessage,
  validPageState,
  writeDocumentState,
  type PageState,
  type StateSender,
} from "./pageState";
import { agentCounts, gapGroups, meshAttention, missingColumnsNote, readinessBar, reportedColumns, type AttentionActionKind } from "./readiness";
import { PANEL_TITLE, decodeWgState, encodeWgState, nodePanelState, type WgPageState, type WgView } from "./viewState";
import {
  PRIVATE_KEY_PLACEHOLDER,
  hostRoute,
  meshPeersFor,
  meshReadyNodes,
  normalizedPort,
  readinessGap,
  safeErrorMessage,
  sortNodes,
  summarizeReadiness,
  type NodeSortKey,
  type SortDirection,
  type WireGuardNode,
} from "./wireguardModel";

const SERVICE = "latticenet.wireguard/networks";
/** Shown when the console never completed the handshake and named no reason. */
const HANDSHAKE_FALLBACK =
  "The Lattice console did not hand this page a session, so there is no WireGuard state to read.";
const init = ref<HostInit>();
const notice = ref("");
const bootError = ref("");
// The rows, when they landed, and the newest failure. A failed read never
// replaces a good list, and a retry keeps the failure it is retrying until the
// read settles, so the empty fleet is reachable only through a read that
// landed empty.
const { nodes, observedAt, error, loading, refreshing, refresh: readFleet } = useFleetRead(
  async () => (await call<{ nodes: WireGuardNode[] }>("overview")).nodes ?? [],
);

// ── page state: layer, open node, Fleet search ──────────────────────────────
//
// The console's address carries them (pageState.ts). Before the host says
// where the operator was, the page starts from its own document query: empty
// under any real console, set only by a host that keeps no page state, or by
// an old `?lens=mesh` link to the frame itself.
const startState = decodeWgState(documentPageState());
const view = ref<WgView>(startState.view);
const search = ref(startState.q);
const openId = ref(startState.open);

function applyState(state: WgPageState): void {
  view.value = state.view;
  search.value = state.q;
  openId.value = state.open;
}

const pageState = computed<PageState>(() => encodeWgState({ view: view.value, open: openId.value, q: search.value }));

const channel = channelFromHash(window.location.hash);
let hostState: PageState | undefined;
let hostKeepsState = false;
let stateSender: StateSender | undefined;
/* Registered before the bridge client, so it hears init first (pageState.ts). */
let stopInitListener: (() => void) | undefined = channel
  ? listenForInitPageState(window, channel, (state) => {
      hostState = state;
    })
  : undefined;

/* The state goes out only after init, and only once the operator changes
 * something: the page's reading of the address is not a reason to rewrite a
 * pasted link. */
function adoptPageState(): void {
  hostKeepsState = hostState !== undefined;
  if (hostState) applyState(decodeWgState(hostState));
  stopInitListener?.();
  stopInitListener = undefined;
  stateSender?.dispose();
  stateSender = createStateSender(sendState, { baseline: pageState.value });
}

function sendState(state: PageState): void {
  const valid = validPageState(state);
  if (!bridge || !channel || !valid) return;
  window.parent.postMessage(stateMessage(bridge.nonce, valid), channel.hostOrigin);
}

function publishPageState(state: PageState): void {
  if (!stateSender) return;
  // A host that keeps no page state ignores the message; the frame's own
  // query is then the only place the state can survive a frame reload.
  if (!hostKeepsState) writeDocumentState(state);
  stateSender.push(state);
}
watch(pageState, publishPageState);

let bridge: BridgeClient | undefined;
try {
  bridge = new BridgeClient({ window, expectedPluginId: "latticenet.wireguard", expectedRoutes: ["networks"], idPrefix: "wireguard" });
  bridge.init.then(async (value) => {
    adoptPageState();
    init.value = value;
    await refresh();
  }).catch((cause) => {
    bootError.value = safeErrorMessage(cause, HANDSHAKE_FALLBACK);
  });
} catch (cause) {
  stopInitListener?.();
  bootError.value = safeErrorMessage(cause, HANDSHAKE_FALLBACK);
}

const canPlan = computed(() => canCall(init.value, SERVICE, "plan"));
const readiness = computed(() => summarizeReadiness(nodes.value));
const agents = computed(() => agentCounts(nodes.value));
// One definition of "ready" for the bar, the mesh list, the peer count and
// the panel. The server's `configuration` field is the same rule.
const readyNodes = computed(() => meshReadyNodes(nodes.value));
const peerCount = computed(() => Math.max(0, readyNodes.value.length - 1));
const proof = computed(() => proofSegments({ readiness: readiness.value, agents: agents.value, observedAt: observedAt.value, error: error.value }));
// A refresh that failed after a good read leaves the rows standing; the
// notice then says the table is the last good read, not the current one, and
// only that notice can be dismissed. With nothing loaded there is nothing
// behind the notice to dismiss it into.
const pageNotice = computed(() => fleetNotice({ bootError: bootError.value, error: error.value, loaded: nodes.value.length }));
/** Counts only once a read has landed; a failed first read states none. */
const landed = computed(() => observedAt.value !== undefined);

// ── Overview ────────────────────────────────────────────────────────────────

const attention = computed(() => meshAttention(nodes.value, readiness.value));
const bar = computed(() => readinessBar(readiness.value));

function onAttention(kind: AttentionActionKind): void {
  if (kind === "tasks") {
    if (channel) postNavigate(window, TASKS_ROUTE, channel.hostOrigin);
    return;
  }
  view.value = kind;
}

// ── Fleet ───────────────────────────────────────────────────────────────────

const sortKey = ref<NodeSortKey>("status");
const sortDirection = ref<SortDirection>("asc");
const sortedNodes = computed(() => sortNodes(nodes.value, sortKey.value, sortDirection.value));
const visibleNodes = computed(() => filterNodes(sortedNodes.value, search.value));
const columns = computed(() => reportedColumns(visibleNodes.value));
const columnsNote = computed(() => missingColumnsNote(reportedColumns(nodes.value)));
const page = ref(1);
const pages = computed(() => pageCount(visibleNodes.value.length));
const pagedGroups = computed(() => gapGroups(pageSlice(visibleNodes.value, page.value)));
/* Group rows carry sizes over every node the search keeps, not just this page. */
const groupTotals = computed(() => new Map(gapGroups(visibleNodes.value).map((group) => [group.gap, { count: group.nodes.length, online: group.online }])));
const pageFrom = computed(() => (visibleNodes.value.length ? (page.value - 1) * PAGE_SIZE + 1 : 0));
const pageTo = computed(() => Math.min(visibleNodes.value.length, page.value * PAGE_SIZE));
const searching = computed(() => search.value.trim() !== "");

watch(search, () => { page.value = 1; });
watch(pages, (count) => { if (page.value > count) page.value = count; });

function toggleSort(key: NodeSortKey): void {
  if (sortKey.value === key) {
    sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    return;
  }
  sortKey.value = key;
  sortDirection.value = "asc";
}

// ── the node panel ──────────────────────────────────────────────────────────

const openNode = computed(() => nodes.value.find((node) => node.node_id === openId.value));
/*
 * The panel says a node is not in the fleet only on a read that landed. While
 * the newest read has failed it says the node was not read and offers the
 * retry; a failed first read used to leave the skeleton spinning for good.
 */
const panelState = computed(() => nodePanelState({ found: Boolean(openNode.value), loading: loading.value, readFailed: Boolean(error.value) }));
const panelTitle = computed(() => (openNode.value ? displayName(openNode.value) : PANEL_TITLE[panelState.value]));
const panelDescription = computed(() => (openNode.value ? `${openNode.value.node_id} · agent ${agentState(openNode.value)}` : openId.value));

function openPanel(nodeId: string): void {
  openId.value = nodeId;
}

/**
 * Close the panel. Focus goes back to whatever opened it; a panel the address
 * opened (a reload, a pasted link) had no opener, so focus lands on that
 * node's row instead of falling to the page.
 */
async function closePanel(): Promise<void> {
  const closed = openId.value;
  openId.value = "";
  await nextTick();
  const active = document.activeElement;
  if (closed && (!active || active === document.body)) {
    document.querySelector<HTMLElement>(`[id="node-${closed}"] .wg-row-open, [id="mesh-${closed}"] .wg-row-open`)?.focus();
  }
}

async function call<T>(method: string, payload: unknown = {}): Promise<T> {
  if (!bridge || !canCall(init.value, SERVICE, method)) {
    throw new Error(`This session cannot run ${method} on WireGuard, so nothing was sent to any node.`);
  }
  return bridge.call<T>(SERVICE, method, payload).promise;
}

async function refresh(): Promise<void> {
  if (!init.value) return;
  await readFleet();
  await resize();
}

// ── plan ────────────────────────────────────────────────────────────────────

const planNode = ref<WireGuardNode>();
const listenPort = ref("");
const planning = ref(false);
// Errors raised while a dialog is open belong in that dialog. The page-level
// notice sits behind the scrim, so writing there reads as the button doing
// nothing.
const planError = ref("");
interface Approval { id: string; node_id: string; plugin: string; action: string; plan: string; status: string; created_at?: string }
const approval = ref<Approval>();

function openPlan(node: WireGuardNode): void {
  if (readinessGap(node) !== "ready" || !canPlan.value) return;
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
    const created = await call<Approval>("plan", { node_id: planNode.value.node_id, listen_port: port });
    notice.value = `Approval ${created.id} created for ${created.node_id}. Nothing has been written to the node.`;
    // Close the form and let its focus return to the opener settle before
    // the review opens, so the review takes focus from that control and
    // hands it back there on close.
    planNode.value = undefined;
    await nextTick();
    approval.value = created;
  } catch (cause) {
    // Includes the port validation error from normalizedPort, which is about
    // the field two rows above and has to appear next to it.
    planError.value = safeErrorMessage(
      cause,
      "No plan was created, so nothing has changed on this node.",
    );
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

function closeApproval(): void {
  approval.value = undefined;
  copyFailed.value = false;
}

async function resize(): Promise<void> { await nextTick(); bridge?.resize(document.documentElement.scrollHeight); }

// One document handler closes the top of the overlay stack on Escape; the
// panel and the modals register themselves while open.
useOverlayEscape();

const handshakeExpired = useHandshakeTimeout(init);

function reloadFrame(): void {
  window.location.reload();
}

let observer: ResizeObserver | undefined;
let poller: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => { void resize(); });
  observer.observe(document.body);
  poller = setInterval(() => { if (!loading.value && overlayDepth() === 0) void refresh(); }, 20_000);
  void resize();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  if (poller) clearInterval(poller);
  stopInitListener?.();
  stateSender?.dispose();
  bridge?.dispose();
});
</script>

<template>
  <PcWorkspace>
    <PcPageHeader
      title="WireGuard Networks"
      badge="WireGuard plugin"
      description="Which nodes can join the mesh and what each lacks. A configuration plan reaches a node only after you approve it."
    >
      <template #icon><Spline :size="19" aria-hidden="true" /></template>
      <template #actions>
        <PcButton :busy="refreshing" :disabled="loading || !init" @click="refresh()">
          <template #icon><RefreshCw :size="15" aria-hidden="true" /></template>
          Refresh
        </PcButton>
      </template>
      <template #proof><PcProofLine :segments="proof" :refreshing="refreshing" /></template>
    </PcPageHeader>

    <PcNotice
      v-if="pageNotice"
      :tone="pageNotice.tone"
      :title="pageNotice.title"
      :dismissible="pageNotice.dismissible"
      dismiss-label="Dismiss error"
      @dismiss="error = ''"
    >
      {{ bootError || error }}
      <template v-if="!bootError" #actions>
        <PcButton compact :busy="refreshing" @click="refresh()">Try again</PcButton>
      </template>
    </PcNotice>
    <PcNotice v-if="notice" tone="success" dismissible dismiss-label="Dismiss notice" @dismiss="notice = ''">{{ notice }}</PcNotice>

    <PcToolbar label="WireGuard toolbar">
      <template #tabs>
        <PcLensTabs v-model="view" label="WireGuard layers">
          <PcLensTab value="overview" label="Overview">
            <template #icon><LayoutDashboard :size="14" aria-hidden="true" /></template>
          </PcLensTab>
          <PcLensTab value="fleet" label="Fleet" :count="landed ? readiness.total : null">
            <template #icon><Server :size="14" aria-hidden="true" /></template>
          </PcLensTab>
          <PcLensTab value="mesh" label="Mesh" :count="landed ? readyNodes.length : null">
            <template #icon><Spline :size="14" aria-hidden="true" /></template>
          </PcLensTab>
        </PcLensTabs>
      </template>
      <template v-if="view === 'fleet' && landed" #search>
        <PcSearchField v-model="search" label="Search fleet" placeholder="Search node, address, endpoint or key" />
      </template>
      <template v-if="view === 'fleet' && searching" #note>{{ visibleNodes.length }} of {{ readiness.total }} nodes match</template>
    </PcToolbar>

    <PcPanel v-if="handshakeExpired && !init && !bootError">
      <PcEmptyState kind="handshake" title="The console has not answered">
        <p>This page loads inside the Lattice console and waits for it to hand over a session. That handover has not arrived, so there is nothing to show and nothing has failed either: the page is still listening. Opened outside the console, it will always look like this.</p>
        <template #actions>
          <PcButton @click="reloadFrame"><template #icon><RefreshCw :size="15" aria-hidden="true" /></template>Reload the page</PcButton>
        </template>
      </PcEmptyState>
    </PcPanel>

    <!-- A failed handshake, or a read that failed with nothing loaded. It
         stands ahead of the skeleton so a failure is never hidden behind one,
         and ahead of the fleet so a retry in flight never reads as an empty
         fleet: the failure holds this block until a read lands. -->
    <PcPanel v-else-if="bootError || (error && !nodes.length)">
      <PcEmptyState kind="error" title="Nothing could be loaded">
        <p>This is not an empty fleet, it is an unanswered question. The message above says what stopped it.</p>
        <template v-if="!bootError" #actions>
          <PcButton :busy="refreshing" @click="refresh()"><template #icon><RefreshCw :size="15" aria-hidden="true" /></template>Try again</PcButton>
        </template>
      </PcEmptyState>
    </PcPanel>

    <template v-else-if="loading">
      <PcPanel>
        <PcSkeleton :count="8" label="Loading WireGuard state" />
      </PcPanel>
    </template>

    <!-- Only a read that landed reaches this block. -->
    <PcPanel v-else-if="!nodes.length">
      <PcEmptyState title="No visible nodes">
        <template #icon><Network :size="26" aria-hidden="true" /></template>
        <p>WireGuard metadata appears after agents report their node state. If the fleet has nodes and none is listed here, this session may not be allowed to read them.</p>
      </PcEmptyState>
    </PcPanel>

    <section v-else-if="view === 'overview'" id="pc-panel-overview" class="wg-overview" role="tabpanel" aria-labelledby="pc-tab-overview">
      <ReadinessOverview :items="attention" :bar="bar" :total="readiness.total" :agents="agents" :can-navigate="Boolean(channel)" @act="onAttention" />
    </section>

    <PcPanel v-else-if="view === 'fleet'" id="pc-panel-fleet" role="tabpanel" aria-labelledby="pc-tab-fleet">
      <PcPanelHeader title="Fleet nodes" :description="columnsNote ? `Grouped by what each node lacks. Columns no node reports are left out: ${columnsNote}.` : 'Grouped by what each node lacks. Open a node for its interface facts, its peers and its plan.'">
        <PcCount :value="`${readiness.total} nodes · ${readiness.ready} mesh-ready`" />
      </PcPanelHeader>

      <template v-if="visibleNodes.length">
        <FleetTable
          :groups="pagedGroups"
          :totals="groupTotals"
          :columns="columns"
          :active-id="openId"
          :can-plan="canPlan"
          :sort-key="sortKey"
          :sort-direction="sortDirection"
          @open="openPanel"
          @plan="openPlan"
          @sort="toggleSort"
        />
        <PcPagination
          v-if="pages > 1"
          v-model:page="page"
          :pages="pages"
          :from="pageFrom"
          :to="pageTo"
          :total="visibleNodes.length"
          noun="Nodes"
          :note="searching ? 'matching the search' : ''"
          label="Fleet pagination"
        />
      </template>

      <PcEmptyState v-else kind="no-match" title="No node matches that search">
        <template #icon><Network :size="26" aria-hidden="true" /></template>
        <p>Nothing in {{ readiness.total }} nodes matches <span class="pc-mono">{{ search.trim() }}</span>. The search covers node name and id, address, endpoint and public key.</p>
        <template #actions><PcButton @click="search = ''">Clear the search</PcButton></template>
      </PcEmptyState>
    </PcPanel>

    <PcPanel v-else id="pc-panel-mesh" role="tabpanel" aria-labelledby="pc-tab-mesh">
      <PcPanelHeader title="Mesh" description="Every mesh-ready node gets a host route to each of the others. Open a node for its peers and its plan.">
        <PcCount :value="readyNodes.length ? `${readyNodes.length} mesh-ready · ${peerCount} ${peerCount === 1 ? 'peer' : 'peers'} in each config` : '0 mesh-ready'" />
      </PcPanelHeader>
      <MeshList v-if="readyNodes.length" :nodes="readyNodes" :active-id="openId" @open="openPanel" />
      <PcEmptyState v-else title="No node is mesh-ready">
        <template #icon><Spline :size="26" aria-hidden="true" /></template>
        <p>A node becomes mesh-ready when the control plane holds both a WireGuard address and the public key its agent reported. The Overview says what stops it and the step that changes it.</p>
        <template #actions>
          <PcButton @click="view = 'overview'">Open the Overview</PcButton>
          <PcButton @click="view = 'fleet'">See what each node lacks</PcButton>
        </template>
      </PcEmptyState>
    </PcPanel>

    <!-- L2: one node, on `open=<node_id>`, from any layer. -->
    <PcSidePanel
      :open="Boolean(openId) && !bootError"
      :title="panelTitle"
      :description="panelDescription"
      class="wg-node-panel"
      close-label="Close node panel"
      @close="closePanel"
    >
      <PcSkeleton v-if="panelState === 'loading'" :count="6" label="Loading this node" />
      <PcEmptyState v-else-if="panelState === 'unread'" kind="error" title="This node could not be read">
        <p>The fleet read failed, so whether <span class="pc-mono">{{ openId }}</span> is in the fleet is not known. The message on the page says what stopped it.</p>
        <template #actions><PcButton :busy="refreshing" @click="refresh()">Try again</PcButton></template>
      </PcEmptyState>
      <PcEmptyState v-else-if="panelState === 'missing' || !openNode" title="This node is not in the fleet this session can see">
        <p>The link names <span class="pc-mono">{{ openId }}</span>, which the overview does not list. It may have been removed, or be outside this session's read scope.</p>
        <template #actions><PcButton @click="closePanel(); view = 'fleet'">Show the fleet</PcButton></template>
      </PcEmptyState>
      <NodeFacts v-else :node="openNode" :nodes="nodes" :can-plan="canPlan" @plan="openPlan(openNode)" />
    </PcSidePanel>

    <PcModal :open="!!planNode" title="Create mesh configuration plan" :description="planNode ? displayName(planNode) : ''" @close="planNode = undefined">
      <form v-if="planNode" id="plan-form" class="plan-form" @submit.prevent="createPlan">
        <PcNotice tone="info" title="Private keys never leave their nodes">
          <template #icon><ShieldCheck :size="17" aria-hidden="true" /></template>
          The plan carries <code>{{ PRIVATE_KEY_PLACEHOLDER }}</code> where the key goes. The node's agent substitutes its local key during an approved apply, under the rollback watchdog and a control-plane self-check.
        </PcNotice>
        <label>
          <span>Listen port</span>
          <input v-model="listenPort" type="number" min="1" max="65535" />
          <small class="field-help">The port this node listens on. Peers reach it at its endpoint, not at this port directly.</small>
        </label>
        <div class="plan-facts">
          <div><Route :size="16" aria-hidden="true" /><span><strong>{{ peerCount }} peers</strong><small>Each allowed as /32 or /128</small></span></div>
          <div><KeyRound :size="16" aria-hidden="true" /><span><strong>Private key placeholder</strong><small>Substituted only on the target node</small></span></div>
          <div><ShieldCheck :size="16" aria-hidden="true" /><span><strong>Pending approval</strong><small>Nothing is written to {{ displayName(planNode) }} until you approve it</small></span></div>
        </div>
        <PcNotice v-if="planError">{{ planError }}</PcNotice>
        <div v-if="peerCount">
          <p class="field-help">Peers this session can see, which the plan will contain:</p>
          <ul class="plan-peers" aria-label="Peers visible to this session">
            <li v-for="peer in meshPeersFor(planNode, nodes)" :key="peer.node_id">
              {{ displayName(peer) }} · {{ hostRoute(peer.address) }}
            </li>
          </ul>
        </div>
        <!-- The control plane builds the plan from the whole node store; this
             page only ever saw the nodes the session may read. So this list
             is a lower bound, and saying otherwise would under-report peers. -->
        <p class="field-help">The control plane builds the plan from every node in the fleet. If this session cannot read some of them, the plan will contain peers that are not listed above. The full document is on the approval.</p>
      </form>
      <template #footer>
        <PcButton @click="planNode = undefined">Cancel</PcButton>
        <PcButton variant="primary" type="submit" form="plan-form" :busy="planning">
          <template #icon><FileCode2 :size="15" aria-hidden="true" /></template>
          Generate plan
        </PcButton>
      </template>
    </PcModal>

    <PcModal
      :open="!!approval"
      size="large"
      title="Plan ready for approval"
      :description="approval ? `Approval ${approval.id} for ${approval.node_id}, currently ${approval.status}.` : ''"
      @close="closeApproval"
    >
      <div v-if="approval" class="approval-body">
        <PcNotice tone="success">
          <template #icon><ShieldCheck :size="17" aria-hidden="true" /></template>
          The control plane rendered this document and it is what an approved apply writes. It carries public peer keys and a private-key placeholder, and it has not been applied. Approve it in Operations, then Approvals.
        </PcNotice>
        <PcNotice v-if="copyFailed" tone="warning">The sandbox refused clipboard access. The document is selected: copy it with the keyboard.</PcNotice>
        <pre ref="planBlock" class="plan-document">{{ approval.plan }}</pre>
      </div>
      <template #footer>
        <PcButton v-if="approval" @click="copyPlan(approval.plan)">
          <template #icon><CheckCircle2 v-if="copied" :size="15" aria-hidden="true" /><Copy v-else :size="15" aria-hidden="true" /></template>
          {{ copied ? 'Copied' : 'Copy the rendered plan' }}
        </PcButton>
        <PcButton variant="primary" @click="closeApproval">Done</PcButton>
      </template>
    </PcModal>
  </PcWorkspace>
</template>
