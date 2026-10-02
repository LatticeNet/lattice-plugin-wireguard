/**
 * chassis-copy: the same file is in lattice-plugin-netguard and
 * lattice-plugin-wireguard. It belongs in @latticenet/plugin-bridge/chassis
 * beside the proof line; change both copies together until then.
 *
 * A clock for relative labels ("observed 13s ago", "seen 2m ago"), and for
 * nothing else: it never reads data, which the page re-reads only when the
 * operator presses Refresh. It keeps an age true while the frame is on
 * screen. While the document is hidden (a background tab, a minimised
 * window) it stops, and it catches up the moment the document shows again,
 * so a tab left open does not re-render every age cell for nobody.
 */
import { onBeforeUnmount, ref, type Ref } from "vue";

export const TICK_MS = 5_000;

/** The part of `document` the clock reads. */
export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/**
 * Call `onTick` every `intervalMs` while `doc` is visible, and once when it
 * becomes visible again. Returns the stop function.
 */
export function startTicker(onTick: () => void, doc: VisibilitySource, intervalMs = TICK_MS): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const run = (): void => {
    if (timer === undefined) timer = setInterval(onTick, intervalMs);
  };
  const halt = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const onVisibility = (): void => {
    if (doc.hidden) {
      halt();
      return;
    }
    onTick();
    run();
  };
  doc.addEventListener("visibilitychange", onVisibility);
  if (!doc.hidden) run();
  return () => {
    halt();
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Now, in milliseconds, advanced every `intervalMs` while the page is visible. */
export function useNow(intervalMs = TICK_MS): Ref<number> {
  const now = ref(Date.now());
  const stop = startTicker(
    () => {
      now.value = Date.now();
    },
    document,
    intervalMs,
  );
  onBeforeUnmount(stop);
  return now;
}
