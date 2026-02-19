"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ActiveOKR, AiUpdate, AppState, CompletedOKR, Priority } from "@/lib/types";

const USER_KEY = "okr_tool_user_id_v1";
const PRIORITY_OPTIONS: Priority[] = ["P1", "P2", "P3", "P4", "P5"];

const EMPTY_STATE: AppState = {
  active: [],
  archived: [],
  pendingAiRefresh: false
};

function priorityWeight(priority: Priority) {
  return PRIORITY_OPTIONS.indexOf(priority);
}

function getOrCreateUserId() {
  const existing = window.localStorage.getItem(USER_KEY);
  if (existing) {
    return existing;
  }

  const generated = crypto.randomUUID();
  window.localStorage.setItem(USER_KEY, generated);
  return generated;
}

async function apiFetch<T>(userId: string, input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }

  return payload;
}

export default function OKRDashboard() {
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [titleInput, setTitleInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const loadState = async (resolvedUserId: string) => {
    const payload = await apiFetch<{ active: ActiveOKR[]; archived: CompletedOKR[] }>(resolvedUserId, "/api/okrs", {
      method: "GET"
    });

    setState((prev) => ({
      ...prev,
      active: payload.active,
      archived: payload.archived,
      pendingAiRefresh: false
    }));
  };

  useEffect(() => {
    const initialize = async () => {
      const resolvedUserId = getOrCreateUserId();
      setUserId(resolvedUserId);

      try {
        await loadState(resolvedUserId);
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to load OKRs.");
      } finally {
        setIsLoading(false);
      }
    };

    void initialize();
  }, []);

  const activeSorted = useMemo(() => {
    return [...state.active].sort((a, b) => {
      const byPriority = priorityWeight(a.priority) - priorityWeight(b.priority);
      if (byPriority !== 0) {
        return byPriority;
      }
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    });
  }, [state.active]);

  const onCreateOKR = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = titleInput.trim();
    if (!cleanTitle || !userId) {
      return;
    }

    try {
      const payload = await apiFetch<{ okr: ActiveOKR }>(userId, "/api/okrs", {
        method: "POST",
        body: JSON.stringify({
          title: cleanTitle,
          notes: notesInput.trim()
        })
      });

      setState((prev) => ({
        ...prev,
        active: [payload.okr, ...prev.active],
        pendingAiRefresh: true
      }));

      setTitleInput("");
      setNotesInput("");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create OKR.");
    }
  };

  const onUpdateOKR = async (id: string, patch: Partial<ActiveOKR>) => {
    if (!userId) {
      return;
    }

    const optimisticUpdatedAt = new Date().toISOString();

    setState((prev) => ({
      ...prev,
      active: prev.active.map((item) =>
        item.id === id
          ? {
              ...item,
              ...patch,
              updatedAt: optimisticUpdatedAt
            }
          : item
      ),
      pendingAiRefresh: true
    }));

    try {
      const payload = await apiFetch<{ okr: ActiveOKR }>(userId, `/api/okrs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });

      setState((prev) => ({
        ...prev,
        active: prev.active.map((item) => (item.id === id ? payload.okr : item))
      }));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update OKR.");
      try {
        await loadState(userId);
      } catch {
        // no-op: keep optimistic state and surface existing error
      }
    }
  };

  const onDeleteOKR = async (okr: ActiveOKR) => {
    if (!userId) {
      return;
    }

    const confirmed = window.confirm(`Delete \"${okr.title}\" from active OKRs?`);
    if (!confirmed) {
      return;
    }

    const previous = state;
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

    try {
      await apiFetch<{ id: string }>(userId, `/api/okrs/${okr.id}`, { method: "DELETE" });
      setErrorMessage(null);
    } catch (error) {
      setState(previous);
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete OKR.");
    }
  };

  const onCompleteOKR = async (okr: ActiveOKR) => {
    if (!userId) {
      return;
    }

    const confirmed = window.confirm(`Mark \"${okr.title}\" as completed?`);
    if (!confirmed) {
      return;
    }

    try {
      const payload = await apiFetch<{ okr: CompletedOKR }>(userId, `/api/okrs/${okr.id}/complete`, {
        method: "POST",
        body: JSON.stringify({})
      });

      setState((prev) => ({
        ...prev,
        active: prev.active.filter((item) => item.id !== okr.id),
        archived: [payload.okr, ...prev.archived],
        pendingAiRefresh: prev.active.length > 1
      }));

      if (editingId === okr.id) {
        setEditingId(null);
      }

      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to complete OKR.");
    }
  };

  const onRunReconcile = async () => {
    if (!state.active.length || !userId) {
      setErrorMessage("No active OKRs available for recategorization.");
      return;
    }

    const confirmed = window.confirm(
      "Run Gemini recategorization, reprioritization, and deadline recalculation now?"
    );
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);
    setIsReconciling(true);

    try {
      const payload = await apiFetch<{ updates: AiUpdate[] }>(userId, "/api/okrs/reconcile", {
        method: "POST",
        body: JSON.stringify({})
      });

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
      setErrorMessage(error instanceof Error ? error.message : "Gemini reconcile failed.");
    } finally {
      setIsReconciling(false);
    }
  };

  return (
    <main className="page-shell">
      <section className="hero">
        <h1>OKR Tool</h1>
        <p>Create work items, batch your edits, then use Gemini to recategorize, reprioritize, and recalculate dates.</p>
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

          <button type="submit" disabled={!userId || isLoading}>Create OKR</button>
        </form>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Active OKRs</h2>
          <button type="button" onClick={onRunReconcile} disabled={isReconciling || isLoading || !userId}>
            {isReconciling ? "Running Gemini..." : "Run Recategorization/Reprioritization"}
          </button>
        </div>

        {isLoading ? <p className="muted">Loading OKRs...</p> : null}

        {state.pendingAiRefresh ? (
          <p className="pending-message">
            You have pending OKR changes. Confirm recategorization/reprioritization when ready to save LLM calls.
          </p>
        ) : null}

        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

        {!isLoading && !activeSorted.length ? <p className="muted">No active OKRs yet.</p> : null}

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
                        onChange={(event) => {
                          void onUpdateOKR(okr.id, { scope: event.target.value });
                        }}
                      />
                    </label>

                    <label>
                      Deadline
                      <input
                        type="date"
                        value={okr.deadline}
                        onChange={(event) => {
                          void onUpdateOKR(okr.id, { deadline: event.target.value });
                        }}
                      />
                    </label>

                    <label>
                      Category
                      <input
                        value={okr.category}
                        onChange={(event) => {
                          void onUpdateOKR(okr.id, { category: event.target.value });
                        }}
                      />
                    </label>

                    <label>
                      Priority
                      <select
                        value={okr.priority}
                        onChange={(event) => {
                          void onUpdateOKR(okr.id, { priority: event.target.value as Priority });
                        }}
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
                  <button type="button" className="secondary" onClick={() => void onCompleteOKR(okr)}>
                    Mark Complete
                  </button>
                  <button type="button" className="danger" onClick={() => void onDeleteOKR(okr)}>
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
