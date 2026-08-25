<script lang="ts">
    import CustomControl from '$lib/components/map/custom-control/CustomControl.svelte';
    import ButtonWithTooltip from '$lib/components/ButtonWithTooltip.svelte';
    import { TrendingUp } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { climbScreen, cycleClimbScreen } from '$lib/climb-view';

    // The climb screen is read while walking, so its switch belongs with the
    // map's own controls rather than tucked into a corner of the elevation
    // profile, where it was a 28 px target sitting on top of the chart.
    //
    // Three states on one button need three appearances that cannot be mistaken
    // for one another: grey and idle, amber for following, and amber filled in
    // for holding it open regardless.
    let colour = $derived($climbScreen === 'off' ? 'currentColor' : '#f59e0b');
    let held = $derived($climbScreen === 'on');
</script>

<CustomControl class="w-[29px] h-[29px] shrink-0">
    <ButtonWithTooltip
        variant="ghost"
        class="w-full h-full border-none rounded-sm {held ? 'bg-amber-500/20' : ''}"
        side="left"
        label="{i18n._('toolbar.climbs.climb_screen')} · {i18n._(
            `toolbar.climbs.screen_${$climbScreen}`
        )}"
        onclick={cycleClimbScreen}
    >
        <TrendingUp size="22" class="size-5.5" color={colour} />
    </ButtonWithTooltip>
</CustomControl>
