import { NextResponse } from "next/server";
import { rowToActiveOKR, rowToCompletedOKR, type OkrRow } from "@/lib/okr-mappers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireUserId } from "@/lib/user-id";

function fallbackScope(title: string) {
  return `Deliver ${title} with clear owner, measurable output, and stakeholder sign-off.`;
}

function fallbackDeadline() {
  const due = new Date();
  due.setDate(due.getDate() + 14);
  return due.toISOString().split("T")[0];
}

export async function GET(request: Request) {
  try {
    const userId = requireUserId(request);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("okrs")
      .select("*")
      .eq("user_id", userId)
      .order("priority", { ascending: true })
      .order("deadline", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as OkrRow[];
    const active = rows.filter((row) => row.status === "active").map(rowToActiveOKR);
    const archived = rows.filter((row) => row.status === "archived").map(rowToCompletedOKR);

    return NextResponse.json({ active, archived });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load OKRs." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireUserId(request);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const body = (await request.json()) as { title?: string; notes?: string };
    const title = body.title?.trim();
    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("okrs")
      .insert({
        user_id: userId,
        title,
        notes: (body.notes ?? "").trim(),
        scope: fallbackScope(title),
        deadline: fallbackDeadline(),
        category: "Uncategorized",
        priority: "P3",
        status: "active",
        created_at: now,
        updated_at: now
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ okr: rowToActiveOKR(data as OkrRow) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create OKR." },
      { status: 500 }
    );
  }
}
