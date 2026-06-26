import assert from "node:assert/strict";
import test from "node:test";
import {
  checkFeishuIntegrationHealth,
  createFeishuApiClient,
  fetchFeishuTenantAccessToken,
  readFeishuAppScopes,
  readFeishuBotInfo,
} from "../index.ts";
import type { FeishuApiClient } from "../client.ts";
import { FEISHU_DEFAULT_SCOPES } from "../constants.ts";

test("fetchFeishuTenantAccessToken posts app credentials and returns tenant token", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({
      code: 0,
      tenant_access_token: "t-tenant",
      expire: 7200,
    }), { status: 200 });
  };

  const token = await fetchFeishuTenantAccessToken({
    appId: "cli_a",
    appSecret: "secret",
    baseUrl: "https://feishu.test",
    fetchImpl: fetchImpl as typeof fetch,
  });

  assert.deepEqual(token, {
    tenantAccessToken: "t-tenant",
    expireSeconds: 7200,
  });
  assert.equal(requests[0]?.url, "https://feishu.test/open-apis/auth/v3/tenant_access_token/internal");
  assert.deepEqual(requests[0]?.body, {
    app_id: "cli_a",
    app_secret: "secret",
  });
});

test("fetchFeishuTenantAccessToken rejects unsafe base URLs before sending app credentials", async () => {
  let fetchCount = 0;
  await assert.rejects(
    fetchFeishuTenantAccessToken({
      appId: "cli_a",
      appSecret: "secret-value",
      baseUrl: "https://127.0.0.1",
      fetchImpl: (async () => {
        fetchCount += 1;
        throw new Error("fetch should not run");
      }) as typeof fetch,
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "feishu.api_base_url_unsafe" &&
      !error.message.includes("127.0.0.1") &&
      !error.message.includes("secret-value"),
  );
  assert.equal(fetchCount, 0);
});

test("createFeishuApiClient rejects non-Feishu public base URLs before API calls", async () => {
  let fetchCount = 0;
  assert.throws(
    () => createFeishuApiClient({
      credentials: {
        appId: "cli_a",
        appSecret: "secret-value",
        tenantAccessToken: "tenant-token-secret",
      },
      baseUrl: "https://example.com",
      fetchImpl: (async () => {
        fetchCount += 1;
        throw new Error("fetch should not run");
      }) as typeof fetch,
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "feishu.api_base_url_unsafe" &&
      !error.message.includes("example.com") &&
      !error.message.includes("tenant-token-secret"),
  );
  assert.equal(fetchCount, 0);
});

test("readFeishuBotInfo resolves bot fields from Feishu response data", async () => {
  const client: FeishuApiClient = {
    async request(input) {
      assert.equal(input.path, "/open-apis/bot/v3/info");
      return {
        data: {
          open_id: "ou_bot",
          app_name: "AgentSpace Bot",
        },
      };
    },
  };

  await assert.doesNotReject(async () => {
    const info = await readFeishuBotInfo(client);
    assert.deepEqual(info, {
      botOpenId: "ou_bot",
      botAppName: "AgentSpace Bot",
    });
  });
});

test("readFeishuAppScopes resolves granted app scope names", async () => {
  const client: FeishuApiClient = {
    async request(input) {
      assert.equal(input.path, "/open-apis/application/v6/scopes");
      return {
        data: {
          items: [
            { scope: "im:message", grant_status: 1 },
            { scope: "bitable:app", grant_status: 1 },
            { scope: "admin:unsafe", grant_status: 0 },
            { scope: "im:message", grant_status: 1 },
          ],
        },
      };
    },
  };

  assert.deepEqual(await readFeishuAppScopes(client), [
    "bitable:app",
    "im:message",
  ]);
});

test("checkFeishuIntegrationHealth returns ok after token and bot info succeed", async () => {
  const result = await checkFeishuIntegrationHealth({
    appId: "cli_a",
    appSecret: "secret",
    fetchImpl: (async () => new Response(JSON.stringify({
      code: 0,
      tenant_access_token: "t-tenant",
    }), { status: 200 })) as typeof fetch,
    clientFactory: (tenantAccessToken) => ({
      async request(input) {
        assert.equal(tenantAccessToken, "t-tenant");
        if (input.path === "/open-apis/application/v6/scopes") {
          return {
            data: {
              items: FEISHU_DEFAULT_SCOPES.map((scope) => ({
                scope,
                grant_status: 1,
              })),
            },
          };
        }
        return {
          data: {
            open_id: "ou_bot",
            app_name: "AgentSpace Bot",
          },
        };
      },
    }),
  });

  assert.equal(result.status, "healthy");
  assert.equal("tenantAccessToken" in result, false);
  assert.equal(result.botOpenId, "ou_bot");
  assert.equal(result.scopeReadiness, "verified");
  assert.deepEqual(result.missingScopes, []);
});

test("checkFeishuIntegrationHealth degrades when required scopes are missing", async () => {
  const result = await checkFeishuIntegrationHealth({
    appId: "cli_a",
    appSecret: "secret",
    fetchImpl: (async () => new Response(JSON.stringify({
      code: 0,
      tenant_access_token: "t-tenant",
    }), { status: 200 })) as typeof fetch,
    clientFactory: () => ({
      async request(input) {
        if (input.path === "/open-apis/application/v6/scopes") {
          return {
            data: {
              items: [
                { scope: "im:message", grant_status: 1 },
              ],
            },
          };
        }
        return {
          data: {
            open_id: "ou_bot",
            app_name: "AgentSpace Bot",
          },
        };
      },
    }),
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.scopeReadiness, "missing_required_scopes");
  assert.deepEqual(result.enabledScopes, ["im:message"]);
  assert.ok(result.missingScopes?.includes("bitable:app"));
  assert.match(result.errorMessage ?? "", /missing required scopes/);
  assert.match(result.errorMessage ?? "", /bitable:app/);
});

test("checkFeishuIntegrationHealth degrades when Feishu rejects scope inspection", async () => {
  const result = await checkFeishuIntegrationHealth({
    appId: "cli_a",
    appSecret: "secret",
    fetchImpl: (async () => new Response(JSON.stringify({
      code: 0,
      tenant_access_token: "t-tenant",
    }), { status: 200 })) as typeof fetch,
    clientFactory: () => ({
      async request(input) {
        if (input.path === "/open-apis/application/v6/scopes") {
          return {
            code: 99991663,
            msg: "permission denied for app_id cli_a app_secret=secret Bearer t-tenant",
          };
        }
        return {
          data: {
            open_id: "ou_bot",
            app_name: "AgentSpace Bot",
          },
        };
      },
    }),
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.scopeReadiness, "unauthorized");
  assert.match(result.scopeErrorMessage ?? "", /permission denied/);
  assert.match(result.errorMessage ?? "", /scope check was rejected/);
  assert.match(result.scopeErrorMessage ?? "", /\[redacted\]/);
  assert.match(result.errorMessage ?? "", /\[redacted\]/);
  assert.equal(JSON.stringify(result).includes("cli_a"), false);
  assert.equal(JSON.stringify(result).includes("app_secret=secret"), false);
  assert.equal(JSON.stringify(result).includes("t-tenant"), false);
});

test("checkFeishuIntegrationHealth falls back to manual scope review when scope read fails", async () => {
  const result = await checkFeishuIntegrationHealth({
    appId: "cli_a",
    appSecret: "secret",
    fetchImpl: (async () => new Response(JSON.stringify({
      code: 0,
      tenant_access_token: "t-tenant",
    }), { status: 200 })) as typeof fetch,
    clientFactory: () => ({
      async request(input) {
        if (input.path === "/open-apis/application/v6/scopes") {
          throw new Error("scope API denied appId=cli_a appSecret=secret Bearer t-tenant");
        }
        return {
          data: {
            open_id: "ou_bot",
            app_name: "AgentSpace Bot",
          },
        };
      },
    }),
  });

  assert.equal(result.status, "degraded");
  assert.equal(result.scopeReadiness, "manual_review_required");
  assert.match(result.scopeErrorMessage ?? "", /scope API denied/);
  assert.match(result.errorMessage ?? "", /could not be verified automatically/);
  assert.match(result.scopeErrorMessage ?? "", /\[redacted\]/);
  assert.match(result.errorMessage ?? "", /\[redacted\]/);
  assert.equal(JSON.stringify(result).includes("cli_a"), false);
  assert.equal(JSON.stringify(result).includes("appSecret=secret"), false);
  assert.equal(JSON.stringify(result).includes("t-tenant"), false);
});

test("checkFeishuIntegrationHealth returns error when token request fails", async () => {
  const result = await checkFeishuIntegrationHealth({
    appId: "cli_a",
    appSecret: "secret",
    fetchImpl: (async () => new Response(JSON.stringify({
      code: 999,
      msg: "bad credentials app_id=cli_a app_secret=secret",
    }), { status: 200 })) as typeof fetch,
  });

  assert.equal(result.status, "error");
  assert.match(result.errorMessage ?? "", /bad credentials/);
  assert.match(result.errorMessage ?? "", /\[redacted\]/);
  assert.equal(JSON.stringify(result).includes("cli_a"), false);
  assert.equal(JSON.stringify(result).includes("app_secret=secret"), false);
});
