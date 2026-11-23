"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./workspace-store.js";
import Button from "./button";
import { IoSend } from "react-icons/io5";

const calendar = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
function metadata(doc) {
  const size =
    doc.size < 1024
      ? doc.size + " B"
      : doc.size < 1024 * 1024
        ? (doc.size / 1024).toFixed(1) + " KB"
        : (doc.size / (1024 * 1024)).toFixed(1) + " MB";
  return size + " · " + calendar.format(new Date(doc.uploaded_at));
}

const statusColors = {
  found: "bg-[#e4f4eb] text-[#21553b]",
  reviewed: "bg-[#e4f4eb] text-[#21553b]",
  "not-found": "bg-[#eaf0f7] text-[#405273]",
  "not found": "bg-[#eaf0f7] text-[#405273]",
  unclear: "bg-[#fff1d6] text-[#745000]",
  processing: "bg-[#fff1d6] text-[#745000]",
  failed: "bg-[#fbe5e5] text-[#8c2528]",
};

function Status({ status }) {
  const color = statusColors[status] || "bg-surface text-muted";
  return (
    <span
      className={`inline-flex w-max items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${color}`}
    >
      {status[0].toUpperCase() + status.slice(1)}
    </span>
  );
}

function Notice({ children }) {
  return children ? (
    <p className="mt-2 text-sm text-[#8a272b] wrap-anywhere" role="alert">
      {children}
    </p>
  ) : null;
}

function FileMark({ large = false }) {
  return (
    <span
      aria-hidden="true"
      className={`relative shrink-0 rounded-lg bg-accent/25 flex items-center justify-center border border-primary/30 ${
        large ? "w-10 h-10 scale-110 origin-left" : "w-8 h-8.5"
      }`}
    >
      <svg
        className={large ? "w-5 h-5 text-primary" : "w-4 h-4 text-primary"}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    </span>
  );
}

function BubbleMark() {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 w-8.5 h-8.5 rounded-lg bg-surface flex items-center justify-center text-primary border border-border"
    >
      <svg
        className="w-4.5 h-4.5 text-primary"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </span>
  );
}

function BrandIcon() {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 w-7.5 h-7.5 rounded-md bg-accent flex items-center justify-center"
    >
      <svg
        className="w-4.5 h-4.5 text-foreground"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
        <path d="M6 6h10" />
        <path d="M6 10h10" />
      </svg>
    </span>
  );
}

function Quote({ source, onOpen }) {
  return (
    <button
      type="button"
      className="mt-2 block w-full text-left bg-surface text-foreground border border-border border-l-[3px] border-l-primary rounded-md px-2.5 py-2 cursor-pointer transition-colors duration-150 hover:bg-accent/20"
      onClick={() => onOpen(source)}
    >
      <span className="block whitespace-pre-wrap text-[0.85rem] font-normal wrap-anywhere">
        “{source.quote}”
      </span>
      <span className="mt-1 block text-xs font-semibold text-primary">
        {source.location} · View clause
      </span>
    </button>
  );
}

function Library({ fileInput }) {
  const { docs, selected, choose, upload, uploading, uploadError } =
    useWorkspace();
  return (
    <aside
      className="bg-white border-r border-border md:row-span-2 lg:row-span-1 max-md:border-r-0 max-md:border-b"
      aria-label="Your contracts"
    >
      <div className="px-4.5 pt-5.5 pb-3.5 max-md:px-4 max-md:pt-3.5 max-md:pb-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
          Contracts{" "}
          <span className="rounded-md px-1.5 py-0.5 bg-surface text-xs text-muted font-normal">
            {docs.length}
          </span>
        </h2>
        <Button
          variant="default"
          className="w-full"
          type="button"
          disabled={uploading}
          loading={uploading}
          onClick={() => fileInput.current.click()}
        >
          <span aria-hidden="true" className="mr-1">
            ＋
          </span>{" "}
          Upload contract
        </Button>
        <input
          ref={fileInput}
          type="file"
          aria-label="Upload contract file"
          accept=".pdf,.docx,.txt"
          hidden
          onChange={(event) => {
            const [file] = event.target.files;
            event.target.value = "";
            if (file) upload(file);
          }}
        />
        <p className="mt-2.5 text-xs text-muted">
          PDF, DOCX or TXT · Up to 20 MB
        </p>
        <Notice>{uploadError}</Notice>
      </div>
      <div className="grid gap-1.5 px-3 pb-4 max-md:max-h-48 max-md:overflow-y-auto">
        {docs.length ? (
          docs.map((doc) => (
            <button
              type="button"
              key={doc.id}
              aria-current={doc.id === selected}
              onClick={() => choose(doc.id)}
              className={`w-full text-left flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-colors border ${
                doc.id === selected
                  ? "bg-accent/25 border-primary"
                  : "bg-white border-transparent hover:bg-surface"
              }`}
            >
              <FileMark />
              <span className="min-w-0 grid gap-1">
                <span
                  className="overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-foreground"
                  title={doc.name}
                >
                  {doc.name}
                </span>
                <span className="text-xs text-muted font-normal">
                  {metadata(doc)}
                </span>
                <Status status={doc.status} />
              </span>
            </button>
          ))
        ) : (
          <p className="m-1.5 text-sm text-muted">No contracts uploaded yet.</p>
        )}
      </div>
    </aside>
  );
}

function Checklist({ contract, onOpen }) {
  const statuses = ["found", "not found", "unclear"];
  return (
    <section
      className="bg-white border border-border rounded-xl shadow-[0_10px_34px_rgba(30,42,34,0.08)]"
      aria-labelledby="checklist-heading"
    >
      <div className="flex justify-between items-center gap-2 flex-wrap p-4">
        <h2
          id="checklist-heading"
          className="text-base font-semibold text-foreground"
        >
          Review checklist
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {statuses.map((status) => (
            <span
              key={status}
              className={`inline-flex w-max items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                statusColors[status] || "bg-surface text-muted"
              }`}
            >
              {
                contract.findings.filter((item) => item.status === status)
                  .length
              }{" "}
              {status}
            </span>
          ))}
        </div>
      </div>
      {contract.findings.map((finding) => (
        <article
          key={finding.id}
          className="border-t border-border px-4 py-3.5"
        >
          <div className="flex items-baseline justify-between gap-2.5">
            <h3 className="text-sm font-semibold text-foreground">
              {finding.title}
            </h3>
            <Status status={finding.status} />
          </div>
          <p className="mt-1 text-sm text-[#374760] wrap-anywhere">
            {finding.summary}
          </p>
          {finding.evidence.map((source, index) => (
            <Quote key={index} source={source} onOpen={onOpen} />
          ))}
        </article>
      ))}
    </section>
  );
}

function Review({ fileInput, onOpen, onDelete }) {
  const { contract, loading, reviewError, uploading, retry } = useWorkspace();
  return (
    <section
      className="min-w-0 flex-1 overflow-y-auto"
      aria-label="Contract review"
    >
      <div
        className="max-w-[65rem] mx-auto p-4 sm:p-6 lg:p-9"
        aria-live="polite"
      >
        <Notice>{reviewError}</Notice>
        {loading ? (
          <p className="text-sm text-muted">Loading review…</p>
        ) : !contract ? (
          <div className="bg-white border border-border rounded-xl shadow-[0_10px_34px_rgba(30,42,34,0.08)] p-6 sm:p-8 lg:p-10">
            <FileMark large />
            <h1 className="mt-4 mb-2 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Review a contract
            </h1>
            <p className="text-muted mb-4 text-sm sm:text-base">
              Upload a contract to see the checklist and open the clauses behind
              each finding.
            </p>
            <Button
              variant="secondary"
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current.click()}
            >
              Choose a file
            </Button>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-start gap-3 mb-5 max-sm:flex-wrap">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground my-1 wrap-anywhere">
                  {contract.name}
                </h1>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-sm text-muted">
                  <span>{metadata(contract)}</span>
                  <Status status={contract.status} />
                </div>
              </div>
              <Button
                variant="outline"
                size="small"
                type="button"
                className="text-red-700 hover:text-red-800 shrink-0"
                onClick={() => onDelete(contract)}
              >
                Delete
              </Button>
            </div>
            {contract.status === "reviewed" ? (
              <Checklist contract={contract} onOpen={onOpen} />
            ) : (
              <div className="bg-white border border-border rounded-xl shadow-[0_10px_34px_rgba(30,42,34,0.08)] p-6 sm:p-8 lg:p-10">
                <h2 className="text-xl font-bold text-foreground mt-2">
                  {contract.status === "processing"
                    ? "Review in progress"
                    : "Review failed"}
                </h2>
                <p className="text-muted mt-2 mb-4 text-sm sm:text-base">
                  {contract.status === "processing"
                    ? "Clausebook is extracting the text and checking the eight provisions."
                    : contract.error}
                </p>
                {contract.status === "failed" && (
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    onClick={() => retry(contract.id)}
                  >
                    Retry review
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Chat({ onOpen }) {
  const { turns, pending, contract, question, setQuestion, ask, chatError } =
    useWorkspace();
  const log = useRef(null);
  const enabled = contract?.status === "reviewed";
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns, pending]);
  const items = pending ? [...turns, pending] : turns;

  return (
    <aside
      className="sticky top-[4.15rem] h-[calc(100dvh-4.15rem)] min-h-[25rem] grid grid-rows-[auto_minmax(0,1fr)_auto] bg-white border-l border-border max-md:static max-md:h-[31rem] max-md:border-l-0 max-md:border-t max-sm:h-[29rem]"
      aria-labelledby="chat-title"
    >
      <div className="p-3.5 sm:p-4 flex items-center gap-2.5 border-b border-border">
        <BubbleMark />
        <div>
          <h2 id="chat-title" className="text-sm font-bold text-foreground">
            Contract chat
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Answers cite the contract.
          </p>
        </div>
      </div>
      <div
        className="p-3.5 sm:p-4 overflow-y-auto"
        role="log"
        aria-live="polite"
        ref={log}
      >
        {items.length ? (
          items.map(({ question, answer }, index) => (
            <article key={index} className="grid gap-1.5 mb-3.5">
              <p className="justify-self-end bg-accent/25 text-foreground rounded-2xl rounded-br-sm px-3 py-2 max-w-[93%] text-sm wrap-anywhere whitespace-pre-wrap">
                {question}
              </p>
              <div className="bg-surface p-2.5 rounded-2xl rounded-tl-sm text-sm text-foreground">
                {answer.message && <p>{answer.message}</p>}
                {answer.evidence.map((source, idx) => (
                  <Quote key={idx} source={source} onOpen={onOpen} />
                ))}
              </div>
            </article>
          ))
        ) : (
          <p className="text-sm text-muted bg-surface rounded-lg p-3">
            {enabled
              ? "Ask a question about the agreement."
              : "Select a reviewed contract to start a conversation."}
          </p>
        )}
      </div>
      <form
        className="border-t border-border p-3 sm:p-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <label
          htmlFor="question"
          className="block text-xs font-semibold text-foreground mb-1.5"
        >
          Ask about this contract
        </label>
        <div className="flex gap-2 items-end">
          <input
            id="question"
            rows={2}
            maxLength={1200}
            placeholder="E.g. When is payment due?"
            disabled={!enabled || Boolean(pending)}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="w-full min-w-0 resize-y border border-border rounded-lg p-2 text-sm text-foreground bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          />
          <Button
            variant="default"
            size="medium"
            type="submit"
            loading={Boolean(pending)}
            disabled={!enabled || Boolean(pending) || !question.trim()}
            className="rounded-md"
          >
            <IoSend />
          </Button>
        </div>
        <Notice>{chatError}</Notice>
      </form>
    </aside>
  );
}

function Highlight({ clause, source }) {
  const whole = clause.parts.map(([, text]) => text).join("\n");
  const location = clause.parts.findIndex(([name]) => name === source.location);
  let start = whole.indexOf(source.quote);
  if (location >= 0) {
    const prefix = clause.parts
      .slice(0, location)
      .map(([, line]) => line + "\n")
      .join("");
    const onOrAfter = whole.indexOf(source.quote, prefix.length);
    if (onOrAfter >= 0) start = onOrAfter;
  }
  return start < 0 ? (
    whole
  ) : (
    <>
      {whole.slice(0, start)}
      <mark className="bg-[#ffedb8] text-inherit rounded-xs px-0.5">
        {source.quote}
      </mark>
      {whole.slice(start + source.quote.length)}
    </>
  );
}

export default function Workspace() {
  const {
    ready,
    user,
    docs,
    connect,
    refresh,
    signIn,
    signUp,
    signOut,
    authError,
    selected,
    clause,
    remove,
  } = useWorkspace();
  const fileInput = useRef(null);
  const clauseDialog = useRef(null);
  const deleteDialog = useRef(null);
  const pendingSource = useRef(null);
  const [source, setSource] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const processing = docs.some((doc) => doc.status === "processing");

  useEffect(() => {
    let gone = false;
    let unsubscribe;
    connect().then((cleanup) => {
      if (gone) cleanup?.();
      else unsubscribe = cleanup;
    });
    return () => {
      gone = true;
      unsubscribe?.();
    };
  }, [connect]);

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => {
      refresh().catch((error) =>
        useWorkspace.setState({ uploadError: error.message }),
      );
    }, 1500);
    return () => clearInterval(timer);
  }, [processing, refresh]);

  useEffect(() => {
    pendingSource.current = null;
    if (clauseDialog.current?.open) clauseDialog.current.close();
    if (deleteDialog.current?.open) {
      deleteDialog.current.returnValue = "cancel";
      deleteDialog.current.close();
    }
    setSource(null);
    setToDelete(null);
  }, [user?.id]);

  async function openClause(reference) {
    const operation = Symbol();
    pendingSource.current = operation;
    setSource({ reference });
    clauseDialog.current.showModal();
    try {
      const detail = await clause(selected, reference);
      if (pendingSource.current === operation) setSource({ reference, detail });
    } catch (error) {
      if (pendingSource.current === operation)
        setSource({ reference, error: error.message });
    }
  }

  function confirmDelete(contract) {
    setToDelete(contract);
    deleteDialog.current.returnValue = "cancel";
    deleteDialog.current.showModal();
  }

  return (
    <>
      <header className="min-h-[4.15rem] sticky top-0 z-30  flex items-center gap-4 px-4 sm:px-6 border-b border-b-border backdrop-blur-2xl">
        <a
          className="inline-flex items-center gap-2.5 font-bold text-primary text-xl tracking-tight no-underline"
          href="/"
          aria-label="Clausebook home"
        >
          <BrandIcon />
          Clausebook
        </a>
        <span className="text-primary-hover border-l border-[#41516a] pl-4 text-sm hidden sm:inline">
          Contract review workspace
        </span>
        {user && (
          <div className="ml-auto flex items-center gap-3 min-w-0">
            <span className="text-sm text-primary-hover whitespace-nowrap overflow-hidden text-ellipsis hidden sm:inline">
              {user.fullName || user.primaryEmailAddress?.emailAddress}
            </span>
            <Button
              variant="outline"
              size="small"
              type="button"
              onClick={signOut}
            >
              Sign out
            </Button>
          </div>
        )}
      </header>
      {user ? (
        <main className="grid grid-cols-[minmax(13rem,16.5rem)_minmax(0,1fr)_minmax(17rem,22rem)] min-h-[calc(100dvh-4.15rem)] max-lg:grid-cols-[13rem_minmax(0,1fr)_17rem] max-md:grid-cols-[12.5rem_minmax(0,1fr)] max-sm:block">
          <Library fileInput={fileInput} />
          <Review
            fileInput={fileInput}
            onOpen={openClause}
            onDelete={confirmDelete}
          />
          <Chat onOpen={openClause} />
        </main>
      ) : (
        <main className="min-h-[calc(100dvh-4.15rem)] grid place-items-center p-5">
          <div className="bg-white border border-border shadow-[0_10px_34px_rgba(30,42,34,0.08)] rounded-2xl w-full max-w-[36rem] p-6 sm:p-10 lg:p-12">
            <FileMark large />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground my-3">
              Review contracts with the source in view
            </h1>
            <p className="text-muted mb-4 text-sm sm:text-base">
              Check eight common provisions, open the original clauses and ask
              follow-up questions about the agreement.
            </p>
            {ready ? (
              <div className="flex flex-wrap gap-2.5">
                <Button variant="default" type="button" onClick={signIn}>
                  Sign in
                </Button>
                <Button variant="secondary" type="button" onClick={signUp}>
                  Create account
                </Button>
              </div>
            ) : authError ? (
              <Notice>{authError}</Notice>
            ) : (
              <p className="mt-2 text-sm text-muted" role="status">
                Connecting to Clerk…
              </p>
            )}
          </div>
        </main>
      )}
      <dialog
        ref={clauseDialog}
        className="w-[min(42rem,calc(100%-1.5rem))] max-h-[85dvh] p-5 border border-border text-foreground rounded-xl shadow-[0_18px_70px_rgba(16,23,37,0.3)] bg-white backdrop:bg-[#142239]/60"
        aria-labelledby="clause-title"
        onClose={() => {
          pendingSource.current = null;
        }}
      >
        <div className="flex justify-between items-start gap-4 border-b border-border pb-3">
          <div>
            <p className="text-primary font-bold text-xs uppercase tracking-wider">
              {source?.reference.location}
            </p>
            <h2
              id="clause-title"
              className="text-xl font-bold text-foreground mt-1 wrap-anywhere"
            >
              {source?.detail?.title || "Source clause"}
            </h2>
          </div>
          <form method="dialog">
            <Button variant="secondary" size="small" type="submit" autoFocus>
              Close
            </Button>
          </form>
        </div>
        <div className="text-[#283951] whitespace-pre-wrap mt-3.5 wrap-anywhere text-sm leading-relaxed">
          {source?.detail ? (
            <Highlight clause={source.detail} source={source.reference} />
          ) : (
            source?.error || "Loading clause…"
          )}
        </div>
      </dialog>
      <dialog
        ref={deleteDialog}
        className="w-[min(29rem,calc(100%-1.5rem))] p-5 border border-border text-foreground rounded-xl shadow-[0_18px_70px_rgba(16,23,37,0.3)] bg-white backdrop:bg-[#142239]/60"
        aria-labelledby="delete-title"
        onClose={() => {
          if (deleteDialog.current?.returnValue === "delete" && toDelete)
            remove(toDelete.id);
        }}
      >
        <h2 id="delete-title" className="text-lg font-bold text-foreground">
          Delete contract?
        </h2>
        <p className="text-sm text-muted my-3 wrap-anywhere">
          {toDelete?.name} and all of its saved findings and chat will be
          removed.
        </p>
        <form method="dialog" className="flex flex-wrap justify-end gap-2 mt-4">
          <Button
            variant="secondary"
            size="small"
            type="submit"
            value="cancel"
            autoFocus
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="small"
            className="!bg-[#a72829] hover:!bg-[#862021] text-white"
            type="submit"
            value="delete"
          >
            Delete contract
          </Button>
        </form>
      </dialog>
    </>
  );
}
