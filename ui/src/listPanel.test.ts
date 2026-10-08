// @vitest-environment jsdom
/**
 * The Fleet and Mesh panels while the query does not read, on the mounted
 * page. App.vue runs in a DOM with fake timers against a stand-in host that
 * speaks the bridge protocol, as in appReads.test.ts, and the operator types
 * into the real query field.
 *
 * Over rows the panel is dimmed and inert: those rows answer a query nobody
 * can see. Over the no-match state it stays live, because its one action is
 * Clear the query and an inert panel leaves that button dead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type App as VueApp } from "vue";

import App from "./App.vue";

const HOST = "http://console.test";
const NONCE = "wireguard-list-panel-test-nonce";
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
    {
      node_id: "node_cd-oracle-sel",
      name: "cd-oracle-sel",
      address: "10.88.0.3",
      public_key: "Pq4Wm8Zt1Yx6Vb3Nc0Lk7Jh2Gf5Ds9Ae4Rt8Yu1Io6=",
      online: true,
      last_seen: "2026-09-30T09:59:40Z",
      configuration: "ready",
    },
  ],
};

/** Not a field: an error that is not still being typed, so it shows once the typing pauses. */
const INVALID = "stauts:offline";
/** Reads, and keeps no node. */
const NOTHING = "zzz-no-such-node";

let app: VueApp | undefined;

function fromHost(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data: { nonce: NONCE, ...data }, origin: HOST, source: window }));
}

/** Lets the handshake and the read chain through their promises. */
async function settle(): Promise<void> {
  for (let round = 0; round < 20; round++) await vi.advanceTimersByTimeAsync(1);
}

async function open(view: "fleet" | "mesh"): Promise<void> {
  vi.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
    const data = message as { type?: string; id?: string; method?: string };
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
          pageState: { view },
        }),
      );
    }
    if (data.type === "lattice.plugin.call") {
      const result = data.method === "overview" ? overview : undefined;
      queueMicrotask(() => fromHost({ type: "lattice.host.result", id: data.id, result }));
    }
  });
  const root = document.createElement("div");
  document.body.append(root);
  app = createApp(App);
  app.mount(root);
  await settle();
}

function field(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[role="combobox"]');
  expect(input).not.toBeNull();
  return input!;
}

/** Types the whole text, then waits out the pause after which an error shows (and a valid query settles). */
async function type(text: string): Promise<void> {
  const input = field();
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(1_000);
  await settle();
}

function panel(view: "fleet" | "mesh"): HTMLElement {
  const element = document.getElementById(`pc-panel-${view}`);
  expect(element).not.toBeNull();
  return element!;
}

function clearButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Clear the query");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
  window.location.hash = `#lattice_nonce=${NONCE}&host_origin=${encodeURIComponent(HOST)}`;
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each([
  { view: "fleet" as const, rows: ["cd-build-1", "metix-dmit-1", "cd-oracle-sel"] },
  { view: "mesh" as const, rows: ["metix-dmit-1", "cd-oracle-sel"] },
])("the $view panel while the query does not read", ({ view, rows }) => {
  it("dims the rows of the last query that read and takes them out of reach", async () => {
    await open(view);
    await type(INVALID);

    const shown = panel(view);
    expect(shown.getAttribute("data-stale")).toBe("true");
    expect(shown.hasAttribute("inert")).toBe(true);
    for (const name of rows) expect(shown.textContent).toContain(name);
    expect(clearButton()).toBeUndefined();
  });

  it("keeps the no-match state live, so Clear the query brings every row back", async () => {
    await open(view);
    await type(NOTHING);
    expect(clearButton()).toBeDefined();

    await type(`${NOTHING} ${INVALID}`);
    const shown = panel(view);
    expect(shown.hasAttribute("data-stale")).toBe(false);
    expect(shown.hasAttribute("inert")).toBe(false);
    const clear = clearButton();
    expect(clear?.closest("[inert]")).toBeNull();

    clear!.click();
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(field().value).toBe("");
    expect(clearButton()).toBeUndefined();
    for (const name of rows) expect(panel(view).textContent).toContain(name);
  });
});
