import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {setTimeout as sleep} from "node:timers/promises";
import {fixtureServer} from "./fixture-server.mjs";

const database = process.env.TEST_DATABASE_URL;
const sample = await readFile(new URL("../samples/Harborline-services-agreement.txt", import.meta.url));

test("Next.js API with a real MongoDB replica set", {skip: !database, timeout: 85_000}, async () => {
  let server = await fixtureServer(database, {corrupt: true});
  const alice = "user_test_" + crypto.randomUUID();
  const bob = "user_test_" + crypto.randomUUID();
  const paths = [];
  let aliceToken = await server.sign(alice);
  let bobToken = await server.sign(bob);

  function call(path = "", token = aliceToken, options = {}) {
    const headers = {...options.headers};
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(server.url + "/api/contracts" + path, {...options, headers});
  }

  async function upload(name, body) {
    const response = await call("?filename=" + name, aliceToken, {method: "POST", body});
    const doc = await response.json();
    assert.equal(response.status, 202, JSON.stringify(doc));
    const path = "/" + doc.id;
    paths.push(path);
    return path;
  }

  async function completed(path) {
    for (let i = 0; i < 60; i++) {
      const doc = await (await call(path)).json();
      if (doc.status !== "processing") return doc;
      await sleep(250);
    }
    throw new Error("Review did not complete.");
  }

  try {
    assert.equal((await call("", null)).status, 401);
    assert.equal((await call("", await server.sign(alice, {azp: "https://other.example"}))).status, 401);
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
    assert.equal((await call("?filename=large.txt", aliceToken, {method: "POST", body: oversized})).status, 413);

    const exact = await upload("20MB.txt", oversized.subarray(1));
    assert.equal((await (await call(exact)).json()).size, 20 * 1024 * 1024);
    assert.equal((await call(exact, aliceToken, {method: "DELETE"})).status, 204);

    const path = await upload("Agreement.txt", sample);
    const doc = await completed(path);
    assert.equal(doc.status, "reviewed", JSON.stringify(doc));
    assert.equal(doc.findings.length, 8);
    assert.equal(doc.findings.find(({id}) => id === "renewal").status, "not found");
    assert.equal(doc.findings.find(({id}) => id === "liability").status, "unclear");
    const ref = doc.findings.find(({id}) => id === "payment").evidence[0];
    const clause = path + "/clauses/" + ref.clause_id;
    assert.match(await (await call(clause)).text(), /Invoices are payable/);
    assert.deepEqual(await (await call("", bobToken)).json(), []);

    const question = (text) => ({method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({question: text})});
    for (const [url, options] of [
      [path, {}], [path, {method: "DELETE"}], [path + "/review", {method: "POST"}],
      [clause, {}], [path + "/chat", {}], [path + "/chat", question("When are invoices due?")],
    ]) assert.equal((await call(url, bobToken, options)).status, 404);

    const response = await call(path + "/chat", aliceToken, question("When are invoices due?"));
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const stream = await response.text();
    assert.equal((stream.match(/event: quote/g) || []).length, 2);
    assert.match(stream, /event: done/);
    const missing = await call(path + "/chat", aliceToken, question("What is the bank account number?"));
    assert.match(await missing.text(), /Not found in the contract/);

    const limited = await upload("Limited.txt", "1. Terms\nFIXTURE_RATE_LIMIT");
    assert.match((await completed(limited)).error, /rate-limited/);
    assert.equal((await call(limited + "/review", aliceToken, {method: "POST"})).status, 202);

    server.stop();
    server = await fixtureServer(database, {port: 8766});
    aliceToken = await server.sign(alice);
    bobToken = await server.sign(bob);
    assert.equal((await (await call(path + "/chat")).json()).length, 2);
    assert.equal((await (await call(path)).json()).status, "reviewed");
    assert.equal((await call(path, aliceToken, {method: "DELETE"})).status, 204);
    assert.equal((await call(clause)).status, 404);
  } finally {
    for (const path of paths) await call(path, aliceToken, {method: "DELETE"}).catch(() => {});
    server.stop();
  }
});
