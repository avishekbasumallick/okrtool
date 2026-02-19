import { NextResponse } from "next/server";
import type { AiUpdate } from "@/lib/types";
import { reconcileWithGemini } from "@/lib/gemini-reconcile";
import { rowToActiveOKR, type OkrRow } from "@/lib/okr-mappers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireUserId } from "@/lib/user-id";

export async function POST(request: Request) {
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
      .eq("status", "active")
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

    const updates = await reconcileWithGemini(active);

    const updatesById = new Map(updates.map((u) => [u.id, u]));
    const dbUpdates = rows
      .map((row) => {
        const update = updatesById.get(row.id);
        if (!update) {
          return null;
        }

        return {
          id: row.id,
          category: update.category,
          priority: update.priority,
          scope: update.scope,
          deadline: update.deadline,
          updated_at: new Date().toISOString()
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    if (dbUpdates.length > 0) {
      const { error: upsertError } = await supabase.from("okrs").upsert(dbUpdates, { onConflict: "id" });
      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 });
      }
    }

    const { data: refreshed, error: refreshedError } = await supabase
      .from("okrs")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active")
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
