/**
 * AppSyllabusPart1b.jsx
 * UI components: SyllabusImporter, TopicMapImporter, AnswerKeyUploader, SmartOMR
 * Imports parsers and helpers from AppSyllabusPart1a.
 */
import React, { useState, useRef, useEffect } from "react";
import {
  T, inputStyle, btnPrimary, btnGhost,
  uid, pct, scoreColor,
  Bar, Badge, Modal, Section, FieldError,
  SearchSelect, ConfirmDialog,
  computeScoreFromOMR, subjectForQuestion,
} from "./AppCore";

import {
  buildTopicOptions, emptyOMR, emptyPaper, OPTS,
  parseSyllabusDocx, parseTopicMapDocx,
  parseAnswerKeyText, parseExplanationDocx,
} from "./AppSyllabusPart1a";

// Re-export components that live in Part1a so AppSyllabusPart2 only
// needs to import from Part1b (single import source for all UI components)
export { AnswerKeyUploader, SmartOMR } from "./AppSyllabusPart1a";

// ═══════════════════════════════════════════════════════════════════════════════
// SYLLABUS IMPORTER — upload docx, preview parsed structure, confirm
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SyllabusImporter
 * Shown when user picks "Import from Docx" in the Syllabi page.
 * Parses the uploaded docx, shows a fully-editable preview of every subject
 * and topic, then calls onConfirm(syllabusObject) on save.
 * Docx is never stored — only the parsed data is kept.
 */
export function SyllabusImporter({ existingNames, onConfirm, onClose }) {
  const [step, setStep]       = useState("upload"); // upload | preview | done
  const [parsed, setParsed]   = useState(null);
  const [examName, setExamName] = useState("");
  const [shortName, setShortName] = useState("");
  const [negMark, setNegMark] = useState("0.333");
  const [subjects, setSubjects] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [error, setError]     = useState("");
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef();

  const handleFile = async (file) => {
    if (!file || !file.name.endsWith(".docx")) {
      setError("Please upload a .docx file.");
      return;
    }
    setParsing(true); setError("");
    try {
      const ab  = await file.arrayBuffer();
      const zip = await window.JSZip.loadAsync(ab);
      const xml = await zip.file("word/document.xml").async("string");
      const runs = [];
      const re = new RegExp("<w:t[^>]*>([^<]+)</" + "w:t>", "g");
      let m;
      while ((m = re.exec(xml)) !== null) runs.push(m[1]);
      const rawText = runs.join("\n");
      const result  = parseSyllabusDocx(rawText);

      // Build editable subjects with uid per topic
      const editableSubjects = result.subjects.map(s => ({
        id:       uid(),
        name:     s.name,
        maxMarks: s.maxMarks,
        qStart:   s.qStart || "",
        qEnd:     s.qEnd   || "",
        topics:   s.topics.map(t => ({
          id:       uid(),
          topicNo:  t.topicNo,
          name:     t.name,
          revisionCount:   0,
          lastRevisedDate: null,
        })),
      }));

      setExamName(result.examName || file.name.replace(".docx",""));
      setShortName("");
      setSubjects(editableSubjects);
      setWarnings(result.warnings || []);
      setStep("preview");
    } catch (e) {
      setError("Could not read file: " + (e.message || "unknown error"));
    }
    setParsing(false);
  };

  // Subject editing helpers
  const updSubj = (idx, key, val) =>
    setSubjects(p => p.map((s,i) => i===idx ? {...s, [key]: val} : s));

  const updTopic = (sIdx, tIdx, key, val) =>
    setSubjects(p => p.map((s,i) => i!==sIdx ? s : {
      ...s,
      topics: s.topics.map((t,j) => j===tIdx ? {...t, [key]: val} : t)
    }));

  const addTopic = (sIdx) =>
    setSubjects(p => p.map((s,i) => i!==sIdx ? s : {
      ...s,
      topics: [...s.topics, { id: uid(), topicNo: "", name: "", revisionCount: 0, lastRevisedDate: null }]
    }));

  const removeTopic = (sIdx, tIdx) =>
    setSubjects(p => p.map((s,i) => i!==sIdx ? s : {
      ...s, topics: s.topics.filter((_,j) => j!==tIdx)
    }));

  const addSubject = () =>
    setSubjects(p => [...p, { id: uid(), name: "", maxMarks: 0, qStart: "", qEnd: "", topics: [] }]);

  const removeSubject = (idx) =>
    setSubjects(p => p.filter((_,i) => i!==idx));

  const moveSubject = (idx, dir) => {
    const arr = [...subjects];
    const to = idx + dir;
    if (to < 0 || to >= arr.length) return;
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    setSubjects(arr);
  };

  const totalMarks = subjects.reduce((a,s) => a + (parseInt(s.maxMarks)||0), 0);
  const totalTopics = subjects.reduce((a,s) => a + s.topics.length, 0);

  const handleConfirm = () => {
    if (!examName.trim()) { setError("Exam name is required."); return; }
    if (!shortName.trim()) { setError("Short name is required."); return; }
    if (subjects.length === 0) { setError("Add at least one subject."); return; }
    if ((existingNames||[]).includes(examName.trim())) {
      setError("A syllabus with this name already exists."); return;
    }
    const syllabus = {
      id:         uid(),
      name:       examName.trim(),
      shortName:  shortName.trim(),
      negMark:    parseFloat(negMark) || 1/3,
      totalMarks,
      createdAt:  Date.now(),
      subjects:   subjects.map(s => ({
        id:            s.id,
        name:          s.name.trim(),
        maxMarks:      parseInt(s.maxMarks) || 0,
        questionRange: { start: parseInt(s.qStart)||0, end: parseInt(s.qEnd)||0 },
        topics:        s.topics.map(t => ({
          id:              t.id,
          topicNo:         parseInt(t.topicNo) || null,
          name:            t.name.trim(),
          revisionCount:   0,
          lastRevisedDate: null,
        })).filter(t => t.name),
      })).filter(s => s.name),
    };
    onConfirm(syllabus);
  };

  // ── Upload step ──────────────────────────────────────────────────────────
  if (step === "upload") return (
    <Modal title="Import Syllabus from Docx" onClose={onClose} wide>
      <input ref={fileRef} type="file" accept=".docx" style={{display:"none"}}
        onChange={e => handleFile(e.target.files[0])} />
      <div style={{textAlign:"center", padding:"40px 20px"}}>
        <div style={{fontSize:48, marginBottom:16}}>📄</div>
        <div style={{fontSize:14, color:T.text2, marginBottom:8, lineHeight:1.7}}>
          Upload your numbered syllabus docx.<br/>
          Subject headers must use the format:<br/>
          <code style={{background:T.surface, padding:"2px 8px", borderRadius:4, color:T.accent2, fontSize:12}}>
            ### SubjectName (N Marks, Q1-Q10, Topics 1-25)
          </code><br/>
          Topics must use: <code style={{background:T.surface, padding:"2px 8px", borderRadius:4, color:T.accent2, fontSize:12}}>[N] Topic name</code>
        </div>
        {error && <div style={{color:T.red, fontSize:12, marginBottom:12}}>⚠ {error}</div>}
        <button onClick={() => fileRef.current?.click()}
          style={{...btnPrimary(T.accent), fontSize:14, padding:"10px 28px"}}>
          {parsing ? "Parsing…" : "Choose Docx File"}
        </button>
      </div>
    </Modal>
  );

  // ── Preview + edit step ──────────────────────────────────────────────────
  return (
    <Modal title="Review & Edit Parsed Syllabus" onClose={onClose} extraWide>
      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{background:T.yellow+"22", border:`1px solid ${T.yellow}44`,
          borderRadius:8, padding:"10px 14px", marginBottom:14}}>
          {warnings.map((w,i) => <div key={i} style={{fontSize:11, color:T.yellow}}>⚠ {w}</div>)}
        </div>
      )}

      {/* Exam meta */}
      <div style={{display:"grid", gridTemplateColumns:"2fr 1fr 1fr", gap:12, marginBottom:16}}>
        <label style={{display:"flex", flexDirection:"column", gap:4}}>
          <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Exam Name *</span>
          <input value={examName} onChange={e=>setExamName(e.target.value)}
            style={inputStyle} placeholder="Degree Level Preliminary 2025"/>
        </label>
        <label style={{display:"flex", flexDirection:"column", gap:4}}>
          <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Short Name *</span>
          <input value={shortName} onChange={e=>setShortName(e.target.value)}
            style={inputStyle} placeholder="DLP 2025" maxLength={20}/>
        </label>
        <label style={{display:"flex", flexDirection:"column", gap:4}}>
          <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Neg Mark / Wrong</span>
          <input type="number" step="0.001" min="0" max="1"
            value={negMark} onChange={e=>setNegMark(e.target.value)} style={inputStyle}/>
        </label>
      </div>

      {/* Summary bar */}
      <div style={{display:"flex", gap:20, padding:"8px 14px",
        background:T.surface, borderRadius:8, marginBottom:14,
        border:`1px solid ${T.border}`, fontSize:12, color:T.text2}}>
        <span>{subjects.length} subjects</span>
        <span>{totalTopics} topics</span>
        <span style={{color: totalMarks===100 ? T.green : T.yellow}}>
          Total marks: {totalMarks} {totalMarks!==100 ? "⚠ not 100" : "✓"}
        </span>
      </div>

      {error && <div style={{color:T.red, fontSize:12, marginBottom:10}}>⚠ {error}</div>}

      {/* Subject cards */}
      <div style={{maxHeight:"55vh", overflowY:"auto", paddingRight:4}}>
        {subjects.map((s, sIdx) => (
          <div key={s.id} style={{border:`1px solid ${T.border}`,
            borderRadius:8, padding:14, marginBottom:10}}>

            {/* Subject header row */}
            <div style={{display:"flex", gap:8, marginBottom:10, alignItems:"flex-end", flexWrap:"wrap"}}>
              <label style={{display:"flex", flexDirection:"column", gap:4, flex:2, minWidth:140}}>
                <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Subject Name</span>
                <input value={s.name} onChange={e=>updSubj(sIdx,"name",e.target.value)}
                  style={inputStyle} placeholder="e.g. History"/>
              </label>
              <label style={{display:"flex", flexDirection:"column", gap:4, width:72}}>
                <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Marks</span>
                <input type="number" min={0} value={s.maxMarks}
                  onChange={e=>updSubj(sIdx,"maxMarks",e.target.value)}
                  style={{...inputStyle, textAlign:"center"}}/>
              </label>
              <label style={{display:"flex", flexDirection:"column", gap:4, width:68}}>
                <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Q Start</span>
                <input type="number" min={1} max={200} value={s.qStart}
                  onChange={e=>updSubj(sIdx,"qStart",e.target.value)}
                  style={{...inputStyle, textAlign:"center"}} placeholder="1"/>
              </label>
              <label style={{display:"flex", flexDirection:"column", gap:4, width:68}}>
                <span style={{fontSize:10, color:T.text3, textTransform:"uppercase"}}>Q End</span>
                <input type="number" min={1} max={200} value={s.qEnd}
                  onChange={e=>updSubj(sIdx,"qEnd",e.target.value)}
                  style={{...inputStyle, textAlign:"center"}} placeholder="10"/>
              </label>
              <div style={{display:"flex", gap:4, alignSelf:"center"}}>
                <button onClick={()=>moveSubject(sIdx,-1)} style={{...btnGhost, padding:"6px 10px"}} title="Move up">↑</button>
                <button onClick={()=>moveSubject(sIdx,+1)} style={{...btnGhost, padding:"6px 10px"}} title="Move down">↓</button>
                <button onClick={()=>removeSubject(sIdx)}
                  style={{...btnGhost, color:T.red, borderColor:T.red+"44", padding:"6px 10px"}}>✕</button>
              </div>
            </div>

            {/* Topics list */}
            <div style={{display:"flex", flexDirection:"column", gap:4}}>
              {s.topics.map((t, tIdx) => (
                <div key={t.id} style={{display:"flex", gap:6, alignItems:"center"}}>
                  <input type="number" min={1} value={t.topicNo || ""}
                    onChange={e=>updTopic(sIdx,tIdx,"topicNo",e.target.value)}
                    style={{...inputStyle, width:56, textAlign:"center",
                      fontFamily:"monospace", fontSize:13, fontWeight:700,
                      color:T.accent2, padding:"5px 6px"}}
                    placeholder="#"/>
                  <input value={t.name}
                    onChange={e=>updTopic(sIdx,tIdx,"name",e.target.value)}
                    style={{...inputStyle, flex:1, fontSize:12}} placeholder="Topic name"/>
                  <button onClick={()=>removeTopic(sIdx,tIdx)}
                    style={{...btnGhost, padding:"4px 8px", color:T.red,
                      borderColor:T.red+"33", fontSize:11, flexShrink:0}}>✕</button>
                </div>
              ))}
              <button onClick={()=>addTopic(sIdx)}
                style={{...btnGhost, fontSize:11, padding:"4px 10px",
                  alignSelf:"flex-start", marginTop:4}}>
                + Add Topic
              </button>
            </div>
          </div>
        ))}
        <button onClick={addSubject}
          style={{...btnGhost, width:"100%", marginBottom:12}}>
          + Add Subject
        </button>
      </div>

      {/* Footer */}
      <div style={{display:"flex", gap:10, justifyContent:"space-between",
        paddingTop:14, borderTop:`1px solid ${T.border}`, marginTop:4}}>
        <button onClick={() => setStep("upload")} style={btnGhost}>← Re-upload</button>
        <div style={{display:"flex", gap:10}}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={handleConfirm} style={btnPrimary(T.accent)}>
            Save Syllabus →
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC MAP IMPORTER — upload frequency docx, review Q→topic mapping, apply
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * TopicMapImporter
 * Lives in the "Topic Map" tab of PaperForm.
 * Parses the frequency docx, resolves topicNo → topic.id via the syllabus,
 * shows a review table, then calls onApply(omrUpdates) on confirm.
 * Docx is discarded — only the Q→topic.id mapping is kept.
 */
export function TopicMapImporter({ syllabus, currentOMR, onApply, onClose }) {
  const [step, setStep]         = useState("upload");
  const [parsing, setParsing]   = useState(false);
  const [error, setError]       = useState("");
  const [warnings, setWarnings] = useState([]);
  const [rows, setRows]         = useState([]); // [{q, topicNo, topicId, topicLabel, status, manualId}]

  // Build topicNo → topic lookup from syllabus
  const topicByNo = {};
  (syllabus?.subjects || []).forEach(s =>
    (s.topics || []).forEach(t => {
      if (t.topicNo) topicByNo[t.topicNo] = t;
    })
  );

  // All topic options for manual override dropdown
  const allTopicOptions = buildTopicOptions(syllabus);

  const handleFile = async (file) => {
    if (!file || !file.name.endsWith(".docx")) { setError("Please upload a .docx file."); return; }
    setParsing(true); setError("");
    try {
      const ab  = await file.arrayBuffer();
      const zip = await window.JSZip.loadAsync(ab);
      const xml = await zip.file("word/document.xml").async("string");
      const runs = [];
      const re = new RegExp("<w:t[^>]*>([^<]+)</" + "w:t>", "g");
      let m;
      while ((m = re.exec(xml)) !== null) runs.push(m[1]);
      const rawText = runs.join("\n");

      const { qToTopicNo, warnings: w } = parseTopicMapDocx(rawText);
      setWarnings(w);

      // Build review rows for all 100 questions
      const newRows = Array.from({length:100},(_,i)=>i+1).map(q => {
        const topicNo = qToTopicNo[q] || null;
        const topic   = topicNo ? topicByNo[topicNo] : null;
        const existingTopicId = currentOMR?.[String(q)]?.topicId || null;
        return {
          q,
          topicNo,
          topicId:    topic?.id || null,
          topicLabel: topic ? `[${topic.topicNo}] ${topic.name}` : null,
          status:     !topicNo ? "untagged"
                    : topic   ? "matched"
                    : "unmatched",
          manualId:   null, // user can set this for unmatched
          existing:   existingTopicId,
        };
      });
      setRows(newRows);
      setStep("review");
    } catch(e) {
      setError("Could not read file: " + (e.message || "unknown error"));
    }
    setParsing(false);
  };

  const setManual = (q, topicId) =>
    setRows(prev => prev.map(r => r.q===q ? {...r, manualId: topicId} : r));

  const handleApply = () => {
    // Build omr updates: only questions that have a resolved topic
    const updates = {};
    rows.forEach(r => {
      const finalId = r.status==="matched" ? r.topicId
                    : r.status==="unmatched" && r.manualId ? r.manualId
                    : null;
      if (finalId) updates[String(r.q)] = finalId;
    });
    onApply(updates);
  };

  const matched   = rows.filter(r => r.status==="matched").length;
  const unmatched = rows.filter(r => r.status==="unmatched").length;
  const untagged  = rows.filter(r => r.status==="untagged").length;
  const manuallyResolved = rows.filter(r => r.status==="unmatched" && r.manualId).length;

  const statusColor = s => s==="matched" ? T.green : s==="unmatched" ? T.yellow : T.text3;
  const statusIcon  = s => s==="matched" ? "✓" : s==="unmatched" ? "⚠" : "—";

  // Filter hook — must be declared before any early return (Rules of Hooks)
  const [filter, setFilter] = useState("all");

  // Upload step
  if (step === "upload") return (
    <div>
      <input type="file" accept=".docx" style={{display:"none"}}
        id="tmf-input" onChange={e => handleFile(e.target.files[0])} />
      <p style={{fontSize:12, color:T.text2, marginBottom:16, lineHeight:1.7}}>
        Upload your numbered frequency/topic-map docx for this paper.
        The app will parse the Q→Topic number mappings and auto-tag all
        matched questions in the OMR. You can review and adjust before applying.
        The docx is discarded after confirmation.
      </p>
      {error && <div style={{color:T.red, fontSize:12, marginBottom:10}}>⚠ {error}</div>}
      <label htmlFor="tmf-input">
        <span style={{...btnPrimary(T.purple), display:"inline-block", cursor:"pointer"}}>
          {parsing ? "Parsing…" : "Upload Topic Map Docx"}
        </span>
      </label>
    </div>
  );

  // Review step — filter visible rows
  const visible = rows.filter(r =>
    filter==="all"       ? true :
    filter==="matched"   ? r.status==="matched" :
    filter==="unmatched" ? r.status==="unmatched" :
    r.status==="untagged"
  );

  return (
    <div>
      {/* Summary */}
      <div style={{display:"flex", gap:16, padding:"10px 14px",
        background:T.surface, borderRadius:8, marginBottom:12,
        border:`1px solid ${T.border}`, flexWrap:"wrap"}}>
        <span style={{fontSize:12, color:T.green}}>✓ {matched} auto-tagged</span>
        {unmatched>0 && <span style={{fontSize:12, color:T.yellow}}>⚠ {unmatched} topic not in syllabus</span>}
        {manuallyResolved>0 && <span style={{fontSize:12, color:T.cyan}}>✎ {manuallyResolved} manually assigned</span>}
        <span style={{fontSize:12, color:T.text3}}>— {untagged} untagged in docx</span>
      </div>

      {warnings.length>0 && (
        <div style={{background:T.yellow+"22", borderRadius:6, padding:"8px 12px", marginBottom:10}}>
          {warnings.map((w,i)=><div key={i} style={{fontSize:11,color:T.yellow}}>⚠ {w}</div>)}
        </div>
      )}

      {/* Filter tabs */}
      <div style={{display:"flex", gap:6, marginBottom:10}}>
        {[["all","All 100"],["matched",`Matched (${matched})`],
          ["unmatched",`⚠ Unmatched (${unmatched})`],["untagged",`— Untagged (${untagged})`]
        ].map(([k,l]) => (
          <button key={k} onClick={()=>setFilter(k)} style={{
            ...btnGhost, fontSize:11, padding:"4px 10px",
            background: filter===k ? T.accent+"33" : "transparent",
            color: filter===k ? T.accent2 : T.text2,
            borderColor: filter===k ? T.accent : T.border2,
          }}>{l}</button>
        ))}
      </div>

      {/* Review table */}
      <div style={{maxHeight:"45vh", overflowY:"auto",
        border:`1px solid ${T.border}`, borderRadius:8}}>
        {visible.map(r => (
          <div key={r.q} style={{
            display:"flex", gap:10, alignItems:"center",
            padding:"8px 12px", borderBottom:`1px solid ${T.border}`,
            background: r.status==="matched" ? T.green+"08"
                      : r.status==="unmatched" ? T.yellow+"08" : "transparent",
          }}>
            {/* Q number */}
            <span style={{fontFamily:"monospace", fontSize:12,
              color:T.text3, width:28, flexShrink:0}}>Q{r.q}</span>

            {/* Status icon */}
            <span style={{fontSize:14, color:statusColor(r.status), width:16, flexShrink:0}}>
              {statusIcon(r.status)}
            </span>

            {/* Topic info */}
            <div style={{flex:1, minWidth:0}}>
              {r.status==="matched" && (
                <span style={{fontSize:12, color:T.text2}}>{r.topicLabel}</span>
              )}
              {r.status==="unmatched" && (
                <div style={{display:"flex", gap:8, alignItems:"center"}}>
                  <span style={{fontSize:11, color:T.yellow}}>
                    Topic [{r.topicNo}] not in syllabus
                  </span>
                  <div style={{flex:1}}>
                    <SearchSelect
                      options={allTopicOptions}
                      value={r.manualId}
                      onChange={v=>setManual(r.q,v)}
                      placeholder="Assign manually…"
                    />
                  </div>
                </div>
              )}
              {r.status==="untagged" && (
                <span style={{fontSize:11, color:T.text3}}>
                  Not in frequency docx
                  {r.existing && " · has existing tag"}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{display:"flex", gap:10, marginTop:14,
        justifyContent:"space-between", alignItems:"center"}}>
        <button onClick={()=>setStep("upload")} style={btnGhost}>← Re-upload</button>
        <button onClick={handleApply}
          style={btnPrimary(T.accent)}>
          Apply {matched + manuallyResolved} Tags →
        </button>
      </div>
    </div>
  );
}
