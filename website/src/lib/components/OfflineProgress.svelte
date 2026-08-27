<script lang="ts">
    import { tileProgress } from '$lib/offline';

    // A bar the width of the map, sitting on top of the file tabs: fetching
    // tiles is something being done for the route you just picked, and that is
    // where the routes are. Thin, because it is not the thing you came to look
    // at, and wide, because a two-centimetre bar tells you nothing.
    let percent = $derived(
        $tileProgress && $tileProgress.total > 0
            ? ($tileProgress.done / $tileProgress.total) * 100
            : 0
    );
</script>

{#if $tileProgress}
    <div class="w-full flex flex-row items-center gap-2">
        <div class="grow h-1.5 rounded-full bg-background/80 shadow-sm overflow-hidden">
            <div
                class="h-full bg-primary transition-[width] duration-200"
                style="width: {percent}%"
            ></div>
        </div>
        <span
            class="text-[10px] leading-none tabular-nums text-muted-foreground bg-background/80 rounded px-1 py-0.5"
        >
            {$tileProgress.done}/{$tileProgress.total}{#if $tileProgress.failed > 0}<span
                    class="text-destructive"
                >
                    ·{$tileProgress.failed}</span
                >{/if}
        </span>
    </div>
{/if}
