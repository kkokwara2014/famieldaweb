export function debounce(fn, wait = 280) {
  let timer = 0;
  const wrapped = (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  wrapped.flush = (...args) => {
    wrapped.cancel();
    fn(...args);
  };
  return wrapped;
}

export function throttle(fn, wait = 120) {
  let last = 0;
  let timer = 0;
  let pending = null;
  const wrapped = (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    pending = args;
    if (remaining <= 0) {
      window.clearTimeout(timer);
      timer = 0;
      last = now;
      pending = null;
      fn(...args);
      return;
    }
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      last = Date.now();
      const next = pending;
      pending = null;
      if (next) fn(...next);
    }, remaining);
  };
  wrapped.cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
    pending = null;
  };
  return wrapped;
}
