export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

export function setText(selector, value, root = document) {
  const node = qs(selector, root);
  if (node) node.textContent = value ?? "";
}

export function show(selector, visible = true, root = document) {
  const node = qs(selector, root);
  if (node) node.hidden = !visible;
}

export function html(strings, ...values) {
  return strings.reduce((out, chunk, index) => {
    const value = values[index] ?? "";
    return out + chunk + escapeHtml(value);
  }, "");
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}
