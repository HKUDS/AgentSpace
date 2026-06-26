import { appendTaskMessageSync, completeQueuedTaskSync, failQueuedTaskSync, readAgentRuntimeSync } from "@agent-space/db";
import type { MessageAttachment } from "@agent-space/domain/workspace";
import {
  applyDocumentRuntimeOutputOperations,
  applyChannelDocumentOperations,
  applyKnowledgeProposalOperations,
  applySkillImportOperations,
  discardTaskOutputAttachments,
  loadTaskOutputEnvelope,
  parseTaskPayload,
} from "agent-space-daemon";
import type { CompleteTaskRequest } from "@agent-space/domain";
import {
  completeChannelDocumentRunStepSync,
  completeAgentChannelReplySync,
  continueAutoContinuationAfterTaskSync,
  failChannelDocumentRunStepSync,
  formatConversationFailureSummary,
  formatTaskFailureSummary,
  applyFeishuLarkCliResultManifestOperations,
  applyFeishuRuntimeDataOperationRequests,
  listFeishuLarkCliResourceGrantsForChannelSync,
  postMessageSync,
  queueFeishuAgentStatusCardOutboxSync,
  queueFeishuChannelReplyOutboxSync,
  readWorkspaceStateSync,
  replacePendingChannelMessageSync,
  resolveCompatibleDirectChannelRecord,
  AgentDocumentPermissionError,
  updateExternalChannelDocumentMetadataSync,
  writeConversationExecutionWorkspaceStateSync,
  upsertDirectConversationStateSync,
  updateTaskStatusSync,
  writeWorkspaceStateSync,
  type FeishuAgentStatusCardStatus,
} from "@agent-space/services";
import { readTaskForWorkspace, requireDaemonAuth } from "../../../_lib/auth";
import {
  clearDaemonTaskOutputStaging,
  getDaemonTaskOutputStagingDir,
  materializeOutputBundleToStaging,
} from "../../../_lib/output-bundle";
import { applyExternalSheetOperations } from "@/features/integrations/external-sheets";
import { applyExternalGoogleDocOperations } from "@/features/integrations/external-google-docs";
import { getGoogleWorkspaceAccessTokenForAgent } from "@/features/integrations/google-workspace";
import { syncGoogleSheetDocumentDrivePermissions } from "@/features/integrations/google-drive-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const auth = requireDaemonAuth(request);
  if (auth instanceof Response) {
    return auth;
  }

  const { taskId } = await context.params;
  const task = readTaskForWorkspace(taskId, auth.workspaceId);
  if (task instanceof Response) {
    return task;
  }

  const runtime = readAgentRuntimeSync(task.runtimeId);
  if (!runtime || runtime.workspaceId !== auth.workspaceId) {
    return Response.json({ error: `Runtime "${task.runtimeId}" does not exist.` }, { status: 404 });
  }

  const body = (await request.json()) as Partial<CompleteTaskRequest>;
  const payload = parseTaskPayload(task);
  const workspaceState = readWorkspaceStateSync(task.workspaceId);
  const providerSupportsReusableSession = runtime.provider !== "hermes";
  const conversationSessionId = providerSupportsReusableSession ? body.sessionId : null;
  const effectiveChannelName =
    payload.channelName
      ?? (payload.contactId ? resolveCompatibleDirectChannelRecord(workspaceState, payload.contactId)?.name : undefined);
  const fallbackOutput = body.outputText?.trim() ?? "";
  const stagingDir = getDaemonTaskOutputStagingDir(task.id, task.workspaceId);
  let persistedAttachments: Awaited<ReturnType<typeof loadTaskOutputEnvelope>>["attachments"] = [];

  if (body.outputBundle) {
    try {
      materializeOutputBundleToStaging(task.id, task.workspaceId, body.outputBundle);
    } catch (error) {
      clearDaemonTaskOutputStaging(task.id, task.workspaceId);
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      );
    }
  }

  try {
    const documentOperations = effectiveChannelName
      ? applyChannelDocumentOperations(stagingDir, {
          channelName: effectiveChannelName,
          sourceMessageId: payload.sourceMessageId,
          sourceTaskQueueId: task.id,
          actorName: payload.assignee ?? task.agentId,
          workspaceId: task.workspaceId,
        })
      : { warnings: [] as string[], documentUpdates: [] as Array<{ documentId: string; documentVersionId: string }> };
    const skillImportOperations = await applySkillImportOperations(stagingDir, {
      workspaceId: task.workspaceId,
      agentName: payload.assignee ?? task.agentId,
    });
    const documentRuntimeOutputOperations = applyDocumentRuntimeOutputOperations({
      workDir: stagingDir,
      workspaceId: task.workspaceId,
      actorName: payload.assignee ?? task.agentId,
      sourceTaskQueueId: task.id,
      sourceChannelName: effectiveChannelName,
      requestedByUserId: task.requestedByUserId,
      requestedByDisplayName: task.requestedByDisplayName,
    });
    const feishuLarkCliResourceGrants = listFeishuLarkCliResourceGrantsForChannelSync({
      workspaceId: task.workspaceId,
      channelName: effectiveChannelName,
    });
    const feishuLarkCliResultOperations = applyFeishuLarkCliResultManifestOperations({
      workDir: stagingDir,
      workspaceId: task.workspaceId,
      actorName: payload.assignee ?? task.agentId,
      resourceGrants: feishuLarkCliResourceGrants,
    });
    const feishuRuntimeDataOperationRequests = await applyFeishuRuntimeDataOperationRequests({
      workDir: stagingDir,
      workspaceId: task.workspaceId,
      actorName: payload.assignee ?? task.agentId,
      sourceTaskQueueId: task.id,
      sourceChannelName: effectiveChannelName,
      sourceAgentSpaceMessageId: payload.sourceMessageId,
      resourceGrants: feishuLarkCliResourceGrants,
    });
    const createdSheetPermissionSync = await syncAgentCreatedGoogleSheetPermissions({
      workspaceId: task.workspaceId,
      actorName: payload.assignee ?? task.agentId,
      operations: documentRuntimeOutputOperations.externalDocumentLinks,
    });
    documentRuntimeOutputOperations.warnings.push(...createdSheetPermissionSync.warnings);
    documentRuntimeOutputOperations.statusMessages.push(...createdSheetPermissionSync.statusMessages);
    const knowledgeProposalOperations = applyKnowledgeProposalOperations({
      workDir: stagingDir,
      workspaceId: task.workspaceId,
      actorName: payload.assignee ?? task.agentId,
      sourceTaskQueueId: task.id,
      sourceChannelName: effectiveChannelName,
    });
    const externalSheetOperations = await applyExternalSheetOperations({
      workDir: stagingDir,
      workspaceId: task.workspaceId,
      actorId: payload.assignee ?? task.agentId,
      credentialSource: {
        type: "agent_delegation",
        employeeName: payload.assignee ?? task.agentId,
      },
      channelName: effectiveChannelName,
      taskId: task.id,
    });
    const externalGoogleDocOperations = await applyExternalGoogleDocOperations({
      workDir: stagingDir,
      workspaceId: task.workspaceId,
      actorId: payload.assignee ?? task.agentId,
      credentialSource: {
        type: "agent_delegation",
        employeeName: payload.assignee ?? task.agentId,
      },
      channelName: effectiveChannelName,
    });
    const outputEnvelope = loadTaskOutputEnvelope(stagingDir, fallbackOutput, task.workspaceId);
    const finalOutputText = appendExternalSheetOperationStatus(
      outputEnvelope.text,
      externalSheetOperations.operations,
    );
    persistedAttachments = outputEnvelope.attachments;

    appendTaskMessageSync({
      taskId: task.id,
      type: "text",
      content: finalOutputText,
    });
    for (const warning of outputEnvelope.warnings) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: warning,
      });
    }
    for (const message of skillImportOperations.statusMessages) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: message,
      });
    }
    for (const warning of skillImportOperations.warnings) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: warning,
      });
    }
    for (const message of documentRuntimeOutputOperations.statusMessages) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: message,
      });
    }
    for (const message of feishuLarkCliResultOperations.statusMessages) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: message,
      });
    }
    for (const warning of feishuLarkCliResultOperations.warnings) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: warning,
      });
    }
    for (const message of feishuRuntimeDataOperationRequests.statusMessages) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: message,
      });
    }
    for (const warning of feishuRuntimeDataOperationRequests.warnings) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: warning,
      });
    }
    for (const message of knowledgeProposalOperations.statusMessages) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: message,
      });
    }
    for (const message of externalSheetOperations.statusMessages) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: message,
      });
    }
    for (const message of externalGoogleDocOperations.statusMessages) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: message,
      });
    }
    for (const warning of externalSheetOperations.warnings) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: warning,
      });
    }
    for (const warning of externalGoogleDocOperations.warnings) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: warning,
      });
    }
    for (const warning of documentOperations.warnings) {
      appendTaskMessageSync({
        taskId: task.id,
        type: "status",
        content: warning,
      });
    }

    completeQueuedTaskSync({
      taskId: task.id,
      resultJson: {
        provider: runtime.provider,
        output: finalOutputText,
        attachments: outputEnvelope.attachments.map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          mediaType: attachment.mediaType,
          kind: attachment.kind,
          sizeBytes: attachment.sizeBytes,
        })),
        skillImports: skillImportOperations.imports,
        documentUpdates: documentOperations.documentUpdates,
        externalDocumentLinks: documentRuntimeOutputOperations.externalDocumentLinks,
        feishuLarkCliDataOperationRunIds: feishuLarkCliResultOperations.operationRunIds,
        feishuRuntimeDataOperationRunIds: feishuRuntimeDataOperationRequests.operationRunIds,
        feishuRuntimeDataOperationApprovalIds: feishuRuntimeDataOperationRequests.approvalIds,
        documentPermissionRequests: documentRuntimeOutputOperations.permissionRequests,
        knowledgeProposals: knowledgeProposalOperations.knowledgeProposals,
        externalSheetOperations: externalSheetOperations.operations,
        externalGoogleDocOperations: externalGoogleDocOperations.operations,
      },
      sessionId: body.sessionId,
      workDir: body.workDir,
    });

    if (payload.taskId) {
      updateTaskStatusSync(payload.taskId, "done", task.workspaceId);
    }
    if (payload.orchestrationStepId) {
      writeWorkspaceStateSync(
        completeChannelDocumentRunStepSync({
          queuedTaskId: task.id,
          documentUpdates: documentOperations.documentUpdates,
          warningText: documentOperations.warnings[0],
        }, task.workspaceId),
        task.workspaceId,
      );
    }
    if (effectiveChannelName && payload.channel) {
      const replyResult = completeAgentChannelReplySync({
        channel: payload.channel,
        pendingSpeaker: payload.assignee ?? task.agentId,
        speaker: payload.assignee ?? runtime.name,
        summary: finalOutputText,
        attachments: outputEnvelope.attachments,
        sourceTaskQueueId: task.id,
        requestedByUserId: task.requestedByUserId,
        requestedByDisplayName: task.requestedByDisplayName,
        mentionCascadeDepth: payload.mentionCascadeDepth,
        mentionRootMessageId: payload.mentionRootMessageId ?? payload.sourceMessageId,
        sessionId: conversationSessionId ?? undefined,
        workDir: body.workDir,
      }, task.workspaceId);
      for (const warning of replyResult.warnings) {
        appendTaskMessageSync({
          taskId: task.id,
          type: "status",
          content: warning,
        });
      }
      for (const statusMessage of enqueueFeishuReplyOutboxBestEffort({
        workspaceId: task.workspaceId,
        channelName: payload.channel,
        text: finalOutputText,
        attachments: outputEnvelope.attachments,
        agentSpaceMessageId: replyResult.message.id,
        sourceAgentSpaceMessageId: payload.sourceMessageId,
        statusCard: {
          status: "complete",
          agentNames: [payload.assignee ?? task.agentId],
          message: finalOutputText,
          taskId: task.id,
        },
      })) {
        appendTaskMessageSync({
          taskId: task.id,
          type: "status",
          content: statusMessage,
        });
      }
      writeConversationExecutionWorkspaceStateSync({
        channelName: payload.channel,
        agentId: payload.assignee ?? task.agentId,
        contactId: payload.contactId,
        sessionId: conversationSessionId,
        workDir: body.workDir,
        lastTaskQueueId: task.id,
        lastError: null,
      }, task.workspaceId);
      if (payload.contactId) {
        upsertDirectConversationStateSync({
          contactId: payload.contactId,
          sessionId: conversationSessionId,
          workDir: body.workDir,
        }, task.workspaceId);
      }
    } else if (payload.contactId) {
      writeConversationExecutionWorkspaceStateSync({
        channelName: effectiveChannelName ?? payload.channel ?? payload.contactId,
        agentId: payload.contactId,
        contactId: payload.contactId,
        sessionId: conversationSessionId,
        workDir: body.workDir,
        lastTaskQueueId: task.id,
        lastError: null,
      }, task.workspaceId);
      upsertDirectConversationStateSync({
        contactId: payload.contactId,
        sessionId: conversationSessionId,
        workDir: body.workDir,
      }, task.workspaceId);
    } else if (payload.channel) {
      const replyResult = completeAgentChannelReplySync({
        channel: payload.channel,
        speaker: runtime.name,
        summary: finalOutputText,
        attachments: outputEnvelope.attachments,
        sourceTaskQueueId: task.id,
        requestedByUserId: task.requestedByUserId,
        requestedByDisplayName: task.requestedByDisplayName,
        mentionCascadeDepth: payload.mentionCascadeDepth,
        mentionRootMessageId: payload.mentionRootMessageId ?? payload.sourceMessageId,
        sessionId: conversationSessionId ?? undefined,
        workDir: body.workDir,
      }, task.workspaceId);
      for (const warning of replyResult.warnings) {
        appendTaskMessageSync({
          taskId: task.id,
          type: "status",
          content: warning,
        });
      }
      for (const statusMessage of enqueueFeishuReplyOutboxBestEffort({
        workspaceId: task.workspaceId,
        channelName: payload.channel,
        text: finalOutputText,
        attachments: outputEnvelope.attachments,
        agentSpaceMessageId: replyResult.message.id,
        sourceAgentSpaceMessageId: payload.sourceMessageId,
        statusCard: {
          status: "complete",
          agentNames: [payload.assignee ?? task.agentId],
          message: finalOutputText,
          taskId: task.id,
        },
      })) {
        appendTaskMessageSync({
          taskId: task.id,
          type: "status",
          content: statusMessage,
        });
      }
      writeConversationExecutionWorkspaceStateSync({
        channelName: payload.channel,
        agentId: payload.assignee ?? task.agentId,
        sessionId: conversationSessionId,
        workDir: body.workDir,
        lastTaskQueueId: task.id,
        lastError: null,
      }, task.workspaceId);
    }
    tryContinueAutoContinuation({
      taskId: task.id,
      workspaceId: task.workspaceId,
      sessionId: conversationSessionId ?? undefined,
      workDir: body.workDir,
    });

    return Response.json({
      task: {
        id: task.id,
        status: "completed",
        output: finalOutputText,
      },
    });
  } catch (error) {
    if (persistedAttachments.length > 0) {
      discardTaskOutputAttachments(persistedAttachments);
    }
    const message = error instanceof Error ? error.message : String(error);
    appendTaskMessageSync({
      taskId: task.id,
      type: "error",
      content: message,
    });
    const providerError = error instanceof AgentDocumentPermissionError
      ? {
          code: error.code,
          category: "provider" as const,
          rawProviderMessage: error.message,
        }
      : undefined;
    failQueuedTaskSync({
      taskId: task.id,
      errorText: message,
      errorCode: providerError?.code,
      errorCategory: providerError?.category,
      rawProviderMessage: providerError?.rawProviderMessage,
      sessionId: body.sessionId,
      workDir: body.workDir,
    });

    if (payload.taskId) {
      updateTaskStatusSync(payload.taskId, "blocked", task.workspaceId);
    }
    if (payload.orchestrationStepId) {
      writeWorkspaceStateSync(
        failChannelDocumentRunStepSync({
          queuedTaskId: task.id,
          errorText: message,
        }, task.workspaceId),
        task.workspaceId,
      );
    }
    if (effectiveChannelName && payload.channel) {
      const failureSummary = formatConversationFailureSummary({
        agentName: payload.assignee ?? task.agentId,
        channelName: payload.channel,
        errorText: message,
        isDirectConversation: Boolean(payload.contactId),
      });
      replacePendingChannelMessageSync({
        channel: payload.channel,
        pendingSpeaker: payload.assignee ?? task.agentId,
        speaker: "系统提示",
        role: "agent",
        summary: failureSummary,
        status: "error",
      }, task.workspaceId);
      for (const statusMessage of enqueueFeishuReplyOutboxBestEffort({
        workspaceId: task.workspaceId,
        channelName: payload.channel,
        text: failureSummary,
        sourceAgentSpaceMessageId: payload.sourceMessageId,
      })) {
        appendTaskMessageSync({
          taskId: task.id,
          type: "status",
          content: statusMessage,
        });
      }
      writeConversationExecutionWorkspaceStateSync({
        channelName: payload.channel,
        agentId: payload.assignee ?? task.agentId,
        contactId: payload.contactId,
        sessionId: conversationSessionId,
        workDir: body.workDir,
        lastTaskQueueId: task.id,
        lastError: message,
      }, task.workspaceId);
      if (payload.contactId) {
        upsertDirectConversationStateSync({
          contactId: payload.contactId,
          sessionId: conversationSessionId,
          workDir: body.workDir,
        }, task.workspaceId);
      }
    } else if (payload.contactId) {
      writeConversationExecutionWorkspaceStateSync({
        channelName: effectiveChannelName ?? payload.channel ?? payload.contactId,
        agentId: payload.contactId,
        contactId: payload.contactId,
        sessionId: conversationSessionId,
        workDir: body.workDir,
        lastTaskQueueId: task.id,
        lastError: message,
      }, task.workspaceId);
      upsertDirectConversationStateSync({
        contactId: payload.contactId,
        sessionId: conversationSessionId,
        workDir: body.workDir,
      }, task.workspaceId);
    } else if (payload.channel) {
      const failureSummary = formatTaskFailureSummary({
        title: payload.title || task.id,
        errorText: message,
      });
      postMessageSync({
        channel: payload.channel,
        speaker: "系统提示",
        role: "agent",
        summary: failureSummary,
        status: "error",
      }, task.workspaceId);
      for (const statusMessage of enqueueFeishuReplyOutboxBestEffort({
        workspaceId: task.workspaceId,
        channelName: payload.channel,
        text: failureSummary,
        sourceAgentSpaceMessageId: payload.sourceMessageId,
      })) {
        appendTaskMessageSync({
          taskId: task.id,
          type: "status",
          content: statusMessage,
        });
      }
      writeConversationExecutionWorkspaceStateSync({
        channelName: payload.channel,
        agentId: payload.assignee ?? task.agentId,
        sessionId: conversationSessionId,
        workDir: body.workDir,
        lastTaskQueueId: task.id,
        lastError: message,
      }, task.workspaceId);
    }
    tryContinueAutoContinuation({
      taskId: task.id,
      workspaceId: task.workspaceId,
      sessionId: conversationSessionId ?? undefined,
      workDir: body.workDir,
    });

    return Response.json({ error: message }, { status: 500 });
  } finally {
    clearDaemonTaskOutputStaging(task.id, task.workspaceId);
  }
}

function enqueueFeishuReplyOutboxBestEffort(input: {
  workspaceId: string;
  channelName: string;
  text: string;
  attachments?: MessageAttachment[];
  agentSpaceMessageId?: string;
  sourceAgentSpaceMessageId?: string;
  statusCard?: {
    status: FeishuAgentStatusCardStatus;
    agentNames: string[];
    message?: string;
    taskId?: string;
  };
}): string[] {
  try {
    const statusCardItems = input.statusCard
      ? queueFeishuAgentStatusCardOutboxSync({
          workspaceId: input.workspaceId,
          channelName: input.channelName,
          status: input.statusCard.status,
          agentNames: input.statusCard.agentNames,
          message: input.statusCard.message,
          taskId: input.statusCard.taskId,
          agentSpaceMessageId: input.agentSpaceMessageId,
          sourceAgentSpaceMessageId: input.sourceAgentSpaceMessageId,
        })
      : [];
    const replyOutboxItems = queueFeishuChannelReplyOutboxSync(input);
    const queuedCount = statusCardItems.length + replyOutboxItems.length;
    return queuedCount > 0 ? [`Feishu outbound queued: ${queuedCount} message(s).`] : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [`Feishu outbound enqueue failed: ${message}`];
  }
}

function appendExternalSheetOperationStatus(
  outputText: string,
  operations: Array<{ status: "succeeded" | "failed"; operationType?: string; message: string }>,
): string {
  const messages = operations
    .filter((operation) => operation.status === "failed" || operation.status === "succeeded")
    .map((operation) => operation.message.startsWith("Google Sheet")
      ? operation.message
      : `Google Sheet 操作${operation.status === "failed" ? "失败" : "成功"}：${operation.operationType ?? "unknown"} · ${operation.message}`)
    .filter((message) => !outputText.includes(message));
  if (messages.length === 0) {
    return outputText;
  }
  return [outputText, ...messages].filter(Boolean).join("\n\n");
}

async function syncAgentCreatedGoogleSheetPermissions(input: {
  workspaceId: string;
  actorName: string;
  operations: Array<{
    operationType?: string;
    status: "succeeded" | "failed";
    permissionSync?: {
      documentId: string;
      delegatedGoogleEmail?: string;
    };
  }>;
}): Promise<{ warnings: string[]; statusMessages: string[] }> {
  const warnings: string[] = [];
  const statusMessages: string[] = [];
  const targets = input.operations.filter((operation) =>
    operation.operationType === "create_google_sheet" &&
    operation.status === "succeeded" &&
    operation.permissionSync?.documentId,
  );
  if (targets.length === 0) {
    return { warnings, statusMessages };
  }

  let accessToken: string;
  try {
    const token = await getGoogleWorkspaceAccessTokenForAgent({
      workspaceId: input.workspaceId,
      employeeName: input.actorName,
    });
    accessToken = token.accessToken;
  } catch (error) {
    const message = `Google Sheet 权限同步失败：${error instanceof Error ? error.message : String(error)}`;
    for (const target of targets) {
      updateExternalChannelDocumentMetadataSync({
        documentId: target.permissionSync!.documentId,
        externalSyncStatus: "permission_error",
        updatedBy: "系统提示",
      }, input.workspaceId);
    }
    return {
      warnings: [message],
      statusMessages: [message],
    };
  }

  for (const target of targets) {
    try {
      const result = await syncGoogleSheetDocumentDrivePermissions({
        accessToken,
        workspaceId: input.workspaceId,
        documentId: target.permissionSync!.documentId,
        actorId: input.actorName,
        actorType: "agent",
        skipEmails: [target.permissionSync?.delegatedGoogleEmail].filter((email): email is string => Boolean(email)),
      });
      statusMessages.push(`Google Sheet 权限同步${result.status === "succeeded" ? "成功" : "失败"}：${result.message}`);
      if (result.status === "failed") {
        updateExternalChannelDocumentMetadataSync({
          documentId: target.permissionSync!.documentId,
          externalSyncStatus: "permission_error",
          updatedBy: "系统提示",
        }, input.workspaceId);
        warnings.push(result.message);
      }
    } catch (error) {
      const message = `Google Sheet 权限同步失败：${error instanceof Error ? error.message : String(error)}`;
      updateExternalChannelDocumentMetadataSync({
        documentId: target.permissionSync!.documentId,
        externalSyncStatus: "permission_error",
        updatedBy: "系统提示",
      }, input.workspaceId);
      warnings.push(message);
      statusMessages.push(message);
    }
  }
  return { warnings, statusMessages };
}

function tryContinueAutoContinuation(input: {
  taskId: string;
  workspaceId: string;
  sessionId?: string;
  workDir?: string;
}): void {
  try {
    continueAutoContinuationAfterTaskSync(input);
  } catch {
    // Completion reporting should not fail if the best-effort continuation enqueue fails.
  }
}
