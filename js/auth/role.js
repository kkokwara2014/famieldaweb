import { usesLiveAuth } from "../core/firebase.js";
import { normalizeRoleSelection } from "../config/roles.js";
import { getSession, setSession } from "./session.js";
import { updateUserProfile } from "./user-profile.js";
import { updateMockUser } from "./auth-service.js";
import { PRODUCT_EVENTS, trackProductEvent } from "../services/analytics-service.js";
import { isProfessionalRole } from "../config/roles.js";

export async function saveRoleProfile({ role, professionalType = null }) {
  const session = getSession();
  if (!session?.id) {
    throw new Error("Sign in to save your role.");
  }

  const selection = normalizeRoleSelection({ role, professionalType });
  const roleSelectedAt = new Date().toISOString();
  const next = {
    ...session,
    ...selection,
    roleSelectedAt,
    updatedAt: roleSelectedAt,
  };

  if (usesLiveAuth()) {
    await updateUserProfile(session.id, {
      role: selection.role,
      professionalType: selection.professionalType,
      roleSelectedAt,
    });
  } else {
    updateMockUser(next);
  }

  const saved = setSession(next);
  trackProductEvent(PRODUCT_EVENTS.ROLE_SELECTED, {
    dedupeKey: `role_selected:${saved.id}:${selection.role}`,
    role: selection.role,
    professionalType: selection.professionalType || "",
    plan: saved.plan,
  }, saved);

  if (isProfessionalRole(saved.role)) {
    try {
      const { ensureMyVerification } = await import("../services/verification-service.js");
      const record = await ensureMyVerification(saved);
      if (record?.status) {
        return setSession({
          ...saved,
          verificationStatus: record.status,
          verifiedAt: record.verifiedAt,
        });
      }
    } catch {
      return saved;
    }
  }
  return saved;
}
