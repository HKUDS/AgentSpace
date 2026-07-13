import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(projectDir, "..", "..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["hire-an-agent.online", "feishu-e2e.hire-an-agent.online", "127.0.0.1", "localhost"],
  devIndicators: false,
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
    tsconfigPath: "tsconfig.typecheck.json",
  },
  transpilePackages: [
    "@agent-space/db",
    "@agent-space/domain",
    "@agent-space/sandbox",
    "@agent-space/services",
    "agent-space-daemon",
  ],
  outputFileTracingRoot: repositoryRoot,
  outputFileTracingExcludes: {
    "/*": [
      "../../.git/**/*",
      "../../.agentspace-record-live/**/*",
      "../../.claude/**/*",
      "../../.github/**/*",
      "../../Design/**/*",
      "../../PR/**/*",
      "../../TODO/**/*",
      "../../data/**/*",
      "../../demo/**/*",
      "../../docs/**/*",
      "../../example/**/*",
      "../../runtime-output/**/*",
      ".next/**/*",
      "e2e/**/*",
      "test/**/*",
      "test-results/**/*",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
  experimental: {
    externalDir: true,
  },
  turbopack: {
    resolveAlias: {
      "@agent-space/db": "../../packages/db/src/index.ts",
      "@agent-space/domain": "../../packages/domain/src/index.ts",
      "@agent-space/domain/workspace": "../../packages/domain/src/workspace.ts",
      "@agent-space/sandbox": "../../packages/sandbox/src/index.ts",
      "@agent-space/services": "../../packages/services/src/index.ts",
      "agent-space-daemon": "../../packages/daemon/src/index.ts",
      "agent-space-daemon/agent-router": "../../packages/daemon/src/agent-router/index.ts",
      "agent-space-daemon/daemon-client": "../../packages/daemon/src/daemon-client.ts",
    },
    root: repositoryRoot,
  },
};

export default nextConfig;
