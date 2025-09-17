# Budget App

Lightweight personal finance transaction parser + categorizer with a React (Vite + TypeScript) frontend and Python backend (FastAPI / parsing pipeline). Supports PDF bank statement ingestion, heuristic categorization into seven canonical buckets, and optional local embedding-based AI refinement (privacy-preserving) when enabled.

## Status
Active development. AWS deployment uses Elastic Beanstalk for the backend (FastAPI) and AWS Amplify for the frontend (React).
## Features (Current)

## Security & Secret Management

**Never commit secrets, API keys, credentials, or user data to this repository.**

- All sensitive configuration (e.g., Stripe keys, database URIs, email credentials) must be provided via environment variables or a cloud secret manager (e.g., AWS Secrets Manager).
- The `.gitignore` is configured to block common secret/config files, but always double-check before pushing.
- For AWS deployment (Elastic Beanstalk, Amplify), set secrets in the AWS console or use AWS Secrets Manager. The app reads secrets from environment variables at runtime.
- User data is never stored in the repo. All user-uploaded data is processed in memory and not persisted unless a future feature enables it (see privacy section below).

**If you ever accidentally commit a secret, rotate it immediately and remove it from the repo history.**

### Example: Setting Secrets for AWS

When deploying to AWS Elastic Beanstalk or Amplify, add environment variables for secrets (e.g., `STRIPE_API_KEY`, `DATABASE_URL`) in the respective AWS console under Environment variables or connect to AWS Secrets Manager.

**Do not put secrets in code or config files.**

## Draft: Privacy & Data Handling (To Be Finalized Pre-AWS)
This section is an initial draft outlining how end‑user data is handled. It will be reviewed and possibly expanded (e.g., with Data Protection Impact Assessment references, retention policy specifics, and jurisdictional disclosures) before production deployment on AWS (Elastic Beanstalk/Amplify).

### Guiding Principles
1. Minimum collection: Only transaction lines required for categorization & analytics are extracted.
2. Server-side, ephemeral processing: When deployed to AWS the frontend uploads PDFs over HTTPS to the backend (Elastic Beanstalk) where parsing and analysis occur in-memory. By default parsed data is not persisted.
3. Ephemeral by default: Parsed transactions are held in memory for the session and not persisted unless an explicit persistence feature is later enabled.
4. Transparency & control: Feature flags and environment variables clearly control any optional components (e.g., AI refinement). AI refinement runs on the backend and is strictly opt-in.
5. Security in depth: Network egress restriction + dependency pinning + principle of least privilege for any future cloud resources.

### Data Flow Summary
1. User uploads PDF → sent over HTTPS directly to the backend service (Elastic Beanstalk).
2. Backend parses PDF pages in memory; raw text and parsed results are not stored permanently by default.
3. Transaction rows (date, description, amount, inferred meta) are held in-memory for the session and used to generate analytics.
4. Heuristic categorization is applied immediately on the backend.
5. (Optional) AI refinement: If `USE_AI_CATEGORIES=1`, a locally loaded embedding model running on the backend re-scores select broad categories; no external calls are made for categorization.
6. Result returned to the frontend over HTTPS; frontend renders analytics. No background transmission elsewhere by default.

### What Is NOT Done (By Default)
- No persistent storage of PDFs or parsed transactions (unless an explicit persistence mode is later enabled).
- No transmission of financial data to external AI or SaaS APIs for categorization.
- No logging of full raw descriptions or amounts (only high-level events if logging is later added; currently none persisted by default).
- No cross-user data sharing or multi-tenant aggregation features.

### Optional AI Categorization Privacy
The embedding model (`all-MiniLM-L6-v2`) is downloaded once (build or cold start) and then used locally. If dependencies fail to load, the system silently falls back to heuristic rules—ensuring no data exfiltration risk from model load errors.

### Environment / Configuration Variables
| Variable | Purpose | Default | Privacy Impact |
|----------|---------|---------|----------------|
| `USE_AI_CATEGORIES` | Enable local embedding refinement | unset (off) | None when off; local only when on |
| `AI_MIN_CONF` | Margin threshold to accept AI override | `0.05` | Adjusts aggressiveness, no external effect |
| `CATEGORY_RULES_FILE` | Path to JSON with custom regex rules | unset | Only read locally; ensure secure path |

### Planned Hardening Before AWS
- Add warm-up hook & readiness probes (avoid variable cold start timing)
- Pin all Python dependencies with hashes (supply lock file)
- Enable container vulnerability scanning & CI signing
- Document optional retention/persistence mode (if added) with encryption at rest & purge policy
- Introduce structured, PII-scrubbed audit logging (optional) via AWS CloudWatch
- Apply network egress lockdown (no outbound except CRL/patch channels if needed)
- Add Terms / Privacy Policy references & user consent banner if retention introduced

### User Rights & Export (Future Work)
If persistent storage is later implemented, add endpoints to:
- Export user’s categorized transactions (CSV/JSON)
- Delete user session data immediately (Right to Erasure analogue)
- Provide transparency summary (counts per category, processing date)

### Threat Mitigations (Current Scope)
| Threat | Mitigation |
|--------|------------|
| Data exfiltration via AI API | No external API usage; local model only |
| Regex ReDoS | Curated rule set; future: add timeouts & pattern vetting for user-supplied rules |
| Multi-user data leakage | No multi-user storage; per-session memory only |
| Supply chain risk | (Planned) Dependency pinning + scanning |
| Unauthorized persistence | No write path implemented; explicit feature gating required |

### Assumptions / Open Items
- Deployment mode initially single-tenant or low user volume demo.
- No regulated data classification yet; if handling sensitive statements broadly, conduct formal DPIA & add KMS / CMK encryption layers.
- Final legal Privacy Policy text pending.

## Local Development (Brief)
backend (example):
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export USE_AI_CATEGORIES=1  # optional
# The canonical FastAPI entrypoint is `api:app` (module `backend/src/api.py`)
uvicorn api:app --reload
```

Frontend (example):
```bash
cd frontend
npm install
npm run dev
```

## AWS Deployment

### Backend (FastAPI) — Elastic Beanstalk
- Deploy the backend using AWS Elastic Beanstalk (Python environment or Docker if containerized).
- Set environment variables and secrets in the Elastic Beanstalk console or connect to AWS Secrets Manager.
- Elastic Beanstalk manages scaling, health checks, and rolling deployments.

### Frontend (React) — AWS Amplify
- Deploy the frontend using AWS Amplify Console (connect your GitHub repo, select the frontend directory).
- Configure build settings as needed (Amplify auto-detects most React/Vite setups).
- Set environment variables in the Amplify Console for any frontend secrets (never expose backend secrets to frontend).
- Amplify provides hosting, SSL, and CI/CD from your repo.

### General AWS Notes
- The repo includes `docker-compose.yml`, `backend/Dockerfile`, and `frontend/Dockerfile` for local container builds.
- The nginx config proxies `/api/` to a `backend` service when running with docker-compose. In production, ensure the frontend is configured to call the correct API endpoint (Elastic Beanstalk backend URL).

## Deployment

Local Docker (development)

 - Build and run with docker-compose:

```bash
docker-compose build
docker-compose up
```




## License
This project is published under the Business Source License 1.1 (BSL).
The repository source is visible for review and development, but
production/commercial use is restricted until the Change Date
(`2036-09-17`) when the code will automatically convert to the
Apache License 2.0. To request a commercial license prior to that
date, contact: `deanjx2015@gmail.com`.

See `LICENSE` and `LICENSE-COMMERCIAL.md` for details.

---
Draft privacy section included above—flag anything you’d like changed or expanded before finalization.
