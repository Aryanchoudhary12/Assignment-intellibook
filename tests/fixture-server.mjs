import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";
import {fixtureAuth} from "./fixture-auth.mjs";

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const preload = fileURLToPath(new URL("./provider-fixture.mjs", import.meta.url));

export async function fixtureServer(database, {port = 8765, corrupt = false, demo = false} = {}) {
  if (!database) throw new Error("Set TEST_DATABASE_URL to a disposable MongoDB replica-set database and run db:push first.");
  const url = "http://127.0.0.1:" + port;
  const {env, sign} = await fixtureAuth(url);
  const child = spawn(process.execPath, ["--import", preload, next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    stdio: "inherit",
    env: {...process.env, ...env, DATABASE_URL: database, OPENROUTER_API_KEY: "local-fixture",
      FIXTURE_CORRUPT: corrupt ? "1" : "", FIXTURE_DEMO: demo ? "1" : "", NEXT_TELEMETRY_DISABLED: "1"},
  });
  const stop = () => child.kill("SIGTERM");
  for (let i = 0; i < 100 && child.exitCode === null; i++) {
    try {
      const response = await fetch(url + "/config");
      const config = await response.json();
      if (response.ok && config.publishableKey === env.CLERK_PUBLISHABLE_KEY) return {url, sign, stop};
    } catch {
      // Wait for Next.js to accept requests.
    }
    await sleep(150);
  }
  stop();
  throw new Error("The Next.js fixture server did not start.");
}
