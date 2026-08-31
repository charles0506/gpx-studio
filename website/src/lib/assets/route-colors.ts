/**
 * Colours handed out to routes that have not been given one.
 *
 * No red. The map this build opens on draws every trail in red, and a red route
 * laid over a red trail is a route you cannot see — which is the whole job.
 * Nothing near it either: the oranges and browns here are dark or dull enough
 * not to read as another path.
 *
 * Ordered so that the first few routes open are the ones furthest from what the
 * map itself uses. Beyond that they are simply distinct from each other,
 * because after four or five lines on one screen telling them apart is the only
 * thing left that matters.
 */
export const routeColors = [
    '#0000ff', // blue
    '#ff00ff', // magenta
    '#9933ff', // violet
    '#00ccff', // cyan
    '#288228', // dark green
    '#e0218a', // rose
    '#4b0082', // indigo
    '#50f0be', // mint
    '#ffff32', // yellow
    '#0080a0', // teal blue
    '#46e646', // bright green
    '#8c645a', // brown
    '#6666ff', // periwinkle
    '#b8860b', // dark gold
    '#008080', // teal
    '#c86400', // burnt orange
];
