import { computed, ref, type ComputedRef, type Ref } from "vue";

import { safeErrorMessage, type WireGuardNode } from "./wireguardModel";

/**
 * The fleet read as a state the page draws from: the last list that landed,
 * when it landed, why the newest read failed, and whether a read is in flight.
 *
 * The rule is that a failed read never replaces a good one. The rows come
 * only from a read that landed, the error names only the newest failure, and
 * neither is cleared when a retry starts: the read that settles the question
 * clears them. Clearing the error at the start of a retry is what produced a
 * false empty fleet, because for as long as the retry was in flight the page
 * had no error and no rows, and a page in that state can only draw "no
 * nodes". Here the only way to reach the empty fleet is a read that landed
 * empty. DOM-free, so the tests run without jsdom.
 */
export interface FleetRead {
  /** The last read that landed. Empty until one has; a failed read never touches it. */
  nodes: Ref<WireGuardNode[]>;
  /** When the last good read landed. Absent until one has. */
  observedAt: Ref<Date | undefined>;
  /** Why the newest read failed. Cleared by the next read that lands, or by the operator. */
  error: Ref<string>;
  /** Nothing has landed and nothing has failed: the skeleton is the only honest picture. */
  loading: ComputedRef<boolean>;
  /** A read is in flight behind rows or a failure that stay standing until it settles. */
  refreshing: ComputedRef<boolean>;
  /** Run a read, or join the one already in flight. Resolves true when the read landed. */
  refresh(): Promise<boolean>;
}

/** Shown when the read failed without naming a reason. */
export const READ_FAILED = "The overview request did not come back, so anything listed below is from an earlier refresh.";

export function useFleetRead(read: () => Promise<WireGuardNode[]>): FleetRead {
  const nodes = ref<WireGuardNode[]>([]);
  const observedAt = ref<Date>();
  const error = ref("");
  const inFlight = ref(false);
  let pending: Promise<boolean> | undefined;

  const loading = computed(() => observedAt.value === undefined && !error.value);
  const refreshing = computed(() => inFlight.value && !loading.value);

  async function run(): Promise<boolean> {
    inFlight.value = true;
    try {
      nodes.value = await read();
      observedAt.value = new Date();
      error.value = "";
      return true;
    } catch (cause) {
      error.value = safeErrorMessage(cause, READ_FAILED);
      return false;
    } finally {
      inFlight.value = false;
      pending = undefined;
    }
  }

  function refresh(): Promise<boolean> {
    // Two reads in flight could settle out of order and let an older failure
    // stand over a newer list, so a refresh asked for mid-read joins the read
    // in flight instead of starting another.
    pending ??= run();
    return pending;
  }

  return { nodes, observedAt, error, loading, refreshing, refresh };
}
