import { el, megabyte } from './util.js';

class TooltipScratchpad {
  constructor() {
    this.data = megabyte();
  }
}

let opened = 0;

export default {
  id: 'event-listeners',
  title: 'Accumulating event listeners',
  description:
    'Opening the tooltip registers a window pointermove handler whose closure ' +
    'captures ~1 MB. Leaky mode closes the tooltip but never removes the ' +
    'handler. Fixed mode passes an AbortController signal to addEventListener ' +
    'and aborts on close.',
  guidance:
    'Click “Open + close tooltip” 10×, then snapshot. Look for ' +
    'TooltipScratchpad held via window pointermove listeners.',
  mount(section, mode) {
    const status = el('p', { className: 'status' });
    const button = el('button', { textContent: 'Open + close tooltip' });

    button.addEventListener('click', () => {
      const scratch = new TooltipScratchpad();
      const tooltip = el('div', { className: 'panel', textContent: 'Tooltip!' });
      const controller = new AbortController();

      window.addEventListener(
        'pointermove',
        (e) => { scratch.lastX = e.clientX; tooltip.dataset.x = e.clientX; },
        mode === 'fixed' ? { signal: controller.signal } : undefined
      );

      section.append(tooltip);
      // "Close" shortly after opening.
      setTimeout(() => {
        tooltip.remove();
        if (mode === 'fixed') controller.abort(); // leaky mode skips teardown
      }, 150);

      opened += 1;
      status.textContent =
        `Opened ${opened}×; lingering pointermove listeners: ${mode === 'fixed' ? 0 : opened}`;
    });

    section.append(button, status);
    return () => {};
  },
};
