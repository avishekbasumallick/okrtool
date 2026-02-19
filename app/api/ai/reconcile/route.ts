import { NextResponse } from "next/server";
import type { ActiveOKR } from "@/lib/types";
import { reconcileWithGemini } from "@/lib/gemini-reconcile";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { okrs?: ActiveOKR[] };
    const okrs = body.okrs ?? [];

    if (!Array.isArray(okrs) || okrs.length === 0) {
      return NextResponse.json({ error: "No OKRs provided." }, { status: 400 });
    }

    const updates = await reconcileWithGemini(okrs);
    return NextResponse.json({ updates });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected reconcile failure." },
      { status: 500 }
    );
  }
}
