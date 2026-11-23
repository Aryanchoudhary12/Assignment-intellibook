# Clausebook

Clausebook reviews a contract against eight checklist items. Every displayed citation opens the full clause and highlights the exact words used as evidence. Contract chat streams verified clauses from that same contract.

## Run locally with MongoDB Atlas

1. In Atlas, open your cluster and choose **Connect → Drivers**. Add your computer’s public IP to the project access list and use an Atlas database user with read and write access to the app database. Copy the connection string. [Atlas connection instructions](https://www.mongodb.com/docs/atlas/driver-connection/)
2. Open your existing `.env`. Set `DATABASE_URL` to the copied URI, replace the password placeholder, and put the database name before the query string. For example, use `mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/clausebook?retryWrites=true&w=majority`, substituting your own values. URL-encode reserved characters in the database password. [MongoDB URI format](https://www.mongodb.com/docs/manual/reference/connection-string-formats/)
3. Start Clausebook and open [http://localhost:3000](http://localhost:3000/). The app syncs the Prisma schema and indexes on Atlas during startup.

For a fresh setup, copy `.env.example` to `.env` and also fill `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`, and `OPENROUTER_API_KEY`. In Clerk, copy the publishable key and the **PEM Public Key** for the same application, using literal `\n` between PEM lines. Use `APP_ORIGIN=http://localhost:3000` for the standard launcher URL. [Clerk session verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification) · [OpenRouter API keys](https://openrouter.ai/settings/keys)

### Windows x64

Install Docker Desktop in Linux container mode. Put `Clausebook-Start-win-x64.exe` next to your existing `.env` and double-click it. The launcher also recognizes the `.env` from an earlier install at `%LOCALAPPDATA%\Clausebook\.env`. On a fresh install without either file, it creates the template there. When the launcher opens the configuration editor, save your changes and press Enter in its window. The executable includes the app source and starts Docker Desktop if needed. It builds the app on the first run and opens your browser once it is ready.

To start manually from the source folder, run `docker compose up --build`. To rebuild the executable, run `./scripts/build-windows.sh` on Linux with Go 1.24+ and Python 3 installed.

### Linux

Put the Atlas URI in the project’s `.env` and run `./start-clausebook.sh`. The script uses local Docker Compose when available. Select `--native` to run directly with Node.js 24 and pnpm. An existing unauthenticated loopback URI selects the local MongoDB setup. Press Ctrl+C to stop a native launch. For Docker, run `docker compose --project-name clausebook down` in the source directory.

The default models are [Nemotron 3 Ultra](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free) for chat and review and [Nemotron 3.5 Embed 8B](https://openrouter.ai/nvidia/nemotron-3.5-embed-8b:free) for embeddings. Override `CHAT_MODEL` and `EMBEDDING_MODEL` in `.env` if provider availability changes. Re-upload contracts after changing the embedding model so questions and snippets use the same vector space. Provider throttling appears in the workspace with a retry path.

With Node.js 24, pnpm 11.25.0 and a MongoDB replica set or Atlas cluster already running, put its connection string in `DATABASE_URL`. Then run these commands.

```sh
pnpm install --frozen-lockfile
pnpm generate
pnpm db:push
pnpm dev
```

## Stack and architecture

| Layer | Choice | Reason |
| --- | --- | --- |
| UI | Next.js App Router, React, Zustand, CSS | One repository serves the UI and API. Zustand keeps library selection, review state and streaming chat coordinated. |
| API | Next.js Route Handlers, Node.js 24 | The same-origin API reads upload and response streams through Web APIs. A Node worker thread isolates document extraction. |
| Data | MongoDB Atlas with Prisma Client 6.19 | Prisma defines models and indexes. Replica-set transactions keep file parts, reviews, chat and deletions consistent. MongoDB stores embeddings alongside their chunks. |
| Authentication | Clerk JavaScript SDK and JOSE | Clerk supplies the account flows. The server verifies signed session tokens and derives the owner from the verified subject. |
| AI | OpenRouter | One API provides the embedding model and streaming chat model. Model IDs are configurable. |

```mermaid
flowchart LR
    UI["React workspace and Zustand"] --> API["Authenticated Next.js Route Handlers"]
    Clerk["Clerk session"] --> UI
    API --> DB[("MongoDB via Prisma")]
    DB --> Queue["Background review worker"]
    Queue --> Parser["PDF, DOCX, TXT extraction thread"]
    Parser --> Queue
    Queue --> AI["OpenRouter"]
    AI --> Queue
    Queue --> DB
    API --> AI
    AI --> API
    API -->|"Verified quote events"| UI
```

The browser streams the file body to `POST /api/contracts?filename=…`. The API enforces a 20 MiB limit against both the declared length and the actual stream. The database stores uploads in 4 MiB parts to fit MongoDB's 16 MiB BSON document limit. The upload returns `202` with a processing state. A worker claims persisted jobs and the workspace polls until a review finishes. Interrupted jobs return to the queue on restart. [MongoDB document limits](https://www.mongodb.com/docs/manual/core/document/#document-limitations)

## Chunking and retrieval

PDF.js extracts selectable text one page at a time. DOCX extraction reads Word paragraphs in document order through SAX XML parsing. TXT uses UTF-8 lines. The parser starts clauses at numbered sections and recognizable headings. A long clause is indexed in pieces of up to 1,600 characters, split at paragraph, line, or sentence boundaries when available. PDF chunks stay on one page. DOCX and TXT use a section label or paragraph/line range. Every piece points to its complete clause, including a continuation on the next PDF page.

The worker embeds chunks in batches of 24 and embeds the eight checklist queries together. For each item it retrieves the five highest-ranked chunks using cosine similarity and a bounded keyword boost. The two signals help capture both differences in drafting language and strong legal headings.

| Item | Retrieval cues and what the prompt asks |
| --- | --- |
| Parties | Preamble and signatures with “between” and “entered into.” Find the named legal entities and roles. |
| Start date and term | Effective date, commencement, initial term and expiry. Find both start and duration. |
| Payment terms | Fees, invoices, due dates and net terms. Find the amount, timing and conditions. |
| Termination | Termination, notice, breach and cure language. Find who can terminate, when and how. |
| Limitation of liability | Aggregate liability, caps and damages exclusions. Keep exceptions with the cap. |
| Confidentiality | Non-disclosure, confidential information and trade secrets. Find obligations and how long they survive. |
| Governing law | “Governed by,” “construed,” and references to laws or jurisdiction. Find the applicable law. |
| Auto-renewal | Renewal, extension, successive terms and nonrenewal. Find explicit renewal language, including an explicit prohibition. |

Chat searches the selected contract with the current question. It also uses the previous question to resolve a follow-up. The model streams newline-delimited quote records. Each complete record is checked and released as a server-sent event. A completed turn is written atomically before the final event. Recognizable absence produces “Not found in the contract.”

## Evidence and account boundaries

- Each candidate citation carries a chunk ID and a quote. The server checks the ID against the exact evidence set supplied for that item or question. It allows equivalent line-wrap whitespace during matching, then returns the literal substring from extraction. The stored clause supplies the location and the full source text. An unverifiable review quote produces **Unclear** and the proposed summary is discarded.
- The shared API entry point verifies a Clerk RS256 JWT before dispatch. It checks issuer, authorized origin, expiry, validity window and session claims. Browser requests supply the token, and the verified `sub` identifies the owner.
- All user-facing Prisma queries include the owner and, where applicable, the contract ID. The backend only scores vectors fetched through that pair. Foreign accesses return `404`. Writes that coordinate deletion, review completion or saving chat use transactions.
- Contract excerpts and questions are sent to the configured OpenRouter models. Use the included fictional contract for the demo. Hosting sensitive agreements would require an approved provider and appropriate data-retention controls.

## Verification and demo

```sh
pnpm test
pnpm build
# Use a disposable replica-set database. Sync indexes before running the HTTP suite.
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:push
pnpm test
```

The HTTP tests run when `TEST_DATABASE_URL` is exported. They exercise the production Next.js server against MongoDB, including the exact upload limit, quote rejection, rate limiting, saved chat after restart and direct cross-user API attempts. The test server uses locally signed Clerk-shaped JWTs and a deterministic OpenRouter substitute. The deployed application expects real Clerk and OpenRouter configuration.

The silent demo shows the live Clerk forms and walks through the signed-in app with two sample accounts and model fixtures. To reproduce the walkthrough with live providers, sign in as the first of two Clerk users and upload [the sample contract](samples/Harborline-services-agreement.txt). Open a payment citation and check the missing auto-renewal row. Ask “When are invoices due?” and “What is the bank account number?” Sign out, sign in as the second user and check that their library is empty. For the code walkthrough, start at `app/api/contracts/[[...path]]/route.js`, then open `lib/review.mjs`, `lib/store.mjs` and `app/workspace-store.js`.

## Limitations

- Text-based documents are supported. Scans require OCR. Complex PDF reading order or DOCX numbering generated by styles can reduce extraction quality. Parsing is bounded by page, text, chunk and worker resource limits.
- The model interprets clause relevance and writes checklist summaries. Exact quote checks establish source provenance. A reviewer should verify that the selected text supports the summary and that retrieved excerpts cover the whole provision.
- The worker is designed for one continuously running Next.js process. Shared job leases, job priorities, aggregated rate limits and indexed vector search would help with multiple replicas or much longer contracts.
- Prisma 6.19 is pinned for its established MongoDB connector. Before a production rollout, reassess Prisma's MongoDB support lifecycle and move to a maintained release once it meets the transaction requirements. [Prisma MongoDB connector](https://www.prisma.io/docs/orm/v6/overview/databases/mongodb) · [Release status](https://www.prisma.io/docs/orm/release-status)
- Live checks confirmed Clerk configuration and sign-in, plus OpenRouter embeddings, checklist review, a cited chat answer and an unsupported-question response for the sample contract. The Windows executable was cross-compiled and its packaging logic tested on Linux. Windows startup and a connection to your Atlas cluster are still pending.

## AI tools used

OpenAI Codex read the take-home brief, built the application and test fixtures, checked official provider documentation, ran the tests and recorded the walkthrough.
