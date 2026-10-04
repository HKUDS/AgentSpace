import { DEFAULT_WORKSPACE_ID, getDatabase } from "./database.ts";

/** Update operational references not covered by workspace_channel's cascading FKs. */
export function renameStoredChannelReferencesSync(
  previousName: string,
  nextName: string,
  previousHistoryPath: string,
  nextHistoryPath: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): void {
  const db = getDatabase();
  // A claimed runtime already owns an immutable input bundle. Let it finish before
  // changing the conversation identity; queued tasks can be migrated in place.
  const tasks = db.prepare(
    `SELECT id, status, input_json AS inputJson FROM agent_task_queue
     WHERE workspace_id = ? AND (input_json->>'channel' = ?
       OR input_json->>'channelName' = ? OR input_json->>'sourceChannel' = ?) FOR UPDATE`,
  ).all(workspaceId, previousName, previousName, previousName);
  if (tasks.some((task) => task.status === "claimed" || task.status === "running")) {
    throw new Error("Wait for this channel's running tasks to finish before renaming it.");
  }

  for (const [table, column] of [
    ["workspace_task", "channel_name"],
    ["document_permission_request", "requested_for_channel_name"],
    ["agent_access_request", "target_channel_name"],
    ["knowledge_proposal", "source_channel_name"],
    ["task_execution_event", "channel_name"],
    ["token_usage", "channel_name"],
    ["attachment", "channel_name"],
  ]) {
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE workspace_id = ? AND ${column} = ?`)
      .run(nextName, workspaceId, previousName);
  }
  db.prepare("UPDATE budget SET scope_id = ? WHERE workspace_id = ? AND scope = 'channel' AND scope_id = ?")
    .run(nextName, workspaceId, previousName);
  for (const sourceType of ["channel_conversation", "direct_conversation"]) {
    db.prepare("UPDATE agent_router_session SET conversation_key = ? WHERE workspace_id = ? AND conversation_key = ? AND source_type = ?")
      .run(`${sourceType}:${nextName}`, workspaceId, `${sourceType}:${previousName}`, sourceType);
  }
  for (const task of tasks) {
    const payload = JSON.parse(String(task.inputJson)) as Record<string, unknown>;
    for (const key of ["channel", "channelName", "sourceChannel"]) {
      if (payload[key] === previousName) payload[key] = nextName;
    }
    if (payload.channelHistoryPath === previousHistoryPath) payload.channelHistoryPath = nextHistoryPath;
    const sourceContext = payload.sourceContext as Record<string, unknown> | undefined;
    const governance = sourceContext?.governance as Record<string, unknown> | undefined;
    if (governance?.channelName === previousName) governance.channelName = nextName;
    db.prepare("UPDATE agent_task_queue SET input_json = ? WHERE workspace_id = ? AND id = ?")
      .run(JSON.stringify(payload), workspaceId, task.id);
  }

  const operations = db.prepare(
    `SELECT id, status, request_json AS "requestJson" FROM external_data_operation_run
     WHERE workspace_id = ? AND request_json->'parameters'->>'channelName' = ? FOR UPDATE`,
  ).all(workspaceId, previousName);
  for (const operation of operations) {
    const request = JSON.parse(String(operation.requestJson)) as Record<string, unknown>;
    const parameters = request.parameters as Record<string, unknown> | undefined;
    if (parameters?.channelName !== previousName) continue;
    if (operation.status === "running") {
      throw new Error("Wait for this channel's external operations to finish before renaming it.");
    }
    parameters.channelName = nextName;
    for (const key of ["feishuGovernance", "governanceContext"]) {
      const context = parameters[key] as Record<string, unknown> | undefined;
      if (context?.channelName === previousName) context.channelName = nextName;
    }
    db.prepare("UPDATE external_data_operation_run SET request_json = ? WHERE workspace_id = ? AND id = ?")
      .run(JSON.stringify(request), workspaceId, operation.id);
  }

  const notifications = db.prepare(
    `SELECT id, resource_type AS "resourceType", resource_id AS "resourceId",
            action_href AS "actionHref", metadata_json AS "metadataJson"
     FROM workspace_notification WHERE workspace_id = ? AND channel_name = ?`,
  ).all(workspaceId, previousName);
  for (const notification of notifications) {
    let actionHref = notification.actionHref;
    if (typeof actionHref === "string" && actionHref.startsWith("/im?")) {
      const url = new URL(actionHref, "https://workspace.invalid");
      if (url.searchParams.get("focus") === `channel:${previousName}`) {
        url.searchParams.set("focus", `channel:${nextName}`);
        actionHref = `${url.pathname}${url.search}${url.hash}`;
      }
    }
    const metadata = JSON.parse(String(notification.metadataJson)) as Record<string, unknown>;
    if (metadata.channelName === previousName) metadata.channelName = nextName;
    db.prepare(
      `UPDATE workspace_notification SET channel_name = ?, resource_id = ?, action_href = ?, metadata_json = ?
       WHERE workspace_id = ? AND id = ?`,
    ).run(nextName,
      notification.resourceType === "channel" && notification.resourceId === previousName ? nextName : notification.resourceId,
      actionHref, JSON.stringify(metadata), workspaceId, notification.id);
  }
}
