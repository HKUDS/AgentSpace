"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { AgentsPageClient } from "@/features/agents/agents-page-client";
import { ApprovalsPageClient } from "@/features/approvals/approvals-page-client";
import { AutomationsPageClient } from "@/features/automations/automations-page-client";
import { CalendarPageClient } from "@/features/calendar/calendar-page-client";
import { ChannelsPageClient } from "@/features/channels/channels-page-client";
import { CostsPageClient } from "@/features/costs/costs-page-client";
import { HumanContactsPageClient } from "@/features/contacts/human-contacts-page-client";
import type { HumanContactsPageData } from "@/features/contacts/human-contacts-data";
import type {
  AgentsPageData,
  ApprovalsPageData,
  AutomationsPageData,
  BudgetPageData,
  CalendarPageData,
  ChannelsPageData,
  CostPageData,
  DataTablesPageData,
  InboxPageData,
  KnowledgePageData,
  OrgChartPageData,
  SkillsPageData,
  TaskBoardPageData,
  TemplatesPageData,
} from "@/features/dashboard/data";
import type { WorkspaceModuleLoaderData } from "@/features/dashboard/workspace-module-loaders";
import { isWorkspaceModuleLoaderId } from "@/features/dashboard/workspace-module-loader-types";
import type { WorkspaceInvalidationEvent } from "@/features/dashboard/workspace-invalidation";
import {
  buildWorkspaceModuleDataQuery,
  type WorkspaceModuleRouteState,
} from "@/features/dashboard/workspace-module-route";
import {
  buildWorkspaceModuleCacheScopeSignature,
  scopeWorkspaceModuleCacheKey,
  useWorkspaceModuleCache,
  useWorkspaceModuleCacheRevision,
  useWorkspaceModuleCacheScope,
  type WorkspaceModuleCacheEntry,
} from "@/features/dashboard/workspace-module-cache";
import {
  measureWorkspaceModuleNavigationCacheHit,
  measureWorkspaceModuleNavigationFirstLoad,
  measureWorkspaceModuleNavigationSettled,
} from "@/features/dashboard/workspace-navigation-performance";
import { canUseWorkspaceClientModule } from "@/features/dashboard/workspace-workbench-flags";
import { useLanguage } from "@/features/i18n/language-provider";
import { OrgChartPageClient } from "@/features/org-chart/org-chart-page-client";
import { PerformancePageClient } from "@/features/performance/performance-page-client";
import { InboxPageClient } from "@/features/inbox/inbox-page-client";
import { KnowledgePageClient } from "@/features/knowledge/knowledge-page-client";
import { MarketPageClient, type MarketPageData } from "@/features/market/market-page-client";
import { EmptyState } from "@/shared/ui/empty-state";
import { FeedbackBanner } from "@/shared/ui/feedback-banner";
import { SettingsPageClient } from "@/features/settings/settings-page-client";
import type { SettingsPageData } from "@/features/settings/settings-page-loader";
import { isSettingsDetailSectionId } from "@/features/settings/settings-sections";
import { SkillsPageClient } from "@/features/skills/skills-page-client";
import { TablesPageClient } from "@/features/tables/tables-page-client";
import { TaskBoardPageClient } from "@/features/task-board/task-board-page-client";
import { TemplatesPageClient } from "@/features/templates/templates-page-client";
import type { PerformanceDashboardData } from "@agent-space/services";

export function WorkspaceModuleHost({
  children,
  routeState,
  routeStateSource,
  workspaceId,
  workspaceSlug,
  onModuleDataChanged,
  onSettingsSectionForbidden,
}: {
  children: React.ReactNode;
  routeState: WorkspaceModuleRouteState;
  routeStateSource: "url" | "next" | "client";
  workspaceId: string;
  workspaceSlug: string;
  onModuleDataChanged?: () => void;
  onSettingsSectionForbidden?: () => void;
}) {
  const { tx } = useLanguage();
  const cache = useWorkspaceModuleCache();
  useWorkspaceModuleCacheRevision();
  const cacheScope = useWorkspaceModuleCacheScope();
  const cacheScopeSignature = useMemo(
    () => buildWorkspaceModuleCacheScopeSignature(cacheScope),
    [cacheScope],
  );
  const dataQuery = useMemo(() => buildWorkspaceModuleDataQuery(routeState), [routeState]);
  const queryKey = dataQuery.toString();
  const routeSignature = `${routeState.moduleId ?? ""}:${queryKey}`;
  const preservedChildrenRef = useRef(children);
  const preservedChildrenRouteSignatureRef = useRef(routeSignature);
  const preservedChildrenScopeSignatureRef = useRef(buildWorkspaceModuleCacheScopeSignature(cacheScope));
  useEffect(() => {
    if (routeStateSource !== "client") {
      preservedChildrenRef.current = children;
      preservedChildrenRouteSignatureRef.current = routeSignature;
      preservedChildrenScopeSignatureRef.current = cacheScopeSignature;
    }
  }, [cacheScopeSignature, children, routeSignature, routeStateSource]);
  const shouldRenderClientModule =
    canUseWorkspaceClientModule(routeState.moduleId) &&
    routeStateSource === "client" &&
    isWorkspaceModuleLoaderId(routeState.moduleId);
  const moduleId = shouldRenderClientModule ? routeState.moduleId : null;
  const cacheKey = useMemo(
    () => moduleId ? scopeWorkspaceModuleCacheKey({ workspaceId, moduleId, queryKey }, cacheScope) : null,
    [cacheScope, moduleId, queryKey, workspaceId],
  );
  const cachedEntry = cacheKey ? cache.get<WorkspaceModuleLoaderData>(cacheKey) : undefined;
  const hadCachedEntryAtNavigation = useRef(false);
  const routeSignatureSnapshotRef = useRef<string | null>(null);
  if (routeSignatureSnapshotRef.current !== routeSignature) {
    routeSignatureSnapshotRef.current = routeSignature;
    hadCachedEntryAtNavigation.current = Boolean(cachedEntry?.data);
  }
  const measuredRouteSignatureRef = useRef<string | null>(null);
  const fetchActiveModuleData = useCallback(async ({ signal }: { signal: AbortSignal }) => {
    if (!moduleId) {
      throw new Error("Workspace module is not selected.");
    }

    const query = queryKey ? `?${queryKey}` : "";
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/modules/${moduleId}${query}`, {
      signal,
    });
    if (!response.ok) {
      throw new WorkspaceModuleLoadError(response.status, await response.text());
    }
    const payload = await response.json() as { data: WorkspaceModuleLoaderData };
    return payload.data;
  }, [moduleId, queryKey, workspaceSlug]);
  const loadActiveModuleData = useCallback((force = false) => {
    if (!cacheKey || !moduleId) {
      return null;
    }

    const loadPromise = cache.load<WorkspaceModuleLoaderData>({
      cacheKey,
      force,
      loader: fetchActiveModuleData,
      forbidden: (error) => error instanceof WorkspaceModuleLoadError && error.status === 403,
    });
    void loadPromise.catch((error) => {
      if (
        moduleId === "settings" &&
        error instanceof WorkspaceModuleLoadError &&
        error.status === 403
      ) {
        onSettingsSectionForbidden?.();
      }
    });
    return loadPromise;
  }, [cache, cacheKey, fetchActiveModuleData, moduleId, onSettingsSectionForbidden]);
  const refreshActiveModuleData = useCallback((options: { refreshCounters?: boolean } = {}) => {
    void loadActiveModuleData(true)?.catch(() => {});
    if (options.refreshCounters) {
      onModuleDataChanged?.();
    }
  }, [loadActiveModuleData, onModuleDataChanged]);
  const handleWorkspaceInvalidation = useCallback((event: WorkspaceInvalidationEvent) => {
    cache.markInvalidated(event);
    if (event.shell === "counters" || event.shell === "all") {
      onModuleDataChanged?.();
    }
  }, [cache, onModuleDataChanged]);

  useEffect(() => {
    if (!shouldRenderClientModule) {
      measureWorkspaceModuleNavigationSettled(routeState);
      return;
    }
    if (cachedEntry?.data || cachedEntry?.status === "error" || cachedEntry?.status === "forbidden") {
      measureWorkspaceModuleNavigationSettled(routeState);
      if (measuredRouteSignatureRef.current === routeSignature) {
        return;
      }
      measuredRouteSignatureRef.current = routeSignature;
      if (cachedEntry.data && hadCachedEntryAtNavigation.current) {
        measureWorkspaceModuleNavigationCacheHit(routeState);
        return;
      }
      if (cachedEntry.data) {
        measureWorkspaceModuleNavigationFirstLoad(routeState);
      }
    }
  }, [cachedEntry?.data, cachedEntry?.status, routeSignature, routeState, shouldRenderClientModule]);

  useEffect(() => {
    if (!moduleId || !cacheKey) {
      return;
    }
    if (
      cachedEntry?.status === "loading" || cachedEntry?.status === "refreshing" ||
      cachedEntry?.status === "error" || cachedEntry?.status === "forbidden"
    ) {
      return;
    }
    if (cachedEntry?.status === "ready" && !cachedEntry.metadata.stale) {
      return;
    }

    void loadActiveModuleData()?.catch(() => {});
  }, [cacheKey, cachedEntry?.metadata.stale, cachedEntry?.status, loadActiveModuleData, moduleId]);

  if (!shouldRenderClientModule) {
    return renderPreservedChildren(children);
  }

  const preservedChildren = preservedChildrenRef.current;
  if (
    preservedChildren &&
    routeStateSource === "client" &&
    preservedChildrenRouteSignatureRef.current === routeSignature &&
    preservedChildrenScopeSignatureRef.current === cacheScopeSignature
  ) {
    return renderPreservedChildren(preservedChildren);
  }

  if (preservedChildren && routeStateSource === "client") {
    return (
      <>
        {renderPreservedChildren(preservedChildren, { hidden: true })}
        {renderActiveModuleContent({
          cachedEntry,
          onInvalidation: handleWorkspaceInvalidation,
          onDataChanged: refreshActiveModuleData,
          routeState,
          tx,
        })}
      </>
    );
  }

  return renderActiveModuleContent({
    cachedEntry,
    onInvalidation: handleWorkspaceInvalidation,
    onDataChanged: refreshActiveModuleData,
    routeState,
    tx,
  });
}

function renderPreservedChildren(children: React.ReactNode, options: { hidden?: boolean } = {}): React.ReactNode {
  return (
    <div
      aria-hidden={options.hidden ? "true" : undefined}
      hidden={options.hidden}
      style={options.hidden ? undefined : { display: "contents" }}
    >
      {children}
    </div>
  );
}

function renderActiveModuleContent({
  cachedEntry,
  onInvalidation,
  onDataChanged,
  routeState,
  tx,
}: {
  cachedEntry?: WorkspaceModuleCacheEntry<WorkspaceModuleLoaderData>;
  onInvalidation: (event: WorkspaceInvalidationEvent) => void;
  onDataChanged: (options?: { refreshCounters?: boolean }) => void;
  routeState: WorkspaceModuleRouteState;
  tx: (zh: string, en: string) => string;
}) {
  if (cachedEntry?.data) {
    return (
      <>
        {cachedEntry.status === "error" ? (
          <FeedbackBanner
            message={tx("模块数据刷新失败，当前显示的是上一次成功加载的内容。", "Module refresh failed. Showing the last successfully loaded content.")}
            title={tx("刷新失败", "Refresh failed")}
            tone="error"
          >
            <button className="modal-secondary-button" onClick={() => onDataChanged({ refreshCounters: true })} type="button">
              {tx("重试", "Retry")}
            </button>
          </FeedbackBanner>
        ) : null}
        {renderWorkspaceModuleData(cachedEntry.data, routeState, onDataChanged, onInvalidation)}
      </>
    );
  }

  if (cachedEntry?.status === "error" || cachedEntry?.status === "forbidden") {
    return (
      <section className="page-shell">
        <EmptyState
          actionLabel={tx("重试", "Retry")}
          body={tx("模块数据暂时无法加载。", "This module could not be loaded right now.")}
          onAction={() => {
            onDataChanged({ refreshCounters: true });
          }}
          title={cachedEntry.status === "forbidden" ? tx("没有访问权限", "Access denied") : tx("加载失败", "Load failed")}
        />
      </section>
    );
  }

  return (
    <section className="page-shell" aria-busy="true">
      <EmptyState title={tx("正在加载", "Loading")} variant="cool" />
    </section>
  );
}

function renderWorkspaceModuleData(
  data: WorkspaceModuleLoaderData,
  routeState: WorkspaceModuleRouteState,
  onDataChanged: (options?: { refreshCounters?: boolean }) => void,
  onInvalidation: (event: WorkspaceInvalidationEvent) => void,
): React.ReactNode {
  switch (data.moduleId) {
    case "agents":
      return (
        <AgentsPageClient
          data={data.data as AgentsPageData}
          moduleSearchParams={routeState.searchParams}
          onDataChanged={onDataChanged}
          onInvalidation={onInvalidation}
        />
      );
    case "approvals":
      return <ApprovalsPageClient data={data.data as ApprovalsPageData} onDataChanged={onDataChanged} onInvalidation={onInvalidation} />;
    case "automations":
      return <AutomationsPageClient data={data.data as AutomationsPageData} onDataChanged={onDataChanged} />;
    case "calendar":
      return <CalendarPageClient data={data.data as CalendarPageData} onDataChanged={onDataChanged} />;
    case "contacts":
      return (
        <HumanContactsPageClient
          currentUserDisplayName={data.currentUserDisplayName}
          {...(data.data as HumanContactsPageData)}
        />
      );
    case "costs":
      return <CostsPageClient budgets={data.budgets as BudgetPageData} costs={data.costs as CostPageData} onDataChanged={onDataChanged} />;
    case "im":
      return (
        <ChannelsPageClient
          currentUserDisplayName={data.currentUserDisplayName}
          data={data.data as ChannelsPageData}
          moduleSearchParams={routeState.searchParams}
          onDataChanged={onDataChanged}
          onInvalidation={onInvalidation}
        />
      );
    case "org-chart":
      return <OrgChartPageClient data={data.data as OrgChartPageData} />;
    case "performance":
      return <PerformancePageClient data={data.data as PerformanceDashboardData} />;
    case "settings":
      return (
        <SettingsPageClient
          {...(data.data as SettingsPageData)}
          activeSection={resolveSettingsActiveSection(routeState)}
          onDataChanged={onDataChanged}
        />
      );
    case "skills":
      return <SkillsPageClient data={data.data as SkillsPageData} moduleSearchParams={routeState.searchParams} onDataChanged={onDataChanged} />;
    case "tables":
      return <TablesPageClient data={data.data as DataTablesPageData} onDataChanged={onDataChanged} />;
    case "inbox":
      return (
        <InboxPageClient
          data={data.data as InboxPageData}
          moduleSearchParams={routeState.searchParams}
          onDataChanged={onDataChanged}
          onInvalidation={onInvalidation}
        />
      );
    case "knowledge":
      return <KnowledgePageClient data={data.data as KnowledgePageData} moduleSearchParams={routeState.searchParams} onDataChanged={onDataChanged} />;
    case "market":
      return <MarketPageClient data={data.data as MarketPageData} onDataChanged={onDataChanged} />;
    case "task-board":
      return <TaskBoardPageClient data={data.data as TaskBoardPageData} onDataChanged={onDataChanged} onInvalidation={onInvalidation} />;
    case "templates":
      return <TemplatesPageClient data={data.data as TemplatesPageData} onDataChanged={onDataChanged} />;
  }
}

function resolveSettingsActiveSection(routeState: WorkspaceModuleRouteState): SettingsPageData["initialSection"] | undefined {
  const [section] = routeState.settingsPath;
  return section && isSettingsDetailSectionId(section) ? section : undefined;
}

class WorkspaceModuleLoadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message || `Workspace module request failed with ${status}.`);
  }
}
