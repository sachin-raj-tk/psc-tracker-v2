/**
 * AppMain.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Main application shell and top-level pages for PSC Tracker.
 * Contains:
 *   - App (default export) — root component, loads all state, renders nav
 *   - Dashboard            — KPIs, score trend, quick stats
 *   - PapersList           — searchable, filterable list of papers
 *   - Analytics            — subject performance, topic map, guess analysis
 *   - StudyTrackerPage     — streak, study log, revision counter tabs
 *   - SyllabiPage          — syllabus management
 *   - SettingsPage         — sync + backup
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  T, inputStyle, btnPrimary, btnGhost, cardStyle,
  pct, scoreColor, fmtDate, todayStr,
  guessAccuracy, matchSearch,
  DB, KEYS, DEFAULT_SYLLABUS,
  Bar, Badge, Section, Modal, ToastContainer, useToast,
  ConfirmDialog,
} from "./AppCore";

import {
  SyllabusEditor,
  PaperForm,
  PaperDetail,
} from "./AppSyllabusPart2";

import { SyllabusImporter } from "./AppSyllabusPart1b";

import {
  useStudyTracker,
  StudyLogPanel,
  RevisionCounter,
  StreakPanel,
  StudyTimer,
  StudyHeatmap,
  QuickLogPanel,
} from "./AppStudy";

import {
  SyncPanel,
  shareOnWhatsApp,
} from "./AppSync";

// ═══════════════════════════════════════════════════════════════════════════════
// EXAM COUNTDOWN TIMERS
// ═══════════════════════════════════════════════════════════════════════════════

const EXAM_TIMERS_KEY = "psc-exam-timers";

/** Load exam timers from localStorage */
function loadExamTimers() {
  try { return JSON.parse(localStorage.getItem(EXAM_TIMERS_KEY) || "[]"); }
  catch { return []; }
}

/** Save exam timers to localStorage */
function saveExamTimers(timers) {
  localStorage.setItem(EXAM_TIMERS_KEY, JSON.stringify(timers));
}

/**
 * Calculate countdown from now to a target datetime string (YYYY-MM-DDTHH:MM).
 * Returns { status, days, hours, minutes } or { status: "past"|"today"|"error" }
 */
function calcCountdown(datetimeStr) {
  try {
    const target = new Date(datetimeStr).getTime();
    const now    = Date.now();
    const diff   = target - now;
    if (isNaN(target)) return { status: "error" };
    if (diff <= 0) {
      const pastDays = Math.floor(Math.abs(diff) / 86400000);
      return pastDays === 0 ? { status: "today" } : { status: "past", days: pastDays };
    }
    const totalSecs = Math.floor(diff / 1000);
    return {
      status:  "future",
      days:    Math.floor(totalSecs / 86400),
      hours:   Math.floor((totalSecs % 86400) / 3600),
      minutes: Math.floor((totalSecs % 3600) / 60),
    };
  } catch { return { status: "error" }; }
}

/**
 * ExamTimers — shows all exam countdown cards + add/edit modal.
 * Prop: compact — if true, renders a smaller strip (for dashboard).
 */
function ExamTimers() {
  const [timers,    setTimers]    = useState(() => loadExamTimers());
  const [tick,      setTick]      = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [editing,   setEditing]   = useState(null); // null or timer object
  const [formName,  setFormName]  = useState("");
  const [formDT,    setFormDT]    = useState("");
  const [formErr,   setFormErr]   = useState("");

  // Tick every minute to refresh countdowns
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const openAdd = () => {
    setEditing(null);
    setFormName("");
    setFormDT("");
    setFormErr("");
    setShowModal(true);
  };

  const openEdit = (timer) => {
    setEditing(timer);
    setFormName(timer.name);
    setFormDT(timer.datetime);
    setFormErr("");
    setShowModal(true);
  };

  const handleSave = () => {
    if (!formName.trim()) { setFormErr("Exam name is required."); return; }
    if (!formDT)          { setFormErr("Exam date and time are required."); return; }
    setFormErr("");
    let updated;
    if (editing) {
      updated = timers.map(t => t.id === editing.id
        ? { ...t, name: formName.trim(), datetime: formDT }
        : t);
    } else {
      updated = [...timers, { id: Math.random().toString(36).slice(2,10), name: formName.trim(), datetime: formDT }];
    }
    saveExamTimers(updated);
    setTimers(updated);
    setShowModal(false);
  };

  const handleDelete = (id) => {
    const updated = timers.filter(t => t.id !== id);
    saveExamTimers(updated);
    setTimers(updated);
  };

  // Status colours and labels
  const getDisplay = (cd) => {
    if (cd.status === "today")  return { color: T.yellow, label: "Exam is Today! 🎯", sub: "" };
    if (cd.status === "past")   return { color: T.text3,  label: "Exam completed",    sub: cd.days + " days ago" };
    if (cd.status === "error")  return { color: T.red,    label: "Invalid date",      sub: "" };
    return {
      color: cd.days < 7 ? T.orange : cd.days < 30 ? T.yellow : T.green,
      label: "",
      sub: "",
    };
  };

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>🗓 Exam Countdowns</span>
        <button onClick={openAdd} style={{ ...btnGhost, fontSize: 11, padding: "4px 12px" }}>
          + Add Exam
        </button>
      </div>

      {/* Empty state */}
      {timers.length === 0 && (
        <div style={{ ...cardStyle, textAlign: "center", padding: "20px 16px", color: T.text3, fontSize: 12 }}>
          No exam dates set yet. Tap "+ Add Exam" to add your first countdown.
        </div>
      )}

      {/* Timer cards */}
      {timers.map(timer => {
        const cd   = calcCountdown(timer.datetime);
        const disp = getDisplay(cd);
        const isPast = cd.status === "past" || cd.status === "today";
        return (
          <div key={timer.id} style={{
            ...cardStyle,
            marginBottom: 8,
            borderLeft: "4px solid " + disp.color,
            opacity: cd.status === "past" ? 0.65 : 1,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                {/* Exam name */}
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                  {timer.name}
                </div>

                {/* Countdown display */}
                {cd.status === "future" ? (
                  <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                    {[
                      { v: cd.days,    u: "days"  },
                      { v: cd.hours,   u: "hrs"   },
                      { v: cd.minutes, u: "min"   },
                    ].map(seg => (
                      <div key={seg.u} style={{ textAlign: "center" }}>
                        <span style={{ fontSize: 28, fontWeight: 900, color: disp.color, fontFamily: "monospace", lineHeight: 1 }}>
                          {seg.v}
                        </span>
                        <span style={{ fontSize: 10, color: T.text3, marginLeft: 3 }}>{seg.u}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 14, fontWeight: 700, color: disp.color }}>
                    {disp.label}
                    {disp.sub ? <span style={{ fontSize: 11, color: T.text3, marginLeft: 8 }}>{disp.sub}</span> : null}
                  </div>
                )}

                {/* Exam datetime */}
                <div style={{ fontSize: 10, color: T.text3, marginTop: 5 }}>
                  {new Date(timer.datetime).toLocaleString("en-IN", {
                    day: "numeric", month: "short", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </div>
              </div>

              {/* Edit / Delete */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 8 }}>
                <button onClick={() => openEdit(timer)}
                  style={{ ...btnGhost, padding: "4px 8px", fontSize: 11 }}>✎</button>
                <button onClick={() => handleDelete(timer.id)}
                  style={{ ...btnGhost, padding: "4px 8px", fontSize: 11, color: T.red, borderColor: T.red + "44" }}>✕</button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal title={editing ? "Edit Exam Timer" : "Add Exam Timer"} onClose={() => setShowModal(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Exam Name *
              </span>
              <input value={formName} onChange={e => setFormName(e.target.value)}
                placeholder="e.g. DLP 2025 Prelims"
                style={inputStyle} maxLength={80} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Exam Date and Time *
              </span>
              <input type="datetime-local" value={formDT}
                onChange={e => setFormDT(e.target.value)}
                style={inputStyle} />
              <span style={{ fontSize: 10, color: T.text3 }}>
                Set the date and start time of the exam
              </span>
            </label>
            {formErr && <div style={{ fontSize: 12, color: T.red }}>{"⚠ " + formErr}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setShowModal(false)} style={btnGhost}>Cancel</button>
              <button onClick={handleSave} style={btnPrimary(T.accent)}>
                {editing ? "Update" : "Add Timer"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Dashboard — KPI cards, score trend bar chart, and latest paper summary.
 */
function Dashboard({ papers, syllabus, streak, logs, onSaveLog, onAddPaper, onNavigate }) {
  if (!papers.length) return (
    <div>
      <div style={{ ...cardStyle, textAlign: "center", padding: 48, marginBottom: 16 }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>📝</div>
        <div style={{ fontSize: 17, color: T.text2, marginBottom: 8 }}>
          No papers yet for {syllabus.shortName}
        </div>
        <div style={{ fontSize: 13, color: T.text3, marginBottom: 20 }}>
          Add your first paper to start tracking
        </div>
        <button onClick={onAddPaper} style={btnPrimary(T.accent)}>+ Add First Paper</button>
      </div>
      {/* Quick check-in */}
      <QuickLogPanel syllabus={syllabus} logs={logs} onSaveLog={onSaveLog} />

      {/* Exam Countdowns */}
      <ExamTimers />

      {/* Quick actions for empty state */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { icon: "📅", label: "Log Today's Study", sub: "Track what you revised", color: T.purple, action: () => onNavigate("study") },
          { icon: "📈", label: "View Analytics",    sub: "See your performance",   color: T.accent, action: () => onNavigate("analytics") },
        ].map(q => (
          <button key={q.label} onClick={q.action} style={{
            ...cardStyle, border: "1px solid " + q.color + "44",
            cursor: "pointer", textAlign: "left", padding: "14px 16px",
            background: q.color + "11",
          }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{q.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 3 }}>{q.label}</div>
            <div style={{ fontSize: 11, color: T.text3 }}>{q.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );

  // Sort by date for trend chart
  const sorted = [...papers].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const scores = sorted.map(p => p.computed?.totalMarks ?? 0);
  const avg    = scores.reduce((a, b) => a + b, 0) / scores.length;
  const best   = Math.max(...scores);
  const maxSc  = Math.max(...scores, 1);
  const latest = [...papers].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  const streakCount = streak?.currentStreak || 0;

  return (
    <div>
      {/* KPI grid — 2x2 on mobile, wraps cleanly */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          { l: "Papers",       v: papers.length,    unit: "",     c: T.accent },
          { l: "Average",      v: avg.toFixed(1),   unit: "/100", c: scoreColor(pct(avg, 100)) },
          { l: "Best Score",   v: best.toFixed(1),  unit: "/100", c: T.green },
          { l: "Study Streak", v: streakCount,      unit: " days", c: streakCount >= 7 ? T.orange : T.text2 },
        ].map(k => (
          <div key={k.l} style={{ ...cardStyle, textAlign: "center", padding: "16px 12px" }}>
            <div style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              {k.l}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: k.c, fontFamily: "monospace" }}>
              {k.v}<span style={{ fontSize: 12, color: T.text3 }}>{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Score trend — only show chart if more than 1 paper */}
      <Section title="📈 Score Trend" accent={T.accent}>
        {scores.length <= 1 ? (
          <div style={{ textAlign: "center", padding: "20px 0", color: T.text3, fontSize: 12 }}>
            Add more papers to see your score trend over time.
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
              {sorted.map((p, i) => {
                const sc  = p.computed?.totalMarks ?? 0;
                const h   = Math.max(6, (sc / maxSc) * 80);
                const col = scoreColor(pct(sc, 100));
                return (
                  <div key={p.id} title={(p.name || p.code) + ": " + sc.toFixed(1)}
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <span style={{ fontSize: 9, color: col, fontFamily: "monospace" }}>{sc.toFixed(0)}</span>
                    <div style={{ width: "100%", height: h, background: col + "88",
                      borderRadius: "3px 3px 0 0", border: "1px solid " + col }} />
                    <span style={{ fontSize: 8, color: T.text3, maxWidth: 36,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name || p.code || ("P" + (i + 1))}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 8 }}>
              {"Delta from first: "}
              <strong style={{ color: scores[scores.length-1] >= scores[0] ? T.green : T.red }}>
                {scores[scores.length-1] >= scores[0] ? "+" : ""}
                {(scores[scores.length-1] - scores[0]).toFixed(1)}
              </strong>
            </div>
          </div>
        )}
      </Section>

      {/* Latest paper */}
      {latest?.computed && (
        <Section title="🗒 Latest Paper" accent={T.teal}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, color: T.text }}>{latest.name}</div>
              {latest.date && <div style={{ fontSize: 12, color: T.text3 }}>{fmtDate(latest.date)}</div>}
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, fontFamily: "monospace",
              color: scoreColor(pct(latest.computed.totalMarks, 100)) }}>
              {latest.computed.totalMarks.toFixed(2)}
              <span style={{ fontSize: 12, color: T.text3 }}>/100</span>
            </div>
            <div style={{ fontSize: 12, color: T.text2 }}>
              {"✓ " + latest.computed.totalCorrect + "  ✗ " + latest.computed.totalWrong}
            </div>
          </div>
        </Section>
      )}

      {/* Quick check-in */}
      <QuickLogPanel syllabus={syllabus} logs={logs} onSaveLog={onSaveLog} />

      {/* Exam Countdowns */}
      <ExamTimers />

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
        {[
          { icon: "📅", label: "Log Study",   sub: "Record today's revision", color: T.purple, action: () => onNavigate("study")     },
          { icon: "📈", label: "Analytics",   sub: "View performance trends",  color: T.accent, action: () => onNavigate("analytics") },
        ].map(q => (
          <button key={q.label} onClick={q.action} style={{
            ...cardStyle, border: "1px solid " + q.color + "44",
            cursor: "pointer", textAlign: "left", padding: "14px 16px",
            background: q.color + "11",
          }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{q.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>{q.label}</div>
            <div style={{ fontSize: 11, color: T.text3 }}>{q.sub}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAPERS LIST
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PapersList — searchable, sortable, filterable table of all papers.
 */
function PapersList({ papers, syllabus, streak, onAdd, onEdit, onDelete, onView }) {
  const [search,   setSearch]   = useState("");
  const [sortBy,   setSortBy]   = useState("date_desc");
  const [scoreMin, setScoreMin] = useState("");
  const [scoreMax, setScoreMax] = useState("");
  const [toDelete, setToDelete] = useState(null);

  const filtered = papers.filter(p => {
    if (search && !matchSearch([p.name, p.code, p.notes].join(" "), search)) return false;
    const sc = p.computed?.totalMarks ?? 0;
    if (scoreMin !== "" && sc < parseFloat(scoreMin)) return false;
    if (scoreMax !== "" && sc > parseFloat(scoreMax)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const sa = a.computed?.totalMarks ?? 0;
    const sb = b.computed?.totalMarks ?? 0;
    if (sortBy === "score_asc")  return sa - sb;
    if (sortBy === "score_desc") return sb - sa;
    if (sortBy === "date_asc")   return (a.date || "").localeCompare(b.date || "");
    if (sortBy === "date_desc")  return (b.date || "").localeCompare(a.date || "");
    if (sortBy === "name")       return (a.name || "").localeCompare(b.name || "");
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={onAdd} style={btnPrimary(T.accent)}>+ Add Paper</button>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or code..."
          style={{ ...inputStyle, maxWidth: 220, fontSize: 12 }} />
        <input type="number" value={scoreMin} onChange={e => setScoreMin(e.target.value)}
          placeholder="Min score" style={{ ...inputStyle, width: 90, fontSize: 12 }} />
        <input type="number" value={scoreMax} onChange={e => setScoreMax(e.target.value)}
          placeholder="Max score" style={{ ...inputStyle, width: 90, fontSize: 12 }} />
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ ...inputStyle, width: "auto", fontSize: 12, padding: "5px 8px" }}>
          <option value="date_desc">Newest First</option>
          <option value="date_asc">Oldest First</option>
          <option value="score_desc">Highest Score</option>
          <option value="score_asc">Lowest Score</option>
          <option value="name">Name A–Z</option>
        </select>
        {(search || scoreMin !== "" || scoreMax !== "") && (
          <button onClick={() => { setSearch(""); setScoreMin(""); setScoreMax(""); }}
            style={btnGhost}>Clear</button>
        )}
        <span style={{ fontSize: 11, color: T.text3, marginLeft: "auto" }}>
          {sorted.length}/{papers.length} paper{papers.length !== 1 ? "s" : ""}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: 40, color: T.text3 }}>
          {papers.length === 0 ? "No papers yet." : "No papers match your filters."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map(p => {
            const sc  = p.computed?.totalMarks ?? 0;
            const sp  = pct(sc, 100);
            const c   = p.computed;
            const hasContent = p.content?.text || p.content?.docxExtracted || p.content?.pdfData;
            return (
              <div key={p.id} style={{ ...cardStyle, padding: "12px 14px" }}>

                {/* ── Row 1: Name + Score ── */}
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                  {/* Left: name */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: T.text, fontSize: 14,
                      lineHeight: 1.3, marginBottom: 3 }}>
                      {p.name || "Unnamed Paper"}
                    </div>
                    {/* Meta row: code · date */}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap",
                      alignItems: "center" }}>
                      {p.code && (
                        <span style={{ fontSize: 11, color: T.text3,
                          fontFamily: "monospace" }}>{p.code}</span>
                      )}
                      {p.date && (
                        <span style={{ fontSize: 11, color: T.text3 }}>
                          {fmtDate(p.date)}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Right: score */}
                  {c && (
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontFamily: "monospace", fontSize: 26,
                        fontWeight: 900, color: scoreColor(sp), lineHeight: 1 }}>
                        {sc.toFixed(1)}
                      </div>
                      <div style={{ fontSize: 10, color: T.text3 }}>/100</div>
                    </div>
                  )}
                </div>

                {/* ── Row 2: Badges ── */}
                {(p.bookletCode || p.answerKey || hasContent) && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap",
                    marginBottom: 6 }}>
                    {p.bookletCode && (
                      <Badge label={"Booklet " + p.bookletCode} color={T.accent} />
                    )}
                    {p.answerKey && <Badge label="Key ✓" color={T.green} />}
                    {hasContent  && <Badge label="📄 Content" color={T.purple} />}
                  </div>
                )}

                {/* ── Row 3: Stats ── */}
                {c && (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap",
                    fontSize: 11, color: T.text3, marginBottom: 8 }}>
                    <span style={{ color: T.green }}>{"✓ " + c.totalCorrect}</span>
                    <span style={{ color: T.red }}>{"✗ " + c.totalWrong}</span>
                    {c.totalDeleted > 0 && (
                      <span>{"⊘ " + c.totalDeleted}</span>
                    )}
                    <span>{"−" + c.totalPenalty.toFixed(2) + " penalty"}</span>
                  </div>
                )}

                {/* ── Row 4: Action buttons — single row, never wraps ── */}
                <div style={{ display: "flex", gap: 6,
                  borderTop: "1px solid " + T.border, paddingTop: 8 }}>
                  <button onClick={() => onView(p)}
                    style={{ ...btnGhost, fontSize: 12, flex: 1 }}>
                    View
                  </button>
                  <button onClick={() => onEdit(p)}
                    style={{ ...btnGhost, fontSize: 12, flex: 1 }}>
                    Edit
                  </button>
                  <button
                    onClick={() => shareOnWhatsApp(p, syllabus, streak?.currentStreak)}
                    style={{ ...btnGhost, fontSize: 12, padding: "6px 10px" }}>
                    📤
                  </button>
                  <button onClick={() => setToDelete(p)}
                    style={{ ...btnGhost, fontSize: 12, padding: "6px 10px",
                      color: T.red, borderColor: T.red + "44" }}>
                    Del
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {toDelete && (
        <ConfirmDialog
          message={`Delete "${toDelete.name || "this paper"}"?`}
          detail="This cannot be undone."
          confirmLabel="Delete" danger
          onConfirm={() => { onDelete(toDelete.id); setToDelete(null); }}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Analytics — full analytics view.
 * Subject averages, weak/strong split, guess strategy,
 * topic performance map, revision vs score correlation.
 */
function Analytics({ papers: _papers, syllabus: _syllabus, cutoff, onSetCutoff, allSyllabi, allPapers }) {
  const [dateFrom,    setDateFrom]    = useState("");
  const [dateTo,      setDateTo]      = useState("");
  const [editCutoff,  setEditCutoff]  = useState(false);
  const [cutoffInput, setCutoffInput] = useState(cutoff || "");
  const [analyticsSylId, setAnalyticsSylId] = useState(_syllabus.id);
  const [expandModal, setExpandModal] = useState(null);
  const [selectedPaperId, setSelectedPaperId] = useState(null); // null = all papers
  const [paperSearch,     setPaperSearch]     = useState("");
  const [dropdownOpen,    setDropdownOpen]    = useState(false);

  // Allow switching syllabus inside analytics without leaving the page
  const analyticsSyl = allSyllabi.find(s => s.id === analyticsSylId) || _syllabus;
  const analyticsFilteredPapers = allPapers.filter(p => p.syllabusId === analyticsSylId);
  // Override the passed-in props with the locally selected syllabus
  const papers   = analyticsFilteredPapers;
  // eslint-disable-next-line no-shadow
  const syllabus = analyticsSyl;

  const filtered = papers.filter(p => {
    if (dateFrom && p.date && p.date < dateFrom) return false;
    if (dateTo   && p.date && p.date > dateTo)   return false;
    return true;
  });

  if (!filtered.length) return (
    <div style={{ ...cardStyle, textAlign: "center", padding: 50, color: T.text3 }}>
      No papers match the selected filters.
    </div>
  );

  const neg = syllabus.negMark || 1 / 3;

  // ── 1. Subject averages with total question count ─────────────────────────
  const subjAvg = syllabus.subjects.map(s => {
    const vals = filtered.map(p => p.computed?.bySubject?.[s.id]?.marks || 0);
    const avg  = vals.reduce((a, b) => a + b, 0) / vals.length;
    // totalQ = all correct + wrong attempts (not deleted/unattempted) across papers
    const totalQ = filtered.reduce((acc, p) => {
      const bs = p.computed?.bySubject?.[s.id] || {};
      return acc + (bs.correct || 0) + (bs.wrong || 0);
    }, 0);
    return { ...s, avg, avgPct: pct(avg, s.maxMarks), totalQ };
  });

  // ── 2. Topic performance from OMR tags ────────────────────────────────────
  const topicStats = {};
  for (const paper of filtered) {
    for (const [tid, stats] of Object.entries(paper.computed?.byTopic || {})) {
      if (!topicStats[tid]) topicStats[tid] = { correct: 0, wrong: 0, total: 0 };
      topicStats[tid].correct += stats.correct || 0;
      topicStats[tid].wrong   += stats.wrong   || 0;
      topicStats[tid].total   += stats.total   || 0;
    }
  }

  // ── 3. Weak/Strong topics (min 1 question, sorted by accuracy) ────────────
  const topicList = syllabus.subjects.flatMap(s =>
    s.topics
      .filter(t => topicStats[t.id] && topicStats[t.id].total > 0)
      .map(t => {
        const ts  = topicStats[t.id];
        const acc = Math.round((ts.correct / ts.total) * 100);
        return { ...t, subjName: s.name, correct: ts.correct, total: ts.total, acc };
      })
  );

  // ── 4. Merged guesswork — prefer OMR bySubject data, fall back to manual ──
  // OMR data stored per-subject after Calculate is clicked
  let ffC_omr = 0, ffW_omr = 0, wgC_omr = 0, wgW_omr = 0;
  for (const p of filtered) {
    for (const bs of Object.values(p.computed?.bySubject || {})) {
      ffC_omr += bs.ffCorrect  || 0;
      ffW_omr += bs.ffWrong    || 0;
      wgC_omr += bs.wildCorrect || 0;
      wgW_omr += bs.wildWrong  || 0;
    }
  }
  // Manual tab data (fallback when OMR guess tagging was not used)
  let ffC_man = 0, ffW_man = 0, wgC_man = 0, wgW_man = 0;
  for (const p of filtered) {
    const g = p.guesses || {};
    ffC_man += parseInt(g.ff_correct) || 0;
    ffW_man += parseInt(g.ff_wrong)   || 0;
    wgC_man += parseInt(g.wg_correct) || 0;
    wgW_man += parseInt(g.wg_wrong)   || 0;
  }
  // Use OMR data if any guesses were tagged in OMR; else use manual
  const hasOMRGuess = (ffC_omr + ffW_omr + wgC_omr + wgW_omr) > 0;
  const ffC = hasOMRGuess ? ffC_omr : ffC_man;
  const ffW = hasOMRGuess ? ffW_omr : ffW_man;
  const wgC = hasOMRGuess ? wgC_omr : wgC_man;
  const wgW = hasOMRGuess ? wgW_omr : wgW_man;

  const breakeven = Math.round(1 / (1 + neg) * 100);
  const ffNet     = ffC - ffW * neg;
  const wgNet     = wgC - wgW * neg;

  // Subject-wise guess breakdown (from OMR data)
  const subjGuess = syllabus.subjects.map(s => {
    let fc = 0, fw = 0, wc = 0, ww = 0;
    for (const p of filtered) {
      const bs = p.computed?.bySubject?.[s.id] || {};
      fc += bs.ffCorrect   || 0;
      fw += bs.ffWrong     || 0;
      wc += bs.wildCorrect || 0;
      ww += bs.wildWrong   || 0;
    }
    return { ...s, fc, fw, wc, ww, total: fc + fw + wc + ww,
      ffNet: fc - fw * neg, wgNet: wc - ww * neg };
  }).filter(s => s.total > 0);

  // ── 5. Score consistency (population std deviation) ───────────────────────
  const scores   = filtered.map(p => p.computed?.totalMarks ?? 0);
  const scoreAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const stdDev   = scores.length > 1
    ? Math.sqrt(scores.reduce((a, x) => a + Math.pow(x - scoreAvg, 2), 0) / scores.length)
    : 0;
  const consistLabel =
    stdDev < 5  ? "Very Consistent" :
    stdDev < 10 ? "Consistent"      :
    stdDev < 15 ? "Variable"        : "Inconsistent";
  const consistColor =
    stdDev < 5  ? T.green  :
    stdDev < 10 ? T.yellow :
    stdDev < 15 ? T.orange : T.red;

  // ── 6. Improvement rate (first half vs second half by date) ───────────────
  const byDate     = [...filtered].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const mid        = Math.ceil(byDate.length / 2);
  const firstHalf  = byDate.slice(0, mid);
  const secondHalf = byDate.slice(mid);
  const avgFirst   = firstHalf.length
    ? firstHalf.reduce((a, p) => a + (p.computed?.totalMarks ?? 0), 0) / firstHalf.length
    : 0;
  const avgSecond  = secondHalf.length
    ? secondHalf.reduce((a, p) => a + (p.computed?.totalMarks ?? 0), 0) / secondHalf.length
    : 0;
  const improvDelta = avgSecond - avgFirst;
  const canShowImprovement = secondHalf.length > 0;

  // ── 7. Unattempted by subject ─────────────────────────────────────────────
  const unattempted = syllabus.subjects.map(s => {
    const avgUn = filtered.reduce((acc, p) => {
      const bs = p.computed?.bySubject?.[s.id] || {};
      const un = Math.max(0,
        s.maxMarks - (bs.correct || 0) - (bs.wrong || 0) - (bs.deleted || 0)
      );
      return acc + un;
    }, 0) / filtered.length;
    return { ...s, avgUn };
  }).filter(s => s.avgUn >= 0.5); // only show subjects with meaningful unattempted avg

  // ── 8. Subject contribution to total score ────────────────────────────────
  const totalScoreAvg = subjAvg.reduce((a, s) => a + s.avg, 0);
  const subjContrib   = [...subjAvg]
    .sort((a, b) => b.avg - a.avg)
    .map(s => ({
      ...s,
      contrib: totalScoreAvg > 0 ? Math.round((s.avg / totalScoreAvg) * 100) : 0,
    }));

  // ── 9. Revision vs score correlation ──────────────────────────────────────
  const corrData = syllabus.subjects.flatMap(s =>
    s.topics
      .filter(t => (t.revisionCount || 0) > 0 && topicStats[t.id]?.total > 0)
      .map(t => ({
        name:      t.name,
        revisions: t.revisionCount,
        accuracy:  Math.round(topicStats[t.id].correct / topicStats[t.id].total * 100),
      }))
  );

  // ── Helpers ───────────────────────────────────────────────────────────────
  // Net verdict badge — based on actual net marks, not accuracy
  const verdictBadge = (net, c, w) => {
    if (c + w === 0) return null;
    const label = net >= 0
      ? "✓ +" + net.toFixed(2) + " marks"
      : "✗ " + net.toFixed(2) + " marks";
    return <Badge label={label} color={net >= 0 ? T.green : T.red} />;
  };

  return (
    <div>
      {/* ── Syllabus switcher ── */}
      {allSyllabi.length > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: T.text3 }}>Showing:</span>
          {allSyllabi.map(s => (
            <button key={s.id} onClick={() => setAnalyticsSylId(s.id)}
              style={{
                ...btnGhost, fontSize: 12, padding: "5px 12px",
                background: analyticsSylId === s.id ? T.accent + "33" : "transparent",
                color:      analyticsSylId === s.id ? T.accent2 : T.text2,
                borderColor:analyticsSylId === s.id ? T.accent   : T.border2,
              }}>
              {s.shortName}
            </button>
          ))}
        </div>
      )}
      {allSyllabi.length <= 1 && (
        <div style={{ fontSize: 11, color: T.text3, marginBottom: 12 }}>
          {"Showing analytics for: " + syllabus.shortName}
        </div>
      )}

      {/* ── Paper switcher — searchable dropdown ── */}
      {(() => {
        const sorted = [...papers].sort((a,b) => (b.date||"").localeCompare(a.date||""));
        const lower  = paperSearch.toLowerCase();
        const filteredPs = sorted.filter(p =>
          !lower ||
          (p.name||"").toLowerCase().includes(lower) ||
          (p.code||"").toLowerCase().includes(lower) ||
          (p.date||"").includes(lower)
        );
        const selectedPaper = papers.find(p => p.id === selectedPaperId);

        // Display value in the input box
        const inputVal = dropdownOpen
          ? paperSearch
          : selectedPaperId === null
            ? "All Papers — Aggregate View"
            : (selectedPaper?.name || selectedPaper?.code || "Paper");

        return (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 6 }}>
              View analytics for:
            </div>
            {/* Click-outside overlay to close dropdown */}
            {dropdownOpen && (
              <div style={{ position: "fixed", inset: 0, zIndex: 199 }}
                onClick={() => { setDropdownOpen(false); setPaperSearch(""); }} />
            )}
            <div style={{ position: "relative", maxWidth: 360 }}>
              {/* Input */}
              <input
                value={inputVal}
                readOnly={!dropdownOpen}
                onChange={e => setPaperSearch(e.target.value)}
                onClick={() => {
                  setDropdownOpen(true);
                  setPaperSearch("");
                }}
                placeholder="Select a paper..."
                style={{ ...inputStyle, width: "100%", paddingRight: 32,
                  fontSize: 13, cursor: dropdownOpen ? "text" : "pointer" }}
              />
              {/* Chevron / clear */}
              {selectedPaperId !== null && !dropdownOpen ? (
                <button
                  onClick={e => { e.stopPropagation();
                    setSelectedPaperId(null); setPaperSearch(""); setDropdownOpen(false); }}
                  style={{ position: "absolute", right: 8, top: "50%",
                    transform: "translateY(-50%)", background: "none", border: "none",
                    color: T.text3, cursor: "pointer", fontSize: 14, padding: 0 }}>
                  ✕
                </button>
              ) : (
                <span style={{ position: "absolute", right: 10, top: "50%",
                  transform: "translateY(-50%)", color: T.text3, fontSize: 10,
                  pointerEvents: "none" }}>{dropdownOpen ? "▲" : "▼"}</span>
              )}

              {/* Dropdown list */}
              {dropdownOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                  background: "#0d1117", border: "1px solid " + T.border,
                  borderRadius: 8, zIndex: 200, maxHeight: 260, overflowY: "auto",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                }}>
                  {/* All Papers option */}
                  <div
                    onClick={() => {
                      setSelectedPaperId(null);
                      setPaperSearch("");
                      setDropdownOpen(false);
                    }}
                    style={{
                      padding: "10px 14px", cursor: "pointer",
                      fontSize: 13, color: T.accent2, fontWeight: 700,
                      borderBottom: "1px solid " + T.border,
                      background: T.accent + "15",
                    }}>
                    📊 All Papers — Aggregate View
                  </div>
                  {filteredPs.length === 0 ? (
                    <div style={{ padding: "12px 14px", fontSize: 12, color: T.text3 }}>
                      No papers match your search
                    </div>
                  ) : (
                    filteredPs.map(p => {
                      const sc = p.computed?.totalMarks ?? null;
                      return (
                        <div key={p.id}
                          onClick={() => {
                            setSelectedPaperId(p.id);
                            setPaperSearch("");
                            setDropdownOpen(false);
                          }}
                          style={{
                            padding: "10px 14px", cursor: "pointer",
                            borderBottom: "1px solid " + T.border + "66",
                            display: "flex", justifyContent: "space-between",
                            alignItems: "center", gap: 10,
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = T.surface}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: T.text, fontWeight: 600,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {p.name || p.code || "Paper"}
                            </div>
                            {p.date && (
                              <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
                                {fmtDate(p.date)}
                                {p.code && " · " + p.code}
                              </div>
                            )}
                          </div>
                          {sc !== null && (
                            <span style={{ fontFamily: "monospace", fontSize: 13,
                              fontWeight: 800, color: scoreColor(pct(sc, 100)),
                              flexShrink: 0 }}>
                              {sc.toFixed(1)}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Selected paper label */}
            {selectedPaperId !== null && selectedPaper && !dropdownOpen && (
              <div style={{ marginTop: 8, fontSize: 11, color: T.purple }}>
                {"Showing: " + (selectedPaper.name || selectedPaper.code || "Paper")}
                {selectedPaper.date && " · " + fmtDate(selectedPaper.date)}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Date filter + cutoff ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          placeholder="From date"
          style={{ ...inputStyle, width: 150, fontSize: 12 }} />
        <span style={{ color: T.text3 }}>–</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          placeholder="To date"
          style={{ ...inputStyle, width: 150, fontSize: 12 }} />
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); }} style={btnGhost}>Clear</button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {cutoff && <span style={{ fontSize: 12, color: T.yellow }}>Cutoff: {cutoff}</span>}
          <button onClick={() => setEditCutoff(true)} style={btnGhost}>
            {cutoff ? "Edit Cutoff" : "Set Cutoff"}
          </button>
        </div>
      </div>

      {editCutoff && (
        <Modal title="Set Cutoff Score" onClose={() => setEditCutoff(false)}>
          <label style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: T.text2 }}>
              Enter the known PSC cutoff for this exam (e.g. 65).
            </span>
            <input type="number" min={0} max={100} value={cutoffInput}
              onChange={e => setCutoffInput(e.target.value)}
              style={{ ...inputStyle, maxWidth: 120 }} />
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setEditCutoff(false)} style={btnGhost}>Cancel</button>
            <button onClick={() => { onSetCutoff(parseFloat(cutoffInput) || null); setEditCutoff(false); }}
              style={btnPrimary(T.accent)}>Save</button>
          </div>
        </Modal>
      )}

      {/* ── SINGLE PAPER VIEW ── shown when a specific paper is selected */}
      {selectedPaperId && (() => {
        const sp = papers.find(p => p.id === selectedPaperId);
        if (!sp) return null;
        const sc  = sp.computed?.totalMarks ?? 0;
        const neg = syllabus.negMark || 1/3;
        const pq  = sp.computed?.perQuestion || {};

        // Classify questions
        const ngWrong  = Object.keys(pq).filter(q => pq[q].result==="wrong"  && !pq[q].isGuess).map(Number).sort((a,b)=>a-b);
        const gWrong   = Object.keys(pq).filter(q => pq[q].result==="wrong"  &&  pq[q].isGuess).map(Number).sort((a,b)=>a-b);
        const ngCorrect= Object.keys(pq).filter(q => pq[q].result==="correct"&& !pq[q].isGuess).length;
        const gCorrect = Object.keys(pq).filter(q => pq[q].result==="correct"&&  pq[q].isGuess).length;

        // Guess totals from bySubject
        let ffC=0,ffW=0,wgC=0,wgW=0;
        for (const bs of Object.values(sp.computed?.bySubject||{})) {
          ffC+=bs.ffCorrect||0; ffW+=bs.ffWrong||0;
          wgC+=bs.wildCorrect||0; wgW+=bs.wildWrong||0;
        }
        const ffNet = ffC - ffW*neg;
        const wgNet = wgC - wgW*neg;

        const QBadges = ({qs, color}) => qs.length===0 ? (
          <span style={{fontSize:11,color:T.text3}}>None</span>
        ) : (
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
            {qs.map(q=>(
              <span key={q} style={{
                fontSize:11,fontFamily:"monospace",fontWeight:700,
                color,background:color+"18",
                border:"1px solid "+color+"44",
                borderRadius:4,padding:"2px 6px",
              }}>{"Q"+q}</span>
            ))}
          </div>
        );

        return (
          <div>
            {/* Paper header */}
            <div style={{...cardStyle, marginBottom:16, borderLeft:"4px solid "+T.purple}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10}}>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:4}}>
                    {sp.name || sp.code || "Paper"}
                  </div>
                  {sp.date && <div style={{fontSize:12,color:T.text3}}>{fmtDate(sp.date)}</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:30,fontWeight:900,fontFamily:"monospace",color:scoreColor(pct(sc,100)),lineHeight:1}}>
                    {sc.toFixed(2)}
                  </div>
                  <div style={{fontSize:11,color:T.text3}}>/100</div>
                </div>
              </div>
              {sp.computed && (
                <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap",fontSize:12}}>
                  <span style={{color:T.green}}>{"✓ "+sp.computed.totalCorrect+" correct"}</span>
                  <span style={{color:T.red}}>{"✗ "+sp.computed.totalWrong+" wrong"}</span>
                  <span style={{color:T.text3}}>{"⊘ "+sp.computed.totalDeleted+" deleted"}</span>
                  <span style={{color:T.text3}}>{"— "+sp.computed.totalUnattempted+" unattempted"}</span>
                </div>
              )}
            </div>

            {/* Subject breakdown */}
            {sp.computed && (
              <Section title="📊 Subject Scores" accent={T.purple}>
                <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:500}}>
                    <thead>
                      <tr>
                        {["Subject","Max","✓","✗","Marks","%"].map(h=>(
                          <th key={h} style={{padding:"6px 8px",color:T.text3,fontSize:10,
                            textAlign:h==="Subject"?"left":"center",
                            borderBottom:"1px solid "+T.border,
                            textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {syllabus.subjects.map(s=>{
                        const sc2=sp.computed.bySubject[s.id]||{};
                        const sp2=pct(sc2.marks||0,s.maxMarks);
                        return (
                          <tr key={s.id} style={{borderBottom:"1px solid "+T.border}}>
                            <td style={{padding:"7px 8px",color:T.text,fontSize:12}}>{s.name}</td>
                            <td style={{padding:"7px 8px",textAlign:"center",color:T.text3,fontFamily:"monospace"}}>{s.maxMarks}</td>
                            <td style={{padding:"7px 8px",textAlign:"center",color:T.green,fontFamily:"monospace"}}>{sc2.correct||0}</td>
                            <td style={{padding:"7px 8px",textAlign:"center",color:T.red,fontFamily:"monospace"}}>{sc2.wrong||0}</td>
                            <td style={{padding:"7px 8px",textAlign:"center",color:scoreColor(sp2),fontFamily:"monospace",fontWeight:700}}>{(sc2.marks||0).toFixed(1)}</td>
                            <td style={{padding:"7px 8px",textAlign:"center"}}><Badge label={sp2+"%"} color={scoreColor(sp2)}/></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}

            {/* Guess + Non-Guess breakdown with Q numbers */}
            <Section title="🎯 Answer Breakdown" accent={T.cyan}>
              {Object.keys(pq).length === 0 ? (
                <div style={{fontSize:12,color:T.text3,lineHeight:1.7}}>
                  Per-question data not available. Edit this paper → OMR tab → Calculate Score.
                </div>
              ) : (
                <div>
                  {/* Summary cards */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                    <div style={{padding:"12px 14px",borderRadius:8,background:T.surface,border:"1px solid "+T.border}}>
                      <div style={{fontSize:11,fontWeight:700,color:T.text3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>
                        Without Guessing
                      </div>
                      <div style={{display:"flex",gap:16}}>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:900,color:T.green,fontFamily:"monospace"}}>{ngCorrect}</div>
                          <div style={{fontSize:10,color:T.text3}}>Correct</div>
                        </div>
                        <div style={{textAlign:"center"}}>
                          <div style={{fontSize:22,fontWeight:900,color:T.red,fontFamily:"monospace"}}>{ngWrong.length}</div>
                          <div style={{fontSize:10,color:T.text3}}>Wrong</div>
                        </div>
                      </div>
                    </div>
                    <div style={{padding:"12px 14px",borderRadius:8,background:T.surface,border:"1px solid "+T.border,opacity:ffC+ffW+wgC+wgW>0?1:0.45}}>
                      <div style={{fontSize:11,fontWeight:700,color:T.text3,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>
                        By Guessing
                      </div>
                      {ffC+ffW+wgC+wgW>0?(
                        <div style={{display:"flex",gap:16}}>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:22,fontWeight:900,color:T.cyan,fontFamily:"monospace"}}>{gCorrect}</div>
                            <div style={{fontSize:10,color:T.text3}}>Correct</div>
                          </div>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:22,fontWeight:900,color:T.orange,fontFamily:"monospace"}}>{gWrong.length}</div>
                            <div style={{fontSize:10,color:T.text3}}>Wrong</div>
                          </div>
                        </div>
                      ):(
                        <div style={{fontSize:11,color:T.text3}}>No guesses tagged in OMR</div>
                      )}
                    </div>
                  </div>

                  {/* Guesswork stats */}
                  {(ffC+ffW+wgC+wgW)>0 && (
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                      {[
                        {label:"🎯 50:50",c:ffC,w:ffW,net:ffNet,col:T.cyan},
                        {label:"🎲 Wild", c:wgC,w:wgW,net:wgNet,col:T.orange},
                      ].map(row=>(
                        <div key={row.label} style={{padding:"10px 12px",borderRadius:8,
                          border:"1px solid "+row.col+"44",background:row.col+"08"}}>
                          <div style={{fontSize:11,fontWeight:700,color:row.col,marginBottom:6}}>{row.label}</div>
                          <div style={{fontSize:12,color:T.text2}}>
                            {row.c+"✓ "+row.w+"✗"}
                          </div>
                          <div style={{fontSize:11,color:row.net>=0?T.green:T.red,fontWeight:700,marginTop:3}}>
                            {"Net: "+(row.net>=0?"+":"")+row.net.toFixed(2)+" marks"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Wrong question numbers */}
                  <div style={{borderTop:"1px solid "+T.border,paddingTop:12}}>
                    <div style={{fontSize:12,fontWeight:700,color:T.text,marginBottom:10}}>
                      Wrong Question Numbers
                    </div>
                    <div style={{marginBottom:10}}>
                      <div style={{fontSize:11,color:T.text3,marginBottom:4}}>
                        {"Without guessing — "+ngWrong.length+" wrong"}
                      </div>
                      <QBadges qs={ngWrong} color={T.red} />
                    </div>
                    {(ffC+ffW+wgC+wgW)>0 && (
                      <div>
                        <div style={{fontSize:11,color:T.text3,marginBottom:4}}>
                          {"By guessing — "+gWrong.length+" wrong"}
                        </div>
                        <QBadges qs={gWrong} color={T.orange} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Section>
          </div>
        );
      })()}

      {/* ── Show aggregate sections only when no specific paper is selected ── */}
      {!selectedPaperId && (
      <div>

      {/* ── Score Trend ── */}
      <Section title="📈 Score Trend" accent={T.accent}>
        <div style={{ position: "relative" }}>
          {cutoff && (
            <div style={{
              position: "absolute", left: 0, right: 0,
              bottom: (cutoff / 100 * 80 + 16) + "px",
              borderTop: "2px dashed " + T.yellow, zIndex: 1,
            }}>
              <span style={{ position: "absolute", right: 0, top: -16, fontSize: 10, color: T.yellow }}>
                Cutoff {cutoff}
              </span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 100, position: "relative" }}>
            {byDate.map((p, i) => {
              const sc    = p.computed?.totalMarks ?? 0;
              const maxSc = Math.max(...byDate.map(x => x.computed?.totalMarks ?? 0), 1);
              const h     = Math.max(6, (sc / maxSc) * 80);
              const col   = scoreColor(pct(sc, 100));
              return (
                <div key={p.id} title={(p.name || p.code) + ": " + sc.toFixed(1)}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: 9, color: col, fontFamily: "monospace" }}>{sc.toFixed(0)}</span>
                  <div style={{ width: "100%", height: h, background: col + "88",
                    borderRadius: "3px 3px 0 0", border: "1px solid " + col }} />
                  <span style={{ fontSize: 8, color: T.text3, maxWidth: 36,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name || ("P" + (i + 1))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      {/* ── Subject-wise Average ── */}
      <Section title="📊 Subject-wise Average" accent={T.purple}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...subjAvg].sort((a, b) => a.avgPct - b.avgPct).map(s => (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 60px", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: s.avgPct < 40 ? T.red : T.text2 }}>{s.name}</span>
              <Bar value={s.avg} max={s.maxMarks} height={8} />
              <span style={{ fontFamily: "monospace", fontSize: 11, color: T.text3, textAlign: "right" }}>
                {s.avg.toFixed(1)}/{s.maxMarks}
              </span>
              <Badge label={s.avgPct + "%"} color={scoreColor(s.avgPct)} />
            </div>
          ))}
        </div>
      </Section>

      {/* ── Weak / Strong Subjects (with Q count + See All) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {[
          { title: "🔴 Weakest Subjects",   key: "weakSubj",   data: [...subjAvg].sort((a,b) => a.avgPct - b.avgPct).slice(0,3), color: T.red   },
          { title: "🟢 Strongest Subjects", key: "strongSubj", data: [...subjAvg].sort((a,b) => b.avgPct - a.avgPct).slice(0,3), color: T.green },
        ].map(({ title, key, data, color }) => (
          <Section key={title} title={title} accent={color}>
            {data.map((s, i) => (
              <div key={s.id} style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 12, color: T.text }}>{"#" + (i + 1) + " " + s.name}</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color }}>{s.avgPct}%</span>
                </div>
                <Bar value={s.avg} max={s.maxMarks} />
                <div style={{ fontSize: 10, color: T.text3, marginTop: 3 }}>
                  {"from " + s.totalQ + " question" + (s.totalQ !== 1 ? "s" : "")}
                </div>
              </div>
            ))}
            {subjAvg.length > 3 && (
              <button onClick={() => setExpandModal(key)}
                style={{ ...btnGhost, width: "100%", fontSize: 11, marginTop: 4 }}>
                {"See all " + subjAvg.length + " subjects →"}
              </button>
            )}
          </Section>
        ))}
      </div>

      {/* ── Weak / Strong Topics (with Q count + See All) ── */}
      {topicList.length >= 2 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          {[
            { title: "🔴 Weakest Topics",   key: "weakTopic",   data: [...topicList].sort((a,b) => a.acc - b.acc).slice(0,3),  color: T.red   },
            { title: "🟢 Strongest Topics", key: "strongTopic", data: [...topicList].sort((a,b) => b.acc - a.acc).slice(0,3), color: T.green },
          ].map(({ title, key, data, color }) => (
            <Section key={title} title={title} accent={color}>
              {data.map((t, i) => (
                <div key={t.id} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: T.text }}>{"#" + (i + 1) + " " + t.name}</span>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color }}>{t.acc}%</span>
                  </div>
                  <Bar value={t.acc} max={100} />
                  <div style={{ fontSize: 10, color: T.text3, marginTop: 3 }}>
                    {t.correct + "/" + t.total + " Qs · " + t.subjName}
                  </div>
                </div>
              ))}
              {topicList.length > 3 && (
                <button onClick={() => setExpandModal(key)}
                  style={{ ...btnGhost, width: "100%", fontSize: 11, marginTop: 4 }}>
                  {"See all " + topicList.length + " topics →"}
                </button>
              )}
            </Section>
          ))}
        </div>
      )}

      {/* ── Guesswork Strategy ── */}
      <Section title="🎲 Guesswork Strategy" accent={T.yellow}>
        {/* Source indicator */}
        <div style={{ fontSize: 11, color: T.text3, marginBottom: 12 }}>
          {"Source: " + (hasOMRGuess ? "OMR guess tags (per-question)" : "Manual guesswork tab")}
        </div>

        {/* Overall cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
          {[
            { label: "🎯 50:50 Guess", c: ffC, w: ffW, net: ffNet, color: T.cyan   },
            { label: "🎲 Wild Guess",  c: wgC, w: wgW, net: wgNet, color: T.orange },
          ].map(row => {
            const acc = row.c + row.w > 0 ? Math.round(row.c / (row.c + row.w) * 100) : null;
            return (
              <div key={row.label} style={{ border: "1px solid " + row.color + "44",
                borderRadius: 8, padding: 14, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: row.color, marginBottom: 6, fontWeight: 600 }}>
                  {row.label}
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, color: row.color, fontFamily: "monospace" }}>
                  {acc !== null ? acc + "%" : "—"}
                </div>
                <div style={{ fontSize: 10, color: T.text3, margin: "4px 0 6px" }}>
                  {row.c}✓ {row.w}✗ · Net: {row.net >= 0 ? "+" : ""}{row.net.toFixed(2)}
                </div>
                {verdictBadge(row.net, row.c, row.w)}
              </div>
            );
          })}
          <div style={{ border: "1px solid " + T.yellow + "44", borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 11, color: T.yellow, fontWeight: 600, marginBottom: 8 }}>
              Break-even Rule
            </div>
            <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.7 }}>
              Need{" "}
              <strong style={{ color: T.yellow }}>{breakeven}%</strong>
              {" "}accuracy to break even with{" "}
              {Math.round(neg * 100)}% negative marking.
            </div>
          </div>
        </div>

        {/* Subject-wise guess breakdown */}
        {subjGuess.length > 0 && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.text3,
              textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
              Subject-wise Guess Breakdown
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    {["Subject","50:50 ✓","50:50 ✗","50:50 Net","Wild ✓","Wild ✗","Wild Net"].map(h => (
                      <th key={h} style={{ padding: "5px 8px", color: T.text3, fontSize: 10,
                        textAlign: h === "Subject" ? "left" : "center",
                        borderBottom: "1px solid " + T.border,
                        textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {subjGuess.map(s => (
                    <tr key={s.id} style={{ borderBottom: "1px solid " + T.border }}>
                      <td style={{ padding: "7px 8px", color: T.text2, fontSize: 12 }}>{s.name}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center", color: T.green,  fontFamily: "monospace" }}>{s.fc}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center", color: T.red,    fontFamily: "monospace" }}>{s.fw}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center",
                        color: s.ffNet >= 0 ? T.green : T.red, fontFamily: "monospace", fontWeight: 700 }}>
                        {s.ffNet >= 0 ? "+" : ""}{s.ffNet.toFixed(2)}
                      </td>
                      <td style={{ padding: "7px 8px", textAlign: "center", color: T.green,  fontFamily: "monospace" }}>{s.wc}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center", color: T.red,    fontFamily: "monospace" }}>{s.ww}</td>
                      <td style={{ padding: "7px 8px", textAlign: "center",
                        color: s.wgNet >= 0 ? T.green : T.red, fontFamily: "monospace", fontWeight: 700 }}>
                        {s.wgNet >= 0 ? "+" : ""}{s.wgNet.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Non-guess aggregate */}
        {(() => {
          // Compute non-guess totals from all filtered papers
          let ngCorrect = 0, ngWrong = 0;
          for (const p of filtered) {
            const pq = p.computed?.perQuestion || {};
            for (const v of Object.values(pq)) {
              if (v.result === "correct" && !v.isGuess) ngCorrect++;
              if (v.result === "wrong"   && !v.isGuess) ngWrong++;
            }
          }
          if (ngCorrect + ngWrong === 0) return null;
          const ngTotal = ngCorrect + ngWrong;
          const ngAcc   = Math.round(ngCorrect / ngTotal * 100);
          const ngNet   = ngCorrect - ngWrong * neg;
          return (
            <div style={{ marginTop: 12, borderTop: "1px solid " + T.border, paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.text3,
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Non-Guesswork Answers (across all papers)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
                {[
                  { label: "Correct",   val: ngCorrect, color: T.green  },
                  { label: "Wrong",     val: ngWrong,   color: T.red    },
                  { label: "Accuracy",  val: ngAcc + "%", color: scoreColor(ngAcc) },
                  { label: "Net Marks", val: (ngNet >= 0 ? "+" : "") + ngNet.toFixed(1), color: ngNet >= 0 ? T.green : T.red },
                ].map(item => (
                  <div key={item.label} style={{ textAlign: "center", padding: "10px 8px",
                    background: T.surface, borderRadius: 8,
                    border: "1px solid " + T.border }}>
                    <div style={{ fontSize: 18, fontWeight: 900,
                      color: item.color, fontFamily: "monospace" }}>
                      {item.val}
                    </div>
                    <div style={{ fontSize: 10, color: T.text3, marginTop: 3 }}>{item.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10, color: T.text3, marginTop: 8 }}>
                Question numbers not shown for combined view — see individual paper details.
              </div>
            </div>
          );
        })()}
      </Section>

      {/* ── Score Consistency + Improvement Rate ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <Section title="📐 Score Consistency" accent={consistColor}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: consistColor, fontFamily: "monospace" }}>
              {consistLabel}
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>
              {"Std deviation: " + stdDev.toFixed(1) + " marks"}
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>
              {"Avg: " + scoreAvg.toFixed(1) + " · Range: " +
                Math.min(...scores).toFixed(0) + "–" + Math.max(...scores).toFixed(0)}
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 10, color: T.text3, lineHeight: 1.6 }}>
            {"<5 = Very Consistent · <10 = Consistent · <15 = Variable · ≥15 = Inconsistent"}
          </div>
        </Section>

        <Section title="📊 Improvement Rate" accent={canShowImprovement && improvDelta >= 0 ? T.green : T.orange}>
          {canShowImprovement ? (
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ fontSize: 32, fontWeight: 900, fontFamily: "monospace",
                color: improvDelta >= 0 ? T.green : T.red }}>
                {improvDelta >= 0 ? "+" : ""}{improvDelta.toFixed(1)}
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 6 }}>marks improvement</div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 8 }}>
                {"First " + firstHalf.length + ": " + avgFirst.toFixed(1) +
                 " → Last " + secondHalf.length + ": " + avgSecond.toFixed(1)}
              </div>
              {/* Compound progress projection */}
              {(() => {
                if (!cutoff) return null;
                if (scoreAvg >= cutoff) return (
                  <div style={{ marginTop: 10, padding: "8px 12px",
                    background: T.green + "22", borderRadius: 6,
                    fontSize: 11, color: T.green, fontWeight: 700 }}>
                    You are above the cutoff! 🏆
                  </div>
                );
                if (improvDelta <= 0) return (
                  <div style={{ marginTop: 10, fontSize: 11, color: T.text3 }}>
                    No improvement trend yet. Keep going — results lag behind effort.
                  </div>
                );
                const ratePerPaper = improvDelta / (secondHalf.length || 1);
                const papersNeeded = Math.ceil((cutoff - scoreAvg) / ratePerPaper);
                if (papersNeeded > 100 || papersNeeded <= 0) return null;
                return (
                  <div style={{ marginTop: 10, padding: "8px 12px",
                    background: T.accent + "15", borderRadius: 6,
                    fontSize: 11, color: T.text2, lineHeight: 1.6 }}>
                    At this rate, you will reach the cutoff of{" "}
                    <strong style={{ color: T.yellow }}>{cutoff}</strong>{" "}
                    in approximately{" "}
                    <strong style={{ color: T.accent2 }}>
                      {papersNeeded + " more paper" + (papersNeeded !== 1 ? "s" : "")}
                    </strong>.
                  </div>
                );
              })()}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 20, color: T.text3, fontSize: 12 }}>
              Need at least 2 papers to show improvement trend.
            </div>
          )}
        </Section>
      </div>

      {/* ── Unattempted Question Analysis ── */}
      {unattempted.length > 0 && (
        <Section title="⬜ Unattempted Questions by Subject" accent={T.orange}>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 10 }}>
            Average questions left blank per paper (excluding deleted). Only subjects with avg ≥ 0.5 shown.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...unattempted].sort((a, b) => b.avgUn - a.avgUn).map(s => (
              <div key={s.id} style={{ display: "grid",
                gridTemplateColumns: "1fr 1fr 70px", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: T.text2 }}>{s.name}</span>
                <Bar value={s.avgUn} max={s.maxMarks} height={8} />
                <span style={{ fontFamily: "monospace", fontSize: 11, color: T.orange, textAlign: "right" }}>
                  {s.avgUn.toFixed(1)}/{s.maxMarks}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── Subject Contribution ── */}
      <Section title="🥧 Subject Contribution to Score" accent={T.teal}>
        <div style={{ fontSize: 11, color: T.text3, marginBottom: 10 }}>
          Each subject's average marks as a share of your total average score.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {subjContrib.map((s, i) => {
            const sColor = T.subjectColors[i % T.subjectColors.length] || T.accent;
            return (
              <div key={s.id} style={{ display: "grid",
                gridTemplateColumns: "1fr 1fr 50px 50px", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: T.text2 }}>{s.name}</span>
                <Bar value={s.avg} max={Math.max(...subjContrib.map(x => x.avg), 1)} height={8} />
                <span style={{ fontFamily: "monospace", fontSize: 11, color: sColor, textAlign: "right" }}>
                  {s.avg.toFixed(1)}
                </span>
                <Badge label={s.contrib + "%"} color={sColor} />
              </div>
            );
          })}
        </div>
      </Section>

      {/* ── Score vs Cutoff Gap (only when cutoff is set) ── */}
      {cutoff && (
        <Section title={"🎯 Score vs Cutoff (" + cutoff + ")"} accent={T.yellow}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {byDate.map(p => {
              const sc  = p.computed?.totalMarks ?? 0;
              const gap = sc - cutoff;
              const col = gap >= 0 ? T.green : T.red;
              return (
                <div key={p.id} style={{ display: "grid",
                  gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center",
                  padding: "6px 10px", borderRadius: 6,
                  background: T.surface, border: "1px solid " + T.border }}>
                  <span style={{ fontSize: 12, color: T.text2 }}>
                    {p.name || p.code || "Paper"}
                    {p.date && (
                      <span style={{ fontSize: 10, color: T.text3, marginLeft: 8 }}>{p.date}</span>
                    )}
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: 12, color: scoreColor(pct(sc, 100)) }}>
                    {sc.toFixed(1)}
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: 12,
                    color: col, fontWeight: 700, minWidth: 60, textAlign: "right" }}>
                    {gap >= 0 ? "+" : ""}{gap.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Topic Performance ── */}
      {Object.keys(topicStats).length > 0 && (
        <Section title="📌 Topic Performance (from OMR tags)" accent={T.cyan}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {syllabus.subjects.map(subj => {
              const subjTopics = subj.topics
                .filter(t => topicStats[t.id])
                .map(t => ({
                  ...t,
                  stats: topicStats[t.id],
                  acc: topicStats[t.id].total > 0
                    ? Math.round(topicStats[t.id].correct / topicStats[t.id].total * 100)
                    : 0,
                }))
                .sort((a, b) =>
                  b.stats.total !== a.stats.total
                    ? b.stats.total - a.stats.total
                    : b.acc - a.acc
                );
              if (subjTopics.length === 0) return null;
              const sIdx   = syllabus.subjects.findIndex(s => s.id === subj.id);
              const sColor = T.subjectColors[sIdx % T.subjectColors.length] || T.accent;
              return (
                <div key={subj.id}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sColor,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    borderBottom: "1px solid " + sColor + "33",
                    paddingBottom: 5, marginBottom: 8,
                    display: "flex", justifyContent: "space-between" }}>
                    <span>{subj.name}</span>
                    <span style={{ fontWeight: 400, color: T.text3, fontSize: 10 }}>
                      {subjTopics.length + " topic" + (subjTopics.length !== 1 ? "s" : "")}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {subjTopics.map(t => (
                      <div key={t.id} style={{ display: "grid",
                        gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center",
                        padding: "6px 10px", borderRadius: 6,
                        background: T.surface, border: "1px solid " + T.border }}>
                        <span style={{ fontSize: 12, color: T.text2, minWidth: 0 }}>
                          {t.topicNo
                            ? <span style={{ fontSize: 10, color: T.text3,
                                marginRight: 5, fontFamily: "monospace" }}>{"[" + t.topicNo + "]"}</span>
                            : null}
                          {t.name}
                        </span>
                        <span style={{ fontFamily: "monospace", fontSize: 12,
                          color: T.text3, whiteSpace: "nowrap" }}>
                          {t.stats.correct + "/" + t.stats.total}
                        </span>
                        <Badge label={t.acc + "%"} color={scoreColor(t.acc)} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Revision vs Accuracy ── */}
      {corrData.length > 0 && (
        <Section title="📈 Revision vs Accuracy" accent={T.pink}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...corrData].sort((a, b) => b.revisions - a.revisions).map(item => (
              <div key={item.name} style={{ display: "grid",
                gridTemplateColumns: "1fr 70px 1fr 60px", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: T.text2 }}>{item.name}</span>
                <span style={{ fontFamily: "monospace", fontSize: 11,
                  color: T.purple, textAlign: "center" }}>
                  {item.revisions + "x rev"}
                </span>
                <Bar value={item.accuracy} max={100} />
                <Badge label={item.accuracy + "%"} color={scoreColor(item.accuracy)} />
              </div>
            ))}
          </div>
        </Section>
      )}

      </div>
      )} {/* end !selectedPaperId aggregate view */}

      {/* ── Expand Modals for Weak/Strong cards ── */}
      {expandModal && (() => {
        const isSubj  = expandModal === "weakSubj" || expandModal === "strongSubj";
        const isWeak  = expandModal === "weakSubj" || expandModal === "weakTopic";
        const title   = isWeak
          ? (isSubj ? "🔴 All Subjects — Weakest First" : "🔴 All Topics — Weakest First")
          : (isSubj ? "🟢 All Subjects — Strongest First" : "🟢 All Topics — Strongest First");
        const color   = isWeak ? T.red : T.green;

        if (isSubj) {
          const sorted = [...subjAvg].sort((a,b) => isWeak ? a.avgPct - b.avgPct : b.avgPct - a.avgPct);
          return (
            <Modal title={title} onClose={() => setExpandModal(null)}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "65vh", overflowY: "auto" }}>
                {sorted.map((s, i) => (
                  <div key={s.id} style={{ padding: "10px 12px", borderRadius: 8,
                    background: T.surface, border: "1px solid " + T.border }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                        {"#" + (i+1) + " " + s.name}
                      </span>
                      <Badge label={s.avgPct + "%"} color={scoreColor(s.avgPct)} />
                    </div>
                    <Bar value={s.avg} max={s.maxMarks} height={8} />
                    <div style={{ fontSize: 10, color: T.text3, marginTop: 4, display: "flex", gap: 16 }}>
                      <span>{s.avg.toFixed(1) + "/" + s.maxMarks + " avg marks"}</span>
                      <span>{"from " + s.totalQ + " question" + (s.totalQ !== 1 ? "s" : "")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Modal>
          );
        } else {
          const sorted = [...topicList].sort((a,b) => isWeak ? a.acc - b.acc : b.acc - a.acc);
          return (
            <Modal title={title} onClose={() => setExpandModal(null)}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "65vh", overflowY: "auto" }}>
                {sorted.map((t, i) => (
                  <div key={t.id} style={{ padding: "10px 12px", borderRadius: 8,
                    background: T.surface, border: "1px solid " + T.border }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12, color: T.text }}>
                          {"#" + (i+1) + " "}
                          {t.topicNo
                            ? <span style={{ fontSize: 10, color: T.text3,
                                fontFamily: "monospace", marginRight: 4 }}>
                                {"[" + t.topicNo + "]"}
                              </span>
                            : null}
                          {t.name}
                        </span>
                        <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
                          {t.subjName + " · " + t.correct + "/" + t.total + " correct"}
                        </div>
                      </div>
                      <Badge label={t.acc + "%"} color={scoreColor(t.acc)} />
                    </div>
                    <Bar value={t.acc} max={100} height={6} />
                  </div>
                ))}
              </div>
            </Modal>
          );
        }
      })()}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// SYLLABI PAGE
// ═══════════════════════════════════════════════════════════════════════════════

function SyllabiPage({ syllabi, papers, activeSylId, onAdd, onImport, onEdit, onDelete, onSelect }) {
  const [toDelete, setToDelete] = useState(null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap:"wrap", gap:10 }}>
        <h2 style={{ margin: 0, fontWeight: 800, fontSize: 18, color: T.text }}>Syllabi</h2>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onImport} style={btnPrimary(T.purple)}>📄 Import from Docx</button>
          <button onClick={onAdd} style={btnPrimary(T.accent)}>+ New Manually</button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {syllabi.map(s => {
          const sPapers = papers.filter(p => p.syllabusId === s.id).length;
          return (
            <div key={s.id} style={{ ...cardStyle }}>
              {/* Syllabus info */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, color: T.text, fontSize: 15, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {s.name}
                  {s.id === activeSylId && <Badge label="Active" color={T.green} />}
                </div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 4 }}>
                  {s.subjects.length} subjects · {s.totalMarks} marks ·
                  Neg: {(s.negMark || 1 / 3).toFixed(3)} · {sPapers} paper{sPapers !== 1 ? "s" : ""}
                </div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>
                  {s.subjects.map(sub => (
                    <Badge key={sub.id} label={`${sub.name} (${sub.maxMarks})`} color={T.accent} />
                  ))}
                </div>
              </div>
              {/* Action buttons — horizontal row, wraps on small screens */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
                <button onClick={() => onSelect(s.id)}
                  style={{
                    ...btnGhost, fontSize: 12,
                    background: s.id === activeSylId ? T.green + "22" : "transparent",
                    color:      s.id === activeSylId ? T.green  : T.text2,
                    borderColor:s.id === activeSylId ? T.green  : T.border2,
                  }}>
                  {s.id === activeSylId ? "✓ Active" : "Set Active"}
                </button>
                <button onClick={() => onEdit(s)} style={{ ...btnGhost, fontSize: 12 }}>Edit</button>
                <button onClick={() => setToDelete(s)}
                  style={{ ...btnGhost, fontSize: 12, color: T.red, borderColor: T.red + "44", marginLeft: "auto" }}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {toDelete && (
        <ConfirmDialog
          message={`Delete "${toDelete.name}"?`}
          detail={`This will also delete all ${papers.filter(p => p.syllabusId === toDelete.id).length} papers under it. Cannot be undone.`}
          confirmLabel="Delete All" danger
          onConfirm={() => { onDelete(toDelete.id); setToDelete(null); }}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDY TRACKER PAGE — tabbed: Streak | Study Log | Revision Counter
// ═══════════════════════════════════════════════════════════════════════════════

function StudyTrackerPage({ syllabus, papers, logs, streak, onSaveLog, onDeleteLog, onUpdateRevision, allSyllabi, onSwitchSyllabus }) {
  const [tab, setTab] = useState("streak");

  const tabStyle = (t) => ({
    padding: "10px 16px", fontSize: 13, fontWeight: 600,
    background: "transparent", border: "none", cursor: "pointer",
    color: tab === t ? T.text : T.text3,
    borderBottom: tab === t ? "2px solid " + T.accent : "2px solid transparent",
  });

  return (
    <div>
      {/* Syllabus context label + switcher */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: T.text3 }}>Studying:</span>
        {allSyllabi && allSyllabi.length > 1 ? (
          allSyllabi.map(s => (
            <button key={s.id} onClick={() => onSwitchSyllabus(s.id)}
              style={{
                ...btnGhost, fontSize: 12, padding: "4px 10px",
                background: s.id === syllabus.id ? T.accent + "33" : "transparent",
                color:      s.id === syllabus.id ? T.accent2 : T.text2,
                borderColor:s.id === syllabus.id ? T.accent   : T.border2,
              }}>
              {s.shortName}
            </button>
          ))
        ) : (
          <span style={{ fontSize: 12, fontWeight: 700, color: T.accent2 }}>{syllabus.shortName}</span>
        )}
      </div>

      <div style={{ borderBottom: "1px solid " + T.border, marginBottom: 20, display: "flex", overflowX: "auto" }}>
        <button onClick={() => setTab("streak")}    style={tabStyle("streak")}>🔥 Streak</button>
        <button onClick={() => setTab("log")}       style={tabStyle("log")}>📅 Study Log</button>
        <button onClick={() => setTab("revisions")} style={tabStyle("revisions")}>📖 Revisions</button>
        <button onClick={() => setTab("timer")}     style={tabStyle("timer")}>⏱ Timer</button>
      </div>

      {tab === "streak" && (
        <StreakPanel streak={streak} logs={logs} syllabus={syllabus} />
      )}
      {tab === "log" && (
        <StudyLogPanel
          syllabus={syllabus} logs={logs}
          onSave={onSaveLog} onDelete={onDeleteLog}
        />
      )}
      {tab === "revisions" && (
        <RevisionCounter
          syllabus={syllabus} papers={papers}
          onUpdateRevision={onUpdateRevision}
        />
      )}
      {tab === "timer" && (
        <StudyTimer />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT APP
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const [syllabi,     setSyllabi]     = useState([]);
  const [papers,      setPapers]      = useState([]);
  const [activeSylId, setActiveSylId] = useState(null);
  const [page,        setPage]        = useState("dashboard");
  const [loading,     setLoading]     = useState(true);
  const [cutoffs,     setCutoffs]     = useState({});
  const [modal,       setModal]       = useState(null);
  const { toasts, showToast }         = useToast();

  const activeSyl    = syllabi.find(s => s.id === activeSylId) || syllabi[0] || null;
  const activePapers = papers.filter(p => p.syllabusId === activeSylId);

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      let syl = (await DB.get(KEYS.SYLLABI)) || [];
      if (!syl.length) { syl = [DEFAULT_SYLLABUS]; await DB.set(KEYS.SYLLABI, syl); }
      const ppr = (await DB.get(KEYS.PAPERS)) || [];
      const cut = JSON.parse(localStorage.getItem("psc-cutoffs") || "{}");
      setSyllabi(syl);
      setPapers(ppr);
      setCutoffs(cut);
      setActiveSylId(syl[0]?.id || null);
      setLoading(false);
      setTimeout(() => { if (window.__hideSplash) window.__hideSplash(); }, 300);
    })();
  }, []);

  // ── Persistence ───────────────────────────────────────────────────────────
  const saveSyllabi = async (upd) => {
    const ok = await DB.set(KEYS.SYLLABI, upd);
    if (ok === "QUOTA") showToast("Storage full — export data to free space.", "error");
    setSyllabi(upd);
  };

  const savePapers = async (upd) => {
    const ok = await DB.set(KEYS.PAPERS, upd);
    if (ok === "QUOTA") showToast("Storage full — PDF or content may not have saved.", "error");
    setPapers(upd);
  };

  // ── Study tracker ─────────────────────────────────────────────────────────
  const { logs, streak, saveLog, deleteLog, updateRevision } = useStudyTracker(
    activeSyl,
    (updSyl) => saveSyllabi(syllabi.map(s => s.id === updSyl.id ? updSyl : s))
  );

  // ── Syllabus CRUD ─────────────────────────────────────────────────────────
  const handleSaveSyllabus = async (syl) => {
    const upd = syllabi.find(s => s.id === syl.id)
      ? syllabi.map(s => s.id === syl.id ? syl : s)
      : [...syllabi, syl];
    await saveSyllabi(upd);
    setActiveSylId(syl.id);
    setModal(null);
    showToast("Syllabus saved ✓");
  };

  const handleDeleteSyllabus = async (id) => {
    await saveSyllabi(syllabi.filter(s => s.id !== id));
    await savePapers(papers.filter(p => p.syllabusId !== id));
    if (activeSylId === id) setActiveSylId(syllabi.find(s => s.id !== id)?.id || null);
    showToast("Syllabus deleted");
  };

  // ── Paper CRUD ────────────────────────────────────────────────────────────
  const handleSavePaper = async (paper) => {
    const upd = papers.find(p => p.id === paper.id)
      ? papers.map(p => p.id === paper.id ? paper : p)
      : [...papers, paper];
    await savePapers(upd);
    setModal(null);
    showToast("Paper saved ✓");
    setPage("papers");
  };

  const handleDeletePaper = async (id) => {
    await savePapers(papers.filter(p => p.id !== id));
    showToast("Paper deleted");
  };

  // ── Sync helpers ──────────────────────────────────────────────────────────
  const getAllData = useCallback(async () => ({
    syllabi:   (await DB.get(KEYS.SYLLABI))    || [],
    papers:    (await DB.get(KEYS.PAPERS))     || [],
    studyLogs: (await DB.get(KEYS.STUDY_LOGS)) || [],
    streaks:   (await DB.get(KEYS.STREAKS))    || {},
  }), []);

  const restoreAllData = useCallback(async (data) => {
    if (data.syllabi)   { await DB.set(KEYS.SYLLABI,    data.syllabi);   setSyllabi(data.syllabi);  }
    if (data.papers)    { await DB.set(KEYS.PAPERS,     data.papers);    setPapers(data.papers);    }
    if (data.studyLogs) { await DB.set(KEYS.STUDY_LOGS, data.studyLogs); }
    if (data.streaks)   { await DB.set(KEYS.STREAKS,    data.streaks);   }
    if (data.syllabi?.[0]) setActiveSylId(data.syllabi[0].id);
    showToast("Data restored ✓");
  }, []);

  // ── Cutoff ────────────────────────────────────────────────────────────────
  const handleSetCutoff = (val) => {
    const upd = { ...cutoffs, [activeSylId]: val };
    setCutoffs(upd);
    localStorage.setItem("psc-cutoffs", JSON.stringify(upd));
  };

  // ── Nav helper — bottom tab bar items ───────────────────────────────────
  // No navBtn needed here; bottom bar is rendered inline in JSX below

  if (loading) return (
    <div style={{
      background: T.bg, minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: T.text2, fontFamily: "inherit",
    }}>
      Loading…
    </div>
  );

  // Bottom tab definitions
  const TABS = [
    { key: "dashboard", icon: "📊", label: "Home"      },
    { key: "papers",    icon: "📋", label: "Papers"    },
    { key: "analytics", icon: "📈", label: "Analytics" },
    { key: "study",     icon: "📚", label: "Study"     },
    { key: "syllabi",   icon: "🗂",  label: "Syllabi"   },
    { key: "sync",      icon: "⚙",  label: "Settings"  },
  ];

  return (
    <div style={{ background: T.bg, minHeight: "100vh", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", color: T.text, paddingBottom: 72 }}>

      {/* ── Compact top header ── */}
      <div style={{
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        position: "sticky", top: 0, zIndex: 100,
        padding: "10px 16px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        {/* Logo */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: "-0.02em", lineHeight: 1.2 }}>PSC Tracker</div>
          {activeSyl && (
            <div style={{ fontSize: 11, color: T.text3 }}>{activeSyl.shortName}</div>
          )}
        </div>

        {/* Syllabus quick-switcher — only if more than one */}
        {syllabi.length > 1 && (
          <select value={activeSylId || ""}
            onChange={e => setActiveSylId(e.target.value)}
            style={{ ...inputStyle, width: "auto", fontSize: 11, padding: "4px 8px", maxWidth: 130 }}>
            {syllabi.map(s => <option key={s.id} value={s.id}>{s.shortName}</option>)}
          </select>
        )}

        {/* FAB-style add paper button */}
        {activeSyl && (
          <button
            onClick={() => setModal({ type: "addPaper" })}
            style={{
              ...btnPrimary(T.accent),
              padding: "8px 14px", fontSize: 13, fontWeight: 700,
              borderRadius: 20, boxShadow: `0 2px 12px ${T.accent}55`,
            }}>
            + Paper
          </button>
        )}
      </div>

      {/* ── Content — extra bottom padding for tab bar ── */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 16px 16px" }}>

        {!activeSyl && page !== "syllabi" && (
          <div style={{ ...cardStyle, textAlign: "center", padding: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
            <div style={{ fontSize: 16, color: T.text2, marginBottom: 16 }}>No syllabus found</div>
            <button onClick={() => setPage("syllabi")} style={btnPrimary(T.accent)}>Go to Syllabi</button>
          </div>
        )}

        {activeSyl && page === "dashboard" && (
          <Dashboard
            papers={activePapers} syllabus={activeSyl} streak={streak}
            logs={logs} onSaveLog={saveLog}
            onAddPaper={() => setModal({ type: "addPaper" })}
            onNavigate={setPage}
          />
        )}

        {activeSyl && page === "papers" && (
          <PapersList
            papers={activePapers} syllabus={activeSyl} streak={streak}
            onAdd={()   => setModal({ type: "addPaper" })}
            onEdit={(p) => setModal({ type: "editPaper", paper: p })}
            onView={(p) => setModal({ type: "viewPaper", paper: p })}
            onDelete={handleDeletePaper}
          />
        )}

        {activeSyl && page === "analytics" && (
          <Analytics
            papers={activePapers} syllabus={activeSyl}
            cutoff={cutoffs[activeSylId]}
            onSetCutoff={handleSetCutoff}
            allSyllabi={syllabi}
            allPapers={papers}
          />
        )}

        {activeSyl && page === "study" && (
          <StudyTrackerPage
            syllabus={activeSyl} papers={activePapers}
            logs={logs} streak={streak}
            onSaveLog={saveLog} onDeleteLog={deleteLog}
            onUpdateRevision={updateRevision}
            allSyllabi={syllabi}
            onSwitchSyllabus={setActiveSylId}
          />
        )}

        {page === "syllabi" && (
          <SyllabiPage
            syllabi={syllabi} papers={papers} activeSylId={activeSylId}
            onAdd={()      => setModal({ type: "addSyllabus" })}
            onImport={()   => setModal({ type: "importSyllabus" })}
            onEdit={(s)    => setModal({ type: "editSyllabus", syllabus: s })}
            onDelete={handleDeleteSyllabus}
            onSelect={(id) => { setActiveSylId(id); }}
          />
        )}

        {page === "sync" && (
          <div>
            <h2 style={{ margin: "0 0 20px", fontWeight: 800, fontSize: 18, color: T.text }}>Settings</h2>
            <SyncPanel
              getAllData={getAllData}
              restoreAllData={restoreAllData}
              onRestored={() => showToast("Data restored ✓")}
            />
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {modal?.type === "addSyllabus" && (
        <SyllabusEditor
          existingNames={syllabi.map(s => s.name)}
          onSave={handleSaveSyllabus}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "editSyllabus" && (
        <SyllabusEditor
          initial={modal.syllabus}
          existingNames={syllabi.map(s => s.name)}
          onSave={handleSaveSyllabus}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "addPaper" && activeSyl && (
        <PaperForm
          syllabus={activeSyl}
          syllabi={syllabi}
          onChangeSyllabus={setActiveSylId}
          onSave={handleSavePaper}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "editPaper" && activeSyl && (
        <PaperForm
          syllabus={activeSyl}
          initial={modal.paper}
          onSave={handleSavePaper}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "viewPaper" && activeSyl && (
        <PaperDetail
          paper={modal.paper}
          syllabus={activeSyl}
          onEdit={() => setModal({ type: "editPaper", paper: modal.paper })}
          onShare={() => shareOnWhatsApp(modal.paper, activeSyl, streak?.currentStreak)}
          onClose={() => setModal(null)}
        />
      )}

      {/* Syllabus importer modal */}
      {modal?.type === "importSyllabus" && (
        <SyllabusImporter
          existingNames={syllabi.map(s => s.name)}
          onConfirm={async (syl) => {
            await handleSaveSyllabus(syl);
          }}
          onClose={() => setModal(null)}
        />
      )}

      {/* ── Toast notifications ── */}
      <ToastContainer toasts={toasts} />

      {/* ── Bottom Tab Bar ── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: T.surface, borderTop: `1px solid ${T.border}`,
        display: "flex", zIndex: 200,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}>
        {TABS.map(tab_ => {
          const active = page === tab_.key;
          return (
            <button key={tab_.key}
              onClick={() => setPage(tab_.key)}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 2, padding: "8px 4px",
                background: "transparent", border: "none", cursor: "pointer",
                color: active ? T.accent2 : T.text3,
                borderTop: active ? `2px solid ${T.accent}` : "2px solid transparent",
                transition: "all 0.15s",
                minWidth: 0,
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{tab_.icon}</span>
              <span style={{ fontSize: 9, fontWeight: active ? 700 : 400, letterSpacing: "0.02em" }}>
                {tab_.key === "papers" ? `${tab_.label} (${activePapers.length})` : tab_.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── CSS ── */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateX(-50%) translateY(12px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        input:focus, textarea:focus, select:focus { border-color: #6366f1 !important; }
        button:hover { opacity: 0.85; }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #0d1117; }
        ::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 3px; }
      `}</style>
    </div>
  );
}
