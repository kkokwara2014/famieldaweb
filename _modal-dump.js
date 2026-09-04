const { spawnSync } = require("child_process");

const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const r = spawnSync(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--window-size=390,844",
    "--virtual-time-budget=5000",
    "--dump-dom",
    "http://127.0.0.1:18973/_modal-verify.html",
  ],
  { encoding: "utf8", timeout: 20000 },
);

const stdout = r.stdout || "";
console.log("stdoutLen", stdout.length);
const verify = stdout.match(/data-verify="([\s\S]*?)"/);
console.log(verify ? verify[1] : "no verify attr");
const results = stdout.match(/id="results">([\s\S]*?)<\/p>/);
console.log(results ? results[1] : "no results");
