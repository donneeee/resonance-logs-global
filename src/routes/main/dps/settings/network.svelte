<script lang="ts">
    import SettingsDropdown from "./settings-dropdown.svelte";
    import { SETTINGS } from "$lib/settings-store";
    import { invoke } from "@tauri-apps/api/core";
    import { onMount } from "svelte";
    import { untrack } from "svelte";
    import { uiT } from "$lib/i18n";

    type Device = {
        name: string;
        description: string | null;
    };

    let devices = $state<Device[]>([]);
    let npcapInstalled = $state(false);
    let loading = $state(false);
    let mounted = $state(false);
    let initialDevice = $state<string | null>(null);

    const t = uiT("dps/settings-network", () => SETTINGS.live.general.state.language);

    async function loadDevices() {
        loading = true;
        try {
            npcapInstalled = await invoke("check_npcap_status");
            if (npcapInstalled) {
                devices = await invoke("get_network_devices");
            }
        } catch (e) {
            console.error("Failed to load network info", e);
        }
        loading = false;
    }

    onMount(() => {
        untrack(() => {
            initialDevice = SETTINGS.packetCapture.state.npcapDevice;
        });
        mounted = true;
        loadDevices();
    });

    $effect(() => {
        if (!mounted) return;
        const device = SETTINGS.packetCapture.state.npcapDevice;

        if (initialDevice !== null && device === initialDevice) {
            return;
        }

        initialDevice = device;

        invoke("save_packet_capture_settings", {
            npcapDevice: device,
        }).catch((e) => console.error("Failed to save packet capture settings", e));
    });

    let deviceOptions = $derived(
        devices.map((d) => ({
            value: d.name,
            label: d.description || d.name,
        })),
    );
</script>

<div class="space-y-3">
    <div
        class="rounded-lg border bg-card/40 border-border/60 overflow-hidden shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]"
    >
        <div class="px-4 py-3">
            <h2 class="text-base font-semibold text-foreground mb-2">
                {t("title", "Packet Capture")}
            </h2>

            {#if !npcapInstalled}
                <div
                    class="mt-2 p-3 bg-destructive/10 text-destructive rounded-md text-sm"
                >
                    {t("npcapMissing", "Npcap was not detected.")}
                    <a
                        href="https://npcap.com/"
                        target="_blank"
                        class="underline"
                    >
                        npcap.com
                    </a>
                    {" "}
                    {t("npcapMissingSuffix", "Please install Npcap before using packet capture.")}
                </div>
            {:else}
                <SettingsDropdown
                    bind:selected={SETTINGS.packetCapture.state.npcapDevice}
                    label={t("networkDevice", "Network Device")}
                    description={t(
                        "networkDeviceDescription",
                        "Choose the network adapter used to capture traffic.",
                    )}
                    options={deviceOptions}
                    placeholder={loading
                        ? t("loadingDevices", "Loading network devices...")
                        : t("selectDevice", "Select Network Device")}
                />
            {/if}
        </div>
    </div>
</div>
