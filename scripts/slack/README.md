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

Use the `npm run smoke:slack` and `npm run smoke:slack:verify` entrypoints instead of calling `node scripts/slack/smoke.ts` directly; the npm scripts insert a `--` separator so Node does not consume the smoke harness `--env-file` flag.

The dry-run validates callback URL shape, workspace/integration ids, disposable Slack channel/user placeholders, and the Slack app/team ids needed by the final live evidence artifact. It also returns `manualActions` for the native agent experience and approval proof required before final `--require all`. Generated `.env` files include the same manual actions and suggested verification order as comments, so they remain safe for the parser while keeping the smoke sequence visible. It does not read or print Slack bot tokens, app-level tokens, signing secrets, channel contents, or message text. Use the AgentSpace CLI health/readiness commands for saved credential checks:

```bash
npm run cli -- integrations slack health-check --workspace-id default --integration CHANGE_ME_SLACK_INTEGRATION_ID --json
npm run cli -- integrations slack readiness --workspace-id default --integration CHANGE_ME_SLACK_INTEGRATION_ID --strict --json
npm run cli -- integrations slack evidence --workspace-id default --integration CHANGE_ME_SLACK_INTEGRATION_ID --strict --require message --json
```

`smoke-plan` includes a Slack app manifest draft for the current Agent messaging experience. It enables `features.agent_view`, subscribes to `app_home_opened`, `app_context_changed`, and `message.im`, includes the `assistant:write`, `files:read`, and `files:write` bot scopes, and fills the Events / Interactivity callback URLs from `--app-url`.

`evidence` reads local AgentSpace integration events, message mappings, bindings, and outbox state. Use `--require message` for the core message transport gate, `--require native` for app-home/agent-context/suggested-prompt evidence, `--require approval` for Block Kit approval evidence, `--require files` for the Slack files data-plane gate, or `--require all` before final sign-off. Strict evidence ignores local proof older than 24 hours and requires a fresh healthy health-check so final sign-off must be backed by current Slack activity and credentials.

When final evidence is not satisfied, top-level and per-integration `nextCommands` start with `smoke-env`, `health-check`, readiness, `smoke-plan`, and `--check-env` before the live smoke commands, so the remediation chain also covers the strict health and env prerequisites.

Replay signed Slack webhook calls against the configured AgentSpace callback:

```bash
npm run smoke:slack -- --env-file scripts/slack/.env --replay-webhook --json
```

The replay sends a signed `url_verification` challenge and a signed `app_mention` event using `SLACK_SIGNING_SECRET`, `SLACK_SMOKE_APP_ID`, and `SLACK_SMOKE_TEAM_ID`. It appends `workspaceId` and `integrationId` query params when they are missing from `SLACK_SMOKE_CALLBACK_URL`, and its output redacts signing secrets and raw Slack ids.

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
SLACK_BOT_TOKEN=xoxb-... npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence runtime-output/slack-smoke/live.json --json
```

Fill `SLACK_SMOKE_APP_ID` and `SLACK_SMOKE_TEAM_ID` before any live command. All live modes require them so the evidence artifact can carry hashed Slack app/team context for the final strict gate.

Then trigger a real app mention and a disposable file upload into the same evidence artifact:

```bash
SLACK_SMOKE_LIVE_MODE=app_mention npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence runtime-output/slack-smoke/live.json --json
npm run cli -- integrations slack outbox drain --workspace-id default --integration CHANGE_ME_SLACK_INTEGRATION_ID --json
SLACK_SMOKE_LIVE_MODE=file_upload npm run smoke:slack -- --env-file scripts/slack/.env --live --evidence runtime-output/slack-smoke/live.json --json
npm run smoke:slack:verify -- --env-file scripts/slack/.env --json
npm run cli -- integrations slack evidence --workspace-id default --integration CHANGE_ME_SLACK_INTEGRATION_ID --live-smoke-evidence runtime-output/slack-smoke/live.json --strict --require all --json
```

Before the final evidence command, also collect the local native and approval proof required by `--require all`: open the Slack app Messages tab and send one app-context DM or agent-view message so AgentSpace records app context, app-home welcome, and assistant suggested-prompt evidence; then trigger one AgentSpace runtime approval card in Slack and approve or reject it so AgentSpace records processed `block_actions` and an approval status outbox receipt.

The live commands call `chat.postMessage` for `SLACK_SMOKE_CHANNEL_ID`, optionally in `SLACK_SMOKE_THREAD_TS`; `app_mention` posts `<@SLACK_SMOKE_BOT_USER_ID> ...` from `SLACK_SMOKE_POST_TOKEN`; `file_upload` uses `files.getUploadURLExternal` plus `files.completeUploadExternal`. After the live app mention, wait for the AgentSpace task to queue a reply, then drain the Slack outbox so final evidence can correlate the live mention message ref with the local inbound mapping and Slack thread reply. JSON output redacts tokens and raw Slack ids, returning only short channel/message/file references plus hashed app/team references. The evidence artifact records only ready live/replay runs with the AgentSpace workspace/integration context; JSON includes `evidenceArtifact.written`, and `--evidence` exits non-zero when it is requested for dry-run or when a live/replay run is not ready. Reusing the same evidence path for another workspace/integration/app/team drops non-matching old runs before writing. `npm run smoke:slack:verify -- --env-file scripts/slack/.env --json` verifies that the artifact is fresh, covers `post_message`, `app_mention`, and `file_upload`, matches the env-file workspace/integration/app/team context, carries per-run context, and contains no token-like values, raw Slack ids, raw message timestamps, or private file URLs before final sign-off; its JSON output includes `manualActions` for the native and approval proof required by `--require all`, plus `nextCommands` for missing live modes, outbox drain, re-verify, and final evidence. If a custom `--verify-evidence` path is used, remediation keeps that same artifact path. Strict final evidence rejects artifacts from another integration or Slack app/team, accumulated artifacts require each run to carry its own context, and stale runs are ignored so old proof cannot be reused after appending a fresh run. When checking a whole workspace without `--integration`, the live proof and local evidence must still satisfy the same integration. `SLACK_API_BASE_URL` can point at a fake Slack API server for tests; otherwise it defaults to `https://slack.com/api`.
