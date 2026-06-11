import { el, megabyte } from './util.js';

class PanelMetrics {
  constructor() {
    this.data = megabyte();
    this.lastWidth = 0;
  }
}

// Leaky mode parks observers here "in case we need them later".
const liveObservers = [];

export default {
  id: 'observers',
  title: 'Undisconnected observers',
  description:
    'Each panel gets a ResizeObserver whose callback closure captures the ' +
    'panel node and ~1 MB of metrics. Leaky mode removes panels without ' +
    'disconnect(), and keeps the observer referenced — retaining the closure, ' +
    'metrics, and removed DOM. Fixed mode disconnects and drops the reference.',
  guidance:
    'Click “Add panel” then “Remove all panels”, repeat 10×, snapshot. Look ' +
    'for PanelMetrics retained via ResizeObserver callbacks.',
  mount(section, mode) {
    const status = el('p', { className: 'status' });
    const add = el('button', { textContent: 'Add panel' });
    const removeAll = el('button', { textContent: 'Remove all panels' });
    const grid = el('div', { className: 'grid' });
    let current = []; // observers for panels currently in the DOM

    add.addEventListener('click', () => {
      const metrics = new PanelMetrics();
      const panel = el('div', { className: 'panel', textContent: 'Panel' });
      const observer = new ResizeObserver((entries) => {
        metrics.lastWidth = entries[0].contentRect.width;
        panel.dataset.width = metrics.lastWidth;
      });
      observer.observe(panel);
      grid.append(panel);
      current.push(observer);
      status.textContent = `Panels: ${grid.children.length}; parked observers: ${liveObservers.length}`;
    });

    removeAll.addEventListener('click', () => {
      grid.replaceChildren();
      if (mode === 'fixed') {
        for (const o of current) o.disconnect();
      } else {
        liveObservers.push(...current); // BUG: closures keep panels + metrics alive
      }
      current = [];
      status.textContent = `Panels: 0; parked observers: ${liveObservers.length}`;
    });

    section.append(add, removeAll, status, grid);
    return () => {};
  },
};
