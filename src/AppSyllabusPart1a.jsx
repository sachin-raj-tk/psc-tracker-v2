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

import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  T, inputStyle, btnPrimary, btnGhost, cardStyle,
  uid, pct, scoreColor, fmtDate, clamp,
  calcMarks, computeScoreFromOMR, subjectForQuestion,
  validate, matchSearch,
  Bar, Badge, Modal, Section, NumInput, FieldError,
  SearchSelect, ConfirmDialog, useUnsavedWarning,
} from "./AppCore";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build topic options for SearchSelect.
 * Label is prefixed with [N] topicNo so users can cross-reference their
 * numbered syllabus docx while tagging questions in the OMR sheet.
 */
export const buildTopicOptions = (syllabus) =>
  (syllabus?.subjects || []).flatMap(s =>
    (s.topics || []).map(t => ({
      id:    t.id,
      label: t.topicNo ? `[${t.topicNo}] ${t.name}` : t.name,
      group: s.name,
    }))
  );

/**
 * Generate an empty OMR object (100 questions, all null).
 * IMPORTANT: Keys are STRINGS ("1"..."100") to match JSON round-trip behaviour.
 * JSON.parse always produces string keys for numeric object keys.
 * Using string keys here ensures { ...emptyOMR(), ...savedOMR } merges correctly.
 */
export const emptyOMR = () => {
  const omr = {};
  for (let i = 1; i <= 100; i++) {
    omr[String(i)] = { answer: null, isGuess: false, guessType: null, topicId: null, subjectOverride: null };
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

// ═══════════════════════════════════════════════════════════════════════════════
// SYLLABUS DOCX PARSER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse a numbered syllabus docx text (extracted via JSZip).
 *
 * Expected format in the docx:
 *   ### SubjectName (N Marks, Q1-Q10, Topics 1-25)
 *   [1] Topic name one
 *   [2] Topic name two
 *   ...
 *   ### NextSubject (N Marks, Q11-Q15, Topics 26-50)
 *   [26] Topic name ...
 *
 * Returns:
 *   { examName, subjects: [{ name, maxMarks, qStart, qEnd, topics:[{topicNo,name}] }], warnings }
 *
 * Fully flexible: any number of subjects, any order, any topic count.
 * The Q-range (Q1-Q10) is optional — if missing, qStart/qEnd will be null.
 */
export function parseSyllabusDocx(rawText) {
  const warnings = [];

  // Fix HTML entities present in XML-extracted text
  const clean = rawText
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');

  const lines = clean.split("\n").map(l => l.trim());

  // First meaningful line is the exam name
  const examName = lines.find(l => l.length > 3 && !l.startsWith("#"))
    || "Imported Syllabus";

  // Subject header — literal ### as stored in docx XML (not pandoc-escaped)
  // Format: ### SubjectName (10 Marks, Q1-Q10, Topics 1-25)
  // Q-range is optional: ### SubjectName (10 Marks, Topics 1-25)
  const subjRe = /^###\s+(.+?)\s+\((\d+)\s+Marks?(?:,\s*Q(\d+)-Q(\d+))?/i;

  // Topic number alone on its own line — name on the next non-empty line
  // This is how the docx XML extracts: [1] on one line, name on the next
  const topicNoRe = /^\[(\d+)\]$/;

  // Also handle [N] Name on same line (pandoc output or manually typed)
  const topicSameRe = /^\[(\d+)\]\s+(.+)/;

  const subjects = [];
  let cur = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Subject header
    const sm = subjRe.exec(line);
    if (sm) {
      if (cur) subjects.push(cur);
      cur = {
        name:     sm[1].trim(),
        maxMarks: parseInt(sm[2]) || 0,
        qStart:   sm[3] ? parseInt(sm[3]) : null,
        qEnd:     sm[4] ? parseInt(sm[4]) : null,
        topics:   [],
      };
      i++;
      continue;
    }

    // [N] alone on line — name is on next non-empty line
    const tm = topicNoRe.exec(line);
    if (tm) {
      const topicNo = parseInt(tm[1]);
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const name = lines[j] ? lines[j].trim() : "";
      if (name && !name.startsWith("[") && !name.startsWith("###") && name.length > 1) {
        if (!cur) cur = { name: "Uncategorised", maxMarks: 0, qStart: null, qEnd: null, topics: [] };
        cur.topics.push({ topicNo, name });
        i = j + 1;
        continue;
      }
    }

    // [N] Name on same line
    const sl = topicSameRe.exec(line);
    if (sl) {
      const topicNo = parseInt(sl[1]);
      const name    = sl[2].trim();
      if (!cur) cur = { name: "Uncategorised", maxMarks: 0, qStart: null, qEnd: null, topics: [] };
      cur.topics.push({ topicNo, name });
      i++;
      continue;
    }

    i++;
  }
  if (cur && cur.topics.length > 0) subjects.push(cur);

  // Validation
  if (subjects.length === 0)
    warnings.push("No subjects found. Check the ### Subject (N Marks, Q1-QN) header format.");
  const totalTopics = subjects.reduce((a, s) => a + s.topics.length, 0);
  if (totalTopics === 0)
    warnings.push("No topics found. Check the [N] Topic name format.");
  const totalMarks = subjects.reduce((a, s) => a + s.maxMarks, 0);
  if (totalMarks > 0 && totalMarks !== 100)
    warnings.push(`Total marks sum to ${totalMarks}, not 100. Verify subject marks.`);
  const missingQRanges = subjects.filter(s => s.qStart === null).map(s => s.name);
  if (missingQRanges.length > 0)
    warnings.push(`Q-range missing for: ${missingQRanges.join(", ")}. Add Q1-QN to subject headers or set manually.`);

  return { examName, subjects, totalTopics, totalMarks, warnings };
}


export function parseTopicMapDocx(rawText) {
  const warnings  = [];
  const qToTopicNo = {};

  // Fix HTML entities
  const clean = rawText
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&quot;/g, '"');

  // The frequency docx table has each cell as a separate text run (one per line).
  // Row structure: topicNo | topicName | qNos (or "---") | count
  // We scan consecutive runs looking for this 4-cell pattern.
  const runs = clean.split("\n").map(r => r.trim()).filter(r => r.length > 0);

  let i = 0;
  while (i < runs.length - 3) {
    const r0 = runs[i];       // potential topicNo
    const r1 = runs[i + 1];   // potential topicName
    const r2 = runs[i + 2];   // potential qNos ("---" or "5" or "6, 7")
    const r3 = runs[i + 3];   // potential count

    const isTopicNo = /^\d{1,3}$/.test(r0);
    const isName    = r1.length > 2 && !/^\d+$/.test(r1);
    const isQNos    = /^[\d,\s]+$/.test(r2) || r2 === "---";
    const isCount   = /^\d+$/.test(r3);

    if (isTopicNo && isName && isQNos && isCount) {
      const topicNo = parseInt(r0);
      if (r2 !== "---") {
        r2.split(",").forEach(s => {
          // Strip trailing annotations like * (marks deleted questions)
          const qStr = s.trim().replace(/[^\d]/g, "");
          const q = parseInt(qStr);
          if (!isNaN(q) && q >= 1 && q <= 200) {
            if (qToTopicNo[q] !== undefined) {
              warnings.push(`Q${q} appears under multiple topics. Using topic ${topicNo}.`);
            }
            qToTopicNo[q] = topicNo;
          }
        });
      }
      i += 4;
      continue;
    }
    i++;
  }

  const tagged = Object.keys(qToTopicNo).length;
  if (tagged === 0)
    warnings.push("No question-topic mappings found. Check the docx table format.");
  else if (tagged < 30)
    warnings.push(`Only ${tagged} questions tagged. Verify the docx format.`);

  return { qToTopicNo, tagged, warnings };
}


// ═══════════════════════════════════════════════════════════════════════════════
// SMART OMR SHEET
// ═══════════════════════════════════════════════════════════════════════════════


/**
 * AnswerKeyUploader — upload, parse, display, and manually edit an answer key.
 *
 * After upload the full parsed table is shown (all booklets side-by-side for
 * multi-booklet, single column for single-booklet). Every cell is directly
 * editable so the user can fix any parse errors before saving.
 *
 * Allowed cell values: A, B, C, D, X (deleted). Invalid values are highlighted.
 */
export function AnswerKeyUploader({ existing, onParsed, syllabus }) {
  const [status,   setStatus]   = useState(existing ? "done" : null);
  const [result,   setResult]   = useState(existing || null);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirm,  setConfirm]  = useState(false);
  const [viewBooklet, setViewBooklet] = useState(
    existing?.type === "multi" ? "A" : existing?.singleCode || "A"
  );
  const fileRef = useRef();

  // ── Docx extraction ──────────────────────────────────────────────────────
  /**
   * Extract text from a .docx file using JSZip.
   * A .docx is a ZIP archive containing word/document.xml (deflate-compressed).
   * We must decompress it properly — raw byte reading does NOT work on
   * compressed ZIP entries, which is why all .docx files produced 0 parsed answers.
   * JSZip is loaded from cdnjs via a <script> tag in index.html.
   */
  const extractDocxText = async (arrayBuffer) => {
    // Load JSZip — it is injected via <script> in index.html
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error("JSZip not loaded. Check index.html script tag.");

    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file("word/document.xml");
    if (!docXmlFile) throw new Error("word/document.xml not found in docx.");

    const xml = await docXmlFile.async("string");
    const runs = [];
    const re = new RegExp("<w:t[^>]*>([^<]+)</" + "w:t>", "g");
    let m;
    while ((m = re.exec(xml)) !== null) runs.push(m[1]);
    return runs.join(" ");
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.name.endsWith(".docx")) { setErrorMsg("Only .docx files are accepted."); return; }
    if (file.size > 5 * 1024 * 1024) { setErrorMsg("File is over 5MB."); return; }
    setStatus("parsing"); setErrorMsg("");
    try {
      const arrayBuffer = await file.arrayBuffer();
      const text = await extractDocxText(arrayBuffer);
      const parsed = parseAnswerKeyText(text);
      parsed.fileName = file.name;
      const initBooklet = parsed.type === "multi" ? "A" : parsed.singleCode || "A";
      setViewBooklet(initBooklet);
      setResult(parsed);
      setStatus("done");
      onParsed(parsed);
    } catch (err) {
      setStatus("error");
      setErrorMsg("Could not parse the file: " + (err.message || "unknown error"));
    }
  };

  const triggerUpload = () => {
    if (result && !confirm) { setConfirm(true); return; }
    setConfirm(false);
    fileRef.current?.click();
  };

  // ── Cell edit handler ─────────────────────────────────────────────────────
  // Allows user to fix any incorrectly parsed answer directly in the grid.
  const handleCellEdit = (q, booklet, val) => {
    const v = val.toUpperCase().trim();
    if (!["A","B","C","D","X",""].includes(v)) return; // only valid values
    setResult(prev => {
      const next = { ...prev };
      if (next.type === "multi") {
        next.booklets = { ...next.booklets, [booklet]: { ...next.booklets[booklet], [String(q)]: v || null } };
        // Keep deletedQuestions in sync
        const delArr = Object.entries(next.booklets[booklet])
          .filter(([,ans]) => ans === "X").map(([k]) => parseInt(k));
        next.deletedQuestions = { ...next.deletedQuestions, [booklet]: delArr };
      } else {
        next.singleAnswers = { ...next.singleAnswers, [String(q)]: v || null };
        const delArr = Object.entries(next.singleAnswers)
          .filter(([,ans]) => ans === "X").map(([k]) => parseInt(k));
        next.deletedQuestions = { ...next.deletedQuestions, [next.singleCode]: delArr };
      }
      onParsed(next); // propagate each edit immediately
      return next;
    });
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const bookletLetters = result
    ? (result.type === "multi" ? ["A","B","C","D"] : [result.singleCode])
    : [];

  const getAnswers = (bl) => {
    if (!result) return {};
    if (result.type === "multi")  return result.booklets?.[bl] || {};
    return result.singleAnswers || {};
  };

  const VALID = ["A","B","C","D","X"];

  // Cell colour: X=red, missing=yellow, valid=normal
  const cellColor = (val) => {
    if (!val)       return T.yellow;
    if (val === "X") return T.red;
    return T.text;
  };
  const cellBg = (val) => {
    if (!val)       return T.yellow + "22";
    if (val === "X") return T.red + "22";
    return T.surface;
  };

  return (
    <div>
      <input ref={fileRef} type="file" accept=".docx" style={{ display: "none" }}
        onChange={e => handleFile(e.target.files[0])} />

      {confirm && (
        <ConfirmDialog
          message="Replace the existing answer key?"
          detail="Any manual corrections you made will be lost."
          confirmLabel="Replace" danger
          onConfirm={() => { setConfirm(false); fileRef.current?.click(); }}
          onCancel={() => setConfirm(false)}
        />
      )}

      {/* Upload button */}
      <button onClick={triggerUpload} style={btnPrimary(result ? T.teal : T.accent)}>
        {status === "parsing" ? "Parsing…"
          : result ? `↺ Replace Key (${result.fileName || "uploaded"})`
          : "Upload Answer Key (.docx)"}
      </button>

      {errorMsg && <FieldError msg={errorMsg} />}

      {/* ── Parsed result + editor ── */}
      {result && (
        <div style={{ marginTop: 14 }}>
          {/* Summary strip */}
          <div style={{
            background: T.surface, borderRadius: 8,
            padding: "10px 14px", border: `1px solid ${T.border}`,
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.green, marginBottom: 6 }}>
              ✓ {result.fileName || "Answer key"} parsed
            </div>
            <div style={{ fontSize: 11, color: T.text2, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span>Format: <strong style={{ color: T.text }}>
                {result.type === "multi" ? "Multi-booklet (A / B / C / D)" : `Single booklet (${result.singleCode})`}
              </strong></span>
              {bookletLetters.map(bl => {
                const ans = getAnswers(bl);
                const total = Object.values(ans).filter(Boolean).length;
                const del   = (result.deletedQuestions?.[bl] || []).length;
                const miss  = 100 - total;
                return (
                  <span key={bl}>
                    <strong style={{ color: T.accent2 }}>{bl}</strong>: {total} parsed
                    {del  > 0 && <span style={{ color: T.red    }}> · {del} deleted (X)</span>}
                    {miss > 0 && <span style={{ color: T.yellow }}> · {miss} missing</span>}
                  </span>
                );
              })}
            </div>
            {result.parseWarnings?.length > 0 && (
              <div style={{ color: T.yellow, fontSize: 11, marginTop: 6 }}>
                ⚠ {result.parseWarnings.join(" | ")}
              </div>
            )}
          </div>

          {/* Booklet tab selector (multi-booklet only) */}
          {result.type === "multi" && (
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: T.text3, alignSelf: "center", marginRight: 4 }}>
                View / edit booklet:
              </span>
              {["A","B","C","D"].map(bl => (
                <button key={bl} onClick={() => setViewBooklet(bl)}
                  style={{
                    ...btnGhost, padding: "5px 14px", fontSize: 13, fontWeight: 800,
                    background:  viewBooklet === bl ? T.accent + "33" : "transparent",
                    color:       viewBooklet === bl ? T.accent2         : T.text2,
                    borderColor: viewBooklet === bl ? T.accent           : T.border2,
                    borderRadius: 8,
                  }}>
                  {bl}
                </button>
              ))}
            </div>
          )}

          {/* Instructions */}
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 10, lineHeight: 1.6 }}>
            Tap any cell to correct a wrong answer. Valid values: A B C D X (X = deleted question).
            <span style={{ color: T.yellow }}> Yellow</span> = missing (not parsed),
            <span style={{ color: T.red    }}> Red</span> = deleted (X).
            Changes save automatically.
          </div>

          {/* Answer grid — 10 rows × 10 cols = 100 questions */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ padding: "4px 8px", color: T.text3, fontSize: 10, textAlign: "left", borderBottom: `1px solid ${T.border}` }}>Q</th>
                  <th style={{ padding: "4px 8px", color: T.accent2, fontSize: 11, borderBottom: `1px solid ${T.border}`, textAlign: "center" }}>Ans</th>
                  <th style={{ width: 16 }} />
                  <th style={{ padding: "4px 8px", color: T.text3, fontSize: 10, textAlign: "left", borderBottom: `1px solid ${T.border}` }}>Q</th>
                  <th style={{ padding: "4px 8px", color: T.accent2, fontSize: 11, borderBottom: `1px solid ${T.border}`, textAlign: "center" }}>Ans</th>
                  <th style={{ width: 16 }} />
                  <th style={{ padding: "4px 8px", color: T.text3, fontSize: 10, textAlign: "left", borderBottom: `1px solid ${T.border}` }}>Q</th>
                  <th style={{ padding: "4px 8px", color: T.accent2, fontSize: 11, borderBottom: `1px solid ${T.border}`, textAlign: "center" }}>Ans</th>
                  <th style={{ width: 16 }} />
                  <th style={{ padding: "4px 8px", color: T.text3, fontSize: 10, textAlign: "left", borderBottom: `1px solid ${T.border}` }}>Q</th>
                  <th style={{ padding: "4px 8px", color: T.accent2, fontSize: 11, borderBottom: `1px solid ${T.border}`, textAlign: "center" }}>Ans</th>
                  <th style={{ width: 16 }} />
                  <th style={{ padding: "4px 8px", color: T.text3, fontSize: 10, textAlign: "left", borderBottom: `1px solid ${T.border}` }}>Q</th>
                  <th style={{ padding: "4px 8px", color: T.accent2, fontSize: 11, borderBottom: `1px solid ${T.border}`, textAlign: "center" }}>Ans</th>
                </tr>
              </thead>
              <tbody>
                {/* 20 rows, 5 question pairs per row = 100 questions */}
                {Array.from({ length: 20 }, (_, row) => {
                  // Each row covers 5 questions in two halves: 1-50 (odd rows) and 51-100 (even rows)
                  // Layout: Q1 | Q51 | gap | Q2 | Q52 | gap | ... Q5 | Q55
                  const qNums = [
                    row + 1,       // col 1: Q1..Q20
                    row + 21,      // col 2: Q21..Q40
                    row + 41,      // col 3: Q41..Q60
                    row + 61,      // col 4: Q61..Q80
                    row + 81,      // col 5: Q81..Q100
                  ];
                  const answers = getAnswers(viewBooklet);

                  return (
                    <tr key={row} style={{ borderBottom: `1px solid ${T.border}` }}>
                      {qNums.map((q, ci) => {
                        const val = answers[String(q)] || "";
                        const isInvalid = val && !VALID.includes(val);
                        return (
                          <React.Fragment key={q}>
                            {ci > 0 && <td style={{ width: 12, background: T.bg }} />}
                            {/* Q number */}
                            <td style={{
                              padding: "5px 8px", color: T.text3,
                              fontSize: 11, fontFamily: "monospace",
                              whiteSpace: "nowrap",
                            }}>
                              {q}
                            </td>
                            {/* Editable answer cell */}
                            <td style={{ padding: "3px 4px" }}>
                              <input
                                value={val}
                                maxLength={1}
                                onChange={e => handleCellEdit(q, viewBooklet, e.target.value)}
                                style={{
                                  width: 36, height: 32, textAlign: "center",
                                  fontFamily: "monospace", fontWeight: 800, fontSize: 14,
                                  background: isInvalid ? T.red + "33" : cellBg(val),
                                  color: isInvalid ? T.red : cellColor(val),
                                  border: `1px solid ${isInvalid ? T.red : val === "X" ? T.red + "66" : !val ? T.yellow + "66" : T.border}`,
                                  borderRadius: 6,
                                  outline: "none",
                                  textTransform: "uppercase",
                                  cursor: "text",
                                }}
                              />
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Summary of issues */}
          {(() => {
            const answers = getAnswers(viewBooklet);
            const missing = Array.from({length:100},(_,i)=>i+1).filter(q => !answers[String(q)]);
            const deleted = Array.from({length:100},(_,i)=>i+1).filter(q => answers[String(q)] === "X");
            if (missing.length === 0 && deleted.length === 0) return (
              <div style={{ marginTop: 10, fontSize: 11, color: T.green }}>
                ✓ All 100 answers present for booklet {viewBooklet}
              </div>
            );
            return (
              <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.8 }}>
                {missing.length > 0 && (
                  <div style={{ color: T.yellow }}>
                    ⚠ Missing ({missing.length}): Q{missing.join(", Q")}
                  </div>
                )}
                {deleted.length > 0 && (
                  <div style={{ color: T.red }}>
                    ⊘ Deleted/X ({deleted.length}): Q{deleted.join(", Q")}
                  </div>
                )}
              </div>
            );
          })()}
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
  const [local, setLocal] = useState(() => ({ ...emptyOMR(), ...omr }));

  // Auto-initialise selBooklet:
  // - single-booklet key -> use that code automatically (no user input needed)
  // - multi-booklet key  -> use previously saved bookletCode or prompt user
  // - no key             -> use saved bookletCode (manual entry)
  const initBooklet = () => {
    if (answerKey?.type === "single") return answerKey.singleCode || "A";
    return bookletCode || "";
  };
  const [selBooklet, setSelBooklet]         = useState(initBooklet);
  const [manualBooklet, setManualBooklet]   = useState(bookletCode || "A");
  const [subjectFilter, setSubjectFilter]   = useState("all");
  const [guessFilter, setGuessFilter]       = useState("all");
  const [searchQ, setSearchQ]               = useState("");
  const [computed, setComputed]             = useState(null);
  const [showCalcError, setShowCalcError]   = useState("");
  const topicOptions                        = buildTopicOptions(syllabus);

  /**
   * Get the answer key map for the selected booklet.
   * CRITICAL FIX: After JSON round-trip through localStorage, numeric object
   * keys become strings (e.g. {1:"C"} -> {"1":"C"}). We normalise all keys
   * to strings so keyAnswers[String(q)] always resolves correctly.
   */
  const getKeyAnswers = () => {
    if (!answerKey) return null;
    let raw = null;
    if (answerKey.type === "multi")  raw = answerKey.booklets?.[selBooklet] || null;
    if (answerKey.type === "single") raw = answerKey.singleAnswers || null;
    if (!raw) return null;
    // Normalise: rebuild map with string keys
    const norm = {};
    for (const [k, v] of Object.entries(raw)) norm[String(k)] = v;
    return norm;
  };

  // Get deleted question numbers for selected booklet
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
    setLocal(prev => ({ ...prev, [String(q)]: { ...prev[String(q)], [field]: value } }));

  const toggleGuess = (q) => {
    const cur = local[String(q)];
    if (!cur.answer) return; // Can't mark guess without an answer
    if (!cur.isGuess) {
      setLocal(prev => ({ ...prev, [String(q)]: { ...prev[String(q)], isGuess: true, guessType: "5050" } }));
    } else if (cur.guessType === "5050") {
      setLocal(prev => ({ ...prev, [String(q)]: { ...prev[String(q)], guessType: "wild" } }));
    } else {
      setLocal(prev => ({ ...prev, [String(q)]: { ...prev[String(q)], isGuess: false, guessType: null } }));
    }
  };

  const handleCalculate = () => {
    // Multi-booklet requires user to pick a column
    if (answerKey?.type === "multi" && !selBooklet) {
      setShowCalcError("Please tap your booklet version (A / B / C / D) above before calculating.");
      return;
    }
    const keyAnswers = getKeyAnswers();
    if (!keyAnswers) {
      setShowCalcError("No answer key uploaded for this paper. Upload a key first, then Calculate.");
      return;
    }
    const answered = Object.values(local).filter(e => e.answer).length;
    if (answered === 0) {
      setShowCalcError("No answers recorded yet. Fill in the OMR bubbles first.");
      return;
    }
    if (answered < 50) {
      if (!window.confirm(`Only ${answered} answers recorded. Calculate anyway?`)) return;
    }
    setShowCalcError("");
    const result = computeScoreFromOMR(local, keyAnswers, syllabus, rangeOverride);
    setComputed(result);
  };

  // Save OMR + computed scores + the booklet code that was used
  const handleSave = () => {
    const finalBooklet = answerKey?.type === "single"
      ? answerKey.singleCode
      : selBooklet || manualBooklet;
    onSave({ omr: local, computed, bookletCode: finalBooklet });
  };

  // bookletOptions retained for any remaining references
  const bookletOptions = answerKey
    ? (answerKey.type === "multi" ? ["A","B","C","D"] : [answerKey.singleCode])
    : [];

  // Filter questions for display
  const visibleQs = Array.from({ length: 100 }, (_, i) => i + 1).filter(q => {
    const entry = local[String(q)] || {};
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

        {/* ── Booklet selector ──
            3 cases:
            1. Multi-booklet key   → show A/B/C/D tap buttons (user must pick)
            2. Single-booklet key  → show locked label (auto-detected from file)
            3. No answer key       → show manual A/B/C/D tap buttons so booklet
                                     code is recorded with the paper for reference */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: T.text2, flexShrink: 0 }}>My Booklet:</span>

          {/* Case 1: multi-booklet — user picks */}
          {answerKey?.type === "multi" && ["A","B","C","D"].map(bl => (
            <button key={bl} onClick={() => setSelBooklet(bl)}
              style={{
                ...btnGhost, padding: "6px 14px", fontSize: 14, fontWeight: 800,
                background: selBooklet === bl ? T.accent : "transparent",
                color:      selBooklet === bl ? "#fff"    : T.text2,
                borderColor:selBooklet === bl ? T.accent  : T.border2,
                minWidth: 40, borderRadius: 8,
              }}
            >{bl}</button>
          ))}

          {/* Case 2: single-booklet — locked, show what was detected */}
          {answerKey?.type === "single" && (
            <span style={{
              background: T.accent + "22", color: T.accent2,
              fontWeight: 800, fontSize: 15, padding: "5px 16px",
              borderRadius: 8, border: `1px solid ${T.accent}44`,
              letterSpacing: "0.05em",
            }}>
              {answerKey.singleCode}
              <span style={{ fontSize: 10, color: T.text3, marginLeft: 6, fontWeight: 400 }}>
                (from key file)
              </span>
            </span>
          )}

          {/* Case 3: no answer key — manual selection for record-keeping */}
          {!answerKey && ["A","B","C","D"].map(bl => (
            <button key={bl} onClick={() => { setManualBooklet(bl); setSelBooklet(bl); }}
              style={{
                ...btnGhost, padding: "6px 14px", fontSize: 14, fontWeight: 800,
                background: manualBooklet === bl ? T.purple + "44" : "transparent",
                color:      manualBooklet === bl ? T.purple          : T.text2,
                borderColor:manualBooklet === bl ? T.purple          : T.border2,
                minWidth: 40, borderRadius: 8,
              }}
            >{bl}</button>
          ))}

          {!answerKey && (
            <span style={{ fontSize: 11, color: T.text3 }}>
              (no key uploaded — for record only)
            </span>
          )}
        </div>

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
          const entry   = local[String(q)] || {};
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
