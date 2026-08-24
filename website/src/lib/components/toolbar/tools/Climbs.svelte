<script lang="ts">
    import { Label } from '$lib/components/ui/label/index.js';
    import { MountainSnow, Navigation } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { gpxStatistics } from '$lib/logic/statistics';
    import { climbAt, climbProgress, findClimbs, gradientColour, nextClimb } from '$lib/climbs';
    import { livePosition, progressAlongRoute } from '$lib/live-position';
    import { cumulativeHikingTime, secondsAt } from '$lib/hiking-time';

    let props: {
        class?: string;
    } = $props();

    let climbs = $derived(findClimbs($gpxStatistics));
    let progress = $derived(progressAlongRoute($livePosition));
    let walkingCurve = $derived(cumulativeHikingTime($gpxStatistics));

    let current = $derived(progress ? climbAt(climbs, progress.km) : undefined);
    let upcoming = $derived(progress ? nextClimb(climbs, progress.km) : undefined);

    function duration(seconds: number | undefined): string {
        if (seconds === undefined || !Number.isFinite(seconds)) {
            return '—';
        }
        const minutes = Math.round(seconds / 60);
        const hours = Math.floor(minutes / 60);
        return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
    }

    // What the climb still costs from where you are standing.
    function remainingOf(climb: { startKm: number; endKm: number; gain: number }): {
        km: number;
        gain: number;
        seconds: number | undefined;
    } {
        const from = progress ? Math.max(progress.km, climb.startKm) : climb.startKm;
        const share = 1 - climbProgress(climb as any, from);
        const startSeconds = secondsAt(walkingCurve, from);
        const endSeconds = secondsAt(walkingCurve, climb.endKm);
        return {
            km: Math.max(0, climb.endKm - from),
            gain: Math.round(climb.gain * share),
            seconds:
                startSeconds !== undefined && endSeconds !== undefined
                    ? Math.max(0, endSeconds - startSeconds)
                    : undefined,
        };
    }
</script>

<div class="flex flex-col gap-3 w-full max-w-[26rem] {props.class ?? ''}">
    {#if climbs.length === 0}
        <span class="text-sm text-muted-foreground">
            {i18n._('toolbar.climbs.help')}
        </span>
    {:else}
        {#if current}
            {@const left = remainingOf(current)}
            <div class="flex flex-col gap-1 border rounded-md p-2">
                <Label class="flex flex-row justify-between">
                    <span class="flex flex-row gap-1 items-center">
                        <Navigation size="16" />
                        {i18n._('toolbar.climbs.on_climb')}
                    </span>
                    <span class="font-normal text-muted-foreground">
                        {Math.round(climbProgress(current, progress?.km ?? 0) * 100)}%
                    </span>
                </Label>
                <div class="h-2 rounded bg-muted overflow-hidden">
                    <div
                        class="h-full"
                        style="width: {climbProgress(current, progress?.km ?? 0) *
                            100}%; background-color: {gradientColour(current.gradient)}"
                    ></div>
                </div>
                <span class="text-xs">
                    {i18n._('toolbar.climbs.remaining')}
                    {left.km.toFixed(2)} km · ↗ {left.gain} m · {duration(left.seconds)}
                </span>
            </div>
        {:else if upcoming}
            {@const away = upcoming.startKm - (progress?.km ?? 0)}
            <div class="flex flex-col gap-1 border rounded-md p-2">
                <Label class="flex flex-row gap-1 items-center">
                    <Navigation size="16" />
                    {i18n._('toolbar.climbs.next')}
                </Label>
                <span class="text-xs">
                    {away.toFixed(2)} km {i18n._('toolbar.climbs.ahead')} · ↗ {upcoming.gain} m ·
                    {upcoming.gradient}%
                </span>
            </div>
        {/if}

        <div class="max-h-72 overflow-y-auto">
            <table class="w-full text-xs">
                <thead class="sticky top-0 bg-background">
                    <tr class="text-left">
                        <th class="pr-2 font-medium">#</th>
                        <th class="pr-2 font-medium">{i18n._('quantities.distance')}</th>
                        <th class="pr-2 font-medium">{i18n._('toolbar.climbs.length')}</th>
                        <th class="pr-2 font-medium">↗</th>
                        <th class="pr-2 font-medium">{i18n._('toolbar.climbs.gradient')}</th>
                        <th class="font-medium">{i18n._('toolbar.climbs.time')}</th>
                    </tr>
                </thead>
                <tbody>
                    {#each climbs as climb, index}
                        {@const seconds =
                            (secondsAt(walkingCurve, climb.endKm) ?? 0) -
                            (secondsAt(walkingCurve, climb.startKm) ?? 0)}
                        <tr class="border-t" class:font-medium={current === climb}>
                            <td class="pr-2 py-1">
                                <span
                                    class="inline-block w-2 h-2 rounded-full mr-1"
                                    style="background-color: {gradientColour(climb.gradient)}"
                                ></span>
                                {index + 1}
                            </td>
                            <td class="pr-2 py-1 whitespace-nowrap">{climb.startKm.toFixed(1)} km</td>
                            <td class="pr-2 py-1 whitespace-nowrap">
                                {(climb.endKm - climb.startKm).toFixed(2)} km
                            </td>
                            <td class="pr-2 py-1 whitespace-nowrap">{climb.gain} m</td>
                            <td class="pr-2 py-1 whitespace-nowrap">{climb.gradient}%</td>
                            <td class="py-1 whitespace-nowrap">{duration(seconds)}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        <span class="text-xs text-muted-foreground">
            {i18n._('toolbar.climbs.attribution')}
        </span>
    {/if}
</div>
