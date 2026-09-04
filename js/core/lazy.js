const modules = new Map();
let observer = null;
const pending = new WeakMap();

export function loadModule(path) {
  const key = String(path);
  if (modules.has(key)) return modules.get(key);
  const pendingLoad = import(key);
  modules.set(key, pendingLoad);
  pendingLoad.catch(() => modules.delete(key));
  return pendingLoad;
}

export function idle(fn, timeout = 1200) {
  if (typeof window === "undefined") return fn();
  if (typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(() => fn(), { timeout });
  }
  return window.setTimeout(fn, 1);
}

function ensureObserver() {
  if (observer || typeof IntersectionObserver === "undefined") return observer;
  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const node = entry.target;
      observer.unobserve(node);
      const run = pending.get(node);
      pending.delete(node);
      run?.();
    });
  }, { rootMargin: "200px 0px", threshold: 0.01 });
  return observer;
}

export function whenVisible(node, fn) {
  if (!node || typeof fn !== "function") return () => {};
  const io = ensureObserver();
  if (!io) {
    fn();
    return () => {};
  }
  pending.set(node, fn);
  io.observe(node);
  return () => {
    io.unobserve(node);
    pending.delete(node);
  };
}

export function hydrateLazySections(root = document) {
  root.querySelectorAll("[data-lazy-section]").forEach((node) => {
    if (node.dataset.lazyReady) return;
    node.dataset.lazyReady = "1";
    whenVisible(node, () => {
      node.dataset.lazyLoaded = "1";
      node.dispatchEvent(new CustomEvent("famielda:lazy", { bubbles: true }));
    });
  });
}
