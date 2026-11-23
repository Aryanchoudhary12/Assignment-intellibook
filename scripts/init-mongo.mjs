/** Initialize a local replica set for the native launcher. Prisma owns the application data. */
import {setTimeout as sleep} from "node:timers/promises";
import {MongoClient} from "mongodb";

const [port, replica, mode] = process.argv.slice(2);
if (!/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535 || !/^[\w-]{1,64}$/.test(replica)) {
  console.error("Invalid local MongoDB startup settings.");
  process.exit(2);
}
const probe = mode === "--probe";
const client = new MongoClient("mongodb://127.0.0.1:" + port + "/admin?directConnection=true", {
  connectTimeoutMS: 750, serverSelectionTimeoutMS: probe ? 850 : 1000,
});
const db = client.db("admin");
let ready = false;
let reachable = false;
let initiated = false;
const attempts = probe ? 1 : 40;
try {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const hello = await db.command({hello: 1});
      reachable = true;
      if (hello.setName && hello.setName !== replica) break;
      if (hello.isWritablePrimary && hello.setName === replica) {
        ready = true;
        break;
      }
      if (!probe && !initiated && !hello.setName) {
        // A single member listening only on loopback is sufficient for local transactions.
        try {
          await db.command({replSetInitiate: {_id: replica, members: [{_id: 0, host: "localhost:" + port}]}});
        } catch (error) {
          if (error.codeName !== "AlreadyInitialized") throw error;
        }
        initiated = true;
      }
    } catch {
      // The local process may still be starting.
    }
    if (attempt + 1 < attempts) await sleep(300);
  }
} finally {
  await client.close();
}
if (!probe) console.log(ready ? "Local MongoDB replica set is ready." : "Local MongoDB replica set did not become ready.");
if (!ready) process.exitCode = probe && reachable ? 2 : 1;
