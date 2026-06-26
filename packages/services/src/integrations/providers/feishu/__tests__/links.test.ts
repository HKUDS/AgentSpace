import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentSpaceChannelDeepLink,
  buildAgentSpaceSettingsIntegrationsDeepLink,
  readAgentSpaceAppUrl,
} from "../links.ts";

test("AgentSpace Feishu deep links use the public app URL and workspace path", () => {
  withAgentSpaceAppUrl("https://agentspace.test", () => {
    assert.equal(readAgentSpaceAppUrl(), "https://agentspace.test/");
    assert.equal(
      buildAgentSpaceSettingsIntegrationsDeepLink({ workspaceId: "mars-labs" }),
      "https://agentspace.test/w/mars-labs/settings/integrations",
    );
    assert.equal(
      buildAgentSpaceSettingsIntegrationsDeepLink({
        workspaceId: "mars-labs",
        target: "user-bindings",
      }),
      "https://agentspace.test/w/mars-labs/settings/integrations#feishu-user-bindings",
    );
    assert.equal(
      buildAgentSpaceSettingsIntegrationsDeepLink({
        workspaceId: "mars-labs",
        target: "channel-bindings",
      }),
      "https://agentspace.test/w/mars-labs/settings/integrations#feishu-channel-bindings",
    );
    assert.equal(
      buildAgentSpaceChannelDeepLink({
        workspaceId: "mars-labs",
        channelName: "tour visit",
      }),
      "https://agentspace.test/w/mars-labs/im?focus=channel%3Atour+visit",
    );
  });
});

test("AgentSpace Feishu deep links stay disabled when the public app URL is invalid", () => {
  withAgentSpaceAppUrl("not a url", () => {
    assert.equal(readAgentSpaceAppUrl(), undefined);
    assert.equal(
      buildAgentSpaceSettingsIntegrationsDeepLink({ workspaceId: "workspace-1" }),
      undefined,
    );
  });
});

function withAgentSpaceAppUrl<T>(appUrl: string | undefined, run: () => T): T {
  const previous = {
    AGENT_SPACE_APP_URL: process.env.AGENT_SPACE_APP_URL,
    NEXT_PUBLIC_AGENT_SPACE_APP_URL: process.env.NEXT_PUBLIC_AGENT_SPACE_APP_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
  setOptionalEnv("AGENT_SPACE_APP_URL", appUrl);
  setOptionalEnv("NEXT_PUBLIC_AGENT_SPACE_APP_URL", undefined);
  setOptionalEnv("NEXT_PUBLIC_APP_URL", undefined);

  try {
    return run();
  } finally {
    setOptionalEnv("AGENT_SPACE_APP_URL", previous.AGENT_SPACE_APP_URL);
    setOptionalEnv("NEXT_PUBLIC_AGENT_SPACE_APP_URL", previous.NEXT_PUBLIC_AGENT_SPACE_APP_URL);
    setOptionalEnv("NEXT_PUBLIC_APP_URL", previous.NEXT_PUBLIC_APP_URL);
  }
}

function setOptionalEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
