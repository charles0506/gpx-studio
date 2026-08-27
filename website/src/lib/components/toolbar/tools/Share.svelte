<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label/index.js';
    import { Checkbox } from '$lib/components/ui/checkbox';
    import { Copy, KeyRound, Link, LoaderCircle, Trash2 } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { passphrase, syncSettings } from '$lib/sync';
    import { createShare, linkFor, listShares, removeShare, type ShareEntry } from '$lib/share';
    import { selection } from '$lib/logic/selection';

    let props: { class?: string } = $props();

    let shares: ShareEntry[] = $state([]);
    let busy = $state(false);
    let error: string | undefined = $state(undefined);
    let link: string | undefined = $state(undefined);
    let copied = $state(false);
    let loaded = $state(false);

    let hasSelection = $derived($selection ? $selection.size > 0 : false);

    async function run(action: () => Promise<void>) {
        busy = true;
        error = undefined;
        try {
            await action();
            shares = await listShares();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }

    $effect(() => {
        if ($passphrase && !loaded && !busy) {
            loaded = true;
            void run(async () => {});
        }
    });

    async function copy(text: string) {
        try {
            await navigator.clipboard.writeText(text);
            copied = true;
            setTimeout(() => (copied = false), 2000);
        } catch {
            // Clipboard refused; the field is there to select by hand.
        }
    }
</script>

<div class="flex flex-col gap-3 w-[min(20rem,calc(100vw-5rem))] {props.class ?? ''}">
    <span class="text-sm text-muted-foreground">{i18n._('toolbar.share.help')}</span>

    {#if !$passphrase}
        <div class="flex flex-col gap-1">
            <Label for="share-passphrase" class="flex flex-row">
                <KeyRound size="16" />
                {i18n._('sync.passphrase')}
            </Label>
            <Input
                id="share-passphrase"
                type="password"
                autocomplete="off"
                bind:value={$passphrase}
                placeholder={i18n._('sync.passphrase_placeholder')}
            />
        </div>
    {:else}
        <Label class="flex flex-row items-center gap-1.5 leading-5 font-normal">
            <Checkbox bind:checked={$syncSettings} />
            {i18n._('sync.include_settings')}
        </Label>

        <Button
            variant="outline"
            class="gap-1.5"
            disabled={busy || !hasSelection}
            onclick={() =>
                run(async () => {
                    link = await createShare($syncSettings);
                })}
        >
            {#if busy}
                <LoaderCircle size="16" class="animate-spin" />
            {:else}
                <Link size="16" />
            {/if}
            {i18n._('toolbar.share.create')}
        </Button>

        {#if link}
            <div class="flex flex-row gap-1">
                <Input class="text-xs" readonly value={link} />
                <Button variant="outline" class="shrink-0 px-2" onclick={() => copy(link!)}>
                    <Copy size="16" />
                </Button>
            </div>
            {#if copied}
                <span class="text-xs text-muted-foreground">{i18n._('toolbar.share.copied')}</span>
            {/if}
        {/if}

        {#if shares.length > 0}
            <div class="flex flex-col gap-1 max-h-48 overflow-y-auto">
                {#each shares as share (share.id)}
                    <div class="flex flex-row items-center gap-1 border rounded-md px-2 py-1">
                        <button
                            type="button"
                            class="grow min-w-0 text-left"
                            onclick={() => copy(linkFor(share.id))}
                        >
                            <span class="block truncate text-xs">{share.name || share.id}</span>
                            <span class="block text-[10px] text-muted-foreground">
                                {#if share.routes}{share.routes} ·
                                {/if}
                                {(share.createdAt ?? '').slice(0, 10)}
                            </span>
                        </button>
                        <Button
                            variant="ghost"
                            class="w-7 h-7 p-0 shrink-0"
                            disabled={busy}
                            onclick={() => run(async () => await removeShare(share.id))}
                        >
                            <Trash2 size="14" />
                        </Button>
                    </div>
                {/each}
            </div>
        {/if}
    {/if}

    {#if error}
        <span class="text-sm text-destructive">{error}</span>
    {/if}

    <span class="text-xs text-muted-foreground">{i18n._('toolbar.share.note')}</span>
</div>
