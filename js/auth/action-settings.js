import { actionContinueUrl } from "../core/firebase.js";
import { routes } from "../config/routes.js";

export function emailActionSettings(path = routes.login) {
  return {
    url: actionContinueUrl(path),
    handleCodeInApp: false,
  };
}
