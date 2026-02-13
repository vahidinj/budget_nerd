# Privacy & Data Handling (Draft)

This document is an initial draft outlining how end-user data is handled. It will be reviewed and possibly expanded (e.g., with retention policy specifics and jurisdictional disclosures) before production deployment on AWS (Elastic Beanstalk/Amplify).

## Guiding Principles
1. Minimum collection: Only transaction lines required for categorization and analytics are extracted.
2. Server-side, ephemeral processing: When deployed to AWS the frontend uploads PDFs over HTTPS to the backend (Elastic Beanstalk) where parsing and analysis occur in-memory. By default parsed data is not persisted.
3. Ephemeral by default: Parsed transactions are held in memory for the session and not persisted unless an explicit persistence feature is later enabled.
4. No analytics or tracking cookies: The service does not use analytics or ad trackers by default.
5. Transparency and control: Feature flags and environment variables clearly control any optional components (e.g., AI refinement). AI refinement runs on the backend and is strictly opt-in.
6. Security in depth: Network egress restriction, dependency pinning, and principle of least privilege for any future cloud resources.

## Data Flow Summary
1. User uploads PDF -> sent over HTTPS directly to the backend service (Elastic Beanstalk).
2. Backend parses PDF pages in memory; raw text and parsed results are not stored permanently by default.
3. Transaction rows (date, description, amount, inferred meta) are held in-memory for the session and used to generate analytics.
4. Heuristic categorization is applied immediately on the backend.
5. (Optional) AI refinement: If `USE_AI_CATEGORIES=1` and `OPENAI_API_KEY` are set, transaction descriptions are sent to the OpenAI API for refinement; PDFs and full statement text are never sent.
6. Result returned to the frontend over HTTPS; frontend renders analytics. No background transmission elsewhere by default.

## What Is NOT Done (By Default)
- No persistent storage of PDFs or parsed transactions (unless an explicit persistence mode is later enabled).
- No analytics, tracking pixels, or advertising cookies.
- No transmission of financial data to external AI or SaaS APIs for categorization unless you explicitly enable AI refinement.
- No logging of full raw descriptions or amounts (only high-level events if logging is later added; currently none persisted by default).
- No cross-user data sharing or multi-tenant aggregation features.

## Optional AI Categorization Privacy
If enabled, the backend sends only transaction descriptions (e.g., "STARBUCKS #1234") and the account type (checking, savings, credit card) to OpenAI for category refinement. Account numbers are never sent or used. The PDF file and full statement text never leave your system. Results are cached per description and account type to reduce API calls.

## Environment / Configuration Variables
| Variable | Purpose | Default | Privacy Impact |
|----------|---------|---------|----------------|
| `USE_AI_CATEGORIES` | Enable OpenAI refinement | unset (off) | None when off; description-only when on |
| `OPENAI_API_KEY` | OpenAI API key (required if AI enabled) | unset | Enables external API calls for descriptions |
| `OPENAI_MODEL` | OpenAI model to use | `gpt-4o` | Affects cost/accuracy only |
| `OPENAI_BATCH_SIZE` | Batch size for AI requests | `20` | Lower reduces rate pressure; higher improves throughput |
| `CATEGORY_RULES_FILE` | Path to JSON with custom regex rules | unset | Only read locally; ensure secure path |
| `CUSTOM_CATEGORY_RULES` | JSON rules file path (alternate) | unset | Only read locally; ensure secure path |
| `API_CORS_ORIGINS` | Comma-separated CORS origins | unset | Controls browser access only |
| `API_TRUSTED_HOSTS` | Allowed hostnames | `mybudgetnerd.com,...` | Server safety only |
| `ADMIN_TOKEN` | Bearer token for admin-only endpoints | unset | Required when `REQUIRE_ADMIN=1` |
| `REQUIRE_ADMIN` | Protect admin endpoints | `1` | Disable only for local/dev |
| `MAX_PARSE_TRANSACTIONS` | Cap parsing volume | `5000` | Performance safety only |

## Planned Hardening Before AWS
- Add warm-up hook and readiness probes (avoid variable cold start timing)
- Pin all Python dependencies with hashes (supply lock file)
- Enable container vulnerability scanning and CI signing
- Document optional retention/persistence mode (if added) with encryption at rest and purge policy
- Introduce structured, PII-scrubbed audit logging (optional) via AWS CloudWatch
- Apply network egress lockdown (no outbound except CRL/patch channels if needed)
- Add Terms and Privacy Policy references and a user consent banner if retention is introduced

## User Rights and Export (Future Work)
If persistent storage is later implemented, add endpoints to:
- Export user’s categorized transactions (CSV/JSON)
- Delete user session data immediately (Right to Erasure analogue)
- Provide transparency summary (counts per category, processing date)

## Threat Mitigations (Current Scope)
| Threat | Mitigation |
|--------|------------|
| Data exfiltration via AI API | AI calls are opt-in and limited to transaction descriptions only |
| Regex ReDoS | Curated rule set; future: add timeouts and pattern vetting for user-supplied rules |
| Multi-user data leakage | No multi-user storage; per-session memory only |
| Supply chain risk | (Planned) Dependency pinning and scanning |
| Unauthorized persistence | No write path implemented; explicit feature gating required |

## Assumptions / Open Items
- Deployment mode initially single-tenant or low user volume demo.
- No regulated data classification yet; if handling sensitive statements broadly, conduct formal DPIA and add KMS / CMK encryption layers.
- Final legal Privacy Policy text pending.
