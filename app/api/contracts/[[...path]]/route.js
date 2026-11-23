import {sessionOwner} from "../../../../lib/auth.mjs";
import {store} from "../../../../lib/store.mjs";
import {MAX_FILE} from "../../../../lib/extraction.mjs";
import {startWorker} from "../../../../lib/queue.mjs";
import {CHAT_PROMPT, MISSING, UNCLEAR, chatRecord, searchChat} from "../../../../lib/review.mjs";
import {EMBEDDING_MODEL, ProviderError, stream} from "../../../../lib/provider.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = {"Cache-Control": "no-store"};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const respond = (data, status = 200) => Response.json(data, {status, headers: NO_STORE});
const problem = (detail, status) => respond({detail}, status);
const missing = () => problem("Contract or clause not found.", 404);

async function upload(request, owner) {
  const filename = new URL(request.url).searchParams.get("filename");
  if (!filename || filename.length > 220 || !/^[^/\\\x00-\x1f]+\.(pdf|docx|txt)$/i.test(filename) || filename.startsWith(".")) {
    return problem("Choose a PDF, DOCX or TXT file with a valid filename.", 400);
  }
  if (Number(request.headers.get("Content-Length")) > MAX_FILE) {
    return problem("The file exceeds the 20 MB upload limit.", 413);
  }
  if (!request.body) return problem("The file is empty.", 400);
  const parts = [];
  let size = 0;
  for await (const part of request.body) {
    size += part.byteLength;
    if (size > MAX_FILE) return problem("The file exceeds the 20 MB upload limit.", 413);
    parts.push(part);
  }
  if (!size) return problem("The file is empty.", 400);
  const raw = Buffer.concat(parts, size);
  if (/\.pdf$/i.test(filename) && !raw.subarray(0, 1024).includes("%PDF-")) {
    return problem("This file does not appear to be a PDF.", 400);
  }
  if (/\.docx$/i.test(filename) && raw.subarray(0, 4).toString("hex") !== "504b0304") {
    return problem("This file does not appear to be a DOCX.", 400);
  }
  const result = await store.create(owner, filename, raw);
  startWorker();
  return respond(result, 202);
}

async function questionText(request) {
  if (!request.body || Number(request.headers.get("Content-Length")) > 12_000) return "";
  const decoder = new TextDecoder();
  let data = "";
  for await (const chunk of request.body) {
    data += decoder.decode(chunk, {stream: true});
    if (data.length > 12_000) return "";
  }
  try {
    const question = JSON.parse(data + decoder.decode())?.question;
    if (typeof question === "string" && question.length <= 1200) return question.trim();
  } catch {
    return "";
  }
  return "";
}

function streamAnswer(request, owner, id, question) {
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(output) {
      const send = (event, data) => {
        if (!signal.aborted) output.enqueue(encoder.encode("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n"));
      };
      send("start", {});
      try {
        const [corpus, history] = await Promise.all([store.searchCorpus(owner, id), store.history(owner, id, 3)]);
        if (!corpus || !corpus.chunks.length) throw new ProviderError("This contract is no longer available.");
        if (corpus.model !== EMBEDDING_MODEL()) throw new ProviderError("The embedding model changed. Upload the contract again to reindex it.");
        const {context, candidates} = await searchChat(corpus.chunks, question, history, signal);
        const sources = [];
        let invalid = false;
        let pending = "";
        function accept(line) {
          const {quote, invalid: malformed} = chatRecord(line, candidates);
          invalid ||= malformed;
          if (quote && sources.length < 3 && !sources.some((source) => source.clause_id === quote.clause_id && source.quote === quote.quote)) {
            sources.push(quote);
            send("quote", quote);
          }
        }
        for await (const delta of stream(CHAT_PROMPT, context, signal)) {
          pending += delta;
          let end = pending.indexOf("\n");
          while (end >= 0) {
            accept(pending.slice(0, end));
            pending = pending.slice(end + 1);
            end = pending.indexOf("\n");
          }
          if (pending.length > 16_000) throw new ProviderError("The AI provider returned unreadable answer data.");
        }
        accept(pending);
        if (signal.aborted) return;
        const result = sources.length
          ? {status: "found", message: "", evidence: sources}
          : {status: invalid ? "unclear" : "not found", message: invalid ? UNCLEAR : MISSING, evidence: []};
        if (!await store.saveTurn(owner, id, question, result)) throw new ProviderError("This contract is no longer available.");
        send("done", result);
      } catch (error) {
        const expected = error instanceof ProviderError || signal.aborted;
        if (!expected) console.error("Chat failed", {id, error: error.name, code: error.code});
        send("error", {message: expected ? error.message : "The answer could not finish. Try again."});
      } finally {
        if (!abort.signal.aborted) output.close();
      }
    },
    cancel() { abort.abort(); },
  });
  return new Response(body, {headers: {
    "Cache-Control": "no-store, no-transform", "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no",
  }});
}

async function handle(request, {params}) {
  try {
    const owner = await sessionOwner(request);
    if (!owner) return problem("Sign in to access your contracts.", 401);
    const {path = []} = await params;
    const [id, section, ordinal] = path;
    const method = request.method === "HEAD" ? "GET" : request.method;
    if (!id) {
      if (method === "GET") return respond(await store.list(owner));
      if (method === "POST") return await upload(request, owner);
      return problem("Method not allowed.", 405);
    }
    if (!UUID.test(id) || path.length > 3) return missing();
    if (path.length === 3 && section === "clauses" && method === "GET") {
      if (!/^\d{1,3}$/.test(ordinal)) return missing();
      const clause = await store.clause(owner, id, Number(ordinal));
      return clause ? respond(clause) : missing();
    }
    if (path.length > 2) return missing();

    if (!section && method === "DELETE") {
      return await store.delete(owner, id) ? new Response(null, {status: 204, headers: NO_STORE}) : missing();
    }
    const doc = await store.detail(owner, id);
    if (!doc) return missing();
    if (!section && method === "GET") return respond(doc);
    if (section === "chat" && method === "GET") return respond(await store.history(owner, id));
    if (section === "chat" && method === "POST") {
      if (doc.status !== "reviewed") return problem("Wait for the checklist review before asking a question.", 409);
      const question = await questionText(request);
      return question ? streamAnswer(request, owner, id, question) : problem("Enter a question of up to 1,200 characters.", 400);
    }
    if (section === "review" && method === "POST") {
      if (!await store.retry(owner, id)) return problem("Only a failed review can be retried.", 409);
      startWorker();
      return respond(await store.detail(owner, id), 202);
    }
    return missing();
  } catch (error) {
    console.error("Contract API failure", {error: error.name, code: error.code});
    return problem("The request could not finish. Check the server setup and try again.", 500);
  }
}

export {handle as GET, handle as POST, handle as DELETE};
