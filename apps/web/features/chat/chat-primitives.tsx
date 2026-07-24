"use client";

import { memo, useEffect, useState } from "react";
import Link from "next/link";
import type { MessageAttachment, MessageMention } from "@/shared/types/workspace";
import { useLanguage } from "@/features/i18n/language-provider";
import { translateSystemSpeaker, translateWorkspaceMessageSummary } from "@/features/i18n/presentation";
import { EmptyState } from "@/shared/ui/empty-state";
import { FeedbackBanner } from "@/shared/ui/feedback-banner";
import { GeneratedAvatar, type GeneratedAvatarVariant } from "@/shared/ui/generated-avatar";
import { formatCompactTimestamp } from "@/shared/lib/time-format";
import type {
  ConversationListItem,
  ConversationMentionCandidate,
  ConversationThreadMessage,
} from "@/features/chat/conversation-shell";

export const ConversationListRow = memo(function ConversationListRow({
  item,
  selected,
  onSelect,
}: {
  item: ConversationListItem;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      className={`contact-row${selected ? " contact-row--active" : ""}`}
      onClick={() => onSelect(item.id)}
      type="button"
    >
      {item.avatarVariant ? (
        <GeneratedAvatar
          className="contact-row__avatar"
          id={item.avatarId ?? item.id}
          name={item.avatarName ?? item.title}
          variant={item.avatarVariant}
        />
      ) : (
        <div className="contact-row__avatar">{item.avatar}</div>
      )}
      <div className="contact-row__content">
        <div className="contact-row__title">
          <strong>{item.title}</strong>
          <span className="contact-row__title-meta">
            {item.dateLabel ?? ""}
            {item.unread ? <i className="unread-dot" /> : null}
          </span>
        </div>
        <p>{item.subtitle}</p>
        <div className="contact-row__meta">{item.meta}</div>
      </div>
    </button>
  );
});

export function ChatHeader({
  avatar,
  avatarId,
  avatarName,
  avatarVariant,
  title,
  subtitle,
  actions,
  leadingAction,
}: {
  avatar: string;
  avatarId?: string;
  avatarName?: string;
  avatarVariant?: GeneratedAvatarVariant;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  leadingAction?: React.ReactNode;
}) {
  return (
    <header className="contacts-chat-header">
      <div className="contacts-chat-header__main">
        {leadingAction ? <div className="contacts-chat-header__leading">{leadingAction}</div> : null}
        {avatarVariant ? (
          <GeneratedAvatar
            className="contacts-chat-header__avatar"
            id={avatarId ?? title}
            name={avatarName ?? title}
            variant={avatarVariant}
          />
        ) : (
          <div className="contacts-chat-header__avatar">{avatar}</div>
        )}
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </header>
  );
}

export const ConversationMessageBubble = memo(function ConversationMessageBubble({
  message,
  isOwn,
  ownSpeakerLabel,
  acknowledgementActorLabel,
  replyToMessage,
  onReply,
  onPin,
  onUnpin,
  onAcknowledge,
  onReviewApproval,
}: {
  message: ConversationThreadMessage;
  isOwn?: boolean;
  ownSpeakerLabel?: string;
  acknowledgementActorLabel?: string;
  replyToMessage?: ConversationThreadMessage;
  onReply?: () => void;
  onPin?: () => void;
  onUnpin?: () => void;
  onAcknowledge?: () => void;
  onReviewApproval?: (approvalId: string, decision: "approved" | "rejected") => Promise<void> | void;
}) {
  const { tx } = useLanguage();
  const [reviewingDecision, setReviewingDecision] = useState<"approved" | "rejected" | null>(null);
  const own = isOwn ?? message.role === "human";
  const isPendingMessage = message.status === "pending";
  const isError = message.status === "error";
  const isProcessMessage = message.kind === "process";
  const isStreamedAgentReply = message.role === "agent" && message.data?.stream_started === "true";
  const shouldRevealStreamedContent = isStreamedAgentReply && !isError;
  const renderedContent = isStreamedAgentReply
    ? message.content
    : translateWorkspaceMessageSummary(message, tx);
  const visibleContent = useTypewriterContent({
    content: renderedContent,
    enabled: shouldRevealStreamedContent,
    speedMs: 16,
    step: 1,
  });
  const isStreamedContentRevealed =
    !shouldRevealStreamedContent || visibleContent.length >= renderedContent.length;
  const shouldShowPendingDots =
    isPendingMessage &&
    (!isStreamedAgentReply || !renderedContent.trim() || !isStreamedContentRevealed);
  const speakerLabel = translateSystemSpeaker(message.speaker, tx);
  const replyToSpeakerLabel = replyToMessage ? translateSystemSpeaker(replyToMessage.speaker, tx) : "";
  const approvalAction = buildRuntimeApprovalAction(message, tx);
  const canReviewApproval = Boolean(
    approvalAction &&
    approvalAction.status === "pending" &&
    onReviewApproval &&
    !reviewingDecision,
  );

  if (isProcessMessage) {
    return (
      <div className="inbox-bubble-row" data-conversation-message-id={message.id}>
        <GeneratedAvatar
          className={`inbox-bubble-avatar${isError ? " inbox-bubble-avatar--error" : ""}`}
          id={`${message.role}:${message.speaker}`}
          name={speakerLabel}
          variant={message.role === "agent" ? "agent" : "human"}
        />
        <details className={`conversation-process${isError ? " conversation-process--error" : ""}`}>
          <summary>
            <strong>{processTitle(message, tx)}</strong>
            <span>{renderMessageTimestamp(message.timestamp)}</span>
          </summary>
          <pre>{message.content}</pre>
        </details>
      </div>
    );
  }

  const hasActions = onReply || onPin || onUnpin || onAcknowledge;
  const acknowledgements = message.acknowledgements ?? [];
  const acknowledgementLabelForCurrentUser = acknowledgementActorLabel ?? ownSpeakerLabel;
  const acknowledgedByCurrentUser = acknowledgements.some((acknowledgement) =>
    acknowledgementLabelForCurrentUser
      ? acknowledgement.label.localeCompare(acknowledgementLabelForCurrentUser, "zh-CN", { sensitivity: "base" }) === 0
      : false,
  );
  const acknowledgementLabel = acknowledgements.map((acknowledgement) => acknowledgement.label).join("、");

  return (
    <div className={`inbox-bubble-row${own ? " inbox-bubble-row--own" : ""}`} data-conversation-message-id={message.id}>
      {!own ? (
        <GeneratedAvatar
          className={`inbox-bubble-avatar${isError ? " inbox-bubble-avatar--error" : ""}`}
          id={`${message.role}:${message.speaker}`}
          name={speakerLabel}
          variant={message.role === "agent" ? "agent" : "human"}
        />
      ) : null}
      <article
        className={`inbox-bubble${own ? " inbox-bubble--own" : ""}${isError ? " inbox-bubble--error" : ""}${
          isPendingMessage ? " inbox-bubble--pending" : ""
        }${message.pinned ? " inbox-bubble--pinned" : ""}`}
      >
        {replyToMessage ? (
          <div className="inbox-bubble__reply-quote">
            <strong>{replyToSpeakerLabel}</strong>
            <span>{replyToMessage.content.slice(0, 80)}{replyToMessage.content.length > 80 ? "..." : ""}</span>
          </div>
        ) : null}
        <div className="inbox-bubble__meta">
          <strong>
            {own ? ownSpeakerLabel ?? tx("你", "You") : isError ? `${speakerLabel} · ${tx("错误", "Error")}` : speakerLabel}
            {message.pinned ? <span className="inbox-bubble__pin-badge">{tx("已置顶", "Pinned")}</span> : null}
          </strong>
          <span>{isPendingMessage ? tx("思考中", "Thinking") : renderMessageTimestamp(message.timestamp)}</span>
        </div>
        {isPendingMessage ? (
          isStreamedAgentReply && renderedContent.trim() ? (
            <>
              <p>{renderMessageContent(visibleContent, message.mentions)}</p>
              {shouldShowPendingDots ? (
                <div className="contacts-pending-dots">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
            </>
          ) : (
            <div className="contacts-pending-dots">
              <span />
              <span />
              <span />
            </div>
          )
        ) : (
          <p>{renderMessageContent(visibleContent, message.mentions)}</p>
        )}
        {approvalAction ? (
          <div className={`runtime-approval-card runtime-approval-card--${approvalAction.status}`}>
            <div className="runtime-approval-card__header">
              <span>{approvalAction.label}</span>
              <strong>{approvalAction.toolName}</strong>
            </div>
            <pre>{approvalAction.preview}</pre>
            {approvalAction.comment ? <small>{approvalAction.comment}</small> : null}
            {approvalAction.status === "pending" && onReviewApproval ? (
              <div className="runtime-approval-card__actions">
                <button
                  className="runtime-approval-card__btn runtime-approval-card__btn--approve"
                  disabled={!canReviewApproval}
                  onClick={() => handleReviewApproval("approved")}
                  type="button"
                >
                  {reviewingDecision === "approved" ? tx("处理中", "Working") : tx("批准", "Approve")}
                </button>
                <button
                  className="runtime-approval-card__btn runtime-approval-card__btn--reject"
                  disabled={!canReviewApproval}
                  onClick={() => handleReviewApproval("rejected")}
                  type="button"
                >
                  {reviewingDecision === "rejected" ? tx("处理中", "Working") : tx("驳回", "Reject")}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {documentLinkForMessage(message) ? (
          <Link className="message-inline-link" href={documentLinkForMessage(message)!}>
            {tx("打开文档", "Open document")}
          </Link>
        ) : null}
        {message.attachments?.length ? <ChatAttachmentRow attachments={message.attachments} /> : null}
        {acknowledgements.length > 0 ? (
          <div
            className="inbox-bubble__ack"
            title={tx(`${acknowledgementLabel} 已 OK`, `${acknowledgementLabel} acknowledged`)}
          >
            <span aria-hidden="true">👌</span>
            {acknowledgements.length > 1 ? <small>{acknowledgements.length}</small> : null}
          </div>
        ) : null}
        {hasActions && !isPendingMessage ? (
          <div className="inbox-bubble__actions">
            {onReply ? (
              <button className="inbox-bubble__action-btn" onClick={onReply} title={tx("回复", "Reply")} type="button">
                {tx("回复", "Reply")}
              </button>
            ) : null}
            {onPin ? (
              <button className="inbox-bubble__action-btn" onClick={onPin} title={tx("置顶", "Pin")} type="button">
                {tx("置顶", "Pin")}
              </button>
            ) : null}
            {onUnpin ? (
              <button className="inbox-bubble__action-btn" onClick={onUnpin} title={tx("取消置顶", "Unpin")} type="button">
                {tx("取消置顶", "Unpin")}
              </button>
            ) : null}
            {onAcknowledge ? (
              <button
                className={`inbox-bubble__action-btn${acknowledgedByCurrentUser ? " inbox-bubble__action-btn--active" : ""}`}
                onClick={onAcknowledge}
                title={tx("OK，标记已读", "OK, mark as read")}
                type="button"
              >
                OK
              </button>
            ) : null}
          </div>
        ) : null}
      </article>
    </div>
  );

  function handleReviewApproval(decision: "approved" | "rejected"): void {
    if (!approvalAction || !onReviewApproval || reviewingDecision) {
      return;
    }
    setReviewingDecision(decision);
    void Promise.resolve(onReviewApproval(approvalAction.approvalId, decision))
      .finally(() => {
        setReviewingDecision(null);
      })
      .catch(() => {});
  }
});

function useTypewriterContent(input: {
  content: string;
  enabled: boolean;
  speedMs: number;
  step: number;
}): string {
  const { content, enabled, speedMs, step } = input;
  const [visibleLength, setVisibleLength] = useState(() => (enabled ? 0 : content.length));

  useEffect(() => {
    if (!enabled || content.length === 0) {
      setVisibleLength(content.length);
      return;
    }

    setVisibleLength((current) => Math.min(current, content.length));
    const timer = window.setInterval(() => {
      setVisibleLength((current) => {
        const next = Math.min(content.length, current + step);
        if (next >= content.length) {
          window.clearInterval(timer);
        }
        return next;
      });
    }, speedMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [content, enabled, speedMs, step]);

  return enabled ? content.slice(0, visibleLength) : content;
}

function renderMessageTimestamp(value: string): string {
  return formatCompactTimestamp(value, { emptyFallback: value });
}

function buildRuntimeApprovalAction(
  message: ConversationThreadMessage,
  tx: (zh: string, en: string) => string,
): {
  approvalId: string;
  status: "pending" | "approved" | "rejected" | "revised";
  toolName: string;
  preview: string;
  label: string;
  comment?: string;
} | null {
  if (message.code !== "approval.created" || message.data?.approval_type !== "runtime_tool") {
    return null;
  }
  const approvalId = message.data.approval_id?.trim();
  if (!approvalId) {
    return null;
  }
  const status = normalizeApprovalStatus(message.data.approval_status);
  return {
    approvalId,
    status,
    toolName: message.data.tool_name?.trim() || tx("工具调用", "Tool call"),
    preview: message.data.content_preview?.trim() || message.content,
    label: translateInlineApprovalStatus(status, tx),
    comment: message.data.reviewer_comment?.trim() || undefined,
  };
}

function normalizeApprovalStatus(value?: string): "pending" | "approved" | "rejected" | "revised" {
  if (value === "approved" || value === "rejected" || value === "revised") {
    return value;
  }
  return "pending";
}

function translateInlineApprovalStatus(
  status: "pending" | "approved" | "rejected" | "revised",
  tx: (zh: string, en: string) => string,
): string {
  if (status === "approved") {
    return tx("已批准", "Approved");
  }
  if (status === "rejected") {
    return tx("已驳回", "Rejected");
  }
  if (status === "revised") {
    return tx("已修改", "Revised");
  }
  return tx("等待审批", "Waiting for approval");
}

function processTitle(message: ConversationThreadMessage, tx: (zh: string, en: string) => string): string {
  if (message.processType === "thinking") {
    return tx("思考过程", "Thinking");
  }
  if (message.processType === "tool_use") {
    return message.tool ? `${tx("调用工具", "Tool use")} · ${message.tool}` : tx("调用工具", "Tool use");
  }
  if (message.processType === "tool_result") {
    return message.tool ? `${tx("工具结果", "Tool result")} · ${message.tool}` : tx("工具结果", "Tool result");
  }
  if (message.processType === "status") {
    return tx("状态更新", "Status update");
  }
  return message.processType ?? tx("中间过程", "Process");
}

export function ChatAttachmentRow({ attachments }: { attachments: MessageAttachment[] }) {
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind !== "image");

  return (
    <div className="chat-attachments">
      {images.length > 0 ? (
        <div className="chat-attachments__images">
          {images.map((attachment) => <AttachmentImageCard attachment={attachment} key={attachment.id} />)}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="chat-attachments__files">
          {files.map((attachment) => <AttachmentFileCard attachment={attachment} key={attachment.id} />)}
        </div>
      ) : null}
    </div>
  );
}

function AttachmentImageCard({ attachment }: { attachment: MessageAttachment }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <AttachmentFileCard attachment={attachment} />;
  }

  return (
    <a
      className="chat-attachment-image"
      href={`/api/attachments/${attachment.id}`}
      rel="noreferrer"
      target="_blank"
    >
      {!loaded ? <span aria-hidden="true" className="chat-attachment-image__loading" /> : null}
      <img
        alt={attachment.fileName}
        className={`chat-attachment-image__img${loaded ? " chat-attachment-image__img--ready" : ""}`}
        loading="lazy"
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
        src={`/api/attachments/${attachment.id}`}
      />
    </a>
  );
}

function AttachmentFileCard({ attachment }: { attachment: MessageAttachment }) {
  return (
    <a
      className="chat-attachment-file"
      href={`/api/attachments/${attachment.id}`}
      rel="noreferrer"
      target="_blank"
    >
      <span className="chat-attachment-file__icon">
        {fileIcon(attachment.mediaType, attachment.kind)}
      </span>
      <span className="chat-attachment-file__info">
        <strong>{attachment.fileName}</strong>
        <small>{formatFileSize(attachment.sizeBytes)}</small>
      </span>
    </a>
  );
}

function fileIcon(mediaType: string, kind?: MessageAttachment["kind"]): string {
  if (kind === "image") return "IMG";
  if (mediaType.startsWith("text/")) return "TXT";
  if (mediaType.includes("pdf")) return "PDF";
  if (mediaType.includes("zip") || mediaType.includes("tar") || mediaType.includes("gz")) return "ZIP";
  if (mediaType.includes("json")) return "{ }";
  return "FILE";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatComposer({
  draft,
  feedback,
  files,
  isPending,
  mentionSuggestions,
  placeholder,
  showPicker,
  pickerRef,
  mediaInputRef,
  fileInputRef,
  folderInputRef,
  textareaRef,
  onDraftChange,
  onInsertMentionTrigger,
  onTogglePicker,
  onPickedFiles,
  onRemoveFile,
  onSelectMention,
  onSubmit,
  replyToMessage,
  onCancelReply,
}: {
  draft: string;
  feedback: string | null;
  files: Array<{ id: string; label: string }>;
  isPending: boolean;
  mentionSuggestions: ConversationMentionCandidate[];
  placeholder: string;
  showPicker: boolean;
  pickerRef: React.RefObject<HTMLDivElement | null>;
  mediaInputRef: React.RefObject<HTMLInputElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onDraftChange: (value: string, caretIndex: number) => void;
  onInsertMentionTrigger: () => void;
  onTogglePicker: () => void;
  onPickedFiles: (files: FileList | null) => void;
  onRemoveFile: (id: string) => void;
  onSelectMention: (candidate: ConversationMentionCandidate) => void;
  onSubmit: () => void;
  replyToMessage?: ConversationThreadMessage | null;
  onCancelReply?: () => void;
}) {
  const { tx } = useLanguage();
  return (
    <div className="inbox-composer">
      {feedback ? <FeedbackBanner feedback={{ tone: "error", message: feedback }} /> : null}
      {replyToMessage ? (
        <div className="composer-reply-preview">
          <div className="composer-reply-preview__content">
            <strong>{translateSystemSpeaker(replyToMessage.speaker, tx)}</strong>
            <span>{replyToMessage.content.slice(0, 100)}{replyToMessage.content.length > 100 ? "..." : ""}</span>
          </div>
          {onCancelReply ? (
            <button
              aria-label={tx("取消回复", "Cancel reply")}
              className="composer-reply-preview__cancel"
              onClick={onCancelReply}
              type="button"
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="contacts-attachments">
          {files.map((item) => (
            <span className="contacts-attachment-chip" key={item.id}>
              <span>{item.label}</span>
              <button
                aria-label={tx(`移除 ${item.label}`, `Remove ${item.label}`)}
                className="contacts-attachment-remove"
                onClick={() => onRemoveFile(item.id)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

        <textarea
          className="contacts-composer__textarea"
          onChange={(event) => onDraftChange(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
          onKeyDown={(event) => {
            const nativeEvent = event.nativeEvent as KeyboardEvent;
            if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
              return;
            }

            if (event.key !== "Enter" || event.shiftKey) {
              return;
            }

            event.preventDefault();
            onSubmit();
          }}
          placeholder={placeholder}
          ref={textareaRef}
          rows={3}
          value={draft}
        />

        {mentionSuggestions.length > 0 ? (
          <div className="contacts-mention-menu">
            {mentionSuggestions.map((candidate) => (
              <button
                className="contacts-mention-item"
                key={candidate.id}
                onClick={() => onSelectMention(candidate)}
                type="button"
              >
                <div>
                  <strong>{candidate.label}</strong>
                  <span>{candidate.subtitle}</span>
                </div>
                <small>{formatMentionCandidateScope(candidate, tx)}</small>
              </button>
            ))}
          </div>
        ) : null}

        <div className="contacts-composer__footer">
          <div className="contacts-composer__tools">
            <button
              aria-label={tx("插入 @ 提及", "Insert @ mention")}
              className="contacts-tool-button"
              onClick={onInsertMentionTrigger}
              type="button"
            >
              @
            </button>
            <button
              aria-label={tx("剪贴内容（暂未启用）", "Clip content (not available yet)")}
              className="contacts-tool-button"
              type="button"
            >
              ✂
            </button>
            <div className="contacts-picker-wrap" ref={pickerRef}>
              <button
                aria-expanded={showPicker}
                aria-haspopup="menu"
                aria-label={tx("打开附件与快捷内容菜单", "Open attachments and quick content menu")}
                className="contacts-picker-trigger"
                onClick={onTogglePicker}
                type="button"
              >
                +
              </button>
              {showPicker ? (
                <div className="contacts-picker-menu" role="menu">
                  <button className="contacts-picker-item" onClick={() => mediaInputRef.current?.click()} type="button">
                    <span className="contacts-picker-item__icon">IMG</span>
                    <span>{tx("图片/视频", "Images / Videos")}</span>
                  </button>
                  <button className="contacts-picker-item" onClick={() => fileInputRef.current?.click()} type="button">
                    <span className="contacts-picker-item__icon">FILE</span>
                    <span>{tx("本地文件", "Local files")}</span>
                  </button>
                  <button className="contacts-picker-item" onClick={() => folderInputRef.current?.click()} type="button">
                    <span className="contacts-picker-item__icon">DIR</span>
                    <span>{tx("本地文件夹", "Local folder")}</span>
                  </button>
                  <button className="contacts-picker-item contacts-picker-item--disabled" disabled type="button">
                    <span className="contacts-picker-item__icon">DOC</span>
                    <span>{tx("云文档", "Cloud doc")}</span>
                  </button>
                  <button className="contacts-picker-item contacts-picker-item--disabled" disabled type="button">
                    <span className="contacts-picker-item__icon">CAL</span>
                    <span>{tx("日程", "Calendar")}</span>
                  </button>
                  <button className="contacts-picker-item contacts-picker-item--disabled" disabled type="button">
                    <span className="contacts-picker-item__icon">CARD</span>
                    <span>{tx("个人名片", "Contact card")}</span>
                  </button>
                  <button className="contacts-picker-item contacts-picker-item--disabled" disabled type="button">
                    <span className="contacts-picker-item__icon">TASK</span>
                    <span>{tx("任务", "Task")}</span>
                  </button>
                  <button className="contacts-picker-item contacts-picker-item--disabled" disabled type="button">
                    <span className="contacts-picker-item__icon">A↔</span>
                    <span>{tx("开启边写边译", "Translate while typing")}</span>
                  </button>
                  <div className="contacts-picker-divider" />
                  <button className="contacts-picker-item contacts-picker-item--disabled" disabled type="button">
                    <span className="contacts-picker-item__icon">APP</span>
                    <span>{tx("快捷应用", "Quick apps")}</span>
                  </button>
                </div>
              ) : null}
              <input
                accept="image/*,video/*"
                hidden
                multiple
                onChange={(event) => onPickedFiles(event.currentTarget.files)}
                ref={mediaInputRef}
                type="file"
              />
              <input
                hidden
                multiple
                onChange={(event) => onPickedFiles(event.currentTarget.files)}
                ref={fileInputRef}
                type="file"
              />
              <input
                hidden
                multiple
                onChange={(event) => onPickedFiles(event.currentTarget.files)}
                ref={folderInputRef}
                // @ts-expect-error webkitdirectory is not in React typings
                webkitdirectory=""
                type="file"
              />
            </div>
          </div>

          <button
            aria-label={tx("发送消息", "Send message")}
            className="contacts-send-button"
            disabled={isPending || (draft.trim().length === 0 && files.length === 0)}
            onClick={onSubmit}
            type="button"
          >
            {isPending ? "…" : "➤"}
          </button>
        </div>
    </div>
  );
}

export function ChatEmptyState({ title, body }: { title: string; body: string }) {
  return <EmptyState body={body} title={title} />;
}

function renderMessageContent(content: string, mentions: MessageMention[] | undefined): React.ReactNode {
  if (!mentions || mentions.length === 0) {
    return content;
  }

  const orderedMentions = [...mentions].sort((left, right) => right.token.length - left.token.length);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  const lowerContent = content.toLocaleLowerCase("zh-CN");

  while (cursor < content.length) {
    let nextMatch:
      | {
          mention: MessageMention;
          index: number;
        }
      | undefined;

    for (const mention of orderedMentions) {
      const needle = `@${mention.token}`.toLocaleLowerCase("zh-CN");
      const index = lowerContent.indexOf(needle, cursor);
      if (index < 0) {
        continue;
      }
      if (!nextMatch || index < nextMatch.index || (index === nextMatch.index && mention.token.length > nextMatch.mention.token.length)) {
        nextMatch = { mention, index };
      }
    }

    if (!nextMatch) {
      nodes.push(content.slice(cursor));
      break;
    }

    if (nextMatch.index > cursor) {
      nodes.push(content.slice(cursor, nextMatch.index));
    }

    nodes.push(
      <span
        className="message-mention"
        data-mention-type={nextMatch.mention.mentionType}
        key={`${getMentionKey(nextMatch.mention)}-${nextMatch.index}`}
        title={formatMentionTitle(nextMatch.mention)}
      >
        {content.slice(nextMatch.index, nextMatch.index + nextMatch.mention.token.length + 1)}
      </span>,
    );
    cursor = nextMatch.index + nextMatch.mention.token.length + 1;
  }

  return <>{nodes}</>;
}

function formatMentionCandidateScope(
  candidate: ConversationMentionCandidate,
  tx: (zh: string, en: string) => string,
): string {
  if (candidate.kind === "human") {
    return candidate.inChannel ? tx("群成员", "Member") : tx("其他成员", "Other member");
  }
  return candidate.inChannel ? tx("Agent", "Agent") : tx("其他 Agent", "Other agent");
}

function getMentionKey(mention: MessageMention): string {
  return mention.mentionType === "human" ? mention.humanId : mention.agentId;
}

function formatMentionTitle(mention: MessageMention): string {
  return mention.mentionType === "human"
    ? `Human mention: ${mention.label}`
    : `Agent mention: ${mention.label}`;
}

function documentLinkForMessage(message: ConversationThreadMessage): string | null {
  const documentId = message.data?.document_id;
  const channelName = message.data?.channel_name;
  if (!documentId || !channelName) {
    return null;
  }
  if (
    message.code !== "channel_document.created_notice" &&
    message.code !== "channel_document.updated_notice" &&
    message.code !== "channel_document.archived_notice"
  ) {
    return null;
  }
  return `/im?focus=${encodeURIComponent(`channel:${channelName}`)}&doc=${encodeURIComponent(documentId)}`;
}
