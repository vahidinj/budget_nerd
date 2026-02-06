
# Backend Security, Privacy & Deployment

- **Never commit secrets, credentials, or user data to this repo.**
- All sensitive config (API keys, DB URIs, etc.) must be set via environment variables or a cloud secret manager (e.g., AWS Secrets Manager).
- User-uploaded data is processed in memory only and not persisted unless a future feature enables it (see main README privacy section).
- For AWS deployment, use Elastic Beanstalk (Python or Docker environment). Set secrets in the Elastic Beanstalk console or connect to AWS Secrets Manager.

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
```
Only transaction descriptions are sent to OpenAI when enabled; PDFs and full statement text never leave your system.

## Key Environment Variables
- `USE_AI_CATEGORIES` (unset by default)
- `OPENAI_API_KEY` (required if AI enabled)
- `OPENAI_MODEL` (default: `gpt-3.5-turbo`)
- `CATEGORY_RULES_FILE` / `CUSTOM_CATEGORY_RULES` for regex overrides

See the main project README for full security, privacy, and deployment details.
