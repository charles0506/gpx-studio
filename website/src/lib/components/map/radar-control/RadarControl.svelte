<script lang="ts">
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import { CloudRain } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';
    import { onMount } from 'svelte';
    import {
        activeStation,
        rememberedStation,
        rememberStation,
        watchRadarExclusivity,
        withStation,
    } from './utils';

    const { currentOverlays } = settings;

    let station = $derived(activeStation($currentOverlays));

    // Deliberately no `$effect` in this component. The overlay store round-trips
    // through IndexedDB, so it re-emits a new object after every write; an
    // effect reading it and touching anything in response kept retriggering
    // until Svelte's update-depth guard fired, and that guard tears down the
    // surrounding component — which is what left the whole control column
    // unclickable. Remembering the choice at click time needs no effect at all.
    onMount(() => watchRadarExclusivity());
</script>

<CustomControl class="w-[29px] h-[29px] shrink-0">
    <ButtonWithTooltip
        variant="ghost"
        class="w-full h-full border-none rounded-sm"
        side="left"
        label={i18n._(`layers.label.${station ?? rememberedStation()}`)}
        onclick={() => {
            if (station === undefined) {
                $currentOverlays = withStation($currentOverlays, rememberedStation());
            } else {
                rememberStation(station);
                $currentOverlays = withStation($currentOverlays, undefined);
            }
        }}
    >
        <CloudRain
            size="22"
            class="size-5.5"
            color={station === undefined ? 'currentColor' : '#33b5e5'}
        />
    </ButtonWithTooltip>
</CustomControl>
