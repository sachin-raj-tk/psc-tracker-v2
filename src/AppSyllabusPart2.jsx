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
} from "./AppSyllabusPart1a";

import {
  AnswerKeyUploader, SmartOMR,
  SyllabusImporter, TopicMapImporter,
} from "./AppSyllabusPart1b";

export function PaperForm({ syllabus, initial, onSave, onClose }) {
  const [form, setForm]         = useState(initial || emptyPaper(syllabus));
  const [tab, setTab]           = useState("meta");
  const [errors, setErrors]     = useState({});
  const [dirty, setDirty]       = useState(false);
  const [showOMR, setShowOMR]   = useState(false);

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

  const handleOMRSave = ({ omr, computed, bookletCode }) => {
    setForm(f => ({ ...f, omr, computed, bookletCode }));
    setDirty(true);
    setShowOMR(false);
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

  return (
    <>
      <Modal title={initial ? "Edit Paper" : "Add New Paper"} onClose={onClose} extraWide>

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
                {answered > 0 && (
                  <button
                    onClick={() => { if (window.confirm("Clear all OMR entries?")) { set("omr", emptyOMR()); set("computed", null); }}}
                    style={{ ...btnGhost, color: T.red, borderColor: T.red + "44" }}
                  >Clear OMR</button>
                )}
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
                {form.content?.docxName ? `✓ Replace Docx (${form.content.docxName})` : "Upload Explanation Docx"}
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
                {form.content?.pdfName ? `✓ Replace PDF (${form.content.pdfName})` : "Upload PDF"}
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

      {/* OMR overlay */}
      {showOMR && (
        <SmartOMR
          omr={form.omr}
          answerKey={form.answerKey}
          bookletCode={form.bookletCode}
          syllabus={syllabus}
          rangeOverride={form.questionRangeOverride}
          onSave={handleOMRSave}
          onClose={() => setShowOMR(false)}
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
// PAPER DETAIL VIEW
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PaperDetail — read-only summary of a saved paper.
 * Shows subject breakdown, guess analysis, OMR results, topic performance.
 */
export function PaperDetail({ paper, syllabus, onEdit, onClose, onShare }) {
  const [showContent, setShowContent] = useState(false);
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
              <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>
                ✓ {c.totalCorrect} correct &nbsp; ✗ {c.totalWrong} wrong &nbsp;
                ⊘ {c.totalDeleted} deleted &nbsp; — {c.totalUnattempted} unattempted &nbsp;
                Penalty: <span style={{ color: T.orange }}>−{c.totalPenalty.toFixed(2)}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {hasContent && <button onClick={() => setShowContent(true)} style={btnGhost}>📄 Content</button>}
            <button onClick={onShare} style={btnGhost}>📤 Share</button>
            <button onClick={onEdit}  style={btnGhost}>Edit</button>
          </div>
        </div>

        {/* Subject breakdown */}
        {c && (
          <Section title="Subject-wise Scores" accent={T.purple}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
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
          </Section>
        )}

        {/* Topic performance */}
        {c && Object.keys(c.byTopic || {}).length > 0 && (
          <Section title="Topic Performance (from OMR tags)" accent={T.cyan}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {Object.entries(c.byTopic).map(([tid, stats]) => {
                const topic = syllabus.subjects.flatMap(s => s.topics).find(t => t.id === tid);
                if (!topic) return null;
                const acc = stats.total > 0 ? Math.round(stats.correct / stats.total * 100) : 0;
                return (
                  <div key={tid} style={{
                    padding: "6px 10px", borderRadius: 6,
                    background: T.surface, border: `1px solid ${T.border}`,
                    fontSize: 11,
                  }}>
                    <span style={{ color: T.text2 }}>{topic.name}</span>
                    <span style={{ marginLeft: 8, color: scoreColor(acc), fontFamily: "monospace" }}>
                      {stats.correct}/{stats.total} ({acc}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

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
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYLLABUS EDITOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SyllabusEditor — create or edit a syllabus with full validation.
 * Subjects have: name, maxMarks, questionRange (start/end), topics (text area).
 */
export function SyllabusEditor({ initial, existingNames, onSave, onClose }) {
  const [name,      setName]      = useState(initial?.name || "");
  const [shortName, setShortName] = useState(initial?.shortName || "");
  const [negMark,   setNegMark]   = useState(initial?.negMark ?? 0.333);
  const [subjects,  setSubjects]  = useState(
    initial?.subjects
      ? initial.subjects.map(s => ({ ...s, topicsText: s.topics.map(t => t.name).join("\n") }))
      : []
  );
  const [errors, setErrors]       = useState({});

  const totalMarks = subjects.reduce((a, s) => a + (parseInt(s.maxMarks) || 0), 0);

  const addSubject = () => setSubjects(p => [...p, {
    id: uid(), name: "", maxMarks: 10,
    questionRange: { start: "", end: "" },
    topicsText: "",
  }]);

  const updSubj = (idx, key, val) =>
    setSubjects(p => p.map((s, i) => i === idx ? { ...s, [key]: val } : s));

  const updRange = (idx, field, val) =>
    setSubjects(p => p.map((s, i) => i === idx
      ? { ...s, questionRange: { ...s.questionRange, [field]: parseInt(val) || "" } }
      : s));

  const delSubj = (idx) => setSubjects(p => p.filter((_, i) => i !== idx));

  // Validate all fields, return true if clean
  const doValidate = () => {
    const e = {};
    if (!name.trim() || name.trim().length < 3) e.name = "Name must be at least 3 characters";
    if (!shortName.trim()) e.shortName = "Short name is required";
    if (shortName.trim().length > 20) e.shortName = "Short name must be 20 chars or less";
    if (isNaN(negMark) || negMark < 0 || negMark > 1) e.negMark = "Negative mark must be between 0 and 1";
    if ((existingNames || []).filter(n => n !== initial?.name).includes(name.trim()))
      e.name = "A syllabus with this name already exists";
    if (subjects.length === 0) e.subjects = "Add at least one subject";

    subjects.forEach((s, i) => {
      if (!s.name?.trim()) e[`s_name_${i}`] = "Subject name is required";
      if (!s.maxMarks || parseInt(s.maxMarks) < 1) e[`s_marks_${i}`] = "Max marks must be at least 1";
      if (s.questionRange?.start && s.questionRange?.end) {
        if (s.questionRange.end <= s.questionRange.start)
          e[`s_range_${i}`] = "Range end must be greater than start";
      }
      if (!s.topicsText?.trim()) e[`s_topics_${i}`] = "Add at least one topic";
    });

    // Check overlapping ranges
    const ranges = subjects.map((s, i) => ({ i, ...s.questionRange }));
    ranges.forEach((r1, a) => {
      ranges.forEach((r2, b) => {
        if (a >= b || !r1.start || !r2.start) return;
        if (r1.start <= r2.end && r2.start <= r1.end)
          e[`s_range_overlap`] = `Subjects ${a+1} and ${b+1} have overlapping question ranges`;
      });
    });

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!doValidate()) return;
    const subs = subjects.map(s => ({
      id: s.id,
      name: s.name.trim(),
      maxMarks: parseInt(s.maxMarks),
      questionRange: {
        start: parseInt(s.questionRange?.start) || 0,
        end:   parseInt(s.questionRange?.end)   || 0,
      },
      topics: s.topicsText.split("\n").map(t => t.trim()).filter(Boolean).map((raw, ti) => {
        // Parse optional [N] prefix: "[3] Topic name" or just "Topic name"
        const numMatch = raw.match(/^\[(\d+)\]\s*(.+)/);
        const topicNo  = numMatch ? parseInt(numMatch[1]) : null;
        const name     = numMatch ? numMatch[2].trim() : raw.trim();
        const existing = initial?.subjects?.find(os => os.id === s.id)?.topics?.[ti];
        return {
          id:              existing?.id || uid(),
          topicNo:         topicNo ?? existing?.topicNo ?? null,
          name,
          revisionCount:   existing?.revisionCount  || 0,
          lastRevisedDate: existing?.lastRevisedDate || null,
        };
      }),
    }));
    onSave({
      id: initial?.id || uid(),
      name: name.trim(), shortName: shortName.trim(),
      negMark: parseFloat(negMark), totalMarks,
      createdAt: initial?.createdAt || Date.now(),
      subjects: subs,
    });
  };

  return (
    <Modal title={initial ? "Edit Syllabus" : "New Syllabus"} onClose={onClose} wide>
      {/* Meta */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, gridColumn: "span 2" }}>
          <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase" }}>Exam Name *</span>
          <input style={{ ...inputStyle, borderColor: errors.name ? T.red : T.border }}
            value={name} onChange={e => setName(e.target.value)} maxLength={100}
            placeholder="e.g. Degree Level Preliminary 2025" />
          <FieldError msg={errors.name} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase" }}>Short Name *</span>
          <input style={{ ...inputStyle, borderColor: errors.shortName ? T.red : T.border }}
            value={shortName} onChange={e => setShortName(e.target.value)} maxLength={20}
            placeholder="DLP 2025" />
          <FieldError msg={errors.shortName} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase" }}>Negative Mark / Wrong *</span>
          <input style={{ ...inputStyle, borderColor: errors.negMark ? T.red : T.border }}
            type="number" step="0.001" min="0" max="1"
            value={negMark} onChange={e => setNegMark(e.target.value)} />
          <FieldError msg={errors.negMark} />
        </label>
        <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
          <span style={{ fontSize: 13, color: T.text2 }}>
            Total Marks: <strong style={{ color: totalMarks === 100 ? T.green : T.yellow, fontFamily: "monospace" }}>{totalMarks}</strong>
            {totalMarks !== 100 && <span style={{ fontSize: 11, color: T.yellow }}> ⚠ not 100</span>}
          </span>
        </div>
      </div>

      {errors.subjects && <div style={{ color: T.red, fontSize: 12, marginBottom: 8 }}>⚠ {errors.subjects}</div>}
      {errors.s_range_overlap && <div style={{ color: T.yellow, fontSize: 12, marginBottom: 8 }}>⚠ {errors.s_range_overlap}</div>}

      <div style={{ fontWeight: 700, fontSize: 13, color: T.text, marginBottom: 12 }}>Subjects</div>

      {subjects.map((s, idx) => (
        <div key={s.id} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 14, marginBottom: 10 }}>

          {/* Row 1: Subject name (full width) + Remove button */}
          <div style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-end" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
              <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Subject Name *
              </span>
              <input
                style={{ ...inputStyle, borderColor: errors[`s_name_${idx}`] ? T.red : T.border }}
                value={s.name}
                onChange={e => updSubj(idx, "name", e.target.value)}
                placeholder="e.g. History"
              />
              <FieldError msg={errors[`s_name_${idx}`]} />
            </label>
            <button
              onClick={() => delSubj(idx)}
              style={{
                ...btnGhost,
                color: T.red, borderColor: T.red + "44",
                padding: "9px 14px", flexShrink: 0,
                alignSelf: errors[`s_name_${idx}`] ? "center" : "flex-end",
                marginBottom: errors[`s_name_${idx}`] ? 18 : 0,
              }}
            >
              Remove
            </button>
          </div>

          {/* Row 2: Max Marks | Q Start | Q End — equal thirds */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Max Marks *
              </span>
              <input
                style={{ ...inputStyle, textAlign: "center", borderColor: errors[`s_marks_${idx}`] ? T.red : T.border }}
                type="number" min={1} value={s.maxMarks}
                onChange={e => updSubj(idx, "maxMarks", e.target.value)}
              />
              <FieldError msg={errors[`s_marks_${idx}`]} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Q Range Start
              </span>
              <input
                style={{ ...inputStyle, textAlign: "center" }}
                type="number" min={1} max={100}
                value={s.questionRange?.start || ""}
                onChange={e => updRange(idx, "start", e.target.value)}
                placeholder="1"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Q Range End
              </span>
              <input
                style={{ ...inputStyle, textAlign: "center", borderColor: errors[`s_range_${idx}`] ? T.red : T.border }}
                type="number" min={1} max={100}
                value={s.questionRange?.end || ""}
                onChange={e => updRange(idx, "end", e.target.value)}
                placeholder="10"
              />
              <FieldError msg={errors[`s_range_${idx}`]} />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing:"0.08em" }}>
              Topics (one per line — optionally prefix with [N] e.g. "[3] Topic name") *
            </span>
            <textarea rows={5} value={s.topicsText}
              onChange={e => updSubj(idx, "topicsText", e.target.value)}
              placeholder={"[1] Kerala History\n[2] British India\n[3] World History\nOr just: Topic without number"}
              style={{ ...inputStyle, resize: "vertical", fontFamily:"monospace", fontSize:12,
                borderColor: errors[\`s_topics_\${idx}\`] ? T.red : T.border }} />
            <FieldError msg={errors[\`s_topics_\${idx}\`]} />
          </label>
        </div>
      ))}

      <button onClick={addSubject} style={{ ...btnGhost, width: "100%", marginBottom: 20 }}>+ Add Subject</button>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btnGhost}>Cancel</button>
        <button onClick={handleSave} style={btnPrimary(T.accent)}>Save Syllabus</button>
      </div>
    </Modal>
  );
}
