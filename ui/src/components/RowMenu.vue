<script setup lang="ts">
/**
 * One menu per row for everything the row click does not do.
 *
 * The trigger is always visible (a control that appears on hover does not
 * exist on touch). The menu is teleported to the body and fixed against the
 * frame's viewport, so the table's scroll wrap and its sticky columns cannot
 * clip it, and a click inside it never reaches the row's own click handler.
 * A disabled item says why under its label. Arrow keys move between enabled
 * items, Escape closes and hands focus back to the trigger, and choosing an
 * item hands focus back before the choice runs, so a dialog it opens returns
 * focus to the trigger when it closes.
 */
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { Ellipsis } from "@lucide/vue";

import { menuPosition, nextEnabled, orderItems, type MenuItem } from "../rowMenu";

const props = defineProps<{
  /** "Actions for [Metix]-DMIT-2". */
  label: string;
  items: readonly MenuItem[];
}>();

const emit = defineEmits<{ (event: "select", key: string): void }>();


const menuId = `rm-${Math.random().toString(36).slice(2, 10)}`;
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const position = ref({ top: 0, left: 0 });
const ordered = computed(() => orderItems(props.items));
const firstDanger = computed(() => ordered.value.findIndex((item) => item.danger));

function itemButtons(): HTMLButtonElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
}

function focusIndex(index: number): void {
  if (index < 0) {
    // Nothing is enabled: the menu itself (tabindex -1) takes focus, so
    // Escape and Tab still reach onMenuKeydown and the disabled reasons stay
    // on screen, instead of focus staying on the trigger.
    menu.value?.focus();
    return;
  }
  itemButtons()[index]?.focus();
}

function place(): void {
  if (!trigger.value || !menu.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const box = menu.value.getBoundingClientRect();
  position.value = menuPosition(rect, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight });
}

function onOutside(event: Event): void {
  const target = event.target as Node | null;
  if (target && (menu.value?.contains(target) || trigger.value?.contains(target))) return;
  close(false);
}

function onViewportChange(): void {
  close(false);
}

async function show(focus: "first" | "last"): Promise<void> {
  open.value = true;
  await nextTick();
  place();
  document.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("scroll", onViewportChange, true);
  focusIndex(focus === "first" ? nextEnabled(ordered.value, -1, 1) : nextEnabled(ordered.value, ordered.value.length, -1));
}

function close(returnFocus: boolean): void {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("scroll", onViewportChange, true);
  if (returnFocus) trigger.value?.focus();
}

function toggle(): void {
  if (open.value) close(true);
  else void show("first");
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    void show(event.key === "ArrowDown" ? "first" : "last");
  }
}

function onMenuKeydown(event: KeyboardEvent): void {
  const buttons = itemButtons();
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  switch (event.key) {
    case "ArrowDown":
    case "ArrowUp":
      event.preventDefault();
      focusIndex(nextEnabled(ordered.value, current < 0 ? (event.key === "ArrowDown" ? -1 : ordered.value.length) : current, event.key === "ArrowDown" ? 1 : -1));
      return;
    case "Home":
      event.preventDefault();
      focusIndex(nextEnabled(ordered.value, -1, 1));
      return;
    case "End":
      event.preventDefault();
      focusIndex(nextEnabled(ordered.value, ordered.value.length, -1));
      return;
    case "Escape":
      // Stopped here so the page's overlay handler does not also close a panel behind the menu.
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    case "Tab":
      close(false);
  }
}

function choose(item: MenuItem): void {
  if (item.disabled) return;
  close(true);
  emit("select", item.key);
}

onBeforeUnmount(() => close(false));
</script>

<template>
  <button
    ref="trigger"
    class="pc-icon-button rm-trigger"
    data-bordered="true"
    type="button"
    :aria-label="label"
    :title="label"
    aria-haspopup="menu"
    :aria-expanded="open ? 'true' : 'false'"
    :aria-controls="open ? menuId : undefined"
    @click.stop="toggle"
    @keydown="onTriggerKeydown"
  >
    <Ellipsis :size="15" aria-hidden="true" />
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      :id="menuId"
      ref="menu"
      class="rm-menu"
      role="menu"
      tabindex="-1"
      :aria-label="label"
      :style="{ top: `${position.top}px`, left: `${position.left}px` }"
      @keydown="onMenuKeydown"
    >
      <template v-for="(item, index) in ordered" :key="item.key">
        <div v-if="index === firstDanger && index > 0" class="rm-sep" role="separator" />
        <button
          class="rm-item"
          type="button"
          role="menuitem"
          tabindex="-1"
          :aria-disabled="item.disabled ? 'true' : undefined"
          :data-danger="item.danger ? 'true' : undefined"
          @click="choose(item)"
        >
          <span>{{ item.label }}</span>
          <small v-if="item.disabled && item.reason">{{ item.reason }}</small>
        </button>
      </template>
    </div>
  </Teleport>
</template>
