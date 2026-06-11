import { el, megabyte } from './util.js';

class SearchResultCacheEntry {
  constructor(query) {
    this.query = query;
    this.results = megabyte();
  }
}

const cache = new Map();
const MAX_ENTRIES = 5;
let nextQueryId = 0;

export default {
  id: 'unbounded-cache',
  title: 'Unbounded cache',
  description:
    'Every "search" caches ~1 MB of results in a module-level Map keyed by ' +
    'query. Leaky mode never evicts, so the cache grows for the lifetime of ' +
    'the page. Fixed mode applies a small LRU cap.',
  guidance:
    'Click “Run search” 10×, snapshot. Look for SearchResultCacheEntry count ' +
    'matching the click count (leaky) vs capped at 5 (fixed).',
  mount(section, mode) {
    const status = el('p', { className: 'status' });
    const button = el('button', { textContent: 'Run search' });

    button.addEventListener('click', () => {
      const query = `query-${nextQueryId++}`;
      cache.set(query, new SearchResultCacheEntry(query));
      if (mode === 'fixed') {
        // LRU-ish: evict oldest insertions beyond the cap.
        while (cache.size > MAX_ENTRIES) {
          cache.delete(cache.keys().next().value);
        }
      }
      status.textContent = `Cached entries: ${cache.size}`;
    });

    section.append(button, status);
    return () => {};
  },
};
