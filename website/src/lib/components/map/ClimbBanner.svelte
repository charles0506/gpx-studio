<script lang="ts">
    import { i18n } from '$lib/i18n.svelte';
    import { gpxStatistics } from '$lib/logic/statistics';
    import {
        climbAt,
        climbGainSoFar,
        findClimbsAndDescents,
        gradientAtKm,
        gradientColour,
        nextClimb,
        routeSamples,
        type Climb,
    } from '$lib/climbs';
    import { climbCursorKm, climbScreen } from '$lib/climb-view';
    import { currentTool } from '$lib/components/toolbar/tools';
    import {
        livePosition,
        OFF_ROUTE_METERS,
        progressAlongRoute,
        trackingSince,
        verticalSpeed,
    } from '$lib/live-position';
    import { cumulativeHikingTime, secondsAt } from '$lib/hiking-time';
    import { map } from '$lib/components/map/map';
    import { Flag, TrendingDown, TrendingUp } from '@lucide/svelte';

    // Reading the climb should not mean keeping a toolbar panel open on a phone
    // in the rain, so it rides on the map. A fix places you on the route while
    // walking; at the kitchen table the profile's cursor stands in for one, so
    // the same screen answers "what is this hill like" before you set off.
    // Descents are shown on the same screen: the knees pay for a long steep
    // drop as surely as the lungs pay for the climb, and switching panels
    // halfway down a 古道 is not something anyone does.
    let climbs = $derived(findClimbsAndDescents($gpxStatistics));
    let progress = $derived(progressAlongRoute($livePosition));
    let walkingCurve = $derived(cumulativeHikingTime($gpxStatistics));

    let tracking = $derived(progress !== undefined);
    // 'auto' is the walking setting: the panel belongs on the map while a fix
    // is placing you on the route, and nowhere near it otherwise. 'on' holds it
    // open to read a hill at the table, and 'off' means off even while
    // following, which is the one the map owed you.
    let visible = $derived($climbScreen === 'on' || ($climbScreen === 'auto' && tracking));

    // A tool panel opens in the same corner. On a phone there is not room
    // for both, and the panel is the thing being read — the banner would be
    // sitting on its first two lines. Wide enough and they do not meet, so
    // the banner stays.
    let stepAside = $derived($currentTool !== null ? 'hidden md:flex' : 'flex');

    // Past the last climb or descent nothing is found here and nothing ahead,
    // and the screen closes rather than holding the one just walked on the map.
    let here = $derived(
        progress?.km ??
            ($climbScreen === 'on' ? ($climbCursorKm ?? climbs[0]?.startKm ?? 0) : undefined)
    );
    let current = $derived(here === undefined ? undefined : climbAt(climbs, here));
    let upcoming = $derived(here !== undefined && !current ? nextClimb(climbs, here) : undefined);

    // What is left when the hills are done. Read off the walking curve rather
    // than the statistics' own total, so the distance and the time can never
    // disagree about where the route ends.
    let toFinish = $derived.by(() => {
        if (here === undefined) {
            return undefined;
        }
        const finish = walkingCurve.at(-1);
        if (!finish) {
            return undefined;
        }
        const done = secondsAt(walkingCurve, here);
        return {
            km: Math.max(0, finish.km - here),
            seconds: done === undefined ? undefined : Math.max(0, finish.seconds - done),
        };
    });

    // The ground underfoot, which the short strips have no climb to describe:
    // between two climbs, or on the walk out, the gradient here is the only
    // thing left that says anything about the walking.
    let samples = $derived(routeSamples($gpxStatistics));
    let underfoot = $derived(here === undefined ? undefined : gradientAtKm(samples, here));

    // A fix is projected onto the nearest point of the route however far away
    // it is, so without this the panel counts down a climb you are not on.
    let strayed = $derived(
        progress && progress.offRouteMeters > OFF_ROUTE_METERS ? progress.offRouteMeters : undefined
    );

    let gained = $derived(current && here !== undefined ? climbGainSoFar(current, here) : 0);

    // Numbered within its own kind, the way a watch counts them: the second
    // descent of the day is "2/3", not "4/6".
    let ofKind = $derived(current ? climbs.filter((c) => c.kind === current.kind) : []);
    let position = $derived(current ? ofKind.indexOf(current) + 1 : 0);

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
        // Following your own position recentres the map on every fix, and that
        // camera move is a zoom like any other: without the check, the climb
        // would fold itself away each time the GPS reported in.
        const fold = (event?: { geolocateSource?: boolean }) => {
            if (event?.geolocateSource) {
                return;
            }
            expanded = false;
        };
        instance.on('dragstart', fold);
        instance.on('zoomstart', fold);
        return () => {
            instance.off('dragstart', fold);
            instance.off('zoomstart', fold);
        };
    });

    // How much map the panel is standing on, measured rather than guessed: it
    // changes with the climb, the language and whether the climb is open.
    let cardHeight = $state(0);
    // Distance from the top of the map to the top of the panel, from mt-14.
    const PANEL_TOP = 56;

    // Following your own position centres the map on you, and the open panel is
    // over that centre. Padding the top of the map moves the centre down into
    // the space below the panel, so the dot the map is following stays in sight.
    // Only while following, and only while open: the folded strip clears the
    // centre by itself, and off the trail this would shift every camera move,
    // including the one that frames a file when it is opened.
    $effect(() => {
        const instance = $map;
        if (!instance || !tracking || !visible || !expanded || !cardHeight) {
            return;
        }
        instance.setPadding({ top: PANEL_TOP + cardHeight + 8, bottom: 0, left: 0, right: 0 });
        return () => instance.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
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
    // The map keeps a toolbar down the left and a stack of controls down the
    // right. Centring on the map itself puts the panel under the left toolbar on
    // a phone, so it centres in the gap between them instead, and never grows
    // wider than that gap. The toolbar is 32 px of buttons; the 80 px box around
    // it is a transparent centring wrapper, and measuring that instead left a
    // finger's width of map showing down the left of the panel for nothing.
    const SIDE_CONTROLS = 40 + 44 + 24;
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
        /** How steep the ground is under the marker, as a percentage. */
        markerGradient: number;
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

        const gradientAt = (index: number) => {
            const middle = (profile[index].km + profile[index + 1].km) / 2;
            let from = index;
            let to = index + 1;
            while (from > 0 && middle - profile[from].km < HALF_WINDOW_KM) from -= 1;
            while (to < profile.length - 1 && profile[to].km - middle < HALF_WINDOW_KM) to += 1;
            const run = Math.max((profile[to].km - profile[from].km) * 1000, 1);
            return ((profile[to].elevation - profile[from].elevation) / run) * 100;
        };

        const bands = [];
        for (let i = 0; i + 1 < profile.length; i += 1) {
            const gradient = gradientAt(i);

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
        let segment = 0;
        for (let i = 0; i + 1 < profile.length; i += 1) {
            if (profile[i].km <= km && km <= profile[i + 1].km) {
                before = profile[i];
                after = profile[i + 1];
                segment = i;
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
            markerGradient: Math.round(gradientAt(segment) * 10) / 10,
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

{#snippet ground(gradient: number)}
    <span
        class="rounded px-1 text-white text-xs"
        style="background-color: {gradientColour(gradient, gradient < 0 ? 'descent' : 'climb')}"
    >
        {Math.abs(gradient) < 1 ? '' : gradient > 0 ? '↗' : '↘'}{Math.abs(gradient)}%
    </span>
{/snippet}

{#if visible && current && remaining}
    {@const colour = gradientColour(shape?.markerGradient ?? current.gradient, current.kind)}
    {@const falling = current.kind === 'descent'}
    <div
        class="absolute top-0 left-10 right-11 mt-14 z-20 pointer-events-none {stepAside} flex-row justify-center"
    >
        <div
            bind:clientHeight={cardHeight}
            class="{expanded
                ? 'bg-background/85'
                : 'bg-background/95'} rounded-md shadow-md px-3 py-1.5 flex flex-col gap-1"
        >
            <div class="flex flex-row items-center gap-2 text-xs text-muted-foreground">
                {#if falling}
                    <TrendingDown size="14" style="color: {colour}" />
                {:else}
                    <TrendingUp size="14" style="color: {colour}" />
                {/if}
                <span>
                    {i18n._(falling ? 'toolbar.climbs.descent' : 'toolbar.climbs.climb')}
                    {position}/{ofKind.length}
                </span>
                <span class="grow"></span>
                {#if strayed !== undefined}
                    <span class="text-amber-600 dark:text-amber-500 whitespace-nowrap">
                        ⚠ {i18n._('toolbar.climbs.off_route')}
                        {strayed} m
                    </span>
                {/if}
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
                        {remaining.gain}<span class="text-sm ml-0.5">{falling ? '↓' : '↑'}</span>
                    </span>
                    {#if expanded}
                        <span class="text-[10px] leading-none text-muted-foreground">
                            {i18n._(
                                falling
                                    ? 'toolbar.climbs.remaining_descent'
                                    : 'toolbar.climbs.remaining_gain'
                            )}
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
                                stroke="#ffffff"
                                stroke-width="1.5"
                                stroke-dasharray="3 3"
                                opacity="0.9"
                            />
                        {/if}
                        <circle
                            cx={shape.markerX}
                            cy={shape.markerY}
                            r={expanded ? 5 : 4}
                            fill="#ffffff"
                            stroke="#0f172a"
                            stroke-width="2"
                        />
                    </svg>

                    {#if expanded}
                        <span
                            class="absolute left-1 top-0.5 text-[10px] leading-none text-slate-700 bg-white/70 rounded px-1"
                        >
                            {falling ? '' : i18n._('toolbar.climbs.summit')}
                            {Math.max(current.startElevation, current.endElevation)} m
                        </span>
                        <span
                            class="absolute left-1 bottom-0.5 text-[10px] leading-none text-slate-700 bg-white/70 rounded px-1"
                        >
                            {falling ? i18n._('toolbar.climbs.bottom') : ''}
                            {Math.min(current.startElevation, current.endElevation)} m
                        </span>
                        <span
                            class="absolute text-[10px] leading-none text-white bg-slate-900/85 rounded px-1 -translate-x-1/2 -translate-y-full"
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
                        {Math.abs(shape.markerGradient)}%
                    </span>
                </button>
            {/if}

            <div
                class="flex flex-row justify-between gap-3 text-[10px] leading-none text-muted-foreground"
            >
                <span>
                    {i18n._(falling ? 'toolbar.climbs.descended' : 'toolbar.climbs.climbed')}
                    {falling ? '' : '+'}{gained} m
                </span>
                <span>{minutes(remaining.seconds)}</span>
                {#if climbRate !== undefined && !falling}
                    <span>{i18n._('toolbar.climbs.vertical_speed')} {climbRate}↑</span>
                {/if}
            </div>
        </div>
    </div>
{:else if visible && upcoming && here !== undefined}
    {@const ahead = upcoming.kind === 'descent'}
    <div
        class="absolute top-0 left-10 right-11 mt-14 z-20 pointer-events-none {stepAside} flex-row justify-center"
    >
        <div
            bind:clientHeight={cardHeight}
            class="bg-background/95 rounded-md shadow-md px-2.5 py-1.5 text-sm flex flex-row items-center gap-2 whitespace-nowrap"
        >
            {#if underfoot !== undefined}
                {@render ground(underfoot)}
            {/if}
            {#if ahead}
                <TrendingDown
                    size="16"
                    style="color: {gradientColour(upcoming.gradient, upcoming.kind)}"
                />
            {:else}
                <TrendingUp
                    size="16"
                    style="color: {gradientColour(upcoming.gradient, upcoming.kind)}"
                />
            {/if}
            <span>
                {i18n._(ahead ? 'toolbar.climbs.next_descent' : 'toolbar.climbs.next')}
                {(upcoming.startKm - here).toFixed(2)} km {i18n._('toolbar.climbs.ahead')}
            </span>
            <span>{ahead ? '↘' : '↗'} {upcoming.gain} m</span>
        </div>
    </div>
{:else if visible && toFinish}
    <div
        class="absolute top-0 left-10 right-11 mt-14 z-20 pointer-events-none {stepAside} flex-row justify-center"
    >
        <div
            bind:clientHeight={cardHeight}
            class="bg-background/95 rounded-md shadow-md px-2.5 py-1.5 text-sm flex flex-row items-center gap-2 whitespace-nowrap"
        >
            {#if underfoot !== undefined}
                {@render ground(underfoot)}
            {/if}
            <Flag size="16" />
            <span>
                {i18n._('toolbar.climbs.to_finish')}
                {toFinish.km.toFixed(2)} km
            </span>
            <span>{minutes(toFinish.seconds)}</span>
        </div>
    </div>
{/if}
