import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TICK_MS, startTicker, type VisibilitySource } from "./clock";

/** A document whose visibility the test flips. */
function fakeDocument(hidden = false) {
  const listeners = new Set<() => void>();
  const doc: VisibilitySource & { hidden: boolean; listeners: Set<() => void>; show(): void; hide(): void } = {
    hidden,
    listeners,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    show() {
      doc.hidden = false;
      for (const listener of [...listeners]) listener();
    },
    hide() {
      doc.hidden = true;
      for (const listener of [...listeners]) listener();
    },
  };
  return doc;
}

describe("the age clock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ticks while the document is visible", () => {
    const doc = fakeDocument();
    const tick = vi.fn();
    const stop = startTicker(tick, doc);
    vi.advanceTimersByTime(TICK_MS * 3);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("stops while hidden, and catches up once when shown again", () => {
    const doc = fakeDocument();
    const tick = vi.fn();
    const stop = startTicker(tick, doc);
    vi.advanceTimersByTime(TICK_MS);
    doc.hide();
    vi.advanceTimersByTime(TICK_MS * 20);
    expect(tick).toHaveBeenCalledTimes(1);
    doc.show();
    expect(tick).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(TICK_MS);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("does not start in a hidden document, and leaves nothing behind when stopped", () => {
    const doc = fakeDocument(true);
    const tick = vi.fn();
    const stop = startTicker(tick, doc);
    vi.advanceTimersByTime(TICK_MS * 4);
    expect(tick).not.toHaveBeenCalled();
    stop();
    expect(doc.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
