<script lang="ts">
    import * as Card from '$lib/components/ui/card';
    import Tooltip from '$lib/components/Tooltip.svelte';
    import WithUnits from '$lib/components/WithUnits.svelte';

    import { MoveDownRight, MoveUpRight, Ruler, Timer, Zap } from '@lucide/svelte';

    import { i18n } from '$lib/i18n.svelte';
    import type { GPXGlobalStatistics, GPXStatisticsGroup } from 'gpx';
    import type { Readable } from 'svelte/store';
    import { settings } from '$lib/logic/settings';
    import { estimateHikingTime } from '$lib/hiking-time';

    const { velocityUnits } = settings;

    let panelHeight: number = $state(0);
    let panelWidth: number = $state(0);

    let {
        gpxStatistics,
        slicedGPXStatistics,
        orientation,
    }: {
        gpxStatistics: Readable<GPXStatisticsGroup>;
        slicedGPXStatistics: Readable<[GPXGlobalStatistics, number, number] | undefined>;
        orientation: 'horizontal' | 'vertical';
    } = $props();

    let statistics = $derived(
        $slicedGPXStatistics !== undefined ? $slicedGPXStatistics[0] : $gpxStatistics.global
    );

    // A planned route has no timestamps, so the recorded time is zero and the
    // walking estimate is the only answer to "how long will this take". When a
    // stretch is selected the estimate follows it, in proportion to distance.
    let estimatedSeconds = $derived.by(() => {
        if (statistics.time.total > 0) {
            return undefined;
        }
        const total = estimateHikingTime($gpxStatistics);
        if (total === undefined) {
            return undefined;
        }
        const whole = $gpxStatistics.global.distance.total;
        return whole > 0 ? (total * statistics.distance.total) / whole : total;
    });
</script>

<Card.Root
    class="h-full {orientation === 'vertical'
        ? 'min-w-40 sm:min-w-44'
        : 'w-full h-fit my-1'} ring-0 p-0 text-sm sm:text-base bg-transparent"
>
    <Card.Content class="h-full p-0">
        <div
            bind:clientHeight={panelHeight}
            bind:clientWidth={panelWidth}
            class="flex {orientation === 'vertical'
                ? 'flex-col h-full justify-center'
                : 'flex-row w-full justify-evenly'} gap-4"
        >
            <Tooltip label={i18n._('quantities.distance')}>
                <span class="flex flex-row items-center">
                    <Ruler size="16" class="mr-1" />
                    <WithUnits value={statistics.distance.total} type="distance" />
                </span>
            </Tooltip>
            <Tooltip label={i18n._('quantities.elevation_gain_loss')}>
                <span class="flex flex-row items-center">
                    <MoveUpRight size="16" class="mr-1" />
                    <WithUnits value={statistics.elevation.gain} type="elevation" />
                    <MoveDownRight size="16" class="mx-1" />
                    <WithUnits value={statistics.elevation.loss} type="elevation" />
                </span>
            </Tooltip>
            {#if panelHeight > 120 || (orientation === 'horizontal' && panelWidth > 450)}
                <Tooltip
                    label="{$velocityUnits === 'speed'
                        ? i18n._('quantities.speed')
                        : i18n._('quantities.pace')} ({i18n._('quantities.moving')} / {i18n._(
                        'quantities.total'
                    )})"
                >
                    <span class="flex flex-row items-center">
                        <Zap size="16" class="mr-1" />
                        <WithUnits value={statistics.speed.moving} type="speed" showUnits={false} />
                        <span class="mx-1">/</span>
                        <WithUnits value={statistics.speed.total} type="speed" />
                    </span>
                </Tooltip>
            {/if}
            {#if panelHeight > 150 || (orientation === 'horizontal' && panelWidth > 620)}
                <Tooltip
                    label={estimatedSeconds !== undefined
                        ? i18n._('toolbar.time.estimate.label')
                        : `${i18n._('quantities.time')} (${i18n._('quantities.moving')} / ${i18n._('quantities.total')})`}
                >
                    <span class="flex flex-row items-center">
                        <Timer size="16" class="mr-1" />
                        {#if estimatedSeconds !== undefined}
                            <span class="mr-1">~</span>
                            <WithUnits value={estimatedSeconds} type="time" />
                        {:else}
                            <WithUnits value={statistics.time.moving} type="time" />
                            <span class="mx-1">/</span>
                            <WithUnits value={statistics.time.total} type="time" />
                        {/if}
                    </span>
                </Tooltip>
            {/if}
        </div>
    </Card.Content>
</Card.Root>
