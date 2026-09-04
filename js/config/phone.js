/**
 * National phone lengths (digits after the country calling code).
 * Used by the create-account phone field. Values follow common ITU NSN ranges.
 */
const FEATURED = ["US", "CA", "GB", "NG", "GH", "KE", "ZA", "IN", "AU"];

export const PHONE_COUNTRIES = [
  { iso: "AR", name: "Argentina", dial: "54", min: 10, max: 10 },
  { iso: "AU", name: "Australia", dial: "61", min: 9, max: 9 },
  { iso: "AT", name: "Austria", dial: "43", min: 10, max: 11 },
  { iso: "BD", name: "Bangladesh", dial: "880", min: 10, max: 10 },
  { iso: "BE", name: "Belgium", dial: "32", min: 8, max: 9 },
  { iso: "BR", name: "Brazil", dial: "55", min: 10, max: 11 },
  { iso: "CM", name: "Cameroon", dial: "237", min: 9, max: 9 },
  { iso: "CA", name: "Canada", dial: "1", min: 10, max: 10 },
  { iso: "CN", name: "China", dial: "86", min: 11, max: 11 },
  { iso: "CI", name: "Côte d’Ivoire", dial: "225", min: 10, max: 10 },
  { iso: "DK", name: "Denmark", dial: "45", min: 8, max: 8 },
  { iso: "EG", name: "Egypt", dial: "20", min: 10, max: 10 },
  { iso: "ET", name: "Ethiopia", dial: "251", min: 9, max: 9 },
  { iso: "FI", name: "Finland", dial: "358", min: 9, max: 10 },
  { iso: "FR", name: "France", dial: "33", min: 9, max: 9 },
  { iso: "DE", name: "Germany", dial: "49", min: 10, max: 11 },
  { iso: "GH", name: "Ghana", dial: "233", min: 9, max: 9 },
  { iso: "IN", name: "India", dial: "91", min: 10, max: 10 },
  { iso: "ID", name: "Indonesia", dial: "62", min: 9, max: 12 },
  { iso: "IE", name: "Ireland", dial: "353", min: 9, max: 9 },
  { iso: "IT", name: "Italy", dial: "39", min: 9, max: 10 },
  { iso: "JM", name: "Jamaica", dial: "1", min: 10, max: 10 },
  { iso: "JP", name: "Japan", dial: "81", min: 10, max: 10 },
  { iso: "KE", name: "Kenya", dial: "254", min: 9, max: 9 },
  { iso: "MY", name: "Malaysia", dial: "60", min: 9, max: 10 },
  { iso: "MX", name: "Mexico", dial: "52", min: 10, max: 10 },
  { iso: "NL", name: "Netherlands", dial: "31", min: 9, max: 9 },
  { iso: "NZ", name: "New Zealand", dial: "64", min: 8, max: 10 },
  { iso: "NG", name: "Nigeria", dial: "234", min: 10, max: 10 },
  { iso: "NO", name: "Norway", dial: "47", min: 8, max: 8 },
  { iso: "PK", name: "Pakistan", dial: "92", min: 10, max: 10 },
  { iso: "PH", name: "Philippines", dial: "63", min: 10, max: 10 },
  { iso: "PL", name: "Poland", dial: "48", min: 9, max: 9 },
  { iso: "PT", name: "Portugal", dial: "351", min: 9, max: 9 },
  { iso: "RW", name: "Rwanda", dial: "250", min: 9, max: 9 },
  { iso: "SA", name: "Saudi Arabia", dial: "966", min: 9, max: 9 },
  { iso: "SN", name: "Senegal", dial: "221", min: 9, max: 9 },
  { iso: "SG", name: "Singapore", dial: "65", min: 8, max: 8 },
  { iso: "ZA", name: "South Africa", dial: "27", min: 9, max: 9 },
  { iso: "KR", name: "South Korea", dial: "82", min: 9, max: 10 },
  { iso: "ES", name: "Spain", dial: "34", min: 9, max: 9 },
  { iso: "SE", name: "Sweden", dial: "46", min: 9, max: 10 },
  { iso: "CH", name: "Switzerland", dial: "41", min: 9, max: 9 },
  { iso: "TZ", name: "Tanzania", dial: "255", min: 9, max: 9 },
  { iso: "UG", name: "Uganda", dial: "256", min: 9, max: 9 },
  { iso: "AE", name: "United Arab Emirates", dial: "971", min: 9, max: 9 },
  { iso: "GB", name: "United Kingdom", dial: "44", min: 10, max: 10 },
  { iso: "US", name: "United States", dial: "1", min: 10, max: 10 },
].map((item) => ({ ...item, flag: flagEmoji(item.iso) }));

export const DEFAULT_PHONE_COUNTRY = "US";

function flagEmoji(iso) {
  return [...String(iso || "").toUpperCase()]
    .map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)))
    .join("");
}

export function phoneCountry(iso) {
  const code = String(iso || DEFAULT_PHONE_COUNTRY).toUpperCase();
  return PHONE_COUNTRIES.find((item) => item.iso === code)
    || PHONE_COUNTRIES.find((item) => item.iso === DEFAULT_PHONE_COUNTRY);
}

export function sortedPhoneCountries() {
  const rank = new Map(FEATURED.map((iso, index) => [iso, index]));
  return [...PHONE_COUNTRIES].sort((a, b) => {
    const left = rank.has(a.iso) ? rank.get(a.iso) : FEATURED.length;
    const right = rank.has(b.iso) ? rank.get(b.iso) : FEATURED.length;
    if (left !== right) return left - right;
    return a.name.localeCompare(b.name);
  });
}

export function countryOptionLabel(country) {
  return `${country.flag} +${country.dial} ${country.iso}`;
}

const PLACEHOLDERS = {
  AU: "412345678",
  CA: "4165550198",
  DE: "15123456789",
  FR: "612345678",
  GB: "7400123456",
  GH: "244123456",
  IN: "9876543210",
  KE: "712345678",
  NG: "8012345678",
  US: "2025550147",
  ZA: "821234567",
};

export function phonePlaceholder(country) {
  const max = country?.max || 10;
  const sample = PLACEHOLDERS[country?.iso] || "5".repeat(max);
  return sample.slice(0, max);
}

export function nationalDigits(value, country) {
  const selected = country || phoneCountry(DEFAULT_PHONE_COUNTRY);
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith(selected.dial) && digits.length > selected.max) {
    digits = digits.slice(selected.dial.length);
  }
  if (digits.startsWith("0") && digits.length - 1 >= selected.min) {
    digits = digits.slice(1);
  }
  return digits.slice(0, selected.max);
}

export function phoneHint(country) {
  const selected = country || phoneCountry(DEFAULT_PHONE_COUNTRY);
  if (selected.min === selected.max) {
    return `${selected.flag} +${selected.dial} · ${selected.max} digits for ${selected.name}`;
  }
  return `${selected.flag} +${selected.dial} · ${selected.min}–${selected.max} digits for ${selected.name}`;
}

export function parsePhone({ iso, national }) {
  const country = phoneCountry(iso);
  const digits = nationalDigits(national, country);
  if (!digits) {
    return { ok: false, error: "Enter your phone number." };
  }
  if (digits.length < country.min) {
    const span = country.min === country.max ? `${country.max} digits` : `at least ${country.min} digits`;
    return { ok: false, error: `Enter ${span} for ${country.name}.` };
  }
  return {
    ok: true,
    iso: country.iso,
    dial: country.dial,
    national: digits,
    e164: `+${country.dial}${digits}`,
    country,
  };
}

export function toE164(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const compact = raw.startsWith("+") ? `+${digits}` : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : "";
}

export function phonesEqual(a, b) {
  const left = toE164(a) || String(a || "").replace(/\D/g, "");
  const right = toE164(b) || String(b || "").replace(/\D/g, "");
  return Boolean(left && right && left === right);
}

export function splitE164(e164) {
  const compact = toE164(e164);
  if (!compact) return null;
  const digits = compact.slice(1);
  const ranked = [...PHONE_COUNTRIES].sort((a, b) => {
    if (b.dial.length !== a.dial.length) return b.dial.length - a.dial.length;
    if (a.iso === DEFAULT_PHONE_COUNTRY) return -1;
    if (b.iso === DEFAULT_PHONE_COUNTRY) return 1;
    return a.name.localeCompare(b.name);
  });
  for (const country of ranked) {
    if (!digits.startsWith(country.dial)) continue;
    const national = digits.slice(country.dial.length);
    if (national.length >= country.min && national.length <= country.max) {
      return { iso: country.iso, national, country };
    }
  }
  return null;
}
