import { bootApp } from "../core/bootstrap.js";
import { go, homeFor } from "../config/routes.js";

bootApp({ page: "dashboard" }).then((session) => {
  go(homeFor(session));
});
