import {
    clearProgressHistory,
    clearTrail,
    livePosition,
    progressAlongRoute,
    recordProgress,
    recordTrail,
    trackingSince,
} from '$lib/live-position';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import MaplibreGeocoder, {
    type MaplibreGeocoderFeatureResults,
} from '@maplibre/maplibre-gl-geocoder';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';
import { get, writable, type Writable } from 'svelte/store';
import { settings } from '$lib/logic/settings';
import { tick } from 'svelte';
import { ANCHOR_LAYER_KEY, StyleManager } from '$lib/components/map/style';
import { MapLayerEventManager } from '$lib/components/map/map-layer-event-manager';

const { treeFileView, elevationProfile, bottomPanelSize, rightPanelSize, distanceUnits } = settings;

let fitBoundsOptions: maplibregl.MapOptions['fitBoundsOptions'] = {
    maxZoom: 15,
    linear: true,
    easing: () => 1,
};

// Whether the map was following you when you last closed it. Kept out of the
// synced settings on purpose: it is about this device's screen and this
// walk, not about how the app is set up.
const TRACKING_KEY = 'geolocate-tracking';

function wasTracking(): boolean {
    try {
        return localStorage.getItem(TRACKING_KEY) === '1';
    } catch {
        return false;
    }
}

function rememberTracking(tracking: boolean): void {
    try {
        localStorage.setItem(TRACKING_KEY, tracking ? '1' : '0');
    } catch {
        // Private browsing, or storage turned off. Nothing to remember with.
    }
}

export class MapLibreGLMap {
    private _maptilerKey: string = '';
    private _map: maplibregl.Map | null = null;
    private _mapStore: Writable<maplibregl.Map | null> = writable(null);
    private _styleManager: StyleManager | null = null;
    private _onLoadCallbacks: ((map: maplibregl.Map) => void)[] = [];
    private _unsubscribes: (() => void)[] = [];
    private callOnLoadBinded: () => void = this.callOnLoad.bind(this);
    public layerEventManager: MapLayerEventManager | null = null;

    subscribe(run: (value: maplibregl.Map | null) => void, invalidate?: () => void) {
        return this._mapStore.subscribe(run, invalidate);
    }

    init(
        maptilerKey: string,
        language: string,
        hash: boolean,
        geocoder: boolean,
        geolocate: boolean
    ) {
        maplibregl.setWorkerUrl(workerUrl);
        this._maptilerKey = maptilerKey;
        this._styleManager = new StyleManager(this._mapStore, this._maptilerKey);
        const map = new maplibregl.Map({
            container: 'map',
            style: {
                version: 8,
                projection: {
                    type: 'globe',
                },
                sources: {},
                layers: [],
            },
            zoom: 0,
            hash: hash,
            boxZoom: false,
            maxPitch: 90,
            // The default control expands itself whenever the map is wide enough,
            // and on a route these credits sit across the track. Compact keeps it
            // to an ⓘ that opens on demand — the attribution is still one tap
            // away, which is what the licences ask for.
            attributionControl: { compact: true },
        });
        this.layerEventManager = new MapLayerEventManager(map);
        map.addControl(
            new maplibregl.NavigationControl({
                visualizePitch: true,
            })
        );
        if (geocoder) {
            let geocoder = new MaplibreGeocoder(
                {
                    forwardGeocode: async (config) => {
                        const results: MaplibreGeocoderFeatureResults = {
                            features: [],
                            type: 'FeatureCollection',
                        };
                        try {
                            const request = `https://nominatim.openstreetmap.org/search?format=json&q=${config.query}&limit=5&accept-language=${language}`;
                            const response = await fetch(request);
                            const geojson = await response.json();
                            results.features = geojson.map((result: any) => {
                                return {
                                    type: 'Feature',
                                    geometry: {
                                        type: 'Point',
                                        coordinates: [result.lon, result.lat],
                                    },
                                    place_name: result.display_name,
                                };
                            });
                        } catch (e) {}
                        return results;
                    },
                },
                {
                    maplibregl: maplibregl,
                    enableEventLogging: false,
                    collapsed: true,
                    flyTo: fitBoundsOptions,
                    language,
                }
            );
            map.addControl(geocoder);
        }
        if (geolocate) {
            const geolocateControl = new maplibregl.GeolocateControl({
                positionOptions: {
                    enableHighAccuracy: true,
                },
                fitBoundsOptions,
                trackUserLocation: true,
            });

            // Feed the elevation profile from the control that is already
            // watching, rather than opening a second watcher: one permission
            // prompt, one battery cost, and the dot on the map and the marker on
            // the profile can never disagree.
            geolocateControl.on('geolocate', (event: any) => {
                const position = {
                    lat: event.coords.latitude,
                    lon: event.coords.longitude,
                    accuracy: event.coords.accuracy,
                    at: new Date(event.timestamp ?? Date.now()),
                };
                // Recorded before the store is set, so that whatever recomputes
                // on the new position reads a history that already has it in.
                // Vertical speed is read from ascent behind you rather than from
                // the GPS altitude, which wanders by tens of metres while you
                // stand still.
                const progress = progressAlongRoute(position);
                if (progress) {
                    recordProgress(progress.gain, position.at);
                }
                recordTrail(position);

                livePosition.set(position);
            });
            geolocateControl.on('trackuserlocationstart', () => {
                rememberTracking(true);
                trackingSince.set(new Date());
                clearProgressHistory();
                // Each time tracking starts is a fresh walk; what was drawn
                // behind you last time is not part of this one.
                clearTrail();
            });
            const stopTracking = () => {
                rememberTracking(false);
                livePosition.set(undefined);
                trackingSince.set(undefined);
                clearProgressHistory();
            };
            geolocateControl.on('trackuserlocationend', stopTracking);
            geolocateControl.on('error', stopTracking);

            map.addControl(geolocateControl);

            // Somebody who left the app following them is still walking when
            // they open it again — at a junction, with cold hands, and the
            // last thing they want is to hunt for a button. Somebody who has
            // never used it is not asked for anything.
            //
            // Only when the browser already holds the permission: a location
            // prompt appearing on its own, before anyone has touched
            // anything, is exactly what this must not do.
            const resumeTracking = () => {
                if (!wasTracking()) {
                    return;
                }
                const start = () => geolocateControl.trigger();
                const permissions = (navigator as any).permissions;
                if (!permissions?.query) {
                    // No way to ask. The flag is only set once tracking has
                    // actually run, so the permission was granted at least
                    // once; if it has since gone, the error handler clears
                    // the flag and this does not happen twice.
                    start();
                    return;
                }
                permissions
                    .query({ name: 'geolocation' })
                    .then((status: PermissionStatus) => {
                        if (status.state === 'granted') {
                            start();
                        } else if (status.state === 'denied') {
                            rememberTracking(false);
                        }
                    })
                    .catch(() => start());
            };
            // The control cannot be triggered until the map has loaded. A
            // listener added after that has already happened never fires, so
            // the state is checked rather than assumed.
            if (map.loaded()) {
                resumeTracking();
            } else {
                map.on('load', resumeTracking);
            }
        }
        const scaleControl = new maplibregl.ScaleControl({
            unit: get(distanceUnits),
        });
        map.addControl(scaleControl);
        map.on('load', () => {
            this._map = map;
            this._mapStore.set(map); // only set the store after the map has loaded
            window._map = map; // entry point for extensions
            this.resize();
            scaleControl.setUnit(get(distanceUnits));
        });
        map.on('style.load', this.callOnLoadBinded);

        this._unsubscribes.push(treeFileView.subscribe(() => this.resize()));
        this._unsubscribes.push(elevationProfile.subscribe(() => this.resize()));
        this._unsubscribes.push(bottomPanelSize.subscribe(() => this.resize()));
        this._unsubscribes.push(rightPanelSize.subscribe(() => this.resize()));
        this._unsubscribes.push(
            distanceUnits.subscribe((units) => {
                scaleControl.setUnit(units);
            })
        );
    }

    destroy() {
        if (this._map) {
            this._map.remove();
            this._mapStore.set(null);
        }
        this._unsubscribes.forEach((unsubscribe) => unsubscribe());
        this._unsubscribes = [];
    }

    resize() {
        if (this._map) {
            tick().then(() => {
                this._map?.resize();
            });
        }
    }

    toggle3D() {
        if (this._map) {
            if (this._map.getPitch() === 0) {
                this._map.easeTo({ pitch: 70 });
            } else {
                this._map.easeTo({ pitch: 0 });
            }
        }
    }

    onLoad(callback: (map: maplibregl.Map) => void) {
        if (this._map) {
            callback(this._map);
        } else {
            this._onLoadCallbacks.push(callback);
        }
    }

    callOnLoad() {
        if (this._map && this._map.getLayer(ANCHOR_LAYER_KEY.overlays)) {
            this._onLoadCallbacks.forEach((callback) => callback(this._map!));
            this._onLoadCallbacks = [];
            this._map.off('style.load', this.callOnLoadBinded);
        }
    }
}

export const map = new MapLibreGLMap();
