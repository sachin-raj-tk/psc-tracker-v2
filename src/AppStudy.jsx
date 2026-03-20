/**
 * AppStudy.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Study Tracker module for PSC Tracker.
 * Contains:
 *   - StudyLogPanel     — daily topic study logging
 *   - RevisionCounter   — per-topic revision tracking with +/− buttons
 *   - StreakPanel        — streak display, badges, weekly summary
 *   - useStudyTracker   — hook that manages all study state + persistence
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  T, inputStyle, btnPrimary, btnGhost, cardStyle,
  uid, todayStr, fmtDate, matchSearch,
  Bar, Badge, Section, Modal, FieldError, ConfirmDialog,
  DB, KEYS,
} from "./AppCore";

// ═══════════════════════════════════════════════════════════════════════════════
// useStudyTracker — central hook for all study tracker state
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Manages study logs, revision counts (stored inside syllabus topics),
 * and streak calculation for a given syllabus.
 *
 * @param {object} syllabus - active syllabus object
 * @param {function} onUpdateSyllabus - called with updated syllabus when revision counts change
 * @returns study tracker state and actions
 */
export function useStudyTracker(syllabus, onUpdateSyllabus) {
  const [logs,    setLogs]    = useState([]);  // StudyLog[]
  const [streak,  setStreak]  = useState(null); // StreakData
  const [loading, setLoading] = useState(true);

  // Load from storage
  useEffect(() => {
    if (!syllabus?.id) return;
    (async () => {
      const allLogs   = (await DB.get(KEYS.STUDY_LOGS)) || [];
      const allStreaks = (await DB.get(KEYS.STREAKS))    || {};
      setLogs(allLogs.filter(l => l.syllabusId === syllabus.id));
      setStreak(allStreaks[syllabus.id] || {
        syllabusId:    syllabus.id,
        currentStreak: 0,
        bestStreak:    0,
        lastStudyDate: null,
        badges:        {},
      });
      setLoading(false);
    })();
  }, [syllabus?.id]);

  /**
   * Save a study log entry for a given date.
   * If an entry already exists for that date, it is replaced.
   * Updates streak based on consecutive days.
   */
  const saveLog = useCallback(async (date, topicIds) => {
    const allLogs = (await DB.get(KEYS.STUDY_LOGS)) || [];

    // Remove existing entry for same date + syllabus
    const filtered = allLogs.filter(l => !(l.syllabusId === syllabus.id && l.date === date));
    const newEntry = { id: uid(), syllabusId: syllabus.id, date, topicsStudied: topicIds };
    const updated  = [...filtered, newEntry].sort((a, b) => b.date.localeCompare(a.date));

    await DB.set(KEYS.STUDY_LOGS, updated);
    setLogs(updated.filter(l => l.syllabusId === syllabus.id));

    // Recalculate streak
    await recalcStreak(updated.filter(l => l.syllabusId === syllabus.id));
  }, [syllabus?.id]);

  /**
   * Delete a study log entry by id.
   */
  const deleteLog = useCallback(async (logId) => {
    const allLogs = (await DB.get(KEYS.STUDY_LOGS)) || [];
    const updated = allLogs.filter(l => l.id !== logId);
    await DB.set(KEYS.STUDY_LOGS, updated);
    setLogs(updated.filter(l => l.syllabusId === syllabus.id));
    await recalcStreak(updated.filter(l => l.syllabusId === syllabus.id));
  }, [syllabus?.id]);

  /**
   * Increment or decrement the revision count for a specific topic.
   * Updates the syllabus in storage and calls onUpdateSyllabus.
   * @param {string} topicId
   * @param {number} delta - +1 or -1
   */
  const updateRevision = useCallback(async (topicId, delta) => {
    const updatedSubjects = syllabus.subjects.map(s => ({
      ...s,
      topics: s.topics.map(t => {
        if (t.id !== topicId) return t;
        const newCount = Math.max(0, (t.revisionCount || 0) + delta);
        return {
          ...t,
          revisionCount:   newCount,
          lastRevisedDate: delta > 0 ? todayStr() : t.lastRevisedDate,
        };
      }),
    }));
    const updatedSyllabus = { ...syllabus, subjects: updatedSubjects };
    onUpdateSyllabus(updatedSyllabus);

    // Also check "all topics revised" badge
    const allRevised = updatedSubjects.every(s => s.topics.every(t => t.revisionCount > 0));
    if (allRevised) {
      await awardBadge("allTopicsRevised");
    }
  }, [syllabus, onUpdateSyllabus]);

  /**
   * Recalculate the current and best streak from the log list.
   * A streak is consecutive calendar days with at least one log entry.
   */
  const recalcStreak = useCallback(async (syllabusLogs) => {
    const allStreaks = (await DB.get(KEYS.STREAKS)) || {};
    const existing  = allStreaks[syllabus.id] || { currentStreak: 0, bestStreak: 0, lastStudyDate: null, badges: {} };

    // Get sorted unique dates studied
    const dates = [...new Set(syllabusLogs.map(l => l.date))].sort().reverse();
    if (dates.length === 0) {
      const updated = { ...existing, currentStreak: 0 };
      allStreaks[syllabus.id] = updated;
      await DB.set(KEYS.STREAKS, allStreaks);
      setStreak(updated);
      return;
    }

    const today = todayStr();
    let current = 0;
    let check   = today;

    // Count backwards from today
    for (const date of dates) {
      if (date === check) {
        current++;
        // Go back one day
        const d = new Date(check);
        d.setDate(d.getDate() - 1);
        check = d.getFullYear() + "-" +
          String(d.getMonth() + 1).padStart(2, "0") + "-" +
          String(d.getDate()).padStart(2, "0");
      } else if (date < check) {
        break;
      }
    }

    const best    = Math.max(existing.bestStreak || 0, current);
    const badges  = { ...existing.badges };

    if (current >= 7)  badges.sevenDay   = true;
    if (current >= 30) badges.thirtyDay  = true;

    const updated = { ...existing, currentStreak: current, bestStreak: best, lastStudyDate: dates[0], badges };
    allStreaks[syllabus.id] = updated;
    await DB.set(KEYS.STREAKS, allStreaks);
    setStreak(updated);
  }, [syllabus?.id]);

  /** Award a specific badge */
  const awardBadge = useCallback(async (badgeKey) => {
    const allStreaks = (await DB.get(KEYS.STREAKS)) || {};
    const existing  = allStreaks[syllabus.id] || {};
    if (existing.badges?.[badgeKey]) return; // already awarded
    const updated = { ...existing, badges: { ...(existing.badges || {}), [badgeKey]: true } };
    allStreaks[syllabus.id] = updated;
    await DB.set(KEYS.STREAKS, allStreaks);
    setStreak(prev => ({ ...prev, badges: updated.badges }));
  }, [syllabus?.id]);

  return { logs, streak, loading, saveLog, deleteLog, updateRevision };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDY HEATMAP — 26-week contribution calendar
// ═══════════════════════════════════════════════════════════════════════════════

function heatColor(count) {
  if (count === 0) return "#1a1f2e";
  if (count === 1) return "#2d3a6b";
  if (count <= 3)  return "#3d52b8";
  if (count <= 6)  return "#5b73e8";
  return "#f59e0b";
}

/**
 * StudyHeatmap — 26-week contribution grid.
 * Columns = weeks (oldest left, newest right).
 * Rows = Mon(0)...Sun(6). Tap a cell to see day detail.
 */
export function StudyHeatmap({ logs }) {
  const [tooltip, setTooltip] = useState(null); // {date, count, topics, rectTop, rectLeft}

  // Build date -> {count, topics[]} map from logs
  const logMap = {};
  (logs || []).forEach(l => {
    if (l.date) {
      logMap[l.date] = {
        count:  (l.topicsStudied || []).length,
        topics: l.topicsStudied || [],
      };
    }
  });

  // Generate 26 weeks of dates — oldest first
  const WEEKS = 26;
  const totalDays = WEEKS * 7;

  // Use local date to avoid UTC offset bug (toISOString() returns UTC,
  // which can be yesterday in IST/UTC+ timezones at night/morning)
  const localDateStr = (d) => {
    const yr  = d.getFullYear();
    const mo  = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return yr + "-" + mo + "-" + day;
  };
  const todayDate = new Date();
  const todayISO  = localDateStr(todayDate);

  // grid[col][row] = local date string
  const allDates = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(todayDate.getDate() - i);
    allDates.push(localDateStr(d));
  }
  const grid = [];
  for (let col = 0; col < WEEKS; col++) {
    grid.push(allDates.slice(col * 7, col * 7 + 7));
  }

  // Month labels: show when month changes, min 3 cols gap
  const monthLabels = {};
  let prevLabelCol = -4;
  for (let col = 0; col < WEEKS; col++) {
    const thisMonth = grid[col][0].slice(5, 7);
    const prevMonth = col > 0 ? grid[col - 1][0].slice(5, 7) : null;
    if (thisMonth !== prevMonth && col - prevLabelCol >= 3) {
      const dt = new Date(grid[col][0] + "T00:00:00");
      monthLabels[col] = dt.toLocaleDateString("en-IN", { month: "short" });
      prevLabelCol = col;
    }
  }

  const CELL = 11; // px per cell
  const GAP  = 2;  // px gap

  // Day labels Mon-Sun
  const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

  // Total days studied
  const daysStudied = Object.values(logMap).filter(v => v.count > 0).length;

  const handleCellClick = (e, dateStr) => {
    const entry = logMap[dateStr];
    const rect  = e.currentTarget.getBoundingClientRect();
    setTooltip({
      date:   dateStr,
      count:  entry ? entry.count : 0,
      topics: entry ? entry.topics : [],
      top:    rect.top + window.scrollY,
      left:   rect.left,
    });
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 12 }}>
        Study Activity
      </div>

      {/* Scrollable grid */}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 4 }}
        onClick={() => setTooltip(null)}>

        {/* Month labels row */}
        <div style={{ display: "flex", marginBottom: 4, marginLeft: 18 }}>
          {grid.map((_, col) => (
            <div key={col} style={{
              width: CELL + GAP,
              fontSize: 9, color: T.text3,
              flexShrink: 0, textAlign: "left",
            }}>
              {monthLabels[col] || ""}
            </div>
          ))}
        </div>

        {/* Grid rows */}
        <div style={{ display: "flex", gap: 0 }}>
          {/* Day labels */}
          <div style={{ display: "flex", flexDirection: "column",
            gap: GAP, marginRight: 4, flexShrink: 0 }}>
            {DAY_LABELS.map((d, i) => (
              <div key={i} style={{
                width: 12, height: CELL,
                fontSize: 8, color: T.text3,
                display: "flex", alignItems: "center",
              }}>{i % 2 === 0 ? d : ""}</div>
            ))}
          </div>

          {/* Week columns */}
          {grid.map((week, col) => (
            <div key={col} style={{
              display: "flex", flexDirection: "column",
              gap: GAP, marginRight: GAP, flexShrink: 0,
            }}>
              {week.map((dateStr, row) => {
                const entry   = logMap[dateStr];
                const count   = entry ? entry.count : 0;
                const isToday = dateStr === todayISO;
                const isFuture = dateStr > todayISO;
                return (
                  <div key={row}
                    onClick={e => { e.stopPropagation(); if (!isFuture) handleCellClick(e, dateStr); }}
                    style={{
                      width: CELL, height: CELL,
                      borderRadius: 2,
                      background: isFuture ? "transparent" : heatColor(count),
                      outline: isToday ? "1.5px solid " + T.accent2 : "none",
                      outlineOffset: "1px",
                      cursor: isFuture ? "default" : "pointer",
                      flexShrink: 0,
                      transition: "transform 0.1s",
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend + stats */}
      <div style={{ display: "flex", alignItems: "center",
        gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {[[0,"0"],[1,"1"],[2,"2-3"],[4,"4-6"],[7,"7+"]].map(([n, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <div style={{ width: CELL, height: CELL, borderRadius: 2,
                background: heatColor(n) }} />
              <span style={{ fontSize: 9, color: T.text3 }}>{label}</span>
            </div>
          ))}
        </div>
        <span style={{ fontSize: 10, color: T.text3, marginLeft: "auto" }}>
          {daysStudied + " day" + (daysStudied !== 1 ? "s" : "") + " studied"}
        </span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: "fixed",
          top: Math.min(tooltip.top - 80, window.innerHeight - 120),
          left: Math.min(tooltip.left, window.innerWidth - 200),
          zIndex: 500,
          background: T.surface,
          border: "1px solid " + T.border,
          borderRadius: 8, padding: "10px 14px",
          fontSize: 11, color: T.text2,
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          maxWidth: 200,
          pointerEvents: "none",
        }}>
          <div style={{ fontWeight: 700, color: T.text, marginBottom: 4 }}>
            {new Date(tooltip.date + "T00:00:00").toLocaleDateString("en-IN", {
              weekday: "short", day: "numeric", month: "short", year: "numeric"
            })}
          </div>
          {tooltip.count === 0 ? (
            <div style={{ color: T.text3 }}>No study logged</div>
          ) : (
            <div>
              <div style={{ color: T.accent2, marginBottom: 3 }}>
                {tooltip.count + " topic" + (tooltip.count !== 1 ? "s" : "") + " studied"}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUICK LOG PANEL — one-tap daily check-in for Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * QuickLogPanel — minimal study check-in for Dashboard.
 * If already logged today: shows a green confirmation card.
 * If not: shows "Did you study today?" with a topic picker and confirm button.
 */
export function QuickLogPanel({ syllabus, logs, onSaveLog }) {
  // Use local date string to avoid UTC offset bug in IST timezone
  const _td = new Date();
  const todayISO = _td.getFullYear() + "-" +
    String(_td.getMonth() + 1).padStart(2, "0") + "-" +
    String(_td.getDate()).padStart(2, "0");
  const todayLog = (logs || []).find(l => l.date === todayISO);

  const [showPicker, setShowPicker]   = useState(false);
  const [selected,   setSelected]     = useState([]);
  const [search,     setSearch]       = useState("");
  const [saving,     setSaving]       = useState(false);

  // All topics flattened from syllabus
  const allTopics = (syllabus?.subjects || []).flatMap(s =>
    s.topics.map(t => ({ ...t, subjectName: s.name }))
  );

  const visible = search
    ? allTopics.filter(t => matchSearch(t.name + " " + t.subjectName, search))
    : allTopics;

  const toggle = (id) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleConfirm = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    await onSaveLog({ date: todayISO, topicsStudied: selected, notes: "" });
    setShowPicker(false);
    setSelected([]);
    setSearch("");
    setSaving(false);
  };

  // Already logged today
  if (todayLog) {
    return (
      <div style={{ ...cardStyle, marginBottom: 16,
        borderLeft: "4px solid " + T.green, background: T.green + "0a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>✅</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.green }}>
              Studied today!
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
              {todayLog.topicsStudied.length + " topic" +
               (todayLog.topicsStudied.length !== 1 ? "s" : "") + " logged"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Picker open
  if (showPicker) {
    return (
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>
          What did you study today?
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search topics..."
          style={{ ...inputStyle, marginBottom: 10, fontSize: 12 }} />
        <div style={{ maxHeight: 200, overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
          {visible.map(t => (
            <div key={t.id}
              onClick={() => toggle(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "7px 10px", borderRadius: 6, cursor: "pointer",
                background: selected.includes(t.id) ? T.accent + "22" : T.surface,
                border: "1px solid " + (selected.includes(t.id) ? T.accent : T.border),
              }}>
              <div style={{
                width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                background: selected.includes(t.id) ? T.accent : "transparent",
                border: "2px solid " + (selected.includes(t.id) ? T.accent : T.border2),
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {selected.includes(t.id) && (
                  <span style={{ fontSize: 10, color: "#fff" }}>✓</span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: T.text }}>
                  {t.topicNo
                    ? <span style={{ fontSize: 10, color: T.text3, marginRight: 5,
                        fontFamily: "monospace" }}>{"[" + t.topicNo + "]"}</span>
                    : null}
                  {t.name}
                </div>
                <div style={{ fontSize: 10, color: T.text3 }}>{t.subjectName}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: T.text3 }}>
            {selected.length + " selected"}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => { setShowPicker(false); setSelected([]); setSearch(""); }}
              style={btnGhost}>Cancel</button>
            <button onClick={handleConfirm} disabled={selected.length === 0 || saving}
              style={{
                ...btnPrimary(T.accent),
                opacity: selected.length === 0 ? 0.5 : 1,
              }}>
              {saving ? "Saving…" : "Log " + (selected.length > 0 ? selected.length + " topics" : "Study")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Default: prompt card
  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 3 }}>
            📅 Did you study today?
          </div>
          <div style={{ fontSize: 11, color: T.text3 }}>
            Log your topics to keep your streak alive
          </div>
        </div>
        <button onClick={() => setShowPicker(true)}
          style={{ ...btnPrimary(T.green), fontSize: 12, padding: "8px 16px",
            flexShrink: 0, marginLeft: 12 }}>
          ✓ Log Study
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAK PANEL
// ═══════════════════════════════════════════════════════════════════════════════

/** Badge definitions — label, icon, description, condition key */
const BADGE_DEFS = [
  { key: "sevenDay",        icon: "🔥",  label: "7-Day Streak",           desc: "Study 7 consecutive days" },
  { key: "thirtyDay",       icon: "🔥🔥", label: "30-Day Streak",          desc: "Study 30 consecutive days" },
  { key: "allTopicsRevised",icon: "📚",  label: "Full Coverage",          desc: "Revise all topics at least once" },
  { key: "beatAverage",     icon: "🎯",  label: "Beat Your Average",      desc: "Score above your previous average" },
  { key: "fivePapers",      icon: "⚡",  label: "5 Papers",               desc: "Enter 5 paper results" },
  { key: "aboveCutoff",     icon: "🏆",  label: "Above Cutoff",           desc: "Score above the set cutoff" },
];

/**
 * StreakPanel — shows current streak, best streak, weekly summary, and badges.
 */
export function StreakPanel({ streak, logs, syllabus }) {
  if (!streak) return null;

  // Weekly stats — logs from the past 7 days
  const today  = new Date(todayStr());
  const week   = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    // Use local date string to avoid UTC offset issues in IST timezone
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  });

  const logsThisWeek = logs.filter(l => week.includes(l.date));
  const uniqueTopicsThisWeek = new Set(logsThisWeek.flatMap(l => l.topicsStudied)).size;
  const daysThisWeek = new Set(logsThisWeek.map(l => l.date)).size;

  const earnedBadges = BADGE_DEFS.filter(b => streak.badges?.[b.key]);
  const pendingBadges = BADGE_DEFS.filter(b => !streak.badges?.[b.key]);

  return (
    <div>
      {/* Streak counters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Current Streak", value: streak.currentStreak, unit: "days", color: streak.currentStreak >= 7 ? T.orange : T.text },
          { label: "Best Streak",    value: streak.bestStreak,    unit: "days", color: T.yellow },
          { label: "Last Studied",   value: streak.lastStudyDate ? fmtDate(streak.lastStudyDate) : "Never", unit: "", color: T.text2 },
        ].map(k => (
          <div key={k.label} style={{ ...cardStyle, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>{k.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: k.color, fontFamily: "monospace" }}>
              {k.value}{k.unit && <span style={{ fontSize: 12, color: T.text3 }}> {k.unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* ── Study Heatmap — 26 weeks ── */}
      <StudyHeatmap logs={logs} />

      {/* Earned badges */}
      {earnedBadges.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 12 }}>Earned Badges</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {earnedBadges.map(b => (
              <div key={b.key} style={{
                padding: "8px 14px", background: T.accent + "22",
                border: `1px solid ${T.accent}44`, borderRadius: 8,
                textAlign: "center",
              }}>
                <div style={{ fontSize: 24 }}>{b.icon}</div>
                <div style={{ fontSize: 11, color: T.accent2, fontWeight: 600, marginTop: 4 }}>{b.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending badges */}
      {pendingBadges.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text3, marginBottom: 12 }}>Badges to Unlock</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {pendingBadges.map(b => (
              <div key={b.key} style={{
                padding: "6px 12px", background: T.surface,
                border: `1px solid ${T.border}`, borderRadius: 8,
                display: "flex", alignItems: "center", gap: 8, opacity: 0.6,
              }}>
                <span style={{ fontSize: 18, filter: "grayscale(1)" }}>{b.icon}</span>
                <div>
                  <div style={{ fontSize: 11, color: T.text3, fontWeight: 600 }}>{b.label}</div>
                  <div style={{ fontSize: 10, color: T.text3 }}>{b.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDY LOG PANEL
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * StudyLogPanel — shows daily study log entries with add/delete.
 * Topics are selected from the syllabus topic list (searchable).
 */
export function StudyLogPanel({ syllabus, logs, onSave, onDelete }) {
  const [showAdd,     setShowAdd]     = useState(false);
  const [searchDate,  setSearchDate]  = useState("");
  const [searchTopic, setSearchTopic] = useState("");

  // Flatten all topics for display
  const allTopics = syllabus.subjects.flatMap(s =>
    s.topics.map(t => ({ id: t.id, name: t.name, subject: s.name }))
  );

  const getTopicName = (tid) => allTopics.find(t => t.id === tid)?.name || tid;

  // Filter logs
  const filtered = logs.filter(l => {
    if (searchDate && !l.date.includes(searchDate)) return false;
    if (searchTopic && !l.topicsStudied.some(tid => {
      const t = allTopics.find(t => t.id === tid);
      return t && matchSearch(t.name + " " + t.subject, searchTopic);
    })) return false;
    return true;
  });

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setShowAdd(true)} style={btnPrimary(T.accent)}>+ Log Today's Study</button>
        <input value={searchDate} onChange={e => setSearchDate(e.target.value)}
          type="date" style={{ ...inputStyle, width: 160, fontSize: 12 }} />
        <input value={searchTopic} onChange={e => setSearchTopic(e.target.value)}
          placeholder="Search by topic..." style={{ ...inputStyle, maxWidth: 200, fontSize: 12 }} />
        {(searchDate || searchTopic) && (
          <button onClick={() => { setSearchDate(""); setSearchTopic(""); }} style={btnGhost}>Clear</button>
        )}
      </div>

      {/* Log entries */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 40, color: T.text3 }}>
          No study logs yet. Start logging your daily study sessions!
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(log => (
            <div key={log.id} style={{ ...cardStyle, padding: "12px 16px" }}>
              {/* Header row: date + topic count + delete */}
              <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 8 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.accent2 }}>
                    {fmtDate(log.date)}
                  </span>
                  <span style={{ fontSize: 10, color: T.text3, marginLeft: 8 }}>
                    {log.topicsStudied.length + " topic" +
                     (log.topicsStudied.length !== 1 ? "s" : "")}
                  </span>
                </div>
                <button onClick={() => {
                  if (window.confirm("Delete this study log entry?")) onDelete(log.id);
                }} style={{ ...btnGhost, color: T.red, borderColor: T.red + "44",
                  fontSize: 11, padding: "3px 10px", flexShrink: 0 }}>
                  Del
                </button>
              </div>
              {/* Topic badges — full width, wraps freely */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {log.topicsStudied.map(tid => (
                  <span key={tid} style={{
                    fontSize: 11, color: T.accent2,
                    background: T.accent + "22",
                    border: "1px solid " + T.accent + "44",
                    borderRadius: 12, padding: "3px 10px",
                    maxWidth: "100%",
                    wordBreak: "break-word",
                  }}>
                    {getTopicName(tid)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddStudyLogModal
          syllabus={syllabus}
          existingLogs={logs}
          onSave={(date, topicIds) => { onSave(date, topicIds); setShowAdd(false); }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

/**
 * AddStudyLogModal — form to log topics studied on a date.
 */
function AddStudyLogModal({ syllabus, existingLogs, onSave, onClose }) {
  const [date,    setDate]    = useState(todayStr());
  const [selected,setSelected]= useState([]);
  const [search,  setSearch]  = useState("");
  const [error,   setError]   = useState("");

  const existingForDate = existingLogs.find(l => l.date === date);

  const handleSave = () => {
    if (!date) { setError("Date is required"); return; }
    if (date > todayStr()) { setError("Date cannot be in the future"); return; }
    if (selected.length === 0) { setError("Select at least one topic"); return; }

    if (existingForDate) {
      if (!window.confirm(`You already have a log for ${fmtDate(date)}. Replace it?`)) return;
    }
    onSave(date, selected);
  };

  const toggleTopic = (id) =>
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const selectAll = (subjectTopics) =>
    setSelected(p => {
      const ids = subjectTopics.map(t => t.id);
      const allIn = ids.every(id => p.includes(id));
      return allIn ? p.filter(id => !ids.includes(id)) : [...new Set([...p, ...ids])];
    });

  return (
    <Modal title="Log Study Session" onClose={onClose}>
      <label style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 }}>
        <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase" }}>Date *</span>
        <input type="date" value={date} max={todayStr()}
          onChange={e => setDate(e.target.value)}
          style={{ ...inputStyle, borderColor: error && !date ? T.red : T.border }} />
        {existingForDate && (
          <span style={{ fontSize: 11, color: T.yellow }}>
            ⚠ You already have a log for this date ({existingForDate.topicsStudied.length} topics). Saving will replace it.
          </span>
        )}
      </label>

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search topics..." style={{ ...inputStyle, marginBottom: 12, fontSize: 12 }} />

      <div style={{ maxHeight: 360, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 8, padding: 8 }}>
        {syllabus.subjects.map(s => {
          const visibleTopics = s.topics.filter(t =>
            !search || matchSearch(t.name + " " + s.name, search)
          );
          if (visibleTopics.length === 0) return null;
          return (
            <div key={s.id} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: T.accent2 }}>{s.name}</span>
                <button onClick={() => selectAll(visibleTopics)}
                  style={{ ...btnGhost, padding: "2px 8px", fontSize: 10 }}>
                  {visibleTopics.every(t => selected.includes(t.id)) ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {visibleTopics.map(t => (
                  <button key={t.id} onClick={() => toggleTopic(t.id)}
                    style={{
                      ...btnGhost,
                      padding: "4px 10px", fontSize: 11,
                      background: selected.includes(t.id) ? T.accent + "33" : "transparent",
                      color: selected.includes(t.id) ? T.accent2 : T.text2,
                      borderColor: selected.includes(t.id) ? T.accent : T.border2,
                    }}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: T.text3 }}>
        {selected.length} topic{selected.length !== 1 ? "s" : ""} selected
      </div>
      {error && <div style={{ color: T.red, fontSize: 12, marginTop: 6 }}>⚠ {error}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
        <button onClick={onClose} style={btnGhost}>Cancel</button>
        <button onClick={handleSave} style={btnPrimary(T.accent)}>Save Log →</button>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REVISION COUNTER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * RevisionCounter — full list of all topics with +/− revision buttons.
 * Colour coded by revision count. Sortable and searchable.
 * Shows "appeared in X papers" if topic was tagged in any paper OMR.
 */
export function RevisionCounter({ syllabus, papers, onUpdateRevision }) {
  const [search,    setSearch]    = useState("");
  const [sortBy,    setSortBy]    = useState("least"); // least | most | alpha | subject
  const [filterSubj,setFilterSubj]= useState("all");
  const [focusZone, setFocusZone] = useState(false);

  // Count how many papers each topic appeared in (from OMR tags)
  const topicPaperCount = {};
  for (const paper of papers) {
    for (const entry of Object.values(paper.omr || {})) {
      if (entry?.topicId) {
        topicPaperCount[entry.topicId] = (topicPaperCount[entry.topicId] || 0) + 1;
      }
    }
  }

  // Flatten all topics with subject context
  const allTopics = syllabus.subjects.flatMap(s =>
    s.topics.map(t => ({
      ...t,
      subjectId:   s.id,
      subjectName: s.name,
      paperCount:  topicPaperCount[t.id] || 0,
    }))
  );

  // Topic accuracy from papers (for Focus Zone)
  const topicAccuracy = {};
  for (const paper of papers) {
    for (const [tid, stats] of Object.entries(paper.computed?.byTopic || {})) {
      if (!topicAccuracy[tid]) topicAccuracy[tid] = { correct: 0, total: 0 };
      topicAccuracy[tid].correct += stats.correct || 0;
      topicAccuracy[tid].total   += stats.total   || 0;
    }
  }

  // Filter — apply focusZone, subject, and search (all AND)
  const filtered = allTopics.filter(t => {
    if (focusZone) {
      const ts = topicAccuracy[t.id];
      if (!ts || ts.total === 0) return false; // must have appeared in a paper
      const acc = ts.correct / ts.total * 100;
      if (acc < 40 || acc > 75) return false;  // 40-75% = focus zone
    }
    if (filterSubj !== "all" && t.subjectId !== filterSubj) return false;
    if (search && !matchSearch(t.name + " " + t.subjectName, search)) return false;
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "least")   return (a.revisionCount || 0) - (b.revisionCount || 0);
    if (sortBy === "most")    return (b.revisionCount || 0) - (a.revisionCount || 0);
    if (sortBy === "alpha")   return a.name.localeCompare(b.name);
    if (sortBy === "subject") return a.subjectName.localeCompare(b.subjectName);
    return 0;
  });

  /** Colour based on revision count */
  const revColor = (count) =>
    count === 0 ? T.red : count === 1 ? T.orange : count === 2 ? T.yellow : T.green;

  const totalRevised  = allTopics.filter(t => (t.revisionCount || 0) > 0).length;
  const totalTopics   = allTopics.length;

  return (
    <div>
      {/* Summary bar */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
            {totalRevised}/{totalTopics} topics revised at least once
          </span>
          <Badge label={`${Math.round(totalRevised / totalTopics * 100)}%`}
            color={totalRevised === totalTopics ? T.green : T.yellow} />
        </div>
        <Bar value={totalRevised} max={totalTopics} height={8} />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search topics..." style={{ ...inputStyle, maxWidth: 240, fontSize: 12 }} />
        <select value={filterSubj} onChange={e => setFilterSubj(e.target.value)}
          style={{ ...inputStyle, width: "auto", fontSize: 12, padding: "5px 8px" }}>
          <option value="all">All Subjects</option>
          {syllabus.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ ...inputStyle, width: "auto", fontSize: 12, padding: "5px 8px" }}>
          <option value="least">Least Revised First</option>
          <option value="most">Most Revised First</option>
          <option value="alpha">Alphabetical</option>
          <option value="subject">By Subject</option>
        </select>
        {/* Focus Zone toggle */}
        <button onClick={() => setFocusZone(z => !z)}
          style={{
            ...btnGhost, fontSize: 12, padding: "5px 12px",
            background: focusZone ? T.orange + "33" : "transparent",
            color:       focusZone ? T.orange       : T.text2,
            borderColor: focusZone ? T.orange       : T.border2,
            fontWeight:  focusZone ? 700 : 400,
          }}>
          🎯 Focus Zone
        </button>
      </div>
      {/* Focus Zone explanation */}
      {focusZone && (
        <div style={{ fontSize: 11, color: T.orange, marginBottom: 10,
          padding: "6px 12px", background: T.orange + "15",
          borderRadius: 6, lineHeight: 1.6 }}>
          Showing topics with 40-75% accuracy (attempted but not yet mastered).
          These give the highest score improvement per hour of study.
        </div>
      )}

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        {[[T.red,"0 revisions"],[T.orange,"1 revision"],[T.yellow,"2 revisions"],[T.green,"3+ revisions"]].map(([c,l]) => (
          <span key={l} style={{ fontSize: 11, color: T.text3, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: c, display: "inline-block" }} />
            {l}
          </span>
        ))}
      </div>

      {/* Topic list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sorted.length === 0 && (
          <div style={{ color: T.text3, textAlign: "center", padding: 30 }}>
            {focusZone
              ? "No topics in the Focus Zone. Keep attempting papers to build topic data."
              : "No topics match your filters."}
          </div>
        )}
        {sorted.map(t => {
          const col = revColor(t.revisionCount || 0);
          return (
            <div key={t.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px", borderRadius: 7,
              background: T.surface, border: `1px solid ${T.border}`,
            }}>
              {/* Colour dot */}
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: col, flexShrink: 0 }} />

              {/* Topic name + subject */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: T.text, display:"flex", gap:6, alignItems:"center" }}>
                  {t.topicNo && (
                    <span style={{ fontSize:10, fontFamily:"monospace", fontWeight:700,
                      color:T.accent2, background:T.accent+"22", padding:"1px 6px",
                      borderRadius:4, flexShrink:0 }}>
                      [{t.topicNo}]
                    </span>
                  )}
                  {t.name}
                </div>
                <div style={{ fontSize: 10, color: T.text3, display: "flex", gap: 10, marginTop:2, flexWrap:"wrap" }}>
                  <span>{t.subjectName}</span>
                  {t.lastRevisedDate && <span>Last: {fmtDate(t.lastRevisedDate)}</span>}
                  {t.paperCount > 0 && <span style={{ color: T.accent }}>
                    Appeared in {t.paperCount} paper{t.paperCount !== 1 ? "s" : ""}
                  </span>}
                  {focusZone && topicAccuracy[t.id] && (
                    <span style={{ color: T.orange, fontWeight: 700 }}>
                      {Math.round(topicAccuracy[t.id].correct / topicAccuracy[t.id].total * 100) + "% acc"}
                    </span>
                  )}
                </div>
              </div>

              {/* Revision count */}
              <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 800, color: col, minWidth: 28, textAlign: "center" }}>
                {t.revisionCount || 0}
              </span>

              {/* − button */}
              <button
                onClick={() => onUpdateRevision(t.id, -1)}
                disabled={(t.revisionCount || 0) === 0}
                style={{
                  width: 32, height: 32, borderRadius: "50%",
                  border: `2px solid ${T.border2}`, background: "transparent",
                  color: T.text2, fontSize: 18, fontWeight: 700, cursor: (t.revisionCount || 0) === 0 ? "not-allowed" : "pointer",
                  opacity: (t.revisionCount || 0) === 0 ? 0.3 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >−</button>

              {/* + button */}
              <button
                onClick={() => onUpdateRevision(t.id, +1)}
                style={{
                  width: 32, height: 32, borderRadius: "50%",
                  border: `2px solid ${T.accent}`, background: T.accent + "22",
                  color: T.accent2, fontSize: 18, fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >+</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STUDY TIMER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Plays a beautiful 3-tone ascending chime using Web Audio API.
 * No audio file needed — generated in pure JS.
 * C5 → E5 → G5 with smooth fade-out on each note.
 */
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [
      { freq: 523.25, start: 0.0,  dur: 0.5  },  // C5
      { freq: 659.25, start: 0.25, dur: 0.5  },  // E5
      { freq: 783.99, start: 0.5,  dur: 0.85 },  // G5
    ];
    notes.forEach(({ freq, start, dur }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type      = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    });
    // Close context after chime finishes
    setTimeout(() => { try { ctx.close(); } catch {} }, 2000);
  } catch {}
}

/**
 * StudyTimer — countdown timer for study sessions.
 * User sets hours + minutes. Counts down to zero with HH:MM:SS display.
 * Plays chime when complete. Start / Pause / Resume / Reset controls.
 */
export function StudyTimer() {
  const [hours,     setHours]     = useState("0");
  const [minutes,   setMinutes]   = useState("25");
  const [totalSecs, setTotalSecs] = useState(null);  // null = not started
  const [remaining, setRemaining] = useState(0);
  const [running,   setRunning]   = useState(false);
  const [done,      setDone]      = useState(false);
  const intervalRef = useRef(null);
  const endTimeRef  = useRef(null); // absolute end timestamp — immune to background/sleep drift

  // Clear interval on unmount
  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Tick — recalculate from absolute end time to avoid drift
  const startTick = (endTimestamp) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((endTimestamp - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        setRunning(false);
        setDone(true);
        playChime();
      }
    }, 500); // tick twice/sec for accuracy
  };

  const handleStart = () => {
    const h = Math.max(0, Math.min(23, parseInt(hours)   || 0));
    const m = Math.max(0, Math.min(59, parseInt(minutes) || 0));
    const secs = h * 3600 + m * 60;
    if (secs <= 0) return;
    const endTs = Date.now() + secs * 1000;
    endTimeRef.current = endTs;
    setTotalSecs(secs);
    setRemaining(secs);
    setRunning(true);
    setDone(false);
    startTick(endTs);
  };

  const handlePause = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setRunning(false);
    // Save remaining time so resume can set a new endTime
    endTimeRef.current = Date.now() + remaining * 1000;
  };

  const handleResume = () => {
    const endTs = Date.now() + remaining * 1000;
    endTimeRef.current = endTs;
    setRunning(true);
    setDone(false);
    startTick(endTs);
  };

  const handleReset = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setRunning(false);
    setDone(false);
    setTotalSecs(null);
    setRemaining(0);
    endTimeRef.current = null;
  };

  // Format seconds as HH:MM:SS
  const fmt = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return (
      String(h).padStart(2,"0") + ":" +
      String(m).padStart(2,"0") + ":" +
      String(s).padStart(2,"0")
    );
  };

  // Progress 0→1
  const progress = totalSecs > 0 ? (totalSecs - remaining) / totalSecs : 0;

  // Colour shifts from green → yellow → orange → red as time runs out
  const timerColor =
    !totalSecs       ? T.accent :
    progress < 0.5   ? T.green  :
    progress < 0.75  ? T.yellow :
    progress < 0.9   ? T.orange : T.red;

  return (
    <div style={{ maxWidth: 360, margin: "0 auto" }}>

      {/* Setup panel — shown before starting */}
      {totalSecs === null && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 14 }}>
            Set Study Duration
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
              <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Hours
              </span>
              <input type="number" min="0" max="23" value={hours}
                onChange={e => setHours(e.target.value)}
                placeholder="0"
                style={{ ...inputStyle, textAlign: "center", fontSize: 22, fontWeight: 700,
                  fontFamily: "monospace", padding: "10px 8px" }} />
            </label>
            <span style={{ fontSize: 28, color: T.text3, paddingBottom: 10 }}>:</span>
            <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1 }}>
              <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Minutes
              </span>
              <input type="number" min="0" max="59" value={minutes}
                onChange={e => setMinutes(e.target.value)}
                placeholder="25"
                style={{ ...inputStyle, textAlign: "center", fontSize: 22, fontWeight: 700,
                  fontFamily: "monospace", padding: "10px 8px" }} />
            </label>
          </div>
          {/* Quick presets */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[["0","25"],["0","45"],["1","0"],["1","30"]].map(([h,m]) => (
              <button key={h+":"+m}
                onClick={() => { setHours(h); setMinutes(m); }}
                style={{ ...btnGhost, flex: 1, fontSize: 11, padding: "5px 4px" }}>
                {h === "0" ? m + "m" : h + "h " + (m === "0" ? "" : m + "m")}
              </button>
            ))}
          </div>
          <button onClick={handleStart}
            style={{ ...btnPrimary(T.accent), width: "100%", fontSize: 15, padding: "12px 0" }}>
            ▶ Start Timer
          </button>
        </div>
      )}

      {/* Running / paused / done display */}
      {totalSecs !== null && (
        <div style={{ ...cardStyle, textAlign: "center", marginBottom: 16 }}>

          {/* Circular progress ring */}
          <div style={{ position: "relative", display: "inline-block", marginBottom: 16 }}>
            <svg width="200" height="200" style={{ transform: "rotate(-90deg)" }}>
              {/* Background track */}
              <circle cx="100" cy="100" r="88"
                fill="none" stroke={T.border} strokeWidth="10" />
              {/* Progress arc */}
              <circle cx="100" cy="100" r="88"
                fill="none" stroke={timerColor} strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={String(2 * Math.PI * 88)}
                strokeDashoffset={String(2 * Math.PI * 88 * progress)} />
            </svg>
            {/* Time display centred in ring */}
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%,-50%)",
              fontFamily: "monospace", fontWeight: 900,
              fontSize: done ? 22 : 32, color: done ? T.green : timerColor,
              letterSpacing: "0.04em", textAlign: "center",
              lineHeight: 1.2,
            }}>
              {done ? "🎉 Done!" : fmt(remaining)}
            </div>
          </div>

          {/* Status label */}
          {done ? (
            <div style={{ fontSize: 15, fontWeight: 700, color: T.green, marginBottom: 16 }}>
              Session complete! Well done 🎯
            </div>
          ) : (
            <div style={{ fontSize: 12, color: T.text3, marginBottom: 16 }}>
              {running ? "Focus. You are doing great." : "Paused — tap Resume to continue."}
            </div>
          )}

          {/* Controls */}
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            {!done && running && (
              <button onClick={handlePause}
                style={{ ...btnGhost, fontSize: 14, padding: "10px 24px" }}>
                ⏸ Pause
              </button>
            )}
            {!done && !running && (
              <button onClick={handleResume}
                style={{ ...btnPrimary(T.accent), fontSize: 14, padding: "10px 24px" }}>
                ▶ Resume
              </button>
            )}
            <button onClick={handleReset}
              style={{ ...btnGhost, fontSize: 14, padding: "10px 24px",
                color: T.red, borderColor: T.red + "44" }}>
              ✕ Reset
            </button>
          </div>
        </div>
      )}

      {/* Info */}
      <div style={{ fontSize: 11, color: T.text3, textAlign: "center", lineHeight: 1.7 }}>
        A chime plays when your session ends. Keep this tab open for the timer to work.
      </div>
    </div>
  );
}
