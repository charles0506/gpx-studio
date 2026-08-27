<script lang="ts">
    import { CloudDownload } from '@lucide/svelte';
    import { tileProgress } from '$lib/offline';

    // Rides above the file tabs: fetching tiles is something the map is doing
    // for the route you just picked, and that is where the routes are.
    let percent = $derived(
        $tileProgress && $tileProgress.total > 0
            ? ($tileProgress.done / $tileProgress.total) * 100
            : 0
    );
    let finished = $derived($tileProgress ? $tileProgress.done >= $tileProgress.total : false);
</script>

{#if $tileProgress}
    <div
        class="bg-background/95 rounded-md shadow-md px-2 py-1 flex flex-row items-center gap-2 text-xs whitespace-nowrap"
    >
        <CloudDownload size="14" class={finished ? '' : 'animate-pulse'} />
        <span class="tabular-nums">{$tileProgress.done} / {$tileProgress.total}</span>
        <span class="w-16 h-1.5 rounded bg-muted overflow-hidden">
            <span class="block h-full bg-primary" style="width: {percent}%"></span>
        </span>
        {#if $tileProgress.failed > 0}
            <span class="text-destructive tabular-nums">{$tileProgress.failed}</span>
        {/if}
    </div>
{/if}
