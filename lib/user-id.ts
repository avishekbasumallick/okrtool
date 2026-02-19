import { NextResponse } from "next/server";

export function requireUserId(request: Request): string | NextResponse {
  const userId = request.headers.get("x-user-id")?.trim();

  if (!userId) {
    return NextResponse.json({ error: "Missing x-user-id header." }, { status: 400 });
  }

  if (userId.length > 128) {
    return NextResponse.json({ error: "Invalid x-user-id header." }, { status: 400 });
  }

  return userId;
}
