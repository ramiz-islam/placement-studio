/**
 * Starts `next dev` writing to .next-dev instead of .next.
 *
 * Why: a production build — including the one inside `npm run cf:deploy` —
 * writes to .next. If a dev server is serving from the same directory it starts
 * throwing "Cannot find module './xxx.js'" and stays broken until you delete
 * .next and restart. Separate directories make the two safe to run at once.
 */

import { spawn } from "node:child_process";
import path from "node:path";

process.env.NEXT_DIST_DIR = ".next-dev";

const bin = path.join("node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
const child = spawn(bin, ["dev", "-p", process.env.PORT || "3210"], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

child.on("exit", code => process.exit(code ?? 0));
