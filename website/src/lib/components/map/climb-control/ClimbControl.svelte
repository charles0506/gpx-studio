<script lang="ts">
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import { TrendingUp } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { showClimbPro } from '$lib/climb-view';

    // The climb screen is read while walking, so its switch belongs with the
    // map's own controls rather than tucked into a corner of the elevation
    // profile, where it was a 28 px target sitting on top of the chart.
</script>

<CustomControl class="w-[29px] h-[29px] shrink-0">
    <ButtonWithTooltip
        variant="ghost"
        class="w-full h-full border-none rounded-sm"
        side="left"
        label={i18n._('toolbar.climbs.climb_screen')}
        onclick={() => showClimbPro.update((on) => !on)}
    >
        <TrendingUp size="22" class="size-5.5" color={$showClimbPro ? '#f59e0b' : 'currentColor'} />
    </ButtonWithTooltip>
</CustomControl>
