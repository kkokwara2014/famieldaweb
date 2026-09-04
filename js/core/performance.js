import { enhanceDocumentImages } from "./images.js";
import { bindLifecycleCleanup } from "./listeners.js";
import { pruneCaches } from "./cache.js";
import { hydrateLazySections, idle } from "./lazy.js";

let started = false;

export function initPerformance(root = document) {
  if (started) {
    enhanceDocumentImages(root);
    hydrateLazySections(root);
    return;
  }
  started = true;
  bindLifecycleCleanup();
  enhanceDocumentImages(root);
  hydrateLazySections(root);
  idle(() => pruneCaches());
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pruneCaches();
    });
  }
}
