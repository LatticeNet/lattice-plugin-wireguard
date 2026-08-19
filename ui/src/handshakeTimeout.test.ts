import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { HANDSHAKE_TIMEOUT_MS, useHandshakeTimeout } from "./handshakeTimeout";

describe("useHandshakeTimeout", () => {
  it("waits past the bridge's own retry window before accusing the host", () => {
    // The bridge retries ready 16 times at 500ms. Speaking before that is over
    // would call a slow host a dead one.
    expect(HANDSHAKE_TIMEOUT_MS).toBeGreaterThan(16 * 500);
  });

  it("expires when the handshake never lands", () => {
    vi.useFakeTimers();
    try {
      const init = ref<unknown>(undefined);
      const expired = useHandshakeTimeout(init, 1000);
      expect(expired.value).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(expired.value).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never expires once the handshake has landed", () => {
    vi.useFakeTimers();
    try {
      const init = ref<unknown>({ pluginId: "latticenet.wireguard" });
      const expired = useHandshakeTimeout(init, 1000);
      vi.advanceTimersByTime(5000);
      expect(expired.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears an expired notice when a slow handshake finally arrives", async () => {
    vi.useFakeTimers();
    try {
      const init = ref<unknown>(undefined);
      const expired = useHandshakeTimeout(init, 1000);
      vi.advanceTimersByTime(1000);
      expect(expired.value).toBe(true);
      init.value = { pluginId: "latticenet.wireguard" };
      await Promise.resolve();
      expect(expired.value).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
