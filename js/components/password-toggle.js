const EYE = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2.5 12s3.6-7 9.5-7 9.5 7 9.5 7-3.6 7-9.5 7-9.5-7-9.5-7Z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
`;

const EYE_OFF = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 3l18 18"/>
    <path d="M10.6 10.7a3 3 0 0 0 4.2 4.2"/>
    <path d="M7 7.4C4.7 8.8 3 12 3 12s3.6 7 9 7c1.8 0 3.4-.5 4.8-1.3"/>
    <path d="M12.5 5.1A10.6 10.6 0 0 1 21 12s-.8 1.6-2.2 3.2"/>
  </svg>
`;

function wrapPasswordInput(input) {
  let wrap = input.closest(".password-field");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "password-field";
    input.parentNode.insertBefore(wrap, input);
    wrap.append(input);
  }

  let button = wrap.querySelector(".password-field__toggle");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "password-field__toggle";
    wrap.append(button);
  }

  return wrap;
}

function bindToggle(button, input) {
  if (button.dataset.bound === "true") return;
  button.dataset.bound = "true";

  const sync = (visible) => {
    input.type = visible ? "text" : "password";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    button.innerHTML = visible ? EYE_OFF : EYE;
  };

  sync(input.type === "text");
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    sync(input.type === "password");
  });
}

export function initPasswordVisibility(root = document) {
  root.querySelectorAll('input[type="password"], .password-field input').forEach((input) => {
    if (input.dataset.passwordToggleReady === "true") return;
    const wrap = wrapPasswordInput(input);
    const button = wrap.querySelector(".password-field__toggle");
    if (!button) return;
    bindToggle(button, input);
    input.dataset.passwordToggleReady = "true";
  });
}
