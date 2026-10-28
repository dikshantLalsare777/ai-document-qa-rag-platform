# Folio — AI Document Q&A & RAG Platform

Folio is a locally runnable document workspace. Authenticated users can upload PDF, DOCX, and TXT files, ask questions grounded in their own uploaded material, inspect retrieved excerpts, and manage their usage. The frontend and REST API can be deployed separately.

This is an MVP, not a production-security certification. Real upload and RAG requests require reachable MongoDB and ChromaDB services, and a Google Gemini API key for embeddings and answer generation. The health endpoint stays available when MongoDB is down and reports dependency readiness separately.

## Features

- Landing page, registration, login, and authenticated workspace routes.
- JWT authentication; passwords are bcrypt-hashed and hashes are never returned.
- MongoDB-backed users, documents, and question history.
- Private PDF, DOCX, and TXT upload; generated storage names and per-user authorization.
- Duplicate document bytes are rejected per user; empty, malformed, and unsupported files return client errors.
- Text extraction, overlapping chunks, Gemini embeddings, and ChromaDB vector persistence.
- Gemini answer generation using owner-filtered retrieved document context.
- Owner-filtered retrieval, context-bounded answer generation, source excerpts, and citation identifiers.
- Configurable free/pro application quotas; no billing or paid-plan upgrades are implemented.
- Document deletion, usage overview, health/readiness endpoints, security headers, CORS allow-list, and API rate limits.

## Architecture

- `frontend/`: React, Vite, React Router, Lucide icons, responsive styles.
- `backend/`: Express REST API, Mongoose models, JWT/bcrypt auth, parsing, embedding, Chroma retrieval, and RAG orchestration.
- MongoDB stores account data, document metadata, counters, and answer history.
- ChromaDB stores chunk text, embeddings, and ownership/source metadata.
- Uploaded files are stored outside public frontend assets in an ignored `uploads/` directory.

## Prerequisites

- Node.js 20.19+ (Node 22.12+ recommended) and npm 10+.
- A MongoDB instance, local or hosted.
- A ChromaDB server accessible from the backend.
- Python 3.10+ only if running ChromaDB locally with its Python CLI.
- A Google Gemini API key for document/query embeddings and answer generation.

The test suite uses `mongodb-memory-server`; its first run may download a MongoDB test binary.

## Install and configure

Run commands from the project root.

```powershell
npm install
Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env
```

Edit `backend\.env`:

1. `MONGODB_URI`: for local MongoDB use `mongodb://127.0.0.1:27017/ai-document-qa-rag`. Start MongoDB Community Server before using authenticated routes. For Atlas, create a database user, allow your client IP, and set the supplied connection URI. URL-encode special characters in credentials.
2. `JWT_SECRET`: generate a unique secret of at least 32 characters:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. `CHROMA_URL`: URL of your Chroma server (default `http://localhost:8000`).
4. `GEMINI_API_KEY`: your Google AI Studio API key for embeddings and answer generation. It is read only by the backend and must never be placed in a `VITE_` variable.
5. Optionally adjust model names, quotas, chunking, and upload limits.

The API starts even when MongoDB is not available, for liveness checks. It retries failed MongoDB connections every five seconds when a URI is configured. Auth, usage, upload, and question requests return a service-unavailable response until MongoDB connects. `GET /api/health` reports liveness and dependency state; `GET /api/ready` returns 503 while MongoDB is disconnected.

`frontend\.env` defaults to `VITE_API_BASE_URL=/api` and proxies `/api` to `API_PROXY_TARGET=http://localhost:5000` in development. For separate production hosting, set `VITE_API_BASE_URL` to the backend API origin plus `/api`, and configure the backend `CLIENT_ORIGIN` to the exact frontend origin(s), comma-separated.

Local `.env` files, generated uploads, build artifacts, and dependencies are ignored by Git. Never commit secrets.

## Start locally

Use two PowerShell terminals in the project root. With this project path containing `&`, use npm's PowerShell script shell:

**Terminal 1 — backend**

```powershell
npm --script-shell=powershell.exe run dev --workspace=backend
```

**Terminal 2 — frontend**

```powershell
npm --script-shell=powershell.exe run dev --workspace=frontend
```

- Frontend: <http://localhost:5173>
- API liveness: <http://localhost:5000/api/health>
- API readiness: <http://localhost:5000/api/ready>

The frontend health indicator distinguishes an available API process from an unavailable MongoDB dependency.

### Start local data services

For a local MongoDB installation with `mongod` on `PATH`, start it in a separate terminal:

```powershell
New-Item -ItemType Directory -Force .\mongodb-data | Out-Null
mongod --dbpath .\mongodb-data --bind_ip 127.0.0.1 --port 27017
```

For local ChromaDB, create and activate a Python environment, install Chroma, then run its persistent HTTP server in a separate terminal:

```powershell
py -3 -m venv .venv-chroma
.\.venv-chroma\Scripts\python.exe -m pip install chromadb
New-Item -ItemType Directory -Force .\chroma-data | Out-Null
.\.venv-chroma\Scripts\chroma.exe run --host 127.0.0.1 --port 8000 --path .\chroma-data
```

The generated database/vector directories are ignored by Git. Set `GEMINI_API_KEY` in `backend\.env` for document embeddings and answer generation.

## Environment variables

See [backend/.env.example](./backend/.env.example) and [frontend/.env.example](./frontend/.env.example).

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | Express listening port | `5000` |
| `TRUST_PROXY_HOPS` | Trusted reverse-proxy hops for client IP handling | `0` |
| `CLIENT_ORIGIN` | Allowed frontend origins (comma-separated) | `http://localhost:5173` |
| `MONGODB_URI` | MongoDB connection string | Local MongoDB URI |
| `JWT_SECRET` | JWT signing secret (minimum 32 chars) | Required for auth |
| `JWT_EXPIRES_IN` | JWT lifetime | `7d` |
| `CHROMA_URL` | ChromaDB endpoint | `http://localhost:8000` |
| `CHROMA_COLLECTION` | Vector collection | `document_chunks` |
| `GEMINI_API_KEY` | Server-side Google Gemini API key | Required for upload and questions |
| `GEMINI_EMBEDDING_MODEL` | Embedding model | `gemini-embedding-001` |
| `GEMINI_CHAT_MODEL` | Gemini answer-generation model | `gemini-3.6-flash` |
| `UPLOAD_DIR` | Private directory for uploaded source files | `uploads/` under the backend working directory |
| `MAX_FILE_SIZE_MB` | Maximum uploaded file size | `10` |
| `MAX_EXTRACTED_TEXT_CHARS` | Maximum extracted text per file | `2000000` |
| `MAX_DOCUMENT_CHUNKS` | Per-file processing safety bound | `500` |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | Character-based chunk settings | `1200` / `150` |
| `TOP_K` | Maximum retrieved chunks | `5` |
| `MAX_VECTOR_DISTANCE` | Maximum accepted Chroma distance | `1.2` |
| `FREE_DOCUMENT_LIMIT` / `PRO_DOCUMENT_LIMIT` | Document caps | `5` / `100` |
| `FREE_QUESTION_LIMIT` / `PRO_QUESTION_LIMIT` | Rolling 30-day question caps | `20` / `1000` |

The default `gemini-3.6-flash` model is listed in the [official Gemini model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash), and its generation endpoint was verified with the configured API key. Google lists standard-tier free usage for this model, subject to API quotas and account eligibility; see the [Gemini API pricing page](https://ai.google.dev/gemini-api/docs/pricing). Set `GEMINI_CHAT_MODEL` in `backend\.env` to select another model your key supports.

### ChromaDB and embedding model changes

Run a ChromaDB server with persistent storage enabled and make its URL reachable from the backend. The backend uses Chroma's HTTP API through the supported JS client; configure the server's network access/firewall so only trusted application hosts can reach it. This MVP does not configure Chroma Cloud credentials or server authentication.

`gemini-embedding-001` is configured to return 3072 dimensions for both document and query embeddings. The collection records its embedding provider, model, and dimensions. A Gemini collection created before dimension metadata was added is upgraded only after its model metadata matches and its stored vector dimension is verified. Collections with OpenAI, unknown, or incompatible vectors are rejected rather than silently mixed; create a fresh collection and re-upload those documents to re-embed them with Gemini. There is no automated OpenAI-vector reindex endpoint.

## API

All JSON request bodies use `Content-Type: application/json`.

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/api/health` | No | Process liveness and MongoDB dependency status |
| `GET` | `/api/ready` | No | Readiness; 503 until MongoDB connects |
| `POST` | `/api/auth/register` | No | Register; returns JWT and public profile |
| `POST` | `/api/auth/login` | No | Login; returns JWT and public profile |
| `POST` | `/api/auth/logout` | Bearer JWT | Client logout acknowledgement (JWT is stateless) |
| `GET` | `/api/auth/me` | Bearer JWT | Current profile |
| `GET` | `/api/usage` | Bearer JWT | Actual document/question usage and limits |
| `POST` | `/api/documents/upload` | Bearer JWT | Multipart upload; field name `file` |
| `GET` | `/api/documents?page=1&limit=20&search=` | Bearer JWT | Paginated current user's documents |
| `DELETE` | `/api/documents/:id` | Bearer JWT | Delete owned document and its vector records |
| `POST` | `/api/questions/ask` | Bearer JWT | Ask using `{ "question": "...", "documentId": "optional" }`; optional `Idempotency-Key` |
| `GET` | `/api/questions/history?page=1&limit=20` | Bearer JWT | Paginated current user's saved answers |

Register body:

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "a-strong-password" }
```

For private requests, send `Authorization: Bearer <token>`. The frontend keeps the JWT in `sessionStorage` (cleared on logout/tab close), not local persistent storage. This bearer-token approach avoids CSRF-prone ambient cookies but remains exposed to same-origin script execution; use a strong CSP and prevent XSS in production. Logout clears the client token but cannot revoke a stateless JWT before expiration.

Question clients may send a unique `Idempotency-Key` header and reuse it when retrying the same request. The server stores completed responses against the authenticated user and returns the saved result without reserving quota twice. A key whose request is still processing or failed returns 409; use a new key only for a new intentional question.

Upload a file with multipart form data, field `file`, file types `.pdf`, `.docx`, or `.txt`. Responses do not expose stored paths or password hashes. For unsupported files the API returns 415; oversized files return 413. A PDF without extractable text returns a processing error explaining that OCR is required.

Question answers use only retrieved authorized chunks. Source entries identify the real document and chunk; PDF page citations are not provided because the current parser pipeline does not preserve per-page chunks. If retrieval has no sufficiently close sources, the API responds that the documents do not provide enough information. No fabricated answer is returned in that case.

## Processing and quota behavior

Upload → file/type/size validation → text extraction → bounded overlapping chunks → batched Gemini embeddings → owner-tagged Chroma records → Mongo document status `ready`. Processing is synchronous in the upload request. Failures are returned and cleaned up; this MVP does not have background jobs or retry/reprocess UI. Scanned PDFs require OCR, which is not included.

For a question, the API verifies document ownership, reserves a question against the rolling 30-day counter, embeds the query with the Gemini retrieval-query task type, filters Chroma search by the authenticated owner (and optional document), cross-checks each result against MongoDB-owned ready documents, applies a distance threshold, and sends bounded retrieved excerpts to the configured `GEMINI_CHAT_MODEL`. Chunks are treated as untrusted context. Questions are counted once a valid question request is accepted, including requests that later fail at an external provider.

Document/question limits are backend-enforced application defaults, not paid entitlements. Counters are reserved atomically for uploads and questions. A successfully deleted document restores document capacity. The free/pro plan value is not a payment integration.

## Tests and build

```powershell
npm --script-shell=powershell.exe run test --workspace=backend
npm --script-shell=powershell.exe run build --workspace=frontend
```

The backend automated suite uses a temporary in-memory MongoDB and mocks Gemini SDK calls and Chroma vector-store operations, including upload, retrieval, and RAG orchestration. Passing these tests does not verify connectivity to real Gemini or ChromaDB services. Real end-to-end validation requires separately configured MongoDB, ChromaDB, and Gemini API access.

## Deployment

The frontend and API are separate services. Deployment has not been run or verified. The project is not currently connected to a Git repository, so a GitHub repository containing the project is a prerequisite for connecting Vercel and Render; do not upload `.env` files or local database/upload directories.

### Vercel frontend

1. Import the GitHub repository into Vercel and set the project root to the repository root (the root npm workspace manifest is used).
2. Select Vite, with install command `npm ci`, build command `npm run build --workspace=frontend`, and output directory `frontend/dist`.
3. Add `VITE_API_BASE_URL` as a build environment variable with the Render backend's public HTTPS origin followed by `/api` (for example, `https://<service>.onrender.com/api`). `VITE_MAX_FILE_SIZE_MB` may also be set to match the backend limit. Vite variables are public; never put credentials in them.
4. After the first deployment, copy the exact Vercel site origin (scheme and hostname, without a path) into the backend's `CLIENT_ORIGIN`. Add additional preview origins only if those previews should be allowed to call the API.

### Render API

1. Create a Node web service from the same repository with the repository root as its service root. Use `npm ci` to build and `npm run start --workspace=backend` to start. Render supplies `PORT`; the server listens on that port. Configure `/api/ready` as the health-check path.
2. Set `NODE_ENV=production`, `TRUST_PROXY_HOPS=1`, `CLIENT_ORIGIN` to the exact Vercel origin(s), and the backend variables in Render's environment settings. `TRUST_PROXY_HOPS=1` is for the single trusted Render ingress hop; change it only to match the actual trusted proxy topology.
3. Attach a persistent disk to the backend and mount it at a fixed path such as `/var/data`. Set `UPLOAD_DIR` to `/var/data/uploads`. Confirm the service plan supports the required persistent disk, capacity, and backup approach in the Render dashboard; do not rely on the service's ephemeral filesystem for uploaded files.
4. Configure HTTPS and monitor `/api/ready`. Upload processing is synchronous and invokes extraction and Gemini embedding before responding, so measure real document workloads against the hosting request-duration limits. If they exceed those limits, a durable background-job design would be a separate architectural change.

### MongoDB Atlas and ChromaDB

- Create a production Atlas cluster and least-privilege database user; set `MONGODB_URI` in Render. Restrict Atlas network access to a supported private connection or the backend's known outbound IP range. Avoid broad public IP allowlists; verify the available networking options for the selected hosting plans and regions.
- Configure a separate ChromaDB service with persistent storage and a private network route from the Render API. Set `CHROMA_URL` to its private HTTPS/internal URL. This application configures the Chroma HTTP client without authentication headers, so do not expose that endpoint publicly; use private networking/firewall controls. If the selected Chroma host requires client authentication, code changes will be needed before using it.
- Keep independent backups for Atlas, Chroma's persistent data, and uploaded files, and periodically test restoration. MongoDB metadata, Chroma vectors, and uploaded files are separate stores; the application does not provide a cross-store backup or reconciliation job.
- These deployment settings do not migrate local data. Existing local MongoDB records, Chroma vectors, and uploaded documents remain untouched. If existing data must be made available in production, plan and verify a separate migration and ensure document paths and vectors remain consistent.

### Production environment variable names

Backend: `PORT`, `NODE_ENV`, `TRUST_PROXY_HOPS`, `CLIENT_ORIGIN`, `MONGODB_URI`, `CHROMA_URL`, `CHROMA_COLLECTION`, `UPLOAD_DIR`, `GEMINI_API_KEY`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_CHAT_MODEL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `MAX_FILE_SIZE_MB`, `MAX_EXTRACTED_TEXT_CHARS`, `MAX_DOCUMENT_CHUNKS`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `TOP_K`, `MAX_VECTOR_DISTANCE`, `FREE_DOCUMENT_LIMIT`, `FREE_QUESTION_LIMIT`, `PRO_DOCUMENT_LIMIT`, `PRO_QUESTION_LIMIT`.

Frontend: `VITE_API_BASE_URL` (required for the deployed API) and optionally `VITE_MAX_FILE_SIZE_MB`. `API_PROXY_TARGET` is only for local Vite development.

The UI/API can be hosted separately, but persistent MongoDB, ChromaDB, and upload storage must be provisioned independently. Do not deploy until the private Chroma route, persistent disks, credentials, CORS origins, and backup plan are configured and verified.

## Security notes and known limitations

- JWTs are bearer tokens held in tab-scoped `sessionStorage`; they are not revocable server-side until expiry.
- Login/register and question routes have in-process rate limits. `TRUST_PROXY_HOPS` must match the trusted ingress topology; for multi-instance deployments, use a shared rate-limit store.
- CORS is restricted to `CLIENT_ORIGIN`; set the exact production frontend origin.
- Helmet security headers, request body limits, request rate limiting, per-user Mongo ownership checks, Chroma owner filtering, random stored names, and file-size/type checks are enabled.
- Files are stored on disk at `UPLOAD_DIR`. For multi-instance hosting, configure shared persistent private storage or replace the storage adapter.
- The upload route reads bounded files for extraction; there is no OCR, antivirus scanner, asynchronous queue, document retry flow, conversation continuity, billing, or account deletion.
- Chroma metadata and query filters are validated against Mongo document ownership before retrieved text reaches the LLM. Chroma and MongoDB are separate stores; failed vector cleanup can require operator reconciliation.
- Local test coverage exercises auth, mocked AI requests, and health behavior, not all real Gemini/Chroma integrations or all PDF/DOCX hostile-file cases. This MVP has not been penetration-tested or certified production-secure.
