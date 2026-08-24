<script lang="ts">
    import { i18n } from '$lib/i18n.svelte';
    import { gpxStatistics } from '$lib/logic/statistics';
    import { climbAt, climbProgress, findClimbs, gradientColour, nextClimb } from '$lib/climbs';
    import { livePosition, progressAlongRoute } from '$lib/live-position';
    import { cumulativeHikingTime, secondsAt } from '$lib/hiking-time';
    import { TrendingUp } from '@lucide/svelte';

    // Reading the remaining climb should not mean keeping a toolbar panel open
    // on a phone in the rain, so it rides on the map instead — but only while
    // there is a position to place you on the route.
    let climbs = $derived(findClimbs($gpxStatistics));
    let progress = $derived(progressAlongRoute($livePosition));
    let walkingCurve = $derived(cumulativeHikingTime($gpxStatistics));

    let current = $derived(progress ? climbAt(climbs, progress.km) : undefined);
    let upcoming = $derived(progress && !current ? nextClimb(climbs, progress.km) : undefined);

    let done = $derived(current && progress ? climbProgress(current, progress.km) : 0);

    let remaining = $derived.by(() => {
        if (!current || !progress) {
            return undefined;
        }
        const from = Math.max(progress.km, current.startKm);
        const startSeconds = secondsAt(walkingCurve, from);
        const endSeconds = secondsAt(walkingCurve, current.endKm);
        return {
            km: Math.max(0, current.endKm - from),
            gain: Math.max(0, Math.round(current.gain * (1 - done))),
            seconds:
                startSeconds !== undefined && endSeconds !== undefined
                    ? Math.max(0, endSeconds - startSeconds)
                    : undefined,
        };
    });

    function minutes(seconds: number | undefined): string {
        if (seconds === undefined) {
            return '—';
        }
        const total = Math.round(seconds / 60);
        const hours = Math.floor(total / 60);
        return hours > 0 ? `${hours} h ${total % 60} min` : `${total} min`;
    }
</script>

{#if current && remaining}
    <div
        class="absolute top-0 left-1/2 -translate-x-1/2 mt-14 z-20 pointer-events-none w-fit max-w-[90vw]"
    >
        <div class="bg-background/95 rounded-md shadow-md px-2.5 py-1.5 flex flex-col gap-1">
            <div class="flex flex-row items-center gap-2 text-sm whitespace-nowrap">
                <TrendingUp size="16" style="color: {gradientColour(current.gradient)}" />
                <span class="font-medium">
                    {climbs.indexOf(current) + 1}/{climbs.length}
                </span>
                <span>{remaining.km.toFixed(2)} km</span>
                <span>↗ {remaining.gain} m</span>
                <span>{minutes(remaining.seconds)}</span>
            </div>
            <div class="h-1.5 rounded bg-muted overflow-hidden">
                <div
                    class="h-full"
                    style="width: {done * 100}%; background-color: {gradientColour(
                        current.gradient
                    )}"
                ></div>
            </div>
        </div>
    </div>
{:else if upcoming && progress}
    <div
        class="absolute top-0 left-1/2 -translate-x-1/2 mt-14 z-20 pointer-events-none w-fit max-w-[90vw]"
    >
        <div
            class="bg-background/95 rounded-md shadow-md px-2.5 py-1.5 text-sm flex flex-row items-center gap-2 whitespace-nowrap"
        >
            <TrendingUp size="16" style="color: {gradientColour(upcoming.gradient)}" />
            <span>
                {i18n._('toolbar.climbs.next')}
                {(upcoming.startKm - progress.km).toFixed(2)} km {i18n._('toolbar.climbs.ahead')}
            </span>
            <span>↗ {upcoming.gain} m</span>
            <span>{upcoming.gradient}%</span>
        </div>
    </div>
{/if}
