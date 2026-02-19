import { NextResponse } from "next/server";
import { rowToCompletedOKR, type OkrRow } from "@/lib/okr-mappers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireUserId } from "@/lib/user-id";

function calculateExpectedVsActualDays(deadline: string, completedAt: string) {
  const expected = new Date(`${deadline}T00:00:00`);
  const actual = new Date(completedAt);
  const ms = actual.getTime() - expected.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = requireUserId(request);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const { id } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: existingData, error: existingError } = await supabase
      .from("okrs")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (!existingData) {
      return NextResponse.json({ error: "OKR not found." }, { status: 404 });
    }

    const existing = existingData as OkrRow;
    const completedAt = new Date().toISOString();
    const expectedVsActualDays = calculateExpectedVsActualDays(existing.deadline, completedAt);

    const { data, error } = await supabase
      .from("okrs")
      .update({
        status: "archived",
        completed_at: completedAt,
        expected_vs_actual_days: expectedVsActualDays,
        updated_at: completedAt
      })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "active")
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Failed to complete OKR." }, { status: 500 });
    }

    return NextResponse.json({ okr: rowToCompletedOKR(data as OkrRow) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to complete OKR." },
      { status: 500 }
    );
  }
}
