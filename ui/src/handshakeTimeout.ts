import { getCurrentInstance, onBeforeUnmount, ref, watch, type Ref } from "vue";

/**
 * How long to wait for the host handshake before saying it has not arrived.
 *
 * The shared bridge posts `lattice.plugin.ready` 16 times at 500ms and then
 * stops. Nothing rejects `init` when those attempts run out: the promise simply
 * never settles, so the `.catch` that sets bootError never runs and the screen
 * holds its skeleton forever. This waits past the bridge's own retry window
 * before speaking, so a slow host is never accused of being a dead one.
 */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * True once the handshake has been missing for `timeoutMs`.
 *
 * A handshake that lands late resets it, so a slow-but-real host never gets
 * stuck behind the notice. Ported from lattice-plugin-sub-store, with a longer
 * default because this plugin's bridge retries for eight seconds on its own and
 * a notice that appears while the bridge is still trying would be wrong.
 */
export function useHandshakeTimeout(
  init: Ref<unknown>,
  timeoutMs: number = HANDSHAKE_TIMEOUT_MS,
): Ref<boolean> {
  const expired = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clear(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  if (!init.value) {
    timer = setTimeout(() => {
      expired.value = true;
    }, timeoutMs);
  }

  watch(init, (value) => {
    if (value) {
      expired.value = false;
      clear();
    }
  });

  // Guarded: the composable is also exercised bare in tests, where there is no
  // component to unmount and the registration would only warn.
  if (getCurrentInstance()) {
    onBeforeUnmount(clear);
  }

  return expired;
}
