"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BROAD_CATEGORIES } from "@/lib/categories";
import type { ActiveOKR, AiUpdate, AppState, CompletedOKR, Priority, ReconcileQuestion } from "@/lib/types";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const PRIORITY_OPTIONS: Priority[] = ["P1", "P2", "P3", "P4", "P5"];
const UNCAT = "Uncategorized";

const EMPTY_STATE: AppState = {
  active: [],
  archived: [],
  pendingAiRefresh: false
};

function priorityWeight(priority: Priority) {
  return PRIORITY_OPTIONS.indexOf(priority);
}

function usernameToEmail(username: string) {
  return `${username.toLowerCase()}@okrtool.local`;
}

function normalizeCategory(value: string | null | undefined) {
  const v = (value ?? "").trim();
  if (!v) return UNCAT;
  return BROAD_CATEGORIES.includes(v as (typeof BROAD_CATEGORIES)[number]) ? v : UNCAT;
}

function uniquePush(items: string[], value: string) {
  const normalized = normalizeCategory(value);
  if (items.includes(normalized)) {
    return items;
  }
  return [...items, normalized];
}

function removeItem(items: string[], value: string) {
  const normalized = normalizeCategory(value);
  return items.filter((item) => item !== normalized);
}

async function apiFetch<T>(accessToken: string, input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
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
  const [pendingCategories, setPendingCategories] = useState<string[]>([]);
  const [selectedPriorityCategory, setSelectedPriorityCategory] = useState<string>(UNCAT);

  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const getSupabase = () => getSupabaseBrowserClient();

  const loadState = async (accessToken: string) => {
    const payload = await apiFetch<{ active: ActiveOKR[]; archived: CompletedOKR[] }>(accessToken, "/api/okrs", {
      method: "GET"
    });

    setState((prev) => ({
      ...prev,
      active: payload.active,
      archived: payload.archived,
      pendingAiRefresh: false
    }));
    setPendingCategories([]);
    setSelectedPriorityCategory(UNCAT);
  };

  useEffect(() => {
    const supabase = getSupabase();

    const initialize = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setErrorMessage(error.message);
      }

      const currentSession = data.session ?? null;
      setSession(currentSession);

      if (currentSession?.access_token) {
        try {
          await loadState(currentSession.access_token);
        } catch (loadError) {
          setErrorMessage(loadError instanceof Error ? loadError.message : "Failed to load OKRs.");
        }
      }

      setIsLoading(false);
    };

    const { data: listener } = supabase.auth.onAuthStateChange((_, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setState(EMPTY_STATE);
        setPendingCategories([]);
        setSelectedPriorityCategory(UNCAT);
      }
    });

    void initialize();

    return () => {
      listener.subscription.unsubscribe();
    };
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

  useEffect(() => {
    if (pendingCategories.length === 0) {
      setSelectedPriorityCategory(UNCAT);
      return;
    }

    if (!pendingCategories.includes(selectedPriorityCategory)) {
      setSelectedPriorityCategory(pendingCategories[0] ?? UNCAT);
    }
  }, [pendingCategories, selectedPriorityCategory]);

  const onAuthenticate = async (event: FormEvent) => {
    event.preventDefault();
    const username = usernameInput.trim();
    const password = passwordInput;

    if (!username || !password) {
      setErrorMessage("Username and password are required.");
      return;
    }

    setAuthBusy(true);
    setErrorMessage(null);

    const supabase = getSupabase();
    const email = usernameToEmail(username);

    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username
            }
          }
        });

        if (error) {
          throw error;
        }

        const ensuredSession = data.session ?? (await supabase.auth.signInWithPassword({ email, password })).data.session;
        if (!ensuredSession) {
          throw new Error("Signup succeeded. Confirm email in Supabase settings or disable email confirmation for immediate login.");
        }

        setSession(ensuredSession);
        await loadState(ensuredSession.access_token);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          throw error;
        }

        if (!data.session) {
          throw new Error("Login failed: no session returned.");
        }

        setSession(data.session);
        await loadState(data.session.access_token);
      }

      setUsernameInput("");
      setPasswordInput("");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setAuthBusy(false);
      setIsLoading(false);
    }
  };

  const onLogout = async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    setSession(null);
    setState(EMPTY_STATE);
    setPendingCategories([]);
    setSelectedPriorityCategory(UNCAT);
  };

  const onCreateOKR = async (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = titleInput.trim();
    const accessToken = session?.access_token;

    if (!cleanTitle || !accessToken) {
      return;
    }

    try {
      const payload = await apiFetch<{ okr: ActiveOKR }>(accessToken, "/api/okrs", {
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
      setPendingCategories((prev) => uniquePush(prev, payload.okr.category));

      setTitleInput("");
      setNotesInput("");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create OKR.");
    }
  };

  const onUpdateOKR = async (id: string, patch: Partial<ActiveOKR>) => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      return;
    }

    const previousItem = state.active.find((item) => item.id === id);
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
      const payload = await apiFetch<{ okr: ActiveOKR }>(accessToken, `/api/okrs/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });

      setState((prev) => ({
        ...prev,
        active: prev.active.map((item) => (item.id === id ? payload.okr : item))
      }));

      setPendingCategories((prev) => {
        let next = prev;
        if (previousItem) {
          next = uniquePush(next, previousItem.category);
        }
        next = uniquePush(next, payload.okr.category);
        return next;
      });

      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update OKR.");
      try {
        await loadState(accessToken);
      } catch {
        // no-op
      }
    }
  };

  const onDeleteOKR = async (okr: ActiveOKR) => {
    const accessToken = session?.access_token;
    if (!accessToken) {
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
        pendingAiRefresh: true
      };
    });

    if (editingId === okr.id) {
      setEditingId(null);
    }

    try {
      await apiFetch<{ id: string }>(accessToken, `/api/okrs/${okr.id}`, { method: "DELETE" });
      setPendingCategories((prev) => uniquePush(prev, okr.category));
      setErrorMessage(null);
    } catch (error) {
      setState(previous);
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete OKR.");
    }
  };

  const onCompleteOKR = async (okr: ActiveOKR) => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      return;
    }

    const confirmed = window.confirm(`Mark \"${okr.title}\" as completed?`);
    if (!confirmed) {
      return;
    }

    try {
      const payload = await apiFetch<{ okr: CompletedOKR }>(accessToken, `/api/okrs/${okr.id}/complete`, {
        method: "POST",
        body: JSON.stringify({})
      });

      setState((prev) => ({
        ...prev,
        active: prev.active.filter((item) => item.id !== okr.id),
        archived: [payload.okr, ...prev.archived],
        pendingAiRefresh: true
      }));

      setPendingCategories((prev) => uniquePush(prev, okr.category));

      if (editingId === okr.id) {
        setEditingId(null);
      }

      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to complete OKR.");
    }
  };

  const onRunPrioritization = async () => {
    const accessToken = session?.access_token;
    if (!accessToken) {
      return;
    }

    if (pendingCategories.length === 0) {
      setErrorMessage("No category has pending changes for prioritization.");
      return;
    }

    const category = normalizeCategory(selectedPriorityCategory);

    if (!pendingCategories.includes(category)) {
      setErrorMessage("Select a pending category before running prioritization.");
      return;
    }

    const confirmed = window.confirm(
      `Run Gemini prioritization and deadline recalculation for category \"${category}\" now?`
    );
    if (!confirmed) {
      return;
    }

    setErrorMessage(null);
    setIsReconciling(true);

    try {
      const questionPayload = await apiFetch<{ questions: ReconcileQuestion[] }>(
        accessToken,
        "/api/okrs/reconcile/questions",
        {
          method: "POST",
          body: JSON.stringify({ category })
        }
      );

      const answers: Record<string, string> = {};
      for (const item of questionPayload.questions) {
        const answer = window.prompt(item.question);
        answers[item.id] = (answer ?? "").trim();
      }

      const payload = await apiFetch<{ updates: AiUpdate[] }>(accessToken, "/api/okrs/reconcile", {
        method: "POST",
        body: JSON.stringify({ category, answers })
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
        pendingAiRefresh: pendingCategories.length > 1
      }));

      setPendingCategories((prev) => removeItem(prev, category));
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Gemini prioritization failed.");
    } finally {
      setIsReconciling(false);
    }
  };

  const isLoggedIn = Boolean(session?.access_token);

  return (
    <main className="page-shell">
      <section className="hero">
        <h1>OKR Tool</h1>
        <p>Create work items, batch your edits, then use Gemini to prioritize and recalculate dates by category.</p>
      </section>

      {!isLoggedIn ? (
        <section className="card">
          <h2>{authMode === "login" ? "Login" : "Sign Up"}</h2>
          <form onSubmit={onAuthenticate} className="grid-form">
            <label>
              Username
              <input
                required
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
                placeholder="Enter username"
              />
            </label>

            <label>
              Password
              <input
                required
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                placeholder="Enter password"
              />
            </label>

            <button type="submit" disabled={authBusy}>
              {authBusy ? "Please wait..." : authMode === "login" ? "Login" : "Sign Up"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setAuthMode(authMode === "login" ? "signup" : "login")}
            >
              Switch to {authMode === "login" ? "Sign Up" : "Login"}
            </button>
          </form>
        </section>
      ) : (
        <section className="card">
          <div className="section-head">
            <h2>Session</h2>
            <button type="button" className="secondary" onClick={() => void onLogout()}>
              Logout
            </button>
          </div>
          <p className="muted">Logged in user: {session?.user?.email ?? "unknown"}</p>
        </section>
      )}

      {isLoggedIn ? (
        <>
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

              <button type="submit" disabled={isLoading}>Create OKR</button>
            </form>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Active OKRs</h2>
              <button type="button" onClick={onRunPrioritization} disabled={isReconciling || isLoading}>
                {isReconciling ? "Running Gemini..." : "Run Prioritization"}
              </button>
            </div>

            {isLoading ? <p className="muted">Loading OKRs...</p> : null}

            {pendingCategories.length > 0 ? (
              <label>
                Category for prioritization
                <select
                  value={selectedPriorityCategory}
                  onChange={(event) => setSelectedPriorityCategory(event.target.value)}
                >
                  {pendingCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {pendingCategories.length > 0 ? (
              <p className="pending-message">Pending categories: {pendingCategories.join(", ")}</p>
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
                          <select
                            value={normalizeCategory(okr.category)}
                            onChange={(event) => {
                              void onUpdateOKR(okr.id, { category: normalizeCategory(event.target.value) });
                            }}
                          >
                            {BROAD_CATEGORIES.map((category) => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </select>
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
        </>
      ) : null}

      {!isLoggedIn && errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </main>
  );
}
