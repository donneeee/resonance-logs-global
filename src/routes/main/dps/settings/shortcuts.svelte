<script lang="ts">
  import { onDestroy } from "svelte";
  import { SvelteSet } from "svelte/reactivity";

  import AlertCircleIcon from "virtual:icons/lucide/alert-circle";
  import * as Tabs from "$lib/components/ui/tabs/index.js";
  import * as Item from "$lib/components/ui/item/index.js";
  import * as Alert from "$lib/components/ui/alert/index.js";
  import { Button } from "$lib/components/ui/button/index.js";

  import { SETTINGS } from "$lib/settings-store";
  import { uiT } from "$lib/i18n";
  import {
    GENERAL_SHORTCUTS,
    clearRegisteredShortcut,
    findShortcutConflict,
    isSystemShortcutKey,
    registerShortcut,
    safeUnregisterShortcut,
    validateGlobalShortcut,
    type ShortcutOwner,
    type ShortcutValidationReason,
  } from "./shortcuts.js";
  import type { BaseInput } from "./settings.js";

  let editingId: string | null = $state(null);
  let editingConflict = $state<ShortcutOwner | null>(null);
  let editingInvalidReason: ShortcutValidationReason | null = $state(null);

  const modifierOrder = ["ctrl", "shift", "alt", "meta"];
  const MODIFIERS = new SvelteSet(modifierOrder);
  const activeMods = new SvelteSet<string>();
  let mainKey: string | null = $state(null);

  const normalizeModifier = (key: string): string =>
    (
      ({
        control: "ctrl",
        meta: "meta",
        alt: "alt",
        shift: "shift",
      }) as Record<string, string>
    )[key.toLowerCase()] ?? key.toLowerCase();

  function getKeyName(e: KeyboardEvent): string {
    const code = e.code;

    if (code.startsWith("Numpad")) {
      return code;
    }

    return e.key.toLowerCase();
  }

  function currentShortcutString(): string {
    const mods = modifierOrder.filter((m) => activeMods.has(m));
    return mainKey ? [...mods, mainKey].join("+") : mods.join("+");
  }

  function startEdit(shortcut: BaseInput) {
    stopEdit();
    editingId = shortcut.id;
    activeMods.clear();
    mainKey = null;

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
  }

  function stopEdit() {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    activeMods.clear();
    mainKey = null;
    editingConflict = null;
    editingInvalidReason = null;
    editingId = null;
  }

  function handleKeyDown(e: KeyboardEvent) {
    const modKey = normalizeModifier(e.key);

    if (MODIFIERS.has(modKey)) {
      e.preventDefault();
      activeMods.add(modKey);
      editingInvalidReason = null;
      return;
    }

    const keyName = getKeyName(e);
    if (isSystemShortcutKey(keyName)) {
      editingConflict = null;
      editingInvalidReason = "systemKey";
      mainKey = null;
      return;
    }

    e.preventDefault();
    editingInvalidReason = null;
    mainKey = keyName;
  }

  async function handleKeyUp(e: KeyboardEvent) {
    const modKey = normalizeModifier(e.key);

    if (MODIFIERS.has(modKey)) {
      e.preventDefault();
      activeMods.delete(modKey);
      stopEdit();
      return;
    }

    if (mainKey) {
      const shortcutKey = currentShortcutString();
      const validation = validateGlobalShortcut(shortcutKey);
      if (!validation.valid) {
        e.preventDefault();
        editingConflict = null;
        editingInvalidReason = validation.reason;
        mainKey = null;
        return;
      }

      const cmd = inputs.find((c) => c.id === editingId);
      if (cmd) {
        const conflict = findShortcutConflict(validation.shortcut, { section: "general", id: cmd.id });
        if (conflict) {
          e.preventDefault();
          editingConflict = conflict;
          return;
        }
        editingConflict = null;
        editingInvalidReason = null;
        await safeUnregisterShortcut(SETTINGS.shortcuts.state[cmd.id]);
        SETTINGS.shortcuts.state[cmd.id] = validation.shortcut;
        await registerShortcut("general", cmd.id, validation.shortcut);
      }
      e.preventDefault();
      stopEdit();
    }
  }

  async function clearShortcut(shortcut: BaseInput, e: MouseEvent) {
    e.preventDefault();
    await clearRegisteredShortcut("general", shortcut.id);
  }

  const t = uiT("dps/settings-hotkeys", () => SETTINGS.live.general.state.language);
  const customHotkeyT = uiT("custom-triggers/general", () => SETTINGS.live.general.state.language);

  function conflictLabel(owner: ShortcutOwner): string {
    return owner.section === "customTriggers"
      ? customHotkeyT(owner.labelKey, owner.fallbackLabel)
      : t(owner.labelKey, owner.fallbackLabel);
  }

  function validationMessage(reason: ShortcutValidationReason): string {
    return reason === "systemKey"
      ? t("invalid.systemKey", "Media, browser, launcher, and system keys cannot be used as global hotkeys.")
      : t("invalid.missingModifier", "Global hotkeys must include at least one modifier, such as Ctrl, Alt, Shift, or Win.");
  }

  onDestroy(stopEdit);

  const SETTINGS_CATEGORY = "shortcuts";

  let inputs: BaseInput[] = GENERAL_SHORTCUTS.map((shortcut) => ({
    id: shortcut.id,
    label: shortcut.fallbackLabel,
  }));
</script>

<Tabs.Content value={SETTINGS_CATEGORY}>
  <div class="space-y-3">
    <Alert.Root class="shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <AlertCircleIcon />
      <Alert.Title>{t("clearHint", "右键可清除快捷键")}</Alert.Title>
    </Alert.Root>
    {#if editingConflict}
      <Alert.Root class="shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] border-destructive/40 text-destructive">
        <AlertCircleIcon />
        <Alert.Title>{t("conflictAssigned", "That hotkey is already assigned to")}: {conflictLabel(editingConflict)}</Alert.Title>
      </Alert.Root>
    {/if}
    {#if editingInvalidReason}
      <Alert.Root class="shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] border-destructive/40 text-destructive">
        <AlertCircleIcon />
        <Alert.Title>{validationMessage(editingInvalidReason)}</Alert.Title>
      </Alert.Root>
    {/if}
    <div class="rounded-lg border bg-card/40 border-border/60 p-4 space-y-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
      {#each inputs as input (input.id)}
        <Item.Root>
          <Item.Content>
            <Item.Title>{t(`shortcuts.${input.id}`, input.label)}</Item.Title>
          </Item.Content>
          <Item.Actions>
            <Button variant="outline" class="uppercase" onclick={() => startEdit(input)} oncontextmenu={(e: MouseEvent) => clearShortcut(input, e)}>
              {#if editingId === input.id}
                {currentShortcutString() || t("pressKey", "请按键")}...
              {:else}
                {SETTINGS.shortcuts.state[input.id] || t("unbound", "未绑定")}
              {/if}
            </Button>
          </Item.Actions>
        </Item.Root>
      {/each}
    </div>
  </div>
</Tabs.Content>
