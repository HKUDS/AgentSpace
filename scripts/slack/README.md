# Slack Smoke

This folder contains a safe Slack smoke dry-run harness for AgentSpace.

Generate a local env template from AgentSpace state:

```bash
npm run cli -- integrations slack smoke-env --workspace-id default --integration CHANGE_ME_SLACK_INTEGRATION_ID --app-url https://agentspace.example.com > scripts/slack/.env
```

Check the env without Slack network calls:

```bash
npm run smoke:slack -- --env-file scripts/slack/.env --check-env --json
```

The dry-run validates callback URL shape, workspace/integration ids, and disposable Slack channel/user placeholders. It does not read or print Slack bot tokens, app-level tokens, signing secrets, channel contents, or message text. Use the AgentSpace CLI health/readiness commands for saved credential checks:

```bash
npm run cli -- integrations slack health-check --workspace-id default --integration CHANGE_ME_SLACK_INTEGRATION_ID --json
npm run cli -- integrations slack readiness --workspace-id default --integration CHANGE_ME_SLACK_INTEGRATION_ID --strict --json
```
