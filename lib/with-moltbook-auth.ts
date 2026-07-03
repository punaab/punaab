import {
  MoltbookAuthError,
  requireMoltbookAgent,
  type VerifiedMoltbookAgent,
} from "@/lib/moltbook-auth";
import { NextRequest, NextResponse } from "next/server";

export type MoltbookAuthHandler = (
  request: NextRequest,
  context: { agent: VerifiedMoltbookAgent },
) => Promise<NextResponse> | NextResponse;

function authErrorResponse(error: MoltbookAuthError): NextResponse {
  return NextResponse.json(
    {
      error: error.code,
      message: error.message,
      hint: error.hint,
    },
    { status: error.status },
  );
}

/**
 * Wrap a route handler with Moltbook identity verification.
 * On success, passes `{ agent }` with the verified profile from verify-identity.
 */
export function withMoltbookAuth(handler: MoltbookAuthHandler) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const agent = await requireMoltbookAgent(request);
      return await handler(request, { agent });
    } catch (error) {
      if (error instanceof MoltbookAuthError) {
        return authErrorResponse(error);
      }
      console.error("[moltbook-auth] unexpected error:", error);
      return NextResponse.json(
        { error: "internal_error", message: "Authentication failed" },
        { status: 500 },
      );
    }
  };
}
