import type { ActiveOKR, CompletedOKR, Priority } from "@/lib/types";

export type OkrRow = {
  id: string;
  user_id: string;
  title: string;
  scope: string;
  deadline: string;
  category: string;
  priority: Priority;
  notes: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  expected_vs_actual_days: number | null;
};

export function rowToActiveOKR(row: OkrRow): ActiveOKR {
  return {
    id: row.id,
    title: row.title,
    scope: row.scope,
    deadline: row.deadline,
    category: row.category,
    priority: row.priority,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function rowToCompletedOKR(row: OkrRow): CompletedOKR {
  return {
    ...rowToActiveOKR(row),
    completedAt: row.completed_at ?? row.updated_at,
    expectedVsActualDays: row.expected_vs_actual_days ?? 0
  };
}
