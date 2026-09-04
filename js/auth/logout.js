import { logoutAccount } from "./auth-service.js";
import { clearSession, getSession } from "./session.js";
import { go, routes } from "../config/routes.js";
import { confirmDialog } from "../components/modal.js";
import { toast } from "../components/toast.js";

export async function logout() {
  await logoutAccount();
  clearSession();
  go(routes.login);
}

export async function requestLogout() {
  const session = getSession();
  const email = String(session?.email || "").trim();

  return confirmDialog({
    kicker: "Account",
    title: "Sign out of Famielda?",
    body: email
      ? `You are signed in as ${email}. This ends the session on this device. Household care records stay in Famielda.`
      : "This ends the session on this device. Household care records stay in Famielda, and you can sign in again at any time.",
    confirmLabel: "Sign out",
    cancelLabel: "Stay signed in",
    danger: true,
    icon: "signout",
    onConfirm: async () => {
      try {
        await logout();
      } catch (error) {
        toast(error.message || "Could not sign out. Try again.", { type: "error" });
        throw error;
      }
    },
  });
}
