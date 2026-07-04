import { canReadChannelForActorSync, subscribeWorkspaceRealtimeEvents } from "@agent-space/services";
import { getWorkspaceAccessForIdentifier } from "@/features/auth/server-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(
  _request: Request,
  context: { params: Promise<{ workspaceId: string; channelName: string }> },
): Promise<Response> {
  const { workspaceId: workspaceIdentifier, channelName } = await context.params;
  const access = await getWorkspaceAccessForIdentifier(workspaceIdentifier);
  if (access.status === "unauthenticated") {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (access.status !== "ok") {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const workspaceContext = access.context;
  const workspaceId = workspaceContext.currentWorkspace.id;
  const actor = {
    userId: workspaceContext.currentUser.id,
    displayName: workspaceContext.currentUser.displayName,
    role: workspaceContext.currentMembership.role,
  };

  if (!canReadChannelForActorSync({ workspaceId, channelName, actor })) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        unsubscribe?.();
        if (heartbeat) {
          clearInterval(heartbeat);
        }
        controller.close();
      };
      const assertStillAuthorized = () => canReadChannelForActorSync({ workspaceId, channelName, actor });
      const send = (chunk: string) => {
        if (!closed) {
          controller.enqueue(encoder.encode(chunk));
        }
      };

      send("retry: 2000\n\n");
      unsubscribe = subscribeWorkspaceRealtimeEvents(workspaceId, (event) => {
        if (event.channelName !== channelName) {
          return;
        }
        if (!assertStillAuthorized()) {
          close();
          return;
        }
        const payload =
          event.type === "channel.message.created"
            ? {
                type: event.type,
                channelName: event.channelName,
                messageId: event.messageId,
                sequence: event.sequence,
                createdAt: event.createdAt,
              }
            : event.type === "channel.message.updated"
              ? {
                  type: event.type,
                  channelName: event.channelName,
                  messageId: event.messageId,
                  sequence: event.sequence,
                  updatedAt: event.updatedAt,
                }
            : event.type === "channel.thread.changed"
              ? {
                  type: event.type,
                  channelName: event.channelName,
                  sequence: event.sequence,
                  changedAt: event.changedAt,
                }
            : {
                type: event.type,
                channelName: event.channelName,
                taskId: event.taskId,
                eventId: event.eventId,
                sequence: event.sequence,
                createdAt: event.createdAt,
              };
        send(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`);
      });
      heartbeat = setInterval(() => {
        if (!assertStillAuthorized()) {
          close();
          return;
        }
        send(`: heartbeat ${Date.now()}\n\n`);
      }, HEARTBEAT_MS);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
