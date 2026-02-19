import { NextResponse } from "next/server";
import type { ActiveOKR, AiUpdate, Priority } from "@/lib/types";

type ZaiResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4", "P5"];

function normalizePriority(value: string): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : "P3";
}

function safeJsonExtract(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1];
  }

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }

  return text;
}

function fallbackUpdate(okr: ActiveOKR): AiUpdate {
  const due = new Date();
  due.setDate(due.getDate() + 14);

  return {
    id: okr.id,
    category: okr.category || "General",
    priority: okr.priority || "P3",
    scope: okr.scope,
    deadline: okr.deadline || due.toISOString().split("T")[0]
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { okrs?: ActiveOKR[] };
    const okrs = body.okrs ?? [];

    if (!Array.isArray(okrs) || okrs.length === 0) {
      return NextResponse.json({ error: "No OKRs provided." }, { status: 400 });
    }

    const apiKey = process.env.ZAI_API_KEY;
    const model = process.env.ZAI_MODEL ?? "glm-5";
    const baseUrl = process.env.ZAI_BASE_URL ?? "https://api.z.ai/api/paas/v4";

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Missing ZAI_API_KEY. Add it in .env.local (local) and Vercel Project Settings (production/preview)."
        },
        { status: 400 }
      );
    }

    const prompt = [
      "Given a set of active OKRs, return JSON array only.",
      "For each input OKR id, output: id, category, priority(P1-P5), scope, deadline(YYYY-MM-DD).",
      "Goals:",
      "- Categorize each OKR into a practical business category.",
      "- Prioritize all OKRs relative to each other.",
      "- Refine scope to be concise and measurable.",
      "- Set realistic deadlines.",
      "Keep same number of items as input and keep ids unchanged.",
      `Input OKRs: ${JSON.stringify(okrs)}`
    ].join("\n");

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are an OKR operations assistant. Always return strict JSON array only, with no prose or markdown."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        stream: false
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json({ error: `GLM API request failed: ${errorText}` }, { status: 502 });
    }

    const data = (await response.json()) as ZaiResponse;
    const text = data.choices?.[0]?.message?.content ?? "";

    if (!text.trim()) {
      return NextResponse.json({ updates: okrs.map(fallbackUpdate) });
    }

    const parsed = JSON.parse(safeJsonExtract(text)) as Array<Partial<AiUpdate>>;
    const byId = new Map(parsed.map((entry) => [entry.id, entry]));

    const updates = okrs.map((okr) => {
      const candidate = byId.get(okr.id);
      if (!candidate) {
        return fallbackUpdate(okr);
      }

      return {
        id: okr.id,
        category: String(candidate.category ?? okr.category ?? "General"),
        priority: normalizePriority(String(candidate.priority ?? okr.priority ?? "P3")),
        scope: String(candidate.scope ?? okr.scope),
        deadline: String(candidate.deadline ?? okr.deadline)
      } satisfies AiUpdate;
    });

    return NextResponse.json({ updates });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected reconcile failure." },
      { status: 500 }
    );
  }
}
