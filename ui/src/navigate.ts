/**
 * Asking the console to change pages from inside the frame.
 *
 * The bridge has no navigate call and the frame is sandboxed, so the one
 * channel is a postMessage to the host window. The console listens for
 * `lattice:navigate`, checks the route against its allowlist (any internal
 * path without parameters, lattice-dashboard pluginNavigationModel.ts) and
 * routes itself. Nothing comes back. The target origin is the host origin
 * the frame fragment names, so the request can only reach the console that
 * embedded this frame.
 */

export const NAVIGATE_MESSAGE_TYPE = "lattice:navigate";

/** The console's Tasks page, where a reviewed task runs on a node. */
export const TASKS_ROUTE = "/tasks";

export function navigateMessage(route: string): { type: string; route: string } {
  return { type: NAVIGATE_MESSAGE_TYPE, route };
}

/**
 * The console's origin as the frame URL fragment names it, fail-closed: a
 * nonce outside 16 to 128 characters, or a host origin that does not parse as
 * an http(s) URL, is no console at all and the page offers no navigation. The
 * bridge client reads the same fragment (more strictly: it refuses to start
 * on anything but an exact origin) and keeps the result private; navigation
 * is the only thing this page still needs it for, because the bridge has no
 * navigate call.
 */
export function consoleOriginFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const nonce = params.get("lattice_nonce") ?? "";
  if (nonce.length < 16 || nonce.length > 128) return null;
  const raw = params.get("host_origin")?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.origin;
}

/** Fire and forget: the console answers by navigating, not by replying. */
export function postNavigate(win: { parent: { postMessage(message: unknown, targetOrigin: string): void } }, route: string, hostOrigin: string): void {
  win.parent.postMessage(navigateMessage(route), hostOrigin);
}
