import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  Files,
  HelpCircle,
  LogOut,
  MessageSquareText,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  X,
} from "lucide-react";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const configuredMaxFileSizeMb = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB);
const maxUploadBytes =
  (Number.isFinite(configuredMaxFileSizeMb) && configuredMaxFileSizeMb > 0
    ? configuredMaxFileSizeMb
    : 10) * 1024 * 1024;
const acceptedUploadTypes = {
  ".pdf": ["application/pdf"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".txt": ["text/plain"],
};
const AuthContext = createContext(null);

function uploadValidationMessage(file) {
  if (!file.size) return "The selected file is empty.";
  if (file.size > maxUploadBytes) {
    return `The selected file exceeds the ${Math.round(maxUploadBytes / (1024 * 1024))} MB upload limit.`;
  }
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const supportedTypes = acceptedUploadTypes[extension];
  if (!supportedTypes || !supportedTypes.includes(file.type)) {
    return "Choose a PDF, DOCX, or TXT file with a supported file type.";
  }
  return "";
}

function apiErrorMessage(body, status) {
  const message = typeof body?.error === "string" ? body.error.trim() : "";
  if (message && !/^[{[]/.test(message)) return message.slice(0, 240);
  return `The server could not complete this request (${status}). Please try again.`;
}

async function apiRequest(path, options = {}) {
  const token = sessionStorage.getItem("authToken");
  const headers = { ...options.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
    body:
      options.body && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body,
  });
  if (response.status === 401 && token) {
    sessionStorage.removeItem("authToken");
    window.dispatchEvent(new Event("auth:expired"));
  }
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiErrorMessage(body, response.status));
  return body;
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const token = sessionStorage.getItem("authToken");
    if (!token) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    apiRequest("/auth/me")
      .then((result) => {
        if (active) setUser(result.user);
      })
      .catch(() => {
        sessionStorage.removeItem("authToken");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const onExpired = () => {
      setUser(null);
      setLoading(false);
    };
    window.addEventListener("auth:expired", onExpired);
    return () => {
      active = false;
      window.removeEventListener("auth:expired", onExpired);
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      async authenticate(path, credentials) {
        const result = await apiRequest(path, { method: "POST", body: credentials });
        sessionStorage.setItem("authToken", result.token);
        setUser(result.user);
      },
      async logout() {
        try {
          await apiRequest("/auth/logout", { method: "POST" });
        } finally {
          sessionStorage.removeItem("authToken");
          setUser(null);
        }
      },
    }),
    [user, loading],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuth() {
  return useContext(AuthContext);
}

function Button({ children, variant = "primary", ...props }) {
  return (
    <button className={`button button-${variant}`} {...props}>
      {children}
    </button>
  );
}

function Brand({ compact = false }) {
  return (
    <Link className={`brand ${compact ? "brand-compact" : ""}`} to="/">
      <span className="brand-icon"><Sparkles size={17} /></span>
      {!compact && <span>folio<span className="brand-period">.</span></span>}
    </Link>
  );
}

function LandingPage() {
  const { user } = useAuth();
  return (
    <div className="landing">
      <header className="landing-header">
        <Brand />
        <nav className="landing-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
        </nav>
        <div className="landing-actions">
          {user ? (
            <Link className="button button-primary button-small" to="/app">Open workspace <ArrowRight size={15} /></Link>
          ) : (
            <>
              <Link className="text-link" to="/login">Log in</Link>
              <Link className="button button-primary button-small" to="/register">Get started <ArrowRight size={15} /></Link>
            </>
          )}
        </div>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-kicker"><span className="kicker-line" /> A clearer way to find answers</div>
            <h1>Your documents.<br /><span>Your answers.</span></h1>
            <p className="hero-description">
              Bring your files together and ask the questions that matter. Get grounded answers with sources you can actually check.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" to={user ? "/app" : "/register"}>
                Start your workspace <ArrowRight size={17} />
              </Link>
              <a className="quiet-link" href="#how-it-works">See how it works <ArrowDown size={15} /></a>
            </div>
            <div className="hero-note"><ShieldCheck size={16} /> Private by design. Your files stay yours.</div>
          </div>
          <div className="hero-art" aria-label="Illustration of a cited document answer">
            <div className="orb orb-one" />
            <div className="orb orb-two" />
            <div className="preview-window">
              <div className="preview-top"><span className="preview-dots">•••</span><span>YOUR WORKSPACE</span><span className="preview-status"><i /> ready</span></div>
              <div className="preview-content">
                <div className="preview-sidebar"><span className="mini-logo"><Sparkles size={13} /></span><span className="mini-line active" /><span className="mini-line" /><span className="mini-line short" /></div>
                <div className="preview-main">
                  <div className="preview-label">DOCUMENT Q&A</div>
                  <p className="preview-question">What are the key milestones?</p>
                  <div className="preview-answer"><span className="answer-icon"><Sparkles size={13} /></span><span>Your project plan has three major phases, beginning with research and discovery.</span></div>
                  <div className="source-chip"><FileText size={12} /> Project plan.pdf <span>·</span> Source 1</div>
                  <div className="preview-input">Ask anything about your files <span><ArrowRight size={13} /></span></div>
                </div>
              </div>
            </div>
            <div className="float-card"><span className="float-icon"><Check size={15} /></span><span><b>Grounded answers</b><small>Every source, one click away</small></span></div>
          </div>
        </section>
        <section className="trust-row"><span>ONE SPACE FOR WHAT YOU KNOW</span><span className="trust-divider" /><span>PDF</span><span>DOCX</span><span>TXT</span><span className="trust-tail">and more to come</span></section>
        <section className="feature-section" id="features">
          <div className="section-heading"><span className="section-kicker">MADE FOR YOUR MATERIAL</span><h2>Less searching.<br />More understanding.</h2><p>Turn scattered files into a useful, searchable knowledge space.</p></div>
          <div className="feature-grid">
            <article className="feature-card"><span className="feature-icon green"><Files size={19} /></span><span className="feature-index">01</span><h3>Your files, together</h3><p>Keep important PDFs, Word documents, and text files in one private workspace.</p></article>
            <article className="feature-card"><span className="feature-icon blue"><MessageSquareText size={19} /></span><span className="feature-index">02</span><h3>Ask in your own words</h3><p>Find relevant passages by meaning, not just by matching keywords.</p></article>
            <article className="feature-card"><span className="feature-icon peach"><BookOpen size={19} /></span><span className="feature-index">03</span><h3>Answers you can trace</h3><p>See source excerpts alongside answers, so you can verify what your files say.</p></article>
          </div>
        </section>
        <section className="how-section" id="how-it-works">
          <div className="how-copy"><span className="section-kicker">A SIMPLE WORKFLOW</span><h2>From file to<br />finding in moments.</h2><p>Folio organizes your documents into searchable context, so you can spend less time digging and more time moving forward.</p><Link className="quiet-link" to={user ? "/app" : "/register"}>Make it yours <ArrowRight size={15} /></Link></div>
          <div className="steps"><div className="step"><span>01</span><div><h3>Add your documents</h3><p>Upload a PDF, DOCX, or TXT file to your workspace.</p></div></div><div className="step"><span>02</span><div><h3>Ask a real question</h3><p>Use natural language to explore what your files contain.</p></div></div><div className="step"><span>03</span><div><h3>Check the sources</h3><p>Review the passages behind each response.</p></div></div></div>
        </section>
      </main>
      <footer className="landing-footer"><Brand /><span>Make more of what you already know.</span><span>© {new Date().getFullYear()} Folio</span></footer>
    </div>
  );
}

function AuthPage({ mode }) {
  const { authenticate, user } = useAuth();
  const navigate = useNavigate();
  const registering = mode === "register";
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/app" replace />;
  async function submit(event) {
    event.preventDefault();
    setError("");
    if (registering && !form.name.trim()) return setError("Enter your name to continue.");
    if (form.password.length < (registering ? 8 : 1)) return setError(registering ? "Use a password with at least 8 characters." : "Enter your password.");
    setBusy(true);
    try {
      await authenticate(`/auth/${mode}`, form);
      navigate("/app", { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-top"><Brand /><Link className="quiet-link" to="/">Back to home <ArrowRight size={15} /></Link></div>
      <section className="auth-card">
        <span className="section-kicker">{registering ? "A SPACE OF YOUR OWN" : "WELCOME BACK"}</span>
        <h1>{registering ? "Create your account" : "Sign in to Folio"}</h1>
        <p>{registering ? "Set up your private document workspace." : "Pick up where your documents left off."}</p>
        <form onSubmit={submit}>
          {registering && <label>Your name<input autoComplete="name" maxLength="100" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>}
          <label>Email address<input type="email" autoComplete="email" maxLength="254" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
          <label>Password<input type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 8 : 1} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <Button type="submit" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Log in"} <ArrowRight size={16} /></Button>
        </form>
        <div className="auth-switch">{registering ? "Already have an account?" : "New to Folio?"} <Link to={registering ? "/login" : "/register"}>{registering ? "Log in" : "Create an account"}</Link></div>
        <div className="auth-secure"><ShieldCheck size={15} /> Your files and account are private.</div>
      </section>
      <footer className="auth-footer">Thoughtful answers, grounded in your own documents.</footer>
    </main>
  );
}

function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingPage />;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function LoadingPage() {
  return <div className="loading-screen"><span className="loading-mark"><Sparkles size={18} /></span><span>Preparing your workspace…</span></div>;
}

const navItems = [
  { to: "/app", label: "Overview", icon: UserRound, end: true },
  { to: "/app/documents", label: "Documents", icon: Files },
  { to: "/app/ask", label: "Ask your files", icon: MessageSquareText },
  { to: "/app/usage", label: "Account & usage", icon: UserRound },
];

function WorkspaceLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  async function signOut() {
    await logout();
    navigate("/");
  }
  return (
    <div className="workspace">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand"><Brand /></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Workspace navigation">
          {navItems.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)}><Icon size={17} /><span>{label}</span></NavLink>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note"><ShieldCheck size={15} /><span>Your library is private</span></div>
          <div className="profile-card"><span className="avatar">{(user?.name || "U").slice(0, 1).toUpperCase()}</span><span className="profile-details"><b>{user?.name}</b><small>{user?.plan || "free"} plan</small></span><button aria-label="Log out" title="Log out" className="icon-button" onClick={signOut}><LogOut size={16} /></button></div>
        </div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
      <main className="workspace-main">
        <header className="workspace-topbar"><button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation"><span /><span /></button><div className="breadcrumb">My workspace <span>/</span> <b>{navItems.find((item) => item.to === location.pathname)?.label || (location.pathname.startsWith("/app/ask") ? "Ask your files" : location.pathname.startsWith("/app/documents") ? "Documents" : "Overview")}</b></div><span className="topbar-status"><i /> Private workspace</span></header>
        <div className="workspace-content"><Outlet /></div>
      </main>
    </div>
  );
}

function useWorkspaceData() {
  const [data, setData] = useState({ usage: null, documents: [], questions: [], loading: true, error: "" });
  const reload = async () => {
    try {
      const [usage, docs, history] = await Promise.all([
        apiRequest("/usage"),
        apiRequest("/documents?limit=5"),
        apiRequest("/questions/history?limit=5"),
      ]);
      setData({ usage, documents: docs.documents, questions: history.questions, loading: false, error: "" });
    } catch (error) {
      setData((current) => ({ ...current, loading: false, error: error.message }));
    }
  };
  useEffect(() => { reload(); }, []);
  return { ...data, reload };
}

function PageHeading({ eyebrow, title, description, action }) {
  return <div className="page-heading"><div><span className="section-kicker">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}

function UsageBar({ label, used = 0, limit = 0, icon: Icon }) {
  const percent = limit ? Math.min(100, (used / limit) * 100) : 0;
  return <div className="usage-card"><div className="usage-label"><span className="usage-icon"><Icon size={16} /></span><span>{label}</span></div><div className="usage-number">{used}<span> / {limit}</span></div><div className="usage-track"><span style={{ width: `${percent}%` }} /></div><div className="usage-caption">{Math.max(0, limit - used)} remaining</div></div>;
}

function OverviewPage() {
  const { user } = useAuth();
  const { usage, documents, questions, loading, error } = useWorkspaceData();
  if (loading) return <LoadingPage />;
  return (
    <>
      <PageHeading eyebrow="YOUR DOCUMENT SPACE" title={`Good to see you, ${user?.name?.split(" ")[0] || "there"}.`} description="Here’s a little overview of what’s in your workspace." action={<Link className="button button-primary" to="/app/documents"><Plus size={16} /> Add a document</Link>} />
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="usage-grid">
        <UsageBar label="Documents" used={usage?.documents.used} limit={usage?.documents.limit} icon={Files} />
        <UsageBar label="Questions this month" used={usage?.questions.used} limit={usage?.questions.limit} icon={MessageSquareText} />
        <div className="plan-card"><span className="plan-badge">{usage?.plan || "free"} PLAN</span><h3>A good place to start.</h3><p>Your workspace keeps your documents organized and answers grounded in your own files.</p><Link className="quiet-link" to="/app/usage">View usage <ArrowRight size={14} /></Link></div>
      </div>
      <section className="content-section">
        <div className="section-title-row"><div><span className="section-kicker">YOUR LIBRARY</span><h2>Recent documents</h2></div><Link className="quiet-link" to="/app/documents">View all <ArrowRight size={14} /></Link></div>
        {documents.length ? <div className="document-list">{documents.map((doc) => <DocumentRow key={doc.id} document={doc} />)}</div> : <EmptyState icon={Files} title="Your library starts here" description="Add a document and start exploring what’s inside." action={<Link className="button button-secondary" to="/app/documents"><Upload size={15} /> Upload a document</Link>} />}
      </section>
      <section className="content-section">
        <div className="section-title-row"><div><span className="section-kicker">RECENT ACTIVITY</span><h2>Your latest questions</h2></div><Link className="quiet-link" to="/app/ask">Ask a question <ArrowRight size={14} /></Link></div>
        {questions.length ? <div className="activity-list">{questions.slice(0, 3).map((item) => <div className="activity-item" key={item._id}><span className="activity-icon"><MessageSquareText size={16} /></span><span>{item.question}</span><time>{new Date(item.createdAt).toLocaleDateString()}</time></div>)}</div> : <p className="muted-copy">Your answered questions will appear here.</p>}
      </section>
    </>
  );
}

function DocumentRow({ document, onDelete, deleting = false }) {
  return <div className="document-row"><span className="file-icon"><FileText size={18} /></span><span className="document-meta"><b>{document.filename}</b><small>{formatBytes(document.fileSize)} <span>·</span> {document.chunkCount} chunks <span>·</span> {new Date(document.createdAt).toLocaleDateString()}</small></span><span className={`status-pill status-${document.status}`}>{document.status}</span>{onDelete && <button className="icon-button delete-button" aria-label={`Delete ${document.filename}`} disabled={deleting} onClick={() => onDelete(document)}><X size={17} /></button>}</div>;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EmptyState({ icon: Icon, title, description, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={22} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function DocumentsPage() {
  const { usage, documents, reload, loading, error } = useWorkspaceData();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [allDocuments, setAllDocuments] = useState([]);
  const uploadLock = useRef(false);

  useEffect(() => {
    apiRequest("/documents?limit=50")
      .then((result) => setAllDocuments(result.documents))
      .catch((err) => setNotice({ type: "error", message: err.message }));
  }, [documents.length]);

  async function uploadFile(file) {
    if (!file) return;
    if (uploadLock.current) return;
    if (busy) return;
    if (!usage) {
      setNotice({ type: "error", message: "Wait for your document quota to load before uploading." });
      return;
    }
    if (usage.documents.remaining <= 0) {
      setNotice({ type: "error", message: "Your document quota is full. Delete a document before uploading another." });
      return;
    }
    const validationMessage = uploadValidationMessage(file);
    if (validationMessage) {
      setNotice({ type: "error", message: validationMessage });
      setInputKey((key) => key + 1);
      return;
    }
    uploadLock.current = true;
    setNotice({ type: "info", message: `Uploading and processing ${file.name}…` });
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      await apiRequest("/documents/upload", { method: "POST", body });
      setNotice({ type: "success", message: `${file.name} is ready to use.` });
      await reload();
      try {
        const result = await apiRequest("/documents?limit=50");
        setAllDocuments(result.documents);
      } catch {
        setNotice({ type: "success", message: `${file.name} was processed, but the library could not refresh. Reload this page to see it.` });
      }
    } catch (err) {
      setNotice({ type: "error", message: err.message });
    } finally {
      uploadLock.current = false;
      setBusy(false);
      setInputKey((key) => key + 1);
    }
  }
  async function deleteDocument(document) {
    if (deleteBusy) return;
    setDeleteBusy(true);
    try {
      await apiRequest(`/documents/${document.id}`, { method: "DELETE" });
      setPendingDelete(null);
      setNotice({ type: "success", message: `${document.filename} was deleted.` });
      await reload();
      const result = await apiRequest("/documents?limit=50");
      setAllDocuments(result.documents);
    } catch (err) {
      setNotice({ type: "error", message: err.message });
    } finally {
      setDeleteBusy(false);
    }
  }

  const visibleDocs = allDocuments.filter((document) => document.filename.toLowerCase().includes(search.toLowerCase()));
  const uploadDisabled = busy || !usage || usage.documents.remaining <= 0;
  const uploadDisabledMessage = busy
    ? "Processing the selected file…"
    : !usage
      ? "Loading your document quota…"
      : "Your document quota is full.";
  return (
    <>
      <PageHeading eyebrow="YOUR LIBRARY" title="Documents" description="Keep your source material close, and ready to explore." action={<label className={`button button-primary upload-button ${uploadDisabled ? "is-disabled" : ""}`} aria-disabled={uploadDisabled}><Upload size={16} /> {busy ? "Processing…" : "Upload a file"}<input key={inputKey} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={uploadDisabled} onChange={(event) => uploadFile(event.target.files?.[0])} /></label>} />
      {notice && <div className={`inline-message inline-message-${notice.type}`} role={notice.type === "error" ? "alert" : "status"} aria-live={notice.type === "info" ? "polite" : undefined}>{notice.message}<button className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X size={15} /></button></div>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div
        className={`upload-zone ${uploadDisabled ? "upload-zone-disabled" : ""}`}
        aria-disabled={uploadDisabled}
        aria-busy={busy}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (uploadDisabled) {
            if (!busy) setNotice({ type: "error", message: uploadDisabledMessage });
            return;
          }
          if (event.dataTransfer.files?.[0]) uploadFile(event.dataTransfer.files[0]);
        }}
      ><span className="drop-icon"><Upload size={19} /></span><span><b>{busy ? "Processing your document…" : "Drop a file to add it to your library"}</b><small>PDF, DOCX, or TXT · Up to {Math.round(maxUploadBytes / (1024 * 1024))} MB{uploadDisabled && !busy ? ` · ${uploadDisabledMessage}` : ""}</small></span><span className="quota-note">{usage?.documents.remaining ?? "—"} uploads left</span></div>
      <section className="content-section document-section">
        <div className="section-title-row"><div><span className="section-kicker">YOUR SOURCES</span><h2>All documents <span className="count-badge">{allDocuments.length}</span></h2></div><label className="search-field"><span className="visually-hidden">Search documents</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files" /><span>⌕</span></label></div>
        {loading ? <LoadingPage /> : visibleDocs.length ? <div className="document-list">{visibleDocs.map((doc) => <DocumentRow key={doc.id} document={doc} onDelete={setPendingDelete} deleting={deleteBusy} />)}</div> : <EmptyState icon={Files} title={search ? "No matching documents" : "No documents yet"} description={search ? "Try another search term." : "Upload a PDF, DOCX, or TXT file to get started."} />}
      </section>
      {pendingDelete && <div className="modal-backdrop" role="presentation" onClick={() => !deleteBusy && setPendingDelete(null)}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={(event) => event.stopPropagation()}><span className="modal-icon"><HelpCircle size={20} /></span><h2 id="delete-title">Delete this document?</h2><p><b>{pendingDelete.filename}</b> and its searchable content will be permanently removed.</p><div className="modal-actions"><Button variant="secondary" disabled={deleteBusy} onClick={() => setPendingDelete(null)}>Keep document</Button><Button variant="danger" disabled={deleteBusy} onClick={() => deleteDocument(pendingDelete)}>{deleteBusy ? "Deleting…" : "Delete document"}</Button></div></section></div>}
    </>
  );
}

function AskPage() {
  const [documents, setDocuments] = useState([]);
  const [history, setHistory] = useState([]);
  const [question, setQuestion] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(null);
  const submitLock = useRef(false);
  useEffect(() => {
    Promise.all([apiRequest("/documents?limit=50"), apiRequest("/questions/history?limit=10"), apiRequest("/usage")])
      .then(([docs, items, usage]) => {
        setDocuments(docs.documents.filter((doc) => doc.status === "ready"));
        setHistory(items.questions);
        setRemaining(usage.questions.remaining);
      })
      .catch((err) => setError(err.message));
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (submitLock.current || busy) return;
    submitLock.current = true;
    setError("");
    setBusy(true);
    try {
      const result = await apiRequest("/questions/ask", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { question, ...(documentId ? { documentId } : {}) },
      });
      setAnswer(result.question);
      setRemaining(result.usage.questionsRemaining);
      setHistory((items) => [result.question, ...items].slice(0, 10));
      setQuestion("");
    } catch (err) {
      setError(err.message);
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading eyebrow="A QUESTION, A SOURCE" title="Ask your files" description="Find the thread between your question and what your documents actually say." />
      {error && <div className="inline-error" role="alert">{error}</div>}
      <div className="qa-layout">
        <section className="qa-main">
          {!answer && !history.length && <div className="qa-empty"><span className="qa-spark"><Sparkles size={22} /></span><h2>What would you like to find?</h2><p>Ask a question about your documents. Answers are grounded in the content you’ve uploaded.</p></div>}
          {answer && <AnswerCard record={answer} />}
          {!answer && history.slice(0, 3).map((item) => <AnswerCard key={item._id} record={item} compact />)}
          {remaining !== null && <div className="quota-inline">{remaining} questions remaining in your 30-day period</div>}
          <form className="ask-form" onSubmit={submit}>
            <label htmlFor="question-input" className="visually-hidden">Your question</label>
            <textarea id="question-input" rows="3" maxLength="2000" placeholder="Ask a question about your documents…" value={question} onChange={(event) => setQuestion(event.target.value)} required disabled={busy || remaining === 0} />
            <div className="ask-form-bottom"><label className="document-select"><FileText size={15} /><select value={documentId} onChange={(event) => setDocumentId(event.target.value)} disabled={!documents.length}><option value="">All ready documents</option>{documents.map((doc) => <option value={doc.id} key={doc.id}>{doc.filename}</option>)}</select></label><span className="char-count">{question.length}/2000</span><Button type="submit" disabled={busy || !question.trim() || !documents.length || remaining === 0}>{busy ? "Finding sources…" : "Ask Folio"} <ArrowRight size={15} /></Button></div>
          </form>
          {!documents.length && <p className="qa-footnote">Add a ready document before asking a question. <Link to="/app/documents">Go to documents <ArrowRight size={13} /></Link></p>}
        </section>
        <aside className="qa-aside"><div className="aside-card"><span className="aside-icon"><BookOpen size={17} /></span><h3>Grounded in your library</h3><p>Answers use matching passages from your documents, with source references to check the details.</p></div><div className="aside-card soft"><span className="aside-kicker">GOOD QUESTIONS START HERE</span><button className="suggestion" onClick={() => setQuestion("What are the main takeaways?")}>“What are the main takeaways?” <ArrowRight size={14} /></button><button className="suggestion" onClick={() => setQuestion("What dates or deadlines are mentioned?")}>“What dates or deadlines are mentioned?” <ArrowRight size={14} /></button></div></aside>
      </div>
    </>
  );
}

function AnswerCard({ record, compact = false }) {
  return <article className={`answer-card ${compact ? "answer-compact" : ""}`}><div className="answer-question"><span className="question-icon"><MessageSquareText size={14} /></span><b>{record.question}</b><time>{new Date(record.createdAt).toLocaleString()}</time></div><div className="answer-content"><span className="answer-mark"><Sparkles size={15} /></span><p>{record.answer}</p></div>{record.sources?.length > 0 && <div className="answer-sources"><span className="source-heading">SOURCES</span>{record.sources.map((source, index) => <div className="source-item" key={`${source.documentId}-${source.chunkIndex}`}><span className="source-number">S{index + 1}</span><span><b>{source.filename}</b><small>Chunk {source.chunkIndex + 1}</small><q>{source.excerpt}</q></span></div>)}</div>}</article>;
}

function UsagePage() {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { apiRequest("/usage").then(setUsage).catch((err) => setError(err.message)); }, []);
  return <><PageHeading eyebrow="YOUR PLAN & ACTIVITY" title="Account & usage" description="A clear view of your current workspace limits and activity." />{error && <div className="inline-error">{error}</div>}{usage ? <><div className="usage-grid"><UsageBar label="Documents" used={usage.documents.used} limit={usage.documents.limit} icon={Files} /><UsageBar label="Questions this period" used={usage.questions.used} limit={usage.questions.limit} icon={MessageSquareText} /><div className="plan-card"><span className="plan-badge">{usage.plan} PLAN</span><h3>Your current plan</h3><p>Usage limits reset on a rolling {usage.questions.periodDays}-day period for questions. Plan upgrades are not available in this MVP.</p></div></div><div className="quota-explainer"><ShieldCheck size={17} /><span><b>Limits are enforced on the server.</b><br />Document deletion restores document capacity. Questions are counted when a valid request is accepted.</span></div></> : !error && <LoadingPage />}</>;
}

function NotFound() {
  return <div className="not-found"><span className="section-kicker">NOTHING HERE</span><h1>That page isn’t in your workspace.</h1><Link className="button button-primary" to="/app">Back to overview <ArrowRight size={15} /></Link></div>;
}

function AppRoutes() {
  const { loading } = useAuth();
  const [apiStatus, setApiStatus] = useState("checking");
  useEffect(() => {
    let active = true;
    let controller;
    const checkHealth = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`${apiBaseUrl}/health`, { signal: controller.signal });
        if (!response.ok) throw new Error("unavailable");
        const health = await response.json();
        if (active) {
          setApiStatus(
            health.dependencies?.mongodb === "connected"
              ? "online"
              : "online · MongoDB offline",
          );
        }
      } catch (error) {
        if (active && error.name !== "AbortError") setApiStatus("unavailable");
      }
    };
    void checkHealth();
    const intervalId = window.setInterval(checkHealth, 10000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      controller?.abort();
    };
  }, []);
  if (loading) return <LoadingPage />;
  return (
    <>
      <div className={`connection-banner ${apiStatus === "online" ? "connection-hidden" : ""}`} role="status">
        <span className={`status-dot ${apiStatus === "unavailable" ? "unavailable" : ""}`} /> {apiStatus === "online" || apiStatus === "checking" ? `API ${apiStatus}` : `API ${apiStatus}`}
      </div>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<WorkspaceLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="documents" element={<DocumentsPage />} />
            <Route path="ask" element={<AskPage />} />
            <Route path="usage" element={<UsagePage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

export default function App() {
  return <BrowserRouter><AuthProvider><AppRoutes /></AuthProvider></BrowserRouter>;
}
