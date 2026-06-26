import { useEffect, useMemo, useState } from "react";
import { formatDaemonProviderLabel } from "@agent-space/domain";
import { useLanguage } from "@/features/i18n/language-provider";
import { EmptyState } from "@/shared/ui/empty-state";
import { AppIcon } from "@/shared/ui/app-icon";
import { DeleteAgentModal } from "@/features/agents/components/delete-agent-modal";
import { ExecutionEngineSelect, resolveExecutionEngineValue } from "@/features/agents/components/execution-engine-select";
import { SkillPickerModal } from "@/features/agents/components/skill-picker-modal";
import { FeishuAgentBotAgentSettingsPanel } from "@/features/integrations/feishu/feishu-agent-bot-agent-settings-panel";
import { GeneratedAvatar } from "@/shared/ui/generated-avatar";
import { formatCompactTimestamp } from "@/shared/lib/time-format";
import {
  toneForStatus,
  translateManagementStatus,
  translateQueueValue,
} from "@/features/agents/lib/translate";
import type { AgentsPageData, RouterExecutionView, WorkspaceAgentRecord } from "@/features/dashboard/data";
import type { WorkspaceSkill } from "@agent-space/domain/workspace";

interface AgentDetailProps {
  readonly containerOptions: AgentsPageData["containerOptions"];
  readonly pending: boolean;
  readonly record: WorkspaceAgentRecord;
  readonly workspaceMembers?: AgentsPageData["workspaceMembers"];
  readonly workspaceSkills: WorkspaceSkill[];
  readonly onBindContainer: (runtimeId: string) => void;
  readonly onUnbindContainer: () => void;
  readonly onDeleteAgent: () => void;
  readonly onSaveInstructions: (instructions: string) => void;
  readonly onSetChannelMemberAccess?: (access: WorkspaceAgentRecord["channelMemberAccess"]) => void;
  readonly onSetSkillIds: (skillIds: string[]) => void;
  readonly onSetKnowledgePageIds?: (pageIds: string[]) => void;
  readonly onCreateForkInvitation?: (input: {
    targetUserId: string;
    options: {
      copyProfile: boolean;
      copyInstructions: boolean;
      copySkills: boolean;
      copyKnowledgeAssignments: boolean;
      contextNote?: string;
    };
  }) => void;
  readonly onRevokeForkInvitation?: (invitationId: string) => void;
  readonly onConnectGoogleWorkspace?: () => void;
  readonly onRevokeGoogleWorkspaceDelegation?: () => void;
  readonly onFeishuAgentBotUpdated?: () => void;
}

export function AgentDetail({
  containerOptions,
  pending,
  record,
  workspaceMembers = [],
  workspaceSkills,
  onBindContainer,
  onUnbindContainer,
  onDeleteAgent,
  onSaveInstructions,
  onSetChannelMemberAccess,
  onSetSkillIds,
  onSetKnowledgePageIds,
  onCreateForkInvitation,
  onRevokeForkInvitation,
  onConnectGoogleWorkspace,
  onRevokeGoogleWorkspaceDelegation,
  onFeishuAgentBotUpdated,
}: AgentDetailProps) {
  const { tx } = useLanguage();
  const [activeTab, setActiveTab] = useState<"instructions" | "skills" | "knowledge" | "documents" | "workspaces" | "settings">("instructions");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const [showKnowledgePicker, setShowKnowledgePicker] = useState(false);
  const [forkTargetUserId, setForkTargetUserId] = useState("");
  const [forkContextNote, setForkContextNote] = useState("");
  const [instructionDraft, setInstructionDraft] = useState(record.instructions ?? "");
  const [selectedRuntimeId, setSelectedRuntimeId] = useState(() =>
    resolveExecutionEngineValue(record.boundContainerId, containerOptions),
  );

  useEffect(() => {
    setInstructionDraft(record.instructions ?? "");
  }, [record.id, record.instructions]);

  useEffect(() => {
    setSelectedRuntimeId(resolveExecutionEngineValue(record.boundContainerId, containerOptions));
  }, [containerOptions, record.boundContainerId, record.id]);

  useEffect(() => {
    setForkTargetUserId("");
    setForkContextNote("");
  }, [record.id]);

  const assignedSkillIds = useMemo(() => record.skills.map((skill) => skill.id), [record.skills]);
  const availableSkills = useMemo(
    () => workspaceSkills.filter((skill) => !assignedSkillIds.includes(skill.id)),
    [assignedSkillIds, workspaceSkills],
  );
  const knowledge = record.knowledge ?? {
    directPageIds: [],
    inheritedPages: [],
    directPages: [],
    assignablePages: [],
    totalAvailableCount: 0,
    directCount: 0,
    inheritedCount: 0,
  };
  const canManage = record.canManage;
  const canManageChannelMemberAccess =
    record.canManageChannelMemberAccess &&
    Boolean(onSetChannelMemberAccess);
  const boundProviderLabel = record.boundProvider ? formatDaemonProviderLabel(record.boundProvider) : tx("未绑定", "Unbound");
  const providerUsabilityLabel = record.boundProviderHealth
    ? formatProviderUsability(record.boundProviderHealth, tx)
    : tx("未验证", "Unverified");
  const providerUsabilityTone = record.boundProviderHealth
    ? providerUsabilityStatusTone(record.boundProviderHealth)
    : "neutral";
  const providerError = record.boundProviderHealth?.lastProviderErrorCode
    ? formatProviderError(record.boundProviderHealth)
    : "";
  const googleWorkspaceDelegation = record.googleWorkspaceDelegation ?? {
    status: "not_delegated" as const,
    canRevoke: false,
  };
  const googleWorkspaceStatus = formatAgentGoogleWorkspaceStatus(googleWorkspaceDelegation.status, tx);
  const googleWorkspaceStatusTone = agentGoogleWorkspaceStatusTone(googleWorkspaceDelegation.status);
  const documentAccess = record.documentAccess ?? {
    readableCount: 0,
    editableCount: 0,
    forwardableCount: 0,
    externalCount: 0,
    pendingRequestCount: 0,
    rejectedRequestCount: 0,
    grants: [],
    requests: [],
  };

  return (
    <div className="subsection">
      <div className="agent-profile-card">
        <div className="agent-profile-card__main">
          <GeneratedAvatar
            className="agent-profile-card__avatar"
            id={record.internalName || record.id}
            name={record.name}
            variant="agent"
          />
          <div className="agent-profile-card__copy">
            <h3>{record.name}</h3>
            <p>{record.internalName}</p>
            {record.forkedFrom ? (
              <span className="agent-profile-card__origin">
                {tx(`Forked from ${record.forkedFrom.sourceAgentName}`, `Forked from ${record.forkedFrom.sourceAgentName}`)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="agent-profile-card__meta">
          <span className={`status-chip status-chip--${toneForStatus(record.status)}`}>{translateManagementStatus(record.statusLabel, tx)}</span>
          <span className="tag-pill">{record.boundContainerName ?? tx("未绑定执行引擎", "No execution engine bound")}</span>
          {record.boundProvider ? (
            <span className="tag-pill tag-pill--muted">{formatDaemonProviderLabel(record.boundProvider)}</span>
          ) : null}
          {canManage ? (
            <button className="action-button action-button--danger" disabled={pending} onClick={() => setShowDeleteConfirm(true)} type="button">
              {tx("删除 Agent", "Delete Agent")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="agent-resume-layout">
        <nav aria-label={tx("Agent 简历章节", "Agent resume sections")} className="agent-tabs agent-tabs--resume">
          {[
            { key: "instructions", label: "Instructions", meta: tx("执行前注入", "Run context") },
            { key: "skills", label: "Skills", meta: tx(`${record.skills.length} 个技能`, `${record.skills.length} skills`) },
            { key: "knowledge", label: "Knowledge", meta: tx(`${knowledge.totalAvailableCount} 篇知识`, `${knowledge.totalAvailableCount} pages`) },
            { key: "documents", label: tx("文档权限", "Documents"), meta: tx(`${documentAccess.readableCount} 份文档`, `${documentAccess.readableCount} documents`) },
            { key: "workspaces", label: "Workspaces", meta: tx(`${record.workAreas.length} 个工作区`, `${record.workAreas.length} workspaces`) },
            { key: "settings", label: tx("设置", "Settings"), meta: tx("执行引擎", "Execution engine") },
          ].map((tab) => (
            <button
              aria-label={tab.label}
              className={`agent-tab${activeTab === tab.key ? " agent-tab--active" : ""}`}
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              type="button"
            >
              <span>{tab.label}</span>
              <small>{tab.meta}</small>
            </button>
          ))}
        </nav>

        <div className="agent-tab-panel agent-tab-panel--resume">
        {activeTab === "instructions" ? (
          <>
            <div className="detail-copy">
              <p>{tx("每次执行都会注入这段 instructions。", "Injected into every run.")}</p>
            </div>
            <textarea
              className="instructions-editor"
              disabled={!canManage}
              onChange={(event) => setInstructionDraft(event.currentTarget.value)}
              rows={10}
              value={instructionDraft}
            />
            <div className="detail-actions">
              <button
                className="primary-button"
                disabled={pending || !canManage}
                onClick={() => onSaveInstructions(instructionDraft)}
                type="button"
              >
                {tx("保存 Instructions", "Save instructions")}
              </button>
            </div>
          </>
        ) : null}

        {activeTab === "knowledge" ? (
          <div className="skills-assignment-shell knowledge-assignment-shell">
            <section className="skills-panel knowledge-panel">
              <div className="panel-header">
                <div>
                  <h3>{tx("可用知识", "Available knowledge")}</h3>
                </div>
                <button
                  className="action-button"
                  disabled={pending || !canManage || !onSetKnowledgePageIds || knowledge.assignablePages.length === 0}
                  onClick={() => setShowKnowledgePicker(true)}
                  type="button"
                >
                  {tx("添加知识", "Add knowledge")}
                </button>
              </div>

              {knowledge.inheritedPages.length > 0 ? (
                <div className="skill-card-list knowledge-card-list">
                  {knowledge.inheritedPages.map((page) => (
                    <article className="skill-assignment-card knowledge-assignment-card" key={page.id}>
                      <div className="skill-assignment-card__copy">
                        <strong>{page.title}</strong>
                        <p>{tx("全员共享知识，当前 Agent 自动继承。", "Shared with all agents and inherited automatically.")}</p>
                        <span>{page.tags.length > 0 ? page.tags.join(", ") : tx("无标签", "No tags")}</span>
                      </div>
                      <span className="tag-pill">{tx("全员共享", "Shared")}</span>
                    </article>
                  ))}
                </div>
              ) : null}

              {knowledge.directPages.length > 0 ? (
                <div className="skill-card-list knowledge-card-list">
                  {knowledge.directPages.map((page) => (
                    <article className="skill-assignment-card knowledge-assignment-card" key={page.id}>
                      <div className="skill-assignment-card__copy">
                        <strong>{page.title}</strong>
                        <p>{page.sourceLabel ?? tx("知识页面", "Knowledge page")}</p>
                        <span>{page.tags.length > 0 ? page.tags.join(", ") : tx("无标签", "No tags")}</span>
                      </div>
                      <button
                        className="modal-secondary-button"
                        disabled={pending || !canManage || !onSetKnowledgePageIds}
                        onClick={() => onSetKnowledgePageIds?.(knowledge.directPageIds.filter((pageId) => pageId !== page.id))}
                        type="button"
                      >
                        {tx("解绑", "Unassign")}
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}

              {knowledge.inheritedPages.length === 0 && knowledge.directPages.length === 0 ? (
                <EmptyState title={tx("没有可用知识", "No knowledge assigned")} />
              ) : null}
            </section>
          </div>
        ) : null}

        {activeTab === "skills" ? (
          <div className="skills-assignment-shell skills-assignment-shell--assigned-skills">
            <section className="skills-panel">
              <div className="panel-header">
                <div>
                  <h3>{tx("已绑定技能", "Assigned skills")}</h3>
                </div>
                <button
                  className="action-button"
                  disabled={pending || !canManage || availableSkills.length === 0}
                  onClick={() => setShowSkillPicker(true)}
                  type="button"
                >
                  {tx("添加 Skill", "Add skill")}
                </button>
              </div>

              {record.skills.length > 0 ? (
                <div className="skill-card-list">
                  {record.skills.map((skill) => (
                    <article className="skill-assignment-card" key={skill.id}>
                      <div className="skill-assignment-card__copy">
                        <strong>{skill.name}</strong>
                        <p>{skill.description || tx("暂无描述", "No description")}</p>
                        <span>{tx(`${skill.files.length} 个文件`, `${skill.files.length} files`)}</span>
                        <span>{translateSkillSourceLabel(skill, tx)}</span>
                      </div>
                      <button
                        className="modal-secondary-button"
                        disabled={pending || !canManage}
                        onClick={() => onSetSkillIds(assignedSkillIds.filter((skillId) => skillId !== skill.id))}
                        type="button"
                      >
                        {tx("解绑", "Unassign")}
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState title={tx("没有绑定 Skills", "No skills assigned")} />
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "documents" ? (
          <div className="skills-assignment-shell knowledge-assignment-shell">
            <section className="skills-panel">
              <div className="panel-header">
                <div>
                  <h3>{tx("文档权限", "Document access")}</h3>
                </div>
                <span className="panel-note">
                  {tx(`${documentAccess.pendingRequestCount} 个待审批`, `${documentAccess.pendingRequestCount} pending`)}
                </span>
              </div>
              <dl className="runtime-binding-details">
                <div>
                  <dt>{tx("可查看", "Readable")}</dt>
                  <dd>{documentAccess.readableCount}</dd>
                </div>
                <div>
                  <dt>{tx("可编辑", "Editable")}</dt>
                  <dd>{documentAccess.editableCount}</dd>
                </div>
                <div>
                  <dt>{tx("可转发", "Forwardable")}</dt>
                  <dd>{documentAccess.forwardableCount}</dd>
                </div>
                <div>
                  <dt>{tx("外部文档", "External")}</dt>
                  <dd>{documentAccess.externalCount}</dd>
                </div>
              </dl>

              {documentAccess.grants.length > 0 ? (
                <div className="skill-card-list">
                  {documentAccess.grants.map((grant) => (
                    <article className="skill-assignment-card" key={grant.id}>
                      <div className="skill-assignment-card__copy">
                        <strong>{grant.documentTitle}</strong>
                        <p>
                          {[formatAgentDocumentRole(grant.role, tx), grant.channelName, grant.storageMode === "external" ? tx("外部文档", "External document") : tx("群文档", "Channel document")]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        {grant.externalFileId ? <span>{grant.externalFileId}</span> : null}
                        {grant.latestExternalRunStatus ? (
                          <span>
                            {tx("最近外部授权状态", "Latest external status")}: {grant.latestExternalRunStatus}
                            {grant.latestExternalRunAt ? ` · ${formatAgentTimestamp(grant.latestExternalRunAt)}` : ""}
                          </span>
                        ) : null}
                        {grant.latestExternalRunError ? <span>{grant.latestExternalRunError}</span> : null}
                      </div>
                      <span className={`status-chip status-chip--${agentDocumentRoleTone(grant.role)}`}>{formatAgentDocumentRole(grant.role, tx)}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState title={tx("没有显式文档权限", "No explicit document access")} />
              )}
            </section>

            <section className="skills-panel">
              <div className="panel-header">
                <div>
                  <h3>{tx("权限申请", "Permission requests")}</h3>
                </div>
                <span className="panel-note">
                  {tx(`${documentAccess.requests.length} 条记录`, `${documentAccess.requests.length} records`)}
                </span>
              </div>

              {documentAccess.requests.length > 0 ? (
                <div className="skill-card-list">
                  {documentAccess.requests.map((request) => (
                    <article className="skill-assignment-card" key={request.id}>
                      <div className="skill-assignment-card__copy">
                        <strong>{request.targetLabel}</strong>
                        <p>
                          {[formatAgentDocumentRole(request.requestedRole, tx), request.requestedForChannelName, formatDocumentRequestStatus(request.status, tx)]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <span>{request.reason}</span>
                        {request.decisionNote ? <span>{request.decisionNote}</span> : null}
                      </div>
                      <span className={`status-chip status-chip--${documentRequestStatusTone(request.status)}`}>
                        {formatDocumentRequestStatus(request.status, tx)}
                      </span>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState title={tx("没有权限申请", "No permission requests")} />
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "workspaces" ? (
          <div className="subsection">
            <div className="panel-header">
              <div>
                <h3>{tx("执行工作区", "Execution workspaces")}</h3>
              </div>
              <span className="panel-note">{record.workAreas.length}</span>
            </div>
            {record.workAreas.length > 0 ? (
              <div className="timeline">
                {record.workAreas.map((area) => (
                  <article className={`timeline-item${area.errorText ? " timeline-item--error" : ""}`} key={area.id}>
                    <div className="timeline-item__meta">
                      <strong>{area.title}</strong>
                      <span>{translateQueueValue(area.queueStatus, tx)}</span>
                    </div>
                    <p>{area.channel ? `${area.channel} · ` : ""}{formatAgentTimestamp(area.updatedAt)}</p>
                    {area.router ? <p>{tx(`Router Session: ${area.router.routerSessionId}`, `Router Session: ${area.router.routerSessionId}`)}</p> : null}
                    {area.router ? <p>{tx(`尝试: ${area.router.attempts.length} · ${translateContinuationMode(area.router.continuationMode, tx)}`, `Attempts: ${area.router.attempts.length} · ${translateContinuationMode(area.router.continuationMode, tx)}`)}</p> : null}
                    {area.workDir ? <p>{renderWorkAreaLocation(area, tx)}</p> : null}
                    {area.sessionId ? <p>{tx(`可复用会话: ${area.sessionId}`, `Reusable session: ${area.sessionId}`)}</p> : null}
                    {area.errorText ? <p>{area.errorText}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title={tx("暂无工作区域", "No work areas")} />
            )}
          </div>
        ) : null}

        {activeTab === "settings" ? (
          <>
            <FeishuAgentBotAgentSettingsPanel
              agentId={record.internalName}
              agentName={record.name}
              canManage={Boolean(record.canManageFeishuAgentBot)}
              integration={record.feishuAgentBot}
              onUpdated={onFeishuAgentBotUpdated}
              setupReference={record.feishuAgentBotSetupReference}
            />

            <section className="form-panel form-panel--nested agent-access-panel">
              <div className="panel-header">
                <div>
                  <h3>{tx("群成员调用权限", "Channel member access")}</h3>
                </div>
              </div>
              <label className={`settings-toggle agent-access-toggle${record.channelMemberAccess === "enabled" ? " settings-toggle--active" : ""}`}>
                <span>
                  <strong>{tx("允许已加入同一群的成员调用", "Allow members in joined channels")}</strong>
                  <p>
                    {tx(
                      "开启后，群成员可以 @ 这个 Agent 或给它派发该群任务。",
                      "When enabled, channel members can mention this agent or assign it channel tasks.",
                    )}
                  </p>
                </span>
                <span className="settings-toggle__control">
                  <input
                    aria-label={tx("允许群成员调用", "Allow channel member access")}
                    checked={record.channelMemberAccess === "enabled"}
                    disabled={pending || !canManageChannelMemberAccess}
                    onChange={(event) => onSetChannelMemberAccess?.(event.currentTarget.checked ? "enabled" : "disabled")}
                    role="switch"
                    type="checkbox"
                  />
                  <span className="settings-toggle__slider" />
                </span>
              </label>
            </section>

            {canManage && onCreateForkInvitation ? (
              <section className="form-panel form-panel--nested agent-fork-panel">
                <div className="panel-header">
                  <div>
                    <h3>{tx("复制给同事", "Fork to teammate")}</h3>
                  </div>
                  <span className="panel-note">{record.forkInvitations?.length ?? 0}</span>
                </div>
                <div className="agent-fork-panel__notice">
                  {tx(
                    "会复制 profile、instructions、skills 和直接知识绑定；不会复制 runtime、session、workDir、OAuth 或私聊历史。",
                    "Copies profile, instructions, skills, and direct knowledge assignments; runtime, session, workDir, OAuth, and private chats are not copied.",
                  )}
                </div>
                <div className="agent-fork-panel__form">
                  <label className="form-field form-field--full">
                    <span>{tx("目标同事", "Target teammate")}</span>
                    <select
                      disabled={pending || workspaceMembers.length === 0}
                      onChange={(event) => setForkTargetUserId(event.currentTarget.value)}
                      value={forkTargetUserId}
                    >
                      <option value="">{tx("选择同事", "Select teammate")}</option>
                      {workspaceMembers
                        .filter((member) => member.userId !== record.ownerUserId)
                        .map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.displayName} · {member.role}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="form-field form-field--full">
                    <span>{tx("Context note", "Context note")}</span>
                    <textarea
                      disabled={pending}
                      onChange={(event) => setForkContextNote(event.currentTarget.value)}
                      placeholder={tx("给同事说明这个 Agent 适合怎么用", "Tell your teammate how this agent should be used")}
                      rows={3}
                      value={forkContextNote}
                    />
                  </label>
                </div>
                <div className="agent-fork-panel__scope">
                  {[
                    tx("Profile", "Profile"),
                    "Instructions",
                    `Skills (${record.skills.length})`,
                    `Knowledge (${knowledge.directCount})`,
                  ].map((scope) => (
                    <span className="tag-pill" key={scope}>{scope}</span>
                  ))}
                </div>
                <div className="detail-actions">
                  <button
                    className="primary-button"
                    disabled={pending || !forkTargetUserId}
                    onClick={() =>
                      onCreateForkInvitation({
                        targetUserId: forkTargetUserId,
                        options: {
                          copyProfile: true,
                          copyInstructions: true,
                          copySkills: true,
                          copyKnowledgeAssignments: true,
                          contextNote: forkContextNote.trim() || undefined,
                        },
                      })
                    }
                    type="button"
                  >
                    {tx("发送复制邀请", "Send copy invite")}
                  </button>
                </div>
                {record.forkInvitations && record.forkInvitations.length > 0 ? (
                  <div className="agent-fork-panel__pending-list">
                    {record.forkInvitations.map((invitation) => (
                      <article className="agent-fork-panel__pending" key={invitation.id}>
                        <div>
                          <strong>{invitation.targetDisplayName ?? invitation.targetUserId}</strong>
                          <span>{formatAgentTimestamp(invitation.createdAt)}</span>
                        </div>
                        <button
                          className="modal-secondary-button"
                          disabled={pending || !onRevokeForkInvitation}
                          onClick={() => onRevokeForkInvitation?.(invitation.id)}
                          type="button"
                        >
                          {tx("撤销", "Revoke")}
                        </button>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="form-panel form-panel--nested agent-access-panel">
              <div className="panel-header">
                <div>
                  <h3>{tx("Google Workspace", "Google Workspace")}</h3>
                </div>
                <span className={`status-chip status-chip--${googleWorkspaceStatusTone}`}>{googleWorkspaceStatus}</span>
              </div>
              <div className="runtime-binding-overview">
                <div className="runtime-binding-overview__summary">
                  <span className="runtime-binding-overview__icon">
                    <AppIcon name="tables" />
                  </span>
                  <div className="runtime-binding-overview__copy">
                    <span>{tx("委托账号", "Delegated account")}</span>
                    <strong>
                      {googleWorkspaceDelegation.googleEmail
                        ?? googleWorkspaceDelegation.delegatedByDisplayName
                        ?? tx("未授权", "Not delegated")}
                    </strong>
                  </div>
                  <div className="runtime-binding-overview__chips">
                    {googleWorkspaceDelegation.delegatedByDisplayName ? (
                      <span className="tag-pill tag-pill--muted">{googleWorkspaceDelegation.delegatedByDisplayName}</span>
                    ) : null}
                    {googleWorkspaceDelegation.scopes?.length ? (
                      <span className="tag-pill tag-pill--muted">{tx(`${googleWorkspaceDelegation.scopes.length} 个 scope`, `${googleWorkspaceDelegation.scopes.length} scopes`)}</span>
                    ) : null}
                  </div>
                </div>
                <dl className="runtime-binding-details">
                  <div>
                    <dt>{tx("状态", "Status")}</dt>
                    <dd>{googleWorkspaceStatus}</dd>
                  </div>
                  <div>
                    <dt>{tx("更新时间", "Updated")}</dt>
                    <dd>{googleWorkspaceDelegation.updatedAt ? formatAgentTimestamp(googleWorkspaceDelegation.updatedAt) : tx("无", "None")}</dd>
                  </div>
                  <div>
                    <dt>{tx("授权用户", "Grantor")}</dt>
                    <dd>{googleWorkspaceDelegation.delegatedByDisplayName ?? tx("无", "None")}</dd>
                  </div>
                </dl>
              </div>
              <div className="detail-actions">
                <button
                  className="primary-button"
                  disabled={pending || !canManage || !onConnectGoogleWorkspace}
                  onClick={onConnectGoogleWorkspace}
                  type="button"
                >
                  {googleWorkspaceDelegation.status === "connected"
                    ? tx("重新授权 Google Workspace", "Reconnect Google Workspace")
                    : tx("授权 Google Workspace", "Delegate Google Workspace")}
                </button>
                <button
                  className="action-button action-button--danger"
                  disabled={
                    pending ||
                    !canManage ||
                    !googleWorkspaceDelegation.canRevoke ||
                    googleWorkspaceDelegation.status === "not_delegated" ||
                    !onRevokeGoogleWorkspaceDelegation
                  }
                  onClick={onRevokeGoogleWorkspaceDelegation}
                  type="button"
                >
                  {tx("撤销授权", "Revoke")}
                </button>
              </div>
            </section>

            <form
              className="form-panel form-panel--nested runtime-binding-panel"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                const runtimeId = (formData.get("runtimeId") as string)?.trim();
                if (!runtimeId) return;
                if (!canManage) return;
                onBindContainer(runtimeId);
              }}
            >
              <div className="panel-header">
                <div>
                  <h3>{tx("绑定执行引擎", "Bind execution engine")}</h3>
                </div>
              </div>
              <div className="runtime-binding-overview">
                <div className="runtime-binding-overview__summary">
                  <span className="runtime-binding-overview__icon">
                    <AppIcon name="containers" />
                  </span>
                  <div className="runtime-binding-overview__copy">
                    <span>{tx("当前执行引擎", "Current execution engine")}</span>
                    <strong>{record.boundContainerName ?? tx("未绑定", "Unbound")}</strong>
                  </div>
                  <div className="runtime-binding-overview__chips">
                    <span className={`status-chip status-chip--${providerUsabilityTone}`}>{providerUsabilityLabel}</span>
                    <span className="tag-pill tag-pill--muted">{boundProviderLabel}</span>
                  </div>
                </div>

                <dl className="runtime-binding-details">
                  <div>
                    <dt>{tx("真实名称", "Internal name")}</dt>
                    <dd>{record.internalName}</dd>
                  </div>
                  <div>
                    <dt>{tx("备注名", "Display name")}</dt>
                    <dd>{record.name}</dd>
                  </div>
                  <div>
                    <dt>Provider</dt>
                    <dd>{boundProviderLabel}</dd>
                  </div>
                  <div>
                    <dt>{tx("Provider 状态", "Provider status")}</dt>
                    <dd>{providerUsabilityLabel}</dd>
                  </div>
                </dl>

                {providerError ? (
                  <div className="runtime-binding-overview__error">
                    <span>{tx("Provider 错误", "Provider error")}</span>
                    <strong>{providerError}</strong>
                  </div>
                ) : null}
              </div>
              <div className="runtime-binding-control">
                <div className="form-field form-field--full">
                  <span>{tx("当前绑定", "Current binding")}</span>
                  <ExecutionEngineSelect
                    label={tx("当前绑定", "Current binding")}
                    name="runtimeId"
                    disabled={!canManage}
                    emptyDescription={tx("没有可用执行引擎", "No available execution engines")}
                    onChange={setSelectedRuntimeId}
                    options={containerOptions}
                    placeholder={tx("选择一个执行引擎", "Select an execution engine")}
                    value={selectedRuntimeId}
                  />
                </div>
              </div>
              <div className="detail-actions">
                <button className="primary-button" disabled={pending || !canManage || containerOptions.length === 0} type="submit">
                  {pending ? tx("更新中...", "Updating...") : tx("绑定执行引擎", "Bind execution engine")}
                </button>
                <button
                  className="action-button"
                  disabled={pending || !canManage || !record.boundContainerId}
                  onClick={onUnbindContainer}
                  type="button"
                >
                  {tx("解除绑定", "Unbind")}
                </button>
              </div>
            </form>
          </>
        ) : null}
        </div>
      </div>

      {showDeleteConfirm ? (
        <DeleteAgentModal
          agentName={record.name}
          pending={pending}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={onDeleteAgent}
        />
      ) : null}

      {showSkillPicker ? (
        <SkillPickerModal
          pending={pending}
          skills={availableSkills}
          onCancel={() => setShowSkillPicker(false)}
          onSelect={(skillId) => {
            onSetSkillIds([...assignedSkillIds, skillId]);
            setShowSkillPicker(false);
          }}
        />
      ) : null}

      {showKnowledgePicker ? (
        <KnowledgePickerModal
          pages={knowledge.assignablePages}
          pending={pending}
          onCancel={() => setShowKnowledgePicker(false)}
          onSelect={(pageId) => {
            onSetKnowledgePageIds?.([...knowledge.directPageIds, pageId]);
            setShowKnowledgePicker(false);
          }}
        />
      ) : null}
    </div>
  );
}

function KnowledgePickerModal({
  pages,
  pending,
  onCancel,
  onSelect,
}: {
  readonly pages: NonNullable<WorkspaceAgentRecord["knowledge"]>["assignablePages"];
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onSelect: (pageId: string) => void;
}) {
  const { tx } = useLanguage();
  const [query, setQuery] = useState("");
  const filteredPages = pages.filter((page) => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalizedQuery) {
      return true;
    }
    const haystack = `${page.title} ${page.tags.join(" ")}`.toLocaleLowerCase("zh-CN");
    return haystack.includes(normalizedQuery);
  });

  return (
    <div className="knowledge-modal-overlay" onClick={onCancel}>
      <div className="knowledge-modal" onClick={(event) => event.stopPropagation()}>
        <h3>{tx("添加知识", "Add knowledge")}</h3>
        <input
          className="knowledge-modal__input"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={tx("搜索知识页", "Search knowledge pages")}
          value={query}
        />
        <div className="knowledge-import-list">
          {filteredPages.map((page) => (
            <button
              className="knowledge-import-item"
              disabled={pending}
              key={page.id}
              onClick={() => onSelect(page.id)}
              type="button"
            >
              <strong>{page.title}</strong>
              <span>{page.tags.length > 0 ? page.tags.join(", ") : tx("无标签", "No tags")}</span>
            </button>
          ))}
          {filteredPages.length === 0 ? (
            <div className="knowledge-viewer__meta">
              {tx("没有匹配知识页。", "No matching knowledge pages.")}
            </div>
          ) : null}
        </div>
        <div className="knowledge-modal__footer">
          <button className="knowledge-btn knowledge-btn--ghost" onClick={onCancel} type="button">
            {tx("关闭", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function translateSkillSourceLabel(
  skill: WorkspaceAgentRecord["skills"][number],
  tx: (zh: string, en: string) => string,
): string {
  if (skill.sourceType === "builtin") {
    return tx("系统默认技能", "System default skill");
  }
  if (skill.sourceType === "github") {
    return tx("来自 GitHub 导入", "Imported from GitHub");
  }
  if (skill.sourceType === "skills.sh") {
    return tx("来自 skills.sh 导入", "Imported from skills.sh");
  }
  if (skill.sourceType === "clawhub") {
    return tx("来自 ClawHub 导入", "Imported from ClawHub");
  }
  if (skill.sourceType === "local") {
    return tx("来自本地导入", "Imported from local files");
  }
  return tx("手动创建", "Created manually");
}

function formatProviderUsability(
  health: NonNullable<WorkspaceAgentRecord["boundProviderHealth"]>,
  tx: (zh: string, en: string) => string,
): string {
  if (health.providerUsable === "usable") {
    return health.providerHealth === "degraded" ? tx("降级可用", "Degraded") : tx("可用", "Available");
  }
  if (health.providerUsable === "unusable") {
    return tx("不可用", "Unavailable");
  }
  return tx("未验证", "Unverified");
}

function providerUsabilityStatusTone(
  health: NonNullable<WorkspaceAgentRecord["boundProviderHealth"]>,
): "positive" | "warning" | "danger" | "neutral" {
  if (health.providerUsable === "usable") {
    return health.providerHealth === "degraded" ? "warning" : "positive";
  }
  if (health.providerUsable === "unusable") {
    return "danger";
  }
  return "neutral";
}

function formatProviderError(health: NonNullable<WorkspaceAgentRecord["boundProviderHealth"]>): string {
  return [
    health.lastProviderErrorCode,
    health.lastProviderErrorMessage ?? health.providerHealthReason,
  ].filter(Boolean).join(" · ");
}

function formatAgentGoogleWorkspaceStatus(
  status: NonNullable<WorkspaceAgentRecord["googleWorkspaceDelegation"]>["status"],
  tx: (zh: string, en: string) => string,
): string {
  if (status === "connected") {
    return tx("已授权", "Delegated");
  }
  if (status === "reconnect_required") {
    return tx("需重连", "Reconnect");
  }
  if (status === "revoked") {
    return tx("已撤销", "Revoked");
  }
  return tx("未授权", "Not delegated");
}

function agentGoogleWorkspaceStatusTone(
  status: NonNullable<WorkspaceAgentRecord["googleWorkspaceDelegation"]>["status"],
): "positive" | "warning" | "danger" | "neutral" {
  if (status === "connected") {
    return "positive";
  }
  if (status === "reconnect_required") {
    return "warning";
  }
  if (status === "revoked") {
    return "danger";
  }
  return "neutral";
}

function formatAgentDocumentRole(
  role: "viewer" | "editor" | "forwarder",
  tx: (zh: string, en: string) => string,
): string {
  if (role === "forwarder") {
    return tx("可转发", "Forwarder");
  }
  if (role === "editor") {
    return tx("可编辑", "Editor");
  }
  return tx("可查看", "Viewer");
}

function agentDocumentRoleTone(role: "viewer" | "editor" | "forwarder"): "positive" | "warning" | "danger" | "neutral" {
  if (role === "forwarder") {
    return "positive";
  }
  if (role === "editor") {
    return "warning";
  }
  return "neutral";
}

function formatDocumentRequestStatus(
  status: "pending" | "approved" | "rejected" | "cancelled",
  tx: (zh: string, en: string) => string,
): string {
  if (status === "pending") {
    return tx("待审批", "Pending");
  }
  if (status === "approved") {
    return tx("已批准", "Approved");
  }
  if (status === "rejected") {
    return tx("已拒绝", "Rejected");
  }
  return tx("已取消", "Cancelled");
}

function documentRequestStatusTone(
  status: "pending" | "approved" | "rejected" | "cancelled",
): "positive" | "warning" | "danger" | "neutral" {
  if (status === "approved") {
    return "positive";
  }
  if (status === "pending") {
    return "warning";
  }
  if (status === "rejected") {
    return "danger";
  }
  return "neutral";
}

function formatAgentTimestamp(value: string): string {
  return formatCompactTimestamp(value, { emptyFallback: value });
}

function translateContinuationMode(
  mode: RouterExecutionView["continuationMode"],
  tx: (zh: string, en: string) => string,
): string {
  if (mode === "same_provider_resume") return tx("同 provider 续跑", "Same-provider resume");
  if (mode === "fallback") return tx("Fallback 冷重建", "Fallback cold rebuild");
  return tx("平台上下文冷重建", "Platform cold rebuild");
}

function renderWorkAreaLocation(
  area: {
    workDir?: string;
    workDirAccess?: "local" | "remote";
    workDirHostLabel?: string;
  },
  tx: (zh: string, en: string) => string,
): string {
  if (area.workDirAccess === "remote") {
    const hostLabel = area.workDirHostLabel ?? tx("远程宿主", "Remote host");
    return tx(`远程执行工作区: ${hostLabel} · 路径仅供诊断`, `Remote execution workspace: ${hostLabel} · path shown for diagnostics only`);
  }

  return tx(`执行工作区: ${area.workDir ?? tx("未返回", "Unavailable")}`, `Execution workspace: ${area.workDir ?? tx("未返回", "Unavailable")}`);
}
