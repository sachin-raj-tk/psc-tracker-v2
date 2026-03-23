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
  SearchSelect, ConfirmDialog,
} from "./AppCore";

import {
  SyllabusEditor,
  PaperForm,
  PaperDetail,
} from "./AppSyllabusPart2";

import { SyllabusImporter } from "./AppSyllabusPart1b";
import { buildTopicOptions } from "./AppSyllabusPart1a";

import {
  useStudyTracker,
  StudyLogPanel,
  RevisionCounter,
  StreakPanel,
  StudyTimer,
  StudyHeatmap,
  QuickLogPanel,
  SkipReasonModal,
} from "./AppStudy";

import {
  SyncPanel,
  shareOnWhatsApp,
  autoSync,
  checkRemindersNow,
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
  const [editing,     setEditing]     = useState(null);
  const [formName,    setFormName]    = useState("");
  const [formDT,      setFormDT]      = useState("");
  const [formErr,     setFormErr]     = useState("");
  const [activePipId, setActivePipId] = useState(null);

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
    autoSync();
  };

  const handleDelete = (id) => {
    const updated = timers.filter(t => t.id !== id);
    saveExamTimers(updated);
    setTimers(updated);
    autoSync();
  };

  // Open Picture-in-Picture for exam countdown using canvas→video (works on Android)
  const handleExamPiP = async (timer) => {
    const videoEl = document.createElement("video");
    if (!document.pictureInPictureEnabled || !videoEl.requestPictureInPicture) {
      alert("Picture-in-Picture is not supported on this device.");
      return;
    }
    // Close any existing PiP
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {});
    }
    setActivePipId(timer.id);
    try {
      const canvas = document.createElement("canvas");
      canvas.width  = 320;
      canvas.height = 220;
      const ctx = canvas.getContext("2d");

      const calcCD = (dtStr) => {
        try {
          const diff = new Date(dtStr).getTime() - Date.now();
          if (isNaN(diff) || diff <= 0) return null;
          const total = Math.floor(diff / 1000);
          return {
            days:    Math.floor(total / 86400),
            hours:   Math.floor((total % 86400) / 3600),
            minutes: Math.floor((total % 3600) / 60),
          };
        } catch { return null; }
      };

      const drawFrame = () => {
        ctx.fillStyle = "#07090f";
        ctx.fillRect(0, 0, 320, 220);
        const cd = calcCD(timer.datetime);

        // Exam name
        ctx.fillStyle = "#e6edf3";
        ctx.font      = "bold 18px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(timer.name, 160, 36);

        if (!cd) {
          ctx.fillStyle = "#8b949e";
          ctx.font      = "16px sans-serif";
          ctx.fillText("Exam completed", 160, 110);
        } else {
          const col = cd.days < 7 ? "#f85149" : cd.days < 30 ? "#d29922" : "#3fb950";
          // Days
          ctx.fillStyle = col;
          ctx.font      = "bold 64px monospace";
          ctx.textAlign = "center";
          ctx.fillText(String(cd.days), 80, 130);
          ctx.fillStyle = "#8b949e";
          ctx.font      = "13px monospace";
          ctx.fillText("days", 80, 152);
          // Hours
          ctx.fillStyle = col;
          ctx.font      = "bold 40px monospace";
          ctx.fillText(String(cd.hours).padStart(2,"0"), 190, 120);
          ctx.fillStyle = "#8b949e";
          ctx.font      = "13px monospace";
          ctx.fillText("hrs", 190, 140);
          // Minutes
          ctx.fillStyle = col;
          ctx.font      = "bold 40px monospace";
          ctx.fillText(String(cd.minutes).padStart(2,"0"), 270, 120);
          ctx.fillStyle = "#8b949e";
          ctx.font      = "13px monospace";
          ctx.fillText("min", 270, 140);
          // Date
          ctx.fillStyle = "#8b949e";
          ctx.font      = "12px sans-serif";
          ctx.fillText(new Date(timer.datetime).toLocaleDateString("en-IN",
            { day:"numeric", month:"short", year:"numeric" }), 160, 190);
        }
      };

      const stream = canvas.captureStream(0.5); // 0.5fps — enough for countdown
      const video  = document.createElement("video");
      video.srcObject = stream;
      video.muted     = true;
      video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0.01;top:0;left:0;pointer-events:none;";
      document.body.appendChild(video);

      drawFrame();
      const tick = setInterval(drawFrame, 30000); // redraw every 30s for countdown

      await video.play();
      await video.requestPictureInPicture();

      video.addEventListener("leavepictureinpicture", () => {
        clearInterval(tick);
        video.remove();
        setActivePipId(null);
      });
    } catch (e) {
      setActivePipId(null);
      alert("Could not open floating countdown: " + (e.message || "unknown error"));
    }
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

              {/* Edit / Delete / PiP */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 8 }}>
                {cd.status === "future" && (
                  <button
                    onClick={() => handleExamPiP(timer)}
                    title="Float countdown on top of other apps"
                    style={{ ...btnGhost, padding: "4px 8px", fontSize: 11,
                      color: activePipId === timer.id ? T.accent2 : T.text2,
                      borderColor: activePipId === timer.id ? T.accent : T.border2 }}>
                    ⧉
                  </button>
                )}
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

  const [dashTip, setDashTip] = useState(null); // { id, name, x, y }

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
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <div style={{
                display: "flex", alignItems: "flex-end", gap: 4,
                height: 110, paddingTop: 8,
                minWidth: sorted.length * 44 + "px",
              }}>
                {sorted.map((p, i) => {
                  const sc  = p.computed?.totalMarks ?? 0;
                  const h   = Math.max(6, (sc / maxSc) * 80);
                  const col = scoreColor(pct(sc, 100));
                  return (
                    <div key={p.id}
                      onClick={e => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDashTip({ id: p.id, name: p.name || p.code || ("Paper " + (i+1)),
                          sc: sc, x: rect.left + rect.width / 2, y: rect.top });
                        clearTimeout(window.__dashTipTimer);
                        window.__dashTipTimer = setTimeout(() => setDashTip(null), 2000);
                      }}
                      style={{ flex: "0 0 40px", display: "flex", flexDirection: "column",
                        alignItems: "center", gap: 3, cursor: "pointer" }}>
                      <div style={{ width: "100%", height: h,
                        background: (dashTip?.id === p.id) ? col : col + "88",
                        borderRadius: "3px 3px 0 0",
                        border: "1px solid " + col }} />
                      <span style={{ fontSize: 8, color: T.text3, width: 40,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
                        {p.name || p.code || ("P" + (i + 1))}
                      </span>
                    </div>
                  );
                })}
              </div>
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
        {/* Fixed tooltip — rendered outside scroll container to avoid clipping */}
        {dashTip && (
          <div style={{
            position: "fixed",
            left: Math.min(dashTip.x, window.innerWidth - 190),
            top: Math.max(dashTip.y - 54, 60),
            transform: "translateX(-50%)",
            background: "#1c2333", border: "1px solid " + T.border,
            borderRadius: 7, padding: "7px 12px", zIndex: 2000,
            whiteSpace: "nowrap", fontSize: 12, color: T.text,
            boxShadow: "0 4px 16px rgba(0,0,0,0.7)",
            pointerEvents: "none",
          }}>
            <div style={{ fontWeight: 700, color: scoreColor(pct(dashTip.sc, 100)),
              fontFamily: "monospace", fontSize: 14, marginBottom: 2 }}>
              {dashTip.sc.toFixed(2)}<span style={{ fontSize: 10, color: T.text3 }}>/100</span>
            </div>
            <div style={{ color: T.text2 }}>{dashTip.name}
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
                {(p.bookletCode || p.answerKey || hasContent || p.questions) && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap",
                    marginBottom: 6 }}>
                    {p.bookletCode && (
                      <Badge label={"Booklet " + p.bookletCode} color={T.accent} />
                    )}
                    {p.answerKey && <Badge label="Key ✓" color={T.green} />}
                    {p.questions && (
                      <Badge label={"📖 " + Object.keys(p.questions).length + " exp"} color={T.cyan} />
                    )}
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

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC QUESTION VIEWER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * TopicQuestionViewer — shows all questions tagged to a specific topic
 * across all papers. Navigable with Prev/Next or by tapping the list.
 * Reuses the bottom-sheet popup style from QuestionViewer.
 */
function TopicQuestionViewer({ topic, papers, syllabus, onClose }) {
  const [idx, setIdx] = useState(0);

  // Build flat list of all questions tagged to this topic across all papers
  const items = [];
  for (const paper of papers) {
    const omr = paper.omr || {};
    const pq  = paper.computed?.perQuestion || {};
    const qs  = paper.questions || {};
    for (const qStr of Object.keys(omr).sort((a,b) => parseInt(a)-parseInt(b))) {
      if (omr[qStr]?.topicId === topic.id) {
        items.push({
          paperId:     paper.id,
          paperName:   paper.name || paper.code || "Paper",
          qStr,
          result:      pq[qStr]?.result || "unattempted",
          myAns:       omr[qStr]?.answer || "—",
          keyAns:      pq[qStr]?.keyAns || "—",
          isGuess:     omr[qStr]?.isGuess || false,
          text:        qs[qStr]?.text || "",
          options:     qs[qStr]?.options || {},
          explanation: qs[qStr]?.explanation || "",
        });
      }
    }
  }

  // Clamp idx if items list is shorter than current idx
  const safeIdx = Math.min(idx, Math.max(0, items.length - 1));
  const item    = items[safeIdx];

  const qColor = (result) => {
    if (result === "correct")     return T.green;
    if (result === "wrong")       return T.red;
    if (result === "unattempted") return T.text3;
    if (result === "deleted")     return T.text3;
    return T.border2;
  };
  const qIcon = (result) => {
    if (result === "correct")     return "✓";
    if (result === "wrong")       return "✗";
    if (result === "unattempted") return "—";
    if (result === "deleted")     return "⊘";
    return "?";
  };

  if (items.length === 0) {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 1100,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }} onClick={onClose}>
        <div style={{ background: "#0d1117", borderRadius: 12, padding: 32,
          border: "1px solid " + T.border, textAlign: "center" }}
          onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 14, color: T.text, marginBottom: 12 }}>
            No questions tagged to this topic.
          </div>
          <button onClick={onClose} style={{ ...btnGhost, fontSize: 13 }}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1100,
      background: "rgba(0,0,0,0.7)",
      display: "flex", flexDirection: "column",
    }} onClick={onClose}>
      <div style={{
        background: "#0d1117", borderRadius: "16px 16px 0 0",
        marginTop: "auto", width: "100%", maxWidth: 600, alignSelf: "center",
        maxHeight: "88vh", display: "flex", flexDirection: "column",
        border: "1px solid " + T.border,
        boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          padding: "12px 16px 10px",
          borderBottom: "1px solid " + T.border,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.text, lineHeight: 1.3 }}>
                {topic.topicNo ? "[" + topic.topicNo + "] " : ""}{topic.name}
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                {items.length} question{items.length !== 1 ? "s" : ""} across all papers
              </div>
            </div>
            <button onClick={onClose}
              style={{ ...btnGhost, padding: "4px 10px", fontSize: 13, flexShrink: 0 }}>✕</button>
          </div>

          {/* Scrollable question pills */}
          <div style={{ display: "flex", gap: 5, overflowX: "auto",
            WebkitOverflowScrolling: "touch", marginTop: 10, paddingBottom: 4 }}>
            {items.map((it, i) => {
              const col = qColor(it.result);
              return (
                <button key={it.paperId + "_" + it.qStr}
                  onClick={() => setIdx(i)}
                  style={{
                    flexShrink: 0, padding: "3px 9px", borderRadius: 5,
                    border: "1px solid " + col + (safeIdx === i ? "ff" : "55"),
                    background: safeIdx === i ? col + "33" : "transparent",
                    color: col, fontSize: 11, fontWeight: safeIdx === i ? 700 : 400,
                    cursor: "pointer",
                  }}>
                  Q{it.qStr}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "14px 16px", flex: 1 }}>

          {/* Paper + result badge */}
          <div style={{ display: "flex", gap: 8, alignItems: "center",
            flexWrap: "wrap", marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: T.text3, background: T.surface,
              border: "1px solid " + T.border, borderRadius: 5, padding: "2px 8px" }}>
              Q{item.qStr} · {item.paperName}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 700, color: qColor(item.result),
              background: qColor(item.result) + "22",
              border: "1px solid " + qColor(item.result) + "44",
              borderRadius: 5, padding: "2px 8px",
            }}>
              {qIcon(item.result)} {item.result}
            </span>
            {item.isGuess && (
              <span style={{ fontSize: 11, color: T.orange,
                background: T.orange + "22", border: "1px solid " + T.orange + "44",
                borderRadius: 5, padding: "2px 8px" }}>
                🎲 Guess
              </span>
            )}
          </div>

          {/* My answer vs correct */}
          <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12 }}>
            <span>
              <span style={{ color: T.text3 }}>My answer: </span>
              <strong style={{ fontFamily: "monospace",
                color: item.result === "correct" ? T.green : T.red }}>
                {item.myAns}
              </strong>
            </span>
            <span>
              <span style={{ color: T.text3 }}>Correct: </span>
              <strong style={{ fontFamily: "monospace", color: T.green }}>{item.keyAns}</strong>
            </span>
          </div>

          {/* Topic tag — editable if syllabus + callback provided */}
          {syllabus && onUpdateTopicTag && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: T.text3, marginBottom: 4,
                textTransform: "uppercase", letterSpacing: "0.08em" }}>Topic Tag</div>
              <SearchSelect
                options={topicOpts}
                value={item.topicId || null}
                onChange={topicId => onUpdateTopicTag(item.paperId, item.qStr, topicId)}
                placeholder="Tag a topic..."
              />
            </div>
          )}

          {/* Question text */}
          {item.text ? (
            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.8,
              background: T.surface, borderRadius: 6, padding: "10px 12px",
              border: "1px solid " + T.border, marginBottom: 12, whiteSpace: "pre-wrap" }}>
              {item.text}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: T.text3, fontStyle: "italic",
              marginBottom: 12 }}>No question text stored.</div>
          )}

          {/* Options */}
          {Object.keys(item.options).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
              {["A","B","C","D"].filter(opt => item.options[opt]).map(opt => {
                const isMyAns   = item.myAns === opt;
                const isCorrect = item.keyAns === opt;
                const bg  = isCorrect ? T.green + "22" : isMyAns ? T.red + "22" : "transparent";
                const bdr = isCorrect ? T.green + "88" : isMyAns ? T.red + "88" : T.border;
                const col = isCorrect ? T.green : isMyAns ? T.red : T.text2;
                return (
                  <div key={opt} style={{ display: "flex", gap: 8, alignItems: "flex-start",
                    padding: "7px 10px", borderRadius: 6,
                    background: bg, border: "1px solid " + bdr }}>
                    <span style={{ fontWeight: 700, fontFamily: "monospace",
                      color: col, minWidth: 18, flexShrink: 0 }}>{opt}.</span>
                    <span style={{ fontSize: 13, color: col, lineHeight: 1.5, flex: 1 }}>
                      {item.options[opt]}
                    </span>
                    {isCorrect && <span style={{ color: T.green, fontSize: 11, flexShrink: 0 }}>✓</span>}
                    {isMyAns && !isCorrect && <span style={{ color: T.red, fontSize: 11, flexShrink: 0 }}>←</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Explanation */}
          <div style={{ fontSize: 11, color: T.text3, textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 6 }}>Explanation</div>
          <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.8,
            background: T.surface, borderRadius: 6, padding: "10px 12px",
            border: "1px solid " + T.border, whiteSpace: "pre-wrap" }}>
            {item.explanation ||
              <span style={{ color: T.text3, fontStyle: "italic" }}>No explanation stored.</span>}
          </div>

          {/* Prev / Next */}
          <div style={{ display: "flex", gap: 10, justifyContent: "center",
            alignItems: "center", paddingTop: 16 }}>
            <button onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={safeIdx <= 0}
              style={{ ...btnGhost, fontSize: 13, padding: "8px 20px",
                opacity: safeIdx <= 0 ? 0.4 : 1 }}>
              ← Prev
            </button>
            <span style={{ fontSize: 11, color: T.text3 }}>
              {safeIdx + 1} / {items.length}
            </span>
            <button onClick={() => setIdx(i => Math.min(items.length - 1, i + 1))}
              disabled={safeIdx >= items.length - 1}
              style={{ ...btnGhost, fontSize: 13, padding: "8px 20px",
                opacity: safeIdx >= items.length - 1 ? 0.4 : 1 }}>
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


/**
 * QuestionListViewer — generic question viewer that accepts a pre-built
 * items array. Used by single-paper Q-badge clicks, subject drilldowns,
 * and unattempted-by-subject rows.
 *
 * items: Array of { paperId, paperName, qStr, result, myAns, keyAns,
 *                   isGuess, text, options, explanation }
 * title: string shown in header
 */
function QuestionListViewer({ items, title, syllabus, onUpdateTopicTag, onClose }) {
  const [idx, setIdx] = useState(0);

  const safeIdx  = Math.min(idx, Math.max(0, items.length - 1));
  const item     = items[safeIdx];
  const topicOpts = syllabus ? buildTopicOptions(syllabus) : [];

  const qColor = (r) => {
    if (r === "correct")     return T.green;
    if (r === "wrong")       return T.red;
    if (r === "unattempted") return T.text3;
    if (r === "deleted")     return T.text3;
    return T.border2;
  };
  const qIcon = (r) => {
    if (r === "correct")     return "✓";
    if (r === "wrong")       return "✗";
    if (r === "unattempted") return "—";
    if (r === "deleted")     return "⊘";
    return "?";
  };

  if (items.length === 0) {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 1100,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }} onClick={onClose}>
        <div style={{ background: "#0d1117", borderRadius: 12, padding: 32,
          border: "1px solid " + T.border, textAlign: "center" }}
          onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 14, color: T.text, marginBottom: 12 }}>
            No question data available.
          </div>
          <button onClick={onClose} style={{ ...btnGhost, fontSize: 13 }}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1100,
      background: "rgba(0,0,0,0.7)",
      display: "flex", flexDirection: "column",
    }} onClick={onClose}>
      <div style={{
        background: "#0d1117", borderRadius: "16px 16px 0 0",
        marginTop: "auto", width: "100%", maxWidth: 600, alignSelf: "center",
        maxHeight: "88vh", display: "flex", flexDirection: "column",
        border: "1px solid " + T.border,
        boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "12px 16px 10px",
          borderBottom: "1px solid " + T.border, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between",
            alignItems: "flex-start", gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.text, lineHeight: 1.3 }}>
                {title}
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                {items.length} question{items.length !== 1 ? "s" : ""}
              </div>
            </div>
            <button onClick={onClose}
              style={{ ...btnGhost, padding: "4px 10px", fontSize: 13, flexShrink: 0 }}>✕</button>
          </div>
          {/* Scrollable Q pills */}
          <div style={{ display: "flex", gap: 5, overflowX: "auto",
            WebkitOverflowScrolling: "touch", marginTop: 10, paddingBottom: 4 }}>
            {items.map((it, i) => {
              const col = qColor(it.result);
              return (
                <button key={it.paperId + "_" + it.qStr + "_" + i}
                  onClick={() => setIdx(i)}
                  style={{
                    flexShrink: 0, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
                    border: "1px solid " + col + (safeIdx === i ? "ff" : "55"),
                    background: safeIdx === i ? col + "33" : "transparent",
                    color: col, fontSize: 11, fontWeight: safeIdx === i ? 700 : 400,
                  }}>
                  Q{it.qStr}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: "auto", padding: "14px 16px", flex: 1 }}>

          {/* Paper + result badge */}
          <div style={{ display: "flex", gap: 8, alignItems: "center",
            flexWrap: "wrap", marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: T.text3, background: T.surface,
              border: "1px solid " + T.border, borderRadius: 5, padding: "2px 8px" }}>
              Q{item.qStr} · {item.paperName}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: qColor(item.result),
              background: qColor(item.result) + "22",
              border: "1px solid " + qColor(item.result) + "44",
              borderRadius: 5, padding: "2px 8px" }}>
              {qIcon(item.result)} {item.result}
            </span>
            {item.isGuess && (
              <span style={{ fontSize: 11, color: T.orange,
                background: T.orange + "22", border: "1px solid " + T.orange + "44",
                borderRadius: 5, padding: "2px 8px" }}>
                🎲 Guess
              </span>
            )}
          </div>

          {/* My answer vs correct */}
          <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 12 }}>
            <span>
              <span style={{ color: T.text3 }}>My answer: </span>
              <strong style={{ fontFamily: "monospace",
                color: item.result === "correct" ? T.green : T.red }}>
                {item.myAns}
              </strong>
            </span>
            <span>
              <span style={{ color: T.text3 }}>Correct: </span>
              <strong style={{ fontFamily: "monospace", color: T.green }}>{item.keyAns}</strong>
            </span>
          </div>

          {/* Topic tag — editable if syllabus + callback provided */}
          {syllabus && onUpdateTopicTag && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: T.text3, marginBottom: 4,
                textTransform: "uppercase", letterSpacing: "0.08em" }}>Topic Tag</div>
              <SearchSelect
                options={topicOpts}
                value={item.topicId || null}
                onChange={topicId => onUpdateTopicTag(item.paperId, item.qStr, topicId)}
                placeholder="Tag a topic..."
              />
            </div>
          )}

          {/* Question text */}
          {item.text ? (
            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.8,
              background: T.surface, borderRadius: 6, padding: "10px 12px",
              border: "1px solid " + T.border, marginBottom: 12, whiteSpace: "pre-wrap" }}>
              {item.text}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: T.text3, fontStyle: "italic",
              marginBottom: 12 }}>No question text stored.</div>
          )}

          {/* Options */}
          {Object.keys(item.options || {}).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 12 }}>
              {["A","B","C","D"].filter(opt => item.options[opt]).map(opt => {
                const isMyAns   = item.myAns === opt;
                const isCorrect = item.keyAns === opt;
                const bg  = isCorrect ? T.green + "22" : isMyAns ? T.red + "22" : "transparent";
                const bdr = isCorrect ? T.green + "88" : isMyAns ? T.red + "88" : T.border;
                const col = isCorrect ? T.green : isMyAns ? T.red : T.text2;
                return (
                  <div key={opt} style={{ display: "flex", gap: 8, alignItems: "flex-start",
                    padding: "7px 10px", borderRadius: 6,
                    background: bg, border: "1px solid " + bdr }}>
                    <span style={{ fontWeight: 700, fontFamily: "monospace",
                      color: col, minWidth: 18, flexShrink: 0 }}>{opt}.</span>
                    <span style={{ fontSize: 13, color: col, lineHeight: 1.5, flex: 1 }}>
                      {item.options[opt]}
                    </span>
                    {isCorrect && <span style={{ color: T.green, fontSize: 11, flexShrink: 0 }}>✓</span>}
                    {isMyAns && !isCorrect && <span style={{ color: T.red, fontSize: 11, flexShrink: 0 }}>←</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Explanation */}
          <div style={{ fontSize: 11, color: T.text3, textTransform: "uppercase",
            letterSpacing: "0.08em", marginBottom: 6 }}>Explanation</div>
          <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.8,
            background: T.surface, borderRadius: 6, padding: "10px 12px",
            border: "1px solid " + T.border, whiteSpace: "pre-wrap" }}>
            {item.explanation ||
              <span style={{ color: T.text3, fontStyle: "italic" }}>No explanation stored.</span>}
          </div>

          {/* Prev / Next */}
          <div style={{ display: "flex", gap: 10, justifyContent: "center",
            alignItems: "center", paddingTop: 16 }}>
            <button onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={safeIdx <= 0}
              style={{ ...btnGhost, fontSize: 13, padding: "8px 20px",
                opacity: safeIdx <= 0 ? 0.4 : 1 }}>
              ← Prev
            </button>
            <span style={{ fontSize: 11, color: T.text3 }}>
              {safeIdx + 1} / {items.length}
            </span>
            <button onClick={() => setIdx(i => Math.min(items.length - 1, i + 1))}
              disabled={safeIdx >= items.length - 1}
              style={{ ...btnGhost, fontSize: 13, padding: "8px 20px",
                opacity: safeIdx >= items.length - 1 ? 0.4 : 1 }}>
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Analytics — full analytics view.
 * Subject averages, weak/strong split, guess strategy,
 * topic performance map, revision vs score correlation.
 */
function Analytics({ papers: _papers, syllabus: _syllabus, cutoff, onSetCutoff, allSyllabi, allPapers }) {
  const [dateFrom,    setDateFrom]    = useState("");
  const [dateTo,      setDateTo]      = useState("");
  const [analTip,     setAnalTip]     = useState(null);
  const [topicViewer, setTopicViewer] = useState(null); // topic object to drill into
  const [qViewer,     setQViewer]     = useState(null); // { items, title } for QuestionListViewer
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

  // ── Item builders for QuestionListViewer ─────────────────────────────────
  const buildTopicItems = (topicId) => {
    const items = [];
    for (const paper of papers) {
      const omr = paper.omr || {};
      const pq  = paper.computed?.perQuestion || {};
      const qs  = paper.questions || {};
      for (const qStr of Object.keys(omr).sort((a,b) => parseInt(a)-parseInt(b))) {
        if ((omr[qStr] || {}).topicId === topicId) {
          items.push({
            paperId: paper.id, paperName: paper.name || paper.code || "Paper",
            qStr, result: pq[qStr]?.result || "unattempted",
            myAns: omr[qStr]?.answer || "—", keyAns: pq[qStr]?.keyAns || "—",
            isGuess: omr[qStr]?.isGuess || false,
            topicId: (omr[qStr] || {}).topicId || null,
            text: (qs[qStr] || {}).text || "", options: (qs[qStr] || {}).options || {},
            explanation: (qs[qStr] || {}).explanation || "",
          });
        }
      }
    }
    return items;
  };

  const buildSubjectItems = (subject, unattemptedOnly = false, guessOnly = false) => {
    const range = subject.questionRange || {};
    const start = range.start || 1;
    const end   = range.end   || 5;
    const items = [];
    for (const paper of papers) {
      const omr = paper.omr || {};
      const pq  = paper.computed?.perQuestion || {};
      const qs  = paper.questions || {};
      for (let q = start; q <= end; q++) {
        const qStr    = String(q);
        const hasData = qStr in omr || qStr in pq;
        if (!hasData) continue;
        const result   = pq[qStr]?.result || "unattempted";
        const isGuessQ = (omr[qStr] || {}).isGuess || false;
        if (unattemptedOnly && result !== "unattempted") continue;
        if (guessOnly && !isGuessQ) continue;
        items.push({
          paperId: paper.id, paperName: paper.name || paper.code || "Paper",
          qStr, result,
          myAns: (omr[qStr] || {}).answer || "—", keyAns: pq[qStr]?.keyAns || "—",
          isGuess: isGuessQ,
          topicId: (omr[qStr] || {}).topicId || null,
          text: (qs[qStr] || {}).text || "", options: (qs[qStr] || {}).options || {},
          explanation: (qs[qStr] || {}).explanation || "",
        });
      }
    }
    return items;
  };

  const buildSingleQItem = (paper, qStr) => {
    const omr = paper.omr || {};
    const pq  = paper.computed?.perQuestion || {};
    const qs  = paper.questions || {};
    return [{
      paperId: paper.id, paperName: paper.name || paper.code || "Paper",
      qStr, result: pq[qStr]?.result || "unattempted",
      myAns: (omr[qStr] || {}).answer || "—", keyAns: pq[qStr]?.keyAns || "—",
      isGuess: (omr[qStr] || {}).isGuess || false,
      topicId: (omr[qStr] || {}).topicId || null,
      text: (qs[qStr] || {}).text || "", options: (qs[qStr] || {}).options || {},
      explanation: (qs[qStr] || {}).explanation || "",
    }];
  };

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
    // totalQ = all questions in subject range across papers (including unattempted)
    // matches what buildSubjectItems returns so "from X questions" is consistent
    const range  = s.questionRange || {};
    const qStart = range.start || 1;
    const qEnd   = range.end   || s.maxMarks;
    const totalQ = filtered.reduce((acc, p) => {
      const omr = p.omr || {};
      const pq  = p.computed?.perQuestion || {};
      let cnt = 0;
      for (let q = qStart; q <= qEnd; q++) {
        const qStr = String(q);
        if ((qStr in omr || qStr in pq) && pq[qStr]?.result !== "deleted") cnt++;
      }
      return acc + cnt;
    }, 0);
    return { ...s, avg, avgPct: pct(avg, s.maxMarks), totalQ };
  });

  // ── 2. Topic performance — computed LIVE from omr tags so changes to topic
  //    tags are reflected immediately without needing to recalculate score.
  const topicStats = {};
  for (const paper of filtered) {
    const omr = paper.omr || {};
    const pq  = paper.computed?.perQuestion || {};
    for (const [qStr, entry] of Object.entries(omr)) {
      const tid = entry?.topicId;
      if (!tid) continue;
      if (!topicStats[tid]) topicStats[tid] = { correct: 0, wrong: 0, total: 0 };
      const result = pq[qStr]?.result;
      // Count ALL tagged questions toward total (matches viewer count)
      // Only skip deleted questions from total
      if (result === "deleted") continue;
      topicStats[tid].total++;
      if (result === "correct") topicStats[tid].correct++;
      else if (result === "wrong") topicStats[tid].wrong++;
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
        const ngWrong    = Object.keys(pq).filter(q => pq[q].result==="wrong"       && !pq[q].isGuess).map(Number).sort((a,b)=>a-b);
        const gWrong     = Object.keys(pq).filter(q => pq[q].result==="wrong"       &&  pq[q].isGuess).map(Number).sort((a,b)=>a-b);
        const ngCorrect  = Object.keys(pq).filter(q => pq[q].result==="correct"     && !pq[q].isGuess).length;
        const gCorrect   = Object.keys(pq).filter(q => pq[q].result==="correct"     &&  pq[q].isGuess).length;
        // Unattempted: explicitly marked unattempted OR any Q 1-100 not in perQuestion
        const unattemptedQs = Array.from({length:100},(_,i)=>i+1).filter(q => {
          const entry = pq[String(q)];
          return !entry || entry.result === "unattempted" || entry.result == null;
        }).sort((a,b)=>a-b);

        // Guess totals from bySubject
        let ffC=0,ffW=0,wgC=0,wgW=0;
        for (const bs of Object.values(sp.computed?.bySubject||{})) {
          ffC+=bs.ffCorrect||0; ffW+=bs.ffWrong||0;
          wgC+=bs.wildCorrect||0; wgW+=bs.wildWrong||0;
        }
        const ffNet = ffC - ffW*neg;
        const wgNet = wgC - wgW*neg;

        const QBadges = ({qs, color, paper}) => qs.length===0 ? (
          <span style={{fontSize:11,color:T.text3}}>None</span>
        ) : (
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
            {qs.map(q=>(
              <button key={q}
                onClick={() => {
                  const items = buildSingleQItem(paper, String(q));
                  setQViewer({ items, title: "Q" + q + " · " + (paper.name || paper.code || "Paper") });
                }}
                style={{
                  fontSize:11,fontFamily:"monospace",fontWeight:700,
                  color,background:color+"18",
                  border:"1px solid "+color+"44",
                  borderRadius:4,padding:"2px 6px",
                  cursor:"pointer",
                }}>{"Q"+q}</button>
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
                      <QBadges qs={ngWrong} color={T.red} paper={sp} />
                    </div>
                    {(ffC+ffW+wgC+wgW)>0 && (
                      <div>
                        <div style={{fontSize:11,color:T.text3,marginBottom:4}}>
                          {"By guessing — "+gWrong.length+" wrong"}
                        </div>
                        <QBadges qs={gWrong} color={T.orange} paper={sp} />
                      </div>
                    )}
                    {unattemptedQs.length > 0 && (
                      <div style={{marginTop:12}}>
                        <div style={{fontSize:11,color:T.text3,marginBottom:4}}>
                          {"Unattempted — "+unattemptedQs.length+" questions"}
                        </div>
                        <QBadges qs={unattemptedQs} color={T.text3} paper={sp} />
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
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <div style={{
                display: "flex", alignItems: "flex-end", gap: 4, height: 100,
                position: "relative", minWidth: byDate.length * 44 + "px",
              }}>
                {byDate.map((p, i) => {
                  const sc     = p.computed?.totalMarks ?? 0;
                  const maxSc  = Math.max(...byDate.map(x => x.computed?.totalMarks ?? 0), 1);
                  const h      = Math.max(6, (sc / maxSc) * 80);
                  const col    = scoreColor(pct(sc, 100));
                  return (
                    <div key={p.id}
                      onClick={e => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setAnalTip({ id: p.id, name: p.name || p.code || ("Paper " + (i+1)),
                          sc: sc, x: rect.left + rect.width / 2, y: rect.top });
                        clearTimeout(window.__analTipTimer);
                        window.__analTipTimer = setTimeout(() => setAnalTip(null), 2000);
                      }}
                      style={{ flex: "0 0 40px", display: "flex", flexDirection: "column",
                        alignItems: "center", gap: 3, cursor: "pointer" }}>
                      <div style={{ width: "100%", height: h,
                        background: (analTip?.id === p.id) ? col : col + "88",
                        borderRadius: "3px 3px 0 0",
                        border: "1px solid " + col }} />
                      <span style={{ fontSize: 8, color: T.text3, width: 40,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>
                        {p.name || ("P" + (i + 1))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
        </div>
        {/* Fixed tooltip — outside scroll container */}
        {analTip && (
          <div style={{
            position: "fixed",
            left: Math.min(analTip.x, window.innerWidth - 190),
            top: Math.max(analTip.y - 54, 60),
            transform: "translateX(-50%)",
            background: "#1c2333", border: "1px solid " + T.border,
            borderRadius: 7, padding: "7px 12px", zIndex: 2000,
            whiteSpace: "nowrap", fontSize: 12, color: T.text,
            boxShadow: "0 4px 16px rgba(0,0,0,0.7)",
            pointerEvents: "none",
          }}>
            <div style={{ fontWeight: 700, color: scoreColor(pct(analTip.sc, 100)),
              fontFamily: "monospace", fontSize: 14, marginBottom: 2 }}>
              {analTip.sc.toFixed(2)}<span style={{ fontSize: 10, color: T.text3 }}>/100</span>
            </div>
            <div style={{ color: T.text2 }}>{analTip.name}
            </div>
          </div>
        )}
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
                    <tr key={s.id}
                      onClick={() => {
                        const items = buildSubjectItems(s, false, true);
                        setQViewer({ items, title: s.name + " — Guesswork Questions" });
                      }}
                      style={{ borderBottom: "1px solid " + T.border, cursor: "pointer" }}>
                      <td style={{ padding: "7px 8px", color: T.accent2, fontSize: 12,
                        fontWeight: 600 }}>{s.name}</td>
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
            {[...unattempted].sort((a, b) => b.avgUn - a.avgUn).map(s => {
              const sylSubj = syllabus.subjects.find(ss => ss.id === s.id);
              return (
                <div key={s.id}
                  onClick={() => {
                    if (sylSubj) {
                      const items = buildSubjectItems(sylSubj, true);
                      setQViewer({ items, title: s.name + " — Unattempted Questions" });
                    }
                  }}
                  style={{ display: "grid",
                    gridTemplateColumns: "1fr 1fr 70px", gap: 10, alignItems: "center",
                    cursor: sylSubj ? "pointer" : "default",
                    padding: "4px 6px", borderRadius: 6,
                  }}>
                  <span style={{ fontSize: 12, color: T.text2 }}>{s.name}</span>
                  <Bar value={s.avgUn} max={s.maxMarks} height={8} />
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: T.orange, textAlign: "right" }}>
                    {s.avgUn.toFixed(1)}/{s.maxMarks}
                  </span>
                </div>
              );
            })}
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
                      <div key={t.id}
                        onClick={() => setTopicViewer(t)}
                        style={{ display: "grid",
                          gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center",
                          padding: "6px 10px", borderRadius: 6, cursor: "pointer",
                          background: T.surface, border: "1px solid " + T.border,
                          transition: "border-color 0.15s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.borderColor = T.cyan + "88"}
                        onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
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

      {/* ── Topic Question Viewer (topic performance section) ── */}
      {topicViewer && (
        <TopicQuestionViewer
          topic={topicViewer}
          papers={papers}
          syllabus={syllabus}
          onClose={() => setTopicViewer(null)}
        />
      )}

      {/* ── Generic Question List Viewer (badges, subjects, unattempted) ── */}
      {qViewer && (
        <QuestionListViewer
          items={qViewer.items}
          title={qViewer.title}
          syllabus={syllabus}
          onUpdateTopicTag={(paperId, qStr, topicId) => {
            // Update omr in the correct paper and persist silently
            const targetPaper = papers.find(p => p.id === paperId);
            if (!targetPaper) return;
            const newOMR = { ...targetPaper.omr };
            newOMR[qStr] = { ...(newOMR[qStr] || {}), topicId };
            // Use window.__pscAutoSync for persistence (same pattern as QuestionViewer)
            const updatedPaper = { ...targetPaper, omr: newOMR };
            // Dispatch to App via custom event so App can call handleSavePaperSilent
            window.dispatchEvent(new CustomEvent("psc-topic-tag-update",
              { detail: { paper: updatedPaper } }));
          }}
          onClose={() => setQViewer(null)}
        />
      )}

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
                  <div key={s.id}
                    onClick={() => {
                      const sylSubj = syllabus.subjects.find(ss => ss.id === s.id);
                      if (sylSubj) {
                        const items = buildSubjectItems(sylSubj);
                        setQViewer({ items, title: s.name + " — All Questions" });
                      }
                    }}
                    style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer",
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
                  <div key={t.id}
                    onClick={() => {
                      const items = buildTopicItems(t.id);
                      const lbl = (t.topicNo ? "[" + t.topicNo + "] " : "") + t.name;
                      setQViewer({ items, title: lbl });
                    }}
                    style={{ padding: "10px 12px", borderRadius: 8, cursor: "pointer",
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
  const [modal,        setModal]       = useState(null);
  const [skipReason,   setSkipReason]  = useState(null);
  const [showSignInBanner, setShowSignInBanner] = useState(false);
  const { toasts, showToast }          = useToast();

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

      // ── Check URL params for skip reason (opened via notification "No" action) ──
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("skipReason") === "1") {
          const ts = parseInt(params.get("ts") || "0") || Date.now();
          setSkipReason({ timestamp: ts });
          // Clean URL so refreshing doesn't re-trigger
          window.history.replaceState({}, "", window.location.pathname);
          setPage("study");
        }
      } catch {}

      // ── Post alarms to SW ──────────────────────────────────────────────────
      try {
        const alarms     = JSON.parse(localStorage.getItem("psc-reminders") || "[]");
        const firedToday = JSON.parse(localStorage.getItem("psc-notif-fired") || "{}");
        navigator.serviceWorker?.controller?.postMessage({
          type: "SET_ALARMS", alarms, firedToday, userName: "Sachin",
        });
      } catch {}

      // ── Show sign-in banner if not signed in (session-based) ─────────────
      const hasToken  = !!sessionStorage.getItem("psc-google-token");
      const dismissed = !!sessionStorage.getItem("psc-banner-dismissed");
      if (!hasToken && !dismissed) {
        setShowSignInBanner(true);
      }
    })();
  }, []);

  // Listen for in-app reminder event (when notification permission not granted)
  useEffect(() => {
    const handler = (e) => {
      setSkipReason({ timestamp: e.detail?.timestamp || Date.now() });
      setPage("study");
    };
    window.addEventListener("psc-in-app-reminder", handler);
    return () => window.removeEventListener("psc-in-app-reminder", handler);
  }, []);

  // Listen for topic tag updates from QuestionListViewer inside Analytics
  useEffect(() => {
    const handler = (e) => {
      const updatedPaper = e.detail?.paper;
      if (!updatedPaper) return;
      handleSavePaperSilent(updatedPaper);
    };
    window.addEventListener("psc-topic-tag-update", handler);
    return () => window.removeEventListener("psc-topic-tag-update", handler);
  }, []);

  // Listen for SW messages (skip reason trigger from notification)
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === "SHOW_SKIP_REASON") {
        setSkipReason({ timestamp: e.data.timestamp || Date.now() });
        setPage("study");
      }
    };
    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, []);

  // Also listen for custom event from StudyReminders component
  useEffect(() => {
    const handler = (e) => {
      setSkipReason({ timestamp: e.detail?.timestamp || Date.now() });
      setPage("study");
    };
    window.addEventListener("psc-skip-reason", handler);
    return () => window.removeEventListener("psc-skip-reason", handler);
  }, []);

  // ── Persistent reminder interval — runs on ALL tabs, always ──────────────
  // Lives in App root so it is never unmounted when user switches tabs.
  // Checks every 60 seconds and fires notification if any alarm matches.
  useEffect(() => {
    checkRemindersNow(); // check immediately on mount (catches missed alarms)
    const id = setInterval(checkRemindersNow, 60000);
    return () => clearInterval(id);
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
    (updSyl) => {
      saveSyllabi(syllabi.map(s => s.id === updSyl.id ? updSyl : s));
      autoSync();
    }
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
    autoSync();
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
    autoSync();
  };

  // Silent save — persists to IndexedDB without closing the modal or navigating
  const handleSavePaperSilent = async (paper) => {
    const upd = papers.find(p => p.id === paper.id)
      ? papers.map(p => p.id === paper.id ? paper : p)
      : [...papers, paper];
    await savePapers(upd);
    showToast("Score saved ✓");
    window.__pscAutoSync?.();
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
            onSaveLog={(date, topicIds) => { saveLog(date, topicIds); autoSync(); }}
            onDeleteLog={deleteLog}
            onUpdateRevision={(tid, delta) => { updateRevision(tid, delta); autoSync(); }}
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
          onSaveSilent={handleSavePaperSilent}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "editPaper" && activeSyl && (
        <PaperForm
          syllabus={activeSyl}
          initial={modal.paper}
          onSave={handleSavePaper}
          onSaveSilent={handleSavePaperSilent}
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
          onSaveSilent={handleSavePaperSilent}
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

      {/* Sign-in banner — shown when not signed in to Google Drive */}
      {showSignInBanner && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 300,
          background: T.accent + "ee", color: "#000",
          padding: "10px 16px",
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            ☁ Sign in to Google Drive to back up your data
          </span>
          <button
            onClick={() => { setPage("sync"); setShowSignInBanner(false); }}
            style={{ fontSize: 12, fontWeight: 700, padding: "5px 14px",
              background: "#000", color: "#fff", border: "none",
              borderRadius: 6, cursor: "pointer" }}>
            Sign In
          </button>
          <button
            onClick={() => {
              sessionStorage.setItem("psc-banner-dismissed", "1");
              setShowSignInBanner(false);
            }}
            style={{ fontSize: 18, background: "transparent", border: "none",
              cursor: "pointer", color: "#000", padding: "0 4px" }}>
            ✕
          </button>
        </div>
      )}

      {/* Skip Reason Modal — shown when user taps No on notification */}
      {skipReason && (
        <SkipReasonModal
          timestamp={skipReason.timestamp}
          onClose={() => setSkipReason(null)}
        />
      )}
    </div>
  );
}
