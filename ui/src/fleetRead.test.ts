import { describe, expect, it } from "vitest";

import { READ_FAILED, useFleetRead, type FleetRead } from "./fleetRead";
import { fleetNotice } from "./fleetView";
import type { WireGuardNode } from "./wireguardModel";

function node(id: string): WireGuardNode {
  return { node_id: id, name: id, online: true, configuration: "missing" };
}

const ROWS = [node("node-hkg-edge-01"), node("node-sin-edge-01")];

interface Settler {
  resolve: (nodes: WireGuardNode[]) => void;
  reject: (cause: unknown) => void;
}

/** A read the test settles by hand, so the in-flight window is observable. */
function pendingRead(): { fleet: FleetRead; settlers: Settler[] } {
  const settlers: Settler[] = [];
  const fleet = useFleetRead(
    () => new Promise<WireGuardNode[]>((resolve, reject) => { settlers.push({ resolve, reject }); }),
  );
  return { fleet, settlers };
}

/** The page's empty fleet: nothing loading, nothing failed, no rows. */
function emptyFleet(fleet: FleetRead): boolean {
  return !fleet.loading.value && !fleet.error.value && fleet.nodes.value.length === 0;
}

/** The page-level notice as App.vue derives it, with no boot failure. */
function notice(fleet: FleetRead) {
  return fleetNotice({ bootError: "", error: fleet.error.value, loaded: fleet.nodes.value.length });
}

async function settled(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
}

describe("useFleetRead", () => {
  it("starts loading, with nothing behind the skeleton", () => {
    const { fleet } = pendingRead();
    expect(fleet.loading.value).toBe(true);
    expect(fleet.refreshing.value).toBe(false);
    expect(fleet.nodes.value).toEqual([]);
    expect(fleet.observedAt.value).toBeUndefined();
    expect(emptyFleet(fleet)).toBe(false);
  });

  it("a read that lands fills the rows and marks the time", async () => {
    const { fleet, settlers } = pendingRead();
    const outcome = fleet.refresh();
    expect(fleet.loading.value).toBe(true);
    settlers[0].resolve(ROWS);
    await expect(outcome).resolves.toBe(true);
    expect(fleet.nodes.value).toEqual(ROWS);
    expect(fleet.observedAt.value).toBeInstanceOf(Date);
    expect(fleet.loading.value).toBe(false);
    expect(fleet.refreshing.value).toBe(false);
    expect(notice(fleet)).toBeUndefined();
  });

  it("an error after a good read keeps the rows and warns that they are the last good read", async () => {
    const { fleet, settlers } = pendingRead();
    const first = fleet.refresh();
    settlers[0].resolve(ROWS);
    await first;
    const observed = fleet.observedAt.value;

    const retry = fleet.refresh();
    expect(fleet.refreshing.value).toBe(true);
    expect(fleet.nodes.value).toEqual(ROWS);
    settlers[1].reject(new Error("upstream refused networks/overview: 503 service unavailable"));
    await expect(retry).resolves.toBe(false);

    expect(fleet.nodes.value).toEqual(ROWS);
    expect(fleet.observedAt.value).toBe(observed);
    expect(fleet.error.value).toBe("upstream refused networks/overview: 503 service unavailable");
    expect(fleet.loading.value).toBe(false);
    expect(fleet.refreshing.value).toBe(false);
    expect(emptyFleet(fleet)).toBe(false);
    expect(notice(fleet)).toEqual({ tone: "warning", title: "The fleet below is the last good read, not the current one", dismissible: true });
  });

  it("Try again after a failed first read retries without clearing the failure", async () => {
    const { fleet, settlers } = pendingRead();
    const first = fleet.refresh();
    settlers[0].reject(new Error("upstream refused networks/overview: 503 service unavailable"));
    await first;
    expect(fleet.loading.value).toBe(false);
    expect(notice(fleet)).toEqual({ tone: "danger", title: "The fleet could not be refreshed", dismissible: false });

    const retry = fleet.refresh();
    // The in-flight window: the failure still stands, the retry is visibly
    // busy, and the page never drops into an empty fleet it has not read.
    expect(fleet.error.value).toBe("upstream refused networks/overview: 503 service unavailable");
    expect(fleet.refreshing.value).toBe(true);
    expect(fleet.loading.value).toBe(false);
    expect(emptyFleet(fleet)).toBe(false);

    settlers[1].resolve(ROWS);
    await expect(retry).resolves.toBe(true);
    expect(fleet.error.value).toBe("");
    expect(fleet.nodes.value).toEqual(ROWS);
    expect(fleet.refreshing.value).toBe(false);
  });

  it("a successful empty read is the only path to the empty fleet", async () => {
    const { fleet, settlers } = pendingRead();
    const first = fleet.refresh();
    settlers[0].reject(new Error("no answer"));
    await first;
    expect(emptyFleet(fleet)).toBe(false);

    const retry = fleet.refresh();
    expect(emptyFleet(fleet)).toBe(false);
    settlers[1].resolve([]);
    await expect(retry).resolves.toBe(true);

    expect(emptyFleet(fleet)).toBe(true);
    expect(fleet.observedAt.value).toBeInstanceOf(Date);
    expect(notice(fleet)).toBeUndefined();
  });

  it("a background poll that fails keeps the rows, and the next poll that lands clears the warning", async () => {
    const { fleet, settlers } = pendingRead();
    const first = fleet.refresh();
    settlers[0].resolve(ROWS);
    await first;

    // The 20-second poller calls refresh() exactly as Try again does, and the
    // poll only runs while the page is not loading, as on the page.
    const outcomes: boolean[] = [];
    for (const answer of ["fail", "fail", "land"] as const) {
      expect(fleet.loading.value).toBe(false);
      const poll = fleet.refresh();
      expect(fleet.nodes.value).toEqual(ROWS);
      const settler = settlers[settlers.length - 1];
      if (answer === "fail") settler.reject(new Error("upstream refused networks/overview: 503 service unavailable"));
      else settler.resolve([ROWS[0]]);
      outcomes.push(await poll);
      expect(fleet.nodes.value.length).toBeGreaterThan(0);
      expect(emptyFleet(fleet)).toBe(false);
    }

    expect(outcomes).toEqual([false, false, true]);
    expect(fleet.nodes.value).toEqual([ROWS[0]]);
    expect(fleet.error.value).toBe("");
    expect(notice(fleet)).toBeUndefined();
  });

  it("a refresh asked for mid-read joins the read in flight", async () => {
    const { fleet, settlers } = pendingRead();
    const first = fleet.refresh();
    const second = fleet.refresh();
    expect(second).toBe(first);
    expect(settlers).toHaveLength(1);
    settlers[0].resolve(ROWS);
    await expect(second).resolves.toBe(true);
    await settled();

    // Once settled, the next refresh is a new read.
    void fleet.refresh();
    expect(settlers).toHaveLength(2);
  });

  it("names the failure, and falls back to the stale-read line when the cause is silent", async () => {
    const { fleet, settlers } = pendingRead();
    const first = fleet.refresh();
    settlers[0].reject(new Error(""));
    await first;
    expect(fleet.error.value).toBe(READ_FAILED);

    const retry = fleet.refresh();
    settlers[1].reject("the session expired");
    await retry;
    expect(fleet.error.value).toBe("the session expired");
  });
});
