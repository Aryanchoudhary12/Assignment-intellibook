export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DATABASE_URL) {
    const {startWorker} = await import("./lib/queue.mjs");
    startWorker();
  }
}
