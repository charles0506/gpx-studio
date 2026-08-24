<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label/index.js';
    import DatePicker from '$lib/components/ui/date-picker/DatePicker.svelte';
    import { CalendarDate, type DateValue } from '@internationalized/date';
    import { CloudRain, Clock, LoaderCircle, TriangleAlert } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { gpxStatistics } from '$lib/logic/statistics';
    import {
        currentSlot,
        fetchWeather,
        isInTaiwan,
        departureTime,
        routeRainfall,
        sampleRoute,
        type WeatherPoint,
    } from '$lib/weather';
    import {
        fetchHourlyForecast,
        hourIndexFor,
        rainBetween,
        type HourlyForecast,
    } from '$lib/hourly-forecast';
    import { cumulativeHikingTime, defaultFitnessFactor, secondsAt } from '$lib/hiking-time';

    let props: {
        class?: string;
    } = $props();

    let observations: WeatherPoint[] = $state([]);
    let forecasts: HourlyForecast[] = $state([]);
    let loading = $state(false);
    let hovered: { clock: string; mm: number; probability: number } | undefined = $state(undefined);
    let error: string | undefined = $state(undefined);

    // Default to now: the common case is checking what the next few hours hold,
    // not planning a departure at dawn some other day.
    const now = new Date();
    let startDate: DateValue | undefined = $state(
        new CalendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
    );
    // Always 24-hour, whatever the browser locale would have chosen.
    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    const minutes = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

    let startHour = $state(String(now.getHours()).padStart(2, '0'));
    // Round to the nearest five minutes the list actually offers.
    let startMinute = $state(String(Math.floor(now.getMinutes() / 5) * 5).padStart(2, '0'));

    let samples = $derived(sampleRoute($gpxStatistics));

    $effect(() => {
        // Changing the selection invalidates whatever was drawn for the old one.
        void $gpxStatistics;
        $routeRainfall = [];
        $departureTime = undefined;
    });
    let hasRoute = $derived(samples.length > 0);
    let inTaiwan = $derived(samples.some((s) => isInTaiwan(s.lat, s.lon)));
    let walkingCurve = $derived(cumulativeHikingTime($gpxStatistics, defaultFitnessFactor));
    let totalSeconds = $derived(walkingCurve.at(-1)?.seconds);

    function departure(): Date {
        const day = startDate ?? new CalendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
        return new Date(day.year, day.month - 1, day.day, Number(startHour), Number(startMinute));
    }

    // Read the moment off the accumulated curve rather than scaling the total
    // by distance: a kilometre of switchbacks costs several times a kilometre of
    // valley floor, and the whole point is to know when you reach the ridge.
    function arrivalAt(km: number): Date {
        const seconds = secondsAt(walkingCurve, km) ?? 0;
        return new Date(departure().getTime() + seconds * 1000);
    }

    // Open-Meteo answers for up to sixteen days, but only for as many as are
    // asked for. A departure next weekend needs the days in between, or every
    // hour of the walk falls outside the series and the table reads as dashes.
    function forecastDays(): number {
        const daysAhead = Math.ceil((departure().getTime() - Date.now()) / 86400000);
        return Math.min(16, Math.max(3, daysAhead + 2));
    }

    async function load() {
        loading = true;
        error = undefined;
        try {
            const [taiwanData, hourly] = await Promise.all([
                fetchWeather(samples).catch(() => [] as WeatherPoint[]),
                fetchHourlyForecast(samples, forecastDays()),
            ]);
            observations = taiwanData;
            forecasts = hourly;
            publishRainfall(hourly);
            $departureTime = departure();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            forecasts = [];
        } finally {
            loading = false;
        }
    }

    // Hand the profile the rain expected at each sample, keyed by distance, so
    // it can draw it under the elevation.
    function publishRainfall(hourly: HourlyForecast[]) {
        const atSamples = hourly
            .map((forecast, index) => {
                const km = samples[index]?.at;
                if (km === undefined) {
                    return undefined;
                }
                const hour = hourIndexFor(forecast, arrivalAt(km));
                if (hour === undefined) {
                    return undefined;
                }
                return {
                    km,
                    mm: forecast.precipitation[hour] ?? 0,
                    probability: forecast.precipitationProbability[hour] ?? 0,
                };
            })
            .filter((entry) => entry !== undefined);

        // The elevation profile interpolates onto its own points, so filling in
        // between the samples here would only make it interpolate an already
        // interpolated series.
        $routeRainfall = atSamples;
    }

    function round(value: number | undefined, digits = 0): string {
        return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
    }

    function startOfHour(date: Date): Date {
        const hour = new Date(date);
        hour.setMinutes(0, 0, 0);
        return hour;
    }

    function clockOf(date: Date): string {
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    // Scale to the heaviest hour in view, with a 2 mm floor so that a drizzle
    // does not fill the plot and a dry day does not draw noise.
    function scaleMax(values: number[]): number {
        return Math.max(2, Math.ceil(Math.max(0, ...values)));
    }

    function barHeight(mm: number, max: number): number {
        return Math.min(100, Math.round((mm / max) * 100));
    }
</script>

<div class="flex flex-col gap-3 w-full max-w-[26rem] {props.class ?? ''}">
    <div class="flex flex-row gap-1.5 items-end">
        <div class="flex flex-col gap-1 grow">
            <Label class="flex flex-row">
                <Clock size="16" />
                {i18n._('toolbar.weather.departure')}
            </Label>
            <div class="flex flex-row gap-1.5">
                <DatePicker
                    bind:value={startDate}
                    locale={i18n.lang}
                    placeholder={i18n._('toolbar.time.pick_date')}
                    class="w-fit grow"
                />
                <select
                    bind:value={startHour}
                    class="border rounded-md bg-background text-sm px-1 py-1"
                    aria-label={i18n._('toolbar.weather.departure')}
                >
                    {#each hours as hour}
                        <option value={hour}>{hour}</option>
                    {/each}
                </select>
                <span class="self-center">:</span>
                <select
                    bind:value={startMinute}
                    class="border rounded-md bg-background text-sm px-1 py-1"
                    aria-label={i18n._('toolbar.weather.departure')}
                >
                    {#each minutes as minute}
                        <option value={minute}>{minute}</option>
                    {/each}
                </select>
            </div>
        </div>
    </div>

    <Button
        variant="outline"
        class="gap-1.5 text-xs px-1.5 py-1.5 h-fit"
        disabled={!hasRoute || loading}
        onclick={load}
    >
        {#if loading}
            <LoaderCircle size="14" class="animate-spin" />
        {:else}
            <CloudRain size="14" />
        {/if}
        {i18n._('toolbar.weather.button')}
    </Button>

    {#if !hasRoute}
        <span class="text-sm text-muted-foreground">
            {i18n._('toolbar.weather.help_invalid_selection')}
        </span>
    {:else if error}
        <span class="text-sm text-destructive">{error}</span>
    {:else if forecasts.length > 0}
        <div class="max-h-72 overflow-y-auto">
            <table class="w-full text-xs">
                <thead class="sticky top-0 bg-background">
                    <tr class="text-left">
                        <th class="pr-2 font-medium">{i18n._('quantities.distance')}</th>
                        <th class="pr-2 font-medium">{i18n._('toolbar.weather.arrival')}</th>
                        <th class="pr-2 font-medium">{i18n._('quantities.temperature')}</th>
                        <th class="pr-2 font-medium">{i18n._('toolbar.weather.rain_chance')}</th>
                        <th class="font-medium">{i18n._('toolbar.weather.rain_amount')}</th>
                    </tr>
                </thead>
                <tbody>
                    {#each forecasts as forecast, index}
                        {@const km = samples[index]?.at ?? 0}
                        {@const arrival = arrivalAt(km)}
                        {@const hour = hourIndexFor(forecast, arrival)}
                        <tr class="border-t">
                            <td class="pr-2 py-1 whitespace-nowrap">{round(km, 1)} km</td>
                            <td class="pr-2 py-1 whitespace-nowrap">{clockOf(arrival)}</td>
                            <td class="pr-2 py-1 whitespace-nowrap">
                                {hour === undefined
                                    ? '—'
                                    : `${round(forecast.temperature[hour], 1)}°`}
                            </td>
                            <td class="pr-2 py-1 whitespace-nowrap">
                                {hour === undefined
                                    ? '—'
                                    : `${round(forecast.precipitationProbability[hour])}%`}
                            </td>
                            <td class="py-1 whitespace-nowrap">
                                {hour === undefined
                                    ? '—'
                                    : `${round(forecast.precipitation[hour], 1)} mm`}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        {@const walk = forecasts[0]}
        {@const start = departure()}
        {@const end = new Date(start.getTime() + (totalSeconds ?? 0) * 1000)}
        {@const window = walk.times.map((t, i) => i).filter((i) => walk.times[i] >= startOfHour(start)).slice(0, 12)}
        {@const max = scaleMax(window.map((i) => walk.precipitation[i] ?? 0))}
        <div class="flex flex-col gap-1">
            <Label class="flex flex-row justify-between">
                <span>{i18n._('toolbar.weather.next_24h')}</span>
                <span class="text-muted-foreground font-normal">
                    {i18n._('toolbar.weather.total_rain')}
                    {rainBetween(walk, start, end)} mm
                </span>
            </Label>
            <div class="flex flex-row gap-1">
                <div
                    class="flex flex-col justify-between text-[10px] text-muted-foreground h-12 shrink-0 text-right"
                >
                    <span>{max} mm</span>
                    <span>0</span>
                </div>
                <div
                    class="grow flex flex-row items-end gap-px h-12 border-b border-l pl-px"
                    role="presentation"
                    onmouseleave={() => (hovered = undefined)}
                >
                    {#each window as i}
                        {@const time = walk.times[i]}
                        {@const mm = walk.precipitation[i] ?? 0}
                        <div
                            class="grow bg-sky-500/70 hover:bg-sky-400 min-h-px"
                            style="height: {barHeight(mm, max)}%"
                            role="presentation"
                            onmouseenter={() =>
                                (hovered = {
                                    clock: clockOf(time),
                                    mm,
                                    probability: walk.precipitationProbability[i] ?? 0,
                                })}
                        ></div>
                    {/each}
                </div>
            </div>
            <div class="text-xs h-4">
                {#if hovered}
                    <span class="font-medium">{hovered.clock}</span>
                    · {hovered.mm.toFixed(1)} mm · {Math.round(hovered.probability)}%
                {/if}
            </div>
            <div class="flex flex-row justify-between text-[10px] text-muted-foreground">
                {#each [0, 3, 6, 9] as offset}
                    <span>{clockOf(walk.times[window[offset]] ?? start)}</span>
                {/each}
            </div>
        </div>

        {#if observations.length > 0}
            <div class="text-xs text-muted-foreground">
                {i18n._('toolbar.weather.station')}:
                {observations[0].station?.name ?? '—'}
                {#if observations[0].station?.temperature !== undefined}
                    {round(observations[0].station.temperature, 1)}°
                    {currentSlot(observations[0].forecast?.Wx)?.value ??
                        observations[0].station?.weather ??
                        ''}
                {/if}
            </div>
        {/if}

        <span class="text-xs text-muted-foreground">
            {i18n._('toolbar.weather.attribution')}
        </span>
    {:else}
        <span class="text-sm text-muted-foreground">
            {#if !inTaiwan}
                <span class="flex flex-row gap-1 items-center">
                    <TriangleAlert size="14" />
                    {i18n._('toolbar.weather.help_outside_taiwan')}
                </span>
            {:else}
                {i18n._('toolbar.weather.help')}
            {/if}
        </span>
    {/if}
</div>
