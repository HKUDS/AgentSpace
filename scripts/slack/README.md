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

Bind a Slack app to one AgentSpace agent when testing agent-scoped routing:

```bash
npm run cli -- integrations slack bind-agent-bot --workspace-id default --agent CHANGE_ME_AGENTSPACE_AGENT_NAME --app-id CHANGE_ME_SLACK_APP_ID --team-id CHANGE_ME_SLACK_TEAM_ID --env-file scripts/slack/.env --bot-token-env SLACK_BOT_TOKEN --signing-secret-env SLACK_SIGNING_SECRET --app-level-token-env SLACK_APP_TOKEN --json
```

Enable Interactivity in the Slack app when testing Block Kit approvals:

```text
https://agentspace.example.com/api/integrations/slack/interactions?workspaceId=default&integrationId=CHANGE_ME_SLACK_INTEGRATION_ID
```

Slack Block Kit buttons handle AgentSpace `runtime_tool` approvals and Feishu `external_data_operation` approvals. HTTP Interactivity and Socket Mode `interactive` envelopes both reuse the same callback processor; when testing Feishu approved writes through Slack, set `AGENT_SPACE_FEISHU_API_BASE_URL` or pass `--feishu-base-url` to the Slack worker if you need a non-default Feishu OpenAPI endpoint.

Send one disposable live Slack message after readiness passes:

```bash
SLACK_BOT_TOKEN=xoxb-... npm run smoke:slack -- --env-file scripts/slack/.env --live --json
```

The live command calls `chat.postMessage` for `SLACK_SMOKE_CHANNEL_ID`, optionally in `SLACK_SMOKE_THREAD_TS`. Its JSON output redacts the bot token and returns only short channel/message references. `SLACK_API_BASE_URL` can point at a fake Slack API server for tests; otherwise it defaults to `https://slack.com/api`.
