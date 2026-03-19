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

import { useState, useEffect, useCallback } from "react";
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
} from "./AppStudy";

import {
  SyncPanel,
  shareOnWhatsApp,
} from "./AppSync";

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Dashboard — KPI cards, score trend bar chart, and latest paper summary.
 */
function Dashboard({ papers, syllabus, streak, onAddPaper }) {
  if (!papers.length) return (
    <div style={{ ...cardStyle, textAlign: "center", padding: 60 }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>📝</div>
      <div style={{ fontSize: 17, color: T.text2, marginBottom: 8 }}>
        No papers yet for {syllabus.shortName}
      </div>
      <div style={{ fontSize: 13, color: T.text3, marginBottom: 20 }}>
        Add your first paper to start tracking
      </div>
      <button onClick={onAddPaper} style={btnPrimary(T.accent)}>+ Add First Paper</button>
    </div>
  );

  // Sort by date for trend chart
  const sorted  = [...papers].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const scores  = sorted.map(p => p.computed?.totalMarks ?? 0);
  const avg     = scores.reduce((a, b) => a + b, 0) / scores.length;
  const best    = Math.max(...scores);
  const maxSc   = Math.max(...scores, 1);
  const latest  = [...papers].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { l: "Papers Tracked", v: papers.length,     unit: "",     c: T.accent  },
          { l: "Average Score",  v: avg.toFixed(1),     unit: "/100", c: scoreColor(pct(avg, 100))  },
          { l: "Best Score",     v: best.toFixed(1),    unit: "/100", c: T.green   },
          { l: "Study Streak",   v: streak?.currentStreak || 0, unit: " days", c: (streak?.currentStreak || 0) >= 7 ? T.orange : T.text2 },
        ].map(k => (
          <div key={k.l} style={{ ...cardStyle, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
              {k.l}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: k.c, fontFamily: "monospace" }}>
              {k.v}<span style={{ fontSize: 12, color: T.text3 }}>{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Score trend */}
      <Section title="📈 Score Trend" accent={T.accent}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
          {sorted.map((p, i) => {
            const sc  = p.computed?.totalMarks ?? 0;
            const h   = Math.max(6, (sc / maxSc) * 80);
            const col = scoreColor(pct(sc, 100));
            return (
              <div key={p.id} title={`${p.name || p.code}: ${sc.toFixed(1)}`}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span style={{ fontSize: 9, color: col, fontFamily: "monospace" }}>{sc.toFixed(0)}</span>
                <div style={{
                  width: "100%", height: h,
                  background: col + "88", borderRadius: "3px 3px 0 0",
                  border: `1px solid ${col}`,
                }} />
                <span style={{
                  fontSize: 8, color: T.text3,
                  maxWidth: 36, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {p.name || p.code || `P${i + 1}`}
                </span>
              </div>
            );
          })}
        </div>
        {scores.length > 1 && (
          <div style={{ fontSize: 11, color: T.text3, marginTop: 8 }}>
            Δ from first:&nbsp;
            <strong style={{ color: scores[scores.length - 1] >= scores[0] ? T.green : T.red }}>
              {scores[scores.length - 1] >= scores[0] ? "+" : ""}
              {(scores[scores.length - 1] - scores[0]).toFixed(1)}
            </strong>
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
            <div style={{
              fontSize: 28, fontWeight: 900, fontFamily: "monospace",
              color: scoreColor(pct(latest.computed.totalMarks, 100)),
            }}>
              {latest.computed.totalMarks.toFixed(2)}
              <span style={{ fontSize: 12, color: T.text3 }}>/100</span>
            </div>
            <div style={{ fontSize: 12, color: T.text2 }}>
              ✓ {latest.computed.totalCorrect} &nbsp; ✗ {latest.computed.totalWrong}
            </div>
          </div>
        </Section>
      )}
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
              <div key={p.id} style={{
                ...cardStyle,
                display: "grid", gridTemplateColumns: "1fr auto auto",
                gap: 12, alignItems: "center",
              }}>
                <div>
                  <div style={{
                    fontWeight: 700, color: T.text, fontSize: 14,
                    marginBottom: 4, display: "flex", gap: 8,
                    alignItems: "center", flexWrap: "wrap",
                  }}>
                    {p.name || "Unnamed Paper"}
                    {p.code        && <span style={{ fontSize: 11, color: T.text3, fontFamily: "monospace" }}>{p.code}</span>}
                    {p.date        && <span style={{ fontSize: 11, color: T.text3 }}>{fmtDate(p.date)}</span>}
                    {p.bookletCode && <Badge label={`Booklet ${p.bookletCode}`} color={T.accent} />}
                    {p.answerKey   && <Badge label="Key ✓" color={T.green} />}
                    {hasContent    && <Badge label="📄" color={T.purple} />}
                  </div>
                  {c && (
                    <div style={{ fontSize: 11, color: T.text3 }}>
                      ✓ {c.totalCorrect} &nbsp;✗ {c.totalWrong} &nbsp;⊘ {c.totalDeleted}
                      &nbsp; Penalty: {c.totalPenalty.toFixed(2)}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 900, color: scoreColor(sp) }}>
                    {sc.toFixed(1)}
                  </div>
                  <div style={{ fontSize: 10, color: T.text3 }}>/100</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => onView(p)} style={{ ...btnGhost, fontSize: 12 }}>View</button>
                  <button onClick={() => onEdit(p)} style={{ ...btnGhost, fontSize: 12 }}>Edit</button>
                  <button
                    onClick={() => shareOnWhatsApp(p, syllabus, streak?.currentStreak)}
                    style={{ ...btnGhost, fontSize: 12 }}>📤</button>
                  <button onClick={() => setToDelete(p)}
                    style={{ ...btnGhost, fontSize: 12, color: T.red, borderColor: T.red + "44" }}>Del</button>
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
function Analytics({ papers, syllabus, cutoff, onSetCutoff }) {
  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");
  const [editCutoff,   setEditCutoff]   = useState(false);
  const [cutoffInput,  setCutoffInput]  = useState(cutoff || "");

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

  // Subject averages
  const subjAvg = syllabus.subjects.map(s => {
    const vals = filtered.map(p => p.computed?.bySubject?.[s.id]?.marks || 0);
    const avg  = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { ...s, avg, avgPct: pct(avg, s.maxMarks), vals };
  });

  // Topic performance from OMR tags
  const topicStats = {};
  for (const paper of filtered) {
    for (const [tid, stats] of Object.entries(paper.computed?.byTopic || {})) {
      if (!topicStats[tid]) topicStats[tid] = { correct: 0, wrong: 0, total: 0 };
      topicStats[tid].correct += stats.correct;
      topicStats[tid].wrong   += stats.wrong;
      topicStats[tid].total   += stats.total;
    }
  }

  // Guess totals (from manual guesswork entries)
  let ffC = 0, ffW = 0, wgC = 0, wgW = 0;
  for (const p of filtered) {
    const g = p.guesses || {};
    ffC += parseInt(g.ff_correct) || 0;
    ffW += parseInt(g.ff_wrong)   || 0;
    wgC += parseInt(g.wg_correct) || 0;
    wgW += parseInt(g.wg_wrong)   || 0;
  }
  const breakeven = Math.round(1 / (1 + neg) * 100);

  // Revision vs score
  const corrData = syllabus.subjects.flatMap(s =>
    s.topics
      .filter(t => (t.revisionCount || 0) > 0 && topicStats[t.id]?.total > 0)
      .map(t => ({
        name:      t.name,
        revisions: t.revisionCount,
        accuracy:  Math.round(topicStats[t.id].correct / topicStats[t.id].total * 100),
      }))
  );

  return (
    <div>
      {/* Date filter + cutoff */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          style={{ ...inputStyle, width: 150, fontSize: 12 }} />
        <span style={{ color: T.text3 }}>–</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
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
              Enter the known PSC cutoff mark for this exam (e.g. 65).
              It will appear as a line on the score trend chart.
            </span>
            <input type="number" min={0} max={100} value={cutoffInput}
              onChange={e => setCutoffInput(e.target.value)}
              style={{ ...inputStyle, maxWidth: 120 }} />
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setEditCutoff(false)} style={btnGhost}>Cancel</button>
            <button
              onClick={() => { onSetCutoff(parseFloat(cutoffInput) || null); setEditCutoff(false); }}
              style={btnPrimary(T.accent)}>Save</button>
          </div>
        </Modal>
      )}

      {/* Score trend with cutoff line */}
      <Section title="📈 Score Trend" accent={T.accent}>
        <div style={{ position: "relative" }}>
          {cutoff && (
            <div style={{
              position: "absolute", left: 0, right: 0,
              bottom: `${(cutoff / 100) * 80 + 16}px`,
              borderTop: `2px dashed ${T.yellow}`,
              zIndex: 1,
            }}>
              <span style={{ position: "absolute", right: 0, top: -16, fontSize: 10, color: T.yellow }}>
                Cutoff {cutoff}
              </span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 100, position: "relative" }}>
            {[...filtered].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map((p, i) => {
              const sc  = p.computed?.totalMarks ?? 0;
              const maxSc = Math.max(...filtered.map(x => x.computed?.totalMarks ?? 0), 1);
              const h   = Math.max(6, (sc / maxSc) * 80);
              const col = scoreColor(pct(sc, 100));
              return (
                <div key={p.id} title={`${p.name || p.code}: ${sc.toFixed(1)}`}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <span style={{ fontSize: 9, color: col, fontFamily: "monospace" }}>{sc.toFixed(0)}</span>
                  <div style={{ width: "100%", height: h, background: col + "88", borderRadius: "3px 3px 0 0", border: `1px solid ${col}` }} />
                  <span style={{ fontSize: 8, color: T.text3, maxWidth: 36, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name || `P${i + 1}`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      {/* Subject performance */}
      <Section title="📊 Subject-wise Average" accent={T.purple}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...subjAvg].sort((a, b) => a.avgPct - b.avgPct).map(s => (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: "170px 1fr 70px 60px", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: s.avgPct < 40 ? T.red : T.text2 }}>{s.name}</span>
              <Bar value={s.avg} max={s.maxMarks} height={8} />
              <span style={{ fontFamily: "monospace", fontSize: 11, color: T.text3 }}>{s.avg.toFixed(1)}/{s.maxMarks}</span>
              <Badge label={`${s.avgPct}%`} color={scoreColor(s.avgPct)} />
            </div>
          ))}
        </div>
      </Section>

      {/* Weak / Strong */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {[
          { title: "🔴 Weakest",   data: [...subjAvg].sort((a, b) => a.avgPct - b.avgPct).slice(0, 3), color: T.red   },
          { title: "🟢 Strongest", data: [...subjAvg].sort((a, b) => b.avgPct - a.avgPct).slice(0, 3), color: T.green },
        ].map(({ title, data, color }) => (
          <Section key={title} title={title} accent={color}>
            {data.map((s, i) => (
              <div key={s.id} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: T.text }}>#{i + 1} {s.name}</span>
                  <span style={{ fontSize: 11, fontFamily: "monospace", color }}>{s.avgPct}%</span>
                </div>
                <Bar value={s.avg} max={s.maxMarks} />
              </div>
            ))}
          </Section>
        ))}
      </div>

      {/* Guess strategy */}
      <Section title="🎲 Guesswork Strategy" accent={T.yellow}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          {[
            { label: "50:50 Overall", c: ffC, w: ffW, color: T.cyan   },
            { label: "Wild Guess",    c: wgC, w: wgW, color: T.orange },
          ].map(row => {
            const acc = guessAccuracy(row.c, row.w);
            const net = (row.c - row.w * neg).toFixed(2);
            return (
              <div key={row.label} style={{ border: `1px solid ${row.color}44`, borderRadius: 8, padding: 14, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: row.color, marginBottom: 8, fontWeight: 600 }}>{row.label}</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: row.color, fontFamily: "monospace" }}>
                  {acc !== null ? `${acc}%` : "—"}
                </div>
                <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>Net: {net} marks</div>
                {acc !== null && (
                  <Badge label={acc >= breakeven ? "✓ Profitable" : "✗ Losing marks"}
                    color={acc >= breakeven ? T.green : T.red} />
                )}
              </div>
            );
          })}
          <div style={{ border: `1px solid ${T.yellow}44`, borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 11, color: T.yellow, fontWeight: 600, marginBottom: 8 }}>Break-even Rule</div>
            <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.7 }}>
              Need <strong style={{ color: T.yellow }}>{breakeven}%</strong> guess accuracy
              to break even with {(neg * 100).toFixed(0)}% negative marking.
            </div>
          </div>
        </div>
      </Section>

      {/* Topic performance — grouped by subject, sorted by total desc then accuracy desc */}
      {Object.keys(topicStats).length > 0 && (
        <Section title="📌 Topic Performance (from OMR tags)" accent={T.cyan}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {syllabus.subjects.map(subj => {
              // Collect topics from this subject that appear in topicStats
              const subjTopics = subj.topics
                .filter(t => topicStats[t.id])
                .map(t => ({
                  ...t,
                  stats: topicStats[t.id],
                  acc: topicStats[t.id].total > 0
                    ? Math.round(topicStats[t.id].correct / topicStats[t.id].total * 100)
                    : 0,
                }))
                // Sort: most questions first, then accuracy descending as tiebreaker
                .sort((a, b) =>
                  b.stats.total !== a.stats.total
                    ? b.stats.total - a.stats.total
                    : b.acc - a.acc
                );

              if (subjTopics.length === 0) return null;

              // Find subject colour from index
              const sIdx = syllabus.subjects.findIndex(s => s.id === subj.id);
              const sColor = T.subjectColors[sIdx % T.subjectColors.length] || T.accent;

              return (
                <div key={subj.id}>
                  {/* Subject header */}
                  <div style={{
                    fontSize: 11, fontWeight: 700, color: sColor,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    borderBottom: `1px solid ${sColor}33`,
                    paddingBottom: 5, marginBottom: 8,
                    display: "flex", justifyContent: "space-between",
                  }}>
                    <span>{subj.name}</span>
                    <span style={{ fontWeight: 400, color: T.text3, fontSize: 10 }}>
                      {subjTopics.length} topic{subjTopics.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Topic rows */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {subjTopics.map(t => (
                      <div key={t.id} style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto auto",
                        gap: 10, alignItems: "center",
                        padding: "6px 10px", borderRadius: 6,
                        background: T.surface,
                        border: `1px solid ${T.border}`,
                      }}>
                        {/* Topic name with [N] if available */}
                        <span style={{ fontSize: 12, color: T.text2, minWidth: 0 }}>
                          {t.topicNo
                            ? <span style={{ fontSize: 10, color: T.text3, marginRight: 5, fontFamily: "monospace" }}>[{t.topicNo}]</span>
                            : null}
                          {t.name}
                        </span>
                        {/* correct/total */}
                        <span style={{
                          fontFamily: "monospace", fontSize: 12,
                          color: T.text3, whiteSpace: "nowrap",
                        }}>
                          {t.stats.correct}/{t.stats.total}
                        </span>
                        {/* accuracy badge */}
                        <Badge label={`${t.acc}%`} color={scoreColor(t.acc)} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Revision vs accuracy */}
      {corrData.length > 0 && (
        <Section title="📈 Revision vs Accuracy" accent={T.pink}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {corrData.sort((a, b) => b.revisions - a.revisions).map(item => (
              <div key={item.name} style={{ display: "grid", gridTemplateColumns: "1fr 70px 1fr 60px", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: T.text2 }}>{item.name}</span>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: T.purple, textAlign: "center" }}>
                  {item.revisions}× rev
                </span>
                <Bar value={item.accuracy} max={100} />
                <Badge label={`${item.accuracy}%`} color={scoreColor(item.accuracy)} />
              </div>
            ))}
          </div>
        </Section>
      )}
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
                    background: s.id === activeSylId ? T.accent + "22" : "transparent",
                    color: s.id === activeSylId ? T.accent2 : T.text2,
                    borderColor: s.id === activeSylId ? T.accent : T.border2,
                  }}>
                  {s.id === activeSylId ? "✓ Viewing" : "Select"}
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

function StudyTrackerPage({ syllabus, papers, logs, streak, onSaveLog, onDeleteLog, onUpdateRevision }) {
  const [tab, setTab] = useState("streak");

  const tabStyle = (t) => ({
    padding: "10px 16px", fontSize: 13, fontWeight: 600,
    background: "transparent", border: "none", cursor: "pointer",
    color: tab === t ? T.text : T.text3,
    borderBottom: tab === t ? `2px solid ${T.accent}` : "2px solid transparent",
  });

  return (
    <div>
      <div style={{ borderBottom: `1px solid ${T.border}`, marginBottom: 20, display: "flex" }}>
        <button onClick={() => setTab("streak")}    style={tabStyle("streak")}>🔥 Streak</button>
        <button onClick={() => setTab("log")}       style={tabStyle("log")}>📅 Study Log</button>
        <button onClick={() => setTab("revisions")} style={tabStyle("revisions")}>📖 Revisions</button>
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
    { key: "dashboard", icon: "📊", label: "Home"     },
    { key: "papers",    icon: "📋", label: "Papers"   },
    { key: "analytics", icon: "📈", label: "Analytics"},
    { key: "study",     icon: "📚", label: "Study"    },
    { key: "syllabi",   icon: "🗂",  label: "Syllabi"  },
    { key: "sync",      icon: "☁",  label: "Sync"     },
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
            onAddPaper={() => setModal({ type: "addPaper" })}
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
          />
        )}

        {activeSyl && page === "study" && (
          <StudyTrackerPage
            syllabus={activeSyl} papers={activePapers}
            logs={logs} streak={streak}
            onSaveLog={saveLog} onDeleteLog={deleteLog}
            onUpdateRevision={updateRevision}
          />
        )}

        {page === "syllabi" && (
          <SyllabiPage
            syllabi={syllabi} papers={papers} activeSylId={activeSylId}
            onAdd={()      => setModal({ type: "addSyllabus" })}
            onImport={()   => setModal({ type: "importSyllabus" })}
            onEdit={(s)    => setModal({ type: "editSyllabus", syllabus: s })}
            onDelete={handleDeleteSyllabus}
            onSelect={(id) => { setActiveSylId(id); setPage("dashboard"); }}
          />
        )}

        {page === "sync" && (
          <div>
            <h2 style={{ margin: "0 0 20px", fontWeight: 800, fontSize: 18, color: T.text }}>Sync & Backup</h2>
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
