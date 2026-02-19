import type { ActiveOKR, AiUpdate, Priority } from "@/lib/types";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

type GeminiModel = {
  name: string;
  supportedGenerationMethods?: string[];
};

type GeminiListModelsResponse = {
  models?: GeminiModel[];
};

const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4", "P5"];
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

let cachedAutoModel: string | null = null;

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

function scoreModelName(modelName: string) {
  const n = modelName.toLowerCase();
  let score = 0;
  if (n.includes("gemini")) score += 10;
  if (n.includes("2")) score += 6;
  if (n.includes("flash")) score += 5;
  if (n.includes("lite")) score += 1;
  if (n.includes("exp")) score -= 2;
  return score;
}

async function pickGeminiModel(apiKey: string): Promise<string> {
  if (cachedAutoModel) {
    return cachedAutoModel;
  }

  const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!listResp.ok) {
    const errText = await listResp.text();
    throw new Error(`Gemini ListModels failed: ${errText}`);
  }

  const data = (await listResp.json()) as GeminiListModelsResponse;
  const models = data.models ?? [];

  const candidates = models
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name)
    .map((name) => (name.startsWith("models/") ? name.slice("models/".length) : name));

  if (candidates.length === 0) {
    throw new Error("No Gemini models available that support generateContent.");
  }

  candidates.sort((a, b) => scoreModelName(b) - scoreModelName(a));
  cachedAutoModel = candidates[0] ?? null;
  return cachedAutoModel;
}

function shouldRetryWithAutoModel(status: number, errorText: string) {
  if (status !== 404 && status !== 400) {
    return false;
  }

  const normalized = errorText.toLowerCase();
  return normalized.includes("not found") || normalized.includes("not supported") || normalized.includes("listmodels");
}

async function callGeminiGenerateContent(apiKey: string, model: string, prompt: string) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    }
  );
}

export async function reconcileWithGemini(okrs: ActiveOKR[]): Promise<AiUpdate[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  const configuredModelRaw = process.env.GEMINI_MODEL;

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY. Add it in .env.local (local) and Vercel Project Settings.");
  }

  const configuredModel = configuredModelRaw?.trim() ? configuredModelRaw.trim() : null;
  const initialModel = configuredModel ?? DEFAULT_GEMINI_MODEL;

  const prompt = [
    "You are an OKR operations assistant.",
    "Given a set of active OKRs, return JSON array only.",
    "For each input OKR id, output: id, category, priority(P1-P5), scope, deadline(YYYY-MM-DD).",
    "Goals:",
    "- Categorize each OKR into a practical business category.",
    "- Prioritize all OKRs relative to each other.",
    "- Refine scope to be concise and measurable.",
    "- Recalculate each deadline if necessary, based on priority, scope size, and current date.",
    "- Keep deadlines realistic and ensure they are not in the past.",
    "Keep same number of items as input and keep ids unchanged.",
    `Input OKRs: ${JSON.stringify(okrs)}`
  ].join("\n");

  let response = await callGeminiGenerateContent(apiKey, initialModel, prompt);

  if (!response.ok && !configuredModel) {
    const errorText = await response.text();
    if (shouldRetryWithAutoModel(response.status, errorText)) {
      const autoModel = await pickGeminiModel(apiKey);
      response = await callGeminiGenerateContent(apiKey, autoModel, prompt);
    } else {
      throw new Error(`Gemini API request failed: ${errorText}`);
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API request failed: ${errorText}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";

  if (!text.trim()) {
    return okrs.map(fallbackUpdate);
  }

  const parsed = JSON.parse(safeJsonExtract(text)) as Array<Partial<AiUpdate>>;
  const byId = new Map(parsed.map((entry) => [entry.id, entry]));

  return okrs.map((okr) => {
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
}
