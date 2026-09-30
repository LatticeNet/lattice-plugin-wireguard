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

/** Fire and forget: the console answers by navigating, not by replying. */
export function postNavigate(win: { parent: { postMessage(message: unknown, targetOrigin: string): void } }, route: string, hostOrigin: string): void {
  win.parent.postMessage(navigateMessage(route), hostOrigin);
}
