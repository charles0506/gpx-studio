<script lang="ts">
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import { CloudRain } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';
    import {
        activeStation,
        enforceSingleRadar,
        rememberedStation,
        rememberStation,
        withStation,
    } from './utils';

    const { currentOverlays } = settings;

    let station = $derived(activeStation($currentOverlays));

    // The layer panel is free to tick a second view; this puts it back to one.
    let previousOverlays = $state($currentOverlays);
    $effect(() => {
        const corrected = enforceSingleRadar(previousOverlays, $currentOverlays);
        previousOverlays = corrected ?? $currentOverlays;
        if (corrected) {
            $currentOverlays = corrected;
        }
    });

    // Whatever is on gets remembered, so hiding and showing again comes back to
    // the same view rather than to a default.
    $effect(() => {
        if (station !== undefined) {
            rememberStation(station);
        }
    });
</script>

<CustomControl class="w-[29px] h-[29px] shrink-0">
    <ButtonWithTooltip
        variant="ghost"
        class="w-full h-full border-none rounded-sm"
        side="left"
        label={i18n._(`layers.label.${station ?? rememberedStation()}`)}
        onclick={() => {
            $currentOverlays = withStation(
                $currentOverlays,
                station === undefined ? rememberedStation() : undefined
            );
        }}
    >
        <CloudRain
            size="22"
            class="size-5.5"
            color={station === undefined ? 'currentColor' : '#33b5e5'}
        />
    </ButtonWithTooltip>
</CustomControl>
