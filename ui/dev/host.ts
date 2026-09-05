/**
 * A stand-in for the dashboard host, for looking at the plugin in a browser.
 *
 * This is deliberately not a mock of the UI: it runs the real plugin build in a
 * real iframe and speaks the real bridge protocol at it. The frame is sized
 * the way the console sizes it, to fill the main region, so the frame IS a
 * viewport: the plugin's document scrolls inside it, its sticky table header
 * pins to the top of what is visible, and an overlay centres on what the
 * operator can see. The height the plugin reports is shown in the bar and
 * otherwise ignored, which is what the console does too.
 *
 * Tokens: the console publishes 42 custom properties on init and on every
 * theme change. The chassis stylesheet declares the same 42 names as fallbacks
 * with the console's own values for both schemes, so the harness sends the
 * scheme and an empty token map and renders what the console renders. A host
 * with a different palette would overwrite the fallbacks inline on <html>.
 *
 * "refuse calls" turns every answer into a host error without reloading the
 * frame, so a poll or a retry that fails after a good read can be watched with
 * the rows still standing. The "failing" scenario is the other case: nothing
 * ever lands, from the first read on.
 */

import { handlers, type Scenario } from "./fixtures";

const ROUTES = ["networks"] as const;
type Route = (typeof ROUTES)[number];

const PLUGIN_ID = "latticenet.wireguard";
const NONCE = "dev-harness-nonce-000000";

const INTERFACES = [
  { service: "latticenet.wireguard/networks", methods: ["overview", "plan"] },
];

const params = new URLSearchParams(location.search);
let route = (params.get("route") ?? "networks") as Route;
let scenario = (params.get("scenario") ?? "production") as Scenario;
let dark = params.get("theme") !== "light";
let width = params.get("width") ?? "1440";
let refuse = params.get("refuse") === "1";
/** The console's main region height: the frame fills it and scrolls inside. */
let windowHeight = Number(params.get("frame") ?? 900);
/** Anything after `#` on the plugin URL besides the handshake, e.g. `lens=mesh&expand=node-x`. */
const pluginQuery = params.get("q") ?? "";

const shell = document.createElement("div");
shell.className = "harness";
shell.innerHTML = `
  <div class="bar">
    <strong>wireguard dev harness</strong>
    <label hidden>route <select id="route">${ROUTES.map((value) => `<option${value === route ? " selected" : ""}>${value}</option>`).join("")}</select></label>
    <label>data <select id="scenario">${["production", "rich", "empty", "failing"].map((value) => `<option${value === scenario ? " selected" : ""}>${value}</option>`).join("")}</select></label>
    <label>width <select id="width">${["1440", "2423", "375"].map((value) => `<option${value === width ? " selected" : ""}>${value}</option>`).join("")}</select></label>
    <label><input id="refuse" type="checkbox"${refuse ? " checked" : ""}> refuse calls</label>
    <button id="theme" type="button">${dark ? "light" : "dark"}</button>
    <span id="reported"></span>
  </div>
  <div class="viewport" id="viewport">
    <div class="frame-wrap" id="wrap"><iframe id="frame" title="plugin"></iframe></div>
  </div>`;
document.body.append(shell);

const frame = document.getElementById("frame") as HTMLIFrameElement;
const wrap = document.getElementById("wrap") as HTMLDivElement;
const viewport = document.getElementById("viewport") as HTMLDivElement;
const reported = document.getElementById("reported") as HTMLSpanElement;

function applyChrome(): void {
  wrap.style.width = `${width}px`;
  viewport.style.height = `${windowHeight}px`;
  frame.style.height = `${windowHeight}px`;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  (document.getElementById("theme") as HTMLButtonElement).textContent = dark ? "light" : "dark";
}

/** The address bar carries every control, so a reload or a pasted URL reproduces the same state. */
function syncQuery(): void {
  const query = new URLSearchParams({ route, scenario, theme: dark ? "dark" : "light", width, frame: String(windowHeight) });
  if (refuse) query.set("refuse", "1");
  if (pluginQuery) query.set("q", pluginQuery);
  history.replaceState(null, "", `?${query}`);
}

function reload(): void {
  syncQuery();
  applyChrome();
  frame.src = `/index.html${pluginQuery ? `?${pluginQuery}` : ""}#lattice_nonce=${NONCE}&host_origin=${encodeURIComponent(location.origin)}`;
}

function post(message: Record<string, unknown>): void {
  frame.contentWindow?.postMessage({ nonce: NONCE, ...message }, location.origin);
}

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const data = event.data as Record<string, any>;
  if (!data || data.nonce !== NONCE) return;
  switch (data.type) {
    case "lattice.plugin.ready":
      post({
        type: "lattice.host.init", version: "1", pluginId: PLUGIN_ID,
        pluginVersion: "0.0.0-dev", pluginRoute: route, locale: "en",
        colorScheme: dark ? "dark" : "light", designTokens: {}, interfaces: INTERFACES,
      });
      return;
    case "lattice.plugin.resize": {
      const height = Math.max(120, Number(data.height) || 0);
      reported.textContent = `plugin reports ${height}px; frame held at ${windowHeight}px`;
      return;
    }
    case "lattice.plugin.call": {
      const table = handlers(scenario);
      const key = `${String(data.service).split("/").pop()}/${data.method}`;
      const handler = table[key];
      // Decided when the call arrives: a call made while refusing is refused
      // even if the box is unticked before the answer goes out.
      const refused = scenario === "failing" || refuse;
      // Latency, so loading and skeleton states are visible rather than theoretical.
      window.setTimeout(() => {
        if (refused) {
          post({ type: "lattice.host.error", id: data.id, message: `upstream refused ${key}: 503 service unavailable` });
          return;
        }
        if (!handler) {
          post({ type: "lattice.host.error", id: data.id, message: `the dev harness has no answer for ${key}` });
          return;
        }
        try {
          post({ type: "lattice.host.result", id: data.id, result: handler((data.payload ?? {}) as any) });
        } catch (cause) {
          post({ type: "lattice.host.error", id: data.id, message: cause instanceof Error ? cause.message : String(cause) });
        }
      }, 320);
    }
  }
});

document.getElementById("route")!.addEventListener("change", (event) => {
  route = (event.target as HTMLSelectElement).value as Route;
  reload();
});
document.getElementById("scenario")!.addEventListener("change", (event) => {
  scenario = (event.target as HTMLSelectElement).value as Scenario;
  reload();
});
document.getElementById("width")!.addEventListener("change", (event) => {
  width = (event.target as HTMLSelectElement).value;
  reload();
});
document.getElementById("refuse")!.addEventListener("change", (event) => {
  refuse = (event.target as HTMLInputElement).checked;
  syncQuery();
});
document.getElementById("theme")!.addEventListener("click", () => {
  dark = !dark;
  applyChrome();
  post({ type: "lattice.host.theme", colorScheme: dark ? "dark" : "light", designTokens: {} });
});

reload();
