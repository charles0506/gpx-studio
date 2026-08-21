// This fork serves every basemap from a key-free source, so no MapTiler key is
// needed. The value is kept as a constant rather than read from
// `$env/static/public` so that a build needs no `.env` file and no environment
// variable on whichever host it is deployed to. Put a key here to bring the
// MapTiler-hosted styles back.
export const PUBLIC_MAPTILER_KEY = '';
