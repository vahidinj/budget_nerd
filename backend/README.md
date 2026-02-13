
# Backend Security, Privacy & Deployment

- **Never commit secrets, credentials, or user data to this repo.**
- All sensitive config (API keys, DB URIs, etc.) must be set via environment variables or a cloud secret manager (e.g., AWS Secrets Manager).
- User-uploaded data is processed in memory only and not persisted unless a future feature enables it (see docs/privacy.md).
- For AWS deployment, use Elastic Beanstalk (Python environment). Set secrets in the Elastic Beanstalk console or connect to AWS Secrets Manager.

## Local Run (FastAPI)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.api:app --reload
```

## Optional AI Refinement (OpenAI)
```bash
pip install openai
export USE_AI_CATEGORIES=1
export OPENAI_API_KEY=sk-your_key_here
export OPENAI_MODEL=gpt-4o
```
Only transaction descriptions and the account type (checking, savings, credit card) are sent to OpenAI when enabled. Account numbers are never sent or used, and PDFs and full statement text never leave your system.

## Key Environment Variables
- `USE_AI_CATEGORIES` (unset by default)
- `OPENAI_API_KEY` (required if AI enabled)
- `OPENAI_MODEL` (default: `gpt-4o`)
- `OPENAI_BATCH_SIZE` (default: `20`)
- `CATEGORY_RULES_FILE` / `CUSTOM_CATEGORY_RULES` for regex overrides
- `ADMIN_TOKEN` (required if `REQUIRE_ADMIN=1`)
- `REQUIRE_ADMIN` (default: `1`)

See the main project README and docs/privacy.md for full security, privacy, and deployment details.
