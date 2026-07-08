import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExternalIntegrationEventRecord,
  ExternalMessageMappingRecord,
  readExternalMessageMappingByExternalMessageSync,
  recordExternalIntegrationEventSync,
  updateExternalIntegrationEventStatusSync,
} from "@agent-space/db";
import type { ExternalMessageEnvelope, IntegrationRuntimeContext } from "./types.ts";
import {
  prepareExternalInboundMessageDispatchSync,
  recordExternalInboundEventSync,
  resolveExternalDispatchedTaskFromRecords,
  resolveExternalInboundDuplicateMessageSync,
} from "./inbound-dispatch.ts";

const context: IntegrationRuntimeContext = {
  workspaceId: "workspace-1",
  integrationId: "integration-1",
  provider: "provider-1",
};

test("records common inbound events through the provider runtime context", () => {
  let recordedInput: Parameters<typeof recordExternalIntegrationEventSync>[0] | undefined;
  const recordEvent: typeof recordExternalIntegrationEventSync = (input) => {
    recordedInput = input;
    return integrationEventRecord({
      externalEventId: input.externalEventId,
      eventType: input.eventType,
    });
  };
  const event = recordExternalInboundEventSync({
    context,
    externalEventId: "event-1",
    eventType: "message",
    payloadJson: {
      safe: true,
    },
    receivedAt: "2026-07-08T08:00:00.000Z",
    recordEvent,
  });

  assert.equal(event.externalEventId, "event-1");
  assert.deepEqual(recordedInput, {
    workspaceId: "workspace-1",
    integrationId: "integration-1",
    provider: "provider-1",
    externalEventId: "event-1",
    eventType: "message",
    payloadJson: {
      safe: true,
    },
    receivedAt: "2026-07-08T08:00:00.000Z",
  });
});

test("resolves duplicate external messages and marks the inbound event ignored", () => {
  let readInput: Parameters<typeof readExternalMessageMappingByExternalMessageSync>[0] | undefined;
  let updateInput: Parameters<typeof updateExternalIntegrationEventStatusSync>[0] | undefined;
  const mapping = messageMappingRecord({
    externalMessageId: "message-1",
  });
  const readMessageMapping: typeof readExternalMessageMappingByExternalMessageSync = (input) => {
    readInput = input;
    return mapping;
  };
  const updateEventStatus: typeof updateExternalIntegrationEventStatusSync = (input) => {
    updateInput = input;
    return integrationEventRecord({
      externalEventId: input.externalEventId,
      status: "ignored",
      errorMessage: input.errorMessage,
    });
  };

  const duplicate = resolveExternalInboundDuplicateMessageSync({
    context,
    externalEventId: "event-1",
    externalMessageId: "message-1",
    readMessageMappingByExternalMessage: readMessageMapping,
    updateEventStatus,
  });

  assert.equal(duplicate?.mapping, mapping);
  assert.equal(duplicate?.reasonCode, "duplicate_external_message");
  assert.equal(duplicate?.event.status, "ignored");
  assert.deepEqual(readInput, {
    workspaceId: "workspace-1",
    integrationId: "integration-1",
    externalMessageId: "message-1",
  });
  assert.deepEqual(updateInput, {
    workspaceId: "workspace-1",
    provider: "provider-1",
    externalEventId: "event-1",
    status: "ignored",
    errorMessage: "duplicate_external_message",
  });
});

test("does not update inbound event status when no duplicate mapping exists", () => {
  let updateCalled = false;
  const readMessageMapping: typeof readExternalMessageMappingByExternalMessageSync = () => null;
  const updateEventStatus: typeof updateExternalIntegrationEventStatusSync = () => {
    updateCalled = true;
    return integrationEventRecord({
      externalEventId: "event-1",
    });
  };
  const duplicate = resolveExternalInboundDuplicateMessageSync({
    context,
    externalEventId: "event-1",
    externalMessageId: "message-1",
    readMessageMappingByExternalMessage: readMessageMapping,
    updateEventStatus,
  });

  assert.equal(duplicate, null);
  assert.equal(updateCalled, false);
});

test("prepares ignored inbound dispatch results for non-message payloads", () => {
  let updateInput: Parameters<typeof updateExternalIntegrationEventStatusSync>[0] | undefined;
  const event = integrationEventRecord({
    externalEventId: "event-1",
  });

  const prepared = prepareExternalInboundMessageDispatchSync({
    context,
    event,
    externalEventId: "event-1",
    message: null,
    nonMessageReasonCode: "provider.non_message_event",
    updateEventStatus: (input) => {
      updateInput = input;
      return integrationEventRecord({
        externalEventId: input.externalEventId,
        status: "ignored",
        errorMessage: input.errorMessage,
      });
    },
  });

  assert.equal(prepared.ready, false);
  assert.equal(prepared.dispatchStatus, "ignored");
  assert.equal(prepared.message, null);
  assert.equal(prepared.reasonCode, "provider.non_message_event");
  assert.equal(prepared.event.status, "ignored");
  assert.deepEqual(updateInput, {
    workspaceId: "workspace-1",
    provider: "provider-1",
    externalEventId: "event-1",
    status: "ignored",
    errorMessage: "provider.non_message_event",
  });
});

test("prepares duplicate inbound dispatch results before provider-specific guards", () => {
  const event = integrationEventRecord({
    externalEventId: "event-duplicate",
  });
  const mapping = messageMappingRecord({
    externalMessageId: "message-duplicate",
  });
  const message = externalMessageEnvelope({
    externalEventId: "event-duplicate",
    externalMessageId: "message-duplicate",
  });

  const prepared = prepareExternalInboundMessageDispatchSync({
    context,
    event,
    externalEventId: "event-duplicate",
    message,
    nonMessageReasonCode: "provider.non_message_event",
    readMessageMappingByExternalMessage: () => mapping,
    updateEventStatus: (input) => integrationEventRecord({
      externalEventId: input.externalEventId,
      status: "ignored",
      errorMessage: input.errorMessage,
    }),
  });

  assert.equal(prepared.ready, false);
  assert.equal(prepared.dispatchStatus, "duplicate");
  assert.equal(prepared.message, message);
  assert.equal(prepared.mapping, mapping);
  assert.equal(prepared.reasonCode, "duplicate_external_message");
});

test("prepares ready inbound dispatch results when a message is new", () => {
  const event = integrationEventRecord({
    externalEventId: "event-ready",
  });
  const message = externalMessageEnvelope({
    externalEventId: "event-ready",
    externalMessageId: "message-ready",
  });

  const prepared = prepareExternalInboundMessageDispatchSync({
    context,
    event,
    externalEventId: "event-ready",
    message,
    nonMessageReasonCode: "provider.non_message_event",
    readMessageMappingByExternalMessage: () => null,
  });

  assert.equal(prepared.ready, true);
  assert.equal(prepared.event, event);
  assert.equal(prepared.message, message);
});

test("resolves the newest queued task for a dispatched external message", () => {
  const task = resolveExternalDispatchedTaskFromRecords([
    taskRecord({
      id: "older",
      agentId: "Atlas",
      channelName: "launch",
      sourceMessageId: "message-1",
      createdAt: "2026-07-08T08:00:00.000Z",
    }),
    taskRecord({
      id: "newer",
      agentId: "Atlas",
      channelName: "launch",
      sourceMessageId: "message-1",
      createdAt: "2026-07-08T08:01:00.000Z",
    }),
  ], {
    agentId: "Atlas",
    channelName: "launch",
    sourceMessageId: "message-1",
  });

  assert.equal(task?.id, "newer");
});

test("ignores tasks for another agent, channel, source message, or malformed payload", () => {
  const task = resolveExternalDispatchedTaskFromRecords([
    taskRecord({
      id: "agent-mismatch",
      agentId: "Nova",
      channelName: "launch",
      sourceMessageId: "message-1",
    }),
    taskRecord({
      id: "channel-mismatch",
      agentId: "Atlas",
      channelName: "ops",
      sourceMessageId: "message-1",
    }),
    taskRecord({
      id: "source-mismatch",
      agentId: "Atlas",
      channelName: "launch",
      sourceMessageId: "message-2",
    }),
    {
      id: "malformed",
      agentId: "Atlas",
      inputJson: "{",
      createdAt: "2026-07-08T08:03:00.000Z",
    },
  ], {
    agentId: "Atlas",
    channelName: "launch",
    sourceMessageId: "message-1",
  });

  assert.equal(task, null);
});

function taskRecord(input: {
  id: string;
  agentId: string;
  channelName: string;
  sourceMessageId: string;
  createdAt?: string;
}): {
  id: string;
  agentId: string;
  inputJson: string;
  createdAt: string;
} {
  return {
    id: input.id,
    agentId: input.agentId,
    inputJson: JSON.stringify({
      channelName: input.channelName,
      sourceMessageId: input.sourceMessageId,
    }),
    createdAt: input.createdAt ?? "2026-07-08T08:02:00.000Z",
  };
}

function integrationEventRecord(input: {
  externalEventId: string;
  eventType?: string;
  status?: ExternalIntegrationEventRecord["status"];
  errorMessage?: string;
}): ExternalIntegrationEventRecord {
  return {
    id: `event-${input.externalEventId}`,
    workspaceId: "workspace-1",
    integrationId: "integration-1",
    provider: "provider-1",
    externalEventId: input.externalEventId,
    eventType: input.eventType ?? "message",
    status: input.status ?? "received",
    payloadJson: "{}",
    errorMessage: input.errorMessage,
    receivedAt: "2026-07-08T08:00:00.000Z",
  };
}

function messageMappingRecord(input: {
  externalMessageId: string;
}): ExternalMessageMappingRecord {
  return {
    id: `mapping-${input.externalMessageId}`,
    workspaceId: "workspace-1",
    integrationId: "integration-1",
    direction: "inbound",
    externalMessageId: input.externalMessageId,
    metadataJson: "{}",
    createdAt: "2026-07-08T08:00:00.000Z",
  };
}

function externalMessageEnvelope(input: {
  externalEventId: string;
  externalMessageId: string;
}): ExternalMessageEnvelope {
  return {
    provider: "provider-1",
    integrationId: "integration-1",
    externalEventId: input.externalEventId,
    eventType: "message",
    externalChatId: "chat-1",
    externalMessageId: input.externalMessageId,
    externalSenderId: "user-1",
    text: "hello",
    attachments: [],
    rawPayload: {},
    receivedAt: "2026-07-08T08:00:00.000Z",
  };
}
