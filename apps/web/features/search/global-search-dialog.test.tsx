import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalSearchDialog } from "@/features/search/global-search-dialog";
import { LanguageProvider } from "@/features/i18n/language-provider";

const { routerPushMock } = vi.hoisted(() => ({
  routerPushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/w/workspace-alpha/inbox",
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

describe("GlobalSearchDialog", () => {
  it("keeps newer search results when an older response arrives last", async () => {
    let finishOlder!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishOlder = resolve; }))
      .mockResolvedValueOnce({ json: async () => ({ results: [{ type: "task", id: "new", title: "Newer result", snippet: "", score: 1 }] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<LanguageProvider><GlobalSearchDialog open onClose={vi.fn()} /></LanguageProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "older" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "newer" } });
    expect(await screen.findByRole("link", { name: /Newer result/ })).toBeInTheDocument();
    await act(async () => {
      finishOlder({ json: async () => ({ results: [{ type: "task", id: "old", title: "Older result", snippet: "", score: 1 }] }) });
    });
    expect(screen.getByRole("link", { name: /Newer result/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Older result/ })).not.toBeInTheDocument();
  });

  it("does not restore results after the query is cleared", async () => {
    let finishSearch!: (value: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finishSearch = resolve; })));
    render(<LanguageProvider><GlobalSearchDialog open onClose={vi.fn()} /></LanguageProvider>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "older" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    await act(async () => {
      finishSearch({ json: async () => ({ results: [{ type: "task", id: "old", title: "Older result", snippet: "", score: 1 }] }) });
    });
    expect(screen.queryByRole("link", { name: /Older result/ })).not.toBeInTheDocument();
  });

  beforeEach(() => {
    routerPushMock.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 4, 11, 12, 0));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        results: [
          {
            type: "document",
            id: "att-visible-itinerary",
            title: "shared/itinerary.md",
            snippet: "Markdown attachment",
            score: 1,
            meta: {
              view: "documents",
              documentKey: "attachment:att-visible-itinerary",
              sourceType: "attachment",
            },
          },
        ],
      }),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("navigates document-page search results to the workspace knowledge documents view", async () => {
    render(
      <LanguageProvider>
        <GlobalSearchDialog open onClose={vi.fn()} />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "itinerary" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /shared\/itinerary\.md/i })).toBeInTheDocument();
    });

    const result = screen.getByRole("link", { name: /shared\/itinerary\.md/i });
    fireEvent.click(result);

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith(
        "/w/workspace-alpha/knowledge?view=documents&document=attachment%3Aatt-visible-itinerary",
      );
    });
  });

  it("uses workspace module navigation when provided", async () => {
    const onWorkspaceModuleNavigate = vi.fn(() => true);
    const onClose = vi.fn();

    render(
      <LanguageProvider>
        <GlobalSearchDialog
          onClose={onClose}
          onWorkspaceModuleNavigate={onWorkspaceModuleNavigate}
          open
        />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "itinerary" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /shared\/itinerary\.md/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("link", { name: /shared\/itinerary\.md/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onWorkspaceModuleNavigate).toHaveBeenCalledWith(
      "/w/workspace-alpha/knowledge?view=documents&document=attachment%3Aatt-visible-itinerary",
    );
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it("falls back to router navigation when workspace module navigation declines", async () => {
    const onWorkspaceModuleNavigate = vi.fn(() => false);

    render(
      <LanguageProvider>
        <GlobalSearchDialog
          onClose={vi.fn()}
          onWorkspaceModuleNavigate={onWorkspaceModuleNavigate}
          open
        />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "itinerary" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /shared\/itinerary\.md/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("link", { name: /shared\/itinerary\.md/i }));

    expect(onWorkspaceModuleNavigate).toHaveBeenCalledTimes(1);
    expect(routerPushMock).toHaveBeenCalledWith(
      "/w/workspace-alpha/knowledge?view=documents&document=attachment%3Aatt-visible-itinerary",
    );
  });

  it("navigates task search results into the unified inbox feed without the old task filter route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        results: [
          {
            type: "task",
            id: "task-trip-plan",
            title: "旅行计划",
            snippet: "任务已分派给 Planner。",
            score: 1,
          },
        ],
      }),
    }));

    render(
      <LanguageProvider>
        <GlobalSearchDialog open onClose={vi.fn()} />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "旅行" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => {
      expect(screen.getByRole("link", { name: /旅行计划/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("link", { name: /旅行计划/i }));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith(
        "/w/workspace-alpha/inbox?focus=task%3Atask-trip-plan",
      );
    });
  });

  it("renders message result timestamps with the compact date rule", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        results: [
          {
            type: "message",
            id: "message-trip",
            title: "Tianyu #travel",
            snippet: "itinerary",
            score: 1,
            meta: {
              channel: "travel",
              time: "2026-04-25T09:00:00.000Z",
            },
          },
        ],
      }),
    }));

    render(
      <LanguageProvider>
        <GlobalSearchDialog open onClose={vi.fn()} />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "itinerary" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(await screen.findByText("04/25")).toBeInTheDocument();
  });

  it("passes the selected agent scope to search", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ results: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <LanguageProvider>
        <GlobalSearchDialog
          agentOptions={[{ id: "Planner", name: "Planner", subtitle: "Planner" }]}
          open
          onClose={vi.fn()}
        />
      </LanguageProvider>,
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "policy" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    fireEvent.change(screen.getByLabelText("知识范围"), {
      target: { value: "Planner" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/search?q=policy&agent=Planner");
    });
  });
});
