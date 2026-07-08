import assert from "node:assert/strict";
import test from "node:test";
import { resolveExternalDispatchedTaskFromRecords } from "./inbound-dispatch.ts";

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
