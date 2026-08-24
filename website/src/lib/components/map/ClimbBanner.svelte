<script lang="ts">
    import { i18n } from '$lib/i18n.svelte';
    import { gpxStatistics } from '$lib/logic/statistics';
    import {
        climbAt,
        climbGainSoFar,
        findClimbs,
        gradientColour,
        nextClimb,
        type Climb,
    } from '$lib/climbs';
    import { climbCursorKm, showClimbPro } from '$lib/climb-view';
    import {
        livePosition,
        progressAlongRoute,
        trackingSince,
        verticalSpeed,
    } from '$lib/live-position';
    import { cumulativeHikingTime, secondsAt } from '$lib/hiking-time';
    import { map } from '$lib/components/map/map';
    import { TrendingUp } from '@lucide/svelte';

    // Reading the climb should not mean keeping a toolbar panel open on a phone
    // in the rain, so it rides on the map. A fix places you on the route while
    // walking; at the kitchen table the profile's cursor stands in for one, so
    // the same screen answers "what is this hill like" before you set off.
    let climbs = $derived(findClimbs($gpxStatistics));
    let progress = $derived(progressAlongRoute($livePosition));
    let walkingCurve = $derived(cumulativeHikingTime($gpxStatistics));

    let here = $derived(
        progress?.km ?? ($showClimbPro ? ($climbCursorKm ?? climbs[0]?.startKm) : undefined)
    );
    let current = $derived(here === undefined ? undefined : climbAt(climbs, here));
    let upcoming = $derived(here !== undefined && !current ? nextClimb(climbs, here) : undefined);
    let visible = $derived(progress !== undefined || $showClimbPro);

    let gained = $derived(current && here !== undefined ? climbGainSoFar(current, here) : 0);

    let remaining = $derived.by(() => {
        if (!current || here === undefined) {
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

    // Metres of ascent per hour, the way a watch reports it. Recomputed on each
    // fix, since the history behind it is not itself a store.
    let climbRate = $derived.by(() => {
        void $livePosition;
        return verticalSpeed();
    });

    // The clock only ticks while the geolocate control is tracking.
    let now = $state(Date.now());
    $effect(() => {
        if (!$trackingSince) {
            return;
        }
        now = Date.now();
        const timer = setInterval(() => (now = Date.now()), 1000);
        return () => clearInterval(timer);
    });
    let elapsed = $derived(
        $trackingSince
            ? Math.max(0, Math.floor((now - $trackingSince.getTime()) / 1000))
            : undefined
    );

    // Tapping the climb opens it up. Glancing at a sparkline tells you a wall is
    // coming; reading how far and how much higher the top is wants room.
    let expanded = $state(false);

    // Opened up, it covers the map. Reaching for the map is therefore taken as
    // asking for it back: any drag or zoom folds the climb away again.
    $effect(() => {
        const instance = $map;
        if (!instance) {
            return;
        }
        const fold = () => (expanded = false);
        instance.on('dragstart', fold);
        instance.on('zoomstart', fold);
        return () => {
            instance.off('dragstart', fold);
            instance.off('zoomstart', fold);
        };
    });

    let viewportWidth = $state(0);
    $effect(() => {
        viewportWidth = window.innerWidth;
        const onResize = () => (viewportWidth = window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    });

    // The climb drawn on its own, the way a watch shows it: this hill, not the
    // whole day, and shaded by how steep each part of it is rather than by one
    // average that hides the wall at the top.
    // The map keeps a toolbar 80 px wide down the left and a stack of controls
    // down the right. Centring on the map itself puts the panel under the left
    // toolbar on a phone, so it centres in the gap between them instead, and
    // never grows wider than that gap.
    const SIDE_CONTROLS = 80 + 44 + 24;
    let width = $derived(
        Math.max(160, Math.min(expanded ? 520 : 240, (viewportWidth || 360) - SIDE_CONTROLS))
    );
    let height = $derived(expanded ? 150 : 44);
    // Gradients read off neighbouring samples of a thinned profile are noise;
    // over a hundred metres they are what the legs feel.
    const HALF_WINDOW_KM = 0.05;

    type Shape = {
        bands: { d: string; colour: string }[];
        line: string;
        markerX: number;
        markerY: number;
        /** Height above sea level under the marker, in metres. */
        markerElevation: number;
    };

    function shapeOf(climb: Climb, at: number, w: number, h: number): Shape | undefined {
        const profile = climb.profile;
        if (profile.length < 2) {
            return undefined;
        }

        const firstKm = profile[0].km;
        const lastKm = profile[profile.length - 1].km;
        const span = Math.max(lastKm - firstKm, 1e-6);
        const elevations = profile.map((p) => p.elevation);
        const low = Math.min(...elevations);
        const rise = Math.max(Math.max(...elevations) - low, 1);

        const x = (km: number) => ((km - firstKm) / span) * w;
        const y = (elevation: number) => h - ((elevation - low) / rise) * (h - 5) - 2;

        const bands = [];
        for (let i = 0; i + 1 < profile.length; i += 1) {
            const middle = (profile[i].km + profile[i + 1].km) / 2;
            let from = i;
            let to = i + 1;
            while (from > 0 && middle - profile[from].km < HALF_WINDOW_KM) from -= 1;
            while (to < profile.length - 1 && profile[to].km - middle < HALF_WINDOW_KM) to += 1;
            const run = Math.max((profile[to].km - profile[from].km) * 1000, 1);
            const gradient = ((profile[to].elevation - profile[from].elevation) / run) * 100;

            const x0 = x(profile[i].km);
            const x1 = x(profile[i + 1].km);
            const y0 = y(profile[i].elevation);
            const y1 = y(profile[i + 1].elevation);
            bands.push({
                d: `M${x0.toFixed(1)},${h} L${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)} L${x1.toFixed(1)},${h} Z`,
                colour: gradientColour(gradient),
            });
        }

        // Where you are, on the climb's own line.
        const km = Math.min(Math.max(at, firstKm), lastKm);
        let before = profile[0];
        let after = profile[profile.length - 1];
        for (let i = 0; i + 1 < profile.length; i += 1) {
            if (profile[i].km <= km && km <= profile[i + 1].km) {
                before = profile[i];
                after = profile[i + 1];
                break;
            }
        }
        const between = after.km > before.km ? (km - before.km) / (after.km - before.km) : 0;
        const elevation = before.elevation + (after.elevation - before.elevation) * between;

        return {
            bands,
            line: profile
                .map(
                    (p, i) =>
                        `${i === 0 ? 'M' : 'L'}${x(p.km).toFixed(1)},${y(p.elevation).toFixed(1)}`
                )
                .join(' '),
            markerX: x(km),
            markerY: y(elevation),
            markerElevation: Math.round(elevation),
        };
    }

    let shape = $derived(
        current && here !== undefined ? shapeOf(current, here, width, height) : undefined
    );

    function minutes(seconds: number | undefined): string {
        if (seconds === undefined) {
            return '—';
        }
        const total = Math.round(seconds / 60);
        const hours = Math.floor(total / 60);
        return hours > 0 ? `${hours} h ${total % 60} min` : `${total} min`;
    }

    function clock(seconds: number): string {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const rest = seconds % 60;
        const pad = (value: number) => value.toString().padStart(2, '0');
        return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
    }
</script>

{#if visible && current && remaining}
    {@const colour = gradientColour(current.gradient)}
    <div
        class="absolute top-0 left-20 right-11 mt-14 z-20 pointer-events-none flex flex-row justify-center"
    >
        <div
            class="{expanded
                ? 'bg-background/85'
                : 'bg-background/95'} rounded-md shadow-md px-3 py-1.5 flex flex-col gap-1"
        >
            <div class="flex flex-row items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp size="14" style="color: {colour}" />
                <span>
                    {i18n._('toolbar.climbs.climb')}
                    {climbs.indexOf(current) + 1}/{climbs.length}
                </span>
                <span class="grow"></span>
                {#if elapsed !== undefined}
                    <span class="tabular-nums">{clock(elapsed)}</span>
                {/if}
            </div>

            <!-- What is left of this climb: how far, and how much up. -->
            <div class="flex flex-row items-baseline justify-between gap-6">
                <div class="flex flex-col gap-0.5">
                    <span class="text-2xl font-semibold leading-none tabular-nums">
                        {remaining.km.toFixed(2)}<span class="text-sm font-normal ml-0.5">km</span>
                    </span>
                    {#if expanded}
                        <span class="text-[10px] leading-none text-muted-foreground">
                            {i18n._('toolbar.climbs.remaining_distance')}
                        </span>
                    {/if}
                </div>
                <div class="flex flex-col gap-0.5 items-end">
                    <span
                        class="text-2xl font-semibold leading-none tabular-nums"
                        style="color: {colour}"
                    >
                        {remaining.gain}<span class="text-sm ml-0.5">↑</span>
                    </span>
                    {#if expanded}
                        <span class="text-[10px] leading-none text-muted-foreground">
                            {i18n._('toolbar.climbs.remaining_gain')}
                        </span>
                    {/if}
                </div>
            </div>

            {#if shape}
                <!-- Tappable, so the sparkline can become something you can read
                     a summit height off. pointer-events only here: the rest of
                     the panel must not take the map's drags. -->
                <button
                    type="button"
                    class="relative pointer-events-auto cursor-pointer"
                    style="width: {width}px"
                    aria-expanded={expanded}
                    aria-label={i18n._('toolbar.climbs.climb_screen')}
                    onclick={() => (expanded = !expanded)}
                >
                    <svg {width} {height} class="block">
                        {#each shape.bands as band}
                            <path d={band.d} fill={band.colour} fill-opacity="0.75" />
                        {/each}
                        <path
                            d={shape.line}
                            fill="none"
                            stroke="#334155"
                            stroke-width="1.25"
                            stroke-linejoin="round"
                        />
                        {#if expanded}
                            <!-- Where you stand, carried across to the top so the
                                 climb left reads as a height rather than a gap. -->
                            <line
                                x1={shape.markerX}
                                y1={shape.markerY}
                                x2={width}
                                y2={shape.markerY}
                                stroke="#dc2626"
                                stroke-width="1"
                                stroke-dasharray="3 3"
                                opacity="0.6"
                            />
                        {/if}
                        <circle
                            cx={shape.markerX}
                            cy={shape.markerY}
                            r={expanded ? 5 : 4}
                            fill="#dc2626"
                            stroke="#ffffff"
                            stroke-width="1.5"
                        />
                    </svg>

                    {#if expanded}
                        <span
                            class="absolute left-1 top-0.5 text-[10px] leading-none text-slate-700 bg-white/70 rounded px-1"
                        >
                            {i18n._('toolbar.climbs.summit')}
                            {current.endElevation} m
                        </span>
                        <span
                            class="absolute left-1 bottom-0.5 text-[10px] leading-none text-slate-700 bg-white/70 rounded px-1"
                        >
                            {current.startElevation} m
                        </span>
                        <span
                            class="absolute text-[10px] leading-none text-white bg-red-600 rounded px-1 -translate-x-1/2 -translate-y-full"
                            style="left: {Math.min(
                                Math.max(shape.markerX, 24),
                                width - 24
                            )}px; top: {shape.markerY - 6}px"
                        >
                            {shape.markerElevation} m
                        </span>
                    {/if}

                    <span
                        class="absolute right-1 bottom-0.5 text-[10px] leading-none text-slate-700 bg-white/70 rounded px-1"
                    >
                        {i18n._('toolbar.climbs.average')}
                        {current.gradient}%
                    </span>
                </button>
            {/if}

            <div
                class="flex flex-row justify-between gap-3 text-[10px] leading-none text-muted-foreground"
            >
                <span>{i18n._('toolbar.climbs.climbed')} +{gained} m</span>
                <span>{minutes(remaining.seconds)}</span>
                {#if climbRate !== undefined}
                    <span>{i18n._('toolbar.climbs.vertical_speed')} {climbRate}↑</span>
                {/if}
            </div>
        </div>
    </div>
{:else if visible && upcoming && here !== undefined}
    <div
        class="absolute top-0 left-20 right-11 mt-14 z-20 pointer-events-none flex flex-row justify-center"
    >
        <div
            class="bg-background/95 rounded-md shadow-md px-2.5 py-1.5 text-sm flex flex-row items-center gap-2 whitespace-nowrap"
        >
            <TrendingUp size="16" style="color: {gradientColour(upcoming.gradient)}" />
            <span>
                {i18n._('toolbar.climbs.next')}
                {(upcoming.startKm - here).toFixed(2)} km {i18n._('toolbar.climbs.ahead')}
            </span>
            <span>↗ {upcoming.gain} m</span>
            <span>{upcoming.gradient}%</span>
        </div>
    </div>
{/if}
