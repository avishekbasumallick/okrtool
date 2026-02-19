import { NextResponse } from "next/server";
import type { AiUpdate } from "@/lib/types";
import { reconcileWithGemini } from "@/lib/gemini-reconcile";
import { rowToActiveOKR, type OkrRow } from "@/lib/okr-mappers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAuthUserId } from "@/lib/auth-user";

export async function POST(request: Request) {
  try {
    const userId = await requireAuthUserId(request);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const body = (await request.json()) as { category?: string };
    const category = body.category?.trim();

    if (!category) {
      return NextResponse.json({ error: "Category is required for reconcile." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("okrs")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .eq("category", category)
      .order("priority", { ascending: true })
      .order("deadline", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as OkrRow[];
    const active = rows.map(rowToActiveOKR);

    if (active.length === 0) {
      return NextResponse.json({ updates: [] });
    }

    const updates = await reconcileWithGemini(active, { category });
    const updatesById = new Map(updates.map((update) => [update.id, update]));

    for (const row of rows) {
      const update = updatesById.get(row.id);
      if (!update) {
        continue;
      }

      const { error: updateError } = await supabase
        .from("okrs")
        .update({
          category: update.category,
          priority: update.priority,
          scope: update.scope,
          deadline: update.deadline,
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id)
        .eq("user_id", userId)
        .eq("status", "active")
        .eq("category", category);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    const { data: refreshed, error: refreshedError } = await supabase
      .from("okrs")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
      .eq("category", category)
      .order("priority", { ascending: true })
      .order("deadline", { ascending: true });

    if (refreshedError) {
      return NextResponse.json({ error: refreshedError.message }, { status: 500 });
    }

    const refreshedRows = (refreshed ?? []) as OkrRow[];
    const activeAfter = refreshedRows.map(rowToActiveOKR);

    const normalizedUpdates: AiUpdate[] = activeAfter.map((okr) => ({
      id: okr.id,
      category: okr.category,
      priority: okr.priority,
      scope: okr.scope,
      deadline: okr.deadline
    }));

    return NextResponse.json({ updates: normalizedUpdates });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reconcile OKRs." },
      { status: 500 }
    );
  }
}
