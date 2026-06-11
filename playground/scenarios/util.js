// ~1 MiB of touched memory. Every leaked object in the playground wraps one
// of these so growth is unmistakable in heap snapshots (10 iterations ≈ 10 MB).
export function megabyte() {
  return new Float64Array(131072).fill(Math.random());
}

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
