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
 * Tokens: the harness sends the console's default theme (teal on slate,
 * lattice-dashboard src/style/app.css and src/theme/palettes.ts), the values
 * the vpn-core harness sends, so colours are judged on what production sends.
 * The chassis's own light fallback is the former indigo, which production
 * never shows.
 *
 * Page state: every query key that is not one of the harness's own is the
 * plugin's page state, sent as `pageState` in init, and a
 * `lattice.plugin.state` replaces those keys with a history replace, the way
 * the console keeps them in its address (design 22). `?view=fleet&open=<id>`
 * opens a node; a reload lands where the plugin was. `oldhost=1` plays a
 * console from before the contract. A `lattice:navigate` request is shown in
 * the bar rather than followed.
 *
 * "refuse calls" turns every answer into a host error without reloading the
 * frame, so a poll or a retry that fails after a good read can be watched with
 * the rows still standing. The "failing" scenario is the other case: nothing
 * ever lands, from the first read on.
 */

import { filterPageState, validPageState, type PageState } from "../src/pageState";
import { handlers, type Scenario } from "./fixtures";

const ROUTES = ["networks"] as const;
type Route = (typeof ROUTES)[number];

const PLUGIN_ID = "latticenet.wireguard";
const NONCE = "dev-harness-nonce-000000";

const INTERFACES = [
  { service: "latticenet.wireguard/networks", methods: ["overview", "plan"] },
];
/** What a session holding wireguard:read and nothing else is granted. */
const READ_ONLY_INTERFACES = [
  { service: "latticenet.wireguard/networks", methods: ["overview"] },
];

const DARK: Record<string, string> = {
  "--background": "oklch(0.155 0.012 240)", "--foreground": "oklch(0.97 0.004 240)", "--card": "oklch(0.195 0.014 240)",
  "--border": "oklch(1 0 0 / 9%)", "--muted": "oklch(0.255 0.014 240)", "--muted-foreground": "oklch(0.705 0.012 240)",
  "--primary": "oklch(0.81 0.13 180)", "--primary-foreground": "oklch(0.17 0.012 240)",
  "--destructive": "oklch(0.704 0.191 22.2)", "--ring": "oklch(0.7 0.12 182)",
  "--success": "oklch(0.706 0.15 156)", "--warning": "oklch(0.8 0.16 80)", "--info": "oklch(0.7 0.12 210)",
  "--success-text": "oklch(0.706 0.15 156)", "--warning-text": "oklch(0.8 0.16 80)", "--info-text": "oklch(0.7 0.12 210)",
};
const LIGHT: Record<string, string> = {
  "--background": "oklch(0.99 0.0015 280)", "--foreground": "oklch(0.21 0.02 281)", "--card": "oklch(1 0 0)",
  "--border": "oklch(0.91 0.006 281)", "--muted": "oklch(0.965 0.006 280)", "--muted-foreground": "oklch(0.524 0.022 281)",
  "--primary": "oklch(0.53 0.105 185)", "--primary-foreground": "oklch(0.985 0.01 180)",
  "--destructive": "oklch(0.583 0.231 27.5)", "--ring": "oklch(0.53 0.105 185)",
  "--success": "oklch(0.62 0.16 150)", "--warning": "oklch(0.72 0.16 73)", "--info": "oklch(0.6 0.14 240)",
  "--success-text": "oklch(0.5 0.14 150)", "--warning-text": "oklch(0.52 0.13 73)", "--info-text": "oklch(0.5 0.13 240)",
};

/* The harness's own keys. Everything else in the address is page state. */
const HARNESS_KEYS = new Set(["route", "scenario", "theme", "width", "frame", "refuse", "readonly", "plugin", "oldhost"]);

const params = new URLSearchParams(location.search);
let frameEpoch = 0;
let route = (params.get("route") ?? "networks") as Route;
let scenario = (params.get("scenario") ?? "production") as Scenario;
let dark = params.get("theme") !== "light";
let width = params.get("width") ?? "1440";
let refuse = params.get("refuse") === "1";
/** A session that may read but not plan. */
const readOnly = params.get("readonly") === "1";
/** The console's main region height: the frame fills it and scrolls inside. */
let windowHeight = Number(params.get("frame") ?? 900);
/**
 * The old deep link: forwarded to the plugin document's own query, read only
 * by a page whose host keeps no state. Named `plugin`, not `q`, because `q` is
 * the plugin's own Fleet search key and a harness key of that name would drop
 * every state message carrying a search.
 */
const pluginQuery = params.get("plugin") ?? "";
const oldHost = params.get("oldhost") === "1";
let pageState: PageState = filterPageState([...params].filter(([key]) => !HARNESS_KEYS.has(key)));
const STATES_PER_MINUTE = 60;
let stateTimes: number[] = [];
let readySeen = false;

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
    <span id="state"></span>
  </div>
  <div class="viewport" id="viewport">
    <div class="frame-wrap" id="wrap"><iframe id="frame" title="plugin"></iframe></div>
  </div>`;
document.body.append(shell);

const frame = document.getElementById("frame") as HTMLIFrameElement;
const wrap = document.getElementById("wrap") as HTMLDivElement;
const viewport = document.getElementById("viewport") as HTMLDivElement;
const reported = document.getElementById("reported") as HTMLSpanElement;
const stateNote = document.getElementById("state") as HTMLSpanElement;

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
  if (readOnly) query.set("readonly", "1");
  if (pluginQuery) query.set("plugin", pluginQuery);
  if (oldHost) query.set("oldhost", "1");
  for (const [key, value] of Object.entries(pageState)) query.set(key, value);
  history.replaceState(null, "", `?${query}`);
}

function reload(): void {
  syncQuery();
  applyChrome();
  stateTimes = [];
  readySeen = false;
  stateNote.textContent = oldHost ? "old host: page state not kept" : "";
  // The epoch matters: assigning an identical src, fragment and all, is a
  // same-document navigation, so the frame would keep running and the data the
  // operator just picked would never reach a fresh plugin.
  frameEpoch += 1;
  frame.src = `/index.html?epoch=${frameEpoch}${pluginQuery ? `&${pluginQuery}` : ""}#lattice_nonce=${NONCE}&host_origin=${encodeURIComponent(location.origin)}`;
}

function post(message: Record<string, unknown>): void {
  frame.contentWindow?.postMessage({ nonce: NONCE, ...message }, location.origin);
}

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const data = event.data as Record<string, any>;
  if (data?.type === "lattice:navigate") {
    stateNote.textContent = `navigate requested: ${String(data.route)}`;
    return;
  }
  if (!data || data.nonce !== NONCE) return;
  switch (data.type) {
    case "lattice.plugin.ready":
      post({
        type: "lattice.host.init", version: "1", pluginId: PLUGIN_ID,
        pluginVersion: "0.0.0-dev", pluginRoute: route, locale: "en",
        colorScheme: dark ? "dark" : "light", designTokens: dark ? DARK : LIGHT, interfaces: readOnly ? READ_ONLY_INTERFACES : INTERFACES,
        ...(oldHost ? {} : { pageState: { ...pageState } }),
      });
      readySeen = true;
      return;
    case "lattice.plugin.state": {
      if (oldHost || !readySeen) return;
      const now = Date.now();
      stateTimes = stateTimes.filter((time) => now - time < 60_000);
      if (stateTimes.length >= STATES_PER_MINUTE) {
        stateNote.textContent = "state ignored: over 60 a minute";
        return;
      }
      stateTimes.push(now);
      const state = validPageState(data.state);
      if (!state) {
        stateNote.textContent = "state dropped: breaks the contract's rules";
        return;
      }
      const clash = Object.keys(state).filter((key) => HARNESS_KEYS.has(key));
      if (clash.length) {
        stateNote.textContent = `state dropped: ${clash.join(", ")} is a harness key`;
        return;
      }
      pageState = state;
      syncQuery();
      stateNote.textContent = `state ${new URLSearchParams(state).toString() || "(default)"}`;
      return;
    }
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
  syncQuery();
  post({ type: "lattice.host.theme", colorScheme: dark ? "dark" : "light", designTokens: dark ? DARK : LIGHT });
});

reload();
