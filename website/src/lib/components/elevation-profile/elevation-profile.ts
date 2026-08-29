import { i18n } from '$lib/i18n.svelte';
import { settings } from '$lib/logic/settings';
import {
    getCadenceWithUnits,
    getConvertedDistance,
    getConvertedElevation,
    getConvertedTemperature,
    getConvertedVelocity,
    getDistanceUnits,
    getDistanceWithUnits,
    getElevationWithUnits,
    getHeartRateWithUnits,
    getPowerWithUnits,
    getTemperatureWithUnits,
    getVelocityWithUnits,
} from '$lib/units';
import Chart, {
    type ChartEvent,
    type ChartOptions,
    type ScriptableLineSegmentContext,
    type TooltipItem,
} from 'chart.js/auto';
import { get, type Readable, type Writable } from 'svelte/store';
import type { Coordinates, GPXGlobalStatistics, GPXStatisticsGroup } from 'gpx';
import { getHighwayColor, getSlopeColor, getSurfaceColor } from '$lib/assets/colors';
import { departureTime, routeRainfall } from '$lib/weather';
import { livePosition, OFF_ROUTE_METERS, progressAlongRoute } from '$lib/live-position';
import { climbCursorKm } from '$lib/climb-view';
import { climbAt, findClimbsAndDescents, gradientColour } from '$lib/climbs';
import { cumulativeHikingTime, secondsAt, type HikingTimePoint } from '$lib/hiking-time';

const { distanceUnits, velocityUnits, temperatureUnits } = settings;

Chart.defaults.font.family =
    'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'; // Tailwind CSS font

// The chart works in display units; the rainfall store is in kilometres.
function getUnconvertedDistance(value: number, unit: 'metric' | 'imperial' | 'nautical'): number {
    if (unit === 'imperial') return value * 1.609344;
    if (unit === 'nautical') return value * 1.852;
    return value;
}

function interpolateRainfall(
    rainfall: { km: number; mm: number; probability: number }[],
    km: number
): { mm: number; probability: number } | undefined {
    if (rainfall.length === 0) return undefined;
    if (km <= rainfall[0].km) return rainfall[0];
    if (km >= rainfall[rainfall.length - 1].km) return rainfall[rainfall.length - 1];

    for (let i = 1; i < rainfall.length; i++) {
        if (rainfall[i].km >= km) {
            const a = rainfall[i - 1];
            const b = rainfall[i];
            const span = b.km - a.km;
            const t = span > 0 ? (km - a.km) / span : 0;
            return {
                mm: a.mm + (b.mm - a.mm) * t,
                probability: a.probability + (b.probability - a.probability) * t,
            };
        }
    }
    return rainfall[rainfall.length - 1];
}
interface ElevationProfilePoint {
    x: number;
    y: number;
    /** Distance along the route in kilometres, before any unit conversion. */
    km: number;
    time?: Date;
    slope: {
        at: number;
        segment: number;
        length: number;
    };
    extensions: Record<string, any>;
    coordinates: Coordinates;
    index: number;
}

export class ElevationProfile {
    private _chart: Chart | null = null;
    // Where the arrow keys will step from, and whether they should: the keys
    // belong to the chart only while the pointer is over it.
    private _cursorIndex = 0;
    private _pointerOver = false;
    private _onKeyDown: ((event: KeyboardEvent) => void) | null = null;
    private _onPointerGone: ((event: PointerEvent) => void) | null = null;
    private _canvas: HTMLCanvasElement;
    private _overlay: HTMLCanvasElement;
    private _dragging = false;
    private _panning = false;

    private _gpxStatistics: Readable<GPXStatisticsGroup>;
    private _slicedGPXStatistics: Writable<[GPXGlobalStatistics, number, number] | undefined>;
    private _hoveredPoint: Writable<Coordinates | null>;
    private _walkingCurve: HikingTimePoint[] = [];
    private _additionalDatasets: Readable<string[]>;
    private _elevationFill: Readable<'slope' | 'surface' | 'highway' | undefined>;

    constructor(
        gpxStatistics: Readable<GPXStatisticsGroup>,
        slicedGPXStatistics: Writable<[GPXGlobalStatistics, number, number] | undefined>,
        hoveredPoint: Writable<Coordinates | null>,
        additionalDatasets: Readable<string[]>,
        elevationFill: Readable<'slope' | 'surface' | 'highway' | undefined>,
        canvas: HTMLCanvasElement,
        overlay: HTMLCanvasElement
    ) {
        this._gpxStatistics = gpxStatistics;
        this._slicedGPXStatistics = slicedGPXStatistics;
        this._hoveredPoint = hoveredPoint;
        this._additionalDatasets = additionalDatasets;
        this._elevationFill = elevationFill;
        this._canvas = canvas;
        this._overlay = overlay;

        import('chartjs-plugin-zoom').then((module) => {
            Chart.register(module.default);
            this.initialize();

            this._gpxStatistics.subscribe(() => {
                // A different route: where the last one was pointed at means
                // nothing here, and left alone it points the climb screen at a
                // stretch of the new route that has no climb on it.
                climbCursorKm.set(undefined);
                this.updateData();
            });
            this._slicedGPXStatistics.subscribe(() => {
                this.updateOverlay();
            });
            distanceUnits.subscribe(() => {
                this.updateData();
            });
            velocityUnits.subscribe(() => {
                this.updateData();
            });
            temperatureUnits.subscribe(() => {
                this.updateData();
            });
            routeRainfall.subscribe(() => {
                this.updateData();
            });
            departureTime.subscribe(() => {
                this.updateData();
            });
            livePosition.subscribe(() => {
                this.updateOverlay();
            });
            this._additionalDatasets.subscribe(() => {
                this.updateDataVisibility();
            });
            this._elevationFill.subscribe(() => {
                this.updateFill();
            });
        });
    }

    initialize() {
        let options: ChartOptions<'line'> = {
            animation: false,
            parsing: false,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'linear',
                    ticks: {
                        // With a departure time set, the axis answers when as
                        // well as how far.
                        callback: (value: number | string) => {
                            const distance = `${(value as number).toFixed(1).replace(/\.0+$/, '')} ${getDistanceUnits()}`;
                            const clock = this.clockAt(value as number);
                            return clock === undefined ? distance : [distance, clock];
                        },
                        align: 'inner',
                        maxRotation: 0,
                        color: '#4b5563',
                    },
                    grid: { color: 'rgba(0, 0, 0, 0.08)' },
                    border: { color: 'rgba(0, 0, 0, 0.2)' },
                },
                y: {
                    type: 'linear',
                    ticks: {
                        callback: function (value: number | string) {
                            return getElevationWithUnits(value as number, false);
                        },
                        color: '#4b5563',
                    },
                    grid: { color: 'rgba(0, 0, 0, 0.08)' },
                    border: { color: 'rgba(0, 0, 0, 0.2)' },
                },
            },
            datasets: {
                line: {
                    pointRadius: 0,
                    tension: 0.4,
                    borderWidth: 2,
                    cubicInterpolationMode: 'monotone',
                },
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: false,
                },
                decimation: {
                    enabled: true,
                },
                tooltip: {
                    enabled: () => !this._dragging && !this._panning,
                    callbacks: {
                        title: () => {
                            return '';
                        },
                        label: (context: TooltipItem<'line'>) => {
                            let point = context.raw as ElevationProfilePoint;
                            if (context.datasetIndex === 0) {
                                return `${i18n._('quantities.elevation')}: ${getElevationWithUnits(point.y, false)}`;
                            } else if (context.datasetIndex === 1) {
                                return `${get(velocityUnits) === 'speed' ? i18n._('quantities.speed') : i18n._('quantities.pace')}: ${getVelocityWithUnits(point.y, false)}`;
                            } else if (context.datasetIndex === 2) {
                                return `${i18n._('quantities.heartrate')}: ${getHeartRateWithUnits(point.y)}`;
                            } else if (context.datasetIndex === 3) {
                                return `${i18n._('quantities.cadence')}: ${getCadenceWithUnits(point.y)}`;
                            } else if (context.datasetIndex === 4) {
                                return `${i18n._('quantities.temperature')}: ${getTemperatureWithUnits(point.y, false)}`;
                            } else if (context.datasetIndex === 5) {
                                return `${i18n._('quantities.power')}: ${getPowerWithUnits(point.y)}`;
                            } else if (context.datasetIndex === 6) {
                                const probability = (point as any).probability;
                                return `${i18n._('toolbar.weather.rain_amount')}: ${point.y.toFixed(1)} mm${
                                    probability === undefined
                                        ? ''
                                        : ` (${Math.round(probability)}%)`
                                }`;
                            }
                        },
                        afterBody: (contexts: TooltipItem<'line'>[]) => {
                            let context = contexts.filter((context) => context.datasetIndex === 0);
                            if (context.length === 0) return;
                            let point = context[0].raw as ElevationProfilePoint;

                            // Drives the marker on the map.
                            this._hoveredPoint.set(this._dragging ? null : point.coordinates);
                            // And stands in for a GPS fix on the climb screen.
                            climbCursorKm.set(point.km);
                            this._cursorIndex = point.index;
                            let slope = {
                                at: point.slope.at.toFixed(1),
                                segment: point.slope.segment.toFixed(1),
                                length: getDistanceWithUnits(point.slope.length),
                            };
                            let surface = point.extensions.surface
                                ? point.extensions.surface
                                : 'unknown';
                            let highway = point.extensions.highway
                                ? point.extensions.highway
                                : 'unknown';
                            let sacScale = point.extensions.sac_scale;
                            let mtbScale = point.extensions.mtb_scale;

                            let labels = [
                                `    ${i18n._('quantities.distance')}: ${getDistanceWithUnits(point.x, false)}`,
                                `    ${i18n._('quantities.slope')}: ${slope.at} %${get(this._elevationFill) === 'slope' ? ` (${slope.length} @${slope.segment} %)` : ''}`,
                            ];

                            if (get(this._elevationFill) === 'surface') {
                                labels.push(
                                    `    ${i18n._('quantities.surface')}: ${i18n._(`toolbar.routing.surface.${surface}`)}`
                                );
                            }

                            if (get(this._elevationFill) === 'highway') {
                                labels.push(
                                    `    ${i18n._('quantities.highway')}: ${i18n._(`toolbar.routing.highway.${highway}`)}${
                                        sacScale
                                            ? ` (${i18n._(`toolbar.routing.sac_scale.${sacScale}`)})`
                                            : ''
                                    }`
                                );
                                if (mtbScale) {
                                    labels.push(
                                        `    ${i18n._('toolbar.routing.mtb_scale')}: ${mtbScale}`
                                    );
                                }
                            }

                            if (point.time) {
                                labels.push(
                                    `    ${i18n._('quantities.time')}: ${i18n.df.format(point.time)}`
                                );
                            }

                            return labels;
                        },
                    },
                },
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        modifierKey: 'shift',
                        // The modifier is only consulted for a mouse: left to
                        // itself the gesture library pans on any one-finger
                        // drag, which is the same drag that reads the profile.
                        // Unzoomed it went unnoticed because there was nothing
                        // to pan; zoomed in it fights the cursor. So touch does
                        // not pan — one finger reads, two pinch, and a pinch
                        // carries the view along with it.
                        onPanStart: ({ event }: { event?: { pointerType?: string } }) => {
                            if (event?.pointerType === 'touch') {
                                return false;
                            }
                            this._panning = true;
                            this._slicedGPXStatistics.set(undefined);
                            return true;
                        },
                        onPanComplete: () => {
                            this._panning = false;
                        },
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                        },
                        // Two fingers spread apart is how every map on the
                        // phone zooms, and until now the profile was the one
                        // thing on the screen that would not.
                        pinch: {
                            enabled: true,
                        },
                        mode: 'x',
                        onZoomStart: ({ chart, event }: { chart: Chart; event: any }) => {
                            if (!this._chart) {
                                return false;
                            }
                            const maxZoom = this._chart.getInitialScaleBounds()?.x?.max ?? 0;
                            if (
                                event.deltaY < 0 &&
                                Math.abs(maxZoom / this._chart.getZoomLevel()) < 0.01
                            ) {
                                // Disable wheel pan if zoomed in to the max, and zooming in
                                return false;
                            }

                            this._slicedGPXStatistics.set(undefined);
                        },
                    },
                    limits: {
                        x: {
                            min: 'original',
                            max: 'original',
                            minRange: 1,
                        },
                    },
                },
            },
            onResize: () => {
                this.updateOverlay();
            },
        };

        options.scales!['yrain'] = {
            type: 'linear',
            position: 'right',
            grid: { display: false },
            display: false,
            min: 0,
            // Ten millimetres in an hour is already heavy rain, so the scale
            // stays put until the forecast exceeds that and the bars would
            // otherwise leave the plot.
            suggestedMax: 10,
        };

        let datasets: string[] = ['speed', 'hr', 'cad', 'atemp', 'power'];
        datasets.forEach((id) => {
            options.scales![`y${id}`] = {
                type: 'linear',
                position: 'right',
                grid: {
                    display: false,
                },
                reverse: () => id === 'speed' && get(velocityUnits) === 'pace',
                display: false,
            };
        });

        this._chart = new Chart(this._canvas, {
            type: 'line',
            data: {
                datasets: [],
            },
            options,
            plugins: [
                {
                    id: 'toggleMarker',
                    events: ['mouseout'],
                    afterEvent: (chart: Chart, args: { event: ChartEvent }) => {
                        if (args.event.type === 'mouseout') {
                            this._hoveredPoint.set(null);
                        }
                    },
                },
            ],
        });

        let startIndex = 0;
        let endIndex = 0;
        // The same as getIndex, from a position rather than an event: the
        // view scrolling under a finger that has not moved needs to know what
        // is under it now, and there is no new event to ask.
        const getIndexAt = (offsetX: number, offsetY: number) => {
            const rect = this._canvas.getBoundingClientRect();
            return getIndex({
                x: rect.left + offsetX,
                y: rect.top + offsetY,
                offsetX,
                offsetY,
                clientX: rect.left + offsetX,
                clientY: rect.top + offsetY,
            } as unknown as PointerEvent);
        };

        // Where along the route a data index falls.
        const kmAt = (index: number | undefined) => {
            const data = this._chart?.data.datasets[0]?.data as any[] | undefined;
            if (!data || index === undefined) {
                return undefined;
            }
            const point = data.find((candidate) => candidate?.index === index) ?? data[index];
            return typeof point?.km === 'number' ? (point.km as number) : undefined;
        };

        const getIndex = (evt: PointerEvent) => {
            if (!this._chart) {
                return undefined;
            }
            const points = this._chart.getElementsAtEventForMode(
                evt,
                'x',
                {
                    intersect: false,
                },
                true
            );

            if (points.length === 0) {
                const rect = this._canvas.getBoundingClientRect();
                if (evt.x - rect.left <= this._chart.chartArea.left) {
                    return 0;
                } else if (evt.x - rect.left >= this._chart.chartArea.right) {
                    return this._chart.data.datasets[0].data.length - 1;
                } else {
                    return undefined;
                }
            }

            const point = points.find((point) => (point.element as any).raw);
            if (point) {
                return (point.element as any).raw.index;
            } else {
                return points[0].index;
            }
        };

        let dragStarted = false;
        // Which fingers are down, and where. One finger reads the profile;
        // two are a pinch or a drag, and scrubbing to wherever the second
        // finger landed while the first is moving away from it is not a
        // reading, it is a jump.
        const fingers = new Map<number, number>();
        let lastTap = 0;

        // The midpoint between two fingers, so that moving them together
        // slides the view. The zoom plugin scales about a point but never
        // translates, so without this a zoomed-in profile could only be
        // moved along by zooming out and back in somewhere else.
        let lastMidpoint: number | undefined = undefined;
        const midpoint = () => {
            const xs = [...fingers.values()];
            return xs.length === 2 ? (xs[0] + xs[1]) / 2 : undefined;
        };

        // Reading with one finger runs out of chart at the edge. Rather than
        // stopping there the view follows: hold the finger near the edge and
        // the profile scrolls under it, so a long route can be read end to
        // end without ever letting go.
        const EDGE = 36;
        const MAX_EDGE_SPEED = 9;
        let edgeSpeed = 0;
        let edgeFrame: number | undefined = undefined;
        let heldAt: { x: number; y: number } | undefined = undefined;
        const stopEdgeScroll = () => {
            if (edgeFrame !== undefined) {
                cancelAnimationFrame(edgeFrame);
                edgeFrame = undefined;
            }
            edgeSpeed = 0;
        };
        const zoomedIn = () => (this._chart?.getZoomLevel() ?? 1) > 1.01;
        const edgeStep = () => {
            edgeFrame = undefined;
            if (edgeSpeed === 0 || !this._chart || !heldAt) {
                return;
            }
            (this._chart as any).pan({ x: -edgeSpeed }, undefined, 'default');
            // The view moved under a finger that did not, so the point being
            // read is a different one now.
            moveCursorTo(getIndexAt(heldAt.x, heldAt.y));
            edgeFrame = requestAnimationFrame(edgeStep);
        };
        const updateEdgeScroll = (evt: PointerEvent) => {
            const area = this._chart?.chartArea;
            if (!area || !zoomedIn()) {
                stopEdgeScroll();
                return;
            }
            const x = evt.offsetX;
            const past =
                x < area.left + EDGE
                    ? -(area.left + EDGE - x)
                    : x > area.right - EDGE
                      ? x - (area.right - EDGE)
                      : 0;
            edgeSpeed = Math.sign(past) * Math.min(MAX_EDGE_SPEED, Math.abs(past) / 3);
            heldAt = { x: evt.offsetX, y: evt.offsetY };
            if (edgeSpeed !== 0 && edgeFrame === undefined) {
                edgeFrame = requestAnimationFrame(edgeStep);
            } else if (edgeSpeed === 0) {
                stopEdgeScroll();
            }
        };
        // A finger reads the profile by sliding along it, so on a touch screen
        // that gesture moves the cursor rather than selecting a range: sliding
        // is the only way to scrub, and a range can still be taken with the
        // scissors tool. Nothing hovers on a touch screen, so a pointermove
        // from one is a finger already down and needs no flag to remember it.
        const onMouseDown = (evt: PointerEvent) => {
            if (evt.pointerType === 'touch') {
                fingers.set(evt.pointerId, evt.clientX);
                if (fingers.size === 1) {
                    moveCursorTo(getIndex(evt));
                } else {
                    stopEdgeScroll();
                    lastMidpoint = midpoint();
                }
                return;
            }
            if (evt.shiftKey) {
                // Panning interaction
                return;
            }
            dragStarted = true;
            this._canvas.style.cursor = 'col-resize';
            startIndex = getIndex(evt);
        };
        const onMouseMove = (evt: PointerEvent) => {
            if (evt.pointerType === 'touch') {
                if (fingers.has(evt.pointerId)) {
                    fingers.set(evt.pointerId, evt.clientX);
                }
                if (fingers.size === 1) {
                    moveCursorTo(getIndex(evt));
                    updateEdgeScroll(evt);
                } else if (fingers.size === 2) {
                    const mid = midpoint();
                    if (mid !== undefined && lastMidpoint !== undefined && this._chart) {
                        (this._chart as any).pan({ x: mid - lastMidpoint }, undefined, 'default');
                    }
                    lastMidpoint = mid;
                }
                return;
            }
            if (dragStarted) {
                this._dragging = true;
                endIndex = getIndex(evt);
                if (endIndex !== undefined) {
                    if (startIndex === undefined) {
                        startIndex = endIndex;
                    } else if (startIndex !== endIndex) {
                        this._slicedGPXStatistics.set([
                            get(this._gpxStatistics).sliced(
                                Math.min(startIndex, endIndex),
                                Math.max(startIndex, endIndex)
                            ),
                            Math.min(startIndex, endIndex),
                            Math.max(startIndex, endIndex),
                        ]);
                    }
                }
            }
        };
        const onMouseUp = (evt: PointerEvent) => {
            if (evt.pointerType === 'touch') {
                const alone = fingers.size === 1;
                fingers.delete(evt.pointerId);
                stopEdgeScroll();
                lastMidpoint = midpoint();
                if (!alone) {
                    return;
                }
                // Two taps in quick succession fill the view with the climb
                // under the finger, and put the whole route back when there
                // is already one filling it. Reading the next climb is then
                // two taps on the next climb, rather than pinching all the
                // way out and all the way back in somewhere else.
                const now = Date.now();
                if (now - lastTap < 300) {
                    lastTap = 0;
                    this.zoomAround(kmAt(getIndex(evt)));
                    return;
                }
                lastTap = now;
                moveCursorTo(getIndex(evt));
                return;
            }
            dragStarted = false;
            this._dragging = false;
            this._canvas.style.cursor = '';
            endIndex = getIndex(evt);
            if (startIndex === endIndex) {
                this._slicedGPXStatistics.set(undefined);

                // A tap rather than a drag. There is no hover on a phone, and
                // the tooltip that feeds the climb screen is disabled while
                // dragging, so this is the only way a finger can place you on
                // the route.
                const data = this._chart?.data.datasets[0]?.data as any[] | undefined;
                const point =
                    data?.find((candidate) => candidate?.index === endIndex) ??
                    (endIndex === undefined ? undefined : data?.[endIndex]);
                if (typeof point?.km === 'number') {
                    climbCursorKm.set(point.km);
                    this._cursorIndex = point.index ?? this._cursorIndex;
                }
            }
        };
        // Otherwise the browser takes the slide as a scroll and the cursor
        // stops halfway. The zoom plugin needs it off for pinching as well.
        this._canvas.style.touchAction = 'none';
        this._canvas.addEventListener('pointerdown', onMouseDown);
        this._canvas.addEventListener('pointermove', onMouseMove);
        this._canvas.addEventListener('pointerup', onMouseUp);
        // Draining the set is done on the window, not the canvas. A finger
        // lifted past the edge of the chart, or a gesture the browser takes
        // over, ends somewhere else entirely — and a finger left behind in
        // the set stops every later touch from reading as a single one.
        // The canvas sees the event first either way, so the handler above
        // still gets its turn.
        this._onPointerGone = (evt: PointerEvent) => {
            fingers.delete(evt.pointerId);
            stopEdgeScroll();
            lastMidpoint = midpoint();
        };
        window.addEventListener('pointerup', this._onPointerGone);
        window.addEventListener('pointercancel', this._onPointerGone);
        // The same for a mouse.
        this._canvas.addEventListener('dblclick', (evt: MouseEvent) =>
            this.zoomAround(kmAt(getIndex(evt as unknown as PointerEvent)))
        );

        // Reading a profile with a mouse is a matter of a few metres either
        // way, and a hand on a trackpad cannot hold that still. With the
        // pointer over the chart the arrow keys walk the route a track point
        // at a time, ten at a time with shift held.
        this._canvas.addEventListener('pointerenter', () => (this._pointerOver = true));
        this._canvas.addEventListener('pointerleave', () => (this._pointerOver = false));

        const moveCursorTo = (index: number | undefined) => {
            const data = this._chart?.data.datasets[0]?.data as any[] | undefined;
            if (!data || index === undefined || index < 0 || index >= data.length) {
                return;
            }
            this._cursorIndex = index;
            const point = data[index];
            if (typeof point?.km === 'number') {
                climbCursorKm.set(point.km);
            }
            if (point?.coordinates) {
                this._hoveredPoint.set(point.coordinates);
            }
            // Move the chart's own readout with it, so the tooltip and the
            // marker on the map are never describing different places.
            this._chart?.tooltip?.setActiveElements([{ datasetIndex: 0, index }], { x: 0, y: 0 });
            this._chart?.update('none');
        };

        this._onKeyDown = (event: KeyboardEvent) => {
            if (!this._pointerOver || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) {
                return;
            }
            const data = this._chart?.data.datasets[0]?.data as any[] | undefined;
            if (!data || data.length === 0) {
                return;
            }
            // The window already has a keydown listener that walks the file
            // selection with the arrow keys, and it was registered first, so
            // preventDefault alone would not save the keys from it: this one
            // listens on the way down and stops the event there.
            event.preventDefault();
            event.stopImmediatePropagation();

            const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowRight' ? 1 : -1);
            moveCursorTo(Math.min(Math.max(this._cursorIndex + step, 0), data.length - 1));
        };
        window.addEventListener('keydown', this._onKeyDown, true);
    }

    updateData() {
        if (!this._chart) {
            return;
        }
        const data = get(this._gpxStatistics);
        const units = {
            distance: get(distanceUnits),
            velocity: get(velocityUnits),
            temperature: get(temperatureUnits),
        };

        const datasets: Array<Array<any>> = [[], [], [], [], [], []];
        data.forEachTrackPoint((trkpt, distance, speed, slope, index) => {
            datasets[0].push({
                x: getConvertedDistance(distance, units.distance),
                km: distance,
                y: trkpt.ele ? getConvertedElevation(trkpt.ele, units.distance) : 0,
                time: trkpt.time,
                slope: slope,
                extensions: trkpt.getExtensions(),
                coordinates: trkpt.getCoordinates(),
                index: index,
            });
            if (data.global.time.total > 0) {
                datasets[1].push({
                    x: getConvertedDistance(distance, units.distance),
                    y: getConvertedVelocity(speed, units.velocity, units.distance),
                    index: index,
                });
            }
            if (data.global.hr.count > 0) {
                datasets[2].push({
                    x: getConvertedDistance(distance, units.distance),
                    y: trkpt.getHeartRate(),
                    index: index,
                });
            }
            if (data.global.cad.count > 0) {
                datasets[3].push({
                    x: getConvertedDistance(distance, units.distance),
                    y: trkpt.getCadence(),
                    index: index,
                });
            }
            if (data.global.atemp.count > 0) {
                datasets[4].push({
                    x: getConvertedDistance(distance, units.distance),
                    y: getConvertedTemperature(trkpt.getTemperature(), units.temperature),
                    index: index,
                });
            }
            if (data.global.power.count > 0) {
                datasets[5].push({
                    x: getConvertedDistance(distance, units.distance),
                    y: trkpt.getPower(),
                    index: index,
                });
            }
        });

        this._chart.data.datasets[0] = {
            label: i18n._('quantities.elevation'),
            data: datasets[0],
            normalized: true,
            fill: 'start',
            order: 1,
            segment: {},
        };
        this._chart.data.datasets[1] = {
            data: datasets[1],
            normalized: true,
            yAxisID: 'yspeed',
        };
        this._chart.data.datasets[2] = {
            data: datasets[2],
            normalized: true,
            yAxisID: 'yhr',
        };
        this._chart.data.datasets[3] = {
            data: datasets[3],
            normalized: true,
            yAxisID: 'ycad',
        };
        this._chart.data.datasets[4] = {
            data: datasets[4],
            normalized: true,
            yAxisID: 'yatemp',
        };
        this._chart.data.datasets[5] = {
            data: datasets[5],
            normalized: true,
            yAxisID: 'ypower',
        };

        // The forecast is only sampled every couple of kilometres, but the
        // tooltip picks the nearest point in each dataset, so a sparse series
        // would only answer for the few places it happens to hold. Interpolate
        // onto the elevation series instead, so every point of the route has a
        // rainfall to report — and draw it as a filled area rather than
        // thousands of bars.
        const rainfall = get(routeRainfall);
        this._chart.data.datasets[6] = {
            type: 'line',
            label: i18n._('toolbar.weather.rain_amount'),
            data: datasets[0].map((point: any) => {
                const km = getUnconvertedDistance(point.x, units.distance);
                const at = interpolateRainfall(rainfall, km);
                return { x: point.x, y: at?.mm ?? 0, probability: at?.probability };
            }),
            yAxisID: 'yrain',
            // Higher order draws first, so the rain sits behind the elevation.
            order: 2,
            backgroundColor: 'rgba(56, 189, 248, 0.35)',
            borderWidth: 0,
            pointRadius: 0,
            // Never let the rain steal the hover from the elevation: the
            // interaction mode is 'nearest', and this series runs along the foot
            // of the chart where the cursor often is.
            pointHitRadius: 0,
            fill: 'start',
            hidden: rainfall.length === 0,
        } as any;

        this._walkingCurve = cumulativeHikingTime(data);

        this._chart.options.scales!.x!['min'] = 0;
        this._chart.options.scales!.x!['max'] = getConvertedDistance(
            data.global.distance.total,
            units.distance
        );

        this.setVisibility();
        this.setFill();

        this._chart.update();
    }

    updateDataVisibility() {
        if (!this._chart) {
            return;
        }
        this.setVisibility();
        this._chart.update();
    }

    // The hour a point is reached, given a departure time and the walking
    // estimate spread along the route in proportion to distance.
    private clockAt(distance: number): string | undefined {
        const start = get(departureTime);
        if (!start || this._walkingCurve.length === 0) {
            return undefined;
        }

        const km = getUnconvertedDistance(distance, get(distanceUnits));
        const seconds = secondsAt(this._walkingCurve, km);
        if (seconds === undefined) {
            return undefined;
        }

        const at = new Date(start.getTime() + seconds * 1000);
        return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    }

    /**
     * Fill the view with the climb at a point on the route, or put the whole
     * route back when something already fills it.
     *
     * Pinching is fine for looking closer at where you already are, and
     * miserable for comparing one climb with the next: out all the way, in
     * all the way, twice per climb. The segments are already known — they are
     * drawn along the foot of the chart — so a climb can simply be asked for.
     */
    zoomAround(km: number | undefined) {
        if (!this._chart) {
            return;
        }
        if ((this._chart.getZoomLevel() ?? 1) > 1.01) {
            this._chart.resetZoom();
            return;
        }
        if (km === undefined) {
            return;
        }

        const segment = climbAt(findClimbsAndDescents(get(this._gpxStatistics)), km);
        // Away from any climb, a kilometre either side is a reasonable guess
        // at what somebody pointing at flat ground wants to see.
        const [from, to] = segment ? [segment.startKm, segment.endKm] : [km - 1, km + 1];
        // A little air, so the foot and the top of the climb are not pressed
        // against the edges of the chart.
        const margin = Math.max((to - from) * 0.06, 0.02);
        const units = get(distanceUnits);

        (this._chart as any).zoomScale(
            'x',
            {
                min: getConvertedDistance(Math.max(0, from - margin), units),
                max: getConvertedDistance(to + margin, units),
            },
            'default'
        );
    }
    // Each climb and each descent gets a band along the foot of the chart,
    // coloured by how steep it is — the same read as a ClimbPro screen, in the
    // place the profile already occupies. Descents are in the cold half of the
    // palette, so which way a band goes needs no legend.
    private drawClimbs() {
        const climbs = findClimbsAndDescents(get(this._gpxStatistics));
        if (climbs.length === 0 || !this._chart) {
            return;
        }

        const context = this._overlay.getContext('2d');
        if (!context) {
            return;
        }

        const { bottom } = this._chart.chartArea;
        const units = get(distanceUnits);
        const height = 4;

        context.save();
        for (const climb of climbs) {
            const from = this._chart.scales.x.getPixelForValue(
                getConvertedDistance(climb.startKm, units)
            );
            const to = this._chart.scales.x.getPixelForValue(
                getConvertedDistance(climb.endKm, units)
            );
            context.fillStyle = gradientColour(climb.gradient, climb.kind);
            context.fillRect(from, bottom - height, Math.max(1, to - from), height);
        }
        context.restore();
    }

    // Where the walker is, marked on the profile. Drawn after the selection
    // shading so it stays visible over it.
    private drawLivePosition() {
        const progress = progressAlongRoute(get(livePosition));
        if (!progress || !this._chart) {
            return;
        }
        // Sitting at home, the nearest point of a route in the hills is one of
        // its ends, and a marker there says you are standing on it. The panel
        // on the map says how far off you are; this says nothing at all.
        if (progress.offRouteMeters > OFF_ROUTE_METERS) {
            return;
        }

        const context = this._overlay.getContext('2d');
        if (!context) {
            return;
        }

        const x = this._chart.scales.x.getPixelForValue(
            getConvertedDistance(progress.km, get(distanceUnits))
        );
        const { top, height } = this._chart.chartArea;

        context.save();
        context.globalAlpha = 1;
        // Amber rather than the theme colour: this is where you are, not part
        // of the data.
        context.strokeStyle = '#f59e0b';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x, top);
        context.lineTo(x, top + height);
        context.stroke();

        context.fillStyle = '#f59e0b';
        context.beginPath();
        context.arc(x, top, 4, 0, Math.PI * 2);
        context.fill();
        context.restore();
    }

    setVisibility() {
        if (!this._chart) {
            return;
        }

        const additionalDatasets = get(this._additionalDatasets);
        let includeSpeed = additionalDatasets.includes('speed');
        let includeHeartRate = additionalDatasets.includes('hr');
        let includeCadence = additionalDatasets.includes('cad');
        let includeTemperature = additionalDatasets.includes('atemp');
        let includePower = additionalDatasets.includes('power');
        if (this._chart.data.datasets.length >= 6) {
            this._chart.data.datasets[1].hidden = !includeSpeed;
            this._chart.data.datasets[2].hidden = !includeHeartRate;
            this._chart.data.datasets[3].hidden = !includeCadence;
            this._chart.data.datasets[4].hidden = !includeTemperature;
            this._chart.data.datasets[5].hidden = !includePower;
        }
    }

    updateFill() {
        if (!this._chart) {
            return;
        }
        this.setFill();
        this._chart.update();
    }

    setFill() {
        if (!this._chart) {
            return;
        }
        const elevationFill = get(this._elevationFill);
        const dataset = this._chart.data.datasets[0];
        let segment: any = {};
        if (elevationFill === 'slope') {
            segment = {
                backgroundColor: this.slopeFillCallback,
            };
        } else if (elevationFill === 'surface') {
            segment = {
                backgroundColor: this.surfaceFillCallback,
            };
        } else if (elevationFill === 'highway') {
            segment = {
                backgroundColor: this.highwayFillCallback,
            };
        } else {
            segment = {};
        }
        Object.assign(dataset, { segment });
    }

    updateOverlay() {
        if (!this._chart) {
            return;
        }

        this._overlay.width = this._canvas.width / window.devicePixelRatio;
        this._overlay.height = this._canvas.height / window.devicePixelRatio;
        this._overlay.style.width = `${this._overlay.width}px`;
        this._overlay.style.height = `${this._overlay.height}px`;

        const slicedGPXStatistics = get(this._slicedGPXStatistics);
        if (slicedGPXStatistics) {
            let startIndex = slicedGPXStatistics[1];
            let endIndex = slicedGPXStatistics[2];

            // Draw selection rectangle
            let selectionContext = this._overlay.getContext('2d');
            if (selectionContext) {
                selectionContext.fillStyle = 'black';
                selectionContext.globalAlpha = 0.1;
                selectionContext.clearRect(0, 0, this._overlay.width, this._overlay.height);

                const gpxStatistics = get(this._gpxStatistics);
                let startPixel = this._chart.scales.x.getPixelForValue(
                    getConvertedDistance(
                        gpxStatistics.getTrackPoint(startIndex)?.distance.total ?? 0
                    )
                );
                let endPixel = this._chart.scales.x.getPixelForValue(
                    getConvertedDistance(gpxStatistics.getTrackPoint(endIndex)?.distance.total ?? 0)
                );

                selectionContext.fillRect(
                    startPixel,
                    this._chart.chartArea.top,
                    endPixel - startPixel,
                    this._chart.chartArea.height
                );
            }
        } else if (this._overlay) {
            let selectionContext = this._overlay.getContext('2d');
            if (selectionContext) {
                selectionContext.clearRect(0, 0, this._overlay.width, this._overlay.height);
            }
        }

        this.drawClimbs();
        this.drawLivePosition();
    }

    slopeFillCallback(context: ScriptableLineSegmentContext & { p0: { raw: any } }) {
        const point = context.p0.raw as ElevationProfilePoint;
        return getSlopeColor(point.slope.segment);
    }

    surfaceFillCallback(context: ScriptableLineSegmentContext & { p0: { raw: any } }) {
        const point = context.p0.raw as ElevationProfilePoint;
        return getSurfaceColor(point.extensions.surface);
    }

    highwayFillCallback(context: ScriptableLineSegmentContext & { p0: { raw: any } }) {
        const point = context.p0.raw as ElevationProfilePoint;
        return getHighwayColor(
            point.extensions.highway,
            point.extensions.sac_scale,
            point.extensions.mtb_scale
        );
    }

    destroy() {
        if (this._onKeyDown) {
            window.removeEventListener('keydown', this._onKeyDown, true);
            this._onKeyDown = null;
        }
        if (this._onPointerGone) {
            window.removeEventListener('pointerup', this._onPointerGone);
            window.removeEventListener('pointercancel', this._onPointerGone);
            this._onPointerGone = null;
        }
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }
    }
}
