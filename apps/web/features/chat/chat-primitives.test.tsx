import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatAttachmentRow, ConversationMessageBubble } from "@/features/chat/chat-primitives";
import { LanguageProvider } from "@/features/i18n/language-provider";
import type { MessageAttachment } from "@/shared/types/workspace";

function createAttachment(overrides: Partial<MessageAttachment>): MessageAttachment {
  return {
    id: "att-1",
    fileName: "preview.png",
    mediaType: "image/png",
    sizeBytes: 2048,
    kind: "image",
    storedPath: "/tmp/preview.png",
    ...overrides,
  };
}

describe("ChatAttachmentRow", () => {
  it("shows a loading placeholder until an image preview finishes loading", () => {
    const { container } = render(
      <ChatAttachmentRow
        attachments={[createAttachment({ id: "att-image", fileName: "preview.png" })]}
      />,
    );

    expect(container.querySelector(".chat-attachment-image__loading")).toBeInTheDocument();

    fireEvent.load(screen.getByAltText("preview.png"));

    expect(container.querySelector(".chat-attachment-image__loading")).not.toBeInTheDocument();
    expect(screen.getByAltText("preview.png")).toHaveClass("chat-attachment-image__img--ready");
  });

  it("falls back to a file card when an image preview fails", () => {
    render(
      <ChatAttachmentRow
        attachments={[createAttachment({ id: "att-broken", fileName: "broken-preview.png" })]}
      />,
    );

    fireEvent.error(screen.getByAltText("broken-preview.png"));

    expect(screen.queryByAltText("broken-preview.png")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /broken-preview\.png/i })).toHaveClass("chat-attachment-file");
    expect(screen.getByText("IMG")).toBeInTheDocument();
  });
});

describe("ConversationMessageBubble", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("translates the system speaker label in English", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <ConversationMessageBubble
          message={{
            id: "message-system",
            speaker: "系统提示",
            role: "agent",
            content: "A background update completed.",
            timestamp: "10:00",
            status: "completed",
          }}
        />
      </LanguageProvider>,
    );

    expect(screen.getByText("System Notice")).toBeInTheDocument();
    expect(screen.queryByText("系统提示")).not.toBeInTheDocument();
  });

  it("renders human and agent mentions with mention type metadata", () => {
    render(
      <LanguageProvider>
        <ConversationMessageBubble
          message={{
            id: "message-1",
            speaker: "Atlas",
            role: "agent",
            content: "@Mina 请确认预算口径。@Nova 你继续生成草案。",
            timestamp: "10:00",
            status: "completed",
            mentions: [
              {
                humanId: "Mina",
                label: "Mina",
                token: "Mina",
                mentionType: "human",
                inChannel: true,
              },
              {
                agentId: "Nova",
                label: "Nova",
                token: "Nova",
                mentionType: "agent",
                inChannel: true,
              },
            ],
          }}
        />
      </LanguageProvider>,
    );

    expect(screen.getByText("@Mina")).toHaveAttribute("data-mention-type", "human");
    expect(screen.getByText("@Nova")).toHaveAttribute("data-mention-type", "agent");
    expect(screen.getByText("@Mina")).toHaveAttribute("title", "Human mention: Mina");
    expect(screen.getByText("@Nova")).toHaveAttribute("title", "Agent mention: Nova");
  });

  it("renders inline runtime approval actions", async () => {
    const user = userEvent.setup();
    const onReviewApproval = vi.fn(async () => {});

    render(
      <LanguageProvider initialLanguage="zh">
        <ConversationMessageBubble
          message={{
            id: "message-approval",
            speaker: "系统提示",
            role: "agent",
            content: "Atlas requested permission to run Bash",
            code: "approval.created",
            data: {
              approval_id: "approval-1",
              approval_type: "runtime_tool",
              approval_status: "pending",
              agent_id: "Atlas",
              tool_name: "Bash",
              content_preview: "Bash: npm run test",
            },
            timestamp: "10:00",
            status: "completed",
          }}
          onReviewApproval={onReviewApproval}
        />
      </LanguageProvider>,
    );

    expect(screen.getByText("等待审批")).toBeInTheDocument();
    expect(screen.getByText("Bash: npm run test")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "批准" }));

    expect(onReviewApproval).toHaveBeenCalledWith("approval-1", "approved");
  });

  it("reveals streamed pending agent reply content instead of hiding it behind dots", () => {
    vi.useFakeTimers();

    const { container } = render(
      <LanguageProvider>
        <ConversationMessageBubble
          message={{
            id: "message-stream-pending",
            speaker: "Atlas",
            role: "agent",
            content: "我正在整理第一版。",
            code: "agent.pending",
            data: { stream_started: "true", source_task_queue_id: "queue-1" },
            timestamp: "10:00",
            status: "pending",
          }}
        />
      </LanguageProvider>,
    );

    expect(screen.queryByText("我正在整理第一版。")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(screen.getByText("我")).toBeInTheDocument();
    expect(container.querySelector(".contacts-pending-dots")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(16 * 8);
    });
    expect(screen.getByText("我正在整理第一版。")).toBeInTheDocument();
    expect(container.querySelector(".contacts-pending-dots")).not.toBeInTheDocument();
  });

  it("reveals completed streamed agent replies progressively", () => {
    vi.useFakeTimers();

    render(
      <LanguageProvider>
        <ConversationMessageBubble
          message={{
            id: "message-stream-complete",
            speaker: "Atlas",
            role: "agent",
            content: "abcdef",
            data: { stream_started: "true", source_task_queue_id: "queue-1" },
            timestamp: "10:00",
            status: "completed",
          }}
        />
      </LanguageProvider>,
    );

    expect(screen.queryByText("abcdef")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(screen.getByText("a")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(16 * 2);
    });
    expect(screen.getByText("abc")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(16 * 3);
    });
    expect(screen.getByText("abcdef")).toBeInTheDocument();
  });
});
