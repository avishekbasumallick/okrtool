"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ActiveOKR, AiUpdate, AppState, CompletedOKR, Priority } from "@/lib/types";

const STORAGE_KEY = "okr_tool_state_v1";

const EMPTY_STATE: AppState = {
  active: [],
  archived: [],
  pendingAiRefresh: false
};

const PRIORITY_OPTIONS: Priority[] = ["P1", "P2", "P3", "P4", "P5"];

function priorityWeight(priority: Priority) {
  return PRIORITY_OPTIONS.indexOf(priority);
}

function fallbackScope(title: string) {
  return `Deliver ${title} with clear owner, measurable output, and stakeholder sign-off.`;
}

function fallbackDeadline() {
  const due = new Date();
  due.setDate(due.getDate() + 14);
  return due.toISOString().split("T")[0];
}

function calculateExpectedVsActualDays(deadline: string, completedAt: string) {
  const expected = new Date(`${deadline}T00:00:00`);
  const actual = new Date(completedAt);
  const ms = actual.getTime() - expected.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export default function OKRDashboard() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [titleInput, setTitleInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as AppState;
      setState(parsed);
    } catch {
      setState(EMPTY_STATE);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const activeSorted = useMemo(() => {
    return [...state.active].sort((a, b) => {
      const byPriority = priorityWeight(a.priority) - priorityWeight(b.priority);
      if (byPriority !== 0) {
        return byPriority;
      }
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });
  }, [state.active]);

  const onCreateOKR = (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = titleInput.trim();
    if (!cleanTitle) {
      return;
    }

    const now = new Date().toISOString();
    const okr: ActiveOKR = {
      id: crypto.randomUUID(),
      title: cleanTitle,
      notes: notesInput.trim(),
      scope: fallbackScope(cleanTitle),
      deadline: fallbackDeadline(),
      category: "Uncategorized",
      priority: "P3",
      createdAt: now,
      updatedAt: now
    };

    setState((prev) => ({
      ...prev,
      active: [okr, ...prev.active],
      pendingAiRefresh: true
    }));

    setTitleInput("");
    setNotesInput("");
    setErrorMessage(null);
  };

  const onUpdateOKR = (id: string, patch: Partial<ActiveOKR>) => {
    setState((prev) => ({
      ...prev,
      active: prev.active.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              updatedAt: new Date().toISOString()
            }
          : item
      ),
      pendingAiRefresh: true
    }));
  };

  const onDeleteOKR = (okr: ActiveOKR) => {
    const confirmed = window.confirm(`Delete \"${okr.title}\" from active OKRs?`);
    if (!confirmed) {
      return;
    }

    setState((prev) => {
      const nextActive = prev.active.filter((item) => item.id !== okr.id);
      return {
        ...prev,
        active: nextActive,
        pendingAiRefresh: nextActive.length > 0
      };
    });

    if (editingId === okr.id) {
      setEditingId(null);
    }
  };

  const onCompleteOKR = (okr: ActiveOKR) => {
    const confirmed = window.confirm(`Mark \"${okr.title}\" as completed?`);
    if (!confirmed) {
      return;
    }

    const completedAt = new Date().toISOString();
    const archivedItem: CompletedOKR = {
      ...okr,
      completedAt,
      expectedVsActualDays: calculateExpectedVsActualDays(okr.deadline, completedAt)
    };

    setState((prev) => ({
      ...prev,
      active: prev.active.filter((item) => item.id !== okr.id),
      archived: [archivedItem, ...prev.archived],
      pendingAiRefresh: prev.active.length > 1
    }));

    if (editingId === okr.id) {
      setEditingId(null);
    }
  };

  const onRunReconcile = async () => {
    if (!state.active.length) {
      setErrorMessage("No active OKRs available for recategorization.");
      return;
    }

    const confirmed = window.confirm(
      "Run GLM recategorization, reprioritization, and scope/deadline refinement now?"
    );
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);
    setIsReconciling(true);

    try {
      const response = await fetch("/api/ai/reconcile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          okrs: state.active
        })
      });

      const payload = (await response.json()) as { updates?: AiUpdate[]; error?: string };

      if (!response.ok || !payload.updates) {
        throw new Error(payload.error ?? "Failed to run GLM reconcile.");
      }

      const updatesById = new Map(payload.updates.map((update) => [update.id, update]));

      setState((prev) => ({
        ...prev,
        active: prev.active
          .map((okr) => {
            const update = updatesById.get(okr.id);
            if (!update) {
              return okr;
            }
            return {
              ...okr,
              category: update.category,
              priority: update.priority,
              scope: update.scope,
              deadline: update.deadline,
              updatedAt: new Date().toISOString()
            };
          })
          .sort((a, b) => priorityWeight(a.priority) - priorityWeight(b.priority)),
        pendingAiRefresh: false
      }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "GLM reconcile failed.");
    } finally {
      setIsReconciling(false);
    }
  };

  return (
    <main className="page-shell">
      <section className="hero">
        <h1>OKR Tool</h1>
        <p>Create work items, batch your edits, then use GLM (z.ai) to recategorize and reprioritize in one pass.</p>
      </section>

      <section className="card">
        <h2>Create Work Item</h2>
        <form onSubmit={onCreateOKR} className="grid-form">
          <label>
            Work item title
            <input
              required
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              placeholder="Example: Improve activation funnel"
            />
          </label>

          <label>
            Notes (optional)
            <textarea
              value={notesInput}
              onChange={(event) => setNotesInput(event.target.value)}
              placeholder="Any details to guide scope/deadline generation"
            />
          </label>

          <button type="submit">Create OKR</button>
        </form>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Active OKRs</h2>
          <button type="button" onClick={onRunReconcile} disabled={isReconciling}>
            {isReconciling ? "Running GLM..." : "Run Recategorization/Reprioritization"}
          </button>
        </div>

        {state.pendingAiRefresh ? (
          <p className="pending-message">
            You have pending OKR changes. Confirm recategorization/reprioritization when ready to save LLM calls.
          </p>
        ) : null}

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        {!activeSorted.length ? <p className="muted">No active OKRs yet.</p> : null}

        <div className="okr-list">
          {activeSorted.map((okr) => {
            const isEditing = editingId === okr.id;
            return (
              <article className="okr-item" key={okr.id}>
                <div className="okr-top-row">
                  <h3>{okr.title}</h3>
                  <div className="tag-row">
                    <span className="tag">{okr.priority}</span>
                    <span className="tag">{okr.category}</span>
                  </div>
                </div>

                <p className="scope">{okr.scope}</p>
                <p className="meta">
                  Deadline: <strong>{okr.deadline}</strong>
                </p>

                {okr.notes ? <p className="meta">Notes: {okr.notes}</p> : null}

                {isEditing ? (
                  <div className="edit-grid">
                    <label>
                      Scope
                      <textarea
                        value={okr.scope}
                        onChange={(event) => onUpdateOKR(okr.id, { scope: event.target.value })}
                      />
                    </label>

                    <label>
                      Deadline
                      <input
                        type="date"
                        value={okr.deadline}
                        onChange={(event) => onUpdateOKR(okr.id, { deadline: event.target.value })}
                      />
                    </label>

                    <label>
                      Category
                      <input
                        value={okr.category}
                        onChange={(event) => onUpdateOKR(okr.id, { category: event.target.value })}
                      />
                    </label>

                    <label>
                      Priority
                      <select
                        value={okr.priority}
                        onChange={(event) => onUpdateOKR(okr.id, { priority: event.target.value as Priority })}
                      >
                        {PRIORITY_OPTIONS.map((priority) => (
                          <option key={priority} value={priority}>
                            {priority}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}

                <div className="action-row">
                  <button type="button" onClick={() => setEditingId(isEditing ? null : okr.id)}>
                    {isEditing ? "Close Edit" : "Edit"}
                  </button>
                  <button type="button" className="secondary" onClick={() => onCompleteOKR(okr)}>
                    Mark Complete
                  </button>
                  <button type="button" className="danger" onClick={() => onDeleteOKR(okr)}>
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>Archived OKRs</h2>
        {!state.archived.length ? <p className="muted">No archived OKRs yet.</p> : null}

        <div className="archive-list">
          {state.archived.map((okr) => (
            <article className="archive-item" key={okr.id}>
              <h3>{okr.title}</h3>
              <p className="meta">Completed: {new Date(okr.completedAt).toLocaleString()}</p>
              <p className="meta">
                Date variance: {okr.expectedVsActualDays} day(s) {okr.expectedVsActualDays > 0 ? "late" : "early/on-time"}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
