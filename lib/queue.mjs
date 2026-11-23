import {store} from "./store.mjs";
import {parseOffThread, ExtractionError} from "./extraction.mjs";
import {embed, EMBEDDING_MODEL, ProviderError} from "./provider.mjs";
import {makeReview} from "./review.mjs";

const key = Symbol.for("clausebook.worker");
const queue = globalThis[key] ??= {started: false, working: false, resumed: false};

async function drain() {
  if (queue.working) return;
  queue.working = true;
  try {
    if (!queue.resumed) {
      await store.resume();
      queue.resumed = true;
    }
    let job;
    while ((job = await store.claim())) {
      const {owner, id, name, size} = job;
      try {
        const raw = await store.raw(owner, id);
        if (raw.length !== size) throw new Error("Stored upload is incomplete.");
        const {clauses, chunks} = await parseOffThread(name, raw);
        const vectors = await embed(chunks.map(({text}) => text), "search_document");
        const indexed = chunks.map((chunk, i) => ({...chunk, vector: vectors[i]}));
        const findings = await makeReview(indexed);
        await store.finish(owner, id, clauses, indexed, findings, EMBEDDING_MODEL());
      } catch (error) {
        const expected = error instanceof ExtractionError || error instanceof ProviderError;
        if (!expected) console.error("Review failed", {id, error: error.name, code: error.code});
        await store.fail(owner, id, expected ? error.message : "The review could not finish. Try again.");
      }
    }
  } catch (error) {
    console.error("Review worker unavailable", {error: error.name, code: error.code});
  } finally {
    queue.working = false;
  }
}

export function startWorker() {
  if (queue.started) return;
  queue.started = true;
  setInterval(drain, 2000).unref();
  void drain();
}
