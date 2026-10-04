"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChatComposer, ChatEmptyState, ChatHeader, ConversationListRow, ConversationMessageBubble } from "@/features/chat/chat-primitives";
import type { MessageAcknowledgement, MessageAttachment, MessageMention } from "@/shared/types/workspace";
import { applyMentionSelection, findDraftMentionQuery } from "@agent-space/domain";
import { useLanguage } from "@/features/i18n/language-provider";
import { translateSystemSpeaker } from "@/features/i18n/presentation";
import { AppIcon } from "@/shared/ui/app-icon";
import { useDialogSurface } from "@/shared/lib/use-dialog-surface";
import { useResizablePane } from "@/shared/lib/use-resizable-pane";
import { PaneResizeHandle } from "@/shared/ui/pane-resize-handle";
import type { GeneratedAvatarVariant } from "@/shared/ui/generated-avatar";

export interface ConversationListItem {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  avatar: string;
  avatarId?: string;
  avatarName?: string;
  avatarVariant?: GeneratedAvatarVariant;
  dateLabel?: string;
  unread?: boolean;
}

export interface ConversationThreadMessage {
  id: string;
  speaker: string;
  role: "human" | "agent";
  content: string;
  code?: string;
  data?: Record<string, string>;
  timestamp: string;
  status: "pending" | "completed" | "error";
  attachments?: MessageAttachment[];
  mentions?: MessageMention[];
  acknowledgements?: MessageAcknowledgement[];
  kind?: "message" | "process";
  processType?: string;
  tool?: string;
  pinned?: boolean;
  pinnedAt?: string;
  replyToMessageId?: string;
}

export interface ConversationMentionCandidate {
  id: string;
  label: string;
  subtitle: string;
  inChannel: boolean;
  kind?: "agent" | "human";
}

type PendingFile = {
  id: string;
  file: File;
  label: string;
};

export function ConversationShell({
  listKicker,
  listTitle,
  listCount,
  items,
  selectedItemId,
  onSelectItem,
  selectedHeader,
  messages,
  emptyListTitle,
  emptyListBody,
  emptyThreadTitle,
  emptyThreadBody,
  placeholder,
  onSubmit,
  headerActions,
  listActions,
  shellClassName = "",
  customThreadHeader,
  customThreadContent,
  mentionCandidates = [],
  supplementaryPanel,
  supplementaryPanelTitle,
  onCloseSupplementaryPanel,
  onPinMessage,
  onUnpinMessage,
  onAcknowledgeMessage,
  onReviewApproval,
  currentUserDisplayName,
  draftStorageKey,
  scrollAnchorStorageKey,
  onDataChanged,
}: {
  listKicker: string;
  listTitle: string;
  listCount: number;
  items: ConversationListItem[];
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  selectedHeader:
    | {
        title: string;
        subtitle: string;
        avatar: string;
        avatarId?: string;
        avatarName?: string;
        avatarVariant?: GeneratedAvatarVariant;
      }
    | null;
  messages: ConversationThreadMessage[];
  emptyListTitle: string;
  emptyListBody: string;
  emptyThreadTitle: string;
  emptyThreadBody: string;
  placeholder: string;
  onSubmit: (input: { content: string; files: File[]; replyToMessageId?: string }) => Promise<void>;
  headerActions?: React.ReactNode;
  listActions?: React.ReactNode;
  shellClassName?: string;
  customThreadHeader?: (input: { backButton: React.ReactNode | null }) => React.ReactNode;
  customThreadContent?: React.ReactNode;
  mentionCandidates?: ConversationMentionCandidate[];
  supplementaryPanel?: React.ReactNode;
  supplementaryPanelTitle?: string;
  onCloseSupplementaryPanel?: () => void;
  onPinMessage?: (messageId: string) => void;
  onUnpinMessage?: (messageId: string) => void;
  onAcknowledgeMessage?: (messageId: string) => void;
  onReviewApproval?: (approvalId: string, decision: "approved" | "rejected") => Promise<void> | void;
  currentUserDisplayName?: string;
  draftStorageKey?: string;
  scrollAnchorStorageKey?: string;
  onDataChanged?: () => void;
}) {
  const { tx } = useLanguage();
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [draftCaretIndex, setDraftCaretIndex] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [replyToMessage, setReplyToMessage] = useState<ConversationThreadMessage | null>(null);
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const listPaneResize = useResizablePane({
    defaultWidth: 340,
    maxWidth: 560,
    minWidth: 300,
    storageKey: "agent-space.conversation-list-width",
  });
  const threadViewportRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const previousSelectedIdRef = useRef<string | null>(null);
  const threadViewportVisibleRef = useRef(false);
  const scrollAnchorsRef = useRef<Record<string, ConversationScrollAnchor>>({});
  const initialDraftHydratedRef = useRef(false);
  const hasCustomThreadContent = customThreadContent !== undefined && customThreadContent !== null;

  useEffect(() => {
    if (!draftStorageKey || initialDraftHydratedRef.current || typeof window === "undefined") {
      return;
    }
    initialDraftHydratedRef.current = true;
    const raw = window.sessionStorage.getItem(draftStorageKey);
    if (!raw) {
      return;
    }
    try {
      const saved = JSON.parse(raw) as { draft?: unknown; draftCaretIndex?: unknown };
      if (typeof saved.draft === "string") {
        setDraft(saved.draft);
        setDraftCaretIndex(
          typeof saved.draftCaretIndex === "number"
            ? saved.draftCaretIndex
            : saved.draft.length,
        );
      }
    } catch {
      window.sessionStorage.removeItem(draftStorageKey);
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || !initialDraftHydratedRef.current || typeof window === "undefined") {
      return;
    }
    if (!draft && pendingFiles.length === 0 && !replyToMessage) {
      window.sessionStorage.removeItem(draftStorageKey);
      return;
    }
    window.sessionStorage.setItem(
      draftStorageKey,
      JSON.stringify({
        draft,
        draftCaretIndex,
      }),
    );
  }, [draft, draftCaretIndex, draftStorageKey, pendingFiles.length, replyToMessage]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 860px)");
    const handleChange = (event?: MediaQueryListEvent): void => {
      setIsCompactLayout(event ? event.matches : mediaQuery.matches);
    };

    handleChange();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent): void {
      if (!pickerRef.current) {
        return;
      }
      if (!pickerRef.current.contains(event.target as Node)) {
        setShowPicker(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useLayoutEffect(() => {
    scrollAnchorsRef.current = readConversationScrollAnchors(scrollAnchorStorageKey);
  }, [scrollAnchorStorageKey]);

  const saveThreadScrollAnchor = useCallback(
    (threadId: string | null) => {
      if (!threadId || !scrollAnchorStorageKey) {
        return;
      }

      const viewport = threadViewportRef.current;
      if (!viewport) {
        return;
      }

      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      const anchor = buildConversationScrollAnchor(viewport, distanceFromBottom < 64);
      scrollAnchorsRef.current = pruneConversationScrollAnchors({
        ...scrollAnchorsRef.current,
        [threadId]: anchor,
      });
      writeConversationScrollAnchors(scrollAnchorStorageKey, scrollAnchorsRef.current);
    },
    [scrollAnchorStorageKey],
  );

  useLayoutEffect(() => {
    return () => {
      saveThreadScrollAnchor(selectedItemId);
      threadViewportVisibleRef.current = false;
    };
  }, [hasCustomThreadContent, saveThreadScrollAnchor, selectedItemId]);

  useLayoutEffect(() => {
    const viewport = threadViewportRef.current;
    if (!viewport) {
      threadViewportVisibleRef.current = false;
      return;
    }

    const switchedConversation = previousSelectedIdRef.current !== selectedItemId;
    previousSelectedIdRef.current = selectedItemId;
    const threadBecameVisible = !threadViewportVisibleRef.current;
    threadViewportVisibleRef.current = true;
    const savedAnchor = selectedItemId ? scrollAnchorsRef.current[selectedItemId] : undefined;

    if ((switchedConversation || threadBecameVisible) && restoreConversationScrollAnchor(viewport, savedAnchor)) {
      shouldStickToBottomRef.current = savedAnchor?.stickToBottom ?? true;
      return;
    }
    if (switchedConversation || isPending || shouldStickToBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [hasCustomThreadContent, isPending, messages, selectedItemId]);

  useEffect(() => {
    if (!isCompactLayout) {
      setMobilePane("list");
      return;
    }

    setMobilePane(selectedHeader ? "thread" : "list");
  }, [isCompactLayout, selectedItemId, Boolean(selectedHeader)]);

  useEffect(() => {
    if (!isCompactLayout || !supplementaryPanel || !onCloseSupplementaryPanel) {
      return;
    }

    const closeSupplementaryPanel = onCloseSupplementaryPanel;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeSupplementaryPanel();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isCompactLayout, onCloseSupplementaryPanel, supplementaryPanel]);

  const activeMentionQuery = findDraftMentionQuery(draft, draftCaretIndex);
  const mentionSuggestions = useMemo(
    () =>
      activeMentionQuery
        ? mentionCandidates
            .filter((candidate) => {
              const query = activeMentionQuery.query.trim();
              if (!query) {
                return true;
              }
              return (
                candidate.label.toLocaleLowerCase("zh-CN").includes(query.toLocaleLowerCase("zh-CN")) ||
                candidate.subtitle.toLocaleLowerCase("zh-CN").includes(query.toLocaleLowerCase("zh-CN"))
              );
            })
            .sort((left, right) => {
              if (left.inChannel !== right.inChannel) {
                return left.inChannel ? -1 : 1;
              }
              return left.label.localeCompare(right.label, "zh-CN", { sensitivity: "base" });
            })
        : [],
    [activeMentionQuery, mentionCandidates],
  );

  const handleSelectListItem = useCallback(
    (id: string) => {
      saveThreadScrollAnchor(selectedItemId);
      onSelectItem(id);
      if (isCompactLayout) {
        setMobilePane("thread");
      }
    },
    [isCompactLayout, onSelectItem, saveThreadScrollAnchor, selectedItemId],
  );

  function handleThreadScroll(): void {
    const viewport = threadViewportRef.current;
    if (!viewport) {
      return;
    }

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 64;
    if (selectedItemId && scrollAnchorStorageKey) {
      scrollAnchorsRef.current = pruneConversationScrollAnchors({
        ...scrollAnchorsRef.current,
        [selectedItemId]: buildConversationScrollAnchor(viewport, shouldStickToBottomRef.current),
      });
    }
  }

  function handlePickedFiles(files: FileList | null): void {
    if (!files || files.length === 0) {
      return;
    }

    const next = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      label:
        typeof (file as File & { webkitRelativePath?: string }).webkitRelativePath === "string" &&
        (file as File & { webkitRelativePath?: string }).webkitRelativePath
          ? (file as File & { webkitRelativePath?: string }).webkitRelativePath!
          : file.name,
    }));

    setPendingFiles((current) => [...current, ...next]);
    setShowPicker(false);
  }

  function submitMessage(): void {
    if (isPending || !selectedHeader || (draft.trim().length === 0 && pendingFiles.length === 0)) {
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      try {
        await onSubmit({
          content: draft.trim().length > 0 ? draft : tx("请查看我发送的附件。", "Please review the attachment I sent."),
          files: pendingFiles.map((item) => item.file),
          replyToMessageId: replyToMessage?.id,
        });
        shouldStickToBottomRef.current = true;
        setDraft("");
        setDraftCaretIndex(0);
        setPendingFiles([]);
        setShowPicker(false);
        setReplyToMessage(null);
        if (onDataChanged) {
          onDataChanged();
        } else {
          router.refresh();
        }
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : tx("发送失败，请稍后重试。", "Send failed. Please try again."));
      }
    });
  }

  function handleDraftChange(nextDraft: string, caretIndex: number): void {
    setDraft(nextDraft);
    setDraftCaretIndex(caretIndex);
  }

  function handleInsertMentionTrigger(): void {
    if (!selectedHeader) {
      return;
    }
    if (mentionCandidates.length === 0) {
      setFeedback(tx("当前没有可 @ 的成员或 Agent。", "There are no members or agents available to mention."));
      return;
    }

    const target = textareaRef.current;
    const currentCaretIndex = target?.selectionStart ?? draftCaretIndex;
    const nextDraft = `${draft.slice(0, currentCaretIndex)}@${draft.slice(currentCaretIndex)}`;
    const nextCaretIndex = currentCaretIndex + 1;
    setDraft(nextDraft);
    setDraftCaretIndex(nextCaretIndex);
    setFeedback(null);

    window.requestAnimationFrame(() => {
      if (!target) {
        return;
      }
      target.focus();
      target.setSelectionRange(nextCaretIndex, nextCaretIndex);
    });
  }

  function handleSelectMention(candidate: ConversationMentionCandidate): void {
    const next = applyMentionSelection(draft, draftCaretIndex, candidate.label);
    setDraft(next.value);
    setDraftCaretIndex(next.caretIndex);
    setFeedback(null);

    window.requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) {
        return;
      }
      target.focus();
      target.setSelectionRange(next.caretIndex, next.caretIndex);
    });
  }

  function handleReplyToMessage(message: ConversationThreadMessage): void {
    setReplyToMessage(message);

    const replyMention = buildReplyMentionPrefix(message);
    if (!replyMention) {
      textareaRef.current?.focus();
      return;
    }

    const nextDraft = draft.startsWith(replyMention)
      ? draft
      : draft.trim().length > 0
        ? `${replyMention}${draft}`
        : replyMention;
    setDraft(nextDraft);
    setDraftCaretIndex(nextDraft.length);

    window.requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) {
        return;
      }
      target.focus();
      target.setSelectionRange(nextDraft.length, nextDraft.length);
    });
  }

  const pinnedMessages = useMemo(() => messages.filter((m) => m.pinned), [messages]);
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const showListPane = !isCompactLayout || !selectedHeader || mobilePane === "list";
  const showThreadPane = !isCompactLayout || (Boolean(selectedHeader) && mobilePane === "thread");
  const showSupplementarySheet = Boolean(supplementaryPanel) && isCompactLayout;
  const showDesktopSupplementaryPane = Boolean(supplementaryPanel) && !isCompactLayout;
  const supplementaryTitle = supplementaryPanelTitle ?? tx("附加面板", "Supplementary panel");
  const {
    surfaceRef: supplementarySheetRef,
    handleBackdropMouseDown: handleSupplementarySheetBackdropMouseDown,
    labelId: supplementarySheetLabelId,
  } = useDialogSurface<HTMLDivElement>(onCloseSupplementaryPanel ?? (() => {}));

  return (
    <section
      className={`contacts-shell${shellClassName ? ` ${shellClassName}` : ""}${isCompactLayout ? " contacts-shell--compact" : ""}${showDesktopSupplementaryPane ? " contacts-shell--with-panel" : ""}`}
      style={listPaneResize.paneStyle}
    >
      {showListPane ? (
        <aside className="contacts-list-pane">
          <div className="contacts-list-pane__header">
            <div>
              {listKicker && listKicker !== listTitle ? (
                <p className="page-eyebrow">{listKicker}</p>
              ) : null}
              <h2>{listTitle}</h2>
            </div>
            <div className="contacts-list-pane__header-actions">
              <span className="panel-note">{listCount}</span>
              {listActions}
            </div>
          </div>

          <div className="contacts-list">
            {items.length > 0 ? (
              items.map((item) => (
                <ConversationListRow
                  item={item}
                  key={item.id}
                  onSelect={handleSelectListItem}
                  selected={selectedItemId === item.id}
                />
              ))
            ) : (
              <ChatEmptyState body={emptyListBody} title={emptyListTitle} />
            )}
          </div>
        </aside>
      ) : null}

      {!isCompactLayout && showListPane && showThreadPane ? (
        <PaneResizeHandle
          label={tx("调整会话列表宽度", "Resize conversation list")}
          maxValue={listPaneResize.maxWidth}
          minValue={listPaneResize.minWidth}
          onKeyDown={listPaneResize.onHandleKeyDown}
          onPointerDown={listPaneResize.onHandlePointerDown}
          value={listPaneResize.width}
        />
      ) : null}

      {showThreadPane ? (
        <section className="contacts-chat-pane">
          {selectedHeader ? (
            <>
              {customThreadHeader?.({
                backButton: isCompactLayout ? (
                  <button
                    aria-label={tx("返回列表", "Back to list")}
                    className="contacts-chat-header__back"
                    onClick={() => setMobilePane("list")}
                    type="button"
                  >
                    <AppIcon name="arrowLeft" />
                  </button>
                ) : null,
              }) ?? (
                <ChatHeader
                  actions={headerActions}
                  avatar={selectedHeader.avatar}
                  avatarId={selectedHeader.avatarId}
                  avatarName={selectedHeader.avatarName}
                  avatarVariant={selectedHeader.avatarVariant}
                  leadingAction={
                    isCompactLayout ? (
                      <button
                        aria-label={tx("返回列表", "Back to list")}
                        className="contacts-chat-header__back"
                        onClick={() => setMobilePane("list")}
                        type="button"
                      >
                        <AppIcon name="arrowLeft" />
                      </button>
                    ) : undefined
                  }
                  subtitle={selectedHeader.subtitle}
                  title={selectedHeader.title}
                />
              )}

              {customThreadContent ?? (
                <>
                  {pinnedMessages.length > 0 ? (
                    <div className="pinned-messages-bar">
                      <strong>{tx("置顶消息", "Pinned")}</strong>
                      <div className="pinned-messages-bar__list">
                        {pinnedMessages.slice(0, 3).map((m) => (
                          <div className="pinned-messages-bar__item" key={m.id}>
                            <span className="pinned-messages-bar__speaker">{translateSystemSpeaker(m.speaker, tx)}:</span>
                            <span className="pinned-messages-bar__text">
                              {m.content.slice(0, 60)}
                              {m.content.length > 60 ? "..." : ""}
                            </span>
                            {onUnpinMessage ? (
                              <button
                                className="pinned-messages-bar__unpin"
                                onClick={() => onUnpinMessage(m.id)}
                                title={tx("取消置顶", "Unpin")}
                                type="button"
                              >
                                <AppIcon name="close" />
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="contacts-chat-thread" onScroll={handleThreadScroll} ref={threadViewportRef}>
                    {messages.length > 0 ? (
                      messages.map((message) => (
                        <ConversationMessageBubble
                          isOwn={isOwnHumanMessage(message, currentUserDisplayName)}
                          key={message.id}
                          message={message}
                          acknowledgementActorLabel={currentUserDisplayName}
                          replyToMessage={message.replyToMessageId ? messageById.get(message.replyToMessageId) : undefined}
                          onReply={() => handleReplyToMessage(message)}
                          onPin={onPinMessage && !message.pinned ? () => onPinMessage(message.id) : undefined}
                          onUnpin={onUnpinMessage && message.pinned ? () => onUnpinMessage(message.id) : undefined}
                          onAcknowledge={onAcknowledgeMessage ? () => onAcknowledgeMessage(message.id) : undefined}
                          onReviewApproval={onReviewApproval}
                        />
                      ))
                    ) : (
                      <ChatEmptyState body={emptyThreadBody} title={emptyThreadTitle} />
                    )}
                  </div>

                  <ChatComposer
                    draft={draft}
                    feedback={feedback}
                    fileInputRef={fileInputRef}
                    files={pendingFiles.map((item) => ({ id: item.id, label: item.label }))}
                    folderInputRef={folderInputRef}
                    isPending={isPending}
                    mediaInputRef={mediaInputRef}
                    mentionSuggestions={mentionSuggestions}
                    onDraftChange={handleDraftChange}
                    onInsertMentionTrigger={handleInsertMentionTrigger}
                    onPickedFiles={handlePickedFiles}
                    onRemoveFile={(id) => setPendingFiles((current) => current.filter((entry) => entry.id !== id))}
                    onSelectMention={handleSelectMention}
                    onSubmit={submitMessage}
                    onTogglePicker={() => setShowPicker((value) => !value)}
                    pickerRef={pickerRef}
                    placeholder={placeholder}
                    replyToMessage={replyToMessage}
                    onCancelReply={() => setReplyToMessage(null)}
                    showPicker={showPicker}
                    textareaRef={textareaRef}
                  />
                </>
              )}
            </>
          ) : (
            <ChatEmptyState body={emptyThreadBody} title={emptyThreadTitle} />
          )}
        </section>
      ) : null}

      {showDesktopSupplementaryPane ? (
        <aside className="contacts-supplementary-pane">
          <div className="contacts-supplementary-pane__header">
            <div>
              <h3>{supplementaryTitle}</h3>
            </div>
            {onCloseSupplementaryPanel ? (
              <button
                aria-label={tx("关闭面板", "Close panel")}
                className="contacts-supplementary-pane__close"
                onClick={onCloseSupplementaryPanel}
                type="button"
              >
                <AppIcon name="close" />
              </button>
            ) : null}
          </div>
          <div className="contacts-supplementary-pane__content">{supplementaryPanel}</div>
        </aside>
      ) : null}

      {showSupplementarySheet ? (
        <div
          aria-labelledby={supplementarySheetLabelId}
          aria-modal="true"
          className="contacts-supplementary-sheet"
          onMouseDown={handleSupplementarySheetBackdropMouseDown}
          role="dialog"
        >
          {onCloseSupplementaryPanel ? (
            <button
              aria-label={tx("关闭面板", "Close panel")}
              className="contacts-supplementary-sheet__backdrop"
              onClick={onCloseSupplementaryPanel}
              type="button"
            />
          ) : (
            <div aria-hidden="true" className="contacts-supplementary-sheet__backdrop" />
          )}
          <div className="contacts-supplementary-sheet__panel" ref={supplementarySheetRef} tabIndex={-1}>
            <div className="contacts-supplementary-sheet__handle" />
            <div className="contacts-supplementary-sheet__header">
              <div>
                <h3 id={supplementarySheetLabelId}>{supplementaryTitle}</h3>
              </div>
              {onCloseSupplementaryPanel ? (
                <button
                  aria-label={tx("关闭面板", "Close panel")}
                  className="contacts-supplementary-sheet__close"
                  onClick={onCloseSupplementaryPanel}
                  type="button"
                >
                  <AppIcon name="close" />
                </button>
              ) : null}
            </div>
            <div className="contacts-supplementary-sheet__content">{supplementaryPanel}</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

interface ConversationScrollAnchor {
  messageId?: string;
  messageOffsetTop?: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  distanceFromBottom: number;
  stickToBottom: boolean;
  updatedAt: number;
}

const CONVERSATION_SCROLL_ANCHOR_LIMIT = 40;

function buildConversationScrollAnchor(
  viewport: HTMLDivElement,
  stickToBottom: boolean,
): ConversationScrollAnchor {
  const firstVisibleMessage = findFirstVisibleConversationMessage(viewport);
  return {
    messageId: firstVisibleMessage?.messageId,
    messageOffsetTop: firstVisibleMessage?.offsetTop,
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
    clientHeight: viewport.clientHeight,
    distanceFromBottom: Math.max(0, viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight),
    stickToBottom,
    updatedAt: Date.now(),
  };
}

function restoreConversationScrollAnchor(
  viewport: HTMLDivElement,
  anchor: ConversationScrollAnchor | undefined,
): boolean {
  if (!anchor) {
    return false;
  }

  if (anchor.stickToBottom) {
    viewport.scrollTop = viewport.scrollHeight;
    return true;
  }

  if (anchor.messageId && typeof anchor.messageOffsetTop === "number") {
    const anchoredMessage = Array.from(
      viewport.querySelectorAll<HTMLElement>("[data-conversation-message-id]"),
    ).find((element) => element.dataset.conversationMessageId === anchor.messageId);
    if (
      anchoredMessage &&
      (anchoredMessage.offsetTop > 0 || anchoredMessage.offsetHeight > 0)
    ) {
      viewport.scrollTop = Math.max(0, anchoredMessage.offsetTop - anchor.messageOffsetTop);
      return true;
    }
  }

  if (viewport.scrollHeight > viewport.clientHeight) {
    viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight - anchor.distanceFromBottom);
    return true;
  }

  viewport.scrollTop = anchor.scrollTop;
  return true;
}

function findFirstVisibleConversationMessage(
  viewport: HTMLDivElement,
): { messageId: string; offsetTop: number } | null {
  for (const element of viewport.querySelectorAll<HTMLElement>("[data-conversation-message-id]")) {
    if (element.offsetTop === 0 && element.offsetHeight === 0) {
      continue;
    }
    if (element.offsetTop + element.offsetHeight >= viewport.scrollTop) {
      return {
        messageId: element.dataset.conversationMessageId ?? "",
        offsetTop: element.offsetTop - viewport.scrollTop,
      };
    }
  }
  return null;
}

function readConversationScrollAnchors(storageKey?: string): Record<string, ConversationScrollAnchor> {
  if (!storageKey || typeof window === "undefined") {
    return {};
  }
  const raw = window.sessionStorage.getItem(storageKey);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const anchors: Record<string, ConversationScrollAnchor> = {};
    for (const [threadId, value] of Object.entries(parsed)) {
      if (isConversationScrollAnchor(value)) {
        anchors[threadId] = value;
      }
    }
    return pruneConversationScrollAnchors(anchors);
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return {};
  }
}

function writeConversationScrollAnchors(
  storageKey: string,
  anchors: Record<string, ConversationScrollAnchor>,
): void {
  if (typeof window === "undefined") {
    return;
  }
  if (Object.keys(anchors).length === 0) {
    window.sessionStorage.removeItem(storageKey);
    return;
  }
  window.sessionStorage.setItem(storageKey, JSON.stringify(anchors));
}

function pruneConversationScrollAnchors(
  anchors: Record<string, ConversationScrollAnchor>,
): Record<string, ConversationScrollAnchor> {
  const entries = Object.entries(anchors)
    .filter(([, anchor]) => isConversationScrollAnchor(anchor))
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, CONVERSATION_SCROLL_ANCHOR_LIMIT);
  return Object.fromEntries(entries);
}

function isConversationScrollAnchor(value: unknown): value is ConversationScrollAnchor {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ConversationScrollAnchor>;
  return (
    typeof candidate.scrollTop === "number" &&
    typeof candidate.scrollHeight === "number" &&
    typeof candidate.clientHeight === "number" &&
    typeof candidate.distanceFromBottom === "number" &&
    typeof candidate.stickToBottom === "boolean" &&
    typeof candidate.updatedAt === "number"
  );
}

function isOwnHumanMessage(
  message: ConversationThreadMessage,
  currentUserDisplayName?: string,
): boolean {
  if (message.role !== "human") {
    return false;
  }
  const normalizedCurrentUser = currentUserDisplayName?.trim();
  if (!normalizedCurrentUser) {
    return true;
  }
  const speaker = message.speaker.trim();
  return (
    speaker.localeCompare(normalizedCurrentUser, "zh-CN", { sensitivity: "base" }) === 0 ||
    speaker === "你" ||
    speaker.localeCompare("You", "en-US", { sensitivity: "base" }) === 0
  );
}

function buildReplyMentionPrefix(
  message: ConversationThreadMessage,
): string | null {
  if (message.role !== "agent") {
    return null;
  }

  const trimmed = message.speaker.trim();
  if (!trimmed) {
    return null;
  }
  return `@${trimmed} `;
}
