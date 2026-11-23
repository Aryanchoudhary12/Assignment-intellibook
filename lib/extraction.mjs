import {Worker} from "node:worker_threads";
import {resolve} from "node:path";

export const MAX_FILE = 20 * 1024 * 1024;
export class ExtractionError extends Error {}

export function parseOffThread(name, raw) {
  return new Promise((resolveResult, reject) => {
    const worker = new Worker(resolve(process.cwd(), "lib/contracts.mjs"), {
      workerData: {name, raw}, resourceLimits: {maxOldGenerationSizeMb: 256},
    });
    const timer = setTimeout(() => {
      reject(new ExtractionError("The file took too long to extract. Try a smaller text-based contract."));
      worker.terminate();
    }, 45_000);
    worker.once("message", (message) => {
      clearTimeout(timer);
      if (message.error) reject(new ExtractionError(message.error));
      else resolveResult(message.result);
    });
    worker.once("error", () => {
      clearTimeout(timer);
      reject(new ExtractionError("The file could not be extracted within the processing limits."));
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(new ExtractionError("The file extraction ended early."));
    });
  });
}
