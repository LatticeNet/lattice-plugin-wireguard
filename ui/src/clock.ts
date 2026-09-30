/**
 * A clock for relative labels ("observed 13s ago", "seen 2m ago"), and for
 * nothing else: it never reads data. Data is re-read by the Refresh button
 * or the page's own read schedule; this only keeps an age true while the
 * page stays open, since the absolute time behind it moved into a title.
 */
import { onBeforeUnmount, ref, type Ref } from "vue";

/** Now, in milliseconds, advanced every `intervalMs`. */
export function useNow(intervalMs = 5_000): Ref<number> {
  const now = ref(Date.now());
  const timer = setInterval(() => {
    now.value = Date.now();
  }, intervalMs);
  onBeforeUnmount(() => clearInterval(timer));
  return now;
}
