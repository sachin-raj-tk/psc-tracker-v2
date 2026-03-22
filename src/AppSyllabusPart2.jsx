/**
 * AppSyllabusPart2.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Second part of syllabus/paper UI module.
 * Contains:
 *   - PaperForm       — full tabbed paper entry form
 *   - PaperDetail     — read-only paper summary view
 *   - ContentReader   — text/docx/pdf viewer
 *   - SyllabusEditor  — create/edit syllabi
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useEffect } from "react";
import {
  T, inputStyle, btnPrimary, btnGhost, cardStyle,
  uid, pct, scoreColor, fmtDate, todayStr,
  Bar, Badge, Modal, Section, NumInput, FieldError,
  SearchSelect, ConfirmDialog, useUnsavedWarning,
} from "./AppCore";

import {
  emptyPaper, emptyOMR,
  buildTopicOptions, OPTS,
  parseExplanationDocx,
} from "./AppSyllabusPart1a";

import {
  AnswerKeyUploader, SmartOMR,
  SyllabusImporter, TopicMapImporter,
} from "./AppSyllabusPart1b";

export function PaperForm({ syllabus, syllabi, onChangeSyllabus, initial, onSave, onSaveSilent, onClose }) {
  const [form, setForm]         = useState(initial || emptyPaper(syllabus));
  const [tab, setTab]           = useState("meta");
  const [errors, setErrors]     = useState({});
  const [dirty, setDirty]       = useState(false);
  const [showOMR, setShowOMR]   = useState(false);
  const [showQViewer, setShowQViewer] = useState(false);

  // Autosave draft to sessionStorage every 5 seconds
  useEffect(() => {
    if (!dirty) return;
    const t = setInterval(() => {
      try { sessionStorage.setItem("psc-draft-paper", JSON.stringify(form)); } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(t);
  }, [form, dirty]);

  useUnsavedWarning(dirty);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };
  const setGuess = (k, v) => { setForm(f => ({ ...f, guesses: { ...f.guesses, [k]: v } })); setDirty(true); };
  const setContent = (k, v) => { setForm(f => ({ ...f, content: { ...f.content, [k]: v } })); setDirty(true); };

  // Validation
  const validate_ = () => {
    const e = {};
    if (!form.name?.trim() || form.name.trim().length < 3)
      e.name = "Paper name must be at least 3 characters";
    if (form.date && form.date > new Date().toISOString().slice(0,10))
      e.date = "Date cannot be in the future";
    if (form.notes?.length > 1000)
      e.notes = "Notes must be under 1000 characters";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate_()) { setTab("meta"); return; }
    sessionStorage.removeItem("psc-draft-paper");
    onSave(form);
  };

  // Called on every OMR change (answer tap, guess toggle, topic tag)
  // Updates form state. When computed score is present (Calculate was clicked),
  // also auto-saves to IndexedDB via onSaveSilent (does NOT close modal).
  const handleOMRUpdate = ({ omr, computed, bookletCode }) => {
    const updated = { ...form, omr, computed, bookletCode };
    setForm(updated);
    setDirty(true);
    // Write to sessionStorage as safety net
    try {
      sessionStorage.setItem("psc-draft-paper", JSON.stringify(updated));
    } catch { /* ignore quota errors */ }
    // Auto-save to IndexedDB whenever score is calculated so closing is safe
    if (computed && onSaveSilent) {
      onSaveSilent(updated);
    }
  };

  // Called only when user taps "Close OMR" — closes the sheet
  const handleOMRClose = () => {
    setShowOMR(false);
    window.__pscAutoSync?.();
  };

  const answered   = Object.values(form.omr || {}).filter(e => e?.answer).length;
  const guessCount = Object.values(form.omr || {}).filter(e => e?.isGuess).length;
  const totalMarks = form.computed?.totalMarks;

  const tabStyle = (t) => ({
    padding: "8px 14px", fontSize: 12, fontWeight: 600,
    background: "transparent", border: "none", cursor: "pointer",
    color: tab === t ? T.text : T.text3,
    borderBottom: tab === t ? `2px solid ${T.accent}` : "2px solid transparent",
  });

  // PDF handler
  const pdfRef = useRef();
  const handlePDF = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      alert("PDF is over 4MB. Consider compressing it first.");
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => setContent("pdfData", ev.target.result);
    reader.readAsDataURL(file);
    setContent("pdfName", file.name);
  };

  // Docx content handler — uses JSZip to decompress (same fix as answer key)
  const docxRef = useRef();
  const handleDocx = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith(".docx")) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const JSZip = window.JSZip;
      const zip = await JSZip.loadAsync(arrayBuffer);
      const docXml = await zip.file("word/document.xml").async("string");
      const textRuns = [];
      const re = new RegExp("<w:t[^>]*>([^<]+)</" + "w:t>", "g");
      let m;
      while ((m = re.exec(docXml)) !== null) textRuns.push(m[1]);
      setContent("docxExtracted", textRuns.join("\n"));
      setContent("docxName", file.name);
    } catch (err) {
      alert("Could not read docx: " + (err.message || "unknown error"));
    }
  };

  // Explanation docx handler — parses ##PSC_Q## format, stores only JSON, discards binary
  const explRef = useRef();
  const handleExplDocx = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith(".docx")) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const JSZip = window.JSZip;
      const zip = await JSZip.loadAsync(arrayBuffer);
      const docXml = await zip.file("word/document.xml").async("string");
      const textRuns = [];
      const re2 = new RegExp("<w:t[^>]*>([^<]+)</" + "w:t>", "g");
      let m2;
      while ((m2 = re2.exec(docXml)) !== null) textRuns.push(m2[1]);
      const rawText = textRuns.join("\n");
      const { questions, count, warnings } = parseExplanationDocx(rawText);
      if (count === 0) {
        alert("No questions found in this file. Check the ##PSC_Q## format.");
        return;
      }
      // Store parsed JSON only — discard the docx binary entirely
      setForm(f => ({ ...f, questions }));
      setDirty(true);
      if (warnings.length > 0) alert("Parsed with warnings:\n" + warnings.join("\n"));
      else alert("✓ " + count + " questions parsed and stored.");
    } catch (err) {
      alert("Could not read explanation docx: " + (err.message || "unknown error"));
    }
    // Reset input so same file can be re-uploaded
    e.target.value = "";
  };

  return (
    <>
      <Modal title={initial ? "Edit Paper" : "Add New Paper"} onClose={onClose} extraWide>

        {/* Syllabus selector — only shown when adding new paper and multiple syllabi exist */}
        {!initial && syllabi && syllabi.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
            padding: "8px 12px", background: T.surface, borderRadius: 8,
            border: "1px solid " + T.border }}>
            <span style={{ fontSize: 12, color: T.text3, flexShrink: 0 }}>Adding to:</span>
            <select
              value={syllabus.id}
              onChange={e => onChangeSyllabus && onChangeSyllabus(e.target.value)}
              style={{ ...inputStyle, fontSize: 12, padding: "4px 8px", flex: 1 }}>
              {syllabi.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
        {!initial && (!syllabi || syllabi.length <= 1) && (
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 12 }}>
            {"Adding to: " + syllabus.name}
          </div>
        )}

        {/* Score banner */}
        {totalMarks !== undefined && totalMarks !== null && (
          <div style={{
            display: "flex", gap: 20, alignItems: "center",
            background: T.surface, borderRadius: 8,
            padding: "10px 16px", marginBottom: 16,
            border: `1px solid ${T.border}`,
          }}>
            <span style={{ fontSize: 26, fontWeight: 900, fontFamily: "monospace", color: scoreColor(pct(totalMarks, 100)) }}>
              {totalMarks.toFixed(2)}<span style={{ fontSize: 12, color: T.text3 }}>/100</span>
            </span>
            <span style={{ fontSize: 12, color: T.text2 }}>
              ✓ {form.computed?.totalCorrect} correct &nbsp;
              ✗ {form.computed?.totalWrong} wrong &nbsp;
              ⊘ {form.computed?.totalDeleted} deleted
            </span>
          </div>
        )}

        {/* Tab bar */}
        <div style={{ borderBottom: `1px solid ${T.border}`, marginBottom: 16, display: "flex", overflowX: "auto" }}>
          {[
            ["meta",    "📋 Details"],
            ["key",     "🔑 Answer Key"],
            ["omr",     `📝 OMR (${answered}/100)`],
            ["topicmap","🗂 Topic Map"],
            ["guess",   "🎲 Guesswork"],
            ["content", "📄 Content"],
          ].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={tabStyle(k)}>{l}</button>
          ))}
        </div>

        {/* ── META TAB ── */}
        {tab === "meta" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Paper Name *
                </span>
                <input style={{ ...inputStyle, borderColor: errors.name ? T.red : T.border }}
                  value={form.name} maxLength={100}
                  onChange={e => set("name", e.target.value)}
                  placeholder="e.g. DLP 2023 Stage II" />
                <FieldError msg={errors.name} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Question Code
                </span>
                <input style={inputStyle} value={form.code}
                  onChange={e => set("code", e.target.value)} placeholder="116/2022" />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Date of Test
                </span>
                <input style={{ ...inputStyle, borderColor: errors.date ? T.red : T.border }}
                  type="date" value={form.date}
                  onChange={e => set("date", e.target.value)} />
                <FieldError msg={errors.date} />
              </label>
            </div>

            {/* Question range override */}
            <div>
              <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>
                Question Range Override (optional — edit only if this paper differs from syllabus default)
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                {syllabus.subjects.map(s => {
                  const over = form.questionRangeOverride?.[s.id] || {};
                  const def  = s.questionRange || {};
                  return (
                    <div key={s.id} style={{ padding: "8px 10px", border: `1px solid ${T.border}`, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: T.text2, marginBottom: 6 }}>{s.name}</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="number" min={1} max={100} placeholder={def.start || "start"}
                          value={over.start || ""}
                          onChange={e => set("questionRangeOverride", {
                            ...form.questionRangeOverride,
                            [s.id]: { ...over, start: parseInt(e.target.value) || undefined }
                          })}
                          style={{ ...inputStyle, width: 56, textAlign: "center", fontSize: 12 }} />
                        <span style={{ color: T.text3 }}>–</span>
                        <input type="number" min={1} max={100} placeholder={def.end || "end"}
                          value={over.end || ""}
                          onChange={e => set("questionRangeOverride", {
                            ...form.questionRangeOverride,
                            [s.id]: { ...over, end: parseInt(e.target.value) || undefined }
                          })}
                          style={{ ...inputStyle, width: 56, textAlign: "center", fontSize: 12 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Notes ({form.notes?.length || 0}/1000)
              </span>
              <textarea rows={3} maxLength={1000}
                value={form.notes} onChange={e => set("notes", e.target.value)}
                placeholder="Observations, difficulty, time taken..."
                style={{ ...inputStyle, resize: "vertical", borderColor: errors.notes ? T.red : T.border }} />
              <FieldError msg={errors.notes} />
            </label>
          </div>
        )}

        {/* ── ANSWER KEY TAB ── */}
        {tab === "key" && (
          <div>
            <p style={{ fontSize: 12, color: T.text2, marginBottom: 16, lineHeight: 1.7 }}>
              Upload the official answer key (.docx). Both multi-booklet (A/B/C/D columns) and
              single-booklet formats are automatically detected.
              After uploading, go to the OMR tab to enter your answers and calculate your score.
            </p>
            <AnswerKeyUploader
              existing={form.answerKey}
              syllabus={syllabus}
              onParsed={key => { set("answerKey", key); setDirty(true); }}
            />
          </div>
        )}

        {/* ── OMR TAB ── */}
        {tab === "omr" && (
          <div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.7, marginBottom: 12 }}>
                Record your answer choices (A/B/C/D). Optionally mark guesses and tag sub-topics.
                After filling, click Calculate Score to auto-compute subject-wise results.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={() => setShowOMR(true)} style={btnPrimary(T.accent)}>
                  {answered > 0 ? `Edit OMR Sheet (${answered} answered, ${guessCount} guesses)` : "Open OMR Sheet"}
                </button>

              </div>
            </div>

            {/* OMR answer distribution preview */}
            {answered > 0 && (
              <div style={{ padding: "10px 14px", background: T.surface, borderRadius: 8, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>Answer distribution:</div>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  {OPTS.map(o => {
                    const cnt = Object.values(form.omr).filter(e => e?.answer === o).length;
                    return <span key={o} style={{ fontSize: 13, color: T.text2, fontFamily: "monospace" }}>
                      <span style={{ color: T.accent, fontWeight: 700 }}>{o}</span>: {cnt}
                    </span>;
                  })}
                  <span style={{ fontSize: 13, color: T.text3, fontFamily: "monospace" }}>
                    Blank: {100 - answered}
                  </span>
                  <span style={{ fontSize: 13, color: T.cyan, fontFamily: "monospace" }}>
                    🎯 50:50: {Object.values(form.omr).filter(e => e?.guessType === "5050").length}
                  </span>
                  <span style={{ fontSize: 13, color: T.orange, fontFamily: "monospace" }}>
                    🎲 Wild: {Object.values(form.omr).filter(e => e?.guessType === "wild").length}
                  </span>
                </div>
              </div>
            )}

            {/* Computed scores preview */}
            {form.computed && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: T.surface, borderRadius: 8, border: `1px solid ${T.green}44` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.green, marginBottom: 10 }}>Calculated Scores</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                  {syllabus.subjects.map(s => {
                    const sc = form.computed.bySubject[s.id];
                    if (!sc) return null;
                    const p = pct(sc.marks, s.maxMarks);
                    return (
                      <div key={s.id} style={{ padding: "6px 10px", border: `1px solid ${T.border}`, borderRadius: 6 }}>
                        <div style={{ fontSize: 10, color: T.text3, marginBottom: 4 }}>{s.name}</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontFamily: "monospace", fontSize: 13, color: scoreColor(p) }}>
                            {sc.marks.toFixed(1)}/{s.maxMarks}
                          </span>
                          <Badge label={`${p}%`} color={scoreColor(p)} />
                        </div>
                        <div style={{ fontSize: 10, color: T.text3, marginTop: 3 }}>
                          ✓{sc.correct} ✗{sc.wrong} {sc.deleted > 0 && `⊘${sc.deleted}`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TOPIC MAP TAB ── */}
        {tab === "topicmap" && (
          <TopicMapImporter
            syllabus={syllabus}
            currentOMR={form.omr}
            onApply={(updates) => {
              // Merge topic tags into OMR without touching answers/guesses
              setForm(f => {
                const newOMR = { ...f.omr };
                Object.entries(updates).forEach(([qStr, topicId]) => {
                  newOMR[qStr] = { ...(newOMR[qStr] || {}), topicId };
                });
                return { ...f, omr: newOMR };
              });
              setDirty(true);
              setTab("omr");
              window.__pscAutoSync?.();
            }}
            onClose={() => setTab("omr")}
          />
        )}

        {/* ── GUESSWORK TAB ── */}
        {tab === "guess" && (
          <div>
            <p style={{ fontSize: 12, color: T.text2, marginBottom: 16, lineHeight: 1.7 }}>
              Optional manual guesswork summary (if you did not tag guesses in the OMR sheet,
              or for papers without an answer key). These are tracked separately for strategy analysis.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              {[
                { label: "🎯 50:50 Guesses", kc: "ff_correct", kw: "ff_wrong", color: T.cyan,
                  note: "Questions where you eliminated 2 options and guessed between 2." },
                { label: "🎲 Wild Guess / Weak Memory", kc: "wg_correct", kw: "wg_wrong", color: T.orange,
                  note: "Pure guesses or answers from faint/uncertain memory." },
              ].map(row => {
                const c = parseInt(form.guesses[row.kc]) || 0;
                const w = parseInt(form.guesses[row.kw]) || 0;
                const neg = syllabus.negMark || 1/3;
                const net = c - w * neg;
                const acc = c + w > 0 ? Math.round(c / (c + w) * 100) : null;
                return (
                  <div key={row.kc} style={{ border: `1px solid ${row.color}44`, borderRadius: 10, padding: 16 }}>
                    <div style={{ fontWeight: 700, color: row.color, marginBottom: 8, fontSize: 13 }}>{row.label}</div>
                    <div style={{ fontSize: 11, color: T.text3, marginBottom: 12 }}>{row.note}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <NumInput label="Correct" value={form.guesses[row.kc]} onChange={v => setGuess(row.kc, v)} />
                      <NumInput label="Wrong"   value={form.guesses[row.kw]} onChange={v => setGuess(row.kw, v)} />
                    </div>
                    <div style={{ marginTop: 10, background: T.surface, borderRadius: 6, padding: "8px 10px", fontSize: 12, display: "flex", gap: 14 }}>
                      <span>Net: <strong style={{ color: net >= 0 ? T.green : T.red, fontFamily: "monospace" }}>{net.toFixed(2)}</strong></span>
                      {acc !== null && <span>Accuracy: <strong style={{ color: row.color }}>{acc}%</strong></span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── CONTENT TAB ── */}
        {tab === "content" && (
          <div>
            <p style={{ fontSize: 12, color: T.text2, marginBottom: 16, lineHeight: 1.7 }}>
              Store the question paper text or explanations for later reference.
              You can paste text, upload a .docx explanation file, or attach a PDF.
              All three can coexist for the same paper.
            </p>

            {/* Explanation Docx upload — parsed into structured questions */}
            <div style={{ marginBottom: 20, padding: "12px 16px",
              background: T.surface, borderRadius: 8,
              border: "1px solid " + (form.questions ? T.green + "66" : T.border) }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                📖 Question Explanations
              </div>
              <div style={{ fontSize: 11, color: T.text3, marginBottom: 10, lineHeight: 1.6 }}>
                Upload the explanation docx generated from Claude AI using the master prompt.
                The document is parsed and discarded — only the structured question data is stored.
              </div>
              <input ref={explRef} type="file" accept=".docx" style={{ display: "none" }} onChange={handleExplDocx} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => explRef.current?.click()}
                  style={{ ...btnPrimary(T.accent), fontSize: 12 }}>
                  {form.questions
                    ? "↺ Re-upload Explanations"
                    : "⬆ Upload Explanation Docx"}
                </button>
                {form.questions && (
                  <>
                    <span style={{ fontSize: 11, color: T.green }}>
                      ✓ {Object.keys(form.questions).length} questions stored
                    </span>
                    <button onClick={() => {
                        if (window.confirm("Remove all stored question explanations?")) {
                          setForm(f => ({ ...f, questions: null }));
                          setDirty(true);
                        }
                      }}
                      style={{ ...btnGhost, fontSize: 11, color: T.red, borderColor: T.red + "44" }}>
                      Remove
                    </button>
                    {form.computed && (
                      <button onClick={() => setShowQViewer(true)}
                        style={{ ...btnPrimary(T.purple), fontSize: 12 }}>
                        👁 View Questions
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Text editor */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: T.text3, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Paste Text / Explanations
              </div>
              <textarea
                rows={8} value={form.content?.text || ""}
                onChange={e => setContent("text", e.target.value)}
                placeholder="Paste question paper text, explanations, or your own notes here..."
                style={{ ...inputStyle, resize: "vertical", fontSize: 12, lineHeight: 1.7 }}
              />
            </div>

            {/* Docx upload */}
            <div style={{ marginBottom: 16 }}>
              <input ref={docxRef} type="file" accept=".docx" style={{ display: "none" }} onChange={handleDocx} />
              <button onClick={() => docxRef.current?.click()} style={btnPrimary(T.purple)}>
                {form.content?.docxName ? "✓ Replace Docx (" + form.content.docxName + ")" : "Upload Content Docx"}
              </button>
              {form.content?.docxName && (
                <button
                  onClick={() => { setContent("docxExtracted", ""); setContent("docxName", ""); }}
                  style={{ ...btnGhost, marginLeft: 8, color: T.red }}
                >Remove</button>
              )}
              {form.content?.docxExtracted && (
                <div style={{ marginTop: 8, fontSize: 11, color: T.green }}>
                  ✓ {form.content.docxExtracted.length.toLocaleString()} characters extracted
                </div>
              )}
            </div>

            {/* PDF upload */}
            <div>
              <input ref={pdfRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handlePDF} />
              <button onClick={() => pdfRef.current?.click()} style={btnPrimary(T.teal)}>
                {form.content?.pdfName ? "✓ Replace PDF (" + form.content.pdfName + ")" : "Upload PDF"}
              </button>
              {form.content?.pdfName && (
                <button
                  onClick={() => { setContent("pdfData", ""); setContent("pdfName", ""); }}
                  style={{ ...btnGhost, marginLeft: 8, color: T.red }}
                >Remove</button>
              )}
              {form.content?.pdfData && (
                <div style={{ marginTop: 8, fontSize: 11, color: T.green }}>
                  ✓ PDF stored ({(form.content.pdfData.length / 1024).toFixed(0)} KB)
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div style={{
          display: "flex", gap: 10, justifyContent: "flex-end",
          marginTop: 20, paddingTop: 16, borderTop: `1px solid ${T.border}`,
        }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={handleSave} style={btnPrimary(T.accent)}>
            {initial ? "Update Paper" : "Save Paper →"}
          </button>
        </div>
      </Modal>

      {/* Question Viewer overlay */}
      {showQViewer && (
        <QuestionViewer
          paper={form}
          syllabus={syllabus}
          onUpdateTopicTag={(qStr, topicId) => {
            const newOMR = { ...form.omr };
            newOMR[qStr] = { ...(newOMR[qStr] || {}), topicId };
            const updated = { ...form, omr: newOMR };
            setForm(updated);
            setDirty(true);
            if (onSaveSilent) onSaveSilent(updated);
          }}
          onUpdateQText={(qStr, field, value) => {
            const newQuestions = { ...form.questions };
            newQuestions[qStr] = { ...(newQuestions[qStr] || {}), [field]: value };
            const updated = { ...form, questions: newQuestions };
            setForm(updated);
            setDirty(true);
            if (onSaveSilent) onSaveSilent(updated);
          }}
          onClose={() => setShowQViewer(false)}
        />
      )}

      {/* OMR overlay */}
      {showOMR && (
        <SmartOMR
          omr={form.omr}
          answerKey={form.answerKey}
          bookletCode={form.bookletCode}
          syllabus={syllabus}
          rangeOverride={form.questionRangeOverride}
          onSave={handleOMRUpdate}
          onClose={handleOMRClose}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTENT READER — view text / docx / PDF
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ContentReader — searchable reader for paper content.
 * Shows pasted text, docx-extracted text, or inline PDF.
 */
export function ContentReader({ content, onClose }) {
  const [activeSource, setActiveSource] = useState(
    content?.docxExtracted ? "docx" : content?.text ? "text" : "pdf"
  );
  const [search, setSearch] = useState("");

  const rawText = activeSource === "docx" ? (content?.docxExtracted || "")
                : activeSource === "text" ? (content?.text || "")
                : "";

  const highlight = (text, query) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: T.yellow + "88", color: T.text }}>{text.slice(idx, idx + query.length)}</mark>
        {highlight(text.slice(idx + query.length), query)}
      </>
    );
  };

  const matchCount = search && rawText
    ? (rawText.toLowerCase().match(new RegExp(search.toLowerCase(), "g")) || []).length
    : 0;

  return (
    <Modal title="Content Reader" onClose={onClose} extraWide>
      {/* Source selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {content?.text && (
          <button onClick={() => setActiveSource("text")}
            style={{ ...btnGhost, background: activeSource === "text" ? T.accent + "33" : "transparent", color: activeSource === "text" ? T.accent2 : T.text2 }}>
            Pasted Text
          </button>
        )}
        {content?.docxExtracted && (
          <button onClick={() => setActiveSource("docx")}
            style={{ ...btnGhost, background: activeSource === "docx" ? T.purple + "33" : "transparent", color: activeSource === "docx" ? T.purple : T.text2 }}>
            📄 {content.docxName || "Docx"}
          </button>
        )}
        {content?.pdfData && (
          <button onClick={() => setActiveSource("pdf")}
            style={{ ...btnGhost, background: activeSource === "pdf" ? T.teal + "33" : "transparent", color: activeSource === "pdf" ? T.teal : T.text2 }}>
            📋 PDF
          </button>
        )}
      </div>

      {/* Search bar */}
      {rawText && (
        <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search in content..."
            style={{ ...inputStyle, maxWidth: 300 }} />
          {search && <span style={{ fontSize: 11, color: T.text3 }}>{matchCount} match{matchCount !== 1 ? "es" : ""}</span>}
        </div>
      )}

      {/* Content display */}
      {activeSource === "pdf" && content?.pdfData ? (
        <iframe src={content.pdfData} style={{ width: "100%", height: 500, borderRadius: 8, border: `1px solid ${T.border}` }} title="PDF" />
      ) : rawText ? (
        <div style={{
          background: T.surface, borderRadius: 8, padding: 16,
          maxHeight: 500, overflowY: "auto", fontSize: 12,
          lineHeight: 1.8, color: T.text2, whiteSpace: "pre-wrap",
          border: `1px solid ${T.border}`,
        }}>
          {search ? highlight(rawText, search) : rawText}
        </div>
      ) : (
        <div style={{ color: T.text3, textAlign: "center", padding: 40 }}>No content stored for this source.</div>
      )}
    </Modal>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// QUESTION VIEWER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * QuestionViewer — scrollable list of all 100 questions with OMR results.
 * Tapping a question opens a detail popup showing the question text,
 * options (with correct/my answer highlighted), explanation, and topic tag.
 * Topic tag and question text/explanation are editable inline.
 */
function QuestionViewer({ paper, syllabus, onUpdateTopicTag, onUpdateQText, onClose }) {
  const [selected,     setSelected]     = useState(null);
  const [editText,     setEditText]     = useState("");
  const [editExp,      setEditExp]      = useState("");
  const [editingField, setEditingField] = useState(null);
  const [filter,       setFilter]       = useState("all");

  const pq       = paper.computed?.perQuestion || {};
  const qs       = paper.questions || {};
  const omr      = paper.omr || {};
  const topicOpts = buildTopicOptions(syllabus);

  const FILTERS = [
    { id: "all",         label: "All" },
    { id: "correct",     label: "Correct" },
    { id: "wrong",       label: "Wrong" },
    { id: "ng_correct",  label: "Non-guess ✓" },
    { id: "ng_wrong",    label: "Non-guess ✗" },
    { id: "g_correct",   label: "Guess ✓" },
    { id: "g_wrong",     label: "Guess ✗" },
    { id: "unattempted", label: "Unattempted" },
  ];

  const matchesFilter = (qStr) => {
    const r  = pq[qStr]?.result;
    const ig = omr[qStr]?.isGuess;
    if (filter === "correct")     return r === "correct";
    if (filter === "wrong")       return r === "wrong";
    if (filter === "ng_correct")  return r === "correct" && !ig;
    if (filter === "ng_wrong")    return r === "wrong"   && !ig;
    if (filter === "g_correct")   return r === "correct" &&  ig;
    if (filter === "g_wrong")     return r === "wrong"   &&  ig;
    if (filter === "unattempted") return r === "unattempted" || (!r && r !== "deleted");
    return true;
  };

  const filteredQs = Array.from({ length: 100 }, (_, i) => String(i + 1)).filter(matchesFilter);

  // Colour for each question result badge
  const qColor = (qStr) => {
    const r = pq[qStr]?.result;
    if (r === "correct")     return T.green;
    if (r === "wrong")       return T.red;
    if (r === "unattempted") return T.text3;
    if (r === "deleted")     return T.text3;
    return T.border2;
  };

  const qIcon = (qStr) => {
    const r = pq[qStr]?.result;
    if (r === "correct")     return "✓";
    if (r === "wrong")       return "✗";
    if (r === "unattempted") return "—";
    if (r === "deleted")     return "⊘";
    return "?";
  };

  const openQuestion = (qStr) => {
    setSelected(qStr);
    setEditText(qs[qStr]?.text || "");
    setEditExp(qs[qStr]?.explanation || "");
    setEditingField(null);
  };

  const saveTextEdit = () => {
    if (editingField === "text")
      onUpdateQText(selected, "text", editText);
    if (editingField === "explanation")
      onUpdateQText(selected, "explanation", editExp);
    setEditingField(null);
  };

  const selQ   = selected ? qs[selected]   : null;
  const selPQ  = selected ? pq[selected]   : null;
  const selOMR = selected ? omr[selected]  : null;

  return (
    <>
      <Modal title={"Questions — " + (paper.name || "Paper")} onClose={onClose} extraWide>

        {/* Filter dropdown + count */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ ...inputStyle, fontSize: 12, padding: "5px 8px", width: "auto" }}>
            {FILTERS.map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: T.text3 }}>
            {filteredQs.length} question{filteredQs.length !== 1 ? "s" : ""}
          </span>
          {!Object.keys(qs).length && (
            <span style={{ fontSize: 11, color: T.orange }}>
              ⚠ No explanations uploaded
            </span>
          )}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 11, color: T.text3, flexWrap: "wrap" }}>
          {[["✓", T.green, "Correct"], ["✗", T.red, "Wrong"], ["—", T.text3, "Unattempted"], ["⊘", T.text3, "Deleted"]].map(([icon, col, label]) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ color: col, fontWeight: 700 }}>{icon}</span> {label}
            </span>
          ))}
        </div>

        {/* Question grid — filtered */}
        {filteredQs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: T.text3, fontSize: 13 }}>
            No questions match this filter.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {filteredQs.map(qStr => {
              const col    = qColor(qStr);
              const icon   = qIcon(qStr);
              const hasExp = !!qs[qStr];
              return (
                <button key={qStr} onClick={() => openQuestion(qStr)}
                  style={{
                    width: 44, height: 40, borderRadius: 6, cursor: "pointer",
                    border: "1px solid " + col + "66",
                    background: col + "18",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 1,
                    position: "relative",
                  }}>
                  <span style={{ fontSize: 10, color: T.text3, lineHeight: 1 }}>Q{qStr}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: col, lineHeight: 1 }}>{icon}</span>
                  {hasExp && (
                    <div style={{
                      position: "absolute", top: 2, right: 2,
                      width: 5, height: 5, borderRadius: "50%", background: T.accent,
                    }} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ fontSize: 11, color: T.text3, textAlign: "center" }}>
          Tap any question to view details · Blue dot = explanation available
        </div>
      </Modal>

      {/* Question detail popup */}
      {selected && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1100,
          background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
        }} onClick={() => { if (!editingField) setSelected(null); }}>
          <div style={{
            background: "#0d1117", borderRadius: "16px 16px 0 0",
            width: "100%", maxWidth: 600,
            maxHeight: "85vh", display: "flex", flexDirection: "column",
            border: "1px solid " + T.border,
            boxShadow: "0 -8px 32px rgba(0,0,0,0.5)",
          }} onClick={e => e.stopPropagation()}>

            {/* Detail header */}
            <div style={{
              padding: "14px 16px 10px",
              borderBottom: "1px solid " + T.border,
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: T.text }}>
                  Question {selected}
                </span>
                <span style={{
                  fontSize: 13, fontWeight: 700, color: qColor(selected),
                  background: qColor(selected) + "22",
                  border: "1px solid " + qColor(selected) + "44",
                  borderRadius: 5, padding: "2px 8px",
                }}>
                  {qIcon(selected)} {selPQ?.result || "no data"}
                </span>
                {selOMR?.isGuess && (
                  <span style={{ fontSize: 11, color: T.orange, background: T.orange + "22",
                    border: "1px solid " + T.orange + "44", borderRadius: 5, padding: "2px 8px" }}>
                    🎲 Guess
                  </span>
                )}
              </div>
              <button onClick={() => setSelected(null)}
                style={{ ...btnGhost, padding: "4px 10px", fontSize: 13 }}>✕</button>
            </div>

            {/* Scrollable body */}
            <div style={{ overflowY: "auto", padding: "14px 16px", flex: 1 }}>

              {/* My answer vs correct */}
              <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12 }}>
                  <span style={{ color: T.text3 }}>My answer: </span>
                  <span style={{ fontWeight: 700, fontFamily: "monospace",
                    color: selPQ?.result === "correct" ? T.green : T.red }}>
                    {selOMR?.answer || "—"}
                  </span>
                </div>
                <div style={{ fontSize: 12 }}>
                  <span style={{ color: T.text3 }}>Correct: </span>
                  <span style={{ fontWeight: 700, fontFamily: "monospace", color: T.green }}>
                    {selPQ?.keyAns || "—"}
                  </span>
                </div>
              </div>

              {/* Topic tag — editable */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: T.text3, marginBottom: 4,
                  textTransform: "uppercase", letterSpacing: "0.08em" }}>Topic Tag</div>
                <SearchSelect
                  options={topicOpts}
                  value={selOMR?.topicId || null}
                  onChange={topicId => onUpdateTopicTag(selected, topicId)}
                  placeholder="Tag a topic..."
                />
              </div>

              {/* Question text */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Question
                  </div>
                  {editingField === "text" ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={saveTextEdit}
                        style={{ ...btnPrimary(T.green), fontSize: 11, padding: "3px 10px" }}>Save</button>
                      <button onClick={() => setEditingField(null)}
                        style={{ ...btnGhost, fontSize: 11, padding: "3px 10px" }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setEditingField("text")}
                      style={{ ...btnGhost, fontSize: 11, padding: "3px 10px" }}>✎ Edit</button>
                  )}
                </div>
                {editingField === "text" ? (
                  <textarea value={editText} onChange={e => setEditText(e.target.value)}
                    rows={4} style={{ ...inputStyle, fontSize: 13, resize: "vertical", lineHeight: 1.7 }} />
                ) : (
                  <div style={{ fontSize: 13, color: T.text, lineHeight: 1.8,
                    background: T.surface, borderRadius: 6, padding: "10px 12px",
                    border: "1px solid " + T.border, whiteSpace: "pre-wrap" }}>
                    {selQ?.text || <span style={{ color: T.text3, fontStyle: "italic" }}>No question text stored</span>}
                  </div>
                )}
              </div>

              {/* Options */}
              {selQ?.options && Object.keys(selQ.options).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: T.text3, textTransform: "uppercase",
                    letterSpacing: "0.08em", marginBottom: 6 }}>Options</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {["A","B","C","D"].map(opt => {
                      const isMyAns  = selOMR?.answer === opt;
                      const isCorrect = selPQ?.keyAns === opt;
                      const bg = isCorrect ? T.green + "22"
                               : isMyAns  ? T.red   + "22"
                               : "transparent";
                      const border = isCorrect ? T.green + "88"
                                   : isMyAns  ? T.red   + "88"
                                   : T.border;
                      const textCol = isCorrect ? T.green
                                    : isMyAns  ? T.red
                                    : T.text2;
                      return (
                        <div key={opt} style={{
                          display: "flex", gap: 10, alignItems: "flex-start",
                          padding: "8px 10px", borderRadius: 6,
                          background: bg, border: "1px solid " + border,
                        }}>
                          <span style={{ fontWeight: 700, fontFamily: "monospace",
                            color: textCol, minWidth: 20, flexShrink: 0 }}>
                            {opt}.
                          </span>
                          <span style={{ fontSize: 13, color: textCol, lineHeight: 1.5 }}>
                            {selQ.options[opt]}
                          </span>
                          {isCorrect && <span style={{ marginLeft: "auto", color: T.green, fontSize: 12, flexShrink: 0 }}>✓ Correct</span>}
                          {isMyAns && !isCorrect && <span style={{ marginLeft: "auto", color: T.red, fontSize: 12, flexShrink: 0 }}>← My answer</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Explanation */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between",
                  alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Explanation
                  </div>
                  {editingField === "explanation" ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={saveTextEdit}
                        style={{ ...btnPrimary(T.green), fontSize: 11, padding: "3px 10px" }}>Save</button>
                      <button onClick={() => setEditingField(null)}
                        style={{ ...btnGhost, fontSize: 11, padding: "3px 10px" }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setEditingField("explanation")}
                      style={{ ...btnGhost, fontSize: 11, padding: "3px 10px" }}>✎ Edit</button>
                  )}
                </div>
                {editingField === "explanation" ? (
                  <textarea value={editExp} onChange={e => setEditExp(e.target.value)}
                    rows={5} style={{ ...inputStyle, fontSize: 13, resize: "vertical", lineHeight: 1.7 }} />
                ) : (
                  <div style={{ fontSize: 13, color: T.text2, lineHeight: 1.8,
                    background: T.surface, borderRadius: 6, padding: "10px 12px",
                    border: "1px solid " + T.border, whiteSpace: "pre-wrap" }}>
                    {selQ?.explanation || <span style={{ color: T.text3, fontStyle: "italic" }}>No explanation stored</span>}
                  </div>
                )}
              </div>

              {/* Prev / Next — filter-aware */}
              {(() => {
                const idx  = filteredQs.indexOf(selected);
                const hasPrev = idx > 0;
                const hasNext = idx < filteredQs.length - 1;
                return (
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", paddingTop: 12 }}>
                    <button
                      onClick={() => hasPrev && openQuestion(filteredQs[idx - 1])}
                      disabled={!hasPrev}
                      style={{ ...btnGhost, fontSize: 13, padding: "8px 20px",
                        opacity: hasPrev ? 1 : 0.4 }}>
                      ← Prev
                    </button>
                    <span style={{ fontSize: 11, color: T.text3, alignSelf: "center" }}>
                      {idx + 1} / {filteredQs.length}
                    </span>
                    <button
                      onClick={() => hasNext && openQuestion(filteredQs[idx + 1])}
                      disabled={!hasNext}
                      style={{ ...btnGhost, fontSize: 13, padding: "8px 20px",
                        opacity: hasNext ? 1 : 0.4 }}>
                          Next →
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAPER DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PaperDetail — read-only summary of a saved paper.
 * Shows subject breakdown, guess analysis, OMR results, topic performance.
 */
export function PaperDetail({ paper, syllabus, onEdit, onClose, onShare, onSaveSilent }) {
  const [showContent,  setShowContent]  = useState(false);
  const [showQViewer,  setShowQViewer]  = useState(false);
  const neg = syllabus.negMark || 1/3;
  const c   = paper.computed;

  // Fallback: compute from guesses if no OMR computed
  const totalMarks = c?.totalMarks ?? 0;
  const p          = pct(totalMarks, 100);

  const hasContent = paper.content?.text || paper.content?.docxExtracted || paper.content?.pdfData;

  return (
    <>
      <Modal title={paper.name || "Paper Detail"} onClose={onClose} extraWide>

        {/* Header */}
        <div style={{
          display: "flex", gap: 16, marginBottom: 20, padding: "12px 16px",
          background: T.surface, borderRadius: 8, alignItems: "center", flexWrap: "wrap",
          border: `1px solid ${T.border}`,
        }}>
          <span style={{ fontSize: 30, fontWeight: 900, fontFamily: "monospace", color: scoreColor(p) }}>
            {totalMarks.toFixed(2)}<span style={{ fontSize: 14, color: T.text3 }}>/100</span>
          </span>
          <div style={{ flex: 1 }}>
            {paper.code && <Badge label={paper.code} color={T.accent} />}
            {paper.date && <span style={{ fontSize: 12, color: T.text3, marginLeft: 8 }}>{fmtDate(paper.date)}</span>}
            {paper.bookletCode && <span style={{ fontSize: 12, color: T.text2, marginLeft: 8 }}>Booklet {paper.bookletCode}</span>}
            {c && (
              <div style={{ fontSize: 12, marginTop: 6,
                display: "flex", flexWrap: "wrap", gap: "4px 14px",
                alignItems: "center" }}>
                <span style={{ color: T.green, fontWeight: 700 }}>
                  ✓ {c.totalCorrect} correct
                </span>
                <span style={{ color: T.red, fontWeight: 700 }}>
                  ✗ {c.totalWrong} wrong
                </span>
                {c.totalDeleted > 0 && (
                  <span style={{ color: T.text3 }}>
                    ⊘ {c.totalDeleted} deleted
                  </span>
                )}
                <span style={{ color: T.text3 }}>
                  — {c.totalUnattempted} unattempted
                </span>
                <span style={{ color: T.orange }}>
                  −{c.totalPenalty.toFixed(2)} penalty
                </span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {paper.questions && paper.computed && (
              <button onClick={() => setShowQViewer(true)}
                style={{ ...btnGhost, color: T.accent2, borderColor: T.accent + "55" }}>
                📖 Questions
              </button>
            )}
            {hasContent && <button onClick={() => setShowContent(true)} style={btnGhost}>📄 Content</button>}
            <button onClick={onShare} style={btnGhost}>📤 Share</button>
            <button onClick={onEdit}  style={btnGhost}>Edit</button>
          </div>
        </div>

        {/* Subject breakdown */}
        {c && (
          <Section title="Subject-wise Scores" accent={T.purple}>
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 600 }}>
              <thead>
                <tr>
                  {["Subject","Max","Correct","Wrong","Deleted","Penalty","Marks","%","Guess✓","Guess✗"].map(h => (
                    <th key={h} style={{
                      textAlign: h === "Subject" ? "left" : "center",
                      padding: "6px 8px", color: T.text3, fontSize: 10,
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      borderBottom: `1px solid ${T.border}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {syllabus.subjects.map(s => {
                  const sc = c.bySubject[s.id] || {};
                  const sp = pct(sc.marks || 0, s.maxMarks);
                  return (
                    <tr key={s.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: "8px", color: T.text, fontSize: 12 }}>{s.name}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: T.text3, fontFamily: "monospace" }}>{s.maxMarks}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: T.green,  fontFamily: "monospace" }}>{sc.correct || 0}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: T.red,    fontFamily: "monospace" }}>{sc.wrong   || 0}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: T.text3,  fontFamily: "monospace" }}>{sc.deleted || 0}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: T.orange, fontFamily: "monospace" }}>−{((sc.wrong || 0) * neg).toFixed(2)}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: scoreColor(sp), fontFamily: "monospace", fontWeight: 700 }}>{(sc.marks || 0).toFixed(2)}</td>
                      <td style={{ padding: "8px", textAlign: "center" }}><Badge label={`${sp}%`} color={scoreColor(sp)} /></td>
                      <td style={{ padding: "8px", textAlign: "center", color: T.cyan,   fontFamily: "monospace" }}>{sc.guessCorrect || 0}</td>
                      <td style={{ padding: "8px", textAlign: "center", color: T.orange, fontFamily: "monospace" }}>{sc.guessWrong   || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </Section>
        )}

        {/* Topic performance */}
        {c && Object.keys(c.byTopic || {}).length > 0 && (
          <Section title="📌 Topic Performance (from OMR tags)" accent={T.cyan}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {syllabus.subjects.map(subj => {
                const subjTopics = subj.topics
                  .filter(t => c.byTopic[t.id])
                  .map(t => ({
                    ...t,
                    stats: c.byTopic[t.id],
                    acc: c.byTopic[t.id].total > 0
                      ? Math.round(c.byTopic[t.id].correct / c.byTopic[t.id].total * 100)
                      : 0,
                  }))
                  .sort((a, b) =>
                    b.stats.total !== a.stats.total
                      ? b.stats.total - a.stats.total
                      : b.acc - a.acc
                  );
                if (subjTopics.length === 0) return null;
                const sIdx = syllabus.subjects.findIndex(s => s.id === subj.id);
                const sColor = T.subjectColors[sIdx % T.subjectColors.length] || T.accent;
                return (
                  <div key={subj.id}>
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
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {subjTopics.map(t => (
                        <div key={t.id} style={{
                          display: "grid", gridTemplateColumns: "1fr auto auto",
                          gap: 10, alignItems: "center",
                          padding: "6px 10px", borderRadius: 6,
                          background: T.surface, border: `1px solid ${T.border}`,
                        }}>
                          <span style={{ fontSize: 12, color: T.text2, minWidth: 0 }}>
                            {t.topicNo
                              ? <span style={{ fontSize: 10, color: T.text3, marginRight: 5, fontFamily: "monospace" }}>[{t.topicNo}]</span>
                              : null}
                            {t.name}
                          </span>
                          <span style={{ fontFamily: "monospace", fontSize: 12, color: T.text3, whiteSpace: "nowrap" }}>
                            {t.stats.correct}/{t.stats.total}
                          </span>
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

        {/* Guess vs Non-Guess Breakdown + Wrong Q Numbers */}
        {c && (!c.perQuestion || Object.keys(c.perQuestion).length === 0) && (
          <Section title="🎯 Answer Breakdown" accent={T.cyan}>
            <div style={{ padding: "14px 0", color: T.text3, fontSize: 12, lineHeight: 1.7 }}>
              Per-question breakdown is not available yet for this paper.
              Open this paper → Edit → OMR tab → Calculate Score to generate the breakdown.
            </div>
          </Section>
        )}
        {c && c.perQuestion && Object.keys(c.perQuestion).length > 0 && (() => {
          // Classify every answered question from perQuestion
          const pq = c.perQuestion;
          const guessCorrectQs   = Object.keys(pq).filter(q => pq[q].result === "correct" && pq[q].isGuess).map(Number).sort((a,b)=>a-b);
          const guessWrongQs     = Object.keys(pq).filter(q => pq[q].result === "wrong"   && pq[q].isGuess).map(Number).sort((a,b)=>a-b);
          const nonGuessCorrectQs= Object.keys(pq).filter(q => pq[q].result === "correct" && !pq[q].isGuess).map(Number).sort((a,b)=>a-b);
          const nonGuessWrongQs  = Object.keys(pq).filter(q => pq[q].result === "wrong"   && !pq[q].isGuess).map(Number).sort((a,b)=>a-b);

          const hasAnyGuess = guessCorrectQs.length + guessWrongQs.length > 0;

          const QList = ({ qs, color }) => (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {qs.map(q => (
                <span key={q} style={{
                  fontSize: 11, fontFamily: "monospace", fontWeight: 700,
                  color, background: color + "18",
                  border: "1px solid " + color + "44",
                  borderRadius: 4, padding: "2px 6px",
                }}>
                  {"Q" + q}
                </span>
              ))}
            </div>
          );

          return (
            <Section title="🎯 Answer Breakdown" accent={T.cyan}>
              {/* Summary row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>

                {/* Non-guess */}
                <div style={{ padding: "12px 14px", borderRadius: 8,
                  background: T.surface, border: "1px solid " + T.border }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.text3,
                    textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    Without Guessing
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 22, fontWeight: 900,
                        color: T.green, fontFamily: "monospace" }}>
                        {nonGuessCorrectQs.length}
                      </div>
                      <div style={{ fontSize: 10, color: T.text3 }}>Correct</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 22, fontWeight: 900,
                        color: T.red, fontFamily: "monospace" }}>
                        {nonGuessWrongQs.length}
                      </div>
                      <div style={{ fontSize: 10, color: T.text3 }}>Wrong</div>
                    </div>
                  </div>
                </div>

                {/* Guess */}
                <div style={{ padding: "12px 14px", borderRadius: 8,
                  background: T.surface, border: "1px solid " + T.border,
                  opacity: hasAnyGuess ? 1 : 0.45 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.text3,
                    textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                    By Guessing
                  </div>
                  {hasAnyGuess ? (
                    <div style={{ display: "flex", gap: 16 }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 22, fontWeight: 900,
                          color: T.cyan, fontFamily: "monospace" }}>
                          {guessCorrectQs.length}
                        </div>
                        <div style={{ fontSize: 10, color: T.text3 }}>Correct</div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 22, fontWeight: 900,
                          color: T.orange, fontFamily: "monospace" }}>
                          {guessWrongQs.length}
                        </div>
                        <div style={{ fontSize: 10, color: T.text3 }}>Wrong</div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: T.text3 }}>No guesses tagged in OMR</div>
                  )}
                </div>
              </div>

              {/* Wrong question numbers */}
              <div style={{ borderTop: "1px solid " + T.border, paddingTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.text,
                  marginBottom: 10 }}>Wrong Question Numbers</div>

                {/* Non-guess wrong */}
                {nonGuessWrongQs.length > 0 ? (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: T.text3, marginBottom: 4 }}>
                      {"Without guessing — " + nonGuessWrongQs.length + " wrong"}
                    </div>
                    <QList qs={nonGuessWrongQs} color={T.red} />
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: T.text3, marginBottom: 12 }}>
                    No non-guess wrong answers 🎉
                  </div>
                )}

                {/* Guess wrong */}
                {hasAnyGuess && (
                  guessWrongQs.length > 0 ? (
                    <div>
                      <div style={{ fontSize: 11, color: T.text3, marginBottom: 4 }}>
                        {"By guessing — " + guessWrongQs.length + " wrong"}
                      </div>
                      <QList qs={guessWrongQs} color={T.orange} />
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: T.green }}>
                      All guessed answers were correct! 🎯
                    </div>
                  )
                )}
              </div>
            </Section>
          );
        })()}

        {/* Notes */}
        {paper.notes && (
          <div style={{ padding: "10px 14px", background: T.surface, borderRadius: 8, fontSize: 12, color: T.text2, lineHeight: 1.7 }}>
            📝 {paper.notes}
          </div>
        )}
      </Modal>

      {showContent && paper.content && (
        <ContentReader content={paper.content} onClose={() => setShowContent(false)} />
      )}
      {showQViewer && (
        <QuestionViewer
          paper={paper}
          syllabus={syllabus}
          onUpdateTopicTag={(qStr, topicId) => {
            if (onSaveSilent) {
              const newOMR = { ...paper.omr };
              newOMR[qStr] = { ...(newOMR[qStr] || {}), topicId };
              onSaveSilent({ ...paper, omr: newOMR });
            }
          }}
          onUpdateQText={(qStr, field, value) => {
            if (onSaveSilent) {
              const newQs = { ...paper.questions };
              newQs[qStr] = { ...(newQs[qStr] || {}), [field]: value };
              onSaveSilent({ ...paper, questions: newQs });
            }
          }}
          onClose={() => setShowQViewer(false)}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYLLABUS EDITOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SyllabusEditor — create or edit a syllabus.
 * Same layout as SyllabusImporter preview: per-topic rows with [N] number field
 * and name field, subject move ↑↓ buttons, inline add/remove for both.
 * Used for both "New Manually" and "Edit" — only the title and button label differ.
 */
export function SyllabusEditor({ initial, existingNames, onSave, onClose }) {
  const isEdit = !!initial;

  // Build editable subjects — topics as individual objects (not a textarea string)
  const buildSubjects = (src) => (src?.subjects || []).map(s => ({
    id:       s.id || uid(),
    name:     s.name || "",
    maxMarks: s.maxMarks ?? 10,
    qStart:   s.questionRange?.start || "",
    qEnd:     s.questionRange?.end   || "",
    topics:   (s.topics || []).map(t => ({
      id:              t.id || uid(),
      topicNo:         t.topicNo ?? "",
      name:            t.name || "",
      revisionCount:   t.revisionCount   || 0,
      lastRevisedDate: t.lastRevisedDate || null,
    })),
  }));

  const [examName,  setExamName]  = useState(initial?.name      || "");
  const [shortName, setShortName] = useState(initial?.shortName || "");
  const [negMark,   setNegMark]   = useState(String(initial?.negMark ?? 0.333));
  const [subjects,  setSubjects]  = useState(() => buildSubjects(initial));
  const [errors,    setErrors]    = useState({});

  const totalMarks  = subjects.reduce((a, s) => a + (parseInt(s.maxMarks) || 0), 0);
  const totalTopics = subjects.reduce((a, s) => a + s.topics.length, 0);

  // ── Subject helpers ────────────────────────────────────────────────────────
  const updSubj   = (i, k, v) => setSubjects(p => p.map((s, idx) => idx===i ? {...s,[k]:v} : s));
  const delSubj   = (i)       => setSubjects(p => p.filter((_,idx) => idx!==i));
  const moveSubj  = (i, dir)  => {
    const a = [...subjects], to = i+dir;
    if (to<0||to>=a.length) return;
    [a[i],a[to]]=[a[to],a[i]]; setSubjects(a);
  };
  const addSubject = () => setSubjects(p => [...p, {
    id:uid(), name:"", maxMarks:10, qStart:"", qEnd:"", topics:[]
  }]);

  // ── Topic helpers ──────────────────────────────────────────────────────────
  const updTopic = (si, ti, k, v) =>
    setSubjects(p => p.map((s,i) => i!==si ? s : {
      ...s, topics: s.topics.map((t,j) => j!==ti ? t : {...t,[k]:v})
    }));
  const delTopic   = (si, ti)  =>
    setSubjects(p => p.map((s,i) => i!==si ? s : {
      ...s, topics: s.topics.filter((_,j) => j!==ti)
    }));
  const addTopic   = (si) =>
    setSubjects(p => p.map((s,i) => i!==si ? s : {
      ...s, topics: [...s.topics, {id:uid(), topicNo:"", name:"", revisionCount:0, lastRevisedDate:null}]
    }));

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!examName.trim() || examName.trim().length < 3) e.name = "Exam name must be at least 3 characters";
    if (!shortName.trim())       e.shortName = "Short name is required";
    if (shortName.trim().length > 20) e.shortName = "Short name must be 20 chars or less";
    if (isNaN(negMark)||parseFloat(negMark)<0||parseFloat(negMark)>1) e.negMark = "Must be between 0 and 1";
    if ((existingNames||[]).filter(n => n !== initial?.name).includes(examName.trim()))
      e.name = "A syllabus with this name already exists";
    if (subjects.length===0) e.subjects = "Add at least one subject";
    subjects.forEach((s,i) => {
      if (!s.name?.trim())              e[`sn${i}`] = "Subject name required";
      if (!(parseInt(s.maxMarks)>=1))   e[`sm${i}`] = "Max marks required";
      if (s.topics.length===0)          e[`st${i}`] = "Add at least one topic";
      s.topics.forEach((t,j) => { if (!t.name?.trim()) e[`tn${i}_${j}`] = "Topic name required"; });
    });
    // Overlapping Q-ranges
    subjects.forEach((r1,a) => subjects.forEach((r2,b) => {
      if (a>=b || !r1.qStart || !r2.qStart) return;
      if (parseInt(r1.qStart)<=parseInt(r2.qEnd) && parseInt(r2.qStart)<=parseInt(r1.qEnd))
        e.overlap = `${r1.name} and ${r2.name} have overlapping Q-ranges`;
    }));
    setErrors(e);
    return Object.keys(e).length===0;
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!validate()) return;
    onSave({
      id:         initial?.id || uid(),
      name:       examName.trim(),
      shortName:  shortName.trim(),
      negMark:    parseFloat(negMark),
      totalMarks,
      createdAt:  initial?.createdAt || Date.now(),
      subjects:   subjects.map(s => ({
        id:            s.id,
        name:          s.name.trim(),
        maxMarks:      parseInt(s.maxMarks),
        questionRange: { start: parseInt(s.qStart)||0, end: parseInt(s.qEnd)||0 },
        topics:        s.topics
          .filter(t => t.name.trim())
          .map(t => ({
            id:              t.id,
            topicNo:         parseInt(t.topicNo) || null,
            name:            t.name.trim(),
            revisionCount:   t.revisionCount   || 0,
            lastRevisedDate: t.lastRevisedDate || null,
          })),
      })).filter(s => s.name),
    });
  };

  return (
    <Modal title={isEdit ? "Edit Syllabus" : "New Syllabus"} onClose={onClose} extraWide>

      {/* ── Exam meta ── */}
      <div style={{display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:12, marginBottom:16}}>
        <label style={{display:"flex", flexDirection:"column", gap:4}}>
          <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Exam Name *</span>
          <input value={examName} onChange={e=>setExamName(e.target.value)} maxLength={100}
            style={{...inputStyle, borderColor: errors.name ? T.red : T.border}}
            placeholder="e.g. Degree Level Preliminary 2025"/>
          <FieldError msg={errors.name}/>
        </label>
        <label style={{display:"flex", flexDirection:"column", gap:4}}>
          <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Short Name *</span>
          <input value={shortName} onChange={e=>setShortName(e.target.value)} maxLength={20}
            style={{...inputStyle, borderColor: errors.shortName ? T.red : T.border}}
            placeholder="DLP 2025"/>
          <FieldError msg={errors.shortName}/>
        </label>
        <label style={{display:"flex", flexDirection:"column", gap:4}}>
          <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Neg Mark / Wrong</span>
          <input type="number" step="0.001" min="0" max="1"
            value={negMark} onChange={e=>setNegMark(e.target.value)}
            style={{...inputStyle, borderColor: errors.negMark ? T.red : T.border}}/>
          <FieldError msg={errors.negMark}/>
        </label>
      </div>

      {/* ── Summary bar ── */}
      <div style={{display:"flex", gap:20, padding:"8px 14px",
        background:T.surface, borderRadius:8, marginBottom:14,
        border:`1px solid ${T.border}`, fontSize:12, color:T.text2}}>
        <span>{subjects.length} subject{subjects.length!==1?"s":""}</span>
        <span>{totalTopics} topic{totalTopics!==1?"s":""}</span>
        <span style={{color: totalMarks===100 ? T.green : T.yellow}}>
          {totalMarks} marks {totalMarks!==100 ? "⚠ not 100" : "✓"}
        </span>
      </div>

      {errors.subjects && <div style={{color:T.red,fontSize:12,marginBottom:8}}>⚠ {errors.subjects}</div>}
      {errors.overlap  && <div style={{color:T.yellow,fontSize:12,marginBottom:8}}>⚠ {errors.overlap}</div>}

      {/* ── Subject cards ── */}
      <div style={{maxHeight:"55vh", overflowY:"auto", paddingRight:4}}>
        {subjects.length===0 && (
          <div style={{textAlign:"center", padding:30, color:T.text3, fontSize:13}}>
            No subjects yet. Add one below.
          </div>
        )}
        {subjects.map((s, si) => (
          <div key={s.id} style={{border:`1px solid ${T.border}`,
            borderRadius:8, padding:14, marginBottom:10}}>

            {/* Subject header row */}
            <div style={{display:"flex", gap:8, marginBottom:10, alignItems:"flex-end", flexWrap:"wrap"}}>
              <label style={{display:"flex", flexDirection:"column", gap:4, flex:2, minWidth:140}}>
                <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Subject Name *</span>
                <input value={s.name} onChange={e=>updSubj(si,"name",e.target.value)}
                  style={{...inputStyle, borderColor: errors[`sn${si}`] ? T.red : T.border}}
                  placeholder="e.g. History"/>
                <FieldError msg={errors[`sn${si}`]}/>
              </label>
              <label style={{display:"flex", flexDirection:"column", gap:4, width:72}}>
                <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Marks *</span>
                <input type="number" min={0} value={s.maxMarks}
                  onChange={e=>updSubj(si,"maxMarks",e.target.value)}
                  style={{...inputStyle, textAlign:"center", borderColor: errors[`sm${si}`] ? T.red : T.border}}/>
                <FieldError msg={errors[`sm${si}`]}/>
              </label>
              <label style={{display:"flex", flexDirection:"column", gap:4, width:66}}>
                <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Q Start</span>
                <input type="number" min={1} max={200} value={s.qStart}
                  onChange={e=>updSubj(si,"qStart",e.target.value)}
                  style={{...inputStyle, textAlign:"center"}} placeholder="1"/>
              </label>
              <label style={{display:"flex", flexDirection:"column", gap:4, width:66}}>
                <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Q End</span>
                <input type="number" min={1} max={200} value={s.qEnd}
                  onChange={e=>updSubj(si,"qEnd",e.target.value)}
                  style={{...inputStyle, textAlign:"center"}} placeholder="10"/>
              </label>
              <div style={{display:"flex", gap:4, alignSelf:"center", flexShrink:0}}>
                <button onClick={()=>moveSubj(si,-1)} style={{...btnGhost, padding:"6px 10px"}} title="Move up">↑</button>
                <button onClick={()=>moveSubj(si,+1)} style={{...btnGhost, padding:"6px 10px"}} title="Move down">↓</button>
                <button onClick={()=>delSubj(si)}
                  style={{...btnGhost, color:T.red, borderColor:T.red+"44", padding:"6px 10px"}}>✕</button>
              </div>
            </div>

            {/* Topic rows */}
            {errors[`st${si}`] && <div style={{color:T.red,fontSize:11,marginBottom:6}}>⚠ {errors[`st${si}`]}</div>}
            <div style={{display:"flex", flexDirection:"column", gap:4}}>
              {s.topics.map((t, ti) => (
                <div key={t.id} style={{display:"flex", gap:6, alignItems:"center"}}>
                  <input type="number" min={1} value={t.topicNo || ""}
                    onChange={e=>updTopic(si,ti,"topicNo",e.target.value)}
                    placeholder="#"
                    style={{...inputStyle, width:52, textAlign:"center",
                      fontFamily:"monospace", fontSize:13, fontWeight:700,
                      color:T.accent2, padding:"5px 4px"}}/>
                  <input value={t.name} onChange={e=>updTopic(si,ti,"name",e.target.value)}
                    placeholder="Topic name"
                    style={{...inputStyle, flex:1, fontSize:12,
                      borderColor: errors[`tn${si}_${ti}`] ? T.red : T.border}}/>
                  <button onClick={()=>delTopic(si,ti)}
                    style={{...btnGhost, padding:"4px 8px", color:T.red,
                      borderColor:T.red+"33", fontSize:11, flexShrink:0}}>✕</button>
                </div>
              ))}
              <button onClick={()=>addTopic(si)}
                style={{...btnGhost, fontSize:11, padding:"4px 10px",
                  alignSelf:"flex-start", marginTop:4}}>
                + Add Topic
              </button>
            </div>
          </div>
        ))}

        <button onClick={addSubject}
          style={{...btnGhost, width:"100%", marginBottom:4}}>
          + Add Subject
        </button>
      </div>

      {/* ── Footer ── */}
      <div style={{display:"flex", gap:10, justifyContent:"flex-end",
        paddingTop:14, borderTop:`1px solid ${T.border}`, marginTop:8}}>
        <button onClick={onClose} style={btnGhost}>Cancel</button>
        <button onClick={handleSave} style={btnPrimary(T.accent)}>
          {isEdit ? "Update Syllabus" : "Save Syllabus →"}
        </button>
      </div>
    </Modal>
  );
}
