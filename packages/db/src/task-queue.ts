import { isDaemonProvider, type DaemonProvider } from "@agent-space/domain";
import { getDatabase, randomLikeId, DEFAULT_WORKSPACE_ID } from "./database.ts";
import { type QueuedTaskRecord, type EnqueueTaskInput, isNativeTaskStatus, priorityToNumber } from "./types.ts";
import { readEmployeeRuntimeBindingSync } from "./employee-bindings.ts";
import { buildTaskExecutionEventContext, recordTaskExecutionEventSync } from "./task-execution-events.ts";
import {
  chooseProviderSessionForTaskSync,
  createAgentRouterContextSnapshotSync,
  createAgentTaskAttemptSync,
  markAgentRouterProviderSessionInvalidSync,
  readLatestAgentTaskAttemptForTaskSync,
  recordAgentRouterEventSync,
  resolveRouterSessionForTaskSync,
  updateAgentTaskAttemptSync,
  upsertAgentRouterProviderSessionSync,
} from "./agent-router-sessions.ts";
import { readAgentRuntimeSync } from "./daemons.ts";
import { canUserUseRuntimeSync } from "./runtime-grants.ts";

export function enqueueNativeTaskSync(input: EnqueueTaskInput): QueuedTaskRecord | null {
  const db = getDatabase();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const binding = readEmployeeRuntimeBindingSync(input.assignee, workspaceId);
  if (!binding) {
    return null;
  }

  const now = new Date().toISOString();
  const queueId = `queue-${randomLikeId()}`;
  const payload = {
    taskId: input.taskId,
    assignee: input.assignee,
    title: input.title,
    channel: input.channel,
    priority: input.priority,
    ...(input.metadata ?? {}),
    requester:
      input.requestedByUserId || input.requestedByDisplayName
        ? {
            userId: input.requestedByUserId,
            displayName: input.requestedByDisplayName,
          }
        : undefined,
  };
  const routerSession = resolveRouterSessionForTaskSync({
    id: queueId,
    workspaceId,
    agentId: input.assignee,
    triggerType: input.triggerType ?? "manual",
    inputJson: JSON.stringify(payload),
    issueId: input.taskId,
  });

  db.prepare(
    `INSERT INTO agent_task_queue (
      id,
      workspace_id,
      agent_id,
      runtime_id,
      router_session_id,
      issue_id,
      trigger_type,
      priority,
      status,
      input_json,
      requested_by_user_id,
      requested_by_display_name,
      queued_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
  ).run(
    queueId,
    workspaceId,
    input.assignee,
    binding.runtimeId,
    routerSession.id,
    input.taskId ?? null,
    input.triggerType ?? "manual",
    priorityToNumber(input.priority),
    JSON.stringify(payload),
    input.requestedByUserId ?? null,
    input.requestedByDisplayName ?? null,
    now,
    now,
    now,
  );

  const task = readQueuedTaskSync(queueId);
  if (task) {
    recordRouterLifecycleEvent(task, {
      type: "task_queued",
      actorType: "system",
      summary: input.title,
      data: {
        priority: input.priority,
        preferredRuntimeId: binding.runtimeId,
        requestedByUserId: input.requestedByUserId,
        requestedByDisplayName: input.requestedByDisplayName,
      },
    });
    recordQueueLifecycleEvent(task, {
      type: "queued",
      title: "Task entered the execution queue",
      summary: `${input.title} is waiting for ${binding.runtimeName}.`,
      status: "pending",
      data: {
        priority: input.priority,
        requestedByUserId: input.requestedByUserId,
        requestedByDisplayName: input.requestedByDisplayName,
      },
    });
  }

  return task;
}

export function listQueuedTasksSync(options?: {
  workspaceId?: string;
  runtimeId?: string;
}): QueuedTaskRecord[] {
  const db = getDatabase();
  const where: string[] = [];
  const params: string[] = [];
  if (typeof options?.workspaceId === "string") {
    where.push("workspace_id = ?");
    params.push(options.workspaceId);
  }
  if (typeof options?.runtimeId === "string") {
    where.push("runtime_id = ?");
    params.push(options.runtimeId);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT
        id,
        workspace_id AS workspaceId,
        agent_id AS agentId,
        runtime_id AS runtimeId,
        router_session_id AS routerSessionId,
        issue_id AS issueId,
        trigger_type AS triggerType,
        priority,
        status,
        input_json AS inputJson,
        requested_by_user_id AS requestedByUserId,
        requested_by_display_name AS requestedByDisplayName,
        result_json AS resultJson,
        error_text AS errorText,
        session_id AS sessionId,
        work_dir AS workDir,
        queued_at AS queuedAt,
        claimed_at AS claimedAt,
        started_at AS startedAt,
        finished_at AS finishedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM agent_task_queue
      ${whereClause}
      ORDER BY created_at ASC`,
    )
    .all(...params) as Array<Record<string, unknown>>;

  return rows
    .map((row) => mapQueuedTaskRecord(row))
    .filter((row): row is QueuedTaskRecord => row !== null);
}

export function readLatestChannelExecutionSync(
  agentId: string,
  channelName: string,
  workspaceId = DEFAULT_WORKSPACE_ID,
): QueuedTaskRecord | null {
  return readLatestConversationExecutionSync(agentId, { channelName }, workspaceId);
}

export function readLatestConversationExecutionSync(
  agentId: string,
  input: {
    channelName?: string;
    contactId?: string;
  },
  workspaceId = DEFAULT_WORKSPACE_ID,
): QueuedTaskRecord | null {
  return (
    listQueuedTasksSync({ workspaceId })
      .filter((task) => task.agentId === agentId)
      .filter((task) => {
        try {
          const payload = JSON.parse(task.inputJson) as Record<string, unknown>;
          const matchesChannel =
            typeof input.channelName === "string" &&
            typeof payload.channelName === "string" &&
            payload.channelName === input.channelName;
          const matchesLegacyContact =
            typeof input.contactId === "string" &&
            typeof payload.contactId === "string" &&
            payload.contactId === input.contactId;

          return matchesChannel || matchesLegacyContact;
        } catch {
          return false;
        }
      })
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0] ?? null
  );
}

export function readQueuedTaskSync(taskId: string): QueuedTaskRecord | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT
        id,
        workspace_id AS workspaceId,
        agent_id AS agentId,
        runtime_id AS runtimeId,
        router_session_id AS routerSessionId,
        issue_id AS issueId,
        trigger_type AS triggerType,
        priority,
        status,
        input_json AS inputJson,
        requested_by_user_id AS requestedByUserId,
        requested_by_display_name AS requestedByDisplayName,
        result_json AS resultJson,
        error_text AS errorText,
        session_id AS sessionId,
        work_dir AS workDir,
        queued_at AS queuedAt,
        claimed_at AS claimedAt,
        started_at AS startedAt,
        finished_at AS finishedAt,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM agent_task_queue
      WHERE id = ?`,
    )
    .get(taskId) as Record<string, unknown> | undefined;

  return row ? mapQueuedTaskRecord(row) : null;
}

export function claimNextQueuedTaskForRuntimeSync(runtimeId: string, workspaceId?: string): QueuedTaskRecord | null {
  const db = getDatabase();
  const now = new Date().toISOString();
  let claimedId: string | null = null;
  let fallbackReason: string | undefined;

  db.exec("BEGIN");
  try {
    let row = selectQueuedTaskForRuntime(db, runtimeId, workspaceId);
    if (!row) {
      const fallback = selectFallbackQueuedTaskForRuntime(db, runtimeId, workspaceId);
      if (fallback) {
        row = fallback.row;
        fallbackReason = fallback.reason;
        db.prepare(
          `UPDATE agent_task_queue
           SET runtime_id = ?,
               updated_at = ?
           WHERE id = ? AND status = 'queued'`,
        ).run(runtimeId, now, row.id);
      }
    }

    if (row && typeof row.id === "string") {
      db.prepare(
        `UPDATE agent_task_queue
         SET status = 'claimed',
             claimed_at = ?,
             updated_at = ?
         WHERE id = ? AND status = 'queued'`,
      ).run(now, now, row.id);
      claimedId = row.id;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const task = claimedId ? readQueuedTaskSync(claimedId) : null;
  if (task) {
    const runtime = readAgentRuntimeSync(task.runtimeId);
    const providerSession = chooseProviderSessionForTaskSync({ task });
    const attempt = runtime && task.routerSessionId
      ? createAgentTaskAttemptSync({
          workspaceId: task.workspaceId,
          taskQueueId: task.id,
          routerSessionId: task.routerSessionId,
          runtimeId: task.runtimeId,
          provider: runtime.provider,
          providerSessionId: providerSession?.providerSessionId,
          status: "claimed",
          metadata: {
            routingMode: providerSession ? "same_provider_resume" : fallbackReason ? "cold_rebuild_fallback" : "cold_rebuild",
            fallbackReason,
            previousRuntimeId: fallbackReason ? readStringFromTaskInput(task.inputJson, "__previousRuntimeId") : undefined,
          },
        })
      : null;
    recordRouterLifecycleEvent(task, {
      attemptId: attempt?.id,
      type: fallbackReason ? "runtime_fallback_selected" : "runtime_selected",
      actorType: "system",
      runtimeId: task.runtimeId,
      provider: runtime?.provider,
      summary: fallbackReason
        ? `Task was reassigned to runtime ${task.runtimeId}: ${fallbackReason}.`
        : `Task was assigned to runtime ${task.runtimeId}.`,
      data: {
        attemptId: attempt?.id,
        providerSessionId: providerSession?.providerSessionId,
        routingMode: providerSession ? "same_provider_resume" : fallbackReason ? "cold_rebuild_fallback" : "cold_rebuild",
        fallbackReason,
      },
    });
    recordQueueLifecycleEvent(task, {
      type: "assigned",
      title: "Runtime claimed the task",
      summary: fallbackReason
        ? `${task.agentId} fell back to runtime ${task.runtimeId}.`
        : `${task.agentId} is assigned to runtime ${task.runtimeId}.`,
      status: "running",
      data: {
        claimedAt: task.claimedAt,
        attemptId: attempt?.id,
        routingMode: providerSession ? "same_provider_resume" : fallbackReason ? "cold_rebuild_fallback" : "cold_rebuild",
        fallbackReason,
        providerSessionId: providerSession?.providerSessionId,
      },
    });
  }
  return task;
}

export function startQueuedTaskSync(taskId: string): QueuedTaskRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const previous = readQueuedTaskSync(taskId);
  db.prepare(
    `UPDATE agent_task_queue
     SET status = 'running',
         started_at = COALESCE(started_at, ?),
         updated_at = ?
     WHERE id = ?`,
  ).run(now, now, taskId);

  const task = readQueuedTaskSync(taskId);
  if (!task) {
    throw new Error(`Queued task "${taskId}" does not exist.`);
  }
  if (previous?.status !== "running") {
    const attempt = readLatestAgentTaskAttemptForTaskSync(task.id);
    if (attempt && attempt.status !== "running") {
      updateAgentTaskAttemptSync({ attemptId: attempt.id, status: "running" });
    }
    const runtime = readAgentRuntimeSync(task.runtimeId);
    recordRouterLifecycleEvent(task, {
      attemptId: attempt?.id,
      type: "provider_started",
      actorType: "runtime",
      actorId: task.runtimeId,
      runtimeId: task.runtimeId,
      provider: runtime?.provider,
      summary: `Runtime ${task.runtimeId} started execution.`,
      data: {
        attemptId: attempt?.id,
        providerSessionId: attempt?.providerSessionId,
      },
    });
    recordQueueLifecycleEvent(task, {
      type: "workspace_prepared",
      title: "Execution started",
      summary: `Runtime ${task.runtimeId} started the task.`,
      status: "running",
      data: { startedAt: task.startedAt },
    });
  }
  return task;
}

export function completeQueuedTaskSync(input: {
  taskId: string;
  resultJson?: Record<string, unknown>;
  sessionId?: string;
  workDir?: string;
}): QueuedTaskRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const previous = readQueuedTaskSync(input.taskId);
  db.prepare(
    `UPDATE agent_task_queue
     SET status = 'completed',
         result_json = ?,
         session_id = ?,
         work_dir = ?,
         finished_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.resultJson ? JSON.stringify(input.resultJson) : null,
    input.sessionId ?? null,
    input.workDir ?? null,
    now,
    now,
    input.taskId,
  );

  const task = readQueuedTaskSync(input.taskId);
  if (!task) {
    throw new Error(`Queued task "${input.taskId}" does not exist.`);
  }
  if (previous?.status !== "completed") {
    const attempt = readLatestAgentTaskAttemptForTaskSync(task.id);
    const runtime = readAgentRuntimeSync(task.runtimeId);
    if (attempt) {
      updateAgentTaskAttemptSync({
        attemptId: attempt.id,
        status: "completed",
        providerSessionId: input.sessionId ?? null,
        metadata: mergeJsonObject(attempt.metadataJson, {
          workDir: input.workDir,
          completedAt: task.finishedAt,
          resumeMode: attempt.providerSessionId ? "same_provider_resume" : "cold_rebuild",
        }),
      });
    }
    if (runtime && task.routerSessionId && input.sessionId) {
      upsertAgentRouterProviderSessionSync({
        workspaceId: task.workspaceId,
        routerSessionId: task.routerSessionId,
        runtimeId: task.runtimeId,
        provider: runtime.provider,
        providerSessionId: input.sessionId,
        metadata: {
          taskQueueId: task.id,
          attemptId: attempt?.id,
          workDir: input.workDir,
        },
      });
    }
    recordRouterLifecycleEvent(task, {
      attemptId: attempt?.id,
      type: "final_answer",
      actorType: "agent",
      actorId: task.agentId,
      runtimeId: task.runtimeId,
      provider: runtime?.provider,
      summary: readResultSummary(input.resultJson),
      data: {
        attemptId: attempt?.id,
        providerSessionId: input.sessionId,
        workDir: input.workDir,
      },
    });
    recordArtifactEvents(task, input.resultJson);
    recordQueueLifecycleEvent(task, {
      type: "completed",
      title: "Task completed",
      summary: "The agent returned a final result and the task is closed.",
      status: "succeeded",
      data: {
        finishedAt: task.finishedAt,
        sessionId: input.sessionId,
        workDir: input.workDir,
      },
    });
  }
  return task;
}

export function failQueuedTaskSync(input: {
  taskId: string;
  errorText: string;
  sessionId?: string;
  workDir?: string;
  errorCode?: string;
  errorCategory?: string;
  provider?: string;
  rawProviderMessage?: string;
}): QueuedTaskRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const previous = readQueuedTaskSync(input.taskId);
  db.prepare(
    `UPDATE agent_task_queue
     SET status = 'failed',
         error_text = ?,
         session_id = COALESCE(?, session_id),
         work_dir = COALESCE(?, work_dir),
         finished_at = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(input.errorText, input.sessionId ?? null, input.workDir ?? null, now, now, input.taskId);

  const task = readQueuedTaskSync(input.taskId);
  if (!task) {
    throw new Error(`Queued task "${input.taskId}" does not exist.`);
  }
  if (previous?.status !== "failed") {
    const blocked = isBlockedFailure(input);
    const attempt = readLatestAgentTaskAttemptForTaskSync(task.id);
    const runtime = readAgentRuntimeSync(task.runtimeId);
    const handoffSnapshot = task.routerSessionId
      ? createAgentRouterContextSnapshotSync({
          workspaceId: task.workspaceId,
          routerSessionId: task.routerSessionId,
          taskQueueId: task.id,
          snapshotType: "handoff",
          contentMarkdown: buildFailureHandoffSnapshot(task, input),
        })
      : null;
    if (attempt) {
      updateAgentTaskAttemptSync({
        attemptId: attempt.id,
        status: "failed",
        providerSessionId: input.sessionId ?? null,
        errorText: input.errorText,
        handoffSnapshotId: handoffSnapshot?.id ?? null,
        metadata: mergeJsonObject(attempt.metadataJson, {
          workDir: input.workDir,
          errorCode: input.errorCode,
          errorCategory: input.errorCategory,
          provider: input.provider,
          failedAt: task.finishedAt,
        }),
      });
    }
    if (task.routerSessionId && isProviderSessionInvalidFailure(input)) {
      markAgentRouterProviderSessionInvalidSync({
        workspaceId: task.workspaceId,
        routerSessionId: task.routerSessionId,
        runtimeId: task.runtimeId,
        provider: runtime?.provider,
        providerSessionId: input.sessionId,
        lastError: input.errorText,
      });
    } else if (runtime && task.routerSessionId && input.sessionId) {
      upsertAgentRouterProviderSessionSync({
        workspaceId: task.workspaceId,
        routerSessionId: task.routerSessionId,
        runtimeId: task.runtimeId,
        provider: runtime.provider,
        providerSessionId: input.sessionId,
        status: "active",
        lastError: input.errorText,
        metadata: {
          taskQueueId: task.id,
          attemptId: attempt?.id,
          workDir: input.workDir,
          failure: true,
        },
      });
    }
    recordRouterLifecycleEvent(task, {
      attemptId: attempt?.id,
      type: "failure",
      actorType: "runtime",
      actorId: task.runtimeId,
      runtimeId: task.runtimeId,
      provider: runtime?.provider ?? readDaemonProvider(input.provider),
      summary: truncateSummary(input.errorText),
      data: {
        attemptId: attempt?.id,
        handoffSnapshotId: handoffSnapshot?.id,
        providerSessionId: input.sessionId,
        providerSessionInvalid: isProviderSessionInvalidFailure(input),
        errorCode: input.errorCode,
        errorCategory: input.errorCategory,
        rawProviderMessage: truncateSummary(input.rawProviderMessage),
        workDir: input.workDir,
      },
    });
    if (handoffSnapshot) {
      recordRouterLifecycleEvent(task, {
        attemptId: attempt?.id,
        type: "handoff_snapshot_created",
        actorType: "system",
        runtimeId: task.runtimeId,
        provider: runtime?.provider ?? readDaemonProvider(input.provider),
        summary: "A handoff snapshot was captured from the failed task attempt.",
        data: {
          handoffSnapshotId: handoffSnapshot.id,
          attemptId: attempt?.id,
        },
      });
    }
    recordQueueLifecycleEvent(task, {
      type: blocked ? "blocked" : "failed",
      title: blocked ? "Task is blocked" : "Task failed",
      summary: truncateSummary(input.errorText),
      severity: "error",
      status: "failed",
      data: {
        errorCode: input.errorCode,
        errorCategory: input.errorCategory,
        provider: input.provider,
        rawProviderMessage: truncateSummary(input.rawProviderMessage),
        sessionId: input.sessionId,
        workDir: input.workDir,
      },
    });
  }
  return task;
}

export function cancelQueuedTaskSync(input: {
  taskId: string;
  errorText?: string;
}): QueuedTaskRecord {
  const db = getDatabase();
  const now = new Date().toISOString();
  const previous = readQueuedTaskSync(input.taskId);
  db.prepare(
    `UPDATE agent_task_queue
     SET status = 'cancelled',
         error_text = COALESCE(?, error_text),
         finished_at = ?,
         updated_at = ?
     WHERE id = ? AND status = 'queued'`,
  ).run(input.errorText ?? null, now, now, input.taskId);

  const task = readQueuedTaskSync(input.taskId);
  if (!task) {
    throw new Error(`Queued task "${input.taskId}" does not exist.`);
  }
  if (previous?.status !== "cancelled" && task.status === "cancelled") {
    const attempt = readLatestAgentTaskAttemptForTaskSync(task.id);
    if (attempt) {
      updateAgentTaskAttemptSync({
        attemptId: attempt.id,
        status: "cancelled",
        errorText: input.errorText ?? "Task cancelled.",
      });
    }
    const runtime = readAgentRuntimeSync(task.runtimeId);
    recordRouterLifecycleEvent(task, {
      attemptId: attempt?.id,
      type: "cancelled",
      actorType: "system",
      runtimeId: task.runtimeId,
      provider: runtime?.provider,
      summary: input.errorText ? truncateSummary(input.errorText) : "Task cancelled before execution.",
      data: {
        attemptId: attempt?.id,
      },
    });
    recordQueueLifecycleEvent(task, {
      type: "cancelled",
      title: "Task cancelled",
      summary: input.errorText ? truncateSummary(input.errorText) : "The queued task was cancelled before execution.",
      severity: input.errorText ? "warning" : "info",
      status: "failed",
    });
  }
  return task;
}

function recordQueueLifecycleEvent(
  task: QueuedTaskRecord,
  event: {
    type: Parameters<typeof recordTaskExecutionEventSync>[0]["type"];
    title: string;
    summary?: string;
    severity?: Parameters<typeof recordTaskExecutionEventSync>[0]["severity"];
    status?: Parameters<typeof recordTaskExecutionEventSync>[0]["status"];
    data?: Record<string, unknown>;
  },
): void {
  const context = buildTaskExecutionEventContext(task);
  recordTaskExecutionEventSync({
    ...context,
    type: event.type,
    title: event.title,
    summary: event.summary,
    severity: event.severity,
    status: event.status,
    data: {
      triggerType: context.triggerType,
      issueId: context.issueId,
      taskTitle: context.taskTitle,
      ...event.data,
    },
  });
}

function recordRouterLifecycleEvent(
  task: QueuedTaskRecord,
  event: {
    type: string;
    actorType: Parameters<typeof recordAgentRouterEventSync>[0]["actorType"];
    actorId?: string;
    attemptId?: string;
    runtimeId?: string;
    provider?: Parameters<typeof recordAgentRouterEventSync>[0]["provider"];
    summary?: string;
    data?: Record<string, unknown>;
  },
): void {
  if (!task.routerSessionId) {
    return;
  }
  recordAgentRouterEventSync({
    workspaceId: task.workspaceId,
    routerSessionId: task.routerSessionId,
    taskQueueId: task.id,
    attemptId: event.attemptId,
    type: event.type,
    actorType: event.actorType,
    actorId: event.actorId,
    runtimeId: event.runtimeId ?? task.runtimeId,
    provider: event.provider,
    summary: event.summary,
    data: event.data,
  });
}

function recordArtifactEvents(task: QueuedTaskRecord, resultJson: Record<string, unknown> | undefined): void {
  if (!resultJson) {
    return;
  }
  const attachments = readObjectArray(resultJson.attachments);
  const skillImports = readObjectArray(resultJson.skillImports);
  const documentUpdates = readObjectArray(resultJson.documentUpdates);
  const externalSheetOperations = readObjectArray(resultJson.externalSheetOperations);
  const knowledgeProposals = readObjectArray(resultJson.knowledgeProposals);
  const artifactCount = attachments.length + skillImports.length + documentUpdates.length + externalSheetOperations.length + knowledgeProposals.length;
  if (artifactCount === 0) {
    return;
  }

  recordQueueLifecycleEvent(task, {
    type: "artifact_detected",
    title: "Runtime output contained artifacts",
    summary: `${artifactCount} runtime output artifact${artifactCount === 1 ? "" : "s"} will be collected.`,
    status: "running",
    data: {
      attachmentCount: attachments.length,
      skillImportCount: skillImports.length,
      documentUpdateCount: documentUpdates.length,
      externalSheetOperationCount: externalSheetOperations.length,
      knowledgeProposalCount: knowledgeProposals.length,
    },
  });

  for (const attachment of attachments) {
    const id = readString(attachment.id);
    const fileName = readString(attachment.fileName) ?? "attachment";
    recordQueueLifecycleEvent(task, {
      type: "artifact_collected",
      title: `Attachment collected: ${fileName}`,
      summary: "The artifact is available as a workspace attachment.",
      status: "succeeded",
      data: {
        artifactKind: "attachment",
        attachmentId: id,
        fileName,
        mediaType: readString(attachment.mediaType),
        sizeBytes: typeof attachment.sizeBytes === "number" ? attachment.sizeBytes : undefined,
        targetHref: id ? `/api/attachments/${encodeURIComponent(id)}` : undefined,
      },
    });
  }

  for (const documentUpdate of documentUpdates) {
    const documentId = readString(documentUpdate.documentId);
    recordQueueLifecycleEvent(task, {
      type: "artifact_collected",
      title: "Channel document updated",
      summary: "The runtime output was promoted into a channel document.",
      status: "succeeded",
      data: {
        artifactKind: "channel_document",
        documentId,
        documentVersionId: readString(documentUpdate.documentVersionId),
        targetHref: documentId ? `/im?tab=documents&doc=${encodeURIComponent(documentId)}` : undefined,
      },
    });
  }

  for (const skillImport of skillImports) {
    const skillName = readString(skillImport.skillName) ?? readString(skillImport.name) ?? "skill";
    recordQueueLifecycleEvent(task, {
      type: "artifact_collected",
      title: `Skill import collected: ${skillName}`,
      summary: "The runtime output was applied to the workspace skill library.",
      status: "succeeded",
      data: {
        artifactKind: "skill_import",
        skillName,
        skillId: readString(skillImport.skillId),
      },
    });
  }

  for (const operation of externalSheetOperations) {
    recordQueueLifecycleEvent(task, {
      type: "artifact_collected",
      title: "External sheet operation collected",
      summary: "The runtime output was applied to a connected Google Workspace document.",
      status: readString(operation.status) === "failed" ? "failed" : "succeeded",
      severity: readString(operation.status) === "failed" ? "error" : "info",
      data: {
        artifactKind: "external_sheet_operation",
        operationId: readString(operation.id),
        operationType: readString(operation.operationType),
        status: readString(operation.status),
        documentId: readString(operation.channelDocumentId) ?? readString(operation.documentId),
      },
    });
  }

  for (const proposal of knowledgeProposals) {
    const title = readString(proposal.title) ?? "Knowledge proposal";
    recordQueueLifecycleEvent(task, {
      type: "approval_requested",
      title: `Knowledge proposal collected: ${title}`,
      summary: readString(proposal.message) ?? "The runtime output submitted a workspace knowledge proposal for human approval.",
      status: readString(proposal.status) === "failed" ? "failed" : "pending",
      severity: readString(proposal.status) === "failed" ? "error" : "warning",
      data: {
        artifactKind: "knowledge_proposal",
        proposalId: readString(proposal.proposalId),
        approvalId: readString(proposal.approvalId),
        operation: readString(proposal.operation),
        status: readString(proposal.status),
      },
    });
  }
}

function selectQueuedTaskForRuntime(
  db: ReturnType<typeof getDatabase>,
  runtimeId: string,
  workspaceId?: string,
): Record<string, unknown> | undefined {
  return db
    .prepare(
      `SELECT t.id
       FROM agent_task_queue t
       WHERE t.runtime_id = ? AND t.status = 'queued'
         AND NOT EXISTS (
           SELECT 1 FROM agent_task_queue blocker
           WHERE blocker.agent_id = t.agent_id
             AND blocker.id != t.id
             AND blocker.status IN ('claimed', 'running')
         )
       ${typeof workspaceId === "string" ? "AND t.workspace_id = ?" : ""}
       ORDER BY t.priority DESC, t.created_at ASC
       LIMIT 1`,
    )
    .get(...(typeof workspaceId === "string" ? [runtimeId, workspaceId] : [runtimeId])) as Record<string, unknown> | undefined;
}

function selectFallbackQueuedTaskForRuntime(
  db: ReturnType<typeof getDatabase>,
  runtimeId: string,
  workspaceId?: string,
): { row: Record<string, unknown>; reason: string } | null {
  const runtime = readAgentRuntimeSync(runtimeId);
  if (!runtime || runtime.status !== "online") {
    return null;
  }
  const rows = db.prepare(
    `SELECT
       q.id,
       q.runtime_id AS runtimeId,
       q.workspace_id AS workspaceId,
       q.requested_by_user_id AS requestedByUserId,
       r.status AS selectedRuntimeStatus,
       r.provider AS selectedProvider
     FROM agent_task_queue q
     JOIN agent_runtime r ON r.id = q.runtime_id
     WHERE q.status = 'queued'
       AND q.runtime_id <> ?
       AND NOT EXISTS (
         SELECT 1 FROM agent_task_queue blocker
         WHERE blocker.agent_id = q.agent_id
           AND blocker.id != q.id
           AND blocker.status IN ('claimed', 'running')
       )
       ${typeof workspaceId === "string" ? "AND q.workspace_id = ?" : ""}
     ORDER BY q.priority DESC, q.created_at ASC
     LIMIT 20`,
  ).all(...(typeof workspaceId === "string" ? [runtimeId, workspaceId] : [runtimeId])) as Array<Record<string, unknown>>;

  for (const row of rows) {
    if (row.workspaceId !== runtime.workspaceId) {
      continue;
    }
    if (row.selectedRuntimeStatus === "online") {
      continue;
    }
    const requesterUserId = typeof row.requestedByUserId === "string" ? row.requestedByUserId : undefined;
    if (requesterUserId && !canUserUseRuntimeSync(runtime.workspaceId, runtime.id, requesterUserId)) {
      continue;
    }
    const selectedProvider = typeof row.selectedProvider === "string" ? row.selectedProvider : undefined;
    if (
      selectedProvider &&
      runtime.provider !== selectedProvider &&
      existsUsableOnlineRuntimeForProvider({
        db,
        workspaceId: runtime.workspaceId,
        provider: selectedProvider,
        requesterUserId,
      })
    ) {
      continue;
    }
    return {
      row,
      reason:
        selectedProvider && runtime.provider !== selectedProvider
          ? `preferred runtime ${String(row.runtimeId)} is offline and no usable ${selectedProvider} runtime is online`
          : requesterUserId
            ? `preferred runtime ${String(row.runtimeId)} is offline and requester can use ${runtime.id}`
            : `preferred runtime ${String(row.runtimeId)} is offline`,
    };
  }

  return null;
}

function existsUsableOnlineRuntimeForProvider(input: {
  db: ReturnType<typeof getDatabase>;
  workspaceId: string;
  provider: string;
  requesterUserId?: string;
}): boolean {
  const rows = input.db.prepare(
    `SELECT id
     FROM agent_runtime
     WHERE workspace_id = ?
       AND provider = ?
       AND status = 'online'`,
  ).all(input.workspaceId, input.provider) as Array<Record<string, unknown>>;

  if (!input.requesterUserId) {
    return rows.length > 0;
  }

  return rows.some((row) =>
    typeof row.id === "string" &&
    canUserUseRuntimeSync(input.workspaceId, row.id, input.requesterUserId!),
  );
}

function isBlockedFailure(input: {
  errorText: string;
  errorCode?: string;
  errorCategory?: string;
}): boolean {
  const value = `${input.errorCode ?? ""} ${input.errorCategory ?? ""} ${input.errorText}`.toLowerCase();
  return /\b(auth|permission|denied|forbidden|credential|budget|quota|approval|profile|context|blocked|unauthorized)\b/.test(value);
}

function isProviderSessionInvalidFailure(input: {
  errorText: string;
  errorCode?: string;
  errorCategory?: string;
}): boolean {
  return input.errorCode === "provider.session_invalid" ||
    /\b(session invalid|invalid session|session.*not found|no conversation found|no rollout found|harness\.session_missing)\b/i.test(input.errorText);
}

function buildFailureHandoffSnapshot(
  task: QueuedTaskRecord,
  input: {
    errorText: string;
    sessionId?: string;
    workDir?: string;
    errorCode?: string;
    errorCategory?: string;
    provider?: string;
    rawProviderMessage?: string;
  },
): string {
  const payload = safeParseJsonObject(task.inputJson);
  const lines = [
    "# Handoff Snapshot",
    "",
    `Task queue id: ${task.id}`,
    `Agent: ${task.agentId}`,
    `Runtime: ${task.runtimeId}`,
    input.provider ? `Provider: ${input.provider}` : "",
    input.sessionId ? `Provider session at failure: ${input.sessionId}` : "",
    input.workDir ? `Runtime-local workDir: ${input.workDir}` : "",
    "",
    "## Current Task Goal",
    readString(payload.title) ?? readString(payload.channelMessage) ?? task.issueId ?? task.id,
    "",
    "## Failure",
    input.errorCode ? `Error code: ${input.errorCode}` : "",
    input.errorCategory ? `Error category: ${input.errorCategory}` : "",
    truncateSummary(input.errorText) ?? input.errorText,
    input.rawProviderMessage ? `Provider detail: ${truncateSummary(input.rawProviderMessage)}` : "",
    "",
    "## Continuation Guidance",
    "- Treat provider hidden state, provider session id, credentials, and runtime-local workDir as non-portable unless the next attempt is on the same runtime and provider.",
    "- Rebuild context from AgentSpace messages, router events, knowledge, documents, attachments, and formal output records.",
    "- Continue from the task goal above and explicitly call out any missing runtime-local artifact if it was not promoted to formal storage.",
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function readResultSummary(resultJson: Record<string, unknown> | undefined): string | undefined {
  if (!resultJson) {
    return undefined;
  }
  return truncateSummary(readString(resultJson.output) ?? readString(resultJson.summary));
}

function mergeJsonObject(json: string, patch: Record<string, unknown>): Record<string, unknown> {
  return {
    ...safeParseJsonObject(json),
    ...dropUndefined(patch),
  };
}

function dropUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function safeParseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readStringFromTaskInput(inputJson: string, key: string): string | undefined {
  return readString(safeParseJsonObject(inputJson)[key]);
}

function readObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readDaemonProvider(value: unknown): DaemonProvider | undefined {
  return typeof value === "string" && isDaemonProvider(value) ? value : undefined;
}

function truncateSummary(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }
  return compact.length > 280 ? `${compact.slice(0, 277)}...` : compact;
}

function mapQueuedTaskRecord(value: Record<string, unknown>): QueuedTaskRecord | null {
  if (
    typeof value.id !== "string" ||
    typeof value.workspaceId !== "string" ||
    typeof value.agentId !== "string" ||
    typeof value.runtimeId !== "string" ||
    typeof value.triggerType !== "string" ||
    typeof value.priority !== "number" ||
    !isNativeTaskStatus(value.status) ||
    typeof value.inputJson !== "string" ||
    typeof value.queuedAt !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: value.id,
    workspaceId: value.workspaceId,
    agentId: value.agentId,
    runtimeId: value.runtimeId,
    routerSessionId: typeof value.routerSessionId === "string" ? value.routerSessionId : undefined,
    issueId: typeof value.issueId === "string" ? value.issueId : undefined,
    triggerType: value.triggerType,
    priority: value.priority,
    status: value.status,
    inputJson: value.inputJson,
    requestedByUserId: typeof value.requestedByUserId === "string" ? value.requestedByUserId : undefined,
    requestedByDisplayName: typeof value.requestedByDisplayName === "string" ? value.requestedByDisplayName : undefined,
    resultJson: typeof value.resultJson === "string" ? value.resultJson : undefined,
    errorText: typeof value.errorText === "string" ? value.errorText : undefined,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
    workDir: typeof value.workDir === "string" ? value.workDir : undefined,
    queuedAt: value.queuedAt,
    claimedAt: typeof value.claimedAt === "string" ? value.claimedAt : undefined,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : undefined,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}
