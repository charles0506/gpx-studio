<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { CloudUpload, Cloud, LoaderCircle, RefreshCw, Trash2 } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { passphrase } from '$lib/sync';
    import {
        listRoutes,
        openRoute,
        removeRoute,
        shelveAll,
        shelveSelection,
        type LibraryEntry,
    } from '$lib/library';
    import { settings } from '$lib/logic/settings';
    import { selection } from '$lib/logic/selection';

    // The shelf sits under the open files rather than behind a dialog: picking
    // the route for the day is the same act as picking one already open, and it
    // should look like it.
    const { fileOrder } = settings;

    let routes: LibraryEntry[] = $state([]);
    let busy = $state(false);
    let error: string | undefined = $state(undefined);
    let loaded = $state(false);
    // How far shelving the whole desk has got. It is one request per route,
    // so with thirty of them it is worth saying so.
    let working: string | undefined = $state(undefined);

    let hasSelection = $derived($selection ? $selection.size > 0 : false);
    // Nothing picked out means everything: selecting ten routes one at a
    // time on a phone, to protect them from storage that may be cleared
    // without warning, is a chore nobody does twice.
    let openFiles = $derived($fileOrder.length);

    async function run(action: () => Promise<void>, refresh = true) {
        busy = true;
        error = undefined;
        try {
            await action();
            if (refresh) {
                routes = await listRoutes();
            }
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }

    // Read once, when there is a passphrase to read it with. Refreshing after
    // that is a button, not something that happens behind you.
    $effect(() => {
        if ($passphrase && !loaded && !busy) {
            loaded = true;
            void run(async () => {});
        }
    });
</script>

<div class="flex flex-col gap-1 mt-2 pt-2 border-t">
    <div class="flex flex-row items-center gap-1 text-xs text-muted-foreground">
        <Cloud size="14" />
        <span class="grow">{i18n._('library.title')}</span>
        {#if $passphrase}
            <Button
                variant="ghost"
                class="w-6 h-6 p-0"
                disabled={busy}
                title={i18n._('library.refresh')}
                onclick={() => run(async () => {})}
            >
                {#if busy}
                    <LoaderCircle size="12" class="animate-spin" />
                {:else}
                    <RefreshCw size="12" />
                {/if}
            </Button>
            <Button
                variant="ghost"
                class="w-6 h-6 p-0"
                disabled={busy || (!hasSelection && openFiles === 0)}
                title={hasSelection ? i18n._('library.shelve') : i18n._('library.shelve_all')}
                onclick={() =>
                    run(async () => {
                        if (hasSelection) {
                            await shelveSelection();
                            return;
                        }
                        try {
                            await shelveAll((done, total) => {
                                working = `${done}/${total}`;
                            });
                        } finally {
                            working = undefined;
                        }
                    })}
            >
                <CloudUpload size="12" />
            </Button>
        {/if}
    </div>

    {#if !$passphrase}
        <Input
            type="password"
            autocomplete="off"
            class="h-7 text-xs"
            bind:value={$passphrase}
            placeholder={i18n._('sync.passphrase_placeholder')}
        />
    {:else}
        {#each routes as route (route.id)}
            <div class="flex flex-row items-center gap-1 group">
                <button
                    type="button"
                    class="grow min-w-0 text-left rounded px-1 py-0.5 hover:bg-accent disabled:opacity-50"
                    disabled={busy}
                    onclick={() => run(async () => void (await openRoute(route.id)), false)}
                >
                    <span class="block truncate text-sm">{route.name ?? route.id}</span>
                    {#if route.km || route.ascent}
                        <span class="block text-[10px] text-muted-foreground tabular-nums">
                            {#if route.km}{route.km} km{/if}
                            {#if route.ascent}· ↗ {route.ascent} m{/if}
                        </span>
                    {/if}
                </button>
                <Button
                    variant="ghost"
                    class="w-6 h-6 p-0 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    disabled={busy}
                    title={i18n._('library.remove')}
                    onclick={() =>
                        run(async () => {
                            await removeRoute(route.id);
                            // Dropped here rather than by re-reading: the listing is
                            // eventually consistent, so it would hand the route back.
                            routes = routes.filter((other) => other.id !== route.id);
                        }, false)}
                >
                    <Trash2 size="12" />
                </Button>
            </div>
        {:else}
            <span class="text-xs text-muted-foreground px-1">{i18n._('library.empty')}</span>
        {/each}
    {/if}

    {#if working}
        <span class="text-[10px] text-muted-foreground px-1 tabular-nums">
            {i18n._('library.uploading')}
            {working}
        </span>
    {/if}

    {#if error}
        <span class="text-xs text-destructive px-1">{error}</span>
    {/if}
</div>
