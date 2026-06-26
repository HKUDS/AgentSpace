"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  addWorkspaceMembersToChannelAction,
  addChannelDocumentCollaboratorAction,
  archiveChannelDocumentAction,
  createGoogleSheetDocumentAction,
  createExternalGoogleSheetDocumentAction,
  disconnectGoogleWorkspaceAction,
  createChannelDocumentFromAttachmentAction,
  getChannelDetailDataAction,
  deleteChannelAttachmentAction,
  deleteChannelAction,
  exportChannelDocumentAttachmentAction,
  pinMessageAction,
  requestChannelAccessAction,
  unpinMessageAction,
  removeChannelDocumentCollaboratorAction,
  renameChannelAction,
  reviewInlineApprovalAction,
  resolveChannelDocumentConflictAction,
  restoreChannelDocumentAction,
  retryChannelDocumentConflictAction,
  refreshExternalGoogleSheetDocumentAction,
  syncExternalGoogleSheetPermissionsAction,
  touchChannelDocumentPresenceAction,
  updateDigitalContactRemarkAction,
  updateChannelDocumentAccessRoleAction,
  rollbackChannelDocumentVersionAction,
  saveChannelDocumentAction,
  sendContactMessageAction,
  sendChannelMessageAction,
  acknowledgeMessageAction,
} from "@/features/channels/actions";
import {
  ConversationShell,
  type ConversationListItem,
  type ConversationMentionCandidate,
  type ConversationThreadMessage,
} from "@/features/chat/conversation-shell";
import type { ChannelsPageData } from "@/features/dashboard/data";
import { refreshWorkspaceModule } from "@/features/dashboard/workspace-module-refresh";
import { useWorkspaceModuleNavigation } from "@/features/dashboard/workspace-module-navigation";
import type { WorkspaceInvalidationEvent } from "@/features/dashboard/workspace-invalidation";
import {
  scopeWorkspaceModuleCacheKey,
  useOptionalWorkspaceModuleCache,
  useWorkspaceModuleCacheRevision,
  useWorkspaceModuleCacheScope,
} from "@/features/dashboard/workspace-module-cache";
import { ChannelDocumentsPanel } from "@/features/channels/channel-documents-panel";
import { buildWorkspacePath, parseWorkspacePathname } from "@/features/auth/workspace-paths";
import { FeishuChannelSummaryPanel } from "@/features/integrations/feishu/feishu-channel-summary-panel";
import { useLanguage } from "@/features/i18n/language-provider";
import { HoverTooltip } from "@/shared/ui/hover-tooltip";
import { useDialogSurface } from "@/shared/lib/use-dialog-surface";
import { isDocumentInputActive } from "@/shared/lib/use-auto-refresh";
import { AppIcon } from "@/shared/ui/app-icon";
import { EmptyState } from "@/shared/ui/empty-state";
import { GeneratedAvatar } from "@/shared/ui/generated-avatar";
import { useFeedbackToast } from "@/shared/ui/feedback-toast-provider";
import { runToastAction } from "@/shared/lib/toast-action";
import { formatCompactTimestamp } from "@/shared/lib/time-format";
import {
  translateMemberLabel,
  translateSystemSpeaker,
  translateWorkspaceMessageSummary,
} from "@/features/i18n/presentation";

interface RecoverableDocumentDraft {
  documentId: string;
  title: string;
  summary: string;
  content: string;
}

type ChannelWorkspaceTab = "messages" | "files" | "documents";
type ChannelDocumentsView = "list" | "workspace";
type ChannelDocumentCreateMode = "markdown" | "nativeSheet" | "nativeDeck" | "googleSheet" | "googleSheetCreate";

const CHANNEL_REFRESH_POLL_MS = 2000;
const CHANNEL_REALTIME_REFRESH_DEBOUNCE_MS = 350;
const IM_PERFORMANCE_MARK_PREFIX = "agent-space.im";

type ChannelRecord = ChannelsPageData["channels"][number];
type ChannelDocumentRecord = ChannelsPageData["documents"][number];
type ChannelFileRecord = ChannelsPageData["channelFiles"][number];
type ChannelDocumentRunRecord = ChannelsPageData["documentRuns"][number];
type ChannelDocumentConflictRecord = ChannelsPageData["documentConflicts"][number];
type ChannelDetailData = Pick<ChannelsPageData, "channelFiles" | "detailScope" | "documentConflicts" | "documentRuns" | "documents" | "threads">;

interface ChannelPageIndexes {
  channelById: Map<string, ChannelRecord>;
  channelByFocusKey: Map<string, ChannelRecord>;
  threadByChannelName: Map<string, ChannelsPageData["threads"][number]>;
  documentsByChannelName: Map<string, ChannelDocumentRecord[]>;
  archivedDocumentsByChannelName: Map<string, ChannelDocumentRecord[]>;
  documentById: Map<string, ChannelDocumentRecord>;
  filesByChannelName: Map<string, ChannelFileRecord[]>;
  conflictById: Map<string, ChannelDocumentConflictRecord>;
  openConflictsByDocumentId: Map<string, ChannelDocumentConflictRecord[]>;
  runsByChannelName: Map<string, ChannelDocumentRunRecord[]>;
  mentionCandidatesByChannelName: Map<string, ChannelsPageData["mentionCandidates"]>;
  loadedDetailChannelNames: Set<string>;
}

interface ChannelRouteState {
  focus: string | null;
  tab: ChannelWorkspaceTab | null;
  documentId: string | null;
  conversationView: "all" | "direct";
}

interface ChannelRouteUpdateOptions {
  documentId?: string | null;
  tab?: ChannelWorkspaceTab;
}

const EMPTY_CHANNEL_DOCUMENTS: ChannelDocumentRecord[] = [];
const EMPTY_ARCHIVED_CHANNEL_DOCUMENTS: ChannelDocumentRecord[] = [];
const EMPTY_CHANNEL_FILES: ChannelFileRecord[] = [];
const EMPTY_DOCUMENT_CONFLICTS: ChannelDocumentConflictRecord[] = [];
const EMPTY_DOCUMENT_RUNS: ChannelDocumentRunRecord[] = [];
const EMPTY_MENTION_CANDIDATES: ChannelsPageData["mentionCandidates"] = [];

function buildChannelsPageIndexes(data: ChannelsPageData): ChannelPageIndexes {
  const channelById = new Map<string, ChannelRecord>();
  const channelByFocusKey = new Map<string, ChannelRecord>();
  const threadByChannelName = new Map<string, ChannelsPageData["threads"][number]>();
  const documentsByChannelName = new Map<string, ChannelDocumentRecord[]>();
  const archivedDocumentsByChannelName = new Map<string, ChannelDocumentRecord[]>();
  const documentById = new Map<string, ChannelDocumentRecord>();
  const filesByChannelName = new Map<string, ChannelFileRecord[]>();
  const conflictById = new Map<string, ChannelDocumentConflictRecord>();
  const openConflictsByDocumentId = new Map<string, ChannelDocumentConflictRecord[]>();
  const runsByChannelName = new Map<string, ChannelDocumentRunRecord[]>();
  const mentionCandidatesByChannelName = new Map<string, ChannelsPageData["mentionCandidates"]>();

  for (const channel of data.channels) {
    channelById.set(channel.id, channel);
    channelByFocusKey.set(`channel:${channel.id}`, channel);
    if (channel.channelName) {
      channelByFocusKey.set(`channel:${channel.channelName}`, channel);
    }
    if (channel.kind === "direct" && channel.contactId) {
      channelByFocusKey.set(`contact:${channel.contactId}`, channel);
    }
    if (channel.kind === "direct" && channel.humanContactUserId) {
      channelByFocusKey.set(`human:${channel.humanContactUserId}`, channel);
    }
  }

  for (const thread of data.threads) {
    threadByChannelName.set(thread.channelName, thread);
  }

  for (const document of data.documents) {
    const byChannel =
      document.status === "archived" ? archivedDocumentsByChannelName : documentsByChannelName;
    const documents = byChannel.get(document.channelName);
    if (documents) {
      documents.push(document);
    } else {
      byChannel.set(document.channelName, [document]);
    }
    documentById.set(document.id, document);
  }

  for (const file of data.channelFiles) {
    const files = filesByChannelName.get(file.channelName);
    if (files) {
      files.push(file);
    } else {
      filesByChannelName.set(file.channelName, [file]);
    }
  }

  for (const conflict of data.documentConflicts) {
    conflictById.set(conflict.id, conflict);
    if (conflict.status !== "open") {
      continue;
    }
    const conflicts = openConflictsByDocumentId.get(conflict.documentId);
    if (conflicts) {
      conflicts.push(conflict);
    } else {
      openConflictsByDocumentId.set(conflict.documentId, [conflict]);
    }
  }

  for (const run of data.documentRuns) {
    const runs = runsByChannelName.get(run.channelName);
    if (runs) {
      runs.push(run);
    } else {
      runsByChannelName.set(run.channelName, [run]);
    }
  }

  for (const candidate of data.mentionCandidates) {
    for (const channelName of candidate.channels) {
      const candidates = mentionCandidatesByChannelName.get(channelName);
      if (candidates) {
        candidates.push(candidate);
      } else {
        mentionCandidatesByChannelName.set(channelName, [candidate]);
      }
    }
  }

  const loadedDetailChannelNames = new Set(data.detailScope ?? data.threads.map((thread) => thread.channelName));
  if (!data.detailScope) {
    for (const channel of data.channels) {
      const detailChannelName = resolveSelectedChannelName(channel);
      if (detailChannelName) {
        loadedDetailChannelNames.add(detailChannelName);
      }
    }
  }

  return {
    channelById,
    channelByFocusKey,
    threadByChannelName,
    documentsByChannelName,
    archivedDocumentsByChannelName,
    documentById,
    filesByChannelName,
    conflictById,
    openConflictsByDocumentId,
    runsByChannelName,
    mentionCandidatesByChannelName,
    loadedDetailChannelNames,
  };
}

function buildInitialChannelDetailCache(data: ChannelsPageData): Map<string, ChannelDetailData> {
  const channelNames = data.detailScope ?? data.channels
    .map((channel) => resolveSelectedChannelName(channel))
    .filter((channelName): channelName is string => Boolean(channelName));
  return buildDetailCacheForChannels(data, channelNames);
}

function mergeChannelsPageDataWithDetailCache(
  data: ChannelsPageData,
  detailDataByChannelName: Map<string, ChannelDetailData>,
): ChannelsPageData {
  if (detailDataByChannelName.size === 0) {
    return data;
  }

  const cachedChannelNames = new Set(detailDataByChannelName.keys());
  const cachedThreads = new Map<string, ChannelsPageData["threads"][number]>();
  const cachedDocuments: ChannelDocumentRecord[] = [];
  const cachedDocumentRuns: ChannelDocumentRunRecord[] = [];
  const cachedChannelFiles: ChannelFileRecord[] = [];
  const cachedDocumentConflicts: ChannelDocumentConflictRecord[] = [];
  const cachedDetailScope = new Set(data.detailScope ?? []);
  const cachedDocumentIds = new Set<string>();

  for (const [channelName, detail] of detailDataByChannelName) {
    cachedDetailScope.add(channelName);
    for (const thread of detail.threads) {
      cachedThreads.set(thread.channelName, thread);
    }
    for (const document of detail.documents) {
      if (document.channelName === channelName) {
        cachedDocuments.push(document);
        cachedDocumentIds.add(document.id);
      }
    }
    for (const run of detail.documentRuns) {
      if (run.channelName === channelName) {
        cachedDocumentRuns.push(run);
      }
    }
    for (const file of detail.channelFiles) {
      if (file.channelName === channelName) {
        cachedChannelFiles.push(file);
      }
    }
  }

  for (const detail of detailDataByChannelName.values()) {
    for (const conflict of detail.documentConflicts) {
      if (cachedDocumentIds.has(conflict.documentId)) {
        cachedDocumentConflicts.push(conflict);
      }
    }
  }

  const cachedConflictIds = new Set(cachedDocumentConflicts.map((conflict) => conflict.id));
  const documentIdsByChannelName = new Map<string, Set<string>>();
  for (const document of data.documents) {
    if (!cachedChannelNames.has(document.channelName)) {
      continue;
    }
    const documentIds = documentIdsByChannelName.get(document.channelName) ?? new Set<string>();
    documentIds.add(document.id);
    documentIdsByChannelName.set(document.channelName, documentIds);
  }
  for (const document of cachedDocuments) {
    const documentIds = documentIdsByChannelName.get(document.channelName) ?? new Set<string>();
    documentIds.add(document.id);
    documentIdsByChannelName.set(document.channelName, documentIds);
  }
  const replacedDocumentIds = new Set(
    [...documentIdsByChannelName.values()].flatMap((documentIds) => [...documentIds]),
  );
  const seenThreadNames = new Set<string>();
  const mergedThreads = data.threads.map((thread) => {
    seenThreadNames.add(thread.channelName);
    return cachedThreads.get(thread.channelName) ?? thread;
  });
  for (const [threadName, thread] of cachedThreads) {
    if (!seenThreadNames.has(threadName)) {
      mergedThreads.push(thread);
    }
  }

  return {
    ...data,
    threads: mergedThreads,
    documents: [
      ...data.documents.filter((document) => !cachedChannelNames.has(document.channelName)),
      ...cachedDocuments,
    ],
    documentRuns: [
      ...data.documentRuns.filter((run) => !cachedChannelNames.has(run.channelName)),
      ...cachedDocumentRuns,
    ],
    documentConflicts: [
      ...data.documentConflicts.filter(
        (conflict) => !cachedConflictIds.has(conflict.id) && !replacedDocumentIds.has(conflict.documentId),
      ),
      ...cachedDocumentConflicts,
    ],
    channelFiles: [
      ...data.channelFiles.filter((file) => !cachedChannelNames.has(file.channelName)),
      ...cachedChannelFiles,
    ],
    detailScope: data.detailScope ? [...cachedDetailScope] : undefined,
  };
}

function buildDetailCacheForChannels(
  data: ChannelDetailData,
  channelNames: Iterable<string>,
): Map<string, ChannelDetailData> {
  const cache = new Map<string, ChannelDetailData>();

  for (const channelName of channelNames) {
    const documents = data.documents.filter((document) => document.channelName === channelName);
    const documentIds = new Set(documents.map((document) => document.id));
    cache.set(channelName, {
      threads: data.threads.filter(
        (thread) =>
          thread.channelName === channelName ||
          thread.messages.some((message) => message.channel === channelName),
      ),
      documents,
      documentRuns: data.documentRuns.filter((run) => run.channelName === channelName),
      documentConflicts: data.documentConflicts.filter((conflict) => documentIds.has(conflict.documentId)),
      channelFiles: data.channelFiles.filter((file) => file.channelName === channelName),
      detailScope: [channelName],
    });
  }

  return cache;
}

function useChannelRealtimeRefresh({
  workspaceId,
  channelName,
  enabled,
  onInvalidation,
  refresh,
}: {
  workspaceId: string;
  channelName?: string | null;
  enabled: boolean;
  onInvalidation?: (event: WorkspaceInvalidationEvent) => void;
  refresh: () => void;
}): void {
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !channelName?.trim() || typeof window.EventSource !== "function") {
      return;
    }

    const source = new window.EventSource(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/channels/${encodeURIComponent(channelName)}/events`,
    );
    const scheduleRefresh = (event: MessageEvent<string>) => {
      let eventChannelName = channelName;
      try {
        const payload = JSON.parse(event.data) as { channelName?: string };
        if (payload.channelName && payload.channelName !== channelName) {
          return;
        }
        eventChannelName = payload.channelName ?? channelName;
      } catch {
        return;
      }
      onInvalidation?.({
        workspaceId,
        resources: eventChannelName ? [{ type: "channel", id: eventChannelName }] : [{ type: "channel" }],
        shell: "counters",
      });
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        refresh();
      }, CHANNEL_REALTIME_REFRESH_DEBOUNCE_MS);
    };

    source.addEventListener("channel.message.created", scheduleRefresh as EventListener);
    source.addEventListener("channel.thread.changed", scheduleRefresh as EventListener);

    return () => {
      source.removeEventListener("channel.message.created", scheduleRefresh as EventListener);
      source.removeEventListener("channel.thread.changed", scheduleRefresh as EventListener);
      source.close();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [channelName, enabled, onInvalidation, refresh, workspaceId]);
}

function useChannelRouteState({
  activeTab,
  channelById,
  routeSearch,
  setRouteSearch,
  workspaceHref,
}: {
  activeTab: ChannelWorkspaceTab;
  channelById: Map<string, ChannelRecord>;
  routeSearch: string;
  setRouteSearch: (value: string) => void;
  workspaceHref: (path: string) => string;
}) {
  const routeState = useMemo(() => parseChannelRouteState(routeSearch), [routeSearch]);

  const writeChannelRoute = useCallback(
    (
      historyMode: "push" | "replace",
      channelId: string,
      options?: ChannelRouteUpdateOptions,
    ) => {
      const targetChannel = channelById.get(channelId);
      const nextSearch = readCurrentChannelSearchParams(routeSearch);
      const nextTab = options?.tab ?? activeTab;
      nextSearch.set("focus", buildChannelFocusValue(targetChannel, channelId));
      if (nextTab === "messages") {
        nextSearch.delete("tab");
      } else {
        nextSearch.set("tab", nextTab);
      }
      if (nextTab === "documents" && options?.documentId && resolveSelectedChannelName(targetChannel ?? null)) {
        nextSearch.set("doc", options.documentId);
      } else {
        nextSearch.delete("doc");
      }
      const nextRouteSearch = nextSearch.toString();
      const nextHref = workspaceHref(`/im?${nextRouteSearch}`);
      if (historyMode === "push") {
        window.history.pushState(window.history.state, "", nextHref);
      } else {
        window.history.replaceState(window.history.state, "", nextHref);
      }
      setRouteSearch(nextRouteSearch);
    },
    [activeTab, channelById, routeSearch, setRouteSearch, workspaceHref],
  );

  const replaceChannelRoute = useCallback(
    (channelId: string, options?: ChannelRouteUpdateOptions) => writeChannelRoute("replace", channelId, options),
    [writeChannelRoute],
  );
  const pushChannelRoute = useCallback(
    (channelId: string, options?: ChannelRouteUpdateOptions) => writeChannelRoute("push", channelId, options),
    [writeChannelRoute],
  );

  return {
    routeState,
    replaceChannelRoute,
    pushChannelRoute,
  };
}

export function ChannelsPageClient({
  data,
  currentUserDisplayName,
  moduleSearchParams,
  onDataChanged,
  onInvalidation,
}: {
  data: ChannelsPageData;
  currentUserDisplayName: string;
  moduleSearchParams?: URLSearchParams;
  onDataChanged?: () => void;
  onInvalidation?: (event: WorkspaceInvalidationEvent) => void;
}) {
  const { tx } = useLanguage();
  const router = useRouter();
  const { navigateWorkspaceModule } = useWorkspaceModuleNavigation();
  const moduleCache = useOptionalWorkspaceModuleCache();
  useWorkspaceModuleCacheRevision();
  const moduleCacheScope = useWorkspaceModuleCacheScope();
  const { pushToast } = useFeedbackToast();
  const pathname = usePathname();
  const { workspaceSlug } = parseWorkspacePathname(pathname);
  const navigationSearchParams = useSearchParams();
  const searchParams = moduleSearchParams ?? navigationSearchParams;
  const searchParamText = searchParams.toString();
  const [routeSearch, setRouteSearch] = useState(searchParamText);
  const workspaceHref = useCallback(
    (path: string): string => workspaceSlug ? buildWorkspacePath(workspaceSlug, path) : path,
    [workspaceSlug],
  );
  const navigateToWorkspaceModule = useCallback((path: string) => {
    const href = workspaceHref(path);
    if (navigateWorkspaceModule(href)) {
      return;
    }
    router.push(href);
  }, [navigateWorkspaceModule, router, workspaceHref]);
  const replaceWorkspaceModule = useCallback((path: string) => {
    const href = workspaceHref(path);
    if (navigateWorkspaceModule(href, { replace: true })) {
      return;
    }
    router.replace(href, { scroll: false });
  }, [navigateWorkspaceModule, router, workspaceHref]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(data.channels[0]?.id ?? null);
  const [showRename, setShowRename] = useState(false);
  const [activeTab, setActiveTab] = useState<ChannelWorkspaceTab>("messages");
  const [documentsView, setDocumentsView] = useState<ChannelDocumentsView>("list");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [isCreatingDocument, setIsCreatingDocument] = useState(false);
  const [documentCreateMode, setDocumentCreateMode] = useState<ChannelDocumentCreateMode>("markdown");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [documentFeedback, setDocumentFeedback] = useState<string | null>(null);
  const [fileFeedback, setFileFeedback] = useState<string | null>(null);
  const [recoverableDraft, setRecoverableDraft] = useState<RecoverableDocumentDraft | null>(null);
  const [fileSearch, setFileSearch] = useState("");
  const [documentSearch, setDocumentSearch] = useState("");
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showContactRemarkEditor, setShowContactRemarkEditor] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [addMembersFeedback, setAddMembersFeedback] = useState<string | null>(null);
  const [accessRequestFeedback, setAccessRequestFeedback] = useState<string | null>(null);
  const [detailDataByChannelName, setDetailDataByChannelName] = useState<Map<string, ChannelDetailData>>(() =>
    buildInitialChannelDetailCache(data),
  );
  const [loadingDetailChannelName, setLoadingDetailChannelName] = useState<string | null>(null);
  const [detailLoadError, setDetailLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileUploadInputRef = useRef<HTMLInputElement>(null);
  const fileSearchInputRef = useRef<HTMLInputElement>(null);
  const documentSearchInputRef = useRef<HTMLInputElement>(null);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const initialRenderMeasuredRef = useRef(false);
  const dataSizeSignatureRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshMeasurementPendingRef = useRef(false);
  const refreshResetTimerRef = useRef<number | null>(null);
  const transitionPendingRef = useRef(false);
  const documentDraftSourceRef = useRef<string | null>(null);
  const markImChannelDetailCacheStale = useCallback((channelName?: string | null) => {
    if (!moduleCache) {
      return;
    }
    const resourceKey = channelName ? buildImChannelDetailResourceKey(channelName) : null;
    moduleCache.markStale((entry) =>
      entry.metadata.workspaceId === data.workspaceId &&
      entry.metadata.moduleId === "im" &&
      (resourceKey
        ? entry.metadata.resourceKey === resourceKey
        : entry.metadata.resourceKey?.startsWith("channel-detail:") === true),
    );
  }, [data.workspaceId, moduleCache]);
  const refreshChannelModule = useCallback((channelName?: string | null) => {
    markImChannelDetailCacheStale(channelName);
    refreshWorkspaceModule(onDataChanged, router);
  }, [markImChannelDetailCacheStale, onDataChanged, router]);
  const buildChannelDetailCacheKey = useCallback((channelName: string) =>
    scopeWorkspaceModuleCacheKey(
      {
        workspaceId: data.workspaceId,
        moduleId: "im",
        resourceKey: buildImChannelDetailResourceKey(channelName),
      },
      moduleCacheScope,
    ), [data.workspaceId, moduleCacheScope]);
  const mergedData = useMemo(
    () => mergeChannelsPageDataWithDetailCache(data, detailDataByChannelName),
    [data, detailDataByChannelName],
  );
  const indexes = useMemo(() => buildChannelsPageIndexes(mergedData), [mergedData]);
  const {
    routeState,
    replaceChannelRoute,
    pushChannelRoute,
  } = useChannelRouteState({
    activeTab,
    channelById: indexes.channelById,
    routeSearch,
    setRouteSearch,
    workspaceHref,
  });
  const conversationView = routeState.conversationView;
  const dataSizeSnapshot = useMemo(
    () => ({
      channels: data.channels.length,
      threads: mergedData.threads.length,
      messages: mergedData.threads.reduce((count, thread) => count + thread.messages.length, 0),
      documents: mergedData.documents.length,
      documentRuns: mergedData.documentRuns.length,
      documentConflicts: mergedData.documentConflicts.length,
      channelFiles: mergedData.channelFiles.length,
    }),
    [data.channels.length, mergedData],
  );
  const markInteraction = useCallback((name: string) => {
    if (!isImPerformanceInstrumentationEnabled()) {
      return;
    }
    window.performance.mark(`${IM_PERFORMANCE_MARK_PREFIX}.${name}.start`);
  }, []);
  const measureInteraction = useCallback((name: string) => {
    if (!isImPerformanceInstrumentationEnabled()) {
      return;
    }
    const startMark = `${IM_PERFORMANCE_MARK_PREFIX}.${name}.start`;
    const endMark = `${IM_PERFORMANCE_MARK_PREFIX}.${name}.end`;
    window.requestAnimationFrame(() => {
      window.performance.mark(endMark);
      try {
        window.performance.measure(`${IM_PERFORMANCE_MARK_PREFIX}.${name}`, startMark, endMark);
      } catch {
        return;
      }
      const measure = window.performance.getEntriesByName(`${IM_PERFORMANCE_MARK_PREFIX}.${name}`).at(-1);
      if (measure) {
        console.debug(`[im:perf] ${name} ${Math.round(measure.duration)}ms`);
      }
      window.performance.clearMarks(startMark);
      window.performance.clearMarks(endMark);
      window.performance.clearMeasures(`${IM_PERFORMANCE_MARK_PREFIX}.${name}`);
    });
  }, []);
  useEffect(() => {
    transitionPendingRef.current = isPending;
    if (isPending) {
      return;
    }
    refreshInFlightRef.current = false;
    if (refreshResetTimerRef.current !== null) {
      window.clearTimeout(refreshResetTimerRef.current);
      refreshResetTimerRef.current = null;
    }
    if (refreshMeasurementPendingRef.current) {
      refreshMeasurementPendingRef.current = false;
      measureInteraction("refresh");
    }
  }, [isPending, measureInteraction]);

  useEffect(() => {
    if (!isImPerformanceInstrumentationEnabled() || initialRenderMeasuredRef.current) {
      return;
    }
    initialRenderMeasuredRef.current = true;
    const startMark = `${IM_PERFORMANCE_MARK_PREFIX}.initial-render.start`;
    const endMark = `${IM_PERFORMANCE_MARK_PREFIX}.initial-render.end`;
    window.performance.mark(startMark);
    window.requestAnimationFrame(() => {
      window.performance.mark(endMark);
      window.performance.measure(`${IM_PERFORMANCE_MARK_PREFIX}.initial-render`, startMark, endMark);
      const measure = window.performance.getEntriesByName(`${IM_PERFORMANCE_MARK_PREFIX}.initial-render`).at(-1);
      if (measure) {
        console.debug(`[im:perf] initial-render ${Math.round(measure.duration)}ms`);
      }
      window.performance.clearMarks(startMark);
      window.performance.clearMarks(endMark);
      window.performance.clearMeasures(`${IM_PERFORMANCE_MARK_PREFIX}.initial-render`);
    });
  }, []);

  useEffect(() => {
    if (!isImPerformanceInstrumentationEnabled()) {
      return;
    }
    const signature = JSON.stringify(dataSizeSnapshot);
    if (dataSizeSignatureRef.current === signature) {
      return;
    }
    dataSizeSignatureRef.current = signature;
    console.debug("[im:perf] data sizes", dataSizeSnapshot);
  }, [dataSizeSnapshot]);

  useEffect(
    () => () => {
      if (refreshResetTimerRef.current !== null) {
        window.clearTimeout(refreshResetTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setRouteSearch(searchParamText);
  }, [searchParamText]);

  useEffect(() => {
    const initialDetailCache = buildInitialChannelDetailCache(data);
    if (moduleCache) {
      for (const [channelName, detail] of initialDetailCache) {
        moduleCache.set(
          buildChannelDetailCacheKey(channelName),
          detail,
          buildImChannelDetailCacheMetadata(detail, channelName),
        );
      }
    }

    setDetailDataByChannelName((current) => {
      const next = new Map(current);
      let changed = false;
      for (const [channelName, detail] of initialDetailCache) {
        next.set(channelName, detail);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [buildChannelDetailCacheKey, data, moduleCache]);

  useEffect(() => {
    function handlePopState(): void {
      setRouteSearch(window.location.search.replace(/^\?/, ""));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const nextTab = routeState.tab ?? (routeState.documentId ? "documents" : "messages");
    if (!routeState.focus) {
      if (routeState.tab || routeState.documentId) {
        setActiveTab(nextTab);
        setDocumentsView(nextTab === "documents" && routeState.documentId ? "workspace" : "list");
      }
      if (routeState.documentId) {
        setSelectedDocumentId(routeState.documentId);
      }
      return;
    }

    const focusedChannel = indexes.channelByFocusKey.get(routeState.focus);
    if (focusedChannel) {
      setSelectedChannelId(focusedChannel.id);
    }
    setActiveTab(nextTab);
    setDocumentsView(nextTab === "documents" && routeState.documentId ? "workspace" : "list");
    if (routeState.documentId) {
      setSelectedDocumentId(routeState.documentId);
    }
  }, [indexes, routeState]);

  const visibleChannels = useMemo(
    () => {
      const imChannels = mergedData.channels.filter((channel) => channel.directParticipantKind !== "human");
      return conversationView === "direct"
        ? imChannels.filter((channel) => channel.kind === "direct")
        : imChannels;
    },
    [conversationView, mergedData.channels],
  );
  const visibleChannelById = useMemo(
    () => new Map(visibleChannels.map((channel) => [channel.id, channel])),
    [visibleChannels],
  );

  useEffect(() => {
    if (!selectedChannelId || !visibleChannelById.has(selectedChannelId)) {
      setSelectedChannelId(visibleChannels[0]?.id ?? null);
    }
  }, [selectedChannelId, visibleChannelById, visibleChannels]);

  useEffect(() => {
    setAccessRequestFeedback(null);
    setFileFeedback(null);
  }, [selectedChannelId]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent): void {
      if (headerMenuRef.current && !headerMenuRef.current.contains(event.target as Node)) {
        setShowHeaderMenu(false);
      }
      if (createMenuRef.current && !createMenuRef.current.contains(event.target as Node)) {
        setShowCreateMenu(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const selectedChannel = selectedChannelId ? visibleChannelById.get(selectedChannelId) ?? null : null;
  const selectedConversationChannelName = resolveSelectedChannelName(selectedChannel);
  const refreshChannelData = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    if (isDocumentInputActive()) {
      return;
    }
    if (refreshInFlightRef.current || transitionPendingRef.current) {
      return;
    }
    markInteraction("refresh");
    refreshMeasurementPendingRef.current = true;
    refreshInFlightRef.current = true;
    startTransition(() => {
      refreshChannelModule(selectedConversationChannelName);
    });
    if (refreshResetTimerRef.current !== null) {
      window.clearTimeout(refreshResetTimerRef.current);
    }
    refreshResetTimerRef.current = window.setTimeout(() => {
      refreshInFlightRef.current = false;
      refreshResetTimerRef.current = null;
    }, CHANNEL_REFRESH_POLL_MS);
  }, [markInteraction, refreshChannelModule, selectedConversationChannelName]);
  const selectedChannelCanRename = selectedChannel
    ? canRenameChannelFromHeader(selectedChannel)
    : false;
  const selectedChannelRequiresAccess =
    selectedChannel?.kind !== "direct"
    && selectedChannel?.accessState !== undefined
    && selectedChannel.accessState !== "accessible";
  const selectedThread = selectedChannel ? indexes.threadByChannelName.get(selectedChannel.id) ?? null : null;
  const channelDocuments = selectedConversationChannelName
    ? indexes.documentsByChannelName.get(selectedConversationChannelName) ?? EMPTY_CHANNEL_DOCUMENTS
    : EMPTY_CHANNEL_DOCUMENTS;
  const archivedChannelDocuments = selectedConversationChannelName
    ? indexes.archivedDocumentsByChannelName.get(selectedConversationChannelName) ?? EMPTY_ARCHIVED_CHANNEL_DOCUMENTS
    : EMPTY_ARCHIVED_CHANNEL_DOCUMENTS;
  const channelFiles = selectedConversationChannelName
    ? indexes.filesByChannelName.get(selectedConversationChannelName) ?? EMPTY_CHANNEL_FILES
    : EMPTY_CHANNEL_FILES;
  const channelDocumentRuns = selectedConversationChannelName
    ? indexes.runsByChannelName.get(selectedConversationChannelName) ?? EMPTY_DOCUMENT_RUNS
    : EMPTY_DOCUMENT_RUNS;
  const channelDocumentIdSet = useMemo(
    () => new Set(channelDocuments.map((document) => document.id)),
    [channelDocuments],
  );
  const channelDocumentConflicts = useMemo(
    () =>
      channelDocuments.flatMap((document) =>
        indexes.openConflictsByDocumentId.get(document.id) ?? EMPTY_DOCUMENT_CONFLICTS,
      ),
    [channelDocuments, indexes],
  );
  const selectedDocument = selectedDocumentId
    ? (() => {
        const document = indexes.documentById.get(selectedDocumentId) ?? null;
        return document?.channelName === selectedConversationChannelName && document.status === "active" ? document : null;
      })()
    : isCreatingDocument
      ? null
      : channelDocuments[0] ?? null;
  const selectedDocumentDraftSource = selectedDocument ? buildDocumentDraftSource(selectedDocument) : null;
  const selectedDocumentConflicts = selectedDocument
    ? indexes.openConflictsByDocumentId.get(selectedDocument.id) ?? EMPTY_DOCUMENT_CONFLICTS
    : EMPTY_DOCUMENT_CONFLICTS;
  const selectedDetailLoaded = selectedConversationChannelName
    ? indexes.loadedDetailChannelNames.has(selectedConversationChannelName)
    : true;
  const selectedDetailLoading = Boolean(
    selectedConversationChannelName && loadingDetailChannelName === selectedConversationChannelName,
  );
  const filteredChannelFiles = useMemo(() => {
    const query = fileSearch.trim().toLocaleLowerCase("zh-CN");
    if (!query) {
      return channelFiles;
    }
    return channelFiles.filter((file) => {
      const haystack = [file.fileName, file.sourceSpeaker, file.sourceTime, file.mediaType]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      return haystack.includes(query);
    });
  }, [channelFiles, fileSearch]);
  const filteredChannelDocuments = useMemo(() => {
    const query = documentSearch.trim().toLocaleLowerCase("zh-CN");
    if (!query) {
      return channelDocuments;
    }
    return channelDocuments.filter((document) => {
      const haystack = [document.title, document.summary, document.updatedBy]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      return haystack.includes(query);
    });
  }, [channelDocuments, documentSearch]);
  const shouldPollChannelUpdates = useMemo(() => {
    if (!selectedChannel || !selectedConversationChannelName) {
      return false;
    }

    const hasPendingThreadMessages = (selectedThread?.messages ?? []).some((message) => message.status === "pending");
    const hasRunningDocumentWorkflow = channelDocumentRuns.some((run) => run.status === "pending" || run.status === "running");
    const hasProcessingAgentPresence = channelDocuments.some((document) =>
      document.activePresences.some((presence) => presence.actorType === "agent" && presence.status === "processing"),
    );

    return hasPendingThreadMessages || hasRunningDocumentWorkflow || hasProcessingAgentPresence;
  }, [channelDocumentRuns, channelDocuments, selectedChannel, selectedConversationChannelName, selectedThread]);

  useChannelRealtimeRefresh({
    workspaceId: data.workspaceId,
    channelName: selectedConversationChannelName,
    enabled:
      activeTab === "messages" &&
      Boolean(selectedConversationChannelName) &&
      !selectedChannelRequiresAccess,
    onInvalidation,
    refresh: refreshChannelData,
  });

  useEffect(() => {
    if (selectedChannel?.kind === "direct" && !selectedConversationChannelName && activeTab !== "messages") {
      setActiveTab("messages");
      setDocumentsView("list");
    }
  }, [activeTab, selectedChannel?.kind, selectedConversationChannelName]);

  useEffect(() => {
    if (!selectedConversationChannelName || selectedChannelRequiresAccess || selectedDetailLoaded) {
      return;
    }

    const channelDetailCacheKey = buildChannelDetailCacheKey(selectedConversationChannelName);
    const cachedDetail = moduleCache?.get<ChannelDetailData>(channelDetailCacheKey);
    if (cachedDetail?.status === "ready" && cachedDetail.data && !cachedDetail.metadata.stale) {
      const cachedChannelDetail = cachedDetail.data;
      setDetailDataByChannelName((current) => {
        const next = new Map(current);
        for (const channelName of cachedChannelDetail.detailScope ?? [selectedConversationChannelName]) {
          next.set(channelName, cachedChannelDetail);
        }
        return next;
      });
      setDetailLoadError(null);
      return;
    }

    let cancelled = false;
    setLoadingDetailChannelName(selectedConversationChannelName);
    setDetailLoadError(null);

    const detailPromise = moduleCache
      ? moduleCache.load<ChannelDetailData>({
          cacheKey: channelDetailCacheKey,
          loader: () => getChannelDetailDataAction({
            channelName: selectedConversationChannelName,
            workspaceId: data.workspaceId,
          }),
          metadata: (detail) => buildImChannelDetailCacheMetadata(detail, selectedConversationChannelName),
          forbidden: (error) => error instanceof Error && /forbidden/i.test(error.message),
        })
      : getChannelDetailDataAction({
          channelName: selectedConversationChannelName,
          workspaceId: data.workspaceId,
        });

    detailPromise
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setDetailDataByChannelName((current) => {
          const next = new Map(current);
          for (const channelName of detail.detailScope ?? [selectedConversationChannelName]) {
            next.set(channelName, detail);
          }
          return next;
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setDetailLoadError(error instanceof Error ? error.message : tx("加载失败", "Load failed"));
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setLoadingDetailChannelName(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    data.workspaceId,
    buildChannelDetailCacheKey,
    moduleCache,
    selectedChannelRequiresAccess,
    selectedConversationChannelName,
    selectedDetailLoaded,
    tx,
  ]);

  useEffect(() => {
    if (isCreatingDocument) {
      return;
    }
    if (!selectedDocumentId || !channelDocumentIdSet.has(selectedDocumentId)) {
      setSelectedDocumentId(channelDocuments[0]?.id ?? null);
    }
  }, [channelDocumentIdSet, channelDocuments, isCreatingDocument, selectedDocumentId]);

  useEffect(() => {
    if (!selectedDocument) {
      if (!isCreatingDocument) {
        documentDraftSourceRef.current = null;
        setDraftTitle("");
        setDraftSummary("");
        setDraftContent("");
      }
      return;
    }
    if (documentDraftSourceRef.current === selectedDocumentDraftSource) {
      return;
    }
    documentDraftSourceRef.current = selectedDocumentDraftSource;
    setIsCreatingDocument(false);
    setDraftTitle(selectedDocument.title);
    setDraftSummary(selectedDocument.summary);
    setDraftContent(selectedDocument.contentMarkdown);
  }, [
    isCreatingDocument,
    selectedDocument?.contentMarkdown,
    selectedDocument?.currentVersionId,
    selectedDocument?.id,
    selectedDocument?.summary,
    selectedDocument?.title,
    selectedDocumentDraftSource,
  ]);

  useEffect(() => {
    if (!currentUserDisplayName.trim() || !selectedDocument?.id || isCreatingDocument) {
      return;
    }
    void touchChannelDocumentPresenceAction({
      documentId: selectedDocument.id,
      status: "viewing",
    });
  }, [currentUserDisplayName, isCreatingDocument, selectedDocument?.id]);

  useEffect(() => {
    if (!shouldPollChannelUpdates) {
      return;
    }

    const timer = window.setInterval(() => {
      refreshChannelData();
    }, CHANNEL_REFRESH_POLL_MS);

    return () => window.clearInterval(timer);
  }, [refreshChannelData, shouldPollChannelUpdates]);
  const mentionCandidates: ConversationMentionCandidate[] = useMemo(() => {
    if (!selectedChannel || selectedChannel.kind === "direct") {
      return [];
    }

    return (selectedConversationChannelName
      ? indexes.mentionCandidatesByChannelName.get(selectedConversationChannelName) ?? EMPTY_MENTION_CANDIDATES
      : EMPTY_MENTION_CANDIDATES)
      .map((candidate) => ({
        id: candidate.id,
        label: candidate.label,
        subtitle: candidate.subtitle,
        inChannel: true,
        kind: candidate.kind ?? "agent",
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN", { sensitivity: "base" }));
  }, [indexes, selectedChannel, selectedConversationChannelName]);

  const addableChannelMemberCandidates = useMemo(() => {
    if (!selectedChannel || selectedChannel.kind === "direct") {
      return [];
    }
    const existingHumanMemberNames = new Set((selectedChannel.humanMemberNames ?? []).map(normalizeMemberKey));
    const existingAgentNames = new Set((selectedChannel.employeeNames ?? []).map(normalizeMemberKey));
    return (data.channelMemberCandidates ?? [])
      .filter((candidate) =>
        candidate.kind === "agent"
          ? !existingAgentNames.has(normalizeMemberKey(candidate.id))
          : !existingHumanMemberNames.has(normalizeMemberKey(candidate.label))
      )
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN", { sensitivity: "base" }));
  }, [data.channelMemberCandidates, selectedChannel]);

  const items: ConversationListItem[] = useMemo(
    () =>
      visibleChannels.map((channel) => ({
        id: channel.id,
        title: channel.displayName ?? channel.name,
        subtitle:
          channel.kind === "direct"
            ? channel.displaySubtitle ?? tx("私聊", "Direct")
            : translateMemberLabel(channel.memberLabel, tx),
        meta: translateChannelAccessPreview(channel.accessState, tx)
          ?? translateChannelPreview(channel.id, indexes.threadByChannelName, tx)
          ?? translateChannelListPreview(channel.lastMessage, tx)
          ?? tx("还没有消息", "No messages yet"),
        avatar: channel.avatarLabel ?? "#",
        avatarId: channel.humanContactUserId ?? channel.contactId ?? channel.channelName ?? channel.id,
        avatarName: channel.displayName ?? channel.name,
        avatarVariant: channel.directParticipantKind === "human" ? "human" : channel.kind === "direct" ? "agent" : "channel",
        dateLabel: formatCompactTimestamp(channel.updatedAt, { emptyFallback: "" }),
        unread: channel.unread,
      })),
    [indexes.threadByChannelName, tx, visibleChannels],
  );

  const messages: ConversationThreadMessage[] = useMemo(
    () =>
      selectedThread?.messages.map((message, index) => ({
      id: message.id || `${message.speaker}-${message.time}-${index}`,
      speaker: message.speaker,
      role: message.role,
      content: message.summary,
      code: message.code,
      data: message.data,
      timestamp: formatCompactTimestamp(message.time, { emptyFallback: message.time }),
      status: message.status ?? "completed",
      attachments: message.attachments,
      mentions: message.mentions,
      acknowledgements: message.acknowledgements,
      kind: message.kind,
      processType: message.processType,
      tool: message.tool,
      pinned: message.pinned,
      pinnedAt: message.pinnedAt,
      replyToMessageId: message.replyToMessageId,
    })) ?? [],
    [selectedThread],
  );
  const emptyThreadTitle = selectedChannel
    ? tx("还没有消息", "No messages yet")
    : tx("未选择会话", "No conversation selected");
  const emptyThreadBody = selectedChannel
    ? tx("发一条消息开始对话。", "Send a message to start the conversation.")
    : tx("先从左侧选择一个会话。", "Select a conversation from the list first.");

  useEffect(() => {
    setShowContactRemarkEditor(false);
  }, [selectedChannel?.id]);

  function switchChannelTab(nextTab: ChannelWorkspaceTab): void {
    if (!selectedChannel) {
      return;
    }
    if (!selectedConversationChannelName && nextTab !== "messages") {
      return;
    }
    markInteraction("tab-switch");
    setActiveTab(nextTab);
    setDocumentsView(nextTab === "documents" && routeState.documentId ? "workspace" : "list");
    setShowHeaderMenu(false);
    setShowCreateMenu(false);
    replaceChannelRoute(selectedChannel.id, {
      tab: nextTab,
      documentId: nextTab === "documents" && documentsView === "workspace" ? selectedDocumentId : null,
    });
    measureInteraction("tab-switch");
  }

  async function uploadChannelFiles(files: FileList | null): Promise<void> {
    if (!selectedConversationChannelName || !files || files.length === 0) {
      return;
    }

    const formData = new FormData();
    formData.set("channelName", selectedConversationChannelName);
    formData.set("content", tx("请查看我发送的文件。", "Please review the file I sent."));
    Array.from(files).forEach((file) => formData.append("attachments", file));
    await sendChannelMessageAction(formData);
  }

  function deleteChannelFile(file: ChannelsPageData["channelFiles"][number]): void {
    if (!selectedConversationChannelName || !file.canDelete) {
      return;
    }
    const confirmed = window.confirm(
      file.retainedBecauseReferenced
        ? tx(
            `「${file.fileName}」已被知识库或群文档引用。删除只会从群文件列表移除，底层文件会保留。继续？`,
            `"${file.fileName}" is referenced by knowledge or cloud docs. Deleting only removes it from the group file list; the stored file is retained. Continue?`,
          )
        : tx(
            `确定删除群文件「${file.fileName}」？`,
            `Delete group file "${file.fileName}"?`,
          ),
    );
    if (!confirmed) {
      return;
    }
    startTransition(async () => {
      try {
        setFileFeedback(null);
        setDocumentFeedback(null);
        await deleteChannelAttachmentAction({
          channelName: selectedConversationChannelName,
          attachmentId: file.id,
        });
        setFileFeedback(
          file.retainedBecauseReferenced
            ? tx("文件已从群文件列表移除，底层文件因引用关系保留。", "File removed from group files; the stored file was retained because it is referenced.")
            : tx("文件已删除。", "File deleted."),
        );
        refreshChannelModule(selectedConversationChannelName);
      } catch (error) {
        const message = error instanceof Error ? error.message : tx("删除失败", "Delete failed");
        setFileFeedback(message);
        setDocumentFeedback(message);
      }
    });
  }

  function deleteChannelDocument(document: ChannelsPageData["documents"][number]): void {
    if (document.currentUserRole !== "owner") {
      return;
    }
    const confirmed = window.confirm(
      document.externalSheet
        ? tx(
            `确定删除云文档「${document.title}」？这只会从 AgentSpace 会话里移除绑定，不会删除 Google Drive 里的原始表格。`,
            `Delete cloud document "${document.title}"? This only removes the binding from the AgentSpace conversation; the original Google Drive sheet is not deleted.`,
          )
        : tx(
            `确定删除云文档「${document.title}」？删除后可在已删除文档中恢复。`,
            `Delete cloud document "${document.title}"? You can restore it from deleted documents.`,
          ),
    );
    if (!confirmed) {
      return;
    }
    startTransition(async () => {
      try {
        setDocumentFeedback(null);
        setRecoverableDraft(null);
        await archiveChannelDocumentAction(document.id);
        if (selectedDocumentId === document.id) {
          setSelectedDocumentId(null);
        }
        setDocumentsView("list");
        if (selectedChannel) {
          replaceChannelRoute(selectedChannel.id, {
            tab: "documents",
            documentId: null,
          });
        }
        refreshChannelModule(selectedConversationChannelName);
      } catch (error) {
        setDocumentFeedback(error instanceof Error ? error.message : tx("删除失败", "Delete failed"));
      }
    });
  }

  function openFreshDocumentWorkspace(initialTitle?: string, mode: ChannelDocumentCreateMode = "markdown"): void {
    if (!selectedChannel || !selectedConversationChannelName) {
      return;
    }

    documentDraftSourceRef.current = null;
    setActiveTab("documents");
    setDocumentsView("workspace");
    setIsCreatingDocument(true);
    setDocumentCreateMode(mode);
    setSelectedDocumentId(null);
    setDocumentFeedback(null);
    setRecoverableDraft(null);
    setDraftTitle(initialTitle ?? "");
    setDraftSummary("");
    setDraftContent(buildInitialDocumentDraftContent(mode, tx));
    setShowCreateMenu(false);
    replaceChannelRoute(selectedChannel.id, {
      tab: "documents",
      documentId: null,
    });
  }

  const documentWorkbench =
    selectedChannel && selectedConversationChannelName ? (
      <div className="channel-workspace-panel channel-workspace-panel--documents">
        <div className="channel-workspace-panel__toolbar">
          <div>
            <h3>
              {isCreatingDocument
                ? documentCreateMode === "googleSheetCreate"
                  ? tx("创建 Google Sheet", "Create Google Sheet")
                  : documentCreateMode === "googleSheet"
                    ? tx("链接 Google Sheet", "Link Google Sheet")
                    : documentCreateMode === "nativeSheet"
                      ? tx("新建表格", "New sheet")
                      : documentCreateMode === "nativeDeck"
                        ? tx("新建 Deck", "New deck")
                        : tx("新建云文档", "New cloud doc")
                : tx("云文档工作台", "Cloud docs workspace")}
            </h3>
          </div>
          <div className="detail-actions">
            <button
              className="action-button"
              disabled={isPending}
              onClick={() => {
                setDocumentsView("list");
                replaceChannelRoute(selectedChannel.id, {
                  tab: "documents",
                  documentId: null,
                });
              }}
              type="button"
            >
              {tx("返回列表", "Back to list")}
            </button>
          </div>
        </div>

        <ChannelDocumentsPanel
          archivedDocuments={archivedChannelDocuments}
          documents={channelDocuments}
          googleWorkspace={data.googleWorkspace}
          selectedDocument={selectedDocument}
          selectedDocumentConflicts={selectedDocumentConflicts}
          draftContent={draftContent}
          currentVersionId={selectedDocument?.currentVersionId}
          createMode={isCreatingDocument ? documentCreateMode : "markdown"}
          draftSummary={draftSummary}
          draftTitle={draftTitle}
          feedback={documentFeedback}
          hasRecoverableDraft={recoverableDraft?.documentId === selectedDocument?.id}
          runs={channelDocumentRuns}
          conflicts={channelDocumentConflicts}
          channelFiles={channelFiles}
          onDeleteAttachment={deleteChannelFile}
          onArchive={() => {
            if (!selectedDocument) {
              return;
            }
            deleteChannelDocument(selectedDocument);
          }}
          onRestoreArchived={(documentId) => {
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                const result = await restoreChannelDocumentAction(documentId);
                setSelectedDocumentId(result.documentId);
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("恢复失败", "Restore failed"));
              }
            });
          }}
          onDisconnectGoogleWorkspace={() => {
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                await disconnectGoogleWorkspaceAction();
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("断开连接失败", "Disconnect failed"));
              }
            });
          }}
          onRefreshExternalSheet={() => {
            if (!selectedDocument?.id) {
              return;
            }
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                await refreshExternalGoogleSheetDocumentAction(selectedDocument.id);
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("刷新失败", "Refresh failed"));
              }
            });
          }}
          onSyncExternalSheetPermissions={() => {
            if (!selectedDocument?.id) {
              return;
            }
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                await syncExternalGoogleSheetPermissionsAction(selectedDocument.id);
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("同步权限失败", "Permission sync failed"));
              }
            });
          }}
          onCreateNew={() => openFreshDocumentWorkspace()}
          onDraftContentChange={setDraftContent}
          onDraftSummaryChange={setDraftSummary}
          onDraftTitleChange={setDraftTitle}
          onBeginEditing={() => {
            if (!currentUserDisplayName.trim() || !selectedDocument?.id) {
              return;
            }
            void touchChannelDocumentPresenceAction({
              documentId: selectedDocument.id,
              status: "editing",
            });
          }}
          onRestoreRecoverableDraft={() => {
            if (!recoverableDraft || recoverableDraft.documentId !== selectedDocument?.id) {
              return;
            }
            setDraftTitle(recoverableDraft.title);
            setDraftSummary(recoverableDraft.summary);
            setDraftContent(recoverableDraft.content);
            setRecoverableDraft(null);
            setDocumentFeedback(
              tx(
                "已恢复你刚才未保存的草稿。保存前请先和最新版本手动合并。",
                "Your previous draft was restored. Merge it with the latest version before saving again.",
              ),
            );
          }}
          onDismissRecoverableDraft={() => {
            setRecoverableDraft(null);
          }}
          onSave={() => {
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                if (isCreatingDocument && documentCreateMode === "googleSheet") {
                  const result = await createExternalGoogleSheetDocumentAction({
                    channelName: selectedConversationChannelName,
                    title: draftTitle,
                    externalUrl: draftContent,
                    summary: draftSummary,
                  });
                  setIsCreatingDocument(false);
                  setDocumentCreateMode("markdown");
                  setRecoverableDraft(null);
                  setSelectedDocumentId(result.documentId);
                  replaceChannelRoute(selectedChannel.id, {
                    tab: "documents",
                    documentId: result.documentId,
                  });
                  refreshChannelModule(selectedConversationChannelName);
                  return;
                }
                if (isCreatingDocument && documentCreateMode === "googleSheetCreate") {
                  const result = await createGoogleSheetDocumentAction({
                    channelName: selectedConversationChannelName,
                    title: draftTitle,
                    summary: draftSummary,
                  });
                  setIsCreatingDocument(false);
                  setDocumentCreateMode("markdown");
                  setRecoverableDraft(null);
                  setSelectedDocumentId(result.documentId);
                  replaceChannelRoute(selectedChannel.id, {
                    tab: "documents",
                    documentId: result.documentId,
                  });
                  refreshChannelModule(selectedConversationChannelName);
                  return;
                }
                const result = await saveChannelDocumentAction({
                  documentId: selectedDocument?.id,
                  baseVersionId: selectedDocument?.currentVersionId,
                  channelName: selectedConversationChannelName,
                  title: draftTitle,
                  contentMarkdown: draftContent,
                  summary: draftSummary,
                  kind: resolveDocumentKindForCreateMode(documentCreateMode),
                });
                setIsCreatingDocument(false);
                setDocumentCreateMode("markdown");
                setRecoverableDraft(null);
                setSelectedDocumentId(result.documentId);
                replaceChannelRoute(selectedChannel.id, {
                  tab: "documents",
                  documentId: result.documentId,
                });
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                const message = error instanceof Error ? error.message : tx("保存失败", "Save failed");
                if (selectedDocument?.id && isStaleChannelDocumentSaveError(message)) {
                  setRecoverableDraft({
                    documentId: selectedDocument.id,
                    title: draftTitle,
                    summary: draftSummary,
                    content: draftContent,
                  });
                  setDocumentFeedback(
                    tx(
                      "这份文档在你编辑期间已被别人更新。编辑器已经切到最新版本；如需继续，请把你的草稿合并进去后再保存。",
                      "This document was updated by someone else while you were editing. The editor has been refreshed to the latest version; merge your draft back in before saving again.",
                    ),
                  );
                  refreshChannelModule(selectedConversationChannelName);
                  return;
                }
                setDocumentFeedback(message);
              }
            });
          }}
          onSelectDocument={(documentId) => {
            setIsCreatingDocument(false);
            setDocumentCreateMode("markdown");
            setDocumentFeedback(null);
            setRecoverableDraft(null);
            setSelectedDocumentId(documentId);
            replaceChannelRoute(selectedChannel.id, {
              tab: "documents",
              documentId,
            });
          }}
          onRollback={(versionId) => {
            if (!selectedDocument) {
              return;
            }
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                setRecoverableDraft(null);
                const result = await rollbackChannelDocumentVersionAction({
                  documentId: selectedDocument.id,
                  versionId,
                });
                setSelectedDocumentId(result.documentId);
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("回滚失败", "Rollback failed"));
              }
            });
          }}
          onResolveConflict={(conflictId) => {
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                await resolveChannelDocumentConflictAction(conflictId);
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("处理冲突失败", "Resolve conflict failed"));
              }
            });
          }}
          onLoadConflictDraft={(conflictId) => {
            const conflict = indexes.conflictById.get(conflictId);
            if (!conflict?.mergePreview) {
              return;
            }
            const document = indexes.documentById.get(conflict.documentId);
            documentDraftSourceRef.current = document ? buildDocumentDraftSource(document) : null;
            setIsCreatingDocument(false);
            setSelectedDocumentId(conflict.documentId);
            setRecoverableDraft(null);
            setDraftTitle(conflict.mergePreview.suggestedDraftTitle ?? document?.title ?? "");
            setDraftSummary(conflict.mergePreview.suggestedDraftSummary ?? document?.summary ?? "");
            setDraftContent(conflict.mergePreview.suggestedDraftContentMarkdown);
            setDocumentFeedback(
              tx(
                "已将冲突改动载入草稿。请参考下方“当前内容 / 冲突改动”对照后手动合并，再决定是否保存。",
                "The conflicted change was loaded into the draft. Compare the current and incoming content below, then merge manually before saving.",
              ),
            );
            replaceChannelRoute(selectedChannel.id, {
              tab: "documents",
              documentId: conflict.documentId,
            });
          }}
          onRetryConflict={(conflictId) => {
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                const result = await retryChannelDocumentConflictAction(conflictId);
                setSelectedDocumentId(result.documentId);
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("重新应用失败", "Retry failed"));
              }
            });
          }}
          onUpdateCollaboratorRole={(input) => {
            if (!selectedDocument?.id) {
              return;
            }
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                await updateChannelDocumentAccessRoleAction({
                  documentId: selectedDocument.id,
                  actorId: input.actorId,
                  actorType: input.actorType,
                  role: input.role,
                });
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("更新权限失败", "Permission update failed"));
              }
            });
          }}
          onAddCollaborator={(input) => {
            if (!selectedDocument?.id) {
              return;
            }
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                await addChannelDocumentCollaboratorAction({
                  documentId: selectedDocument.id,
                  actorId: input.actorId,
                  actorType: input.actorType,
                  role: input.role,
                });
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("添加协作者失败", "Add collaborator failed"));
              }
            });
          }}
          onRemoveCollaborator={(input) => {
            if (!selectedDocument?.id) {
              return;
            }
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                await removeChannelDocumentCollaboratorAction({
                  documentId: selectedDocument.id,
                  actorId: input.actorId,
                  actorType: input.actorType,
                });
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("移除协作者失败", "Remove collaborator failed"));
              }
            });
          }}
          onExport={() => {
            if (!selectedDocument) {
              return;
            }
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                setRecoverableDraft(null);
                await exportChannelDocumentAttachmentAction(selectedDocument.id);
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("导出失败", "Export failed"));
              }
            });
          }}
          onImportAttachment={(attachmentId, fileName) => {
            startTransition(async () => {
              try {
                setDocumentFeedback(null);
                setRecoverableDraft(null);
                const result = await createChannelDocumentFromAttachmentAction({
                  channelName: selectedConversationChannelName,
                  attachmentId,
                  title: fileName.replace(/\.md$/i, ""),
                });
                setSelectedDocumentId(result.documentId);
                setDocumentsView("workspace");
                replaceChannelRoute(selectedChannel.id, {
                  tab: "documents",
                  documentId: result.documentId,
                });
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setDocumentFeedback(error instanceof Error ? error.message : tx("导入失败", "Import failed"));
              }
            });
          }}
          onViewDocumentInKnowledge={(documentId) => {
            navigateToWorkspaceModule(`/knowledge?view=documents&document=${encodeURIComponent(`channelDocument:${documentId}`)}`);
          }}
          onViewAttachmentInKnowledge={(attachmentId) => {
            navigateToWorkspaceModule(`/knowledge?view=documents&document=${encodeURIComponent(`attachment:${attachmentId}`)}`);
          }}
          pending={isPending}
          selectedDocumentId={selectedDocument?.id ?? null}
          tx={tx}
        />
      </div>
    ) : null;

  return (
    <>
      {showRename && selectedChannel && selectedChannelCanRename ? (
        <RenameChannelModal
          channelName={selectedChannel.name}
          languageLabel={(zh, en) => tx(zh, en)}
          pending={isPending}
          onCancel={() => setShowRename(false)}
          onConfirm={(nextName) => {
            startTransition(async () => {
              await renameChannelAction({
                channelName: selectedChannel.name,
                nextName,
              });
              setShowRename(false);
              refreshChannelModule(selectedConversationChannelName);
            });
          }}
        />
      ) : null}

      {showAddMembers && selectedChannel && selectedConversationChannelName ? (
        <AddChannelMembersModal
          candidates={addableChannelMemberCandidates}
          channelName={selectedChannel.displayName ?? selectedChannel.name}
          feedback={addMembersFeedback}
          pending={isPending}
          onCancel={() => {
            setShowAddMembers(false);
            setAddMembersFeedback(null);
          }}
          onConfirm={({ userIds, agentIds }) => {
            startTransition(async () => {
              try {
                await addWorkspaceMembersToChannelAction({
                  channelName: selectedConversationChannelName,
                  workspaceId: data.workspaceId,
                  userIds,
                  agentIds,
                });
                setShowAddMembers(false);
                setAddMembersFeedback(null);
                refreshChannelModule(selectedConversationChannelName);
              } catch (error) {
                setAddMembersFeedback(error instanceof Error ? error.message : tx("添加失败", "Add failed"));
              }
            });
          }}
        />
      ) : null}

      <ConversationShell
        emptyListBody={tx("当前还没有任何会话。", "There are no conversations yet.")}
        emptyListTitle={tx("会话为空", "No conversations")}
        emptyThreadBody={emptyThreadBody}
        emptyThreadTitle={emptyThreadTitle}
        customThreadHeader={
          selectedChannel
            ? ({ backButton }) => (
                <ChannelWorkspaceHeader
                  activeTab={activeTab}
                  backButton={backButton}
                  memberCount={selectedChannel.memberCount ?? estimateChannelMemberCount(selectedChannel.memberLabel)}
                  onCreateAnnouncement={() => {
                    setShowHeaderMenu(false);
                    openFreshDocumentWorkspace(tx("群公告", "Announcement"));
                  }}
                  onCreateLabelPage={() => {
                    setShowHeaderMenu(false);
                    openFreshDocumentWorkspace(tx("标签页", "Label page"));
                  }}
                  onCreateDocument={() => openFreshDocumentWorkspace()}
                  onCreateNativeDeck={() => openFreshDocumentWorkspace("", "nativeDeck")}
                  onCreateNativeSheet={() => openFreshDocumentWorkspace("", "nativeSheet")}
                  onCreateGoogleSheet={() => openFreshDocumentWorkspace("", "googleSheetCreate")}
                  onLinkGoogleSheet={() => openFreshDocumentWorkspace("", "googleSheet")}
                  onDeleteChannel={() => {
                    setShowHeaderMenu(false);
                    startTransition(async () => {
                      await deleteChannelAction(selectedChannel.name);
                      setSelectedChannelId(null);
                      replaceWorkspaceModule("/im");
                      refreshChannelModule(selectedConversationChannelName);
                    });
                  }}
                  onOpenCalendar={() => navigateToWorkspaceModule("/calendar")}
                  onOpenAddMembers={() => {
                    setShowHeaderMenu(false);
                    setAddMembersFeedback(null);
                    setShowAddMembers(true);
                  }}
                  onOpenTaskBoard={() => {
                    setShowHeaderMenu(false);
                    navigateToWorkspaceModule("/task-board");
                  }}
                  onOpenCreateMenu={() => {
                    setShowHeaderMenu(false);
                    setShowCreateMenu((current) => !current);
                  }}
                  onOpenRename={() => {
                    setShowHeaderMenu(false);
                    setShowRename(true);
                  }}
                  onOpenContactRemark={() => setShowContactRemarkEditor(true)}
                  onUploadFiles={() => {
                    setShowCreateMenu(false);
                    fileUploadInputRef.current?.click();
                  }}
                  onSearchAction={() => {
                    if (activeTab === "messages") {
                      switchChannelTab("files");
                      window.requestAnimationFrame(() => fileSearchInputRef.current?.focus());
                      return;
                    }
                    if (activeTab === "files") {
                      fileSearchInputRef.current?.focus();
                      return;
                    }
                    if (activeTab === "documents") {
                      documentSearchInputRef.current?.focus();
                    }
                  }}
                  onShowHeaderMenu={() => {
                    setShowCreateMenu(false);
                    setShowHeaderMenu((current) => !current);
                  }}
                  onSwitchTab={switchChannelTab}
                  pending={isPending}
                  selectedChannel={selectedChannel}
                  showCreateMenu={showCreateMenu}
                  showHeaderMenu={showHeaderMenu}
                  createMenuRef={createMenuRef}
                  headerMenuRef={headerMenuRef}
                  tx={tx}
                />
              )
            : undefined
        }
        items={items}
        listCount={items.length}
        listKicker={conversationView === "direct" ? tx("私聊", "Direct messages") : tx("会话", "Conversations")}
        listTitle={conversationView === "direct" ? tx("私聊", "Direct messages") : tx("会话", "Conversations")}
        mentionCandidates={mentionCandidates}
        messages={messages}
        onSelectItem={(channelId) => {
          markInteraction("conversation-switch");
          setSelectedChannelId(channelId);
          if (activeTab === "documents") {
            setDocumentsView("list");
          }
          replaceChannelRoute(channelId, {
            tab: activeTab,
            documentId: null,
          });
          measureInteraction("conversation-switch");
        }}
        onSubmit={async ({ content, files, replyToMessageId }) => {
          if (!selectedChannel) {
            return;
          }
          const formData = new FormData();
          formData.set("content", content);
          files.forEach((file) => formData.append("attachments", file));

          if (selectedChannel.kind === "direct") {
            if (!selectedChannel.contactId) {
              return;
            }

            formData.set("contactId", selectedChannel.contactId);
            await sendContactMessageAction(formData);
            refreshChannelModule(selectedConversationChannelName);
            return;
          }

          if (!selectedConversationChannelName) {
            return;
          }

          formData.set("channelName", selectedConversationChannelName);
          if (replyToMessageId) {
            formData.set("replyToMessageId", replyToMessageId);
          }
          await sendChannelMessageAction(formData);
          refreshChannelModule(selectedConversationChannelName);
        }}
        onPinMessage={(messageId) => {
          startTransition(async () => {
            try {
              await pinMessageAction(messageId);
            } catch (error) {
              console.error("[pin]", error);
            }
            refreshChannelModule(selectedConversationChannelName);
          });
        }}
        onUnpinMessage={(messageId) => {
          startTransition(async () => {
            try {
              await unpinMessageAction(messageId);
            } catch (error) {
              console.error("[unpin]", error);
            }
            refreshChannelModule(selectedConversationChannelName);
          });
        }}
        onAcknowledgeMessage={(messageId) => {
          startTransition(async () => {
            try {
              await acknowledgeMessageAction(messageId);
            } catch (error) {
              console.error("[acknowledge]", error);
            }
            refreshChannelModule(selectedConversationChannelName);
          });
        }}
        onReviewApproval={async (approvalId, decision) => {
          await runToastAction({
            action: () => reviewInlineApprovalAction(approvalId, decision),
            onSuccess: async (_data, result) => {
              if (result.invalidation) {
                onInvalidation?.(result.invalidation);
              }
              refreshChannelModule(selectedConversationChannelName);
            },
            pushToast,
            tx,
          });
        }}
        placeholder={
          selectedChannel
            ? tx(`发送到 ${selectedChannel.displayName ?? selectedChannel.name}`, `Send to ${selectedChannel.displayName ?? selectedChannel.name}`)
            : tx("发送消息", "Send a message")
        }
        shellClassName={conversationView === "direct" ? "contacts-shell--chatting contacts-shell--digital" : "contacts-shell--chatting"}
        currentUserDisplayName={currentUserDisplayName}
        draftStorageKey={onDataChanged ? `${data.workspaceId}:im:composer` : undefined}
        scrollAnchorStorageKey={onDataChanged ? `${data.workspaceId}:im:scroll-anchors` : undefined}
        onDataChanged={onDataChanged}
        selectedHeader={
          selectedChannel
            ? {
                title: selectedChannel.displayName ?? selectedChannel.name,
                subtitle:
                  selectedChannel.kind === "direct"
                    ? selectedChannel.displaySubtitle ?? tx("私聊", "Direct")
                    : translateMemberLabel(selectedChannel.memberLabel, tx),
                avatar: selectedChannel.avatarLabel ?? "群",
                avatarId: selectedChannel.humanContactUserId ?? selectedChannel.contactId ?? selectedChannel.channelName ?? selectedChannel.id,
                avatarName: selectedChannel.displayName ?? selectedChannel.name,
                avatarVariant: selectedChannel.directParticipantKind === "human" ? "human" : selectedChannel.kind === "direct" ? "agent" : "channel",
              }
            : null
        }
        selectedItemId={selectedChannelId}
        customThreadContent={
          selectedChannel
            ? selectedChannelRequiresAccess
              ? (
                  <ChannelAccessGate
                    accessState={selectedChannel.accessState ?? "requestable"}
                    channelName={selectedChannel.displayName ?? selectedChannel.name}
                    feedback={accessRequestFeedback}
                    pending={isPending}
                    tx={tx}
                    onRequestAccess={() => {
                      startTransition(async () => {
                        try {
                          setAccessRequestFeedback(null);
                          await requestChannelAccessAction(selectedChannel.name, data.workspaceId);
                          refreshChannelModule(selectedConversationChannelName);
                        } catch (error) {
                          setAccessRequestFeedback(error instanceof Error ? error.message : tx("申请失败", "Request failed"));
                        }
                      });
                    }}
                  />
                )
              : !selectedDetailLoaded && selectedDetailLoading
                ? (
                    <ChannelDetailLoadingState
                      tab={activeTab}
                      tx={tx}
                    />
                  )
                : !selectedDetailLoaded && detailLoadError
                  ? (
                      <ChannelDetailErrorState
                        message={detailLoadError}
                        onRetry={() => {
                          if (!selectedConversationChannelName) {
                            return;
                          }
                          setDetailDataByChannelName((current) => {
                            const next = new Map(current);
                            next.delete(selectedConversationChannelName);
                            return next;
                          });
                          setDetailLoadError(null);
                        }}
                        tx={tx}
                      />
                    )
              : activeTab === "files"
              ? (
                  <ChannelFilesView
                    files={filteredChannelFiles}
                    feedback={fileFeedback}
                    onCreateDocument={(attachmentId, fileName) => {
                      startTransition(async () => {
                        try {
                          setDocumentFeedback(null);
                          const result = await createChannelDocumentFromAttachmentAction({
                            channelName: selectedConversationChannelName!,
                            attachmentId,
                            title: fileName.replace(/\.md$/i, ""),
                          });
                          setSelectedDocumentId(result.documentId);
                          setActiveTab("documents");
                          setDocumentsView("workspace");
                          pushChannelRoute(selectedChannel.id, {
                            tab: "documents",
                            documentId: result.documentId,
                          });
                          refreshChannelModule(selectedConversationChannelName);
                        } catch (error) {
                          setDocumentFeedback(error instanceof Error ? error.message : tx("导入失败", "Import failed"));
                        }
                      });
                    }}
                    onFileSearchChange={setFileSearch}
                    onDeleteFile={deleteChannelFile}
                    searchInputRef={fileSearchInputRef}
                    onUpload={() => fileUploadInputRef.current?.click()}
                    pending={isPending}
                    searchValue={fileSearch}
                    tx={tx}
                  />
                )
              : activeTab === "documents"
                ? documentsView === "workspace"
                  ? documentWorkbench
                  : (
                      <ChannelDocumentsOverview
                        archivedDocuments={archivedChannelDocuments}
                        documents={filteredChannelDocuments}
                        onCreateDocument={() => openFreshDocumentWorkspace()}
                        onDocumentSearchChange={setDocumentSearch}
                        searchInputRef={documentSearchInputRef}
                        onDeleteDocument={deleteChannelDocument}
                        onOpenDocument={(documentId) => {
                          setSelectedDocumentId(documentId);
                          setActiveTab("documents");
                          setDocumentsView("workspace");
                          pushChannelRoute(selectedChannel.id, {
                            tab: "documents",
                            documentId,
                          });
                        }}
                        pending={isPending}
                        searchValue={documentSearch}
                        tx={tx}
                      />
                    )
                : undefined
            : undefined
        }
      />

      {showContactRemarkEditor && selectedChannel?.kind === "direct" && selectedChannel.contactId ? (
        <DigitalContactRemarkModal
          contactId={selectedChannel.contactId}
          currentRemark={selectedChannel.displayName ?? selectedChannel.contactId}
          pending={isPending}
          tx={tx}
          onCancel={() => setShowContactRemarkEditor(false)}
          onSave={(remarkName) => {
            startTransition(async () => {
              await updateDigitalContactRemarkAction({
                contactId: selectedChannel.contactId!,
                remarkName,
              });
              setShowContactRemarkEditor(false);
              refreshChannelModule(selectedConversationChannelName);
            });
          }}
        />
      ) : null}

      <input
        hidden
        multiple
        onChange={(event) => {
          startTransition(async () => {
            await uploadChannelFiles(event.currentTarget.files);
            event.currentTarget.value = "";
            refreshChannelModule(selectedConversationChannelName);
          });
        }}
        ref={fileUploadInputRef}
        type="file"
      />
    </>
  );
}

function resolveSelectedChannelName(channel: ChannelsPageData["channels"][number] | null): string | null {
  if (!channel) {
    return null;
  }
  if (typeof channel.channelName === "string" && channel.channelName.length > 0) {
    return channel.channelName;
  }
  return channel.kind === "direct" ? null : channel.name;
}

function buildImChannelDetailResourceKey(channelName: string): string {
  return `channel-detail:${channelName}`;
}

function buildImChannelDetailCacheMetadata(detail: ChannelDetailData, fallbackChannelName: string) {
  const channelNames = new Set<string>(
    [fallbackChannelName, ...(detail.detailScope ?? [])]
      .map((channelName) => channelName.trim())
      .filter(Boolean),
  );
  for (const thread of detail.threads) {
    channelNames.add(thread.channelName);
    for (const message of thread.messages) {
      if (message.channel) {
        channelNames.add(message.channel);
      }
    }
  }
  for (const document of detail.documents) {
    channelNames.add(document.channelName);
  }
  for (const run of detail.documentRuns) {
    channelNames.add(run.channelName);
  }
  for (const file of detail.channelFiles) {
    channelNames.add(file.channelName);
  }

  return {
    resourceRefs: {
      channel: [...channelNames],
      document: detail.documents.map((document) => document.id),
    },
  };
}

function isImPerformanceInstrumentationEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    typeof window !== "undefined" &&
    typeof window.performance?.mark === "function" &&
    typeof window.performance?.measure === "function"
  );
}

function buildDocumentDraftSource(document: ChannelDocumentRecord): string {
  return `${document.id}:${document.currentVersionId}`;
}

function parseChannelWorkspaceTab(value: string | null): ChannelWorkspaceTab | null {
  return value === "messages" || value === "files" || value === "documents" ? value : null;
}

function parseChannelRouteState(routeSearch: string): ChannelRouteState {
  const searchParams = new URLSearchParams(routeSearch);
  const documentId = searchParams.get("doc");
  return {
    focus: searchParams.get("focus"),
    tab: parseChannelWorkspaceTab(searchParams.get("tab")),
    documentId,
    conversationView: searchParams.get("view") === "direct" ? "direct" : "all",
  };
}

function buildChannelFocusValue(channel: ChannelRecord | undefined, fallbackChannelId: string): string {
  if (channel?.kind === "direct" && channel.contactId) {
    return `contact:${channel.contactId}`;
  }
  if (channel?.kind === "direct" && channel.humanContactUserId) {
    return `human:${channel.humanContactUserId}`;
  }
  return `channel:${channel?.channelName ?? fallbackChannelId}`;
}

function readCurrentChannelSearchParams(fallbackSearch: string): URLSearchParams {
  if (typeof window !== "undefined") {
    return new URLSearchParams(window.location.search);
  }
  return new URLSearchParams(fallbackSearch);
}

function normalizeMemberKey(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function buildInitialDocumentDraftContent(
  mode: ChannelDocumentCreateMode,
  tx: (zh: string, en: string) => string,
): string {
  if (mode === "nativeSheet") {
    return [
      `| ${tx("项目", "Item")} | Owner | ${tx("状态", "Status")} |`,
      "|---|---|---|",
      `| ${tx("待补充", "To fill")} |  | ${tx("未开始", "Not started")} |`,
    ].join("\n");
  }

  if (mode === "nativeDeck") {
    return [
      `# ${tx("演示文稿标题", "Deck title")}`,
      "",
      "---",
      "",
      `## ${tx("第一页标题", "First slide title")}`,
      "",
      `- ${tx("要点", "Point")}`,
      `- ${tx("下一步", "Next step")}`,
    ].join("\n");
  }

  return "";
}

function resolveDocumentKindForCreateMode(mode: ChannelDocumentCreateMode): "markdown" | "sheet" | "deck" {
  if (mode === "nativeSheet") {
    return "sheet";
  }
  if (mode === "nativeDeck") {
    return "deck";
  }
  return "markdown";
}

function isStaleChannelDocumentSaveError(message: string): boolean {
  return /updated by someone else/i.test(message);
}

function translateChannelPreview(
  channelId: string,
  threadByChannelName: Map<string, ChannelsPageData["threads"][number]>,
  tx: (zh: string, en: string) => string,
): string | undefined {
  const thread = threadByChannelName.get(channelId);
  const latest = thread?.messages.at(-1);
  if (!latest) {
    return undefined;
  }
  return truncateChannelPreview(
    `${translateSystemSpeaker(latest.speaker, tx)}: ${translateWorkspaceMessageSummary(
      {
        summary: latest.summary,
        code: latest.code,
        data: latest.data,
      },
      tx,
    )}`,
  );
}

function translateChannelAccessPreview(
  accessState: ChannelsPageData["channels"][number]["accessState"],
  tx: (zh: string, en: string) => string,
): string | undefined {
  if (accessState === "pending") {
    return tx("已申请加入，等待管理员审批", "Access requested, waiting for admin approval");
  }
  if (accessState === "requestable") {
    return tx("目录可见，申请后才能查看消息", "Directory visible. Request access to read messages");
  }
  return undefined;
}

function translateChannelListPreview(
  lastMessage: string | undefined,
  tx: (zh: string, en: string) => string,
): string | undefined {
  if (!lastMessage?.trim()) {
    return undefined;
  }
  return truncateChannelPreview(
    translateWorkspaceMessageSummary(
      {
        summary: lastMessage,
      },
      tx,
    ),
  );
}

function truncateChannelPreview(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 180) {
    return trimmed;
  }
  return `${trimmed.slice(0, 177)}...`;
}

function estimateChannelMemberCount(memberLabel: string): number {
  const counts = Array.from(memberLabel.matchAll(/\d+/g))
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value));
  return counts.slice(0, 2).reduce((sum, value) => sum + value, 0);
}

function formatChannelWorkspaceTime(value?: string): string {
  return formatCompactTimestamp(value, { emptyFallback: "—" });
}

function formatChannelFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ChannelAccessGate({
  accessState,
  channelName,
  feedback,
  onRequestAccess,
  pending,
  tx,
}: {
  accessState: "accessible" | "pending" | "requestable";
  channelName: string;
  feedback: string | null;
  onRequestAccess: () => void;
  pending: boolean;
  tx: (zh: string, en: string) => string;
}) {
  const isPendingAccess = accessState === "pending";
  return (
    <div className="channel-access-gate">
      <section className="channel-access-gate__card" aria-label={tx("申请加入群", "Request channel access")}>
        <div className="channel-access-gate__icon">
          <UserPlusIcon />
        </div>
        <div className="channel-access-gate__content">
          <span className="channel-access-gate__eyebrow">{tx("群组访问", "Group access")}</span>
          <h3>
            {isPendingAccess
              ? tx(`已提交加入「${channelName}」申请`, `Request sent for "${channelName}"`)
              : tx(`申请加入「${channelName}」`, `Request to join "${channelName}"`)}
          </h3>
          <p>
            {isPendingAccess
              ? tx("管理员批准后，会自动解锁这个群的消息、文件和文档。", "Messages, files, and documents unlock automatically after an admin approves.")
              : tx("你已经在这个工作区里，可以先看到群名称。提交申请后，管理员批准即可进入群协作。", "You are already in this workspace, so the group is visible. Request access and an admin can approve you into the collaboration flow.")}
          </p>
          <div className="channel-access-gate__steps" aria-hidden="true">
            <span className="channel-access-gate__step channel-access-gate__step--done">{tx("提交申请", "Request")}</span>
            <span className={`channel-access-gate__step${isPendingAccess ? " channel-access-gate__step--active" : ""}`}>
              {tx("管理员审批", "Admin review")}
            </span>
            <span className="channel-access-gate__step">{tx("解锁内容", "Unlock")}</span>
          </div>
          {feedback ? <p aria-live="polite" className="channel-access-gate__feedback" role="status">{feedback}</p> : null}
        </div>
        <div className="channel-access-gate__actions">
          {isPendingAccess ? (
            <span className="status-chip status-chip--active">{tx("等待审批", "Pending approval")}</span>
          ) : (
            <button className="primary-button channel-access-gate__button" disabled={pending} onClick={onRequestAccess} type="button">
              {pending ? tx("提交中...", "Submitting...") : tx("申请加入群", "Request access")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ChannelDetailLoadingState({
  tab,
  tx,
}: {
  tab: ChannelWorkspaceTab;
  tx: (zh: string, en: string) => string;
}) {
  return (
    <div className={`channel-detail-state channel-detail-state--${tab}`} role="status">
      <div className="channel-detail-state__line channel-detail-state__line--wide" />
      <div className="channel-detail-state__line" />
      <div className="channel-detail-state__line channel-detail-state__line--short" />
      <span className="sr-only">{tx("正在加载会话内容", "Loading conversation details")}</span>
    </div>
  );
}

function ChannelDetailErrorState({
  message,
  onRetry,
  tx,
}: {
  message: string;
  onRetry: () => void;
  tx: (zh: string, en: string) => string;
}) {
  return (
    <div className="channel-detail-state channel-detail-state--error">
      <EmptyState
        actionLabel={tx("重试", "Retry")}
        body={message}
        onAction={onRetry}
        title={tx("会话内容加载失败", "Could not load conversation")}
        variant="warm"
      />
    </div>
  );
}

function ChannelWorkspaceHeader({
  activeTab,
  backButton,
  createMenuRef,
  headerMenuRef,
  memberCount,
  onCreateAnnouncement,
  onCreateDocument,
  onCreateNativeDeck,
  onCreateNativeSheet,
  onCreateGoogleSheet,
  onLinkGoogleSheet,
  onCreateLabelPage,
  onDeleteChannel,
  onOpenAddMembers,
  onOpenCalendar,
  onOpenCreateMenu,
  onOpenContactRemark,
  onOpenRename,
  onOpenTaskBoard,
  onSearchAction,
  onShowHeaderMenu,
  onSwitchTab,
  onUploadFiles,
  pending,
  selectedChannel,
  showCreateMenu,
  showHeaderMenu,
  tx,
}: {
  activeTab: ChannelWorkspaceTab;
  backButton: React.ReactNode | null;
  createMenuRef: React.RefObject<HTMLDivElement | null>;
  headerMenuRef: React.RefObject<HTMLDivElement | null>;
  memberCount: number;
  onCreateAnnouncement: () => void;
  onCreateDocument: () => void;
  onCreateNativeDeck: () => void;
  onCreateNativeSheet: () => void;
  onCreateGoogleSheet: () => void;
  onLinkGoogleSheet: () => void;
  onCreateLabelPage: () => void;
  onDeleteChannel: () => void;
  onOpenAddMembers: () => void;
  onOpenCalendar: () => void;
  onOpenCreateMenu: () => void;
  onOpenContactRemark: () => void;
  onOpenRename: () => void;
  onOpenTaskBoard: () => void;
  onSearchAction: () => void;
  onShowHeaderMenu: () => void;
  onSwitchTab: (tab: ChannelWorkspaceTab) => void;
  onUploadFiles: () => void;
  pending: boolean;
  selectedChannel: ChannelsPageData["channels"][number];
  showCreateMenu: boolean;
  showHeaderMenu: boolean;
  tx: (zh: string, en: string) => string;
}) {
  const isDirect = selectedChannel.kind === "direct";
  const canManageChannel = selectedChannel.canManage !== false;
  const canRenameChannel = canRenameChannelFromHeader(selectedChannel);

  return (
    <header className="channel-workspace-header">
      <div className="channel-workspace-header__top">
        <div className="channel-workspace-header__main">
          {backButton ? <div className="channel-workspace-header__back">{backButton}</div> : null}
          <GeneratedAvatar
            className="channel-workspace-header__avatar"
            id={selectedChannel.contactId ?? selectedChannel.channelName ?? selectedChannel.id}
            name={selectedChannel.displayName ?? selectedChannel.name}
            variant={isDirect ? "agent" : "channel"}
          />
          <div className="channel-workspace-header__copy">
            <div className="channel-workspace-header__title-row">
              <h2>{selectedChannel.displayName ?? selectedChannel.name}</h2>
              {canRenameChannel ? (
                <HoverTooltip align="center" content={tx("修改群名", "Rename group")}>
                  {({ describedBy }) => (
                    <button
                      aria-describedby={describedBy}
                      aria-label={tx("修改群名", "Rename group")}
                      className="channel-workspace-header__title-edit-button"
                      onClick={onOpenRename}
                      title={tx("修改群名", "Rename group")}
                      type="button"
                    >
                      <EditIcon />
                    </button>
                  )}
                </HoverTooltip>
              ) : null}
              <span className="channel-workspace-header__members">
                <PeopleOutlineIcon />
                {memberCount}
              </span>
              <span className="channel-workspace-header__badge">{isDirect ? tx("私聊", "Direct") : tx("全员", "All")}</span>
            </div>
            {selectedChannel.displaySubtitle ? (
              <p className="channel-workspace-header__subtitle">{selectedChannel.displaySubtitle}</p>
            ) : null}
          </div>
        </div>

        <div className="channel-workspace-header__actions">
          {isDirect ? (
            <HeaderIconButton label={tx("编辑备注", "Edit remark")} onClick={onOpenContactRemark}>
              <EditIcon />
            </HeaderIconButton>
          ) : null}
          <HeaderIconButton label={tx("搜索", "Search")} onClick={onSearchAction}>
            <SearchIcon />
          </HeaderIconButton>
          <HeaderIconButton label={tx("视频会议", "Video meeting")}>
            <VideoIcon />
          </HeaderIconButton>
          {!isDirect ? (
            <>
              {canManageChannel ? (
                <HoverTooltip align="center" content={tx("添加群成员", "Add members")}>
                  {({ describedBy }) => (
                    <HeaderIconButton describedBy={describedBy} label={tx("添加群成员", "Add members")} onClick={onOpenAddMembers}>
                      <UserPlusIcon />
                    </HeaderIconButton>
                  )}
                </HoverTooltip>
              ) : null}
              <HeaderIconButton label={tx("日历", "Calendar")} onClick={onOpenCalendar}>
                <CalendarIcon />
              </HeaderIconButton>
              <div className="channel-workspace-header__menu-wrap" ref={headerMenuRef}>
                <HeaderIconButton
                  active={showHeaderMenu}
                  label={tx("更多", "More")}
                  onClick={onShowHeaderMenu}
                >
                  <MoreIcon />
                </HeaderIconButton>
                {showHeaderMenu ? (
                  <div className="channel-workspace-header__menu">
                    <button className="channel-workspace-header__menu-item" onClick={onCreateAnnouncement} type="button">
                      <AddCardIcon />
                      <span>{tx("添加群公告", "Add announcement")}</span>
                    </button>
                    <button className="channel-workspace-header__menu-item" onClick={onCreateLabelPage} type="button">
                      <AddCardIcon />
                      <span>{tx("添加标签页", "Add tab page")}</span>
                    </button>
                    <button className="channel-workspace-header__menu-item" onClick={onOpenTaskBoard} type="button">
                      <EditIcon />
                      <span>{tx("查看任务", "View tasks")}</span>
                    </button>
                    {canRenameChannel ? (
                      <button className="channel-workspace-header__menu-item" onClick={onOpenRename} type="button">
                        <EditIcon />
                        <span>{tx("修改群名", "Rename group")}</span>
                      </button>
                    ) : null}
                    {canManageChannel ? (
                      <button
                        className="channel-workspace-header__menu-item channel-workspace-header__menu-item--danger"
                        disabled={pending}
                        onClick={onDeleteChannel}
                        type="button"
                      >
                        <TrashIcon />
                        <span>{tx("删除群组", "Delete group")}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {selectedChannel.feishu ? (
        <FeishuChannelSummaryPanel feishu={selectedChannel.feishu} tx={tx} />
      ) : null}

      <div className="channel-workspace-header__tabs">
        <ChannelTabButton
          active={activeTab === "messages"}
          icon={<MessageBubbleIcon />}
          label={tx("消息", "Messages")}
          onClick={() => onSwitchTab("messages")}
        />
        <ChannelTabButton
          active={activeTab === "files"}
          icon={<FolderIcon />}
          label={tx("文件", "Files")}
          onClick={() => onSwitchTab("files")}
        />
        <ChannelTabButton
          active={activeTab === "documents"}
          icon={<CloudDocIcon />}
          label={tx("云文档", "Docs")}
          onClick={() => onSwitchTab("documents")}
        />
        <div className="channel-workspace-header__menu-wrap" ref={createMenuRef}>
          <button
            aria-label={tx("新建内容", "Create content")}
            className="channel-workspace-header__tab-plus"
            onClick={onOpenCreateMenu}
            type="button"
          >
            +
          </button>
          {showCreateMenu ? (
            <div className="channel-workspace-header__menu channel-workspace-header__menu--compact">
              <button className="channel-workspace-header__menu-item" onClick={onUploadFiles} type="button">
                <FolderIcon />
                <span>{tx("上传文件", "Upload files")}</span>
              </button>
              <button className="channel-workspace-header__menu-item" onClick={onCreateDocument} type="button">
                <CloudDocIcon />
                <span>{tx("新建云文档", "New cloud doc")}</span>
              </button>
              <button className="channel-workspace-header__menu-item" onClick={onCreateNativeSheet} type="button">
                <SheetIcon />
                <span>{tx("新建表格", "New sheet")}</span>
              </button>
              <button className="channel-workspace-header__menu-item" onClick={onCreateNativeDeck} type="button">
                <CloudDocIcon />
                <span>{tx("新建 Deck", "New deck")}</span>
              </button>
              <button className="channel-workspace-header__menu-item" onClick={onCreateGoogleSheet} type="button">
                <SheetIcon />
                <span>{tx("创建 Google Sheet", "Create Google Sheet")}</span>
              </button>
              <button className="channel-workspace-header__menu-item" onClick={onLinkGoogleSheet} type="button">
                <SheetIcon />
                <span>{tx("链接 Google Sheet", "Link Google Sheet")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function canRenameChannelFromHeader(channel: ChannelsPageData["channels"][number]): boolean {
  return channel.kind !== "direct" && (channel.accessState === undefined || channel.accessState === "accessible");
}

type AddChannelMemberCandidate = NonNullable<ChannelsPageData["channelMemberCandidates"]>[number];

function channelMemberCandidateKey(candidate: AddChannelMemberCandidate): string {
  return `${candidate.kind}:${candidate.id}`;
}

function AddChannelMembersModal({
  candidates,
  channelName,
  feedback,
  pending,
  onCancel,
  onConfirm,
}: {
  candidates: AddChannelMemberCandidate[];
  channelName: string;
  feedback: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (input: { userIds: string[]; agentIds: string[] }) => void;
}) {
  const { tx } = useLanguage();
  const { surfaceRef, handleBackdropMouseDown, labelId, descriptionId } = useDialogSurface<HTMLFormElement>(onCancel);
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const filteredCandidates = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) {
      return candidates;
    }
    return candidates.filter((candidate) =>
      `${candidate.label} ${candidate.meta} ${candidate.email ?? ""}`
        .toLocaleLowerCase("zh-CN")
        .includes(keyword),
    );
  }, [candidates, query]);

  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedKeys.includes(channelMemberCandidateKey(candidate))),
    [candidates, selectedKeys],
  );

  return (
    <div className="modal-backdrop" onMouseDown={handleBackdropMouseDown} role="presentation">
      <form
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        aria-modal="true"
        className="modal-card modal-card--channel"
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm({
            userIds: selectedCandidates.filter((candidate) => candidate.kind === "human").map((candidate) => candidate.id),
            agentIds: selectedCandidates.filter((candidate) => candidate.kind === "agent").map((candidate) => candidate.id),
          });
        }}
      >
        <div className="modal-card__header">
          <div>
            <h3 id={labelId}>{tx("添加群成员", "Add members")}</h3>
            <p id={descriptionId}>
              {tx(
                `直接把工作区成员或数字联系人加入「${channelName}」。`,
                `Add workspace members or digital contacts directly to "${channelName}".`,
              )}
            </p>
          </div>
          <button className="modal-close" onClick={onCancel} type="button">
            <AppIcon name="close" />
          </button>
        </div>

        <div className="modal-card__body modal-card__body--channel">
          <label className="form-field form-field--full">
            <span>{tx("群成员", "Members")}</span>
            <input
              autoFocus
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={tx("搜索成员、邮箱或 Agent", "Search members, email, or agents")}
              type="search"
              value={query}
            />
          </label>

          {feedback ? <p aria-live="polite" className="settings-feedback" role="status">{feedback}</p> : null}

          <div className="channel-picker">
            <div className="channel-picker__column">
              <div className="channel-picker__list">
                {filteredCandidates.length > 0 ? (
                  filteredCandidates.map((candidate) => {
                    const key = channelMemberCandidateKey(candidate);
                    const selected = selectedKeys.includes(key);
                    return (
                      <button
                        className={`channel-member-row${selected ? " channel-member-row--selected" : ""}`}
                        key={key}
                        onClick={() =>
                          setSelectedKeys((current) =>
                            current.includes(key)
                              ? current.filter((id) => id !== key)
                              : [...current, key],
                          )
                        }
                        type="button"
                      >
                        <GeneratedAvatar
                          className={`channel-member-row__avatar channel-member-row__avatar--${candidate.kind}`}
                          id={candidate.id}
                          name={candidate.label}
                          variant={candidate.kind}
                        />
                        <div className="channel-member-row__content">
                          <strong>{candidate.label}</strong>
                          <span>{candidate.meta}</span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <EmptyState title={tx("暂无可添加成员", "No available members")} />
                )}
              </div>
            </div>

            <div className="channel-picker__column">
              <div className="panel-header">
                <div>
                  <h3>{tx(`${selectedCandidates.length} 人`, `${selectedCandidates.length} selected`)}</h3>
                </div>
              </div>
              <div className="channel-picker__list">
                {selectedCandidates.length > 0 ? (
                  selectedCandidates.map((candidate) => (
                    <div className="channel-member-row channel-member-row--static" key={channelMemberCandidateKey(candidate)}>
                      <GeneratedAvatar
                        className={`channel-member-row__avatar channel-member-row__avatar--${candidate.kind}`}
                        id={candidate.id}
                        name={candidate.label}
                        variant={candidate.kind}
                      />
                      <div className="channel-member-row__content">
                        <strong>{candidate.label}</strong>
                        <span>{candidate.meta}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState title={tx("未选择成员", "No members selected")} />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-card__footer">
          <button className="modal-secondary-button" onClick={onCancel} type="button">
            {tx("取消", "Cancel")}
          </button>
          <button className="primary-button" disabled={pending || selectedCandidates.length === 0} type="submit">
            {pending ? tx("添加中...", "Adding...") : tx("添加", "Add")}
          </button>
        </div>
      </form>
    </div>
  );
}

function DigitalContactRemarkModal({
  contactId,
  currentRemark,
  pending,
  tx,
  onCancel,
  onSave,
}: {
  contactId: string;
  currentRemark: string;
  pending: boolean;
  tx: (zh: string, en: string) => string;
  onCancel: () => void;
  onSave: (remarkName: string) => void;
}) {
  const { surfaceRef, handleBackdropMouseDown, labelId, descriptionId } = useDialogSurface<HTMLFormElement>(onCancel);

  return (
    <div className="modal-backdrop" onMouseDown={handleBackdropMouseDown} role="presentation">
      <form
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        aria-modal="true"
        className="modal-card modal-card--compact"
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          onSave((formData.get("remarkName") as string | null)?.trim() || contactId);
        }}
      >
        <div className="modal-card__header">
          <div>
            <h3 id={labelId}>{tx("编辑联系人备注", "Edit contact remark")}</h3>
            <p id={descriptionId}>{tx("备注会显示在数字联系人列表和聊天标题中。", "The remark appears in the digital contacts list and chat title.")}</p>
          </div>
          <button className="modal-close" onClick={onCancel} type="button">
            <AppIcon name="close" />
          </button>
        </div>
        <div className="modal-card__body">
          <label className="form-field">
            <span>{tx("联系人备注", "Contact remark")}</span>
            <input
              aria-label={tx("联系人备注", "Contact remark")}
              autoFocus
              defaultValue={currentRemark}
              name="remarkName"
              placeholder={contactId}
              type="text"
            />
            <small className="form-field__hint">{tx(`原始名称：${contactId}`, `Original name: ${contactId}`)}</small>
          </label>
        </div>
        <div className="modal-card__footer">
          <button className="modal-secondary-button" onClick={onCancel} type="button">
            {tx("取消", "Cancel")}
          </button>
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? tx("保存中...", "Saving...") : tx("保存备注", "Save remark")}
          </button>
        </div>
      </form>
    </div>
  );
}

function ChannelTabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`channel-workspace-tab${active ? " channel-workspace-tab--active" : ""}`}
      onClick={onClick}
      type="button"
    >
      <span className="channel-workspace-tab__icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function HeaderIconButton({
  active = false,
  children,
  describedBy,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  describedBy?: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      aria-describedby={describedBy}
      aria-label={label}
      className={`channel-workspace-header__icon-button${active ? " channel-workspace-header__icon-button--active" : ""}`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function ChannelFilesView({
  files,
  feedback,
  onCreateDocument,
  onDeleteFile,
  onFileSearchChange,
  searchInputRef,
  onUpload,
  pending,
  searchValue,
  tx,
}: {
  files: ChannelsPageData["channelFiles"];
  feedback: string | null;
  onCreateDocument: (attachmentId: string, fileName: string) => void;
  onDeleteFile: (file: ChannelsPageData["channelFiles"][number]) => void;
  onFileSearchChange: (value: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: () => void;
  pending: boolean;
  searchValue: string;
  tx: (zh: string, en: string) => string;
}) {
  return (
    <section className="channel-workspace-panel">
      <div className="channel-workspace-panel__toolbar">
        <SearchField
          inputRef={searchInputRef}
          onChange={onFileSearchChange}
          placeholder={tx("搜索会话内的文件", "Search files in this channel")}
          value={searchValue}
        />
        <button className="action-button" disabled={pending} onClick={onUpload} type="button">
          {tx("上传文件", "Upload")}
        </button>
      </div>
      {feedback ? <p aria-live="polite" className="settings-feedback" role="status">{feedback}</p> : null}

      <div className="channel-workspace-list">
        <div className="channel-workspace-list__head">
          <span>{tx("标题", "Title")}</span>
          <span>{tx("发送人", "Sender")}</span>
          <span>{tx("发送时间", "Sent at")}</span>
          <span>{tx("操作", "Actions")}</span>
        </div>
        {files.length > 0 ? (
          files.map((file) => (
            <div className="channel-workspace-row" key={file.id}>
              <div className="channel-workspace-row__title">
                <span className={`channel-workspace-row__icon channel-workspace-row__icon--${file.kind}`}>
                  {file.kind === "image" ? "IMG" : file.mediaType.includes("pdf") ? "PDF" : "FILE"}
                </span>
                <div>
                  <strong>{file.fileName}</strong>
                  <small>{formatChannelFileSize(file.sizeBytes)}</small>
                </div>
              </div>
              <span>{translateSystemSpeaker(file.sourceSpeaker, tx) || tx("未知", "Unknown")}</span>
              <span>{formatChannelWorkspaceTime(file.sourceTime)}</span>
              <div className="channel-workspace-row__actions">
                <a className="action-button" href={`/api/attachments/${file.id}`} rel="noreferrer" target="_blank">
                  {tx("打开", "Open")}
                </a>
                {file.isMarkdown ? (
                  <button className="action-button" disabled={pending} onClick={() => onCreateDocument(file.id, file.fileName)} type="button">
                    {tx("转为云文档", "Import")}
                  </button>
                ) : null}
                {file.canDelete ? (
                  <button
                    className="action-button action-button--danger"
                    disabled={pending}
                    onClick={() => onDeleteFile(file)}
                    type="button"
                  >
                    {tx("删除", "Delete")}
                  </button>
                ) : file.deleteBlockedReason ? (
                  <button className="action-button" disabled title={file.deleteBlockedReason} type="button">
                    {tx("删除", "Delete")}
                  </button>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            body={tx("发送附件后，文件会出现在这里。", "Files sent to this channel will appear here.")}
            title={tx("还没有群文件", "No shared files yet")}
          />
        )}
      </div>
    </section>
  );
}

function ChannelDocumentsOverview({
  archivedDocuments,
  documents,
  onCreateDocument,
  onDeleteDocument,
  onDocumentSearchChange,
  searchInputRef,
  onOpenDocument,
  pending,
  searchValue,
  tx,
}: {
  archivedDocuments: ChannelsPageData["documents"];
  documents: ChannelsPageData["documents"];
  onCreateDocument: () => void;
  onDeleteDocument: (document: ChannelsPageData["documents"][number]) => void;
  onDocumentSearchChange: (value: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onOpenDocument: (documentId: string) => void;
  pending: boolean;
  searchValue: string;
  tx: (zh: string, en: string) => string;
}) {
  return (
    <section className="channel-workspace-panel">
      <div className="channel-workspace-panel__toolbar">
        <SearchField
          inputRef={searchInputRef}
          onChange={onDocumentSearchChange}
          placeholder={tx("搜索会话内的云文档", "Search docs in this channel")}
          value={searchValue}
        />
        <button className="action-button" disabled={pending} onClick={onCreateDocument} type="button">
          {tx("新建云文档", "New doc")}
        </button>
      </div>

      <div className="channel-workspace-list">
        <div className="channel-workspace-list__head">
          <span>{tx("标题", "Title")}</span>
          <span>{tx("发送人", "Author")}</span>
          <span>{tx("发送时间", "Updated")}</span>
          <span>{tx("操作", "Actions")}</span>
        </div>
        {documents.length > 0 ? (
          documents.map((document) => (
            <div className="channel-workspace-row" key={document.id}>
              <div className="channel-workspace-row__title">
                <span className="channel-workspace-row__icon channel-workspace-row__icon--doc">
                  {document.externalSheet ? <SheetIcon /> : <CloudDocIcon />}
                </span>
                <div>
                  <strong>{document.title}</strong>
                  <small>{document.summary || tx("暂无摘要", "No summary yet")}</small>
                  {document.externalSheet ? (
                    <small>
                      {tx("Google Sheet", "Google Sheet")} · {document.externalSheet.syncStatus === "ok" ? tx("已连接", "Connected") : tx("需检查", "Needs check")}
                    </small>
                  ) : null}
                </div>
              </div>
              <span>{translateSystemSpeaker(document.updatedBy, tx)}</span>
              <span>{formatChannelWorkspaceTime(document.updatedAt)}</span>
              <div className="channel-workspace-row__actions">
                <button className="action-button" onClick={() => onOpenDocument(document.id)} type="button">
                  {tx("打开", "Open")}
                </button>
                {document.externalSheet ? (
                  <a className="action-button" href={document.externalSheet.externalUrl} rel="noreferrer" target="_blank">
                    {tx("表格", "Sheet")}
                  </a>
                ) : null}
                <button
                  className="action-button action-button--danger"
                  disabled={pending || document.currentUserRole !== "owner"}
                  onClick={() => onDeleteDocument(document)}
                  title={document.currentUserRole === "owner" ? undefined : tx("只有所有者可以删除", "Only owners can delete")}
                  type="button"
                >
                  {tx("删除", "Delete")}
                </button>
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            body={tx("先创建一份群组云文档，用来沉淀长期协作内容。", "Create a cloud doc first for long-term collaboration.")}
            title={tx("还没有云文档", "No cloud docs yet")}
          />
        )}
      </div>

      {archivedDocuments.length > 0 ? (
        <div className="channel-workspace-archived">
          <div className="channel-workspace-archived__header">
            <strong>{tx("已删除文档", "Deleted docs")}</strong>
            <span>{archivedDocuments.length}</span>
          </div>
          <div className="channel-workspace-archived__list">
            {archivedDocuments.map((document) => (
              <div className="channel-workspace-archived__item" key={document.id}>
                <strong>{document.title}</strong>
                <small>
                  {translateSystemSpeaker(document.updatedBy, tx)} · {formatChannelWorkspaceTime(document.updatedAt)}
                </small>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SearchField({
  inputRef,
  onChange,
  placeholder,
  value,
}: {
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="channel-workspace-search">
      <span className="channel-workspace-search__icon">
        <SearchIcon />
      </span>
      <input
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        ref={inputRef}
        type="search"
        value={value}
      />
    </label>
  );
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M13.5 13.5L18 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <rect height="11" rx="2" stroke="currentColor" strokeWidth="1.8" width="10" x="2.5" y="4.5" />
      <path d="M12.5 8L17 5.5V14.5L12.5 12" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <circle cx="8" cy="6.5" r="2.7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 15.5C4.2 12.8 6.1 11.5 8 11.5C9.9 11.5 11.8 12.8 12.5 15.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M15 6V12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 9H18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <rect height="13" rx="2" stroke="currentColor" strokeWidth="1.8" width="13" x="3.5" y="4.5" />
      <path d="M6.5 2.5V6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M13.5 2.5V6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M3.5 8H16.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 20 20">
      <circle cx="4" cy="10" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="16" cy="10" r="1.5" />
    </svg>
  );
}

function MessageBubbleIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M5 5.5H15C16.1 5.5 17 6.4 17 7.5V11.5C17 12.6 16.1 13.5 15 13.5H10L6.2 16.2C5.8 16.5 5.2 16.2 5.2 15.7V13.5H5C3.9 13.5 3 12.6 3 11.5V7.5C3 6.4 3.9 5.5 5 5.5Z" fill="currentColor" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M2.5 6.5C2.5 5.4 3.4 4.5 4.5 4.5H8L9.7 6H15.5C16.6 6 17.5 6.9 17.5 8V13.5C17.5 14.6 16.6 15.5 15.5 15.5H4.5C3.4 15.5 2.5 14.6 2.5 13.5V6.5Z" fill="currentColor" />
    </svg>
  );
}

function CloudDocIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <rect fill="currentColor" height="14" rx="2.5" width="11" x="3" y="3" />
      <path d="M7 7H11" stroke="#fff" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M7 10H11" stroke="#fff" strokeLinecap="round" strokeWidth="1.6" />
      <circle cx="14.5" cy="13.5" fill="#5cc58d" r="3.5" />
      <path d="M12.8 13.5H16.2" stroke="#fff" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

function SheetIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <rect fill="currentColor" height="14" rx="2.5" width="14" x="3" y="3" />
      <path d="M7 3V17M13 3V17M3 8H17M3 13H17" stroke="#fff" strokeWidth="1.2" />
    </svg>
  );
}

function PeopleOutlineIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 14.8C4 12.8 5.3 11.7 7 11.7C8.7 11.7 10 12.8 10.5 14.8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <circle cx="13.5" cy="8" r="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function AddCardIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <rect height="11" rx="2" stroke="currentColor" strokeWidth="1.7" width="12" x="4" y="4.5" />
      <path d="M10 7.5V12.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M7.5 10H12.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M4 13.8L13.5 4.3L15.7 6.5L6.2 16H4V13.8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path d="M5 6H15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M7 6V4.8C7 4.1 7.6 3.5 8.3 3.5H11.7C12.4 3.5 13 4.1 13 4.8V6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6.2 6L6.8 15.2C6.8 15.9 7.4 16.5 8.1 16.5H11.9C12.6 16.5 13.2 15.9 13.2 15.2L13.8 6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function RenameChannelModal({
  channelName,
  languageLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  channelName: string;
  languageLabel: (zh: string, en: string) => string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (nextName: string) => void;
}) {
  const { surfaceRef, handleBackdropMouseDown, labelId, descriptionId } = useDialogSurface<HTMLFormElement>(onCancel);
  return (
    <div className="modal-backdrop" onMouseDown={handleBackdropMouseDown} role="presentation">
      <form
        className="modal-card modal-card--compact"
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        aria-modal="true"
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const nextName = ((formData.get("nextName") as string | null) ?? "").trim();
          onConfirm(nextName);
        }}
      >
        <div className="modal-card__header">
          <div>
            <h3 id={labelId}>{languageLabel("修改群组名称", "Rename channel")}</h3>
            <p id={descriptionId}>{languageLabel(`当前群组：${channelName}`, `Current channel: ${channelName}`)}</p>
          </div>
          <button className="modal-close" onClick={onCancel} type="button">
            <AppIcon name="close" />
          </button>
        </div>
        <div className="modal-card__body">
          <label className="form-field">
            <span>{languageLabel("新名称", "New name")}</span>
            <input autoFocus defaultValue={channelName} name="nextName" type="text" />
          </label>
        </div>
        <div className="modal-card__footer">
          <button className="modal-secondary-button" onClick={onCancel} type="button">
            {languageLabel("取消", "Cancel")}
          </button>
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? languageLabel("保存中...", "Saving...") : languageLabel("保存", "Save")}
          </button>
        </div>
      </form>
    </div>
  );
}
