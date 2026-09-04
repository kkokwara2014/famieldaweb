import { ANDROID_APP_URL, IOS_APP_URL, isConfiguredStoreUrl } from "../config/apps.js";
import { PRODUCT_EVENTS } from "../config/analytics.js";
import { qs, qsa } from "../core/dom.js";
import { on } from "../core/events.js";

const STORES = {
  android: {
    url: ANDROID_APP_URL,
    event: PRODUCT_EVENTS.ANDROID_APP_DOWNLOAD_CLICK,
    platform: "android",
  },
  ios: {
    url: IOS_APP_URL,
    event: PRODUCT_EVENTS.IOS_APP_DOWNLOAD_CLICK,
    platform: "ios",
  },
};

function trackDownloadClick(store) {
  import("../services/analytics-service.js")
    .then((mod) => mod.trackProductEvent(store.event, { platform: store.platform }))
    .catch(() => {});
}

function bindStoreLink(link, store) {
  const url = String(store.url || "").trim();
  const configured = isConfiguredStoreUrl(url);

  if (configured) {
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.removeAttribute("aria-disabled");
    link.removeAttribute("role");
    link.removeAttribute("tabindex");
    link.removeAttribute("title");
  } else {
    link.removeAttribute("href");
    link.setAttribute("role", "link");
    link.setAttribute("aria-disabled", "true");
    link.tabIndex = 0;
    link.title = "The official listing will open here when the Famielda app is published.";
  }

  on(link, "click", (event) => {
    if (!configured) {
      event.preventDefault();
      return;
    }
    trackDownloadClick(store);
  });

  on(link, "keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!configured) {
      event.preventDefault();
    }
  });
}

export function mountAppDownload(root = document) {
  const section = qs("[data-app-download]", root);
  if (!section) return;

  qsa("[data-app-store]", section).forEach((link) => {
    const store = STORES[link.dataset.appStore];
    if (store) bindStoreLink(link, store);
  });
}
