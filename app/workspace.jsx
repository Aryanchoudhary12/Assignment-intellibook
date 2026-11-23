"use client";

import {useEffect, useRef, useState} from "react";
import {useWorkspace} from "./workspace-store.js";

const calendar = new Intl.DateTimeFormat(undefined, {dateStyle: "medium"});
function metadata(doc) {
  const size = doc.size < 1024 ? doc.size + " B"
    : doc.size < 1024 * 1024 ? (doc.size / 1024).toFixed(1) + " KB"
      : (doc.size / (1024 * 1024)).toFixed(1) + " MB";
  return size + " · " + calendar.format(new Date(doc.uploaded_at));
}

function statusClass(status) { return status.replace(" ", "-"); }
function Status({status}) {
  return <span className={"pill " + statusClass(status)}>{status[0].toUpperCase() + status.slice(1)}</span>;
}

function Notice({children}) {
  return children ? <p className="form-note error" role="alert">{children}</p> : null;
}

function Quote({source, onOpen}) {
  return <button type="button" className="quote-button" onClick={() => onOpen(source)}>
    <span className="quote-text">“{source.quote}”</span>
    <span className="quote-location">{source.location} · View clause</span>
  </button>;
}

function Library({fileInput}) {
  const {docs, selected, choose, upload, uploading, uploadError} = useWorkspace();
  return <aside className="library" aria-label="Your contracts">
    <div className="library-top">
      <h2>Contracts <span className="count">{docs.length}</span></h2>
      <button className="primary full" type="button" disabled={uploading} onClick={() => fileInput.current.click()}>
        {uploading ? "Uploading…" : <><span aria-hidden="true">＋</span> Upload contract</>}
      </button>
      <input ref={fileInput} type="file" aria-label="Upload contract file" accept=".pdf,.docx,.txt" hidden onChange={(event) => {
        const [file] = event.target.files;
        event.target.value = "";
        if (file) upload(file);
      }} />
      <p className="file-hint">PDF, DOCX or TXT · Up to 20 MB</p>
      <Notice>{uploadError}</Notice>
    </div>
    <div className="contract-list">
      {docs.length ? docs.map((doc) =>
        <button type="button" key={doc.id} className="contract-btn" aria-current={doc.id === selected} onClick={() => choose(doc.id)}>
          <span className="file-mark" aria-hidden="true" />
          <span className="contract-meta">
            <span className="filename" title={doc.name}>{doc.name}</span>
            <span className="file-info">{metadata(doc)}</span>
            <Status status={doc.status} />
          </span>
        </button>) : <p className="sidebar-note">No contracts uploaded yet.</p>}
    </div>
  </aside>;
}

function Checklist({contract, onOpen}) {
  const statuses = ["found", "not found", "unclear"];
  return <section className="panel" aria-labelledby="checklist-heading">
    <div className="checklist-head">
      <h2 id="checklist-heading">Review checklist</h2>
      <div className="tallies">{statuses.map((status) =>
        <span key={status} className={"pill " + statusClass(status)}>
          {contract.findings.filter((item) => item.status === status).length} {status}
        </span>)}</div>
    </div>
    {contract.findings.map((finding) => <article key={finding.id} className="finding">
      <div className="finding-header"><h3>{finding.title}</h3><Status status={finding.status} /></div>
      <p className="finding-summary">{finding.summary}</p>
      {finding.evidence.map((source, index) => <Quote key={index} source={source} onOpen={onOpen} />)}
    </article>)}
  </section>;
}

function Review({fileInput, onOpen, onDelete}) {
  const {contract, loading, reviewError, uploading, retry} = useWorkspace();
  return <section className="review" aria-label="Contract review">
    <div className="review-body" aria-live="polite">
      <Notice>{reviewError}</Notice>
      {loading ? <p>Loading review…</p> : !contract ?
        <div className="empty-review">
          <span className="file-mark large" aria-hidden="true" />
          <h1>Review a contract</h1>
          <p>Upload a contract to see the checklist and open the clauses behind each finding.</p>
          <button type="button" className="secondary" disabled={uploading} onClick={() => fileInput.current.click()}>Choose a file</button>
        </div> : <>
          <div className="doc-heading">
            <div><h1>{contract.name}</h1>
              <div className="doc-meta"><span>{metadata(contract)}</span><Status status={contract.status} /></div>
            </div>
            <button type="button" className="secondary delete-button" onClick={() => onDelete(contract)}>Delete</button>
          </div>
          {contract.status === "reviewed" ? <Checklist contract={contract} onOpen={onOpen} /> :
            <div className="empty-review">
              <h2>{contract.status === "processing" ? "Review in progress" : "Review failed"}</h2>
              <p>{contract.status === "processing"
                ? "Clausebook is extracting the text and checking the eight provisions." : contract.error}</p>
              {contract.status === "failed" &&
                <button type="button" className="secondary" onClick={() => retry(contract.id)}>Retry review</button>}
            </div>}
        </>}
    </div>
  </section>;
}

function Chat({onOpen}) {
  const {turns, pending, contract, question, setQuestion, ask, chatError} = useWorkspace();
  const log = useRef(null);
  const enabled = contract?.status === "reviewed";
  useEffect(() => { log.current.scrollTop = log.current.scrollHeight; }, [turns, pending]);
  const items = pending ? [...turns, pending] : turns;
  return <aside className="chat" aria-labelledby="chat-title">
    <div className="chat-header">
      <div className="bubble-mark" aria-hidden="true" />
      <div><h2 id="chat-title">Contract chat</h2><p>Answers cite the contract.</p></div>
    </div>
    <div className="chat-log" role="log" aria-live="polite" ref={log}>
      {items.length ? items.map(({question, answer}, index) =>
        <article key={index} className="chat-turn">
          <p className="chat-question">{question}</p>
          <div className="chat-answer">
            {answer.message && <p>{answer.message}</p>}
            {answer.evidence.map((source, index) => <Quote key={index} source={source} onOpen={onOpen} />)}
          </div>
        </article>) : <p className="chat-empty">{enabled ? "Ask a question about the agreement."
          : "Select a reviewed contract to start a conversation."}</p>}
    </div>
    <form className="chat-form" onSubmit={(event) => {event.preventDefault(); ask();}}>
      <label htmlFor="question">Ask about this contract</label>
      <div className="composer">
        <textarea id="question" rows={2} maxLength={1200} placeholder="E.g. When is payment due?"
          disabled={!enabled || Boolean(pending)} value={question} onChange={(event) => setQuestion(event.target.value)} />
        <button className="primary" type="submit" disabled={!enabled || Boolean(pending) || !question.trim()}>Send</button>
      </div>
      <Notice>{chatError}</Notice>
    </form>
  </aside>;
}

function Highlight({clause, source}) {
  const whole = clause.parts.map(([, text]) => text).join("\n");
  const location = clause.parts.findIndex(([name]) => name === source.location);
  let start = whole.indexOf(source.quote);
  if (location >= 0) {
    const prefix = clause.parts.slice(0, location).map(([, line]) => line + "\n").join("");
    const onOrAfter = whole.indexOf(source.quote, prefix.length);
    if (onOrAfter >= 0) start = onOrAfter;
  }
  return start < 0 ? whole : <>{whole.slice(0, start)}<mark>{source.quote}</mark>{whole.slice(start + source.quote.length)}</>;
}

export default function Workspace() {
  const {ready, user, docs, connect, refresh, signIn, signUp, signOut, authError, selected, clause, remove} = useWorkspace();
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
    connect().then((cleanup) => { if (gone) cleanup?.(); else unsubscribe = cleanup; });
    return () => { gone = true; unsubscribe?.(); };
  }, [connect]);

  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => refresh().catch((error) => useWorkspace.setState({uploadError: error.message})), 1500);
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
    setSource({reference});
    clauseDialog.current.showModal();
    try {
      const detail = await clause(selected, reference);
      if (pendingSource.current === operation) setSource({reference, detail});
    } catch (error) {
      if (pendingSource.current === operation) setSource({reference, error: error.message});
    }
  }

  function confirmDelete(contract) {
    setToDelete(contract);
    deleteDialog.current.returnValue = "cancel";
    deleteDialog.current.showModal();
  }

  return <>
    <header className="topbar">
      <a className="brand" href="/" aria-label="Clausebook home"><span className="brand-icon" aria-hidden="true" />Clausebook</a>
      <span className="top-label">Contract review workspace</span>
      {user && <div className="account">
        <span className="account-name">{user.fullName || user.primaryEmailAddress?.emailAddress}</span>
        <button className="outline-dark" type="button" onClick={signOut}>Sign out</button>
      </div>}
    </header>
    {user ? <main className="workspace">
      <Library fileInput={fileInput} />
      <Review fileInput={fileInput} onOpen={openClause} onDelete={confirmDelete} />
      <Chat onOpen={openClause} />
    </main> : <main className="welcome">
      <div className="welcome-card">
        <span className="file-mark large" aria-hidden="true" />
        <h1>Review contracts with the source in view</h1>
        <p>Check eight common provisions, open the original clauses and ask follow-up questions about the agreement.</p>
        {ready ? <div className="button-row">
          <button type="button" className="primary" onClick={signIn}>Sign in</button>
          <button type="button" className="secondary" onClick={signUp}>Create account</button>
        </div> : authError ? <Notice>{authError}</Notice> : <p className="form-note" role="status">Connecting to Clerk…</p>}
      </div>
    </main>}
    <dialog ref={clauseDialog} className="dialog" aria-labelledby="clause-title" onClose={() => {pendingSource.current = null;}}>
      <div className="dialog-bar">
        <div><p className="kicker">{source?.reference.location}</p><h2 id="clause-title">{source?.detail?.title || "Source clause"}</h2></div>
        <form method="dialog"><button className="secondary" type="submit" autoFocus>Close</button></form>
      </div>
      <div className="clause-text">{source?.detail
        ? <Highlight clause={source.detail} source={source.reference} />
        : source?.error || "Loading clause…"}</div>
    </dialog>
    <dialog ref={deleteDialog} className="dialog confirm" aria-labelledby="delete-title" onClose={() => {
      if (deleteDialog.current.returnValue === "delete" && toDelete) remove(toDelete.id);
    }}>
      <h2 id="delete-title">Delete contract?</h2>
      <p>{toDelete?.name} and all of its saved findings and chat will be removed.</p>
      <form method="dialog" className="button-row">
        <button className="secondary" type="submit" value="cancel" autoFocus>Cancel</button>
        <button className="danger" type="submit" value="delete">Delete contract</button>
      </form>
    </dialog>
  </>;
}
