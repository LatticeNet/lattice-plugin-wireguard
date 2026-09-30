/**
 * chassis-workaround: PcSidePanel is always modal.
 *
 * From 768px up the node panel sits beside the rows instead of over them
 * (design 23 section 3.5; wave 1 design review M1): no scrim, rows stay live,
 * and a row click swaps `open=` instead of only closing the panel. Below
 * 768px it stays the full-height modal the chassis draws. The chassis renders
 * a scrim that closes on click, `aria-modal="true"` and a Tab trap on every
 * PcSidePanel, so from 768px up this module and the plugin's stylesheet undo
 * those three: the stylesheet makes the scrim transparent and lets clicks
 * through it, a capture-phase keydown on the panel's root stops Tab before
 * the chassis trap sees it, and the dialog is marked non-modal (a dialog
 * without aria-modal). Escape still closes it through the overlay stack.
 * Remove once plugin-bridge gives PcSidePanel a non-modal form.
 */
import { nextTick, onBeforeUnmount, ref, watch, type Ref, type WatchSource } from "vue";

/** Where the panel stops being modal. */
export const NON_MODAL_QUERY = "(min-width: 768px)";

export interface NonModalPanel {
  /** True from 768px up, where the panel is non-modal. */
  wide: Ref<boolean>;
  /** Bind as `@keydown.capture` on the PcSidePanel. */
  onKeydownCapture(event: KeyboardEvent): void;
}

/** `hostClass` is the class given to the PcSidePanel, which lands on its root. */
export function useNonModalPanel(open: WatchSource<boolean>, hostClass: string): NonModalPanel {
  const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia(NON_MODAL_QUERY) : undefined;
  const wide = ref(Boolean(media?.matches));
  const onChange = () => {
    wide.value = Boolean(media?.matches);
  };
  media?.addEventListener("change", onChange);
  onBeforeUnmount(() => media?.removeEventListener("change", onChange));

  // Vue patches only the attributes whose value changed, and the chassis
  // always renders "true", so a value set here stands until the panel is
  // rendered anew by the next open.
  watch(
    [open, wide],
    async () => {
      await nextTick();
      const panel = document.querySelector(`.${hostClass} .pc-side-panel`);
      if (panel) panel.setAttribute("aria-modal", wide.value ? "false" : "true");
    },
    { flush: "post" },
  );

  function onKeydownCapture(event: KeyboardEvent): void {
    if (wide.value && event.key === "Tab") event.stopPropagation();
  }

  return { wide, onKeydownCapture };
}
