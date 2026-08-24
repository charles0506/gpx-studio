<script lang="ts">
    import { i18n } from '$lib/i18n.svelte';
    import { gpxStatistics } from '$lib/logic/statistics';
    import {
        climbAt,
        climbGainSoFar,
        climbProgress,
        findClimbs,
        gradientColour,
        nextClimb,
    } from '$lib/climbs';
    import { livePosition, progressAlongRoute } from '$lib/live-position';
    import { cumulativeHikingTime, secondsAt } from '$lib/hiking-time';
    import { TrendingUp } from '@lucide/svelte';

    // Reading the climb should not mean keeping a toolbar panel open on a phone
    // in the rain, so it rides on the map — but only while there is a position
    // to place you on the route.
    let climbs = $derived(findClimbs($gpxStatistics));
    let progress = $derived(progressAlongRoute($livePosition));
    let walkingCurve = $derived(cumulativeHikingTime($gpxStatistics));

    let current = $derived(progress ? climbAt(climbs, progress.km) : undefined);
    let upcoming = $derived(progress && !current ? nextClimb(climbs, progress.km) : undefined);

    let here = $derived(progress?.km ?? 0);
    let done = $derived(current ? climbProgress(current, here) : 0);
    let gained = $derived(current ? climbGainSoFar(current, here) : 0);

    let remaining = $derived.by(() => {
        if (!current) {
            return undefined;
        }
        const from = Math.max(here, current.startKm);
        const startSeconds = secondsAt(walkingCurve, from);
        const endSeconds = secondsAt(walkingCurve, current.endKm);
        return {
            km: Math.max(0, current.endKm - from),
            gain: Math.max(0, current.gain - gained),
            seconds:
                startSeconds !== undefined && endSeconds !== undefined
                    ? Math.max(0, endSeconds - startSeconds)
                    : undefined,
        };
    });

    // The climb drawn on its own, the way a watch shows it: this hill, not the
    // whole day.
    const WIDTH = 168;
    const HEIGHT = 40;

    let shape = $derived.by(() => {
        const profile = current?.profile ?? [];
        if (profile.length < 2) {
            return undefined;
        }

        const firstKm = profile[0].km;
        const lastKm = profile[profile.length - 1].km;
        const span = Math.max(lastKm - firstKm, 1e-6);
        const elevations = profile.map((p) => p.elevation);
        const low = Math.min(...elevations);
        const high = Math.max(...elevations);
        const rise = Math.max(high - low, 1);

        const x = (km: number) => ((km - firstKm) / span) * WIDTH;
        const y = (elevation: number) => HEIGHT - ((elevation - low) / rise) * (HEIGHT - 4) - 2;

        const line = profile.map((p) => `${x(p.km).toFixed(1)},${y(p.elevation).toFixed(1)}`);
        return {
            area: `M0,${HEIGHT} L${line.join(' L')} L${WIDTH},${HEIGHT} Z`,
            markerX: x(Math.min(Math.max(here, firstKm), lastKm)),
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
    {@const colour = gradientColour(current.gradient)}
    <div
        class="absolute top-0 left-1/2 -translate-x-1/2 mt-14 z-20 pointer-events-none w-fit max-w-[92vw]"
    >
        <div class="bg-background/95 rounded-md shadow-md px-2.5 py-1.5 flex flex-col gap-0.5">
            <div class="flex flex-row items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp size="14" style="color: {colour}" />
                <span>{climbs.indexOf(current) + 1}/{climbs.length}</span>
                <span>{remaining.km.toFixed(2)} km</span>
                <span>{minutes(remaining.seconds)}</span>
                <span>{current.gradient}%</span>
            </div>

            <div class="flex flex-row items-end gap-2">
                <!-- climbed so far, then the climb itself, then what is left -->
                <span class="text-lg font-semibold leading-none" style="color: {colour}">
                    +{gained}
                </span>

                {#if shape}
                    <svg width={WIDTH} height={HEIGHT} class="shrink-0">
                        <path d={shape.area} fill={colour} fill-opacity="0.35" />
                        <path
                            d={shape.area}
                            fill="none"
                            stroke={colour}
                            stroke-width="1.5"
                            stroke-linejoin="round"
                        />
                        <line
                            x1={shape.markerX}
                            y1="0"
                            x2={shape.markerX}
                            y2={HEIGHT}
                            stroke="#f59e0b"
                            stroke-width="2"
                        />
                        <circle cx={shape.markerX} cy="4" r="3" fill="#f59e0b" />
                    </svg>
                {/if}

                <span class="text-lg font-semibold leading-none">{remaining.gain}</span>
            </div>

            <div class="flex flex-row justify-between text-[10px] text-muted-foreground">
                <span>{i18n._('toolbar.climbs.climbed')}</span>
                <span>{Math.round(done * 100)}%</span>
                <span>{i18n._('toolbar.climbs.to_go')}</span>
            </div>
        </div>
    </div>
{:else if upcoming && progress}
    <div
        class="absolute top-0 left-1/2 -translate-x-1/2 mt-14 z-20 pointer-events-none w-fit max-w-[92vw]"
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
