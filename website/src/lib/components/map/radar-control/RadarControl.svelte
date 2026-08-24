<script lang="ts">
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import { CloudRain } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';
    import { cwaRadarOverlay, isRadarOn, withRadar } from './utils';

    const { currentOverlays } = settings;

    let enabled = $derived(isRadarOn($currentOverlays));
</script>

<CustomControl class="w-[29px] h-[29px] shrink-0">
    <ButtonWithTooltip
        variant="ghost"
        class="w-full h-full border-none rounded-sm"
        side="left"
        label={i18n._(`layers.label.${cwaRadarOverlay}`)}
        onclick={() => {
            $currentOverlays = withRadar($currentOverlays, !enabled);
        }}
    >
        <CloudRain size="22" class="size-5.5" color={enabled ? '#33b5e5' : 'currentColor'} />
    </ButtonWithTooltip>
</CustomControl>
