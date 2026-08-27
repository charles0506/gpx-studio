<script lang="ts">
    import { onMount } from 'svelte';
    import { Button } from '$lib/components/ui/button';
    import { RefreshCw } from '@lucide/svelte';
    import { i18n } from '$lib/i18n.svelte';

    // A new worker takes over as soon as it installs, but the page in front of
    // you is still running the code it loaded with — which is why a deploy
    // needs two visits to be seen, and why looking at yesterday's app while
    // being told today's is live has been a recurring way to lose an hour.
    //
    // Nothing reloads on its own: a page that reloads itself halfway up a hill
    // is worse than an old one.
    let available = $state(false);

    onMount(() => {
        if (!('serviceWorker' in navigator)) {
            return;
        }
        // No controller yet means this is the first install rather than an
        // update, and there is nothing to tell anyone about.
        const hadController = navigator.serviceWorker.controller !== null;
        const onChange = () => {
            if (hadController) {
                available = true;
            }
        };
        navigator.serviceWorker.addEventListener('controllerchange', onChange);
        return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange);
    });
</script>

{#if available}
    <div class="absolute bottom-14 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
        <Button
            variant="default"
            class="pointer-events-auto shadow-lg gap-1.5 h-9"
            onclick={() => location.reload()}
        >
            <RefreshCw size="16" />
            {i18n._('menu.update_available')}
        </Button>
    </div>
{/if}
