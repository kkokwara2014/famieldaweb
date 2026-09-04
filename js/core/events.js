export function on(target, eventName, handler, options) {
  const node = typeof target === "string" ? document.querySelector(target) : target;
  if (!node) return () => {};
  node.addEventListener(eventName, handler, options);
  return () => node.removeEventListener(eventName, handler, options);
}

export function delegate(root, eventName, selector, handler) {
  return on(root, eventName, (event) => {
    const match = event.target.closest(selector);
    if (match && root.contains(match)) {
      handler(event, match);
    }
  });
}
