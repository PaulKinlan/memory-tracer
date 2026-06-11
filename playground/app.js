import { scenarios } from './scenarios/index.js';
import { el } from './scenarios/util.js';

const nav = document.querySelector('#nav');
const view = document.querySelector('#view');
const modeToggle = document.querySelector('#mode-toggle');

const mode = new URLSearchParams(location.search).get('mode') === 'fixed' ? 'fixed' : 'leaky';
document.body.dataset.mode = mode;
modeToggle.textContent = mode === 'leaky' ? 'mode: leaky' : 'mode: fixed';
modeToggle.href = (mode === 'leaky' ? '?mode=fixed' : location.pathname) + location.hash;

for (const s of scenarios) {
  nav.append(el('a', { href: `#${s.id}`, textContent: s.title }));
}

let unmount = null;

function render() {
  const id = location.hash.slice(1);
  const scenario = scenarios.find((s) => s.id === id) ?? scenarios[0];

  // Tear down the previous view. In leaky mode, scenario unmount functions
  // deliberately skip cleanup — that's the playground's whole point.
  unmount?.();
  unmount = null;
  view.replaceChildren();

  for (const a of nav.children) {
    a.classList.toggle('active', a.getAttribute('href') === `#${scenario.id}`);
  }

  view.append(
    el('h2', { textContent: scenario.title }),
    el('p', { className: 'description', textContent: scenario.description }),
    el('p', { className: 'guidance', textContent: `Demo: ${scenario.guidance}` })
  );
  const section = el('section');
  view.append(section);
  unmount = scenario.mount(section, mode) ?? null;
}

addEventListener('hashchange', render);
render();
