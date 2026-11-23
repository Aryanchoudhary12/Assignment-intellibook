import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {extract} from "../lib/contracts.mjs";
import {parseOffThread} from "../lib/extraction.mjs";
import {CHECKLIST, checkedFinding, chatRecord, evidence} from "../lib/review.mjs";
import {sessionOwner} from "../lib/auth.mjs";
import {fixtureAuth} from "./fixture-auth.mjs";

const inputs = ["tests/files/sample.pdf", "tests/files/sample.docx"];

test("PDF carries a clause across page boundaries", async () => {
  const output = await parseOffThread("sample.pdf", await readFile(inputs[0]));
  assert.equal(output.clauses.length, 1);
  assert.deepEqual(output.chunks.map(({location}) => location), ["Page 1", "Page 2"]);
  assert.match(output.chunks[1].text, /30 days notice/);
});

test("DOCX keeps section labels and word-for-word content", async () => {
  const {clauses, chunks} = await extract("sample.docx", await readFile(inputs[1]));
  assert.equal(clauses[0].title, "3. Payment Terms");
  assert.equal(chunks[0].location, "Section 3");
  assert.match(chunks[0].text, /Pay within thirty days\./);
});

test("validation returns literal wrapped source and rejects altered quotes and wrong IDs", () => {
  const chunk = {id: 0, location: "Page 4", clauseId: 3, text: "Pay in\n30 days."};
  const candidates = new Map([[0, chunk]]);
  assert.equal(evidence({chunk_id: 0, quote: "Pay in 30 days."}, candidates).quote, "Pay in\n30 days.");
  assert.equal(evidence({chunk_id: 2, quote: "Pay in 30 days."}, candidates), null);
  const invalid = {chunk_id: 0, quote: "Pay in 90 days."};
  assert.equal(checkedFinding(CHECKLIST[2], {status: "found", summary: "Due in 90 days", evidence: [invalid]}, [chunk]).status, "unclear");
  assert.deepEqual(chatRecord(JSON.stringify(invalid), candidates), {quote: null, invalid: true});
});

test("Clerk JWT validation enforces signature, issuer, origin, expiry and completed session", async () => {
  const {env, sign} = await fixtureAuth("http://localhost:3000");
  const bearer = (token) => new Request("http://localhost:3000", {headers: {Authorization: "Bearer " + token}});
  assert.equal(await sessionOwner(bearer(await sign("user_alice")), env), "user_alice");
  for (const claims of [{azp: "https://other.test"}, {iss: "https://other.test"}, {exp: 1}, {sts: "pending"}]) {
    assert.equal(await sessionOwner(bearer(await sign("user_alice", claims)), env), null);
  }
  assert.equal(await sessionOwner(bearer("invalid.token.signature"), env), null);
});
