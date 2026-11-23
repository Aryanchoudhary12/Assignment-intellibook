import {create} from "zustand";

let clerk;
let clerkTask;
let chatController;
let selection = 0;
let listRequest = 0;

async function request(path, {stream, ...options} = {}) {
  const token = await clerk?.session?.getToken();
  if (!token) throw new Error("Sign in to access your contracts.");
  const response = await fetch("/api/contracts" + path, {
    ...options, headers: {...options.headers, Authorization: "Bearer " + token},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || "The request could not finish.");
  }
  if (stream) return response;
  return response.status === 204 ? null : response.json();
}

function script(url, publishableKey) {
  return new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src = url;
    element.crossOrigin = "anonymous";
    if (publishableKey) element.dataset.clerkPublishableKey = publishableKey;
    element.onload = resolve;
    element.onerror = () => reject(new Error("Clerk could not be loaded. Check your connection and reload."));
    document.head.append(element);
  });
}

async function initClerk() {
  const response = await fetch("/config");
  const {publishableKey, clerkDomain, detail} = await response.json();
  if (!response.ok) throw new Error(detail || "The app configuration could not be loaded.");
  const root = "https://" + clerkDomain + "/npm/@clerk/";
  await Promise.all([
    script(root + "ui@1/dist/ui.browser.js"),
    script(root + "clerk-js@6/dist/clerk.browser.js", publishableKey),
  ]);
  clerk = window.Clerk;
  await clerk.load({ui: {ClerkUI: window.__internal_ClerkUICtor}});
  return clerk;
}

async function readEvents(response, receive) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) return;
      pending += value;
      let end = pending.indexOf("\n\n");
      while (end !== -1) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (event && data) receive(event, JSON.parse(data));
        end = pending.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export const useWorkspace = create((set, get) => ({
  user: null, ready: false, authError: "", docs: [], selected: null, contract: null,
  loading: false, reviewError: "", uploadError: "", uploading: false,
  turns: [], pending: null, question: "", chatError: "",

  async connect() {
    if (!clerkTask) clerkTask = initClerk();
    try {
      const client = await clerkTask;
      set({ready: true});
      get().updateUser(client.user);
      return client.addListener(({user}) => get().updateUser(user));
    } catch (error) {
      set({authError: error.message});
      return undefined;
    }
  },

  signIn() { clerk.openSignIn({forceRedirectUrl: location.origin + "/"}); },
  signUp() { clerk.openSignUp({forceRedirectUrl: location.origin + "/"}); },
  async signOut() {
    try {
      await clerk.signOut({redirectUrl: "/"});
    } catch (error) {
      set({reviewError: error.message});
    }
  },

  updateUser(user) {
    if ((user?.id || null) === (get().user?.id || null)) return;
    selection++;
    listRequest++;
    chatController?.abort();
    chatController = null;
    set({
      user: user || null, docs: [], selected: null, contract: null, loading: false, turns: [], pending: null,
      question: "", chatError: "", reviewError: "", uploadError: "", uploading: false,
    });
    if (user) get().refresh().catch((error) => {
      if (get().user?.id === user.id) set({reviewError: error.message});
    });
  },

  async refresh(preferred) {
    const owner = get().user?.id;
    if (!owner) return;
    const requestId = ++listRequest;
    const docs = await request("");
    if (get().user?.id !== owner || requestId !== listRequest) return;
    const {selected, contract, loading} = get();
    const stored = sessionStorage.getItem("clausebook-" + owner);
    const exists = (id) => id && docs.some((doc) => doc.id === id);
    const next = [preferred, selected, stored, docs[0]?.id].find(exists) ?? null;
    const status = docs.find((doc) => doc.id === next)?.status;
    set({docs, uploadError: ""});
    if (next !== selected || (!loading && next && status !== contract?.status)) await get().choose(next);
  },

  async choose(id) {
    if (id === get().selected && get().contract?.status === "reviewed") return;
    const version = ++selection;
    chatController?.abort();
    chatController = null;
    set({selected: id, contract: null, loading: Boolean(id), reviewError: "", turns: [], pending: null, question: "", chatError: ""});
    if (!id) return;
    sessionStorage.setItem("clausebook-" + get().user.id, id);
    try {
      const [contract, turns] = await Promise.all([request("/" + id), request("/" + id + "/chat")]);
      if (version === selection) set({contract, turns});
    } catch (error) {
      if (version === selection) set({reviewError: error.message});
    } finally {
      if (version === selection) set({loading: false});
    }
  },

  async upload(file) {
    const owner = get().user?.id;
    if (!owner || get().uploading) return;
    if (file.size > 20 * 1024 * 1024) {
      set({uploadError: "The file exceeds the 20 MB upload limit."});
      return;
    }
    set({uploading: true, uploadError: ""});
    try {
      const doc = await request("?filename=" + encodeURIComponent(file.name), {
        method: "POST", body: file, headers: {"Content-Type": "application/octet-stream"},
      });
      if (get().user?.id === owner) await get().refresh(doc.id);
    } catch (error) {
      if (get().user?.id === owner) set({uploadError: error.message});
    } finally {
      if (get().user?.id === owner) set({uploading: false});
    }
  },

  async retry(id) {
    set({reviewError: ""});
    try {
      await request("/" + id + "/review", {method: "POST"});
      await get().refresh();
    } catch (error) {
      if (get().selected === id) set({reviewError: error.message});
    }
  },

  async remove(id) {
    try {
      await request("/" + id, {method: "DELETE"});
      await get().refresh();
    } catch (error) {
      if (get().selected === id) set({reviewError: error.message});
    }
  },

  clause(id, source) { return request("/" + id + "/clauses/" + source.clause_id); },

  setQuestion(question) { set({question}); },
  async ask() {
    const {selected: id, question, pending} = get();
    const text = question.trim();
    if (!text || pending || !id) return;
    const controller = new AbortController();
    chatController = controller;
    const isCurrent = () => chatController === controller;
    set({pending: {question: text, answer: {evidence: [], message: "Looking for a source…"}}, question: "", chatError: ""});
    let finished = false;
    try {
      const response = await request("/" + id + "/chat", {
        method: "POST", stream: true, signal: controller.signal,
        headers: {"Content-Type": "application/json"}, body: JSON.stringify({question: text}),
      });
      await readEvents(response, (event, data) => {
        if (!isCurrent()) return;
        if (event === "quote") {
          const past = get().pending.answer.evidence;
          set({pending: {question: text, answer: {message: "", evidence: [...past, data]}}});
        } else if (event === "done") {
          finished = true;
          set({turns: [...get().turns, {question: text, answer: data}], pending: null});
        } else if (event === "error") {
          throw new Error(data.message);
        }
      });
      if (!finished && isCurrent()) throw new Error("The answer was interrupted. Try again.");
    } catch (error) {
      if (isCurrent()) set({pending: null, question: text, chatError: error.message});
    } finally {
      if (isCurrent()) chatController = null;
    }
  },
}));
