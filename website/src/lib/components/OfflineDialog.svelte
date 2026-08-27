<script lang="ts">
    import * as Dialog from '$lib/components/ui/dialog';
    import { Button } from '$lib/components/ui/button';
    import { Label } from '$lib/components/ui/label/index.js';
    import { Slider } from '$lib/components/ui/slider';
    import { CloudDownload, LoaderCircle } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { fetchTiles, planTiles, type Progress } from '$lib/offline';
    import { gpxStatistics } from '$lib/logic/statistics';

    let { open = $bindable(false) }: { open: boolean } = $props();

    // The levels worth keeping for walking: far enough out to see where the
    // ridge goes, close enough in for the contour lines to separate.
    let zoomRange = $state([13, 16]);
    let busy = $state(false);
    let progress: Progress | undefined = $state(undefined);
    let controller: AbortController | undefined = undefined;

    let zooms = $derived(
        Array.from({ length: zoomRange[1] - zoomRange[0] + 1 }, (_, i) => zoomRange[0] + i)
    );
    // Recomputed while the dialog is open, since the plan follows the route
    // that is selected and the layers that are switched on.
    let plan = $derived(open && $gpxStatistics ? planTiles(zooms) : { urls: [], megabytes: 0 });

    // The service worker keeps 4000 tiles and drops the oldest beyond that, so
    // a plan larger than the cache would evict its own beginning.
    const CACHE_LIMIT = 4000;
    let tooMany = $derived(plan.urls.length > CACHE_LIMIT);

    async function start() {
        busy = true;
        controller = new AbortController();
        progress = { done: 0, total: plan.urls.length, failed: 0 };
        try {
            progress = await fetchTiles(plan.urls, (p) => (progress = p), controller.signal);
        } finally {
            busy = false;
            controller = undefined;
        }
    }

    function stop() {
        controller?.abort();
    }
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
                        {zoomRange[0]} – {zoomRange[1]}
                    </span>
                </Label>
                <Slider type="multiple" bind:value={zoomRange} min={10} max={18} step={1} />
            </div>

            <div class="flex flex-row justify-between text-sm">
                <span>{i18n._('offline.tiles')}</span>
                <span class="tabular-nums" class:text-destructive={tooMany}>
                    {plan.urls.length} · {plan.megabytes.toFixed(0)} MB
                </span>
            </div>

            {#if tooMany}
                <span class="text-xs text-destructive">
                    {i18n._('offline.too_many').replace('{n}', String(CACHE_LIMIT))}
                </span>
            {/if}

            {#if progress}
                <div class="flex flex-col gap-1">
                    <div class="h-2 rounded bg-muted overflow-hidden">
                        <div
                            class="h-full bg-primary"
                            style="width: {progress.total > 0
                                ? (progress.done / progress.total) * 100
                                : 0}%"
                        ></div>
                    </div>
                    <span class="text-xs text-muted-foreground tabular-nums">
                        {progress.done} / {progress.total}
                        {#if progress.failed > 0}
                            · {i18n._('offline.failed').replace('{n}', String(progress.failed))}
                        {/if}
                    </span>
                </div>
            {/if}

            <div class="flex flex-row gap-2">
                <Button
                    variant="outline"
                    class="grow gap-1.5"
                    disabled={busy || plan.urls.length === 0}
                    onclick={start}
                >
                    {#if busy}
                        <LoaderCircle size="16" class="animate-spin" />
                    {:else}
                        <CloudDownload size="16" />
                    {/if}
                    {i18n._('offline.download')}
                </Button>
                {#if busy}
                    <Button variant="outline" onclick={stop}>{i18n._('offline.stop')}</Button>
                {/if}
            </div>

            <span class="text-xs text-muted-foreground">{i18n._('offline.note')}</span>
        </div>
    </Dialog.Content>
</Dialog.Root>
