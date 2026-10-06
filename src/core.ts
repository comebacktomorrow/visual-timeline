/* Visual Timeline core — framework-free DOM implementation shared by the
 * Grafana panel entry (module.ts) and the web pages (web/vt-core.js), which
 * don't load React. The timeline and grid render imperatively, with React
 * only at the panel boundary; a cursor move only repositions and relabels,
 * never rebuilds slots (perf/README.md measures it).
 *
 * This file is the entry point (the panel imports it; npm run build:web
 * bundles it as the VTCore global for web/): it only re-exports the public
 * names from the modules under src/vt/. */

export { fmtShort, fmtTime, resolveTimeZone, zonedParts, zonedTime } from './vt/time/zones';
export { alignedStart, axisTicks, kindFormat, nextTick, pickTickStep, TICK_STEPS, tickFormat, tickKind } from './vt/time/ticks';
export { clearPauseClasses, erasFor, PAUSE_CLASSES, pauseInfo } from './vt/model/eras';
export { buildSourceModel, ghostFor, missedHeartbeat, slotClass } from './vt/model/slots';
export { matchesTags, parseTagFilter } from './vt/model/filters';
export { fmtOffset, sourceTimeZone, zoneHeadText, zoneLabel, zoneOffsetText } from './vt/zones/source';
export { ApiError, bootErrorText, framesPath, hiUrlFor, imageUrlWithKey, makeApiBackend, resolveFrameUrl, sourcesPath } from './vt/backends/api';
export { esc, headTitle, tagChips } from './vt/dom/html';
export { KTL_VAR_DEFAULTS } from './vt/dom/styles';
export { mountTimeline } from './vt/timeline/mount';
export { mountGrid } from './vt/grid/mount';
