import test from "node:test";
import assert from "node:assert/strict";
import { applyMentionSelection, findDraftMentionQuery, parseAgentMentions, type MentionCandidate } from "./mentions.ts";
import { parseMentionPlan } from "./mention-plan.ts";

const candidates: MentionCandidate[] = [
  {
    agentId: "atlas",
    label: "Atlas",
    aliases: ["Atlas", "阿特拉斯"],
    inChannel: true,
  },
  {
    agentId: "nova",
    label: "Nova",
    aliases: ["Nova"],
    inChannel: false,
  },
];

test("parseAgentMentions parses one or many valid mentions", () => {
  const parsed = parseAgentMentions("@Atlas 看下这个报错，并请 @Nova 帮忙补执行链路", candidates);

  assert.deepEqual(
    parsed.mentions.map((mention) => ({
      agentId: mention.agentId,
      label: mention.label,
      token: mention.token,
      inChannel: mention.inChannel,
    })),
    [
      { agentId: "atlas", label: "Atlas", token: "Atlas", inChannel: true },
      { agentId: "nova", label: "Nova", token: "Nova", inChannel: false },
    ],
  );
  assert.deepEqual(parsed.unknownMentions, []);
});

test("parseAgentMentions ignores emails and reports unknown mentions", () => {
  const parsed = parseAgentMentions("联系 foo@bar.com，然后 @Ghost 看一下", candidates);

  assert.deepEqual(parsed.mentions, []);
  assert.deepEqual(parsed.unknownMentions, ["Ghost"]);
});

test("findDraftMentionQuery detects the active mention query", () => {
  const draft = "请 @Atl";
  const query = findDraftMentionQuery(draft, draft.length);

  assert.deepEqual(query, {
    query: "Atl",
    start: 2,
    end: draft.length,
  });
});

test("applyMentionSelection replaces the active mention query", () => {
  const draft = "请 @Atl 处理";
  const next = applyMentionSelection(draft, 6, "Atlas");

  assert.equal(next.value, "请 @Atlas 处理");
  assert.equal(next.caretIndex, 9);
});

test("parseMentionPlan returns sequential steps for obvious handoff phrasing", () => {
  const plan = parseMentionPlan(
    "@Atlas 把旅游 markdown 发给 @Nova，然后 @Nova 继续完善",
    candidates,
  );

  assert.equal(plan.mode, "sequential");
  assert.deepEqual(
    plan.steps.map((step) => ({
      agentId: step.agentId,
      dependsOnStepIds: step.dependsOnStepIds,
      handoffKind: step.handoffKind,
    })),
    [
      {
        agentId: "atlas",
        dependsOnStepIds: [],
        handoffKind: "document",
      },
      {
        agentId: "nova",
        dependsOnStepIds: ["step-1"],
        handoffKind: "document",
      },
    ],
  );
});

test("parseMentionPlan treats direct handoff phrasing as sequential even without 然后", () => {
  const plan = parseMentionPlan("@Atlas 把旅游 markdown 发给 @Nova", candidates);

  assert.equal(plan.mode, "sequential");
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps[0]?.agentId, "atlas");
  assert.equal(plan.steps[1]?.agentId, "nova");
  assert.deepEqual(plan.steps[1]?.dependsOnStepIds, ["step-1"]);
  assert.equal(plan.steps[1]?.handoffKind, "document");
});

test("parseMentionPlan does not split on 先 inside 首先", () => {
  const plan = parseMentionPlan("@Atlas 首先处理，@Nova 随后跟进", candidates);

  assert.notEqual(plan.steps[0]?.instruction, "@Atlas 首");
  assert.match(plan.steps[0]?.instruction ?? "", /首先处理/);
});

test("parseMentionPlan still treats standalone 先 as a sequential marker", () => {
  const plan = parseMentionPlan("@Atlas 先起草，然后 @Nova 审阅", candidates);

  assert.equal(plan.mode, "sequential");
  assert.equal(plan.steps[0]?.agentId, "atlas");
  assert.equal(plan.steps[1]?.agentId, "nova");
});

test("parseMentionPlan keeps similarly prefixed agent names distinct", () => {
  const plan = parseMentionPlan(
    "@Test-CC 你看一下采访，然后整理一份需要搜索的对象给 @Test",
    [
      {
        agentId: "Test",
        label: "Test",
        aliases: ["Test"],
        inChannel: true,
      },
      {
        agentId: "Test-codex",
        label: "Test-codex",
        aliases: ["Test-codex"],
        inChannel: true,
      },
      {
        agentId: "Test-CC",
        label: "Test-CC",
        aliases: ["Test-CC"],
        inChannel: false,
      },
    ],
  );

  assert.equal(plan.mode, "sequential");
  assert.equal(plan.steps[0]?.agentId, "Test-CC");
  assert.equal(plan.steps[1]?.agentId, "Test");
});

test("parseMentionPlan warns when collaboration looks sequential but order is unclear", () => {
  const plan = parseMentionPlan("@Atlas 和 @Nova 一起完善这份计划", candidates);

  assert.equal(plan.mode, "parallel");
  assert.ok(plan.warnings.some((warning) => warning.includes("无法可靠识别顺序依赖")));
});
