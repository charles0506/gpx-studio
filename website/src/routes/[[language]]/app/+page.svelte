<script lang="ts">
    import GPXLayers from '$lib/components/map/gpx-layer/GPXLayers.svelte';
    import ElevationProfile from '$lib/components/elevation-profile/ElevationProfile.svelte';
    import FileList from '$lib/components/file-list/FileList.svelte';
    import GPXStatistics from '$lib/components/GPXStatistics.svelte';
    import Map from '$lib/components/map/Map.svelte';
    import Menu from '$lib/components/Menu.svelte';
    import Toolbar from '$lib/components/toolbar/Toolbar.svelte';
    import StreetViewControl from '$lib/components/map/street-view-control/StreetViewControl.svelte';
    import RadarControl from '$lib/components/map/radar-control/RadarControl.svelte';
    import ClimbControl from '$lib/components/map/climb-control/ClimbControl.svelte';
    import TrailLayer from '$lib/components/map/trail/TrailLayer.svelte';
    import OfflineProgress from '$lib/components/OfflineProgress.svelte';
    import UpdatePrompt from '$lib/components/UpdatePrompt.svelte';
    // Subscribes on import: fetching tiles for a route as it is picked.
    import '$lib/offline-auto';
    // Subscribes on import: forgetting a route's tiles when it is closed.
    import '$lib/offline-registry';
    import ClimbBanner from '$lib/components/map/ClimbBanner.svelte';
    import LayerControl from '$lib/components/map/layer-control/LayerControl.svelte';
    import CoordinatesPopup from '$lib/components/map/CoordinatesPopup.svelte';
    import Resizer from '$lib/components/Resizer.svelte';
    import { Toaster } from '$lib/components/ui/sonner';
    import { i18n } from '$lib/i18n.svelte';
    import { settings } from '$lib/logic/settings';
    import { loadFiles } from '$lib/logic/file-actions';
    import { onDestroy, onMount } from 'svelte';
    import { page } from '$app/state';
    import { gpxStatistics, hoveredPoint, slicedGPXStatistics } from '$lib/logic/statistics';
    import { getURLForGoogleDriveFile } from '$lib/components/embedding/embedding';
    import { db } from '$lib/db';
    import { fileStateCollection } from '$lib/logic/file-state';
    import { askToKeepStorage } from '$lib/persistence';
    import { acceptSettings, openShare } from '$lib/share';
    import { toast } from 'svelte-sonner';

    const {
        treeFileView,
        elevationProfile,
        bottomPanelSize,
        rightPanelSize,
        additionalDatasets,
        elevationFill,
    } = settings;

    let bottomPanelWidth: number | undefined = $state();
    let bottomPanelOrientation = $derived(
        bottomPanelWidth && bottomPanelWidth >= 540 && $elevationProfile ? 'horizontal' : 'vertical'
    );

    // Stacked on a narrow screen, the statistics and the axis labels eat most of
    // the panel and the profile is left with about a hundred pixels to draw a
    // mountain in. Give it enough to be read; the resizer can still take it back.
    let panelHeight = $derived(
        bottomPanelOrientation === 'vertical' ? Math.max($bottomPanelSize, 240) : $bottomPanelSize
    );

    // Fetching the share and showing the result are reported apart. Wrapped
    // together, a failure anywhere in either read as "the link would not open",
    // which sent us looking at the wrong half. The console gets the whole error;
    // the toast gets enough to tell the two apart from a screenshot.
    async function importShare(share: string) {
        let opened;
        try {
            opened = await openShare(share);
        } catch (e) {
            console.error('[share] fetching the share failed', e);
            toast.error(`${i18n._('share.failed')}${String((e as Error)?.message ?? e)}`);
            return;
        }

        try {
            // Drop the parameter so a reload does not add the same routes a
            // second time.
            const url = new URL(window.location.href);
            url.searchParams.delete('share');
            window.history.replaceState({}, '', url);

            const count = Object.keys(opened.settings).length;
            toast.success(`${opened.routes} ${i18n._('share.opened')}`, {
                duration: count > 0 ? 15000 : 5000,
                action:
                    count > 0
                        ? {
                              label: i18n._('share.apply_settings'),
                              onClick: () => acceptSettings(opened.settings),
                          }
                        : undefined,
            });
        } catch (e) {
            // The routes are already in by this point, so this is cosmetic:
            // say so rather than claiming the link did not open.
            console.error('[share] the routes arrived but the notice failed', e);
            toast.success(`${opened.routes} ${i18n._('share.opened')}`);
        }
    }

    onMount(async () => {
        settings.connectToDatabase(db);
        fileStateCollection.connectToDatabase(db).then(() => {
            // The routes are the part that cannot be fetched again. Ask the
            // browser to keep this origin as soon as there is one to keep,
            // rather than waiting for the map tiles to make the case.
            void askToKeepStorage();
            let files: string[] = JSON.parse(page.url.searchParams.get('files') || '[]');
            let ids: string[] = JSON.parse(page.url.searchParams.get('ids') || '[]');
            let urls: string[] = files.concat(ids.map(getURLForGoogleDriveFile));

            if (urls.length > 0) {
                let downloads: Promise<File | null>[] = [];
                urls.forEach((url) => {
                    downloads.push(
                        fetch(url)
                            .then((response) => response.blob())
                            .then((blob) => new File([blob], url.split('/').pop() ?? ''))
                    );
                });

                Promise.all(downloads).then((files) => {
                    loadFiles(files.filter((file) => file !== null));
                });
            }

            // A shared link: the routes come in beside whatever is already
            // open, and the settings wait for a yes rather than rewriting the
            // basemap and the units of somebody who only wanted the walk.
            const share = page.url.searchParams.get('share');
            if (share) {
                void importShare(share);
            }
        });
    });

    onDestroy(() => {
        settings.disconnectFromDatabase();
        fileStateCollection.disconnectFromDatabase();
    });
</script>

<div class="fixed mt-[100%] -z-10 text-transparent">
    <h1>{i18n._('metadata.home_title')} — {i18n._('metadata.app_title')}</h1>
    <p>{i18n._('metadata.description')}</p>
    <h2>{i18n._('toolbar.routing.tooltip')}</h2>
    <p>{i18n._('toolbar.routing.help_no_file')}</p>
    <p>{i18n._('toolbar.routing.help')}</p>
    <h3>{i18n._('toolbar.routing.reverse.button')}</h3>
    <p>{i18n._('toolbar.routing.reverse.tooltip')}</p>
    <h3>{i18n._('toolbar.routing.route_back_to_start.button')}</h3>
    <p>{i18n._('toolbar.routing.route_back_to_start.tooltip')}</p>
    <h3>{i18n._('toolbar.routing.round_trip.button')}</h3>
    <p>{i18n._('toolbar.routing.round_trip.tooltip')}</p>
    <h3>{i18n._('toolbar.routing.start_loop_here')}</h3>
    <h2>{i18n._('toolbar.scissors.tooltip')}</h2>
    <p>{i18n._('toolbar.scissors.help')}</p>
    <h2>{i18n._('toolbar.time.tooltip')}</h2>
    <p>{i18n._('toolbar.time.help')}</p>
    <h2>{i18n._('toolbar.merge.tooltip')}</h2>
    <h3>{i18n._('toolbar.merge.merge_traces')}</h3>
    <p>{i18n._('toolbar.merge.help_merge_traces')}</p>
    <h3>{i18n._('toolbar.merge.merge_contents')}</h3>
    <p>{i18n._('toolbar.merge.help_merge_contents')}</p>
    <h2>{i18n._('toolbar.elevation.button')}</h2>
    <p>{i18n._('toolbar.elevation.help')}</p>
    <h2>{i18n._('toolbar.waypoint.tooltip')}</h2>
    <p>{i18n._('toolbar.waypoint.help')}</p>
    <h2>{i18n._('toolbar.reduce.tooltip')}</h2>
    <p>{i18n._('toolbar.reduce.help')}</p>
    <h2>{i18n._('toolbar.clean.tooltip')}</h2>
    <p>{i18n._('toolbar.clean.help')}</p>
    <h2>
        {i18n._('gpx.files')}, {i18n._('gpx.tracks')}, {i18n._('gpx.segments')}, {i18n._(
            'gpx.waypoints'
        )}
    </h2>
</div>

<div class="fixed flex flex-row w-dvw h-dvh">
    <div class="flex flex-col grow h-full min-w-0">
        <div class="grow relative">
            <Menu />
            <div
                class="absolute top-0 bottom-0 left-0 z-20 flex flex-col justify-center pointer-events-none"
            >
                <Toolbar />
            </div>
            <Map class="h-full {$treeFileView ? '' : 'horizontal'}" />
            <ClimbBanner />
            <StreetViewControl />
            <ClimbControl />
            <RadarControl />
            <LayerControl />
            <GPXLayers />
            <TrailLayer />
            <UpdatePrompt />
            <CoordinatesPopup />
            <Toaster richColors />
            <div class="absolute left-0 right-0 bottom-11 z-30 pointer-events-none px-2">
                <OfflineProgress />
            </div>
            {#if !$treeFileView}
                <div class="h-10 -translate-y-10 w-full pointer-events-none absolute z-30">
                    <FileList orientation="horizontal" />
                </div>
            {/if}
        </div>
        {#if $elevationProfile}
            <Resizer
                orientation="row"
                bind:after={$bottomPanelSize}
                minAfter={100}
                maxAfter={300}
            />
        {/if}
        <div
            bind:offsetWidth={bottomPanelWidth}
            class="flex {bottomPanelOrientation == 'vertical'
                ? 'flex-col'
                : 'flex-row py-2'} gap-1 px-4"
            style={$elevationProfile ? `height: ${panelHeight}px` : ''}
        >
            <GPXStatistics
                {gpxStatistics}
                {slicedGPXStatistics}
                orientation={bottomPanelOrientation == 'horizontal' ? 'vertical' : 'horizontal'}
            />
            {#if $elevationProfile}
                <ElevationProfile
                    {gpxStatistics}
                    {slicedGPXStatistics}
                    {hoveredPoint}
                    {additionalDatasets}
                    {elevationFill}
                />
            {/if}
        </div>
    </div>
    {#if $treeFileView}
        <Resizer orientation="col" bind:after={$rightPanelSize} minAfter={100} maxAfter={400} />
        <FileList orientation="vertical" recursive={true} style="width: {$rightPanelSize}px" />
    {/if}
</div>

<style lang="postcss">
    @reference "tailwindcss";

    div :global(.toaster.group) {
        @apply absolute;
        @apply right-2;
        --offset: 50px !important;
    }
</style>
