import { el, megabyte } from './util.js';

class DashboardModel {
  constructor() {
    this.data = megabyte();
    this.ticks = 0;
  }
}

// App-wide singleton event bus — common SPA pattern, and a classic leak
// vector: views that subscribe but never unsubscribe are retained forever.
const bus = new EventTarget();
setInterval(() => bus.dispatchEvent(new Event('tick')), 1000);

export default {
  id: 'spa-views',
  title: 'SPA navigation leak',
  description:
    'This view subscribes a handler to a global event bus on mount. The ' +
    'handler closure retains the view subtree and a ~1 MB model. Leaky mode ' +
    'never unsubscribes on unmount, so every visit to this view leaks a full ' +
    'copy of it. This is the leak shape a route-cycle audit scenario catches.',
  guidance:
    'Navigate to another scenario and back here 10× (this is the audit’s ' +
    'route-cycle test), then snapshot. Look for DashboardModel instances — ' +
    'one per visit in leaky mode.',
  mount(section, mode) {
    const model = new DashboardModel();
    const readout = el('p', { className: 'status', textContent: 'Waiting for first tick…' });
    const onTick = () => {
      model.ticks += 1;
      readout.textContent = `Dashboard ticks (this view instance): ${model.ticks}`;
    };
    bus.addEventListener('tick', onTick);
    section.append(el('div', { className: 'panel' }, readout));

    return () => {
      if (mode === 'fixed') {
        bus.removeEventListener('tick', onTick);
      }
      // leaky mode: forgot to unsubscribe — bus → onTick → model + section
    };
  },
};
