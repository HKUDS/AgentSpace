import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/features/i18n/language-provider";
import { WorkspaceModuleCacheProvider } from "@/features/dashboard/workspace-module-cache";
import { WorkspaceModuleHost } from "@/features/dashboard/workspace-module-host";
import { parseWorkspaceModulePath } from "@/features/dashboard/workspace-module-route";

function renderHost(input: {
  children: React.ReactNode;
  routePath: string;
  routeStateSource: "url" | "next" | "client";
}) {
  return (
    <LanguageProvider>
      <WorkspaceModuleCacheProvider workspaceId="workspace-alpha">
        <WorkspaceModuleHost
          routeState={parseWorkspaceModulePath(input.routePath)}
          routeStateSource={input.routeStateSource}
          workspaceId="workspace-alpha"
          workspaceSlug="workspace-alpha"
        >
          {input.children}
        </WorkspaceModuleHost>
      </WorkspaceModuleCacheProvider>
    </LanguageProvider>
  );
}

describe("WorkspaceModuleHost", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  });

  it.each([503, 403])("waits for an explicit retry after HTTP %s", async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Unavailable", { status }))
      .mockImplementation(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(renderHost({
      routePath: "/w/workspace-alpha/inbox",
      routeStateSource: "client",
      children: null,
    }));

    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /重试|Retry/ }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("restores the preserved route children snapshot when returning to its client route", () => {
    const view = render(renderHost({
      routePath: "/w/workspace-alpha/im",
      routeStateSource: "url",
      children: <div>Message route child</div>,
    }));

    expect(screen.getByText("Message route child")).toBeInTheDocument();

    view.rerender(renderHost({
      routePath: "/w/workspace-alpha/inbox",
      routeStateSource: "client",
      children: <div>Notification route child</div>,
    }));

    view.rerender(renderHost({
      routePath: "/w/workspace-alpha/im",
      routeStateSource: "client",
      children: <div>Notification route child</div>,
    }));

    expect(screen.getByText("Message route child")).toBeInTheDocument();
    expect(screen.queryByText("Notification route child")).not.toBeInTheDocument();
  });
});
