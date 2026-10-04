import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationShell } from "@/features/chat/conversation-shell";
import { LanguageProvider } from "@/features/i18n/language-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
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

describe("ConversationShell", () => {
  beforeEach(() => {
    mockMatchMedia(false);
    window.sessionStorage.clear();
  });

  it("does not submit again on Enter while a message is pending", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(
      <LanguageProvider>
        <ConversationShell
          emptyListBody="empty" emptyListTitle="empty"
          emptyThreadBody="empty" emptyThreadTitle="empty"
          items={[]} listCount={0} listKicker="Channels" listTitle="Channels"
          messages={[]} onSelectItem={vi.fn()} onSubmit={onSubmit}
          placeholder="Send a message" selectedItemId="tour-visit"
          selectedHeader={{ title: "tour visit", subtitle: "Group", avatar: "#" }}
        />
      </LanguageProvider>,
    );
    const composer = screen.getByRole("textbox");
    fireEvent.change(composer, { target: { value: "Please review" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(screen.getByRole("button", { name: /发送消息|Send message/ })).toBeDisabled();
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
    fireEvent.change(composer, { target: { value: "Next message" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); });
  });

  it("prepends an agent mention when replying to an agent message in channel chat", async () => {
    const user = userEvent.setup();

    render(
      <LanguageProvider>
        <ConversationShell
          emptyListBody="empty"
          emptyListTitle="empty"
          emptyThreadBody="empty"
          emptyThreadTitle="empty"
          items={[
            {
              id: "tour-visit",
              title: "tour visit",
              subtitle: "1 humans / 1 agents",
              meta: "meta",
              avatar: "#",
            },
          ]}
          listCount={1}
          listKicker="Channels"
          listTitle="Channels"
          mentionCandidates={[
            {
              id: "Tianyu's assistant",
              label: "Tianyu's assistant",
              subtitle: "Assistant",
              inChannel: true,
            },
          ]}
          messages={[
            {
              id: "message-1",
              speaker: "Tianyu's assistant",
              role: "agent",
              content: "我来处理一下。",
              timestamp: "10:00",
              status: "completed",
            },
          ]}
          onSelectItem={vi.fn()}
          onSubmit={vi.fn(async () => {})}
          placeholder="Send a message"
          selectedHeader={{
            title: "tour visit",
            subtitle: "1 humans / 1 agents",
            avatar: "#",
          }}
          selectedItemId="tour-visit"
        />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole("button", { name: "回复" }));
    expect(screen.getByRole("textbox")).toHaveValue("@Tianyu's assistant ");
  });

  it("switches between list and thread on compact layouts without affecting selection", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    const onSelectItem = vi.fn();

    render(
      <LanguageProvider>
        <ConversationShell
          emptyListBody="empty"
          emptyListTitle="empty"
          emptyThreadBody="empty"
          emptyThreadTitle="empty"
          items={[
            {
              id: "tour-visit",
              title: "tour visit",
              subtitle: "1 humans / 1 agents",
              meta: "meta",
              avatar: "#",
            },
          ]}
          listCount={1}
          listKicker="Channels"
          listTitle="Channels"
          messages={[
            {
              id: "message-1",
              speaker: "Tianyu",
              role: "human",
              content: "hello",
              timestamp: "10:00",
              status: "completed",
            },
          ]}
          onSelectItem={onSelectItem}
          onSubmit={vi.fn(async () => {})}
          placeholder="Send a message"
          selectedHeader={{
            title: "tour visit",
            subtitle: "1 humans / 1 agents",
            avatar: "#",
          }}
          selectedItemId="tour-visit"
        />
      </LanguageProvider>,
    );

    expect(await screen.findByRole("button", { name: "返回列表" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /meta/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回列表" }));
    expect(screen.getByRole("button", { name: /tour visit/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回列表" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /tour visit/i }));
    expect(onSelectItem).toHaveBeenCalledWith("tour-visit");
    expect(await screen.findByRole("button", { name: "返回列表" })).toBeInTheDocument();
  });

  it("labels only the current user's human messages as own", () => {
    render(
      <LanguageProvider>
        <ConversationShell
          currentUserDisplayName="Tianyu"
          emptyListBody="empty"
          emptyListTitle="empty"
          emptyThreadBody="empty"
          emptyThreadTitle="empty"
          items={[
            {
              id: "human:user-mina",
              title: "Mina",
              subtitle: "Human",
              meta: "meta",
              avatar: "M",
            },
          ]}
          listCount={1}
          listKicker="Direct"
          listTitle="Direct"
          messages={[
            {
              id: "message-1",
              speaker: "Tianyu",
              role: "human",
              content: "hi",
              timestamp: "10:00",
              status: "completed",
            },
            {
              id: "message-2",
              speaker: "Mina",
              role: "human",
              content: "?",
              timestamp: "10:01",
              status: "completed",
            },
          ]}
          onSelectItem={vi.fn()}
          onSubmit={vi.fn(async () => {})}
          placeholder="Send a message"
          selectedHeader={{
            title: "Direct chat",
            subtitle: "Human",
            avatar: "M",
          }}
          selectedItemId="human:user-mina"
        />
      </LanguageProvider>,
    );

    expect(screen.getByText("你")).toBeInTheDocument();
    expect(screen.getAllByText("Mina").length).toBeGreaterThan(0);
  });

  it("restores a saved thread scroll anchor after the shell remounts", () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      id: `message-${index}`,
      speaker: index % 2 === 0 ? "Tianyu" : "Atlas",
      role: (index % 2 === 0 ? "human" : "agent") as "human" | "agent",
      content: `message ${index}`,
      timestamp: `10:${String(index).padStart(2, "0")}`,
      status: "completed" as const,
    }));
    const shell = (
      <LanguageProvider>
        <ConversationShell
          emptyListBody="empty"
          emptyListTitle="empty"
          emptyThreadBody="empty"
          emptyThreadTitle="empty"
          items={[
            {
              id: "tour-visit",
              title: "tour visit",
              subtitle: "1 humans / 1 agents",
              meta: "meta",
              avatar: "#",
            },
          ]}
          listCount={1}
          listKicker="Channels"
          listTitle="Channels"
          messages={messages}
          onSelectItem={vi.fn()}
          onSubmit={vi.fn(async () => {})}
          placeholder="Send a message"
          scrollAnchorStorageKey="workspace-1:im:scroll-anchors"
          selectedHeader={{
            title: "tour visit",
            subtitle: "1 humans / 1 agents",
            avatar: "#",
          }}
          selectedItemId="tour-visit"
        />
      </LanguageProvider>
    );
    const { unmount } = render(shell);
    const thread = document.querySelector<HTMLDivElement>(".contacts-chat-thread");

    expect(thread).not.toBeNull();
    Object.defineProperty(thread, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(thread, "clientHeight", { configurable: true, value: 300 });
    thread!.scrollTop = 360;
    fireEvent.scroll(thread!);
    unmount();

    render(shell);

    expect(document.querySelector<HTMLDivElement>(".contacts-chat-thread")?.scrollTop).toBe(360);
  });

  it("renders the supplementary panel as a dismissible mobile sheet on compact layouts", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    const onCloseSupplementaryPanel = vi.fn();

    render(
      <LanguageProvider>
        <ConversationShell
          emptyListBody="empty"
          emptyListTitle="empty"
          emptyThreadBody="empty"
          emptyThreadTitle="empty"
          items={[
            {
              id: "tour-visit",
              title: "tour visit",
              subtitle: "1 humans / 1 agents",
              meta: "meta",
              avatar: "#",
            },
          ]}
          listCount={1}
          listKicker="Channels"
          listTitle="Channels"
          messages={[
            {
              id: "message-1",
              speaker: "Tianyu",
              role: "human",
              content: "hello",
              timestamp: "10:00",
              status: "completed",
            },
          ]}
          onCloseSupplementaryPanel={onCloseSupplementaryPanel}
          onSelectItem={vi.fn()}
          onSubmit={vi.fn(async () => {})}
          placeholder="Send a message"
          selectedHeader={{
            title: "tour visit",
            subtitle: "1 humans / 1 agents",
            avatar: "#",
          }}
          selectedItemId="tour-visit"
          supplementaryPanel={<div>Docs content</div>}
          supplementaryPanelTitle="Docs & files"
        />
      </LanguageProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Docs & files" })).toBeInTheDocument();
    expect(screen.getByText("Docs content")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /关闭面板|Close panel/i })[1]);
    expect(onCloseSupplementaryPanel).toHaveBeenCalledTimes(1);
  });

  it("renders the supplementary panel as a desktop side pane on wide layouts", async () => {
    const user = userEvent.setup();
    const onCloseSupplementaryPanel = vi.fn();

    render(
      <LanguageProvider>
        <ConversationShell
          emptyListBody="empty"
          emptyListTitle="empty"
          emptyThreadBody="empty"
          emptyThreadTitle="empty"
          items={[
            {
              id: "tour-visit",
              title: "tour visit",
              subtitle: "1 humans / 1 agents",
              meta: "meta",
              avatar: "#",
            },
          ]}
          listCount={1}
          listKicker="Channels"
          listTitle="Channels"
          messages={[
            {
              id: "message-1",
              speaker: "Tianyu",
              role: "human",
              content: "hello",
              timestamp: "10:00",
              status: "completed",
            },
          ]}
          onCloseSupplementaryPanel={onCloseSupplementaryPanel}
          onSelectItem={vi.fn()}
          onSubmit={vi.fn(async () => {})}
          placeholder="Send a message"
          selectedHeader={{
            title: "tour visit",
            subtitle: "1 humans / 1 agents",
            avatar: "#",
          }}
          selectedItemId="tour-visit"
          supplementaryPanel={<div>Docs content</div>}
          supplementaryPanelTitle="Docs & files"
        />
      </LanguageProvider>,
    );

    expect(screen.getByText("Docs & files")).toBeInTheDocument();
    expect(screen.getByText("Docs content")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /关闭面板|Close panel/i }));
    expect(onCloseSupplementaryPanel).toHaveBeenCalledTimes(1);
  });
});
