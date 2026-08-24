// CWA publishes its radar as opaque PNGs — the "no terrain" products included.
// The base is a neutral grey map (land 77,77,77, sea white) with the echoes
// painted over it in a saturated palette, so laying one over a basemap greys
// the whole map out. Nothing in MapLibre keys a colour out of a raster layer,
// so the image is repainted here: neutral pixels become fully transparent and
// the coloured ones are kept.
//
// The source images are 3600 px square. They are decoded straight down to
// WORKING_SIZE — asking the decoder to scale costs a fraction of decoding at
// full size and scaling afterwards — which is still finer than the screen at
// any zoom where the radar is legible.
const WORKING_SIZE = 1200;

// Background pixels are grey, so their channels sit close together. Echo
// colours are saturated by design, the weakest being the pale blue of light
// rain, so a modest threshold separates them cleanly.
const SATURATION_THRESHOLD = 24;

// Coastlines and county borders are drawn in dark grey and would otherwise
// survive as noise over the basemap's own outlines.
const DARK_NEUTRAL = 120;

// PNG encoding of a 1200 px frame costs about a second, which is far too long
// to hold the main thread for. Lossless WebP does the same job in under a
// tenth of that and comes out a third smaller.
const OUTPUT_TYPE = 'image/webp';
const OUTPUT_QUALITY = 1;

export type RadarImage = {
    url: string;
    revoke: () => void;
};

function keyOutBackground(data: Uint8ClampedArray): void {
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);

        if (max - min < SATURATION_THRESHOLD || (max < DARK_NEUTRAL && max - min < 40)) {
            data[i + 3] = 0;
        }
    }
}

/**
 * Fetch a radar scan and return a blob URL of it with the background made
 * transparent. Callers own the URL and must revoke it once they have replaced
 * it, or the blobs accumulate for as long as the page lives.
 */
export async function fetchTransparentRadar(source: string): Promise<RadarImage> {
    const response = await fetch(source, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`radar image responded ${response.status}`);
    }

    const bitmap = await createImageBitmap(await response.blob(), {
        resizeWidth: WORKING_SIZE,
        resizeHeight: WORKING_SIZE,
        resizeQuality: 'low',
    });

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
        bitmap.close();
        throw new Error('no 2d context available');
    }

    context.drawImage(bitmap, 0, 0);
    bitmap.close();

    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    keyOutBackground(image.data);
    context.putImageData(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, OUTPUT_TYPE, OUTPUT_QUALITY)
    );
    if (!blob) {
        throw new Error('could not encode the radar image');
    }

    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
}
