import { describe, expect, it } from "vitest";

import { menuPosition, nextEnabled, orderItems, type MenuItem } from "./rowMenu";

const items: MenuItem[] = [
  { key: "delete", label: "Delete", danger: true },
  { key: "apply", label: "Review and apply", disabled: true, reason: "observe only" },
  { key: "binding", label: "Edit binding" },
  { key: "adopt", label: "Adopt baseline" },
];

describe("the row menu", () => {
  it("puts danger items last and keeps the rest in the order given", () => {
    expect(orderItems(items).map((item) => item.key)).toEqual(["apply", "binding", "adopt", "delete"]);
  });

  it("moves between enabled items only, wrapping at both ends", () => {
    const ordered = orderItems(items);
    expect(nextEnabled(ordered, -1, 1)).toBe(1);
    expect(nextEnabled(ordered, 1, 1)).toBe(2);
    expect(nextEnabled(ordered, 3, 1)).toBe(1);
    expect(nextEnabled(ordered, ordered.length, -1)).toBe(3);
    expect(nextEnabled(ordered, 1, -1)).toBe(3);
    expect(nextEnabled([{ key: "x", label: "x", disabled: true }], -1, 1)).toBe(-1);
    expect(nextEnabled([], -1, 1)).toBe(-1);
  });

  it("opens under the trigger, right-aligned, and flips above or inward when the frame has no room", () => {
    const viewport = { width: 375, height: 812 };
    expect(menuPosition({ top: 100, bottom: 130, right: 360 }, { width: 220, height: 120 }, viewport)).toEqual({ top: 134, left: 140 });
    expect(menuPosition({ top: 760, bottom: 790, right: 360 }, { width: 220, height: 120 }, viewport)).toEqual({ top: 636, left: 140 });
    expect(menuPosition({ top: 100, bottom: 130, right: 120 }, { width: 220, height: 120 }, viewport)).toEqual({ top: 134, left: 4 });
    expect(menuPosition({ top: 100, bottom: 130, right: 1400 }, { width: 220, height: 120 }, { width: 1024, height: 900 })).toEqual({ top: 134, left: 800 });
  });
});
