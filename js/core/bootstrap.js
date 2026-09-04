import { initFirebase } from "./firebase.js";
import { initPerformance } from "./performance.js";
import { idle, loadModule } from "./lazy.js";
import { requireAuth } from "../guards/auth-guard.js";
import { requireRole } from "../guards/role-guard.js";
import { requireOnboarding } from "../guards/onboarding-guard.js";
import { requireRoleSetup } from "../guards/role-setup-guard.js";
import { requirePlan } from "../guards/subscription-guard.js";
import { onSessionChange } from "../auth/session.js";
import { initAppShell } from "../components/app-shell.js";
import { initUiSystem } from "../components/ui-system.js";
import { initFormUx } from "./forms.js";
import { go, routes } from "../config/routes.js";
import { initMonitoring } from "../observability/monitor.js";

export async function bootApp({ page, requiredRole, requiredPlan, title, crumbs } = {}) {
  initMonitoring();
  await initFirebase();
  const session = await requireAuth();

  requireRoleSetup(session);
  requireOnboarding(session);

  if (requiredRole) {
    requireRole(session, requiredRole);
  }

  if (requiredPlan) {
    requirePlan(session, requiredPlan);
  }

  onSessionChange((next) => {
    if (!next) go(routes.login);
  });

  await initAppShell({ page, session, title, crumbs });
  initUiSystem();
  initFormUx();
  initPerformance();
  idle(() => {
    loadModule("../notifications/fcm.js")
      .then(({ initPushNotifications }) => initPushNotifications(session))
      .catch((error) => {
        import("../services/monitoring-service.js")
          .then((mod) => mod.trackFirebaseSignal({
            name: "messaging",
            ok: false,
            code: error.code || "messaging",
            message: error.message || "Push notifications failed to start",
          }))
          .catch(() => {});
      });
  });
  return session;
}
