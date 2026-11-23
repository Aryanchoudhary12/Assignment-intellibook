import {parentPort, workerData} from "node:worker_threads";
import {resolve, sep} from "node:path";
import {createRequire} from "node:module";
import {SaxesParser} from "saxes";
import yauzl from "yauzl";

const MAX_TEXT = 600_000;
const MAX_CHUNKS = 450;
const CHUNK_SIZE = 1600;
const HEADING = /^\s*(?:(?:section|article|clause)\s+([\w.-]+)\b|(\d+(?:\.\d+)*|[IVXLCDM]{1,7})(?:[.)]\s+|\s+(?=[A-Z])))/i;
const TITLES = /^(?:agreement|parties|term(?: and (?:renewal|termination))?|payment(?: terms)?|fees|termination|limitation of liability|confidentiality|governing law|(?:auto(?:matic)?[ -])?renewal|definitions|scope(?: of services)?|signatures)\s*[:.]?$/i;
const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export class ContractError extends Error {}

function documentXml(raw) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(raw), {lazyEntries: true}, (error, zip) => {
      if (error) return reject(error);
      zip.on("error", reject);
      zip.on("end", () => reject(new ContractError("The DOCX does not contain a document body.")));
      zip.on("entry", (entry) => {
        if (entry.fileName !== "word/document.xml") {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > 12 * 1024 * 1024) {
          zip.close();
          reject(new ContractError("The DOCX document XML is too large to process."));
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error) {
            zip.close();
            return reject(error);
          }
          const pieces = [];
          stream.on("data", (piece) => pieces.push(piece));
          stream.on("error", (error) => {
            zip.close();
            reject(error);
          });
          stream.on("end", () => {
            zip.close();
            resolve(Buffer.concat(pieces).toString("utf8"));
          });
        });
      });
      zip.readEntry();
    });
  });
}

function docxParagraphs(xml) {
  const parser = new SaxesParser({xmlns: true});
  const paragraphs = [];
  const stack = [];
  let inText = false;
  parser.on("doctype", () => { throw new ContractError("The DOCX contains an unsupported XML declaration."); });
  parser.on("opentag", ({local, uri}) => {
    if (uri !== WORD) return;
    if (local === "p") {
      const paragraph = {text: ""};
      paragraphs.push(paragraph);
      stack.push(paragraph);
    } else if (local === "t") {
      inText = true;
    } else if (stack.length && local === "tab") {
      stack.at(-1).text += "\t";
    } else if (stack.length && (local === "br" || local === "cr")) {
      stack.at(-1).text += "\n";
    }
  });
  parser.on("text", (text) => {
    if (inText && stack.length) stack.at(-1).text += text;
  });
  parser.on("closetag", ({local, uri}) => {
    if (uri !== WORD) return;
    if (local === "t") inText = false;
    if (local === "p") stack.pop();
  });
  parser.write(xml).close();
  return paragraphs.map((paragraph, index) => [index + 1, paragraph.text]);
}

async function extractUnits(name, raw) {
  const extension = name.split(".").at(-1).toLowerCase();
  if (extension === "txt") {
    try {
      const text = new TextDecoder("utf-8", {fatal: true}).decode(raw);
      if (text.length > MAX_TEXT) throw new ContractError("This contract has too much text to review in one upload.");
      return text.split(/\r\n|\n|\r/).map((line, index) => [index + 1, line]);
    } catch (error) {
      if (error instanceof ContractError) throw error;
      throw new ContractError("Save the TXT file as UTF-8 and upload it again.");
    }
  }
  if (extension === "docx") return docxParagraphs(await documentXml(raw));
  const require = createRequire(import.meta.url);
  const assets = resolve(require.resolve("pdfjs-dist/package.json"), "..");
  const {getDocument} = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: Uint8Array.from(raw), isEvalSupported: false, stopAtErrors: true,
    standardFontDataUrl: resolve(assets, "standard_fonts") + sep,
    cMapUrl: resolve(assets, "cmaps") + sep, cMapPacked: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 350) throw new ContractError("This PDF exceeds the 350-page processing limit.");
    const pages = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const {items} = await page.getTextContent({disableNormalization: true});
      const text = items.map((item) => (item.str ?? "") + (item.hasEOL ? "\n" : "")).join("");
      length += text.length;
      if (length > MAX_TEXT) throw new ContractError("This contract has too much text to review in one upload.");
      pages.push([number, text]);
      page.cleanup();
    }
    return pages;
  } catch (error) {
    if (error.name === "PasswordException") throw new ContractError("This PDF is password protected.");
    throw error;
  } finally {
    await task.destroy();
  }
}

export async function extract(name, raw) {
  let units;
  try {
    units = await extractUnits(name, raw);
  } catch (error) {
    if (error instanceof ContractError) throw error;
    throw new ContractError("The file could not be read. Check the format and upload it again.");
  }
  if (!units.some(([, text]) => text.trim())) {
    throw new ContractError("No selectable text was found. Export a text-based PDF, DOCX or TXT.");
  }
  if (units.reduce((total, [, text]) => total + text.length, 0) > MAX_TEXT) {
    throw new ContractError("This contract has too much text to review in one upload.");
  }
  const pdf = /\.pdf$/i.test(name);
  const anchor = /\.docx$/i.test(name) ? "Paragraph" : "Line";
  const clauses = [];
  let clause = {id: 0, title: "Opening text", parts: []};
  let section = "";
  for (const [number, text] of units) {
    for (const line of text.split(/\r?\n/)) {
      const title = line.trim();
      if (!title && !clause.parts.length) continue;
      const match = HEADING.exec(line);
      // Ignore numeric line wraps such as "30 days" and ordinary "I agree" sentences.
      const numbered = match?.[2] && /^\s*(?:\d+(?:\.\d+)*|[IVXLCDM]+)(?:[.)]|\s+[A-Z])/.test(line);
      if (match?.[1] || numbered || TITLES.test(title)) {
        if (clause.parts.length) clauses.push(clause);
        clause = {id: clauses.length, title: title.slice(0, 140), parts: []};
        section = match ? "Section " + (match[1] || match[2]) : title;
      }
      const location = pdf ? "Page " + number : section || anchor + " " + number;
      clause.parts.push([location, line]);
    }
  }
  if (clause.parts.length) clauses.push(clause);

  const chunks = [];
  for (const clause of clauses) {
    const groups = [];
    for (const [location, line] of clause.parts) {
      if (!groups.length || (pdf && groups.at(-1).location !== location)) groups.push({location, lines: []});
      groups.at(-1).lines.push(line);
    }
    for (const {location, lines} of groups) {
      const lastAnchor = clause.parts.at(-1)[0];
      const label = !pdf && location.startsWith(anchor + " ") && location !== lastAnchor
        ? anchor + "s " + location.split(" ")[1] + "–" + lastAnchor.split(" ")[1]
        : location;
      let remaining = lines.join("\n").trim();
      while (remaining) {
        let end = Math.min(CHUNK_SIZE, remaining.length);
        if (remaining.length > CHUNK_SIZE) {
          for (const separator of ["\n\n", "\n", ". ", " "]) {
            const boundary = remaining.lastIndexOf(separator, CHUNK_SIZE - separator.length);
            if (boundary >= CHUNK_SIZE / 2) {
              end = boundary + separator.length;
              break;
            }
          }
        }
        chunks.push({id: chunks.length, clauseId: clause.id, location: label, text: remaining.slice(0, end).trim()});
        remaining = remaining.slice(end).trimStart();
      }
    }
  }
  if (!chunks.length || chunks.length > MAX_CHUNKS) {
    throw new ContractError("This contract has no indexable text or too many sections.");
  }
  return {clauses, chunks};
}

if (parentPort && workerData) {
  try {
    parentPort.postMessage({result: await extract(workerData.name, workerData.raw)});
  } catch (error) {
    parentPort.postMessage({error: error.message});
  }
}
