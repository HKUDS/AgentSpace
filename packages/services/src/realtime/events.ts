import { EventEmitter } from "node:events";

export type WorkspaceRealtimeEvent =
  | {
      type: "channel.message.created";
      workspaceId: string;
      channelName: string;
      messageId: string;
      sequence: number;
      createdAt: string;
    }
  | {
      type: "channel.message.updated";
      workspaceId: string;
      channelName: string;
      messageId: string;
      sequence: number;
      updatedAt: string;
    }
  | {
      type: "channel.thread.changed";
      workspaceId: string;
      channelName: string;
      sequence: number;
      changedAt: string;
    }
  | {
      type: "task.execution_event.created";
      workspaceId: string;
      channelName: string;
      taskId: string;
      eventId: string;
      sequence: number;
      createdAt: string;
    };

export type WorkspaceRealtimeListener = (event: WorkspaceRealtimeEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);
let sequence = 0;

export function publishChannelMessageCreatedEvent(input: {
  workspaceId: string;
  channelName: string;
  messageId: string;
  createdAt: string;
}): WorkspaceRealtimeEvent {
  const event: WorkspaceRealtimeEvent = {
    type: "channel.message.created",
    workspaceId: input.workspaceId,
    channelName: input.channelName,
    messageId: input.messageId,
    sequence: nextSequence(),
    createdAt: input.createdAt,
  };
  emitter.emit(event.workspaceId, event);
  return event;
}

export function publishChannelMessageUpdatedEvent(input: {
  workspaceId: string;
  channelName: string;
  messageId: string;
  updatedAt: string;
}): WorkspaceRealtimeEvent {
  const event: WorkspaceRealtimeEvent = {
    type: "channel.message.updated",
    workspaceId: input.workspaceId,
    channelName: input.channelName,
    messageId: input.messageId,
    sequence: nextSequence(),
    updatedAt: input.updatedAt,
  };
  emitter.emit(event.workspaceId, event);
  return event;
}

export function publishChannelThreadChangedEvent(input: {
  workspaceId: string;
  channelName: string;
  changedAt: string;
}): WorkspaceRealtimeEvent {
  const event: WorkspaceRealtimeEvent = {
    type: "channel.thread.changed",
    workspaceId: input.workspaceId,
    channelName: input.channelName,
    sequence: nextSequence(),
    changedAt: input.changedAt,
  };
  emitter.emit(event.workspaceId, event);
  return event;
}

export function publishTaskExecutionEventCreatedEvent(input: {
  workspaceId: string;
  channelName: string;
  taskId: string;
  eventId: string;
  createdAt: string;
}): WorkspaceRealtimeEvent {
  const event: WorkspaceRealtimeEvent = {
    type: "task.execution_event.created",
    workspaceId: input.workspaceId,
    channelName: input.channelName,
    taskId: input.taskId,
    eventId: input.eventId,
    sequence: nextSequence(),
    createdAt: input.createdAt,
  };
  emitter.emit(event.workspaceId, event);
  return event;
}

export function subscribeWorkspaceRealtimeEvents(
  workspaceId: string,
  listener: WorkspaceRealtimeListener,
): () => void {
  emitter.on(workspaceId, listener);
  return () => {
    emitter.off(workspaceId, listener);
  };
}

function nextSequence(): number {
  sequence += 1;
  return sequence;
}
