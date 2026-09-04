/**
 * Famielda Mobile store listings.
 *
 * Replace these placeholders with the official listing URLs when the apps
 * are published. Leave them empty until then — do not use example or fake URLs.
 *
 * ANDROID_APP_URL — Google Play, e.g. https://play.google.com/store/apps/details?id=…
 * IOS_APP_URL     — App Store,   e.g. https://apps.apple.com/app/id…
 */
export const ANDROID_APP_URL = "";
export const IOS_APP_URL = "";

export function isConfiguredStoreUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}
