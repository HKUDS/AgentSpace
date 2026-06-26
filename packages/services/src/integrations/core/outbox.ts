import {
  createExternalMessageOutboxSync,
  listPendingExternalMessageOutboxSync,
  type ExternalMessageOutboxRecord,
} from "@agent-space/db";
import type { ExternalOutboundMessagePayload } from "./message-transport.ts";
import type { IntegrationRuntimeContext } from "./types.ts";

export function enqueueExternalOutboundMessageSync(input: {
  context: IntegrationRuntimeContext;
  channelBindingId?: string;
  agentSpaceMessageId?: string;
  outbound: ExternalOutboundMessagePayload;
  nextAttemptAt?: string;
}): ExternalMessageOutboxRecord {
  return createExternalMessageOutboxSync({
    workspaceId: input.context.workspaceId,
    integrationId: input.context.integrationId,
    channelBindingId: input.channelBindingId,
    targetExternalChatId: input.outbound.targetExternalChatId,
    targetExternalThreadId: input.outbound.targetExternalThreadId,
    agentSpaceMessageId: input.agentSpaceMessageId,
    payloadJson: input.outbound.payload,
    nextAttemptAt: input.nextAttemptAt,
  });
}

export function listDueExternalOutboundMessagesSync(input: {
  workspaceId: string;
  integrationId?: string;
  now?: string;
  limit?: number;
}): ExternalMessageOutboxRecord[] {
  return listPendingExternalMessageOutboxSync(input);
}
