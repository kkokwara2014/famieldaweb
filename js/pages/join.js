import { bootPublicAuth } from "../auth/public-boot.js";
import { qs, escapeHtml } from "../core/dom.js";
import {
  isValidReferralCode,
  normalizeReferralCode,
  persistReferralCode,
  readStoredReferralCode,
  registerHrefForCode,
} from "../config/referrals.js";

// Bridge for shared referral links (https://famielda.org/join?ref=CODE).
// There is no server preview here on purpose: visitors are signed out, so a
// live code lookup would be denied. Instead we persist the code (the register
// page and the mobile app pick it up from the URL/session) and offer both
// continuations: the mobile app via the famielda:// custom scheme (needs no
// App-Link verification) and the web via register.html?ref=CODE.
await bootPublicAuth({ redirectSignedIn: false, navLabel: "Join" });

const card = qs("[data-join-card]");
const code = persistReferralCode(readStoredReferralCode());

if (!code || !isValidReferralCode(code)) {
  card.innerHTML = `
    <header>
      <p class="page-kicker">Join</p>
      <h1>No invite code found</h1>
      <p>This link does not carry a valid family invite code. Ask the person
      who invited you for a fresh link, or create an account below — you can
      enter an invite code on the next step in the mobile app.</p>
    </header>
    <div class="stack">
      <a class="btn btn--primary" href="register.html">Create an account</a>
      <a class="btn btn--ghost" href="index.html">Go home</a>
    </div>`;
} else {
  const safe = escapeHtml(code);
  const appHref = `famielda://join?ref=${encodeURIComponent(code)}`;
  const webHref = registerHrefForCode(code).replace(/^\//, "");
  card.innerHTML = `
    <header>
      <p class="page-kicker">Family invite</p>
      <h1>You are invited to Famielda</h1>
      <p>Your invite code <strong>${safe}</strong> is saved — it will be
      applied automatically when you create your account.</p>
    </header>
    <div class="stack">
      <a class="btn btn--primary" id="join-open-app" href="${appHref}">Open in the Famielda app</a>
      <a class="btn btn--ghost" href="${escapeHtml(webHref)}">Continue on the web</a>
      <button class="btn btn--ghost" id="join-copy" type="button">Copy invite code</button>
    </div>
    <p class="hint">Have the app? The button above opens your invitation there.
    Otherwise continue on the web — the code travels with you.</p>`;
  qs("#join-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(normalizeReferralCode(code));
      qs("#join-copy").textContent = "Copied";
    } catch {
      qs("#join-copy").textContent = code;
    }
  });
}
