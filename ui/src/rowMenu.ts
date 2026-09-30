/**
 * The row menu's model: which items it holds, in which order, and where the
 * arrow keys go. A row has one click target (its panel) and this one menu for
 * everything else (design 23 section 3.6). A disabled item stays in the list
 * with its reason printed under it, because touch has no tooltip to carry it.
 */

export interface MenuItem {
  key: string;
  label: string;
  disabled?: boolean;
  /** Why the item is disabled, printed under the label. */
  reason?: string;
  /** A verb that removes something; it sits last, after a separator. */
  danger?: boolean;
}

/** Danger items last, each group in the order given. */
export function orderItems(items: readonly MenuItem[]): MenuItem[] {
  return [...items.filter((item) => !item.danger), ...items.filter((item) => item.danger)];
}

/**
 * The next enabled item from `from` in direction `step`, wrapping. `from` of
 * -1 with step 1 finds the first; `from` of the length with step -1 finds the
 * last. -1 when nothing is enabled.
 */
export function nextEnabled(items: readonly MenuItem[], from: number, step: 1 | -1): number {
  const count = items.length;
  if (!count) return -1;
  for (let offset = 1; offset <= count; offset += 1) {
    const index = (((from + step * offset) % count) + count) % count;
    if (!items[index]!.disabled) return index;
  }
  return -1;
}

/** Where the menu sits: under the trigger, flipped above when the viewport has no room below. */
export function menuPosition(
  trigger: { top: number; bottom: number; right: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 4,
): { top: number; left: number } {
  const below = trigger.bottom + gap;
  const top = below + menu.height <= viewport.height - gap ? below : Math.max(gap, trigger.top - gap - menu.height);
  const left = Math.min(Math.max(gap, trigger.right - menu.width), Math.max(gap, viewport.width - gap - menu.width));
  return { top, left };
}
