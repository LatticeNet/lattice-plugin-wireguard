/**
 * chassis-workaround: PcLensTabs never scrolls its selected tab into view.
 *
 * Below 620px the layer row is a segmented control that scrolls sideways
 * when a frame is narrower than its tabs, and a layer chosen by the address,
 * a reload or an Overview action can then sit outside it. This keeps the
 * selected tab inside the row on load and on every layer change. Only the
 * row's own scrollLeft moves, never the page. Remove once plugin-bridge's
 * layer tabs do it themselves.
 */
export function revealSelectedTab(list: Element | null): void {
  if (!(list instanceof HTMLElement)) return;
  const tab = list.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!tab) return;
  const row = list.getBoundingClientRect();
  const box = tab.getBoundingClientRect();
  if (box.left < row.left) list.scrollLeft -= row.left - box.left;
  else if (box.right > row.right) list.scrollLeft += box.right - row.right;
}
