import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { WORKSPACE_SELECTION_COOKIE } from "@/features/auth/workspace-selection-constants";

function decodeWorkspaceSlug(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) {
      return undefined;
    }
    throw error;
  }
}

export function proxy(request: NextRequest): NextResponse {
  const match = request.nextUrl.pathname.match(/^\/w\/([^/]+)/);
  if (!match?.[1]) {
    return NextResponse.next();
  }

  const workspaceSlug = decodeWorkspaceSlug(match[1]);
  if (!workspaceSlug) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set(WORKSPACE_SELECTION_COOKIE, workspaceSlug, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
  });
  return response;
}

export const config = {
  matcher: ["/w/:path*"],
};
