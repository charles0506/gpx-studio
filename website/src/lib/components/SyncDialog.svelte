<script lang="ts">
    import * as Dialog from '$lib/components/ui/dialog';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label/index.js';
    import { CloudDownload, CloudUpload, KeyRound, LoaderCircle, Send } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';
    import {
        collectSelection,
        collectWorkspace,
        currentSlot,
        download,
        passphrase,
        sendSelectionToCurrent,
        slot,
        slotLabels,
        slots,
        upload,
    } from '$lib/sync';
    import { selection } from '$lib/logic/selection';
    import { User } from '@lucide/svelte';

    let { open = $bindable(false) }: { open: boolean } = $props();

    let busy = $state(false);
    let message: string | undefined = $state(undefined);
    let error: string | undefined = $state(undefined);

    let openFiles = $derived(open ? collectWorkspace().length : 0);
    // Recounted whenever the list selection changes, so the button knows
    // whether there is anything to send.
    let selectedFiles = $derived(open && $selection ? collectSelection().length : 0);

    const slotName = (id: string) =>
        $slotLabels[id] ?? (id === currentSlot ? i18n._('sync.current') : id);

    async function run(action: () => Promise<string>) {
        busy = true;
        error = undefined;
        message = undefined;
        try {
            message = await action();
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            busy = false;
        }
    }
</script>

<Dialog.Root bind:open>
    <Dialog.Content class="max-w-md">
        <Dialog.Header>
            <Dialog.Title>{i18n._('sync.title')}</Dialog.Title>
            <Dialog.Description>{i18n._('sync.description')}</Dialog.Description>
        </Dialog.Header>

        <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
                <Label class="flex flex-row">
                    <User size="16" />
                    {i18n._('sync.slot')}
                </Label>
                <div class="flex flex-row gap-1">
                    {#each slots as id}
                        <Button
                            variant={$slot === id ? 'default' : 'outline'}
                            class="grow px-1 text-xs"
                            onclick={() => ($slot = id)}
                        >
                            {slotName(id)}
                        </Button>
                    {/each}
                </div>
                <Input
                    class="text-sm"
                    placeholder={i18n._('sync.slot_name')}
                    value={$slotLabels[$slot] ?? ''}
                    oninput={(event) => {
                        const name = event.currentTarget.value.trim();
                        slotLabels.update((labels) => ({ ...labels, [$slot]: name || $slot }));
                    }}
                />
            </div>

            <div class="flex flex-col gap-1">
                <Label for="sync-passphrase" class="flex flex-row">
                    <KeyRound size="16" />
                    {i18n._('sync.passphrase')}
                </Label>
                <Input
                    id="sync-passphrase"
                    type="password"
                    autocomplete="off"
                    bind:value={$passphrase}
                    placeholder={i18n._('sync.passphrase_placeholder')}
                />
            </div>

            <div class="flex flex-row gap-2">
                <Button
                    variant="outline"
                    class="grow gap-1.5"
                    disabled={busy || !$passphrase || openFiles === 0}
                    onclick={() =>
                        run(async () => {
                            const result = await upload();
                            return i18n._('sync.uploaded').replace('{n}', String(result.files));
                        })}
                >
                    {#if busy}
                        <LoaderCircle size="16" class="animate-spin" />
                    {:else}
                        <CloudUpload size="16" />
                    {/if}
                    {i18n._('sync.upload')}
                </Button>
                <Button
                    variant="outline"
                    class="grow gap-1.5"
                    disabled={busy || !$passphrase}
                    onclick={() =>
                        run(async () => {
                            const count = await download();
                            return i18n._('sync.downloaded').replace('{n}', String(count));
                        })}
                >
                    {#if busy}
                        <LoaderCircle size="16" class="animate-spin" />
                    {:else}
                        <CloudDownload size="16" />
                    {/if}
                    {i18n._('sync.download')}
                </Button>
            </div>

            <Button
                variant="outline"
                class="gap-1.5"
                disabled={busy || !$passphrase || selectedFiles === 0}
                onclick={() =>
                    run(async () => {
                        const result = await sendSelectionToCurrent();
                        return i18n._('sync.sent').replace('{n}', String(result.files));
                    })}
            >
                {#if busy}
                    <LoaderCircle size="16" class="animate-spin" />
                {:else}
                    <Send size="16" />
                {/if}
                {i18n._('sync.send_to_current')}
            </Button>

            <span class="text-xs text-muted-foreground">
                {i18n._('sync.warning')}
            </span>

            {#if error}
                <span class="text-sm text-destructive">{error}</span>
            {:else if message}
                <span class="text-sm">{message}</span>
            {/if}
        </div>
    </Dialog.Content>
</Dialog.Root>
