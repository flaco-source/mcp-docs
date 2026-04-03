/**
 * Invokes `run.ts all` after `npm run build`. E2E PDF steps are gated by `RUN_E2E_NETWORK` in run.ts (default false).
 */
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..", "..");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let r = spawnSync(npm, ["run", "build"], { stdio: "inherit", cwd: root });
if (r.status) process.exit(r.status ?? 1);
r = spawnSync("npx", ["tsx", path.join("scripts", "agent-flow", "run.ts"), "all"], {
    stdio: "inherit",
    cwd: root,
});
process.exit(r.status ?? 0);
