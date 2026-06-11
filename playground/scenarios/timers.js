import { el, megabyte } from './util.js';

class PollerBuffer {
  constructor() {
    this.data = megabyte();
    this.ticks = 0;
  }
}

let lingeringIntervals = 0;

export default {
  id: 'timers',
  title: 'Uncleared intervals',
  description:
    'Each widget starts a setInterval whose callback captures a ~1 MB buffer. ' +
    'Leaky mode removes the widget from the DOM but never calls clearInterval, ' +
    'so the timer (and everything its closure holds) lives forever. Fixed mode ' +
    'clears it on discard.',
  guidance:
    'Click “Create widget” then “Discard widget”, repeat 10×, snapshot. Look ' +
    'for PollerBuffer instances retained by the timer list.',
  mount(section, mode) {
    const status = el('p', { className: 'status' });
    const create = el('button', { textContent: 'Create polling widget' });
    const discard = el('button', { textContent: 'Discard widget', disabled: true });
    let widget = null; // { node, timerId }

    create.addEventListener('click', () => {
      if (widget) return;
      const buffer = new PollerBuffer();
      const node = el('div', { className: 'panel', textContent: 'Polling…' });
      const timerId = setInterval(() => {
        buffer.ticks += 1;
        node.textContent = `Polling… tick ${buffer.ticks}`;
      }, 500);
      widget = { node, timerId };
      section.append(node);
      create.disabled = true;
      discard.disabled = false;
    });

    discard.addEventListener('click', () => {
      if (!widget) return;
      widget.node.remove();
      if (mode === 'fixed') {
        clearInterval(widget.timerId);
      } else {
        lingeringIntervals += 1; // BUG: interval keeps running, retains buffer
      }
      widget = null;
      create.disabled = false;
      discard.disabled = true;
      status.textContent = `Lingering intervals: ${mode === 'fixed' ? 0 : lingeringIntervals}`;
    });

    section.append(create, discard, status);
    return () => {};
  },
};
