<script lang="ts">
    import * as Dialog from '$lib/components/ui/dialog';
    import { Label } from '$lib/components/ui/label/index.js';
    import { Slider } from '$lib/components/ui/slider';
    import { i18n } from '$lib/i18n.svelte';
    import { missingTiles, planTiles } from '$lib/offline';
    import { gpxStatistics } from '$lib/logic/statistics';
    import { settings } from '$lib/logic/settings';
    import { MAX_TILE_ENTRIES } from '$lib/offline-limits';

    const { offlineZoomRange } = settings;

    let { open = $bindable(false) }: { open: boolean } = $props();

    let zooms = $derived(
        Array.from(
            { length: $offlineZoomRange[1] - $offlineZoomRange[0] + 1 },
            (_, i) => $offlineZoomRange[0] + i
        )
    );
    // Recomputed while the dialog is open, since the plan follows the route
    // that is selected and the layers that are switched on.
    let plan = $derived(open && $gpxStatistics ? planTiles(zooms) : { urls: [], megabytes: 0 });

    let tooMany = $derived(plan.urls.length > MAX_TILE_ENTRIES);

    // What is left to fetch, which on a route already fetched is none of it.
    let missing: string[] = $state([]);
    $effect(() => {
        const urls = plan.urls;
        let current = true;
        missingTiles(urls).then((result) => {
            if (current) {
                missing = result;
            }
        });
        return () => {
            current = false;
        };
    });
</script>

<Dialog.Root bind:open>
    <Dialog.Content class="max-w-md">
        <Dialog.Header>
            <Dialog.Title>{i18n._('offline.title')}</Dialog.Title>
            <Dialog.Description>{i18n._('offline.description')}</Dialog.Description>
        </Dialog.Header>

        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
                <Label class="flex flex-row justify-between">
                    <span>{i18n._('offline.zoom_levels')}</span>
                    <span class="font-normal text-muted-foreground">
                        {$offlineZoomRange[0]} – {$offlineZoomRange[1]}
                    </span>
                </Label>
                <Slider type="multiple" bind:value={$offlineZoomRange} min={10} max={20} step={1} />
            </div>

            <!-- What the route selected right now would cost, so the slider can
                 be set against a real number rather than a guess. -->
            <div class="flex flex-row justify-between text-sm">
                <span>{i18n._('offline.tiles')}</span>
                <span class="tabular-nums" class:text-destructive={tooMany}>
                    {missing.length} / {plan.urls.length} ·
                    {((missing.length * plan.megabytes) / Math.max(plan.urls.length, 1)).toFixed(0)}
                    MB
                </span>
            </div>

            {#if tooMany}
                <span class="text-xs text-destructive">
                    {i18n._('offline.too_many').replace('{n}', String(MAX_TILE_ENTRIES))}
                </span>
            {/if}

            <span class="text-xs text-muted-foreground">{i18n._('offline.note')}</span>
        </div>
    </Dialog.Content>
</Dialog.Root>
