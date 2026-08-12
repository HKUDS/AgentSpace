import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { WORKSPACE_SELECTION_COOKIE } from "@/features/auth/workspace-selection-constants";
import { proxy } from "./proxy";

describe("workspace selection proxy", () => {
  it("stores a decoded workspace slug", () => {
    const response = proxy(new NextRequest("https://example.com/w/team%20alpha"));

    expect(response.cookies.get(WORKSPACE_SELECTION_COOKIE)?.value).toBe("team alpha");
  });

  it("ignores malformed percent-encoding instead of throwing", () => {
    const request = new NextRequest("https://example.com/w/team%ZZ");

    expect(() => proxy(request)).not.toThrow();
    expect(proxy(request).cookies.get(WORKSPACE_SELECTION_COOKIE)).toBeUndefined();
  });
});
