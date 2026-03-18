/**
 * AppSyllabus.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * All paper and syllabus management UI.
 * Contains:
 *   - SyllabusEditor   — create/edit syllabi with subjects, topics, Q-ranges
 *   - AnswerKeyParser  — upload & parse single/multi-booklet answer key docx
 *   - SmartOMR         — 100-question OMR with topic tagging & guess marking
 *   - PaperForm        — full paper entry form (5 tabs)
 *   - PaperDetail      — read-only view of a saved paper with all scores
 *   - ContentReader    — view pasted text / extracted docx / PDF
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  T, inputStyle, btnPrimary, btnGhost, cardStyle,
  uid, pct, scoreColor, fmtDate, clamp,
  calcMarks, computeScoreFromOMR, subjectForQuestion,
  validate, matchSearch,
  Bar, Badge, Modal, Section, NumInput, FieldError,
  SearchSelect, ConfirmDialog, useUnsavedWarning,
} from "./AppCore";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a flat list of {id, label, group} for SearchSelect topic picker */
export const buildTopicOptions = (syllabus) =>
  (syllabus?.subjects || []).flatMap(s =>
    (s.topics || []).map(t => ({ id: t.id, label: t.name, group: s.name }))
  );

/** Generate an empty OMR object (100 questions, all null) */
export const emptyOMR = () => {
  const omr = {};
  for (let i = 1; i <= 100; i++) {
    omr[i] = { answer: null, isGuess: false, guessType: null, topicId: null, subjectOverride: null };
  }
  return omr;
};

/** Generate an empty paper skeleton for a given syllabus */
export const emptyPaper = (syllabus) => ({
  id:          uid(),
  syllabusId:  syllabus.id,
  name:        "",
  code:        "",
  date:        "",
  bookletCode: "",
  notes:       "",
  createdAt:   Date.now(),
  answerKey:   null,
  questionRangeOverride: {},
  omr:         emptyOMR(),
  computed:    null,
  guesses:     { ff_correct: "", ff_wrong: "", wg_correct: "", wg_wrong: "" },
  content:     { text: "", docxExtracted: "", docxName: "", pdfData: "", pdfName: "" },
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANSWER KEY PARSER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse a raw text extracted from an answer key docx.
 * Handles two formats:
 *   Format A (multi-booklet): columns A B C D for each question
 *   Format B (single-booklet): two columns — Q No. and Answer
 *
 * Returns:
 *   { type: "multi"|"single", booklets:{A:{},B:{},C:{},D:{}}, singleCode, singleAnswers, deletedQuestions, parseWarnings }
 */
export function parseAnswerKeyText(rawText) {
  const lines    = rawText.split("\n").map(l => l.trim()).filter(Boolean);
  const warnings = [];

  // Detect format by looking for column headers A B C D
  const isMulti = /\bA\b.*\bB\b.*\bC\b.*\bD\b/i.test(rawText.slice(0, 800));

  if (isMulti) {
    // ── Multi-booklet format ──────────────────────────────────────────────
    const booklets = { A: {}, B: {}, C: {}, D: {} };
    const deleted  = { A: [], B: [], C: [], D: [] };

    // Match rows: number followed by 4 values (A/B/C/D/X)
    const rowRe = /(\d{1,3})\s+([ABCDX])\s+([ABCDX])\s+([ABCDX])\s+([ABCDX])/gi;
    let match;
    while ((match = rowRe.exec(rawText)) !== null) {
      const q = parseInt(match[1]);
      if (q < 1 || q > 100) continue;
      ["A","B","C","D"].forEach((bl, i) => {
        const ans = match[i + 2].toUpperCase();
        booklets[bl][q] = ans;
        if (ans === "X") deleted[bl].push(q);
      });
    }

    const counts = Object.values(booklets).map(b => Object.keys(b).length);
    if (Math.max(...counts) < 90)
      warnings.push(`Only ${Math.max(...counts)} questions parsed. Expected ~100. Check file format.`);

    return { type: "multi", booklets, deletedQuestions: deleted, singleCode: null, singleAnswers: null, parseWarnings: warnings };

  } else {
    // ── Single-booklet format ─────────────────────────────────────────────
    // Detect booklet code from header
    const codeMatch = rawText.match(/ALPHACODE\s+([A-D])/i) || rawText.match(/BOOKLET\s+([A-D])\b/i);
    const singleCode = codeMatch ? codeMatch[1].toUpperCase() : "A";

    const answers = {};
    const deleted = [];

    // Match rows: number followed by one answer value
    const rowRe = /(\d{1,3})\s+([ABCDX])\b/gi;
    let match;
    while ((match = rowRe.exec(rawText)) !== null) {
      const q = parseInt(match[1]);
      if (q < 1 || q > 100) continue;
      const ans = match[2].toUpperCase();
      answers[q] = ans;
      if (ans === "X") deleted.push(q);
    }

    if (Object.keys(answers).length < 90)
      warnings.push(`Only ${Object.keys(answers).length} questions parsed. Expected ~100.`);

    return {
      type: "single", singleCode, singleAnswers: answers,
      booklets: null, deletedQuestions: { [singleCode]: deleted },
      parseWarnings: warnings,
    };
  }
}

/**
 * AnswerKeyUploader component.
 * Renders an upload button + parse result summary.
 * On success, calls onParsed(parsedKey).
 */
export function AnswerKeyUploader({ existing, onParsed, syllabus }) {
  const [status, setStatus]     = useState(null); // null | "parsing" | "done" | "error"
  const [result, setResult]     = useState(existing || null);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirm, setConfirm]   = useState(false);
  const fileRef                 = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.name.endsWith(".docx")) {
      setErrorMsg("Only .docx files are accepted for answer keys.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setErrorMsg("File is over 3MB. Please use a smaller file.");
      return;
    }
    setStatus("parsing");
    setErrorMsg("");

    try {
      // Read file as ArrayBuffer, extract text via FileReader
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          // Extract raw text from docx (XML-based) using a simple regex approach
          // Works for PSC answer key tables which are plain ASCII
          const bytes = new Uint8Array(e.target.result);
          let xml = "";
          // Find word/document.xml in the ZIP
          // We decode the full buffer as Latin-1 to find text runs
          for (let i = 0; i < bytes.length; i++) xml += String.fromCharCode(bytes[i]);
          // Extract text runs <w:t>...</w:t>
          const textRuns = [];
          const re = /<w:t[^>]*>([^<]+)<\/w:t>/g;
          let m;
          while ((m = re.exec(xml)) !== null) textRuns.push(m[1]);
          resolve(textRuns.join(" "));
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });

      const parsed = parseAnswerKeyText(text);
      parsed.fileName = file.name;
      setResult(parsed);
      setStatus("done");
      onParsed(parsed);
    } catch (e) {
      setStatus("error");
      setErrorMsg("Could not parse the file. Make sure it is a valid .docx answer key.");
    }
  };

  const triggerUpload = () => {
    if (result && !confirm) { setConfirm(true); return; }
    setConfirm(false);
    fileRef.current?.click();
  };

  const bookletLetters = result
    ? (result.type === "multi" ? ["A","B","C","D"] : [result.singleCode])
    : [];

  return (
    <div>
      <input ref={fileRef} type="file" accept=".docx" style={{ display: "none" }}
        onChange={e => handleFile(e.target.files[0])} />

      {confirm && (
        <ConfirmDialog
          message="An answer key is already uploaded for this paper."
          detail="Uploading a new one will replace the existing key and clear any calculated scores."
          confirmLabel="Replace"
          danger
          onConfirm={() => { setConfirm(false); fileRef.current?.click(); }}
          onCancel={() => setConfirm(false)}
        />
      )}

      <button onClick={triggerUpload} style={btnPrimary(result ? T.teal : T.accent)}>
        {status === "parsing" ? "Parsing…" : result ? `✓ Replace Answer Key (${result.fileName || ""})` : "Upload Answer Key (.docx)"}
      </button>

      {errorMsg && <FieldError msg={errorMsg} />}

      {result && status === "done" && (
        <div style={{
          marginTop: 12, background: T.surface, borderRadius: 8,
          padding: "12px 14px", border: `1px solid ${T.border}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.green, marginBottom: 8 }}>
            ✓ Answer key parsed successfully
          </div>
          <div style={{ fontSize: 11, color: T.text2, lineHeight: 1.8 }}>
            <div>Format: <strong style={{ color: T.text }}>{result.type === "multi" ? "Multi-booklet (A/B/C/D)" : `Single booklet (${result.singleCode})`}</strong></div>
            <div>Booklets: {bookletLetters.map(bl => {
              const count = result.type === "multi"
                ? Object.keys(result.booklets[bl] || {}).length
                : Object.keys(result.singleAnswers || {}).length;
              const delCount = (result.deletedQuestions[bl] || []).length;
              return (
                <span key={bl} style={{ marginRight: 12 }}>
                  <strong style={{ color: T.accent2 }}>{bl}</strong>: {count} questions
                  {delCount > 0 && <span style={{ color: T.orange }}> ({delCount} deleted)</span>}
                </span>
              );
            })}</div>
            {result.parseWarnings?.length > 0 && (
              <div style={{ color: T.yellow, marginTop: 6 }}>
                ⚠ {result.parseWarnings.join(" | ")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SMART OMR SHEET
// ═══════════════════════════════════════════════════════════════════════════════

export const OPTS = ["A", "B", "C", "D"];

/**
 * Full 100-question OMR sheet with:
 * - Answer bubbles (A/B/C/D)
 * - Subject label (auto from range, tappable to override)
 * - Guess type marker (50:50 / Wild)
 * - Topic tag picker
 * - Deleted question indicator
 * - Calculate score button
 */
export function SmartOMR({ omr, answerKey, bookletCode, syllabus, rangeOverride, onSave, onClose }) {
  const [local, setLocal]               = useState(() => ({ ...emptyOMR(), ...omr }));
  const [selBooklet, setSelBooklet]     = useState(bookletCode || "");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [guessFilter, setGuessFilter]   = useState("all"); // all | guessed | unguessed
  const [searchQ, setSearchQ]           = useState("");
  const [computed, setComputed]         = useState(null);
  const [showCalcError, setShowCalcError] = useState("");
  const topicOptions                    = buildTopicOptions(syllabus);

  // Derive the answer map for the selected booklet
  const getKeyAnswers = () => {
    if (!answerKey) return null;
    if (answerKey.type === "multi") return answerKey.booklets[selBooklet] || null;
    if (answerKey.type === "single") return answerKey.singleAnswers || null;
    return null;
  };

  // Get deleted Q numbers for selected booklet
  const getDeletedQs = () => {
    if (!answerKey) return new Set();
    const del = answerKey.deletedQuestions || {};
    const arr = answerKey.type === "multi"
      ? (del[selBooklet] || [])
      : (del[answerKey.singleCode] || []);
    return new Set(arr);
  };

  const deletedQs = getDeletedQs();

  const setField = (q, field, value) =>
    setLocal(prev => ({ ...prev, [q]: { ...prev[q], [field]: value } }));

  const toggleGuess = (q) => {
    const cur = local[q];
    if (!cur.answer) return; // Can't mark guess without an answer
    if (!cur.isGuess) {
      setLocal(prev => ({ ...prev, [q]: { ...prev[q], isGuess: true, guessType: "5050" } }));
    } else if (cur.guessType === "5050") {
      setLocal(prev => ({ ...prev, [q]: { ...prev[q], guessType: "wild" } }));
    } else {
      setLocal(prev => ({ ...prev, [q]: { ...prev[q], isGuess: false, guessType: null } }));
    }
  };

  const handleCalculate = () => {
    if (answerKey && answerKey.type === "multi" && !selBooklet) {
      setShowCalcError("Please select your booklet version (A/B/C/D) before calculating.");
      return;
    }
    const keyAnswers = getKeyAnswers();
    if (!keyAnswers) {
      setShowCalcError("No answer key available. Upload an answer key to auto-calculate scores.");
      return;
    }
    const answered = Object.values(local).filter(e => e.answer).length;
    if (answered < 50) {
      if (!window.confirm(`Only ${answered} answers recorded. Calculate anyway?`)) return;
    }
    setShowCalcError("");
    const result = computeScoreFromOMR(local, keyAnswers, syllabus, rangeOverride);
    setComputed(result);
  };

  const handleSave = () => {
    onSave({ omr: local, computed, bookletCode: selBooklet });
  };

  // Build available booklet options
  const bookletOptions = answerKey
    ? (answerKey.type === "multi" ? ["A","B","C","D"] : [answerKey.singleCode])
    : [];

  // Filter questions for display
  const visibleQs = Array.from({ length: 100 }, (_, i) => i + 1).filter(q => {
    const entry = local[q] || {};
    const autoSubj = subjectForQuestion(syllabus, q, rangeOverride);
    const subjId = entry.subjectOverride || (autoSubj ? autoSubj.id : null);
    if (subjectFilter !== "all" && subjId !== subjectFilter) return false;
    if (guessFilter === "guessed" && !entry.isGuess) return false;
    if (guessFilter === "unguessed" && entry.isGuess) return false;
    if (searchQ) {
      const qStr = String(q);
      if (!qStr.includes(searchQ)) return false;
    }
    return true;
  });

  const answered   = Object.values(local).filter(e => e.answer).length;
  const guessCount = Object.values(local).filter(e => e.isGuess).length;

  return (
    <Modal title="OMR Answer Sheet" onClose={onClose} extraWide>
      {/* Top controls */}
      <div style={{
        display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16,
        padding: "12px 14px", background: T.surface, borderRadius: 8,
        border: `1px solid ${T.border}`, alignItems: "center",
      }}>
        <span style={{ fontFamily: "monospace", fontSize: 13, color: T.text2 }}>
          {answered}/100 answered &nbsp;·&nbsp; {guessCount} guesses
        </span>

        {/* Booklet selector */}
        {bookletOptions.length > 1 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.text2 }}>
            Booklet:
            {bookletOptions.map(bl => (
              <button key={bl}
                onClick={() => setSelBooklet(bl)}
                style={{
                  ...btnGhost, padding: "4px 12px", fontSize: 13, fontWeight: 700,
                  background: selBooklet === bl ? T.accent : "transparent",
                  color: selBooklet === bl ? "#fff" : T.text2,
                  borderColor: selBooklet === bl ? T.accent : T.border2,
                }}
              >{bl}</button>
            ))}
          </label>
        )}
        {bookletOptions.length === 1 && (
          <span style={{ fontSize: 12, color: T.text2 }}>
            Booklet: <strong style={{ color: T.accent2 }}>{bookletOptions[0]}</strong>
          </span>
        )}

        {/* Filters */}
        <select value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)}
          style={{ ...inputStyle, width: "auto", fontSize: 12, padding: "5px 8px" }}>
          <option value="all">All Subjects</option>
          {syllabus.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <select value={guessFilter} onChange={e => setGuessFilter(e.target.value)}
          style={{ ...inputStyle, width: "auto", fontSize: 12, padding: "5px 8px" }}>
          <option value="all">All Questions</option>
          <option value="guessed">Guesses Only</option>
          <option value="unguessed">Non-Guesses</option>
        </select>

        <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
          placeholder="Q number..." style={{ ...inputStyle, width: 100, fontSize: 12 }} />
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          ["🎯", T.cyan, "50:50 Guess"],
          ["🎲", T.orange, "Wild Guess"],
          ["DEL", T.red, "Deleted Question"],
        ].map(([sym, col, lbl]) => (
          <span key={lbl} style={{ fontSize: 11, color: T.text3, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: col, fontWeight: 700 }}>{sym}</span> {lbl}
          </span>
        ))}
        <span style={{ fontSize: 11, color: T.text3 }}>
          Tap guess icon to cycle: None → 🎯 50:50 → 🎲 Wild → None
        </span>
      </div>

      {/* Question rows */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 3 }}>
        {visibleQs.map(q => {
          const entry   = local[q] || {};
          const isDel   = deletedQs.has(q);
          const autoSubj = subjectForQuestion(syllabus, q, rangeOverride);
          const subjId  = entry.subjectOverride || (autoSubj ? autoSubj.id : null);
          const subj    = syllabus.subjects.find(s => s.id === subjId);
          const subjIdx = syllabus.subjects.findIndex(s => s.id === subjId);
          const subjColor = T.subjectColors[subjIdx % T.subjectColors.length] || T.text3;

          // Result indicator (if computed)
          let resultDot = null;
          if (computed?.perQuestion[q]) {
            const r = computed.perQuestion[q].result;
            const dotCol = r === "correct" ? T.green : r === "wrong" ? T.red : r === "deleted" ? T.text3 : T.text3;
            const dotSym = r === "correct" ? "✓" : r === "wrong" ? "✗" : r === "deleted" ? "⊘" : "—";
            resultDot = <span style={{ fontSize: 11, color: dotCol, fontWeight: 700, minWidth: 14 }}>{dotSym}</span>;
          }

          return (
            <div key={q} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 8px", borderRadius: 5,
              background: isDel ? T.red + "11" : entry.answer ? T.surface : "transparent",
              border: `1px solid ${isDel ? T.red + "44" : T.border}`,
              opacity: isDel ? 0.7 : 1,
            }}>
              {/* Q number */}
              <span style={{ fontSize: 11, color: T.text3, width: 24, textAlign: "right", fontFamily: "monospace", flexShrink: 0 }}>
                {q}
              </span>

              {/* Subject badge — tappable */}
              <div style={{ flexShrink: 0, width: 72 }}>
                {isDel ? (
                  <Badge label="DEL" color={T.red} />
                ) : (
                  <select
                    value={subjId || ""}
                    onChange={e => setField(q, "subjectOverride", e.target.value || null)}
                    style={{
                      background: subjColor + "22", color: subjColor,
                      border: `1px solid ${subjColor}44`, borderRadius: 4,
                      fontSize: 9, padding: "2px 3px", cursor: "pointer",
                      fontFamily: "inherit", width: "100%",
                    }}
                  >
                    <option value="">—</option>
                    {syllabus.subjects.map(s => (
                      <option key={s.id} value={s.id}>{s.name.slice(0, 12)}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Answer bubbles */}
              {isDel ? (
                <span style={{ fontSize: 10, color: T.red, flex: 1, textAlign: "center" }}>Deleted — excluded</span>
              ) : (
                <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                  {OPTS.map(o => (
                    <button key={o}
                      onClick={() => setField(q, "answer", entry.answer === o ? null : o)}
                      style={{
                        width: 26, height: 26, borderRadius: "50%",
                        border: `2px solid ${entry.answer === o ? T.accent : T.border2}`,
                        background: entry.answer === o ? T.accent : "transparent",
                        color: entry.answer === o ? "#fff" : T.text2,
                        fontSize: 11, fontWeight: 700, cursor: "pointer",
                        transition: "all 0.1s",
                      }}
                    >{o}</button>
                  ))}
                </div>
              )}

              {/* Guess toggle */}
              {!isDel && (
                <button
                  onClick={() => toggleGuess(q)}
                  disabled={!entry.answer}
                  title={entry.isGuess ? `${entry.guessType === "5050" ? "50:50" : "Wild"} guess — tap to cycle` : "Mark as guess"}
                  style={{
                    background: "transparent", border: "none", cursor: entry.answer ? "pointer" : "default",
                    fontSize: 14, opacity: entry.answer ? 1 : 0.3, flexShrink: 0, padding: "2px",
                  }}
                >
                  {!entry.isGuess ? "⬜" : entry.guessType === "5050" ? "🎯" : "🎲"}
                </button>
              )}

              {/* Topic tag */}
              {!isDel && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SearchSelect
                    options={topicOptions}
                    value={entry.topicId}
                    onChange={v => setField(q, "topicId", v)}
                    placeholder="Tag topic…"
                  />
                </div>
              )}

              {/* Result dot */}
              {resultDot}
            </div>
          );
        })}
      </div>

      {/* Score result panel */}
      {computed && (
        <div style={{
          marginTop: 16, padding: "14px 16px", background: T.surface,
          borderRadius: 8, border: `1px solid ${T.green}44`,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.green, marginBottom: 10 }}>
            ✓ Score Calculated
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
            {[
              ["Total Marks", computed.totalMarks.toFixed(2), scoreColor(pct(computed.totalMarks, 100))],
              ["Correct",     computed.totalCorrect,           T.green],
              ["Wrong",       computed.totalWrong,             T.red],
              ["Deleted",     computed.totalDeleted,           T.text3],
            ].map(([l, v, c]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: c, fontFamily: "monospace" }}>{v}</div>
                <div style={{ fontSize: 10, color: T.text3 }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: T.text3 }}>
            Penalty: <span style={{ color: T.orange }}>−{computed.totalPenalty.toFixed(2)}</span>
            &nbsp;·&nbsp; Unattempted: {computed.totalUnattempted}
          </div>
        </div>
      )}

      {showCalcError && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: T.red + "22", borderRadius: 6, fontSize: 12, color: T.red }}>
          ⚠ {showCalcError}
        </div>
      )}

      <div style={{
        display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center",
        marginTop: 20, paddingTop: 16, borderTop: `1px solid ${T.border}`,
      }}>
        <button onClick={handleCalculate} style={btnPrimary(T.yellow, "#000")}>
          ⚡ Calculate Score
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={handleSave} style={btnPrimary(T.accent)}>Save OMR →</button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAPER FORM — Full entry form with 5 tabs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PaperForm — tabbed form for adding or editing a paper entry.
 * Tabs: Meta | Answer Key | OMR | Guesswork | Content
 */

// ─── RE-EXPORTS for AppSyllabusPart2 ─────────────────────────────────────────
// (AppSyllabusPart2 imports these from here)
