export function getBasePath() {
  const path = window.location.pathname.replace(/\\/g, "/");
  if (/\/(app|admin|ui)(\/|$)/.test(path)) {
    return "..";
  }
  return ".";
}

export function assetUrl(relativeFromRoot) {
  return `${getBasePath()}/${relativeFromRoot.replace(/^\//, "")}`;
}
