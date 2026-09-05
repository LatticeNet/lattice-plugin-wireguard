<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CheckCircle2, Copy, FileCode2, KeyRound, Network, RefreshCw, Route, ShieldCheck, Spline } from "@lucide/vue";

import { BridgeClient, canCall, type HostInit } from "@latticenet/plugin-bridge";
import {
  PcActionsCell,
  PcButton,
  PcCount,
  PcDetailRow,
  PcEmptyState,
  PcKindChip,
  PcLensTab,
  PcLensTabs,
  PcModal,
  PcNameCell,
  PcNotice,
  PcPageHeader,
  PcPagination,
  PcPanel,
  PcPanelHeader,
  PcProofLine,
  PcRow,
  PcSearchField,
  PcSkeleton,
  PcStatCard,
  PcStatStrip,
  PcStateDot,
  PcStatePill,
  PcTable,
  PcTd,
  PcTh,
  PcToolbar,
  PcWorkspace,
  overlayDepth,
  useDocumentQueryState,
  useExpandSet,
  useOverlayEscape,
  type NameStatus,
  type StateTone,
} from "@latticenet/plugin-bridge/chassis";

import { useFleetRead } from "./fleetRead";
import { PAGE_SIZE, agentState, displayName, filterNodes, fleetNotice, lensFrom, meshTileTitle, pageCount, pageOf, pageSlice, peerSubline, proofSegments, type Lens } from "./fleetView";
import { useHandshakeTimeout } from "./handshakeTimeout";
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

let bridge: BridgeClient | undefined;
try {
  bridge = new BridgeClient({ window, expectedPluginId: "latticenet.wireguard", expectedRoutes: ["networks"], idPrefix: "wireguard" });
  bridge.init.then(async (value) => {
    init.value = value;
    await refresh();
  }).catch((cause) => {
    bootError.value = safeErrorMessage(cause, HANDSHAKE_FALLBACK);
  });
} catch (cause) {
  bootError.value = safeErrorMessage(cause, HANDSHAKE_FALLBACK);
}

const canPlan = computed(() => canCall(init.value, SERVICE, "plan"));
const readiness = computed(() => summarizeReadiness(nodes.value));
// One definition of "ready" for the strip, the mesh grid, the peer count and
// the rows folded under a node. The server's `configuration` field is the same
// rule and is still what the table column reports.
const readyNodes = computed(() => meshReadyNodes(nodes.value));
const peerCount = computed(() => Math.max(0, readyNodes.value.length - 1));
const proof = computed(() => proofSegments(readiness.value, observedAt.value));
// A refresh that failed after a good read leaves the rows standing; the
// notice then says the table is the last good read, not the current one, and
// only that notice can be dismissed. With nothing loaded there is nothing
// behind the notice to dismiss it into.
const pageNotice = computed(() => fleetNotice({ bootError: bootError.value, error: error.value, loaded: nodes.value.length }));

// ── lens, search, expansion and page: the document query carries them ────
// `?lens=mesh` and `?expand=<node_id>` survive a reload and can be shared; the
// handshake fragment is never touched.
const query = useDocumentQueryState();
const lens = ref<Lens>(lensFrom(query.read("lens")[0]));
const search = ref("");
const expanded = useExpandSet(query.read("expand"));
const page = ref(1);

function setLens(value: string): void {
  lens.value = lensFrom(value);
  query.write("lens", lens.value === "fleet" ? [] : [lens.value]);
}

function toggleNode(nodeID: string): void {
  expanded.toggle(nodeID);
  query.write("expand", [...expanded.own.value]);
}

/** From the mesh grid: open one node in the fleet list, go to its page and bring its row into view. */
async function showNode(nodeID: string): Promise<void> {
  search.value = "";
  expanded.open(nodeID);
  query.write("expand", [...expanded.own.value]);
  page.value = pageOf(sortedNodes.value.findIndex((node) => node.node_id === nodeID));
  setLens("fleet");
  await nextTick();
  document.getElementById(`node-${nodeID}`)?.scrollIntoView({ block: "start" });
}

// ── fleet table ordering ─────────────────────────────────────────────────
const sortKey = ref<NodeSortKey>("status");
const sortDirection = ref<SortDirection>("asc");
const sortedNodes = computed(() => sortNodes(nodes.value, sortKey.value, sortDirection.value));
const visibleNodes = computed(() => filterNodes(sortedNodes.value, search.value));
const pages = computed(() => pageCount(visibleNodes.value.length));
const pagedNodes = computed(() => pageSlice(visibleNodes.value, page.value));
const pageFrom = computed(() => (visibleNodes.value.length ? (page.value - 1) * PAGE_SIZE + 1 : 0));
const pageTo = computed(() => Math.min(visibleNodes.value.length, page.value * PAGE_SIZE));
const searching = computed(() => search.value.trim() !== "");

watch(search, () => { page.value = 1; });
watch(pages, (count) => { if (page.value > count) page.value = count; });

const NODE_COLUMNS: Array<{ key: NodeSortKey | ""; label: string; name?: boolean }> = [
  { key: "node", label: "Node", name: true },
  { key: "address", label: "Address" },
  { key: "", label: "Public key" },
  { key: "endpoint", label: "Endpoint" },
  { key: "configuration", label: "Configuration" },
  { key: "status", label: "Agent" },
];
const COLUMN_COUNT = NODE_COLUMNS.length + 1;

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

// ── row vocabulary ───────────────────────────────────────────────────────
function configTone(node: WireGuardNode): StateTone {
  return node.configuration === "ready" ? "healthy" : node.configuration === "partial" ? "warning" : "neutral";
}

/** The agent's state as the quiet dot at the name baseline; the evidence is the last report. */
function agentStatus(node: WireGuardNode): NameStatus {
  const state = agentState(node);
  const tone: StateTone = state === "disabled" ? "neutral" : state === "online" ? "healthy" : "warning";
  return { tone, label: state, title: `${state}, last seen ${formatDate(node.last_seen)}` };
}

function planTitle(node: WireGuardNode): string {
  return readinessGap(node) !== "ready" ? readinessGapLabel(readinessGap(node)) : "Create configuration plan";
}

async function call<T>(method: string, payload: unknown = {}): Promise<T> {
  if (!bridge || !canCall(init.value, SERVICE, method)) {
    throw new Error(`This session cannot run ${method} on WireGuard, so nothing was sent to any node.`);
  }
  return bridge.call<T>(SERVICE, method, payload).promise;
}

async function refresh(): Promise<void> {
  if (!init.value) return;
  const firstRead = observedAt.value === undefined;
  const landed = await readFleet();
  // A link that names a node (`?expand=`) lands on the page that holds it.
  const [linked] = expanded.own.value;
  if (landed && firstRead && linked) page.value = pageOf(sortedNodes.value.findIndex((node) => node.node_id === linked));
  await resize();
}

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
    // Close the form and let its focus return to the Plan button settle before
    // the review opens, so the review takes focus from that button and hands
    // it back there on close. Swapping both in one tick would leave focus on
    // the button behind the review's scrim.
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

function formatDate(value?: string): string {
  if (!value) return "not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not reported";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function resize(): Promise<void> { await nextTick(); bridge?.resize(document.documentElement.scrollHeight); }

// One document handler closes the top of the overlay stack on Escape; the
// modals register themselves while open.
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
  bridge?.dispose();
});
</script>

<template>
  <PcWorkspace>
    <PcPageHeader
      title="WireGuard Networks"
      badge="WireGuard plugin"
      description="Mesh readiness across the fleet. A configuration plan reaches a node only after you approve it, and no private key passes through this page."
      :icon="Spline"
    >
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

    <PcNotice tone="info" title="Private keys never leave their nodes">
      <template #icon><ShieldCheck :size="19" aria-hidden="true" /></template>
      Plans contain <code>{{ PRIVATE_KEY_PLACEHOLDER }}</code>. The agent substitutes its local key during an approved apply, under rollback watchdog and control-plane self-check.
    </PcNotice>

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
      <PcSkeleton variant="strip" :count="4" label="Loading mesh summary" />
      <PcPanel>
        <PcSkeleton :count="8" label="Loading WireGuard state" />
      </PcPanel>
    </template>

    <!-- Only a read that landed reaches this block. -->
    <template v-else>
      <PcStatStrip :count="4" label="Mesh summary">
        <PcStatCard
          label="Ready nodes"
          :value="`${readiness.ready} / ${readiness.total}`"
          :note="`${readiness.total - readiness.ready} still missing an address or a key`"
          :tone="readiness.total && !readiness.ready ? 'warning' : undefined"
        />
        <PcStatCard label="Online mesh" :value="readiness.onlineReady" note="Ready, agent online, not disabled" />
        <PcStatCard label="Public endpoints" :value="readiness.endpoints" note="Reachable from outside the mesh" />
        <PcStatCard label="Partial setup" :value="readiness.needsKey + readiness.needsAddress" note="One half of the pair reported" />
      </PcStatStrip>

      <PcToolbar label="Fleet toolbar">
        <template #tabs>
          <PcLensTabs :model-value="lens" label="WireGuard lens" @update:model-value="setLens">
            <PcLensTab value="fleet" label="Fleet" :count="readiness.total" />
            <PcLensTab value="mesh" label="Mesh" :count="readyNodes.length" />
          </PcLensTabs>
        </template>
        <template v-if="lens === 'fleet'" #search>
          <PcSearchField v-model="search" label="Search fleet" placeholder="Search node, address, endpoint or key" />
        </template>
        <template v-if="lens === 'fleet' && searching" #note>{{ visibleNodes.length }} of {{ readiness.total }} nodes match</template>
      </PcToolbar>

      <PcPanel v-if="lens === 'fleet'" id="pc-panel-fleet" role="tabpanel" aria-labelledby="pc-tab-fleet">
        <PcPanelHeader title="Fleet nodes" description="A node joins the mesh once the control plane holds both its WireGuard address and its public key. Open a node for its interface facts and the peers this session can see for it.">
          <PcCount :value="`${readiness.total} nodes · ${readyNodes.length} mesh-ready`" />
        </PcPanelHeader>

        <template v-if="visibleNodes.length">
          <PcTable :min-width="1000" label="Fleet nodes">
            <template #head>
              <PcTh
                v-for="column in NODE_COLUMNS"
                :key="column.label"
                :name="column.name"
                :sortable="!!column.key"
                :sort="ariaSort(column.key)"
                @sort="column.key && toggleSort(column.key)"
              >{{ column.label }}</PcTh>
              <PcTh actions>Actions</PcTh>
            </template>
            <tbody v-for="node in pagedNodes" :key="node.node_id">
              <PcRow :id="`node-${node.node_id}`" :open="expanded.isOpen(node.node_id)">
                <PcNameCell
                  :name="displayName(node)"
                  :id="node.node_id"
                  :expanded="expanded.isOpen(node.node_id)"
                  :controls="`node-${node.node_id}-detail`"
                  :status="agentStatus(node)"
                  @toggle="toggleNode(node.node_id)"
                >
                  <template #status><PcStatePill :tone="configTone(node)" :label="node.configuration" :title="readinessGapLabel(readinessGap(node))" /></template>
                </PcNameCell>
                <PcTd label="Address" mono :title="node.address ? `reported ${node.address}, pinned into peer AllowedIPs as ${hostRoute(node.address)}` : 'no address reported'">{{ node.address || 'not reported' }}</PcTd>
                <PcTd label="Public key" mono :title="node.public_key ? 'Public key, shown truncated' : 'The agent has not reported a public key'">{{ redactedKey(node.public_key) }}</PcTd>
                <PcTd label="Endpoint" mono :title="node.endpoint || 'No public endpoint reported, so peers cannot dial in to this node'">{{ node.endpoint || 'not reported' }}</PcTd>
                <PcTd label="Configuration" stack="state">
                  <PcStatePill :tone="configTone(node)" :label="node.configuration" :title="readinessGapLabel(readinessGap(node))" />
                  <small v-if="readinessGap(node) !== 'ready'" :title="readinessGapLabel(readinessGap(node))">{{ readinessGapLabel(readinessGap(node)) }}</small>
                </PcTd>
                <PcTd label="Agent" mono :title="`${agentStatus(node).label}, last seen ${formatDate(node.last_seen)}`">{{ formatDate(node.last_seen) }}</PcTd>
                <PcActionsCell>
                  <PcButton v-if="canPlan" compact :disabled="readinessGap(node) !== 'ready'" :title="planTitle(node)" @click="openPlan(node)">
                    <template #icon><FileCode2 :size="13" aria-hidden="true" /></template>
                    Plan
                  </PcButton>
                </PcActionsCell>
              </PcRow>

              <template v-if="expanded.isOpen(node.node_id)">
                <PcDetailRow :id="`node-${node.node_id}-detail`" :colspan="COLUMN_COUNT">
                  <div class="node-detail">
                    <section>
                      <h3>Interface as reported</h3>
                      <dl class="facts">
                        <!-- The reported address, verbatim. The prefix the interface is
                             actually given is assigned by the control plane, so printing a
                             host route under an "Address" label would be a guess wearing a
                             fact's clothes. -->
                        <dt>Reported address</dt><dd :title="node.address || 'not reported'">{{ node.address || 'not reported' }}</dd>
                        <dt>AllowedIPs on every peer</dt><dd :title="hostRoute(node.address) || 'not reported'">{{ hostRoute(node.address) || 'not reported' }}</dd>
                        <dt>Listen port</dt><dd>{{ node.listen_port || 51820 }}</dd>
                        <dt>Public key</dt><dd :title="redactedKey(node.public_key)">{{ redactedKey(node.public_key) }}</dd>
                        <dt>Endpoint</dt><dd :title="node.endpoint || 'not reported'">{{ node.endpoint || 'not reported' }}</dd>
                        <dt>Last seen</dt><dd :title="formatDate(node.last_seen)">{{ formatDate(node.last_seen) }}</dd>
                        <dt>Key source</dt><dd>node-local file</dd>
                        <template v-if="readinessGap(node) !== 'ready'"><dt>Mesh readiness</dt><dd :title="readinessGapLabel(readinessGap(node))">{{ readinessGapLabel(readinessGap(node)) }}</dd></template>
                      </dl>
                    </section>
                    <!-- This block used to draw a wg0.conf. It was not the wg0.conf that
                         gets applied: the control plane renders the real one and assigns
                         the interface a wider prefix than the host route shown here, plus
                         a keepalive this plugin never sees. Reviewing one document and
                         approving another is the defect, so the drawing is gone. What is
                         left is only what the overview call actually returned. -->
                    <section class="detail-caveat">
                      <h3>Mesh membership</h3>
                      <p v-if="meshPeersFor(node, nodes).length">
                        <strong>{{ meshPeersFor(node, nodes).length }} visible {{ meshPeersFor(node, nodes).length === 1 ? 'peer' : 'peers' }}</strong>
                        The rows below are the peers this session can see for {{ displayName(node) }}, not the applied configuration.
                      </p>
                      <p v-else-if="readinessGap(node) !== 'ready'"><strong>No peers to list</strong>{{ displayName(node) }} is not mesh-ready itself. {{ readinessGapLabel(readinessGap(node)) }}.</p>
                      <p v-else><strong>No peers to list</strong>No other node is mesh-ready, so this node would be given a mesh with no peers in it.</p>
                      <p><strong>The applied configuration is rendered by the control plane, not here.</strong>It is shown in full on the approval, before anything reaches a node. This page cannot show:</p>
                      <ul>
                        <li v-for="item in PLAN_UNKNOWNS" :key="item">{{ item }}</li>
                      </ul>
                    </section>
                  </div>
                </PcDetailRow>
                <!-- Peers are part of the open node's fold: they take the open
                     surface with the row and its detail, so the block reads as
                     one attached unit against the plain rows of other nodes,
                     and each id line leads with the owner's name. -->
                <PcRow v-for="peer in meshPeersFor(node, nodes)" :key="`${node.node_id}-${peer.node_id}`" class="peer-row">
                  <PcNameCell :name="displayName(peer)" :sub="peerSubline(node, peer)" :level="1" :status="agentStatus(peer)">
                    <template #after><PcKindChip label="peer" :title="`A mesh peer of ${displayName(node)}`" /></template>
                  </PcNameCell>
                  <PcTd label="Address" mono :title="`${peer.address} pinned into AllowedIPs as ${hostRoute(peer.address)}`">{{ hostRoute(peer.address) }}</PcTd>
                  <PcTd label="Public key" mono title="Public key, shown truncated">{{ redactedKey(peer.public_key) }}</PcTd>
                  <PcTd label="Endpoint" mono :title="peer.endpoint || 'dial-out only, no public endpoint'">{{ peer.endpoint || 'dial-out only' }}</PcTd>
                  <PcTd label="Configuration" stack="state"><PcStatePill tone="healthy" label="ready" title="Address and public key both reported" /></PcTd>
                  <PcTd label="Agent" mono :title="`${agentStatus(peer).label}, last seen ${formatDate(peer.last_seen)}`">{{ formatDate(peer.last_seen) }}</PcTd>
                  <PcActionsCell />
                </PcRow>
              </template>
            </tbody>
          </PcTable>
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

        <PcEmptyState v-else-if="searching" kind="no-match" title="No node matches that search" :icon="Network">
          <p>Nothing in {{ readiness.total }} nodes matches <span class="pc-mono">{{ search.trim() }}</span>. The search covers node name and id, address, endpoint and public key.</p>
          <template #actions><PcButton @click="search = ''">Clear the search</PcButton></template>
        </PcEmptyState>

        <!-- A read that landed with no nodes; a failed read holds the error block above instead. -->
        <PcEmptyState v-else title="No visible nodes" :icon="Network">
          <p>WireGuard metadata appears after agents report their node state. If the fleet has nodes and none is listed here, this session may not be allowed to read them.</p>
        </PcEmptyState>
      </PcPanel>

      <PcPanel v-else id="pc-panel-mesh" role="tabpanel" aria-labelledby="pc-tab-mesh">
        <PcPanelHeader title="Full-mesh readiness" description="Every mesh-ready node gets a host route to each of the others. Pick a node to open it in the fleet list with its peers folded beneath.">
          <PcCount :value="`${readyNodes.length} mesh-ready`" />
        </PcPanelHeader>
        <div v-if="readyNodes.length" class="mesh">
          <div class="mesh-core">
            <Spline :size="23" aria-hidden="true" />
            <strong>{{ readyNodes.length }} mesh-ready nodes</strong>
            <span>{{ peerCount }} peer blocks in each config</span>
          </div>
          <button
            v-for="node in readyNodes"
            :key="node.node_id"
            type="button"
            class="mesh-peer"
            :title="meshTileTitle(node)"
            @click="showNode(node.node_id)"
          >
            <strong>{{ displayName(node) }}</strong>
            <small>{{ node.address }}</small>
            <PcStateDot :tone="agentStatus(node).tone" :label="agentStatus(node).label" :title="agentStatus(node).title" />
          </button>
        </div>

        <!-- The live state on this fleet. A zero here is not an error, it is a
             fleet whose agents have not reported the two fields a mesh needs,
             so the panel counts which field is missing where. -->
        <PcEmptyState v-else title="No node is mesh-ready" :icon="Spline">
          <p v-if="!readiness.total">No node reports WireGuard metadata at all. Nodes appear here once their agent has checked in.</p>
          <template v-else>
            <p>A node becomes mesh-ready when the control plane holds both a WireGuard address and the public key its agent reported. Both arrive from the node's own agent report, so a node stays out of the mesh until it has a WireGuard interface configured on the host.</p>
            <ul class="readiness-breakdown">
              <li><strong>{{ readiness.needsBoth }}</strong> report neither</li>
              <li><strong>{{ readiness.needsKey }}</strong> have an address, no key</li>
              <li><strong>{{ readiness.needsAddress }}</strong> have a key, no address</li>
              <li v-if="readiness.disabled"><strong>{{ readiness.disabled }}</strong> disabled</li>
            </ul>
            <p>The fleet lens lists every node and what it is missing.</p>
          </template>
          <template #actions><PcButton @click="setLens('fleet')">Open the fleet lens</PcButton></template>
        </PcEmptyState>
      </PcPanel>
    </template>

    <PcModal :open="!!planNode" title="Create mesh configuration plan" :description="planNode ? displayName(planNode) : ''" @close="planNode = undefined">
      <form v-if="planNode" id="plan-form" class="plan-form" @submit.prevent="createPlan">
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
