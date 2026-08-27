<script lang="ts">
    import { onDestroy } from 'svelte';
    import { map } from '$lib/components/map/map';
    import { trail } from '$lib/live-position';
    import type { GeoJSONSource, Map } from 'maplibre-gl';

    // Where you have been, drawn behind you. Dashed and in a colour no route
    // file uses, because it is not one of the routes: it is a record of the
    // walk, and confusing it with the line you are meant to be following is the
    // one mistake it could cause.
    const SOURCE = 'walked-trail';

    let instance: Map | undefined = undefined;
    let unsubscribe: (() => void) | undefined = undefined;

    function data(points: { lat: number; lon: number }[]): GeoJSON.FeatureCollection {
        return {
            type: 'FeatureCollection',
            features:
                points.length < 2
                    ? []
                    : [
                          {
                              type: 'Feature',
                              properties: {},
                              geometry: {
                                  type: 'LineString',
                                  coordinates: points.map((point) => [point.lon, point.lat]),
                              },
                          },
                      ],
        };
    }

    function add(map_: Map) {
        if (!map_.getSource(SOURCE)) {
            map_.addSource(SOURCE, { type: 'geojson', data: data($trail) });
        }
        if (!map_.getLayer(SOURCE)) {
            map_.addLayer({
                id: SOURCE,
                type: 'line',
                source: SOURCE,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#a855f7',
                    'line-width': 3,
                    'line-opacity': 0.9,
                    'line-dasharray': [1, 1.6],
                },
            });
        }
    }

    map.onLoad((map_: Map) => {
        instance = map_;
        add(map_);
        // Switching basemap reloads the style, taking every layer with it.
        map_.on('styledata', () => add(map_));
        unsubscribe = trail.subscribe((points) => {
            const source = map_.getSource(SOURCE) as GeoJSONSource | undefined;
            source?.setData(data(points));
        });
    });

    onDestroy(() => {
        unsubscribe?.();
        if (instance) {
            if (instance.getLayer(SOURCE)) {
                instance.removeLayer(SOURCE);
            }
            if (instance.getSource(SOURCE)) {
                instance.removeSource(SOURCE);
            }
        }
    });
</script>
