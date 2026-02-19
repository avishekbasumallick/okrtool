import { NextResponse } from "next/server";
import type { Priority } from "@/lib/types";
import { rowToActiveOKR, type OkrRow } from "@/lib/okr-mappers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { requireAuthUserId } from "@/lib/auth-user";
import { BROAD_CATEGORIES } from "@/lib/categories";

const PRIORITIES = new Set<Priority>(["P1", "P2", "P3", "P4", "P5"]);
const CATEGORIES = new Set<string>(BROAD_CATEGORIES);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuthUserId(request);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const { id } = await context.params;
    const body = (await request.json()) as {
      title?: string;
      scope?: string;
      deadline?: string;
      category?: string;
      priority?: Priority;
      notes?: string;
    };

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    if (typeof body.title === "string") patch.title = body.title.trim();
    if (typeof body.scope === "string") patch.scope = body.scope.trim();
    if (typeof body.deadline === "string") patch.deadline = body.deadline;
    if (typeof body.notes === "string") patch.notes = body.notes.trim();

    if (typeof body.category === "string") {
      if (!CATEGORIES.has(body.category)) {
        return NextResponse.json({ error: "Invalid category value." }, { status: 400 });
      }
      patch.category = body.category;
    }

    if (typeof body.priority === "string") {
      if (!PRIORITIES.has(body.priority)) {
        return NextResponse.json({ error: "Invalid priority value." }, { status: 400 });
      }
      patch.priority = body.priority;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("okrs")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "active")
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "OKR not found." }, { status: 404 });
    }

    return NextResponse.json({ okr: rowToActiveOKR(data as OkrRow) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update OKR." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireAuthUserId(request);
    if (userId instanceof NextResponse) {
      return userId;
    }

    const { id } = await context.params;
    const supabase = getSupabaseAdmin();

    const { error } = await supabase.from("okrs").delete().eq("id", id).eq("user_id", userId).eq("status", "active");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete OKR." },
      { status: 500 }
    );
  }
}
