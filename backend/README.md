
# Backend Security, Privacy & AWS Deployment

- **Never commit secrets, credentials, or user data to this repo.**
- All sensitive config (API keys, DB URIs, etc.) must be set via environment variables or a cloud secret manager (e.g., AWS Secrets Manager).
- User-uploaded data is processed in memory only and not persisted unless a future feature enables it (see main README privacy section).
- For AWS deployment, use Elastic Beanstalk (Python or Docker environment). Set secrets in the Elastic Beanstalk console or connect to AWS Secrets Manager.

See the main project README for full security, privacy, and deployment details.
