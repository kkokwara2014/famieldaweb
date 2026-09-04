import { mountPublicNav } from "../components/navbar.js";
import { mountPublicFooter } from "../components/footer.js";
import { redirectIfAuthenticated } from "../guards/auth-guard.js";
import { initFormUx } from "../core/forms.js";
import { initPerformance } from "../core/performance.js";
import { initMonitoring } from "../observability/monitor.js";

export async function bootPublicAuth({ navLabel, redirectSignedIn = true } = {}) {
  initMonitoring();
  initFormUx();
  initPerformance();
  mountPublicNav(navLabel);
  mountPublicFooter();
  if (redirectSignedIn) {
    await redirectIfAuthenticated();
  }
}
