import { BROAD_CATEGORIES } from "@/lib/categories";
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
const UNCAT = "Uncategorized";
const DEFAULT_MODEL = "gemini-2.5-flash";

let cachedAutoModel: string | null = null;

function normalizePriority(value: string): Priority {
  return PRIORITIES.includes(value as Priority) ? (value as Priority) : "P3";
}

function safeJsonExtract(text: string) {
  const fencedMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1];
  }

  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return text.slice(arrayStart, arrayEnd + 1);
  }

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return text.slice(objectStart, objectEnd + 1);
  }

  return text;
}

function parseJsonCandidates(raw: string): unknown[] {
  const candidates = [safeJsonExtract(raw), raw].map((value) => value.trim()).filter(Boolean);
  const parsed: unknown[] = [];

  for (const candidate of candidates) {
    const normalizedVariants = [candidate, candidate.replace(/,\s*([}\]])/g, "$1")];

    for (const variant of normalizedVariants) {
      try {
        parsed.push(JSON.parse(variant) as unknown);
      } catch {
        continue;
      }
    }
  }

  return parsed;
}

function tryParseUpdateArray(raw: string): Array<Partial<AiUpdate>> | null {
  for (const parsed of parseJsonCandidates(raw)) {
    if (Array.isArray(parsed)) {
      return parsed as Array<Partial<AiUpdate>>;
    }

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "updates" in parsed &&
      Array.isArray((parsed as { updates?: unknown }).updates)
    ) {
      return (parsed as { updates: Array<Partial<AiUpdate>> }).updates;
    }
  }

  return null;
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
  if (n.includes("flash")) score += 8;
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
  return cachedAutoModel ?? DEFAULT_MODEL;
}

function shouldRetryWithAutoModel(status: number, errorText: string) {
  if (status !== 404 && status !== 400) {
    return false;
  }

  const normalized = errorText.toLowerCase();
  return normalized.includes("not found") || normalized.includes("not supported") || normalized.includes("listmodels");
}

async function callGeminiGenerateContent(apiKey: string, model: string, prompt: string) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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

async function runGeminiPrompt(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY. Add it in .env.local (local) and Vercel Project Settings.");
  }

  const explicitModel = process.env.GEMINI_MODEL?.trim();
  const initialModel = explicitModel || DEFAULT_MODEL;

  let response = await callGeminiGenerateContent(apiKey, initialModel, prompt);

  if (!response.ok && !explicitModel) {
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
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
}

export async function generateScopeText(title: string, notes: string): Promise<string> {
  const prompt = [
    "You are an OKR writing assistant.",
    "Write one concise OKR scope sentence.",
    "Do not include bullets, numbering, or JSON.",
    `Title: ${title}`,
    `Notes: ${notes || "(none)"}`
  ].join("\n");

  const text = await runGeminiPrompt(prompt);
  const trimmed = text.trim();
  if (!trimmed) {
    return `Deliver ${title} with clear owner, measurable output, and stakeholder sign-off.`;
  }

  return trimmed.split("\n")[0] ?? trimmed;
}

export async function reconcileWithGemini(okrs: ActiveOKR[], options?: { category?: string }): Promise<AiUpdate[]> {
  const category = options?.category ?? "";

  const prompt = [
    "You are an OKR operations assistant.",
    "Given active OKRs from a single category, return JSON array only.",
    "For each input OKR id, output: id, category, priority(P1-P5), scope, deadline(YYYY-MM-DD).",
    `Allowed broad categories: ${BROAD_CATEGORIES.join(", ")}.`,
    "Rules:",
    "- Use broad categories only.",
    "- If an OKR category is not 'Uncategorized', keep its category unchanged.",
    "- Only if category is 'Uncategorized', assign one broad category.",
    "- Use Title and Notes to estimate urgency/complexity.",
    "- Reprioritize and recalculate deadlines based on inferred urgency/complexity.",
    "- Keep deadlines realistic and not in the past.",
    "- Keep same number of items as input and keep ids unchanged.",
    `Target category scope: ${category || "(none provided)"}`,
    `Input OKRs: ${JSON.stringify(okrs)}`
  ].join("\n");

  const text = await runGeminiPrompt(prompt);

  if (!text.trim()) {
    return okrs.map(fallbackUpdate);
  }

  const parsed = tryParseUpdateArray(text);
  if (!parsed) {
    return okrs.map(fallbackUpdate);
  }

  const byId = new Map(parsed.map((entry) => [entry.id, entry]));

  return okrs.map((okr) => {
    const candidate = byId.get(okr.id);
    if (!candidate) {
      return fallbackUpdate(okr);
    }

    const finalCategory =
      okr.category && okr.category !== UNCAT
        ? okr.category
        : String(candidate.category ?? okr.category ?? UNCAT);

    return {
      id: okr.id,
      category: finalCategory,
      priority: normalizePriority(String(candidate.priority ?? okr.priority ?? "P3")),
      scope: String(candidate.scope ?? okr.scope),
      deadline: String(candidate.deadline ?? okr.deadline)
    } satisfies AiUpdate;
  });
}
