/** Test-only OpenRouter substitute loaded explicitly via Node --import. */
import {createHash} from "node:crypto";

const originalFetch = globalThis.fetch;
const FACTS = {
  parties: ["This Services Agreement is entered into", "Harborline Studio LLC is the client and Northstar Data Works Ltd. is the provider."],
  term: ["This Agreement starts on", "The agreement runs from January 1 through December 31, 2027."],
  payment: ["Client will pay Provider", "The client pays USD 4,500 per month. Invoices are due within 30 calendar days of receipt."],
  termination: ["Either party may terminate", "Either party can terminate with 30 days’ written notice."],
  liability: ["Each party’s aggregate liability", "Liability is capped at six months of fees, with exceptions for fraud and willful misconduct."],
  confidentiality: ["Each party must keep", "Confidentiality lasts through the agreement and for two years afterward."],
  law: ["This Agreement is governed", "New York law governs the agreement."],
};

globalThis.fetch = async function fixtureFetch(input, options) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin !== "https://openrouter.ai") return originalFetch(input, options);
  const body = JSON.parse(options?.body ?? await input.text());
  const delay = process.env.FIXTURE_DEMO ? 160 : 3;
  if (url.pathname.endsWith("/embeddings")) {
    if (body.input.some((text) => text.includes("FIXTURE_RATE_LIMIT"))) return new Response(null, {status: 429});
    return Response.json({data: body.input.map((text, index) => {
      const embedding = Array(64).fill(0);
      for (const word of text.toLowerCase().match(/\w+/g) ?? []) {
        embedding[createHash("sha256").update(word).digest()[0] % 64]++;
      }
      if (!embedding.some(Boolean)) embedding[0] = 1;
      return {index, embedding};
    })});
  }
  if (!url.pathname.endsWith("/chat/completions")) throw new Error("Unexpected fixture request");
  const data = JSON.parse(body.messages.at(-1).content);
  if (!body.stream) {
    const verdict = {};
    for (const [id, item] of Object.entries(data)) {
      const [needle, summary] = FACTS[id] || [];
      const chunk = needle && item.excerpts.find(({text}) => text.includes(needle));
      const missing = {status: "not found", summary: "", evidence: []};
      if (!chunk) {
        verdict[id] = missing;
        continue;
      }
      const sentence = chunk.text.split("\n").find((line) => line.includes(needle)).trim();
      const corrupted = process.env.FIXTURE_CORRUPT === "1" && id === "liability";
      verdict[id] = {status: "found", summary,
        evidence: [{chunk_id: chunk.id, quote: corrupted ? "Liability is capped at one hundred gold coins." : sentence}]};
    }
    return Response.json({choices: [{message: {content: JSON.stringify(verdict)}, finish_reason: "stop"}]});
  }
  const chunk = data.excerpts.find(({text}) => text.includes("Invoices are payable within 30 calendar days"));
  const quotes = chunk && /invoice/i.test(data.question)
    ? ["Invoices are payable within 30 calendar days of receipt.", "Client will pay Provider USD 4,500 per month."]
      .map((quote) => ({chunk_id: chunk.id, quote}))
    : [{status: "not found"}];
  const deltas = quotes.map((item) => JSON.stringify(item) + "\n").flatMap((line) => line.match(/.{1,15}|\n/g));
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    async pull(controller) {
      if (!deltas.length) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      const data = {choices: [{delta: {content: deltas.shift()}}]};
      controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
    },
  }), {headers: {"Content-Type": "text/event-stream"}});
};
