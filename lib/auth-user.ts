import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function requireAuthUserId(request: Request): Promise<string | NextResponse> {
  const authHeader = request.headers.get("authorization")?.trim();
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const accessToken = authHeader.slice("Bearer ".length).trim();
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return data.user.id;
}
