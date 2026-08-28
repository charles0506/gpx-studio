import { fileStateCollection } from '$lib/logic/file-state';
import { ListFileItem } from '$lib/components/file-list/file-list';
import { gradientAtKm, gradientColour, type Sample } from '$lib/climbs';

/**
 * The picture that goes on a shared link.
 *
 * A link with no card is a grey line of text in a chat window, and the person
 * receiving it has no idea whether it is a walk they want. So the share carries
 * a drawing of the route: the shape of the track, the shape of the ground under
 * it, and the two numbers that decide whether anyone is coming.
 *
 * It is drawn here rather than from map tiles because a tile is somebody's
 * licensed image and a preview card is a place it should not be reproduced —
 * and because a bare track on a plain ground is more legible at the size a chat
 * app shows it than a photograph of terrain would be.
 */

const WIDTH = 1200;
const HEIGHT = 630;

const BACKGROUND = '#0f1a24';
const PANEL = '#16232f';
const TEXT = '#f1f5f9';
const MUTED = '#94a3b8';

type Point = { lat: number; lon: number; km: number; elevation: number | undefined };

/** Web Mercator, in whatever units — the drawing only needs the shape. */
function project(lat: number, lon: number): { x: number; y: number } {
    const clamped = Math.max(-85, Math.min(85, lat));
    const radians = (clamped * Math.PI) / 180;
    return {
        x: lon,
        y: (Math.log(Math.tan(Math.PI / 4 + radians / 2)) * 180) / Math.PI,
    };
}

function statisticsOf(fileId: string) {
    return fileStateCollection.getStatistics(fileId)?.getStatisticsFor(new ListFileItem(fileId));
}

function pointsOf(fileId: string): Point[] {
    const statistics = statisticsOf(fileId);
    if (!statistics?.forEachTrackPoint) {
        return [];
    }
    const points: Point[] = [];
    statistics.forEachTrackPoint((point: any, distance: number) => {
        points.push({
            lat: point.attributes.lat,
            lon: point.attributes.lon,
            km: distance,
            elevation: typeof point.ele === 'number' && point.ele !== 0 ? point.ele : undefined,
        });
    });
    return points;
}

/** The distance and ascent of a set of open routes, added up. */
export function totalsOf(fileIds: string[]): { km: number; ascent: number } {
    return fileIds
        .map(summaryOf)
        .filter((summary): summary is { km: number; ascent: number } => summary !== undefined)
        .reduce(
            (total, summary) => ({
                km: total.km + summary.km,
                ascent: total.ascent + summary.ascent,
            }),
            { km: 0, ascent: 0 }
        );
}

function summaryOf(fileId: string): { km: number; ascent: number } | undefined {
    const global = statisticsOf(fileId)?.global;
    return global ? { km: global.distance.total, ascent: global.elevation.gain } : undefined;
}

/** Thin a track down to something a canvas can draw without stalling. */
function thin<T>(points: T[], limit: number): T[] {
    if (points.length <= limit) {
        return points;
    }
    const step = points.length / limit;
    const kept: T[] = [];
    for (let i = 0; i < limit; i += 1) {
        kept.push(points[Math.floor(i * step)]);
    }
    kept.push(points[points.length - 1]);
    return kept;
}

function drawTrack(
    context: CanvasRenderingContext2D,
    tracks: Point[][],
    box: { x: number; y: number; width: number; height: number }
) {
    const projected = tracks.map((track) =>
        thin(track, 2000).map((point) => project(point.lat, point.lon))
    );
    const all = projected.flat();
    if (all.length < 2) {
        return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of all) {
        if (point.x < minX) minX = point.x;
        if (point.x > maxX) maxX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.y > maxY) maxY = point.y;
    }

    // A route that runs north to south must not be stretched sideways to fill
    // the box: one scale for both axes, and the spare room becomes margin.
    const scale = Math.min(
        box.width / Math.max(maxX - minX, 1e-9),
        box.height / Math.max(maxY - minY, 1e-9)
    );
    const offsetX = box.x + (box.width - (maxX - minX) * scale) / 2;
    const offsetY = box.y + (box.height - (maxY - minY) * scale) / 2;
    const at = (point: { x: number; y: number }) => ({
        x: offsetX + (point.x - minX) * scale,
        // Mercator y grows north, the canvas grows south.
        y: offsetY + (maxY - point.y) * scale,
    });

    context.lineJoin = 'round';
    context.lineCap = 'round';

    for (const track of projected) {
        if (track.length < 2) {
            continue;
        }
        // A dark halo under the line so it holds against the ground colour.
        for (const [width, colour] of [
            [11, 'rgba(0,0,0,0.45)'],
            [6, '#f97316'],
        ] as const) {
            context.beginPath();
            context.lineWidth = width;
            context.strokeStyle = colour;
            track.forEach((point, index) => {
                const { x, y } = at(point);
                if (index === 0) {
                    context.moveTo(x, y);
                } else {
                    context.lineTo(x, y);
                }
            });
            context.stroke();
        }

        const start = at(track[0]);
        const end = at(track[track.length - 1]);
        context.fillStyle = '#22c55e';
        context.beginPath();
        context.arc(start.x, start.y, 9, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#ef4444';
        context.beginPath();
        context.arc(end.x, end.y, 9, 0, Math.PI * 2);
        context.fill();
    }
}

function drawProfile(
    context: CanvasRenderingContext2D,
    points: Point[],
    box: { x: number; y: number; width: number; height: number }
) {
    const withElevation = thin(
        points.filter((point) => point.elevation !== undefined),
        600
    );
    if (withElevation.length < 2) {
        return;
    }
    let low = Infinity;
    let high = -Infinity;
    for (const point of withElevation) {
        const elevation = point.elevation as number;
        if (elevation < low) low = elevation;
        if (elevation > high) high = elevation;
    }
    const span = Math.max(high - low, 1);
    const totalKm = withElevation[withElevation.length - 1].km || 1;
    const at = (point: Point) => ({
        x: box.x + (point.km / totalKm) * box.width,
        y: box.y + box.height - (((point.elevation as number) - low) / span) * box.height,
    });

    // Coloured by the ground, on the same scale and the same hundred-metre
    // window the profile in the app uses. Read point to point instead, a GPS
    // wobble of a couple of metres reads as a cliff, and the card comes out
    // striped in every colour the scale has.
    const samples: Sample[] = withElevation.map((point) => ({
        km: point.km,
        elevation: point.elevation as number,
    }));

    for (let i = 1; i < withElevation.length; i += 1) {
        const previous = withElevation[i - 1];
        const current = withElevation[i];
        const gradient = gradientAtKm(samples, (previous.km + current.km) / 2) ?? 0;
        const a = at(previous);
        const b = at(current);
        // Each slice is drawn a pixel past the next one's left edge. Butted
        // exactly, the antialiased seams between six hundred of them read as
        // vertical stripes across the whole profile.
        context.beginPath();
        context.moveTo(a.x, box.y + box.height);
        context.lineTo(a.x, a.y);
        context.lineTo(b.x + 1, b.y);
        context.lineTo(b.x + 1, box.y + box.height);
        context.closePath();
        context.fillStyle = gradientColour(Math.abs(gradient), gradient >= 0 ? 'climb' : 'descent');
        context.fill();
    }
}

/**
 * Draw the card for a set of open routes. Returns a data URL, or undefined if
 * there is nothing to draw or the browser will not give us a canvas.
 */
export function renderShareImage(fileIds: string[], title: string): string | undefined {
    if (typeof document === 'undefined' || fileIds.length === 0) {
        return undefined;
    }

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) {
        return undefined;
    }

    const tracks = fileIds.map(pointsOf).filter((track) => track.length > 1);
    if (tracks.length === 0) {
        return undefined;
    }

    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    drawTrack(context, tracks, { x: 620, y: 60, width: 520, height: 380 });

    // The profile belongs to the longest route: several tracks stacked on one
    // axis is a mess, and the longest is the one the day is about.
    const longest = tracks.reduce((a, b) =>
        (b[b.length - 1]?.km ?? 0) > (a[a.length - 1]?.km ?? 0) ? b : a
    );
    context.fillStyle = PANEL;
    context.fillRect(60, 470, WIDTH - 120, 110);
    drawProfile(context, longest, { x: 60, y: 470, width: WIDTH - 120, height: 110 });

    const totals = fileIds
        .map(summaryOf)
        .filter((summary): summary is { km: number; ascent: number } => summary !== undefined);
    const km = totals.reduce((sum, summary) => sum + summary.km, 0);
    const ascent = totals.reduce((sum, summary) => sum + summary.ascent, 0);

    context.fillStyle = MUTED;
    context.font = '600 34px system-ui, sans-serif';
    context.fillText('快到了', 60, 110);

    context.fillStyle = TEXT;
    context.font = '700 58px system-ui, sans-serif';
    // Long names are cut rather than allowed to run under the track drawing.
    let name = title;
    let cut = false;
    while (name.length > 1 && context.measureText(cut ? `${name}…` : name).width > 500) {
        name = name.slice(0, -1);
        cut = true;
    }
    context.fillText(cut ? `${name}…` : name, 60, 200);

    context.font = '700 46px system-ui, sans-serif';
    context.fillText(`${km.toFixed(1)} km`, 60, 300);
    context.fillText(`↗ ${Math.round(ascent)} m`, 60, 370);

    context.fillStyle = MUTED;
    context.font = '400 28px system-ui, sans-serif';
    context.fillText(tracks.length > 1 ? `${tracks.length} 條路線` : '點連結直接開啟', 60, 430);

    try {
        return canvas.toDataURL('image/png');
    } catch {
        return undefined;
    }
}
