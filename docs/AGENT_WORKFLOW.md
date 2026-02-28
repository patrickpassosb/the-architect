# Agent Workflow: Docker Loop Validation

This workflow is designed for hands-off agent execution:

1. Build containers
2. Start app services in Docker
3. Run integration tests
4. If all pass, stop containers and report success
5. If fail, print logs and retry (up to MAX_ATTEMPTS)

## Command

```bash
npm run workflow:docker-loop
```

## Optional

```bash
MAX_ATTEMPTS=5 npm run workflow:docker-loop
```

## Notes
- Uses: `infra/docker-compose.app.yml`
- Validates:
  - API health (`/api/health`)
  - Worker health (`/health`)
  - session creation
  - artifact listing
  - message endpoint deterministic behavior
- If `MISTRAL_API_KEY` is unset, message test expects explicit config error.
- On success, all containers are stopped automatically.
