<script lang="ts">
    import { ScrollArea } from '$lib/components/ui/scroll-area/index';
    import * as ContextMenu from '$lib/components/ui/context-menu';
    import FileListNode from './FileListNode.svelte';
    import { onMount, setContext } from 'svelte';
    import { ListFileItem, ListLevel, ListRootItem } from './file-list';
    import { ClipboardPaste, FileStack, ListChecks, Plus, X } from '@lucide/svelte';
    import { multiSelectMode } from '$lib/logic/multi-select';
    import { Button } from '$lib/components/ui/button';
    import { settings } from '$lib/logic/settings';
    import Shortcut from '$lib/components/Shortcut.svelte';
    import { i18n } from '$lib/i18n.svelte';
    import { fileStateCollection } from '$lib/logic/file-state';
    import { createFile, pasteSelection } from '$lib/logic/file-actions';
    import { selection, copied } from '$lib/logic/selection';
    import { allowedPastes } from './sortable-file-list';
    import LibrarySection from './LibrarySection.svelte';

    let {
        orientation,
        recursive = false,
        class: className = '',
        style = '',
    }: {
        orientation: 'vertical' | 'horizontal';
        recursive?: boolean;
        class?: string;
        style?: string;
    } = $props();

    const { treeFileView } = settings;

    setContext('orientation', orientation);
    setContext('recursive', recursive);

    onMount(() => {
        if (orientation === 'horizontal') {
            selection.update(($selection) => {
                $selection.forEach((item) => {
                    if (!(item instanceof ListFileItem)) {
                        $selection.toggle(item);
                        $selection.set(new ListFileItem(item.getFileId()), true);
                    }
                });
                return $selection;
            });
        }
    });
</script>

<ScrollArea
    class="shrink-0 {orientation === 'vertical'
        ? 'p-0 pr-3'
        : // The strip sits inside a pointer-events-none overlay so the map stays
          // usable around it, and until now only the file chips themselves took
          // pointer events back. There was therefore nothing to grab to scroll
          // the row: on a phone, any file past the edge of the screen could not
          // be reached. touch-pan-x keeps the gesture a scroll rather than
          // letting it start a drag.
          'h-10 px-1 pointer-events-auto touch-pan-x'}"
    {orientation}
    scrollbarXClasses={orientation === 'vertical' ? '' : 'h-1.5'}
    scrollbarYClasses={orientation === 'vertical' ? '' : ''}
>
    <div
        class="flex {orientation === 'vertical'
            ? // The menu bar floats over the top of the map and, on a phone, is
              // wider than the map: it reaches across the panel and lands on
              // whatever is at the top of it. Below it, then, on small screens.
              'flex-col pt-12 md:pt-1 pb-1 pl-1 min-h-screen'
            : 'flex-row'} {className ?? ''}"
        {style}
    >
        {#if orientation === 'vertical'}
            <!-- The panel is opened from a menu two taps deep, and on a phone
                 that was the only way back out of it. -->
            <!-- Words rather than glyphs: this is the way out of a panel that
                 covers a phone, and an icon that can be mistaken for another
                 icon is no way out at all. -->
            <div class="flex flex-row items-center gap-1 pb-1 mb-1 border-b sticky left-0">
                <Button
                    variant="outline"
                    class="h-8 px-2 gap-1 shrink-0"
                    onclick={() => ($treeFileView = false)}
                >
                    <X size="16" />
                    <span class="text-xs">{i18n._('menu.close_short')}</span>
                </Button>
                <!-- Ctrl is what a desktop holds down to add to a selection,
                     and a phone has no way to say it. -->
                <Button
                    variant={$multiSelectMode ? 'default' : 'outline'}
                    class="h-8 px-2 gap-1 shrink-0"
                    onclick={() => multiSelectMode.update((on) => !on)}
                >
                    <ListChecks size="16" />
                    <span class="text-xs">{i18n._('menu.multi_select')}</span>
                </Button>
            </div>
        {/if}
        <FileListNode node={$fileStateCollection} item={new ListRootItem()} />
        {#if orientation === 'vertical'}
            <LibrarySection />
            <ContextMenu.Root>
                <ContextMenu.Trigger class="grow" />
                <ContextMenu.Content>
                    <ContextMenu.Item onclick={createFile}>
                        <Plus size="16" />
                        {i18n._('menu.new_file')}
                        <Shortcut key="+" ctrl={true} />
                    </ContextMenu.Item>
                    <ContextMenu.Separator />
                    <ContextMenu.Item
                        onclick={() => selection.selectAll()}
                        disabled={$fileStateCollection.size === 0}
                    >
                        <FileStack size="16" />
                        {i18n._('menu.select_all')}
                        <Shortcut key="A" ctrl={true} />
                    </ContextMenu.Item>
                    <ContextMenu.Separator />
                    <ContextMenu.Item
                        disabled={$copied === undefined ||
                            $copied.length === 0 ||
                            !allowedPastes[$copied[0].level].includes(ListLevel.ROOT)}
                        onclick={pasteSelection}
                    >
                        <ClipboardPaste size="16" />
                        {i18n._('menu.paste')}
                        <Shortcut key="V" ctrl={true} />
                    </ContextMenu.Item>
                </ContextMenu.Content>
            </ContextMenu.Root>
        {/if}
    </div>
</ScrollArea>
