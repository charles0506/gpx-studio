<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
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
    import { defaultFitnessFactor, estimateHikingTime } from '$lib/hiking-time';

    let props: {
        class?: string;
    } = $props();

    let observations: WeatherPoint[] = $state([]);
    let forecasts: HourlyForecast[] = $state([]);
    let loading = $state(false);
    let error: string | undefined = $state(undefined);

    // Default to now: the common case is checking what the next few hours hold,
    // not planning a departure at dawn some other day.
    const now = new Date();
    let startDate: DateValue | undefined = $state(
        new CalendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate())
    );
    let startTime = $state(
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    );

    let samples = $derived(sampleRoute($gpxStatistics));

    $effect(() => {
        // Changing the selection invalidates whatever was drawn for the old one.
        void $gpxStatistics;
        $routeRainfall = [];
        $departureTime = undefined;
    });
    let hasRoute = $derived(samples.length > 0);
    let inTaiwan = $derived(samples.some((s) => isInTaiwan(s.lat, s.lon)));
    let totalSeconds = $derived(estimateHikingTime($gpxStatistics, defaultFitnessFactor));
    let totalKm = $derived(samples.length > 0 ? samples[samples.length - 1].at : 0);

    function departure(): Date {
        const [hours, minutes] = startTime.split(':').map((x) => parseInt(x));
        const day = startDate ?? new CalendarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
        return new Date(day.year, day.month - 1, day.day, hours, minutes);
    }

    // Walking time is spent unevenly, but the estimate is already an
    // approximation, so distance along the route is a fair enough proxy.
    function arrivalAt(km: number): Date {
        const seconds = totalSeconds && totalKm > 0 ? (totalSeconds * km) / totalKm : 0;
        return new Date(departure().getTime() + seconds * 1000);
    }

    async function load() {
        loading = true;
        error = undefined;
        try {
            const [taiwanData, hourly] = await Promise.all([
                fetchWeather(samples).catch(() => [] as WeatherPoint[]),
                fetchHourlyForecast(samples),
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

        if (atSamples.length < 2) {
            $routeRainfall = atSamples;
            return;
        }

        // The forecast is only asked for every couple of kilometres, but a bar
        // every couple of kilometres reads as three lonely spikes rather than as
        // weather. Fill in between them so the profile carries a continuous band.
        const step = 0.25;
        const filled: typeof atSamples = [];
        for (let km = atSamples[0].km; km <= atSamples[atSamples.length - 1].km + 1e-9; km += step) {
            let next = atSamples.findIndex((entry) => entry.km >= km);
            if (next <= 0) {
                filled.push({ ...atSamples[Math.max(next, 0)], km });
                continue;
            }
            const a = atSamples[next - 1];
            const b = atSamples[next];
            const span = b.km - a.km;
            const t = span > 0 ? (km - a.km) / span : 0;
            filled.push({
                km,
                mm: a.mm + (b.mm - a.mm) * t,
                probability: a.probability + (b.probability - a.probability) * t,
            });
        }
        $routeRainfall = filled;
    }

    function round(value: number | undefined, digits = 0): string {
        return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
    }

    function clockOf(date: Date): string {
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    // Rain bars are scaled against 10 mm in an hour, which is already heavy.
    function barHeight(mm: number): number {
        return Math.min(100, Math.round((mm / 10) * 100));
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
                <Input type="time" bind:value={startTime} class="w-fit text-sm" />
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
        <div class="flex flex-col gap-1">
            <Label class="flex flex-row justify-between">
                <span>{i18n._('toolbar.weather.next_24h')}</span>
                <span class="text-muted-foreground font-normal">
                    {i18n._('toolbar.weather.total_rain')}
                    {rainBetween(walk, start, end)} mm
                </span>
            </Label>
            <div class="flex flex-row items-end gap-px h-12 border-b">
                {#each walk.times.slice(0, 24) as time, i}
                    {@const mm = walk.precipitation[i] ?? 0}
                    <div
                        class="grow bg-sky-500/70 min-h-px"
                        style="height: {barHeight(mm)}%"
                        title="{clockOf(time)} · {mm} mm · {walk.precipitationProbability[i]}%"
                    ></div>
                {/each}
            </div>
            <div class="flex flex-row justify-between text-[10px] text-muted-foreground">
                {#each [0, 6, 12, 18] as hour}
                    <span>{clockOf(walk.times[hour] ?? new Date())}</span>
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
