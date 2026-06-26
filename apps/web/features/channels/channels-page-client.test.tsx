import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelsPageClient } from "@/features/channels/channels-page-client";
import { WorkspaceModuleCacheProvider, useWorkspaceModuleCache } from "@/features/dashboard/workspace-module-cache";
import { WorkspaceModuleNavigationProvider } from "@/features/dashboard/workspace-module-navigation";
import { LanguageProvider } from "@/features/i18n/language-provider";
import { FeedbackToastProvider } from "@/shared/ui/feedback-toast-provider";
import type { ChannelsPageData } from "@/features/dashboard/data";

function TestProviders({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider initialLanguage="zh">
      <FeedbackToastProvider>{children}</FeedbackToastProvider>
    </LanguageProvider>
  );
}

function SeedImChannelDetailCache({
  children,
}: {
  children: React.ReactNode;
}) {
  const cache = useWorkspaceModuleCache();

  useEffect(() => {
    cache.set(
      {
        workspaceId: "workspace-1",
        moduleId: "im",
        resourceKey: "channel-detail:planning",
      },
      {
        threads: [
          {
            channelName: "planning",
            messages: [
              {
                id: "cached-planning-message",
                channel: "planning",
                speaker: "Atlas",
                role: "agent",
                time: "11:05",
                summary: "cached planning detail",
                status: "completed",
              },
            ],
          },
        ],
        documents: [],
        documentRuns: [],
        documentConflicts: [],
        channelFiles: [],
        detailScope: ["planning"],
      },
    );
  }, [cache]);

  return <>{children}</>;
}

function CaptureImChannelDetailCache({
  onReady,
}: {
  onReady?: (cache: ReturnType<typeof useWorkspaceModuleCache>) => void;
}) {
  const cache = useWorkspaceModuleCache();

  useEffect(() => {
    onReady?.(cache);
  }, [cache, onReady]);

  return null;
}

const searchParams = new URLSearchParams();
const {
  routerReplaceMock,
  routerPushMock,
  routerRefreshMock,
  addWorkspaceMembersToChannelActionMock,
  archiveChannelDocumentActionMock,
  deleteChannelAttachmentActionMock,
  getChannelDetailDataActionMock,
  renameChannelActionMock,
  sendChannelMessageActionMock,
  sendContactMessageActionMock,
  updateDigitalContactRemarkActionMock,
} = vi.hoisted(() => ({
  routerReplaceMock: vi.fn(),
  routerPushMock: vi.fn(),
  routerRefreshMock: vi.fn(),
  addWorkspaceMembersToChannelActionMock: vi.fn(async () => {}),
  archiveChannelDocumentActionMock: vi.fn(async () => {}),
  deleteChannelAttachmentActionMock: vi.fn(async () => {}),
  getChannelDetailDataActionMock: vi.fn(async ({ channelName }: { channelName: string }) => ({
    threads: [],
    documents: [],
    documentRuns: [],
    documentConflicts: [],
    channelFiles: [],
    detailScope: [channelName],
  })),
  renameChannelActionMock: vi.fn(async () => {}),
  sendChannelMessageActionMock: vi.fn<(formData: FormData) => Promise<void>>(async () => {}),
  sendContactMessageActionMock: vi.fn<(formData: FormData) => Promise<void>>(async () => {}),
  updateDigitalContactRemarkActionMock: vi.fn(async () => {}),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    push: routerPushMock,
    refresh: routerRefreshMock,
  }),
  usePathname: () => "/w/workspace-alpha/im",
  useSearchParams: () => ({
    get: (key: string) => searchParams.get(key),
    toString: () => searchParams.toString(),
  }),
}));

vi.mock("@/features/channels/actions", () => ({
  addWorkspaceMembersToChannelAction: addWorkspaceMembersToChannelActionMock,
  addChannelDocumentCollaboratorAction: vi.fn(async () => {}),
  archiveChannelDocumentAction: archiveChannelDocumentActionMock,
  createGoogleSheetDocumentAction: vi.fn(async () => ({ documentId: "sheet-created" })),
  createExternalGoogleSheetDocumentAction: vi.fn(async () => ({ documentId: "sheet-1" })),
  createChannelDocumentFromAttachmentAction: vi.fn(async () => ({ documentId: "doc-1" })),
  getChannelDetailDataAction: getChannelDetailDataActionMock,
  deleteChannelAttachmentAction: deleteChannelAttachmentActionMock,
  deleteChannelAction: vi.fn(async () => {}),
  exportChannelDocumentAttachmentAction: vi.fn(async () => {}),
  pinMessageAction: vi.fn(async () => {}),
  unpinMessageAction: vi.fn(async () => {}),
  acknowledgeMessageAction: vi.fn(async () => {}),
  removeChannelDocumentCollaboratorAction: vi.fn(async () => {}),
  renameChannelAction: renameChannelActionMock,
  resolveChannelDocumentConflictAction: vi.fn(async () => {}),
  retryChannelDocumentConflictAction: vi.fn(async () => ({ documentId: "doc-1" })),
  touchChannelDocumentPresenceAction: vi.fn(async () => {}),
  updateDigitalContactRemarkAction: updateDigitalContactRemarkActionMock,
  updateChannelDocumentAccessRoleAction: vi.fn(async () => {}),
  rollbackChannelDocumentVersionAction: vi.fn(async () => ({ documentId: "doc-1" })),
  saveChannelDocumentAction: vi.fn(async () => ({ documentId: "doc-1" })),
  sendChannelMessageAction: sendChannelMessageActionMock,
  sendContactMessageAction: sendContactMessageActionMock,
}));

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(max-width: 860px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const data: ChannelsPageData = {
  workspaceId: "workspace-1",
  googleWorkspace: {
    status: "not_connected",
  },
  channels: [
    {
      id: "tour visit",
      name: "tour visit",
      memberLabel: "1 humans / 1 agents",
      humanMemberNames: ["Tianyu"],
      employeeNames: ["Atlas"],
      lastMessage: "请查看附件。",
      updatedAt: "10:00",
    },
  ],
  threads: [
    {
      channelName: "tour visit",
      messages: [
        {
          id: "message-1",
          channel: "tour visit",
          speaker: "Atlas",
          role: "agent",
          time: "10:00",
          summary: "请查看附件。",
          status: "completed",
          attachments: [
            {
              id: "att-channel-image",
              fileName: "preview.png",
              mediaType: "image/png",
              sizeBytes: 2048,
              kind: "image",
              storedPath: "/tmp/preview.png",
            },
            {
              id: "att-channel-file",
              fileName: "summary.pdf",
              mediaType: "application/pdf",
              sizeBytes: 4096,
              kind: "file",
              storedPath: "/tmp/summary.pdf",
            },
          ],
        },
      ],
    },
  ],
  documents: [
    {
      id: "doc-1",
      channelName: "tour visit",
      title: "大阪行程文档",
      slug: "osaka-itinerary",
      kind: "markdown",
      storageMode: "native",
      currentVersionId: "ver-1",
      summary: "春季草稿",
      status: "active",
      updatedAt: "2026-04-10T09:00:00.000Z",
      updatedBy: "Tianyu",
      lastEditorType: "human",
      contentMarkdown: "## Day 1",
      versionCount: 1,
      conflictCount: 0,
      versions: [],
      changeSets: [],
      activePresences: [],
      currentUserRole: "owner",
      collaborators: [],
      availableCollaborators: [],
      externalSheetOperations: [],
    },
  ],
  documentRuns: [],
  documentConflicts: [],
  channelFiles: [],
  mentionCandidates: [],
  channelMemberCandidates: [
    {
      id: "user-mina",
      label: "Mina",
      kind: "human",
      meta: "mina@example.com",
      email: "mina@example.com",
    },
    {
      id: "Vega",
      label: "Vega",
      kind: "agent",
      meta: "Vega",
    },
  ],
  totalChannels: 1,
};

class MockEventSource {
  readonly url: string;
  private listeners = new Map<string, EventListener[]>();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

describe("ChannelsPageClient", () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  beforeEach(() => {
    Array.from(searchParams.keys()).forEach((key) => searchParams.delete(key));
    window.history.replaceState(window.history.state, "", "/");
    mockMatchMedia(false);
    routerReplaceMock.mockReset();
    routerPushMock.mockReset();
    routerRefreshMock.mockReset();
    addWorkspaceMembersToChannelActionMock.mockClear();
    archiveChannelDocumentActionMock.mockClear();
    deleteChannelAttachmentActionMock.mockClear();
    getChannelDetailDataActionMock.mockClear();
    renameChannelActionMock.mockClear();
    sendChannelMessageActionMock.mockClear();
    sendContactMessageActionMock.mockClear();
    updateDigitalContactRemarkActionMock.mockClear();
  });

  it("renders image previews and file links for channel attachments", () => {
    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    expect(screen.getByAltText("preview.png")).toHaveAttribute("src", "/api/attachments/att-channel-image");
    expect(screen.getByRole("link", { name: /summary\.pdf/i })).toHaveAttribute("href", "/api/attachments/att-channel-file");
  });

  it("shows Feishu group binding context in the selected channel header", () => {
    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            channels: [
              {
                ...data.channels[0]!,
                feishu: {
                  bindingCount: 1,
                  externalChatReference: "chat b2295ba0",
                  externalChatName: "Launch Room",
                  provisionSource: "bot_added",
                  reviewStatus: "approved",
                  connectedAgentBots: [
                    {
                      integrationId: "agent-bot-codex",
                      displayName: "Codex Feishu Bot",
                      agentId: "Codex",
                      status: "active",
                      unboundUserMode: "reply_on_mention",
                      guestPermissionProfile: "channel_context_only",
                    },
                  ],
                  resourceBindings: [
                    {
                      id: "resource-doc-1",
                      integrationId: "agent-bot-codex",
                      integrationDisplayName: "Codex Feishu Bot",
                      providerResourceType: "doc",
                      displayName: "Launch Doc",
                      canWrite: true,
                      guestReadable: true,
                      status: "active",
                    },
                  ],
                },
              },
            ],
          }}
        />
      </TestProviders>,
    );

    const feishuSummary = screen.getByLabelText(/飞书群聊绑定|Feishu group binding/);
    expect(within(feishuSummary).getByText("Launch Room")).toBeInTheDocument();
    expect(within(feishuSummary).getByText("chat b2295ba0")).toBeInTheDocument();
    expect(within(feishuSummary).getByText("Codex")).toBeInTheDocument();
    expect(within(feishuSummary).getByText(/未绑定用户：@Bot 时回复/)).toBeInTheDocument();
    expect(within(feishuSummary).getByText(/访客权限：当前 Channel 上下文/)).toBeInTheDocument();
    expect(within(feishuSummary).getByText("Doc")).toBeInTheDocument();
    expect(within(feishuSummary).getByText("Launch Doc")).toBeInTheDocument();
    expect(within(feishuSummary).getByText(/Guest readable/)).toBeInTheDocument();
    expect(within(feishuSummary).getByText(/写入需审批/)).toBeInTheDocument();
  });

  it("subscribes to channel realtime events and debounces refreshes without clearing the draft", async () => {
    const eventSources: MockEventSource[] = [];
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: class extends MockEventSource {
        constructor(url: string) {
          super(url);
          eventSources.push(this);
        }
      },
    });

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    const composer = screen.getByPlaceholderText("发送到 tour visit");
    fireEvent.change(composer, { target: { value: "草稿", selectionStart: 2 } });
    expect(eventSources[0]?.url).toBe("/api/workspaces/workspace-1/channels/tour%20visit/events");

    const activeSource = eventSources.at(-1);
    activeSource?.emit("channel.message.created", {
      channelName: "tour visit",
      messageId: "message-2",
      sequence: 1,
    });
    activeSource?.emit("channel.message.created", {
      channelName: "tour visit",
      messageId: "message-3",
      sequence: 2,
    });

    expect(routerRefreshMock).not.toHaveBeenCalled();
    await waitFor(() => expect(routerRefreshMock).toHaveBeenCalledTimes(1));
    expect(composer).toHaveValue("草稿");
  });

  it("keeps the composer draft when switching between messages and files", async () => {
    const user = userEvent.setup();

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    const composer = screen.getByPlaceholderText("发送到 tour visit");
    fireEvent.change(composer, { target: { value: "还没发出的草稿", selectionStart: 7 } });

    await user.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByPlaceholderText("搜索会话内的文件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "消息" }));
    expect(screen.getByPlaceholderText("发送到 tour visit")).toHaveValue("还没发出的草稿");
  });

  it("keeps reply target and pending files when switching between messages and files", async () => {
    const user = userEvent.setup();

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "回复" }));
    const fileInput = document.querySelector<HTMLInputElement>(".contacts-picker-wrap input[type='file']:not([accept])");
    expect(fileInput).not.toBeNull();

    await user.upload(fileInput as HTMLInputElement, new File(["draft"], "draft.txt", { type: "text/plain" }));
    expect(screen.getByText("draft.txt")).toBeInTheDocument();
    expect(screen.getAllByText("请查看附件。").length).toBeGreaterThan(1);

    await user.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByPlaceholderText("搜索会话内的文件")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "消息" }));
    expect(screen.getByText("draft.txt")).toBeInTheDocument();
    expect(screen.getAllByText("请查看附件。").length).toBeGreaterThan(1);
  });

  it("keeps the document draft across same-version data refreshes", async () => {
    searchParams.set("tab", "documents");
    searchParams.set("doc", "doc-1");

    const { rerender } = render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    const editor = await screen.findByLabelText("Markdown 内容");
    fireEvent.change(editor, { target: { value: "## Local draft" } });

    rerender(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            documents: data.documents.map((document) => ({
              ...document,
              summary: "服务端刷新但版本不变",
              updatedAt: "2026-04-10T09:01:00.000Z",
            })),
          }}
        />
      </TestProviders>,
    );

    expect(screen.getByLabelText("Markdown 内容")).toHaveValue("## Local draft");
  });

  it("does not render cached thread content for channels without read access", () => {
    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            channels: data.channels.map((channel) => ({
              ...channel,
              accessState: "requestable",
            })),
            threads: [
              {
                channelName: "tour visit",
                messages: [
                  {
                    id: "secret-message",
                    channel: "tour visit",
                    speaker: "Atlas",
                    role: "agent",
                    time: "10:05",
                    summary: "restricted cached content",
                    status: "completed",
                  },
                ],
              },
            ],
          }}
        />
      </TestProviders>,
    );

    expect(screen.getByRole("button", { name: "申请加入群" })).toBeInTheDocument();
    expect(screen.queryByText("restricted cached content")).not.toBeInTheDocument();
  });

  it("pauses polling refreshes while the page is hidden", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            threads: [
              {
                channelName: "tour visit",
                messages: data.threads[0]!.messages.map((message) => ({
                  ...message,
                  status: "pending",
                })),
              },
            ],
          }}
        />
      </TestProviders>,
    );

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(routerRefreshMock).not.toHaveBeenCalled();
  });

  it("turns channel realtime events into targeted workspace invalidation hints", async () => {
    const eventSources: MockEventSource[] = [];
    const onInvalidation = vi.fn();
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: class extends MockEventSource {
        constructor(url: string) {
          super(url);
          eventSources.push(this);
        }
      },
    });

    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={data}
          onInvalidation={onInvalidation}
        />
      </TestProviders>,
    );

    eventSources.at(-1)?.emit("channel.thread.changed", {
      channelName: "tour visit",
      sequence: 3,
    });

    await waitFor(() => {
      expect(onInvalidation).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        resources: [{ type: "channel", id: "tour visit" }],
        shell: "counters",
      });
    });
  });

  it("pauses polling refreshes while the composer is focused", () => {
    vi.useFakeTimers();

    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            threads: [
              {
                channelName: "tour visit",
                messages: data.threads[0]!.messages.map((message) => ({
                  ...message,
                  status: "pending",
                })),
              },
            ],
          }}
        />
      </TestProviders>,
    );

    const composer = screen.getByPlaceholderText("发送到 tour visit");
    composer.focus();

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(routerRefreshMock).not.toHaveBeenCalled();

    composer.blur();

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("keeps mobile drill-down state stable when entering and returning from a thread", async () => {
    const user = userEvent.setup();
    mockMatchMedia(true);

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    let threadPane = document.querySelector<HTMLElement>(".contacts-chat-pane");
    expect(threadPane).not.toBeNull();
    await user.click(within(threadPane as HTMLElement).getByRole("button", { name: "返回列表" }));

    expect(screen.getByRole("button", { name: /tour visit/ })).toBeInTheDocument();
    expect(document.querySelector(".contacts-chat-pane")).toBeNull();

    await user.click(screen.getByRole("button", { name: /tour visit/ }));

    threadPane = document.querySelector<HTMLElement>(".contacts-chat-pane");
    expect(threadPane).not.toBeNull();
    expect(within(threadPane as HTMLElement).getByPlaceholderText("发送到 tour visit")).toBeInTheDocument();

    await user.click(within(threadPane as HTMLElement).getByRole("button", { name: "返回列表" }));

    expect(screen.getByRole("button", { name: /tour visit/ })).toBeInTheDocument();
    expect(document.querySelector(".contacts-chat-pane")).toBeNull();
  });

  it("deletes removable channel files from the files tab", async () => {
    const user = userEvent.setup();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);
    const dataWithFiles: ChannelsPageData = {
      ...data,
      channelFiles: [
        {
          id: "att-removable",
          channelName: "tour visit",
          fileName: "brief.md",
          sourceMessageId: "message-1",
          sourceSpeaker: "Tianyu",
          sourceTime: "2026-04-30T10:00:00.000Z",
          uploaderUserId: "user-1",
          uploaderDisplayName: "Tianyu",
          mediaType: "text/markdown",
          sizeBytes: 42,
          kind: "file",
          isMarkdown: true,
          canDelete: true,
          retainedBecauseReferenced: false,
        },
      ],
    };

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={dataWithFiles} />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "文件" }));
    await user.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => {
      expect(deleteChannelAttachmentActionMock).toHaveBeenCalledWith({
        channelName: "tour visit",
        attachmentId: "att-removable",
      });
    });
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("brief.md"));
    expect(routerRefreshMock).toHaveBeenCalled();
    confirmMock.mockRestore();
  });

  it("deletes cloud documents from the documents list with confirmation", async () => {
    const user = userEvent.setup();
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "云文档" }));
    const row = screen.getByText("大阪行程文档").closest(".channel-workspace-row");
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole("button", { name: "删除" }));

    await waitFor(() => expect(archiveChannelDocumentActionMock).toHaveBeenCalledWith("doc-1"));
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("大阪行程文档"));
    expect(routerRefreshMock).toHaveBeenCalled();
    confirmMock.mockRestore();
  });

  it("renders the add-members tooltip through the shared hover tooltip pattern", async () => {
    const user = userEvent.setup();

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    const addMembersButton = screen.getByRole("button", { name: "添加群成员" });
    expect(addMembersButton).toHaveAttribute("aria-describedby");
    await user.hover(addMembersButton);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("添加群成员");
  });

  it("adds selected workspace members from the channel header", async () => {
    const user = userEvent.setup();

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "添加群成员" }));
    const dialog = screen.getByRole("dialog", { name: "添加群成员" });
    await user.click(within(dialog).getByRole("button", { name: /Mina/ }));
    await user.click(within(dialog).getByRole("button", { name: "添加" }));

    await waitFor(() => {
      expect(addWorkspaceMembersToChannelActionMock).toHaveBeenCalledWith({
        channelName: "tour visit",
        workspaceId: "workspace-1",
        userIds: ["user-mina"],
        agentIds: [],
      });
    });
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("adds selected digital contacts from the channel header", async () => {
    const user = userEvent.setup();

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "添加群成员" }));
    const dialog = screen.getByRole("dialog", { name: "添加群成员" });
    await user.click(within(dialog).getByRole("button", { name: /Vega/ }));
    await user.click(within(dialog).getByRole("button", { name: "添加" }));

    await waitFor(() => {
      expect(addWorkspaceMembersToChannelActionMock).toHaveBeenCalledWith({
        channelName: "tour visit",
        workspaceId: "workspace-1",
        userIds: [],
        agentIds: ["Vega"],
      });
    });
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("renames the group from the edit icon beside the title", async () => {
    const user = userEvent.setup();

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "修改群名" }));
    const dialog = screen.getByRole("dialog", { name: "修改群组名称" });
    const input = within(dialog).getByRole("textbox", { name: "新名称" });
    await user.clear(input);
    await user.type(input, "ops");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(renameChannelActionMock).toHaveBeenCalledWith({
        channelName: "tour visit",
        nextName: "ops",
      });
    });
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("opens header workspace modules through workbench navigation when available", async () => {
    const user = userEvent.setup();
    const navigateWorkspaceModule = vi.fn(() => true);

    render(
      <TestProviders>
        <WorkspaceModuleNavigationProvider navigateWorkspaceModule={navigateWorkspaceModule}>
          <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
        </WorkspaceModuleNavigationProvider>
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "日历" }));

    expect(navigateWorkspaceModule).toHaveBeenCalledWith("/w/workspace-alpha/calendar");
    expect(routerPushMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "更多" }));
    await user.click(screen.getByRole("button", { name: "查看任务" }));

    expect(navigateWorkspaceModule).toHaveBeenCalledWith("/w/workspace-alpha/task-board");
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("falls back to router navigation for header workspace modules outside the workbench", async () => {
    const user = userEvent.setup();

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "日历" }));

    expect(routerPushMock).toHaveBeenCalledWith("/w/workspace-alpha/calendar");
  });

  it("shows in-channel agents and humans in the mention menu", async () => {
    const user = userEvent.setup();

    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            mentionCandidates: [
              {
                id: "Atlas",
                label: "Atlas",
                subtitle: "Planner",
                channels: ["tour visit"],
                kind: "agent",
              },
              {
                id: "Nova",
                label: "Nova",
                subtitle: "Reviewer",
                channels: ["other room"],
                kind: "agent",
              },
              {
                id: "human:user-mina",
                label: "Mina",
                subtitle: "mina@example.com",
                channels: ["tour visit"],
                kind: "human",
              },
            ],
          }}
        />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "插入 @ 提及" }));

    const mentionMenu = screen.getAllByText("Atlas")
      .map((node) => node.closest(".contacts-mention-menu"))
      .find((node): node is HTMLElement => node !== null) ?? null;
    expect(mentionMenu).not.toBeNull();
    if (!mentionMenu) {
      throw new Error("mention menu not found");
    }
    expect(within(mentionMenu).getByText("Atlas")).toBeInTheDocument();
    expect(within(mentionMenu).getByText("Mina")).toBeInTheDocument();
    expect(within(mentionMenu).getByText("群成员")).toBeInTheDocument();
    expect(within(mentionMenu).queryByText("Nova")).not.toBeInTheDocument();
    await user.click(within(mentionMenu).getByRole("button", { name: /Mina/ }));
    expect(screen.getByRole("textbox")).toHaveValue("@Mina ");
  });

  it("renders direct channels in the unified conversation list", () => {
    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            channels: [
              ...data.channels,
              {
                id: "contact:Atlas",
                name: "direct-atlas",
                channelName: "direct-atlas",
                contactId: "Atlas",
                kind: "direct",
                displayName: "Atlas",
                displaySubtitle: "Atlas",
                avatarLabel: "✦",
                memberLabel: "1 humans / 1 agents",
                memberCount: 2,
                canManage: false,
                updatedAt: "11:00",
              },
            ],
            threads: [
              ...data.threads,
              {
                channelName: "contact:Atlas",
                messages: [
                  {
                    id: "message-direct-1",
                    channel: "direct-atlas",
                    speaker: "Atlas",
                    role: "agent",
                    time: "11:00",
                    summary: "我在这里。",
                    status: "completed",
                  },
                ],
              },
            ],
            totalChannels: 2,
          }}
        />
      </TestProviders>,
    );

    expect(screen.getAllByText("Atlas").length).toBeGreaterThan(0);
    expect(screen.getAllByText("会话").length).toBeGreaterThan(0);
  });

  it("uses channel list summaries when split details are not loaded yet", () => {
    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            detailScope: ["tour visit"],
            channels: [
              data.channels[0]!,
              {
                id: "planning",
                name: "planning",
                memberLabel: "1 humans / 0 agents",
                humanMemberNames: ["Tianyu"],
                employeeNames: [],
                lastMessage: "列表摘要仍然可见",
                updatedAt: "11:00",
              },
            ],
            threads: [
              data.threads[0]!,
              {
                channelName: "planning",
                messages: [],
              },
            ],
            totalChannels: 2,
          }}
        />
      </TestProviders>,
    );

    const planningRow = screen.getByRole("button", { name: /planning/ });
    expect(within(planningRow).getByText("列表摘要仍然可见")).toBeInTheDocument();
  });

  it("reuses workspace module cache for split channel detail data", async () => {
    const user = userEvent.setup();

    render(
      <TestProviders>
        <WorkspaceModuleCacheProvider>
          <SeedImChannelDetailCache>
            <ChannelsPageClient
              currentUserDisplayName="Tianyu"
              data={{
                ...data,
                detailScope: ["tour visit"],
                channels: [
                  data.channels[0]!,
                  {
                    id: "planning",
                    name: "planning",
                    memberLabel: "1 humans / 0 agents",
                    humanMemberNames: ["Tianyu"],
                    employeeNames: [],
                    lastMessage: "列表摘要仍然可见",
                    updatedAt: "11:00",
                  },
                ],
                threads: [
                  data.threads[0]!,
                  {
                    channelName: "planning",
                    messages: [],
                  },
                ],
                totalChannels: 2,
              }}
            />
          </SeedImChannelDetailCache>
        </WorkspaceModuleCacheProvider>
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: /planning/ }));

    expect(await screen.findByText("cached planning detail")).toBeInTheDocument();
    expect(getChannelDetailDataActionMock).not.toHaveBeenCalledWith({
      channelName: "planning",
      workspaceId: "workspace-1",
    });
  });

  it("marks split channel detail cache stale after channel mutations", async () => {
    const user = userEvent.setup();
    let cacheApi: ReturnType<typeof useWorkspaceModuleCache> | null = null;

    render(
      <TestProviders>
        <WorkspaceModuleCacheProvider>
          <SeedImChannelDetailCache>
            <CaptureImChannelDetailCache onReady={(cache) => {
              cacheApi = cache;
            }} />
            <ChannelsPageClient
              currentUserDisplayName="Tianyu"
              data={{
                ...data,
                detailScope: ["tour visit"],
                channels: [
                  data.channels[0]!,
                  {
                    id: "planning",
                    name: "planning",
                    memberLabel: "1 humans / 0 agents",
                    humanMemberNames: ["Tianyu"],
                    employeeNames: [],
                    lastMessage: "列表摘要仍然可见",
                    updatedAt: "11:00",
                  },
                ],
                threads: [
                  data.threads[0]!,
                  {
                    channelName: "planning",
                    messages: [],
                  },
                ],
                totalChannels: 2,
              }}
            />
          </SeedImChannelDetailCache>
        </WorkspaceModuleCacheProvider>
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: /planning/ }));
    expect(await screen.findByText("cached planning detail")).toBeInTheDocument();
    if (!cacheApi) {
      throw new Error("Cache API not captured.");
    }
    await waitFor(() => {
      expect(cacheApi?.get({
        workspaceId: "workspace-1",
        moduleId: "im",
        resourceKey: "channel-detail:planning",
      })?.metadata.stale).toBe(false);
    });

    await user.click(screen.getByRole("button", { name: "回复" }));
    const composer = screen.getByPlaceholderText("发送到 planning");
    fireEvent.change(composer, { target: { value: "update planning", selectionStart: 15 } });
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => {
      expect(sendChannelMessageActionMock).toHaveBeenCalledTimes(1);
      expect(cacheApi?.get({
        workspaceId: "workspace-1",
        moduleId: "im",
        resourceKey: "channel-detail:planning",
      })?.metadata.stale).toBe(true);
    });
  });

  it("records channel and document refs on split detail cache entries", async () => {
    let cacheApi: ReturnType<typeof useWorkspaceModuleCache> | null = null;

    render(
      <TestProviders>
        <WorkspaceModuleCacheProvider>
          <CaptureImChannelDetailCache onReady={(cache) => {
            cacheApi = cache;
          }} />
          <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
        </WorkspaceModuleCacheProvider>
      </TestProviders>,
    );

    await waitFor(() => {
      const entry = cacheApi?.get({
        workspaceId: "workspace-1",
        moduleId: "im",
        resourceKey: "channel-detail:tour visit",
      });
      expect(entry?.metadata.resourceRefs?.channel).toContain("tour visit");
      expect(entry?.metadata.resourceRefs?.document).toContain("doc-1");
    });
  });

  it("shows an empty-thread message instead of the unselected state for direct chats with no messages", () => {
    searchParams.set("view", "direct");

    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            channels: [
              {
                id: "contact:Atlas",
                name: "direct-atlas",
                channelName: "direct-atlas",
                contactId: "Atlas",
                kind: "direct",
                displayName: "Atlas",
                displaySubtitle: "Atlas",
                avatarLabel: "✦",
                memberLabel: "1 humans / 1 agents",
                memberCount: 2,
                canManage: false,
              },
            ],
            threads: [
              {
                channelName: "contact:Atlas",
                messages: [],
              },
            ],
            totalChannels: 1,
          }}
        />
      </TestProviders>,
    );

    const threadPane = document.querySelector<HTMLElement>(".contacts-chat-pane");
    expect(threadPane).not.toBeNull();
    if (!threadPane) {
      throw new Error("thread pane not found");
    }
    expect(within(threadPane).getByText("还没有消息")).toBeInTheDocument();
    expect(within(threadPane).getByText("发一条消息开始对话。")).toBeInTheDocument();
    expect(screen.queryByText("未选择会话")).not.toBeInTheDocument();
  });

  it("keeps direct conversation focus updates inside the workspace slug path", async () => {
    const user = userEvent.setup();
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");
    searchParams.set("view", "direct");
    window.history.replaceState(window.history.state, "", "/w/workspace-alpha/im?view=direct");

    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            channels: [
              {
                id: "contact:Atlas",
                name: "direct-atlas",
                channelName: "direct-atlas",
                contactId: "Atlas",
                kind: "direct",
                displayName: "Atlas",
                displaySubtitle: "Atlas",
                avatarLabel: "✦",
                memberLabel: "1 humans / 1 agents",
                memberCount: 2,
                canManage: false,
                updatedAt: "11:00",
              },
            ],
            threads: [
              {
                channelName: "contact:Atlas",
                messages: [
                  {
                    id: "message-direct-1",
                    channel: "direct-atlas",
                    speaker: "Atlas",
                    role: "agent",
                    time: "11:00",
                    summary: "我在这里。",
                    status: "completed",
                  },
                ],
              },
            ],
            totalChannels: 1,
          }}
        />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: /Atlas/ }));

    const nextHref = replaceStateSpy.mock.lastCall?.[2];
    expect(typeof nextHref).toBe("string");
    expect(nextHref).toContain("/w/workspace-alpha/im?");
    expect(nextHref).toContain("view=direct");
    expect(nextHref).toContain("focus=contact%3AAtlas");
    expect(routerReplaceMock).not.toHaveBeenCalled();
    replaceStateSpy.mockRestore();
  });

  it("opens channel document workspaces through local history transitions", async () => {
    const user = userEvent.setup();
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    searchParams.set("tab", "documents");

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "打开" }));

    const nextHref = pushStateSpy.mock.lastCall?.[2];
    expect(typeof nextHref).toBe("string");
    expect(nextHref).toContain("/w/workspace-alpha/im?");
    expect(nextHref).toContain("focus=channel%3Atour+visit");
    expect(nextHref).toContain("tab=documents");
    expect(nextHref).toContain("doc=doc-1");
    pushStateSpy.mockRestore();
  });

  it("opens channel documents in knowledge through workbench navigation", async () => {
    const user = userEvent.setup();
    const navigateWorkspaceModule = vi.fn(() => true);
    searchParams.set("tab", "documents");

    render(
      <TestProviders>
        <WorkspaceModuleNavigationProvider navigateWorkspaceModule={navigateWorkspaceModule}>
          <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
        </WorkspaceModuleNavigationProvider>
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "打开" }));
    const knowledgeButtons = await screen.findAllByRole("button", { name: "在知识库中查看" });
    await user.click(knowledgeButtons.at(-1) as HTMLElement);

    expect(navigateWorkspaceModule).toHaveBeenCalledWith(
      "/w/workspace-alpha/knowledge?view=documents&document=channelDocument%3Adoc-1",
    );
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("keeps the messages tab active when a stale document deep link is still present", async () => {
    searchParams.set("tab", "messages");
    searchParams.set("doc", "doc-1");

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    const composer = await screen.findByPlaceholderText("发送到 tour visit");
    expect(composer).toBeInTheDocument();
    expect(screen.queryByText("云文档工作台")).not.toBeInTheDocument();

    fireEvent.change(composer, { target: { value: "继续聊这个文档", selectionStart: 7 } });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => expect(sendChannelMessageActionMock).toHaveBeenCalledTimes(1));
    const formData = sendChannelMessageActionMock.mock.calls[0]?.[0] as FormData;
    expect(formData.get("channelName")).toBe("tour visit");
    expect(formData.get("content")).toBe("继续聊这个文档");
    expect(screen.getByPlaceholderText("发送到 tour visit")).toBeInTheDocument();
  });

  it("does not reopen a document deep link after switching back to messages", async () => {
    const user = userEvent.setup();
    searchParams.set("tab", "documents");
    searchParams.set("doc", "doc-1");

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    expect(await screen.findByText("云文档工作台")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "消息" }));

    expect(await screen.findByPlaceholderText("发送到 tour visit")).toBeInTheDocument();
    expect(screen.queryByText("云文档工作台")).not.toBeInTheDocument();
  });

  it("restores messages when browser history leaves a document deep link", async () => {
    searchParams.set("focus", "channel:tour visit");
    searchParams.set("tab", "documents");
    searchParams.set("doc", "doc-1");
    window.history.replaceState(window.history.state, "", "/w/workspace-alpha/im?focus=channel%3Atour+visit&tab=documents&doc=doc-1");

    render(
      <TestProviders>
        <ChannelsPageClient currentUserDisplayName="Tianyu" data={data} />
      </TestProviders>,
    );

    expect(await screen.findByText("云文档工作台")).toBeInTheDocument();

    searchParams.delete("tab");
    searchParams.delete("doc");
    await act(async () => {
      window.history.replaceState(window.history.state, "", "/w/workspace-alpha/im?focus=channel%3Atour+visit");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(await screen.findByPlaceholderText("发送到 tour visit")).toBeInTheDocument();
    expect(screen.queryByText("云文档工作台")).not.toBeInTheDocument();
  });

  it("sends the first direct message through contact actions when no direct channel exists yet", async () => {
    const user = userEvent.setup();
    searchParams.set("view", "direct");

    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            channels: [
              {
                id: "contact:Atlas",
                name: "Atlas",
                contactId: "Atlas",
                kind: "direct",
                displayName: "Atlas",
                displaySubtitle: "Atlas",
                avatarLabel: "✦",
                memberLabel: "1 humans / 1 agents",
                memberCount: 2,
                canManage: false,
              },
            ],
            threads: [
              {
                channelName: "contact:Atlas",
                messages: [],
              },
            ],
            totalChannels: 1,
          }}
        />
      </TestProviders>,
    );

    await user.type(screen.getByPlaceholderText("发送到 Atlas"), "你好");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(sendContactMessageActionMock).toHaveBeenCalledTimes(1);
    const formData = sendContactMessageActionMock.mock.calls[0]?.[0] as FormData;
    expect(formData.get("contactId")).toBe("Atlas");
    expect(formData.get("content")).toBe("你好");
    expect(sendChannelMessageActionMock).not.toHaveBeenCalled();
  });

  it("does not show human direct messages in the digital contacts view", () => {
    searchParams.set("view", "direct");

    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            channels: [
              {
                id: "human:user-mina",
                name: "Mina",
                humanContactUserId: "user-mina",
                kind: "direct",
                directParticipantKind: "human",
                displayName: "Mina",
                displaySubtitle: "mina@example.com",
                avatarLabel: "M",
                memberLabel: "2 humans / 0 agents",
                memberCount: 2,
                canManage: false,
              },
            ],
            threads: [
              {
                channelName: "human:user-mina",
                messages: [],
              },
            ],
            totalChannels: 1,
          }}
        />
      </TestProviders>,
    );

    expect(screen.queryByText("Mina")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("发送到 Mina")).not.toBeInTheDocument();
    expect(sendContactMessageActionMock).not.toHaveBeenCalled();
    expect(sendChannelMessageActionMock).not.toHaveBeenCalled();
  });

  it("edits a digital contact remark from the direct contact header", async () => {
    const user = userEvent.setup();
    searchParams.set("view", "direct");

    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            channels: [
              {
                id: "contact:Atlas",
                name: "direct-atlas",
                channelName: "direct-atlas",
                contactId: "Atlas",
                kind: "direct",
                displayName: "Atlas",
                displaySubtitle: "Atlas",
                avatarLabel: "✦",
                memberLabel: "1 humans / 1 agents",
                memberCount: 2,
                canManage: false,
              },
            ],
            threads: [
              {
                channelName: "contact:Atlas",
                messages: [],
              },
            ],
            totalChannels: 1,
          }}
        />
      </TestProviders>,
    );

    await user.click(screen.getByRole("button", { name: "编辑备注" }));
    expect(await screen.findByRole("heading", { name: "编辑联系人备注" })).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "联系人备注" });
    await user.clear(input);
    await user.type(input, "旅行助手");
    await user.click(screen.getByRole("button", { name: "保存备注" }));

    expect(updateDigitalContactRemarkActionMock).toHaveBeenCalledWith({
      contactId: "Atlas",
      remarkName: "旅行助手",
    });
  });

  it("sends follow-up direct messages through contact actions after a direct channel exists", async () => {
    const user = userEvent.setup();
    searchParams.set("view", "direct");

    render(
      <TestProviders>
        <ChannelsPageClient
          currentUserDisplayName="Tianyu"
          data={{
            ...data,
            channels: [
              {
                id: "contact:Atlas",
                name: "direct-atlas",
                channelName: "direct-atlas",
                contactId: "Atlas",
                kind: "direct",
                displayName: "Atlas",
                displaySubtitle: "Atlas",
                avatarLabel: "✦",
                memberLabel: "1 humans / 1 agents",
                memberCount: 2,
                canManage: false,
                updatedAt: "11:00",
              },
            ],
            threads: [
              {
                channelName: "contact:Atlas",
                messages: [
                  {
                    id: "message-direct-1",
                    channel: "direct-atlas",
                    speaker: "Atlas",
                    role: "agent",
                    time: "11:00",
                    summary: "我在这里。",
                    status: "completed",
                  },
                ],
              },
            ],
            totalChannels: 1,
          }}
        />
      </TestProviders>,
    );

    await user.type(screen.getByPlaceholderText("发送到 Atlas"), "第二条消息");
    await user.click(screen.getByRole("button", { name: "发送消息" }));

    expect(sendContactMessageActionMock).toHaveBeenCalledTimes(1);
    const formData = sendContactMessageActionMock.mock.calls[0]?.[0] as FormData;
    expect(formData.get("contactId")).toBe("Atlas");
    expect(formData.get("content")).toBe("第二条消息");
    expect(sendChannelMessageActionMock).not.toHaveBeenCalled();
  });
});
