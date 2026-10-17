import { spawnSync } from "node:child_process";

function runNpm(args) {
  const windows = process.platform === "win32";
  const command = windows ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const commandArgs = windows ? ["/d", "/s", "/c", `npm ${args.join(" ")}`] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.VERCEL_ENV === "production") {
  if (!process.env.DIRECT_URL) {
    throw new Error("Production Vercel builds require DIRECT_URL to apply reviewed database migrations.");
  }
  runNpm(["run", "db:migrate:deploy"]);
}

runNpm(["run", "build"]);
