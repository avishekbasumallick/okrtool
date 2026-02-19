export type Priority = "P1" | "P2" | "P3" | "P4" | "P5";

export type ActiveOKR = {
  id: string;
  title: string;
  scope: string;
  deadline: string;
  category: string;
  priority: Priority;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type CompletedOKR = ActiveOKR & {
  completedAt: string;
  expectedVsActualDays: number;
};

export type AppState = {
  active: ActiveOKR[];
  archived: CompletedOKR[];
  pendingAiRefresh: boolean;
};

export type AiUpdate = {
  id: string;
  category: string;
  priority: Priority;
  scope: string;
  deadline: string;
};
