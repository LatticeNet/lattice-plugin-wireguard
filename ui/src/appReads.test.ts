// @vitest-environment jsdom
/**
 * When the mounted page reads, measured on the page itself. App.vue runs in
 * a DOM with fake timers against a stand-in host that speaks the bridge
 * protocol, and the test counts what reaches the host. It holds however a
 * poll or a height report would be written (setInterval under another name,
 * a recursive setTimeout, a helper around either), where sourcePolicy.test.ts
 * can only look for the text of one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App as VueApp } from "vue";

import App from "./App.vue";

const HOST = "http://console.test";
const NONCE = "wireguard-reads-test-nonce";
const SERVICE = "latticenet.wireguard/networks";

const overview = {
  nodes: [
    { node_id: "node_cd-build-1", name: "cd-build-1", online: true, last_seen: "2026-09-30T09:59:50Z", configuration: "missing" },
    {
      node_id: "node_metix-dmit-1",
      name: "metix-dmit-1",
      address: "10.88.0.2",
      public_key: "k2Lr0x0Gq8Yt3mXh1vS9n4Pw7cE5aB6dF2gH0jK1lM8=",
      listen_port: 51820,
      online: true,
      last_seen: "2026-09-30T09:59:55Z",
      configuration: "ready",
    },
  ],
};

let calls: string[] = [];
/** The type of every message the page posted to the host. */
let posted: string[] = [];
let app: VueApp | undefined;

function fromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data: { nonce: NONCE, ...data }, origin: HOST, source: window }));
}

function tally(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const method of calls) counts[method] = (counts[method] ?? 0) + 1;
  return counts;
}

/** Lets the handshake and the read chain through their promises. */
async function settle(): Promise<void> {
  for (let round = 0; round < 20; round++) await vi.advanceTimersByTimeAsync(1);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  window.location.hash = `#lattice_nonce=${NONCE}&host_origin=${encodeURIComponent(HOST)}`;
  calls = [];
  posted = [];
  // The frame's parent is the window itself in this DOM, so the page's
  // messages to the host arrive here.
  vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
    const data = message as { type?: string; id?: string; method?: string };
    posted.push(data.type ?? "");
    if (data.type === "lattice.plugin.ready") {
      queueMicrotask(() =>
        fromHost({
          type: "lattice.host.init",
          version: "1",
          pluginId: "latticenet.wireguard",
          pluginVersion: "0.0.0-test",
          pluginRoute: "networks",
          locale: "en",
          colorScheme: "dark",
          designTokens: {},
          interfaces: [{ service: SERVICE, methods: ["overview", "plan"] }],
          pageState: {},
        }),
      );
    }
    if (data.type === "lattice.plugin.call") {
      calls.push(data.method ?? "");
      const result = data.method === "overview" ? overview : undefined;
      queueMicrotask(() => fromHost({ type: "lattice.host.result", id: data.id, result }));
    }
  });
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp(App);
  app.mount(root);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the mounted page's reads", () => {
  it("reads once on open, nothing more on its own, and again on Refresh, and never reports a height", async () => {
    await settle();
    expect(tally()).toEqual({ overview: 1 });
    expect(document.body.textContent).toContain("1 of 2");

    // The poll this page used to run fired every 20 seconds.
    await vi.advanceTimersByTimeAsync(65_000);
    expect(tally()).toEqual({ overview: 1 });

    const refresh = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Refresh");
    expect(refresh).toBeDefined();
    refresh!.click();
    await settle();
    expect(tally()).toEqual({ overview: 2 });
    expect(posted).not.toContain("lattice.plugin.resize");
  });
});
