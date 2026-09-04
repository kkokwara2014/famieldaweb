import {
  countryOptionLabel,
  DEFAULT_PHONE_COUNTRY,
  nationalDigits,
  parsePhone,
  phoneCountry,
  phoneHint,
  phonePlaceholder,
  sortedPhoneCountries,
} from "../config/phone.js";

function fillCountrySelect(select, selectedIso = DEFAULT_PHONE_COUNTRY) {
  const current = select.value || selectedIso;
  const fragment = document.createDocumentFragment();
  for (const country of sortedPhoneCountries()) {
    const option = document.createElement("option");
    option.value = country.iso;
    option.textContent = countryOptionLabel(country);
    option.title = `${country.name} (+${country.dial})`;
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.value = [...select.options].some((option) => option.value === current)
    ? current
    : DEFAULT_PHONE_COUNTRY;
}

function applyCountry(root, country) {
  const input = root.querySelector("[data-phone-national]");
  const hint = root.querySelector("[data-phone-hint]");
  if (!input) return;
  input.maxLength = country.max;
  input.setAttribute("minlength", String(country.min));
  input.setAttribute("placeholder", phonePlaceholder(country));
  if (hint?.id) input.setAttribute("aria-describedby", hint.id);
  input.value = nationalDigits(input.value, country);
  if (hint) hint.textContent = phoneHint(country);
}

export function bindPhoneField(root) {
  if (!root || root.dataset.phoneReady === "true") return root;
  const select = root.querySelector("[data-phone-country]");
  const input = root.querySelector("[data-phone-national]");
  if (!select || !input) return root;

  fillCountrySelect(select, select.value || DEFAULT_PHONE_COUNTRY);
  applyCountry(root, phoneCountry(select.value));
  root.dataset.phoneReady = "true";

  select.addEventListener("change", () => {
    applyCountry(root, phoneCountry(select.value));
  });

  input.addEventListener("input", () => {
    const country = phoneCountry(select.value);
    const next = nationalDigits(input.value, country);
    if (input.value !== next) input.value = next;
  });

  input.addEventListener("paste", (event) => {
    event.preventDefault();
    const country = phoneCountry(select.value);
    input.value = nationalDigits(event.clipboardData?.getData("text") || "", country);
  });

  return root;
}

export function readPhoneField(root) {
  const select = root?.querySelector("[data-phone-country]");
  const input = root?.querySelector("[data-phone-national]");
  return parsePhone({
    iso: select?.value,
    national: input?.value,
  });
}
