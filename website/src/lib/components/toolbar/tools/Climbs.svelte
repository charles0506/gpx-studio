<script lang="ts">
    import { Label } from '$lib/components/ui/label/index.js';
    import { MountainSnow, Navigation } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { gpxStatistics } from '$lib/logic/statistics';
    import {
        climbAt,
        climbGainSoFar,
        climbProgress,
        descentScale,
        findClimbsAndDescents,
        gradientColour,
        gradientScale,
        nextClimb,
        type Climb,
    } from '$lib/climbs';
    import { livePosition, progressAlongRoute } from '$lib/live-position';
    import { cumulativeHikingTime, secondsAt } from '$lib/hiking-time';

    let props: {
        class?: string;
    } = $props();

    // Read off the same tables the shading uses, so the key cannot drift from
    // what is drawn.
    const keyOf = (scale: { from: number; colour: string }[]) =>
        scale.map((step, index) => ({
            colour: step.colour,
            label:
                index === 0
                    ? `<${scale[1].from}`
                    : index === scale.length - 1
                      ? `${step.from}+`
                      : `${step.from}`,
        }));
    let key = $derived(keyOf(gradientScale));
    let descentKey = $derived(keyOf(descentScale));

    let climbs = $derived(findClimbsAndDescents($gpxStatistics));
    // Numbered within its own kind, as the map panel numbers them: the second
    // descent of the day is the second descent, not the fourth thing.
    let ordinals = $derived.by(() => {
        const counts = { climb: 0, descent: 0 };
        return climbs.map((climb) => (counts[climb.kind] += 1));
    });
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

    // What the climb still costs from where you are standing. The ascent left
    // is measured against the climb's own profile rather than pro-rated from
    // the distance left, which would flatter you on a climb that starts gently
    // and steepens.
    function remainingOf(climb: Climb): {
        km: number;
        gain: number;
        seconds: number | undefined;
    } {
        const from = progress ? Math.max(progress.km, climb.startKm) : climb.startKm;
        const startSeconds = secondsAt(walkingCurve, from);
        const endSeconds = secondsAt(walkingCurve, climb.endKm);
        return {
            km: Math.max(0, climb.endKm - from),
            gain: Math.max(0, climb.gain - climbGainSoFar(climb, from)),
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
                            <td class="pr-2 py-1 whitespace-nowrap">
                                <span
                                    class="inline-block w-2 h-2 rounded-full mr-1"
                                    style="background-color: {gradientColour(
                                        climb.gradient,
                                        climb.kind
                                    )}"
                                ></span>
                                {climb.kind === 'descent' ? '↓' : '↑'}{ordinals[index]}
                            </td>
                            <td class="pr-2 py-1 whitespace-nowrap"
                                >{climb.startKm.toFixed(1)} km</td
                            >
                            <td class="pr-2 py-1 whitespace-nowrap">
                                {(climb.endKm - climb.startKm).toFixed(2)} km
                            </td>
                            <td class="pr-2 py-1 whitespace-nowrap">
                                {climb.kind === 'descent' ? '−' : '+'}{climb.gain} m
                            </td>
                            <td class="pr-2 py-1 whitespace-nowrap">{climb.gradient}%</td>
                            <td class="py-1 whitespace-nowrap">{duration(seconds)}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        <div class="flex flex-col gap-1">
            <Label class="text-xs">{i18n._('toolbar.climbs.gradient')} (%)</Label>
            <div class="flex flex-row">
                {#each key as band}
                    <div class="grow flex flex-col items-center gap-0.5">
                        <span class="w-full h-2" style="background-color: {band.colour}"></span>
                    </div>
                {/each}
            </div>
            <div class="flex flex-row">
                {#each descentKey as band}
                    <div class="grow flex flex-col items-center gap-0.5">
                        <span class="w-full h-2" style="background-color: {band.colour}"></span>
                        <span class="text-[10px] text-muted-foreground">{band.label}</span>
                    </div>
                {/each}
            </div>
        </div>

        <span class="text-xs text-muted-foreground">
            {i18n._('toolbar.climbs.attribution')}
        </span>
    {/if}
</div>
