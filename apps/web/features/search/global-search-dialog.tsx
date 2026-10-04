"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { buildWorkspacePath, parseWorkspacePathname } from "@/features/auth/workspace-paths";
import { useLanguage } from "@/features/i18n/language-provider";
import { AppIcon } from "@/shared/ui/app-icon";
import { useDialogSurface } from "@/shared/lib/use-dialog-surface";
import { formatCompactTimestamp } from "@/shared/lib/time-format";

interface SearchResult {
  type: "message" | "document" | "task" | "agent" | "skill" | "knowledge";
  id: string;
  title: string;
  snippet: string;
  score: number;
  meta?: Record<string, string>;
}

function groupResults(results: SearchResult[]): Map<string, SearchResult[]> {
  const groups = new Map<string, SearchResult[]>();
  for (const result of results) {
    const list = groups.get(result.type) ?? [];
    list.push(result);
    groups.set(result.type, list);
  }
  return groups;
}

function resultHref(result: SearchResult, pathname: string): string {
  const { workspaceSlug } = parseWorkspacePathname(pathname);
  const workspaceHref = (path: string): string => workspaceSlug ? buildWorkspacePath(workspaceSlug, path) : path;

  switch (result.type) {
    case "message": {
      const channel = result.meta?.channel;
      return channel
        ? workspaceHref(`/im?focus=${encodeURIComponent(`channel:${channel}`)}`)
        : workspaceHref("/im");
    }
    case "document": {
      const documentKey = result.meta?.documentKey;
      if (result.meta?.view === "documents" && documentKey) {
        return workspaceHref(`/knowledge?view=documents&document=${encodeURIComponent(documentKey)}`);
      }
      const channel = result.meta?.channel;
      return channel
        ? workspaceHref(`/im?focus=${encodeURIComponent(`channel:${channel}`)}&doc=${encodeURIComponent(result.id)}`)
        : workspaceHref("/im");
    }
    case "task":
      return workspaceHref(`/inbox?focus=${encodeURIComponent(`task:${result.id}`)}`);
    case "agent":
      return workspaceHref(`/im?view=direct&focus=${encodeURIComponent(`contact:${result.id}`)}`);
    case "skill":
      return workspaceHref("/skills");
    case "knowledge":
      return workspaceHref(`/knowledge?page=${encodeURIComponent(result.id)}`);
    default:
      return workspaceHref("/");
  }
}

const TYPE_LABELS: Record<string, { zh: string; en: string }> = {
  message: { zh: "消息", en: "Messages" },
  document: { zh: "文档", en: "Documents" },
  task: { zh: "任务", en: "Tasks" },
  agent: { zh: "Agent", en: "Agents" },
  skill: { zh: "技能", en: "Skills" },
  knowledge: { zh: "知识库", en: "Knowledge" },
};

export function GlobalSearchDialog({
  agentOptions = [],
  onWorkspaceModuleNavigate,
  open,
  onClose,
}: {
  agentOptions?: Array<{
    id: string;
    name: string;
    subtitle?: string;
  }>;
  onWorkspaceModuleNavigate?: (href: string) => boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { tx } = useLanguage();
  const {
    surfaceRef,
    handleBackdropMouseDown,
    labelId,
    descriptionId,
  } = useDialogSurface<HTMLDivElement>(onClose);
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [assignedAgentName, setAssignedAgentName] = useState("all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchRevisionRef = useRef(0);

  useEffect(() => {
    searchRevisionRef.current += 1;
    clearTimeout(debounceRef.current);
    if (open) {
      setQuery("");
      setAssignedAgentName("all");
      setResults([]);
      setActiveIndex(0);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
    return () => {
      searchRevisionRef.current += 1;
      clearTimeout(debounceRef.current);
    };
  }, [open]);

  const doSearch = useCallback((q: string, agentName = assignedAgentName) => {
    const revision = searchRevisionRef.current;
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const params = new URLSearchParams({ q: q.trim() });
    if (agentName !== "all") {
      params.set("agent", agentName);
    }
    fetch(`/api/search?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (revision !== searchRevisionRef.current) {
          return;
        }
        setResults(data.results ?? []);
        setActiveIndex(0);
      })
      .catch(() => {
        if (revision === searchRevisionRef.current) {
          setResults([]);
        }
      });
  }, [assignedAgentName]);

  function handleQueryChange(value: string): void {
    searchRevisionRef.current += 1;
    setQuery(value);
    setResults([]);
    setActiveIndex(0);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 200);
  }

  function handleAssignedAgentChange(value: string): void {
    searchRevisionRef.current += 1;
    setAssignedAgentName(value);
    setResults([]);
    setActiveIndex(0);
    clearTimeout(debounceRef.current);
    if (query.trim()) {
      doSearch(query, value);
    }
  }

  function navigateToResult(result: SearchResult): void {
    const href = resultHref(result, pathname);
    onClose();
    if (onWorkspaceModuleNavigate?.(href)) {
      return;
    }
    router.push(href);
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, results.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      navigateToResult(results[activeIndex]);
    }
  }

  if (!open) {
    return null;
  }

  const grouped = groupResults(results);

  return (
    <div
      className="search-overlay"
      onMouseDown={handleBackdropMouseDown}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        aria-describedby={descriptionId}
        aria-labelledby={labelId}
        aria-modal="true"
        className="search-dialog"
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
      >
        <div aria-live="polite" className="sr-only">
          {query.trim().length === 0
            ? tx("请输入关键词开始搜索。", "Type a query to start searching.")
            : results.length > 0
              ? tx(`找到 ${results.length} 条结果。`, `${results.length} results found.`)
              : tx("没有找到结果。", "No results found.")}
        </div>
        <div className="search-dialog__input-wrap">
          <span className="search-dialog__icon">
            <AppIcon name="search" />
          </span>
          <input
            aria-describedby={descriptionId}
            aria-label={tx("搜索工作区内容", "Search workspace content")}
            className="search-dialog__input"
            onChange={(e) => handleQueryChange(e.currentTarget.value)}
            placeholder={tx("搜索消息、文档、任务、Agent...", "Search messages, documents, tasks, agents...")}
            ref={inputRef}
            type="text"
            value={query}
          />
        </div>
        {agentOptions.length > 0 ? (
          <div className="search-dialog__scope">
            <label htmlFor="global-search-agent-scope">
              {tx("知识范围", "Knowledge scope")}
            </label>
            <select
              id="global-search-agent-scope"
              onChange={(event) => handleAssignedAgentChange(event.currentTarget.value)}
              value={assignedAgentName}
            >
              <option value="all">{tx("全部知识页", "All knowledge pages")}</option>
              {agentOptions.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="search-dialog__results">
          {query.trim() && results.length === 0 ? (
            <div className="search-dialog__empty">
              <span className="search-dialog__empty-icon">
                <AppIcon name="search" />
              </span>
              <strong>{tx("没有找到结果", "No results found")}</strong>
              <p>{tx("换一个关键词，或者缩短查询范围再试一次。", "Try another keyword or shorten the scope and search again.")}</p>
            </div>
          ) : null}
          {Array.from(grouped.entries()).map(([type, items]) => {
            const label = TYPE_LABELS[type];
            return (
              <div key={type}>
                <div className="search-group__label">{label ? tx(label.zh, label.en) : type}</div>
                {items.map((result) => {
                  const flatIndex = results.indexOf(result);
                  return (
                    <a
                      className={`search-result-item${flatIndex === activeIndex ? " search-result-item--active" : ""}`}
                      href={resultHref(result, pathname)}
                      key={`${result.type}-${result.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        navigateToResult(result);
                      }}
                      onMouseEnter={() => setActiveIndex(flatIndex)}
                    >
                      <span className="search-result-item__title">{result.title}</span>
                      <span className="search-result-item__snippet">{result.snippet}</span>
                      {result.meta?.time ? (
                        <span className="search-result-item__meta">{formatCompactTimestamp(result.meta.time, { emptyFallback: result.meta.time })}</span>
                      ) : result.meta?.channel ? (
                        <span className="search-result-item__meta">{result.meta.channel}</span>
                      ) : null}
                    </a>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="search-dialog__hint" id={descriptionId}>
          <strong className="sr-only" id={labelId}>
            {tx("全局搜索", "Global search")}
          </strong>
          {tx("Esc 关闭 · ↑↓ 选择 · Enter 跳转", "Esc to close · ↑↓ to select · Enter to navigate")}
        </div>
      </div>
    </div>
  );
}
