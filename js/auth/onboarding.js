import { ONBOARDING_PATH, ROLES } from "../config/constants.js";
import { hasCompletedRoleSetup } from "../config/roles.js";
import { normalizeOnboardingInput } from "../config/onboarding.js";
import { usesLiveAuth } from "../core/firebase.js";
import { getSession, setSession } from "./session.js";
import { updateUserProfile } from "./user-profile.js";
import { updateMockUser } from "./auth-service.js";
import { createSeniorProfile } from "../services/senior-service.js";
import { listIncomingInvites } from "../services/care-circle-service.js";

function persist(session, patch) {
  const next = {
    ...session,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  if (!usesLiveAuth()) updateMockUser(next);
  return setSession(next);
}

async function writeProfile(session, patch) {
  if (usesLiveAuth()) {
    await updateUserProfile(session.id, patch);
  }
  return persist(session, patch);
}

export async function saveOnboardingProfile(input = {}, session = getSession()) {
  if (!session?.id) {
    throw new Error("Sign in to finish onboarding.");
  }
  if (!hasCompletedRoleSetup(session)) {
    throw new Error("Choose your role first.");
  }

  const selection = normalizeOnboardingInput(session.role, {
    ...input,
    professionalType: input.professionalType || session.professionalType,
  });

  if (session.role === ROLES.FAMILY && selection.onboardingPath === ONBOARDING_PATH.JOIN_EXISTING) {
    const incoming = await listIncomingInvites(session);
    if (!incoming.length) {
      throw new Error("No invitation is waiting. Add the person you are caring for, or ask a relative to invite you.");
    }
  }

  const onboardingCompletedAt = new Date().toISOString();
  const patch = {
    onboardingPath: selection.onboardingPath || "",
    familyRelationship: selection.familyRelationship || "",
    careTypes: selection.careTypes || [],
    specialty: selection.specialty || "",
    ...(selection.professionalType ? { professionalType: selection.professionalType } : {}),
  };

  let saved = await writeProfile(session, patch);

  if (session.role === ROLES.FAMILY && selection.senior && !saved.seniorId) {
    await createSeniorProfile(selection.senior, saved);
    saved = getSession() || saved;
  }

  return writeProfile(saved, { onboardingCompletedAt });
}
