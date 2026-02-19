import { NextResponse } from "next/server";

export async function POST() {
  // Deprecated: prioritization no longer asks user questions.
  return NextResponse.json(
    { error: "Prioritization questions are no longer supported." },
    { status: 410 }
  );
}
