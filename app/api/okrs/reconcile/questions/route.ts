import { NextResponse } from "next/server";
import { generatePriorityQuestions } from "@/lib/gemini-reconcile";
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
      return NextResponse.json({ error: "Category is required." }, { status: 400 });
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
      return NextResponse.json({ questions: [] });
    }

    const questions = await generatePriorityQuestions(active, category);
    return NextResponse.json({ questions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate questions." },
      { status: 500 }
    );
  }
}
