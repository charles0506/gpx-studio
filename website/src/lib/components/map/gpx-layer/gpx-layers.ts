import { GPXFileStateCollectionObserver } from '$lib/logic/file-state';
import { get, writable } from 'svelte/store';
import { GPXLayer } from './gpx-layer';
import { map } from '$lib/components/map/map';
import { selection } from '$lib/logic/selection';
import { settings } from '$lib/logic/settings';

export class GPXLayerCollection {
    private _layers: Map<string, GPXLayer>;
    private _fileStateCollectionObserver: GPXFileStateCollectionObserver | null = null;
    private _styleHooked = false;

    constructor() {
        this._layers = new Map<string, GPXLayer>();
    }

    init() {
        if (this._fileStateCollectionObserver) {
            return;
        }
        this._fileStateCollectionObserver = new GPXFileStateCollectionObserver(
            (newFiles) => {
                newFiles.forEach((fileState, fileId) => {
                    const layer = new GPXLayer(fileId, fileState);
                    this._layers.set(fileId, layer);
                });
                this.showOnlySelected();
            },
            (fileId) => {
                const layer = this._layers.get(fileId);
                if (layer) {
                    layer.remove();
                    this._layers.delete(fileId);
                }
            },
            () => {
                this._layers.forEach((layer) => {
                    layer.remove();
                });
                this._layers.clear();
            }
        );

        selection.subscribe(() => this.showOnlySelected());
        settings.showSelectedOnly.subscribe(() => this.showOnlySelected());

        map.subscribe((instance) => {
            this.showOnlySelected();
            // Switching basemap reloads the style and re-adds every layer, which
            // brings them back visible however they were left.
            if (instance && !this._styleHooked) {
                this._styleHooked = true;
                instance.on('styledata', () => this.showOnlySelected());
            }
        });
    }

    /**
     * On the hill, every route that is not the one being walked is in the way.
     * Hiding them is done to the map layers rather than to the files: hiding a
     * file is an edit, it lands in the undo history and it outlives the walk,
     * and none of that is wanted for something switched on for an afternoon.
     */
    showOnlySelected() {
        const map_ = get(map);
        if (!map_) {
            return;
        }

        const only = get(settings.showSelectedOnly);

        const selected = new Set(
            get(selection)
                .getSelected()
                .map((item: any) => (item.getFileId ? item.getFileId() : undefined))
                .filter((id: string | undefined): id is string => id !== undefined)
        );

        this._layers.forEach((_layer, fileId) => {
            // Nothing selected would otherwise leave an empty map, which reads as
            // a bug rather than as a setting.
            const visible = !only || selected.size === 0 || selected.has(fileId);
            for (const id of [fileId, `${fileId}-direction`, `${fileId}-waypoints`]) {
                if (map_.getLayer(id)) {
                    map_.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
                }
            }
        });
    }

    getLayer(fileId: string): GPXLayer | undefined {
        return this._layers.get(fileId);
    }
}

export const gpxLayers = new GPXLayerCollection();
export const gpxColors = writable(new Map<string, string>());
