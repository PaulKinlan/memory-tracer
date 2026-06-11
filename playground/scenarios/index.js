import detachedDom from './detached-dom.js';
import eventListeners from './event-listeners.js';
import timers from './timers.js';
import unboundedCache from './unbounded-cache.js';
import observers from './observers.js';
import spaViews from './spa-views.js';

export const scenarios = [
  detachedDom,
  eventListeners,
  timers,
  unboundedCache,
  observers,
  spaViews,
];
