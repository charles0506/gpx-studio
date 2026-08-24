<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label/index.js';
    import { CloudRain, LoaderCircle, TriangleAlert } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { gpxStatistics } from '$lib/logic/statistics';
    import {
        currentSlot,
        fetchWeather,
        isInTaiwan,
        sampleRoute,
        type WeatherPoint,
    } from '$lib/weather';

    let props: {
        class?: string;
    } = $props();

    let points: WeatherPoint[] = $state([]);
    let loading = $state(false);
    let error: string | undefined = $state(undefined);

    let samples = $derived(sampleRoute($gpxStatistics));
    let hasRoute = $derived(samples.length > 0);
    let inTaiwan = $derived(samples.some((s) => isInTaiwan(s.lat, s.lon)));

    async function load() {
        loading = true;
        error = undefined;
        try {
            points = await fetchWeather(samples);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            points = [];
        } finally {
            loading = false;
        }
    }

    function round(value: number | undefined, digits = 0): string {
        return value === undefined || !Number.isFinite(value)
            ? '—'
            : value.toFixed(digits);
    }
</script>

<div class="flex flex-col gap-3 w-full max-w-96 {props.class ?? ''}">
    <Button
        variant="outline"
        class="gap-1.5 text-xs px-1.5 py-1.5 h-fit"
        disabled={!hasRoute || !inTaiwan || loading}
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
    {:else if !inTaiwan}
        <span class="text-sm text-muted-foreground flex flex-row gap-1 items-center">
            <TriangleAlert size="14" />
            {i18n._('toolbar.weather.help_outside_taiwan')}
        </span>
    {:else if error}
        <span class="text-sm text-destructive">{error}</span>
    {:else if points.length > 0}
        <div class="max-h-64 overflow-y-auto">
            <table class="w-full text-xs">
                <thead class="sticky top-0 bg-background">
                    <tr class="text-left">
                        <th class="pr-2 font-medium">{i18n._('quantities.distance')}</th>
                        <th class="pr-2 font-medium">{i18n._('toolbar.weather.station')}</th>
                        <th class="pr-2 font-medium">{i18n._('quantities.temperature')}</th>
                        <th class="pr-2 font-medium">{i18n._('toolbar.weather.rain_chance')}</th>
                        <th class="font-medium">{i18n._('toolbar.weather.conditions')}</th>
                    </tr>
                </thead>
                <tbody>
                    {#each points as point}
                        {@const pop = currentSlot(point.forecast?.PoP)}
                        {@const wx = currentSlot(point.forecast?.Wx)}
                        <tr class="border-t">
                            <td class="pr-2 py-1 whitespace-nowrap">{round(point.at, 1)} km</td>
                            <td class="pr-2 py-1">
                                {point.station?.name ?? '—'}
                                {#if point.station?.distanceKm !== undefined}
                                    <span class="text-muted-foreground">
                                        {round(point.station.distanceKm, 1)} km
                                    </span>
                                {/if}
                            </td>
                            <td class="pr-2 py-1 whitespace-nowrap">
                                {round(point.station?.temperature, 1)}°
                            </td>
                            <td class="pr-2 py-1 whitespace-nowrap">
                                {pop?.value !== undefined ? `${pop.value}%` : '—'}
                            </td>
                            <td class="py-1">{wx?.value ?? point.station?.weather ?? '—'}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
        <span class="text-xs text-muted-foreground">
            {i18n._('toolbar.weather.attribution')}
        </span>
    {:else}
        <span class="text-sm text-muted-foreground">
            {i18n._('toolbar.weather.help')}
        </span>
    {/if}
</div>
