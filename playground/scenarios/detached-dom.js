import { el, megabyte } from './util.js';

// Named class so heap snapshots show exactly what leaked.
class DetachedCardBatch {
  constructor(nodes) {
    this.nodes = nodes; // removed-from-DOM nodes, still referenced from JS
    this.data = megabyte();
  }
}

const retainedBatches = [];

export default {
  id: 'detached-dom',
  title: 'Detached DOM nodes',
  description:
    'Re-renders a card grid. Leaky mode stashes the replaced nodes in a ' +
    'module-level array ("for undo, someday"), so every render leaks a batch ' +
    'of detached DOM plus ~1 MB. Fixed mode just lets the old nodes go.',
  guidance:
    'Click “Render new cards” 10×, then heap-snapshot. Look for ' +
    'DetachedCardBatch and Detached <div> entries.',
  mount(section, mode) {
    const status = el('p', { className: 'status' });
    const grid = el('div', { className: 'grid' });
    const button = el('button', { textContent: 'Render new cards (discard old)' });

    button.addEventListener('click', () => {
      const old = [...grid.children];
      grid.replaceChildren(
        ...Array.from({ length: 24 }, (_, i) =>
          el('div', { className: 'card', textContent: `Card ${i}` })
        )
      );
      if (mode === 'leaky' && old.length) {
        retainedBatches.push(new DetachedCardBatch(old)); // BUG: never released
      }
      status.textContent = `Retained detached batches: ${mode === 'leaky' ? retainedBatches.length : 0}`;
    });

    button.click(); // initial render
    section.append(button, status, grid);
    return () => {};
  },
};
