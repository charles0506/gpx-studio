import { writable, type Writable } from 'svelte/store';

export enum Tool {
    SHARE,
    ROUTING,
    WAYPOINT,
    SCISSORS,
    TIME,
    MERGE,
    EXTRACT,
    ELEVATION,
    REDUCE,
    CLEAN,
    WEATHER,
    CLIMBS,
}

export const currentTool: Writable<Tool | null> = writable(null);
