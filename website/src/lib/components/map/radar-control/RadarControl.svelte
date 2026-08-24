<script lang="ts">
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import { CloudRain } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';
    import { activeStation, nextStation, withStation } from './utils';

    const { currentOverlays } = settings;

    let station = $derived(activeStation($currentOverlays));
</script>

<CustomControl class="w-[29px] h-[29px] shrink-0">
    <ButtonWithTooltip
        variant="ghost"
        class="w-full h-full border-none rounded-sm"
        side="left"
        label={station === undefined
            ? i18n._('layers.label.cwaRadarAll')
            : i18n._(`layers.label.${station}`)}
        onclick={() => {
            $currentOverlays = withStation($currentOverlays, nextStation(station));
        }}
    >
        <CloudRain
            size="22"
            class="size-5.5"
            color={station === undefined ? 'currentColor' : '#33b5e5'}
        />
    </ButtonWithTooltip>
</CustomControl>
