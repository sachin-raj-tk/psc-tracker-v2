/**
 * AppCore.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Foundation module for PSC Tracker.
 * Contains:
 *   - Design tokens (colours, spacing, shared styles)
 *   - localStorage-backed async DB helper
 *   - Default syllabus (DLP 2025)
 *   - Pure calculation utilities (marks, guess analysis)
 *   - Shared UI primitives (Bar, Badge, Modal, NumInput, Section, Toast)
 *   - Validation helpers
 *
 * Nothing in this file imports from other App* files.
 * Every other module imports from here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE — async wrapper over localStorage
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * DB — thin async wrapper around localStorage.
 * All values are JSON-serialised. Errors are caught and logged,
 * never thrown silently — callers receive null on read failure.
 */
export const DB = {
  /** Read and JSON-parse a stored value. Returns null if missing or corrupt. */
  async get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error(`[DB.get] key=${key}`, e);
      return null;
    }
  },

  /**
   * JSON-serialise and store a value.
   * Returns true on success, false on failure (e.g. storage quota exceeded).
   */
  async set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`[DB.set] key=${key}`, e);
      // Quota exceeded or private-browsing restriction
      if (e.name === "QuotaExceededError") return "QUOTA";
      return false;
    }
  },

  /** Remove a key. Always succeeds silently. */
  async del(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// Storage keys — centralised so they never drift
export const KEYS = {
  SYLLABI:    "psc-syllabi",
  PAPERS:     "psc-papers",
  STUDY_LOGS: "psc-study-logs",
  STREAKS:    "psc-streaks",
  SYNC_META:  "psc-sync-meta",
};

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════════════════

/** Colour palette and shared style values. Import T wherever colours are needed. */
export const T = {
  // Backgrounds
  bg:      "#07090f",
  surface: "#0d1117",
  card:    "#111827",
  card2:   "#1a2235",

  // Borders
  border:  "#1f2937",
  border2: "#374151",

  // Text
  text:    "#f9fafb",
  text2:   "#9ca3af",
  text3:   "#4b5563",
  text4:   "#6b7280",

  // Accents
  accent:  "#6366f1",
  accent2: "#818cf8",
  accent3: "#4f46e5",

  // Semantic colours
  green:   "#4ade80",
  yellow:  "#fbbf24",
  orange:  "#fb923c",
  red:     "#f87171",
  pink:    "#f472b6",
  cyan:    "#22d3ee",
  purple:  "#a78bfa",
  teal:    "#2dd4bf",

  // Subject palette (12 subjects max)
  subjectColors: [
    "#60a5fa", // History
    "#34d399", // Geography
    "#a78bfa", // Economics
    "#f472b6", // Constitution
    "#fbbf24", // Civics
    "#fb923c", // Arts
    "#22d3ee", // Computer
    "#4ade80", // Science
    "#818cf8", // Arithmetic
    "#f43f5e", // Reasoning
    "#e879f9", // Grammar
    "#fde68a", // Vocabulary / Malayalam
  ],
};

// ─── Reusable inline style objects ──────────────────────────────────────────

/** Standard input style */
export const inputStyle = {
  background:  T.surface,
  border:      `1px solid ${T.border}`,
  borderRadius: 6,
  padding:     "8px 10px",
  color:       T.text,
  fontSize:    13,
  outline:     "none",
  width:       "100%",
  boxSizing:   "border-box",
  fontFamily:  "inherit",
  transition:  "border-color 0.15s",
};

/** Primary action button style factory */
export const btnPrimary = (bg = T.accent, color = "#fff") => ({
  background:   bg,
  border:       "none",
  borderRadius: 6,
  padding:      "9px 18px",
  color,
  fontSize:     13,
  fontWeight:   600,
  cursor:       "pointer",
  fontFamily:   "inherit",
  transition:   "opacity 0.15s",
  whiteSpace:   "nowrap",
});

/** Ghost / secondary button style */
export const btnGhost = {
  background:   "transparent",
  border:       `1px solid ${T.border2}`,
  borderRadius: 6,
  padding:      "7px 14px",
  color:        T.text2,
  fontSize:     12,
  cursor:       "pointer",
  fontFamily:   "inherit",
  whiteSpace:   "nowrap",
};

/** Card container style */
export const cardStyle = {
  background:   T.card,
  border:       `1px solid ${T.border}`,
  borderRadius: 10,
  padding:      "18px 20px",
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Generate a short random ID */
export const uid = () => Math.random().toString(36).slice(2, 10);

/** Clamp a number between lo and hi */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Convert value/max to integer percentage */
export const pct = (v, max) => (max > 0 ? Math.round((v / max) * 100) : 0);

/**
 * Return a semantic colour based on percentage score.
 * ≥70 → green, ≥50 → yellow, ≥35 → orange, <35 → red
 */
export const scoreColor = (p) =>
  p >= 70 ? T.green : p >= 50 ? T.yellow : p >= 35 ? T.orange : T.red;

/** Format a date string (YYYY-MM-DD) to a readable label */
export const fmtDate = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return d; }
};

/** Today's date as YYYY-MM-DD */
export const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Calculate marks for a subject/section.
 * @param {number|string} correct
 * @param {number|string} wrong
 * @param {number} negMark - marks deducted per wrong answer (e.g. 0.333)
 * @returns {{ correct, wrong, marks, penalty }}
 */
export function calcMarks(correct, wrong, negMark = 1 / 3) {
  const c = Math.max(0, parseInt(correct) || 0);
  const w = Math.max(0, parseInt(wrong) || 0);
  const penalty = w * negMark;
  return { correct: c, wrong: w, penalty, marks: Math.max(0, c - penalty) };
}

/**
 * Calculate combined guess analysis from 50:50 and wild-guess entries.
 * @returns {{ fiftyFifty, wildGuess, total }}
 */
export function calcGuess(ff_c, ff_w, wg_c, wg_w, negMark = 1 / 3) {
  const ff = calcMarks(ff_c, ff_w, negMark);
  const wg = calcMarks(wg_c, wg_w, negMark);
  return {
    fiftyFifty: ff,
    wildGuess:  wg,
    total: {
      correct: ff.correct + wg.correct,
      wrong:   ff.wrong   + wg.wrong,
      marks:   ff.marks   + wg.marks,
      penalty: ff.penalty + wg.penalty,
    },
  };
}

/**
 * Accuracy percentage for a guess group.
 * Returns null if no guesses made (avoids division by zero).
 */
export const guessAccuracy = (correct, wrong) => {
  const total = correct + wrong;
  return total > 0 ? Math.round((correct / total) * 100) : null;
};

/**
 * Given a syllabus and a question number, return the subject that owns it.
 * Uses questionRange or questionRangeOverride from the paper.
 * @param {object} syllabus
 * @param {number} qNo
 * @param {object} [rangeOverride] - optional per-paper override map
 * @returns {object|null} subject or null
 */
export function subjectForQuestion(syllabus, qNo, rangeOverride = {}) {
  for (const subj of syllabus.subjects) {
    const range = rangeOverride[subj.id] || subj.questionRange;
    if (range && qNo >= range.start && qNo <= range.end) return subj;
  }
  return null;
}

/**
 * Compute full paper score from OMR answers + answer key.
 * Returns per-question results, per-subject totals, and overall totals.
 * Deleted questions (answer = "X") are excluded from scoring.
 *
 * @param {object} omr - { [qNo]: { answer, isGuess, guessType, topicId, subjectOverride } }
 * @param {object} keyAnswers - { [qNo]: "A"|"B"|"C"|"D"|"X" }
 * @param {object} syllabus
 * @param {object} [rangeOverride]
 * @returns {object} computed scores
 */
export function computeScoreFromOMR(omr, keyAnswers, syllabus, rangeOverride = {}) {
  const bySubject = {};
  const byTopic   = {};

  // Initialise subject buckets
  for (const subj of syllabus.subjects) {
    bySubject[subj.id] = {
      correct: 0, wrong: 0, unattempted: 0, deleted: 0, marks: 0,
      guessCorrect: 0, guessWrong: 0,
      ffCorrect: 0, ffWrong: 0,
      wildCorrect: 0, wildWrong: 0,
    };
  }

  const perQuestion = {};
  let totalCorrect = 0, totalWrong = 0, totalDeleted = 0, totalUnattempted = 0;

  for (let q = 1; q <= 100; q++) {
    const entry    = omr[String(q)] || omr[q] || {};  // string key (JSON) or integer key (new)
    const keyAns   = keyAnswers ? (keyAnswers[String(q)] || null) : null;
    const myAns    = entry.answer || null;
    const isDeleted = keyAns === "X";

    // Identify owning subject (override → auto-range → null)
    const overrideSubjId = entry.subjectOverride || null;
    const autoSubj = subjectForQuestion(syllabus, q, rangeOverride);
    const subjId   = overrideSubjId || (autoSubj ? autoSubj.id : null);
    const subj     = subjId ? bySubject[subjId] : null;

    let result = "unattempted"; // correct | wrong | unattempted | deleted | nokey

    if (isDeleted) {
      result = "deleted";
      totalDeleted++;
      if (subj) subj.deleted++;
    } else if (!keyAns) {
      result = "nokey";
    } else if (!myAns) {
      result = "unattempted";
      totalUnattempted++;
      if (subj) subj.unattempted++;
    } else if (myAns === keyAns) {
      result = "correct";
      totalCorrect++;
      if (subj) {
        subj.correct++;
        if (entry.isGuess) {
          subj.guessCorrect++;
          if (entry.guessType === "5050") subj.ffCorrect++;
          else subj.wildCorrect++;
        }
      }
    } else {
      result = "wrong";
      totalWrong++;
      if (subj) {
        subj.wrong++;
        if (entry.isGuess) {
          subj.guessWrong++;
          if (entry.guessType === "5050") subj.ffWrong++;
          else subj.wildWrong++;
        }
      }
    }

    // Topic aggregation
    if (entry.topicId) {
      if (!byTopic[entry.topicId]) byTopic[entry.topicId] = { correct: 0, wrong: 0, total: 0 };
      byTopic[entry.topicId].total++;
      if (result === "correct") byTopic[entry.topicId].correct++;
      if (result === "wrong")   byTopic[entry.topicId].wrong++;
    }

    perQuestion[q] = { result, myAns, keyAns, subjId, isGuess: entry.isGuess || false, guessType: entry.guessType || null, topicId: entry.topicId || null };
  }

  // Compute marks per subject
  const neg = syllabus.negMark || 1 / 3;
  for (const id of Object.keys(bySubject)) {
    const s = bySubject[id];
    s.marks = Math.max(0, s.correct - s.wrong * neg);
  }

  const totalPenalty = totalWrong * neg;
  const totalMarks   = Math.max(0, totalCorrect - totalPenalty);

  return {
    perQuestion,
    bySubject,
    byTopic,
    totalCorrect,
    totalWrong,
    totalDeleted,
    totalUnattempted,
    totalPenalty,
    totalMarks,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Returns an error string or null if value is valid */
export const validate = {
  required:    (v, label = "This field") =>
    !String(v).trim() ? `${label} is required` : null,

  minLen:      (v, n, label = "This field") =>
    String(v).trim().length < n ? `${label} must be at least ${n} characters` : null,

  maxLen:      (v, n, label = "This field") =>
    String(v).trim().length > n ? `${label} must be at most ${n} characters` : null,

  positiveInt: (v, label = "Value") =>
    (!Number.isInteger(Number(v)) || Number(v) < 1)
      ? `${label} must be a positive whole number` : null,

  range:       (v, lo, hi, label = "Value") =>
    (Number(v) < lo || Number(v) > hi)
      ? `${label} must be between ${lo} and ${hi}` : null,

  noFutureDate: (v, label = "Date") =>
    v && v > todayStr() ? `${label} cannot be in the future` : null,
};

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT SYLLABUS — DLP 2025 (Degree Level Common Preliminary)
// ═══════════════════════════════════════════════════════════════════════════════

export const DEFAULT_SYLLABUS = {
  id:         "dlp2025",
  name:       "Degree Level Common Preliminary Examination 2025",
  shortName:  "DLP 2025",
  totalMarks: 100,
  negMark:    1 / 3,
  createdAt:  Date.now(),
  subjects: [
    {
      id: "hist", name: "History", maxMarks: 10,
      questionRange: { start: 1, end: 10 },
      topics: [
        { id: "h1",  name: "Kerala – Europeans & Travancore History",         revisionCount: 0, lastRevisedDate: null },
        { id: "h2",  name: "Kerala – Social & Religious Reform Movements",    revisionCount: 0, lastRevisedDate: null },
        { id: "h3",  name: "Kerala – National Movement & Literary Sources",   revisionCount: 0, lastRevisedDate: null },
        { id: "h4",  name: "Kerala – United Kerala Movement & Post-1956",     revisionCount: 0, lastRevisedDate: null },
        { id: "h5",  name: "India – Medieval India & British Establishment",  revisionCount: 0, lastRevisedDate: null },
        { id: "h6",  name: "India – First War of Independence & INC",         revisionCount: 0, lastRevisedDate: null },
        { id: "h7",  name: "India – Swadeshi & Social Reform Movements",      revisionCount: 0, lastRevisedDate: null },
        { id: "h8",  name: "India – Gandhi, Freedom Struggle & Independence", revisionCount: 0, lastRevisedDate: null },
        { id: "h9",  name: "India – Post-Independence & State Reorganisation",revisionCount: 0, lastRevisedDate: null },
        { id: "h10", name: "World – Great Revolutions",                       revisionCount: 0, lastRevisedDate: null },
        { id: "h11", name: "World – Russian & Chinese Revolutions",           revisionCount: 0, lastRevisedDate: null },
        { id: "h12", name: "World – Post-WWII Political History & UNO",       revisionCount: 0, lastRevisedDate: null },
        { id: "h13", name: "Current Affairs (History)",                        revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "geo", name: "Geography", maxMarks: 5,
      questionRange: { start: 11, end: 15 },
      topics: [
        { id: "g1",  name: "Basics – Earth Structure, Atmosphere & Rocks",   revisionCount: 0, lastRevisedDate: null },
        { id: "g2",  name: "Basics – Landforms, Pressure Belts & Winds",     revisionCount: 0, lastRevisedDate: null },
        { id: "g3",  name: "Basics – Climate, Seasons & Global Issues",      revisionCount: 0, lastRevisedDate: null },
        { id: "g4",  name: "Basics – Maps, Remote Sensing & GIS",            revisionCount: 0, lastRevisedDate: null },
        { id: "g5",  name: "Basics – Oceans, Continents & World Nations",    revisionCount: 0, lastRevisedDate: null },
        { id: "g6",  name: "India – Physiography & Northern Mountains",      revisionCount: 0, lastRevisedDate: null },
        { id: "g7",  name: "India – Rivers & Great Plains",                  revisionCount: 0, lastRevisedDate: null },
        { id: "g8",  name: "India – Climate, Vegetation & Agriculture",      revisionCount: 0, lastRevisedDate: null },
        { id: "g9",  name: "India – Minerals, Industries & Transport",       revisionCount: 0, lastRevisedDate: null },
        { id: "g10", name: "Kerala – Physiography, Districts & Rivers",      revisionCount: 0, lastRevisedDate: null },
        { id: "g11", name: "Kerala – Climate, Vegetation & Wildlife",        revisionCount: 0, lastRevisedDate: null },
        { id: "g12", name: "Kerala – Agriculture, Minerals & Transport",     revisionCount: 0, lastRevisedDate: null },
        { id: "g13", name: "Current Affairs (Geography)",                     revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "eco", name: "Economics", maxMarks: 5,
      questionRange: { start: 16, end: 20 },
      topics: [
        { id: "e1",  name: "National Income & Per Capita Income",            revisionCount: 0, lastRevisedDate: null },
        { id: "e2",  name: "Factors of Production & Economic Sectors",       revisionCount: 0, lastRevisedDate: null },
        { id: "e3",  name: "Indian Economic Planning & Five Year Plans",     revisionCount: 0, lastRevisedDate: null },
        { id: "e4",  name: "NITI Aayog",                                     revisionCount: 0, lastRevisedDate: null },
        { id: "e5",  name: "Reserve Bank of India & Functions",              revisionCount: 0, lastRevisedDate: null },
        { id: "e6",  name: "Public Revenue – Tax & Non-Tax",                 revisionCount: 0, lastRevisedDate: null },
        { id: "e7",  name: "Public Expenditure, Budget & Fiscal Policy",     revisionCount: 0, lastRevisedDate: null },
        { id: "e8",  name: "Consumer Protection & Rights",                   revisionCount: 0, lastRevisedDate: null },
        { id: "e9",  name: "Current Affairs (Economics)",                     revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "const", name: "Indian Constitution", maxMarks: 5,
      questionRange: { start: 21, end: 25 },
      topics: [
        { id: "c1",  name: "Constituent Assembly & Preamble",                revisionCount: 0, lastRevisedDate: null },
        { id: "c2",  name: "Fundamental Rights",                             revisionCount: 0, lastRevisedDate: null },
        { id: "c3",  name: "Directive Principles of State Policy (DPSP)",    revisionCount: 0, lastRevisedDate: null },
        { id: "c4",  name: "Fundamental Duties & Citizenship",               revisionCount: 0, lastRevisedDate: null },
        { id: "c5",  name: "Constitutional Amendments",                      revisionCount: 0, lastRevisedDate: null },
        { id: "c6",  name: "Panchayati Raj",                                 revisionCount: 0, lastRevisedDate: null },
        { id: "c7",  name: "Constitutional Institutions & Functions",        revisionCount: 0, lastRevisedDate: null },
        { id: "c8",  name: "Emergency Provisions",                           revisionCount: 0, lastRevisedDate: null },
        { id: "c9",  name: "Union List, State List & Concurrent List",       revisionCount: 0, lastRevisedDate: null },
        { id: "c10", name: "Current Affairs (Constitution)",                  revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "civ", name: "Civics", maxMarks: 5,
      questionRange: { start: 26, end: 30 },
      topics: [
        { id: "cv1", name: "Public Administration & Bureaucracy",            revisionCount: 0, lastRevisedDate: null },
        { id: "cv2", name: "Indian Civil Service & State Civil Service",     revisionCount: 0, lastRevisedDate: null },
        { id: "cv3", name: "E-Governance & RTI",                             revisionCount: 0, lastRevisedDate: null },
        { id: "cv4", name: "Lokpal, Lokayuktha & Human Rights",              revisionCount: 0, lastRevisedDate: null },
        { id: "cv5", name: "Elections & Political Parties",                  revisionCount: 0, lastRevisedDate: null },
        { id: "cv6", name: "Consumer Protection & Labour Laws",              revisionCount: 0, lastRevisedDate: null },
        { id: "cv7", name: "Land Reforms & Social Welfare",                  revisionCount: 0, lastRevisedDate: null },
        { id: "cv8", name: "Current Affairs (Civics)",                        revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "arts", name: "Arts, Literature, Culture & Sports", maxMarks: 10,
      questionRange: { start: 31, end: 40 },
      topics: [
        { id: "a1",  name: "Kerala Visual & Performing Arts",                revisionCount: 0, lastRevisedDate: null },
        { id: "a2",  name: "Kerala Arts – Famous Institutions & Places",     revisionCount: 0, lastRevisedDate: null },
        { id: "a3",  name: "Sports – Kerala & Indian Personalities",         revisionCount: 0, lastRevisedDate: null },
        { id: "a4",  name: "Sports – Major Awards & Trophies",               revisionCount: 0, lastRevisedDate: null },
        { id: "a5",  name: "Sports – Olympic Games",                         revisionCount: 0, lastRevisedDate: null },
        { id: "a6",  name: "Sports – Asian, Commonwealth & SAF Games",       revisionCount: 0, lastRevisedDate: null },
        { id: "a7",  name: "Sports – National Games & Terminology",          revisionCount: 0, lastRevisedDate: null },
        { id: "a8",  name: "Malayalam Literature – Movements & First Works", revisionCount: 0, lastRevisedDate: null },
        { id: "a9",  name: "Malayalam Literature – Authors & Awards",        revisionCount: 0, lastRevisedDate: null },
        { id: "a10", name: "Malayalam Cinema – History & Awards",            revisionCount: 0, lastRevisedDate: null },
        { id: "a11", name: "Kerala Festivals & Cultural Centres",            revisionCount: 0, lastRevisedDate: null },
        { id: "a12", name: "Indian Arts & National Culture",                 revisionCount: 0, lastRevisedDate: null },
        { id: "a13", name: "Current Affairs (Arts/Sports/Literature)",        revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "comp", name: "Basics of Computer", maxMarks: 5,
      questionRange: { start: 41, end: 45 },
      topics: [
        { id: "it1", name: "Hardware – Input, Output & Memory Devices",      revisionCount: 0, lastRevisedDate: null },
        { id: "it2", name: "Software – OS, System & Application Software",   revisionCount: 0, lastRevisedDate: null },
        { id: "it3", name: "Networks – LAN, WAN, MAN & Devices",             revisionCount: 0, lastRevisedDate: null },
        { id: "it4", name: "Internet – WWW, Email, Social Media & HTML",     revisionCount: 0, lastRevisedDate: null },
        { id: "it5", name: "Cyber Crimes & IT Act 2000",                     revisionCount: 0, lastRevisedDate: null },
        { id: "it6", name: "Current Affairs (Computer)",                      revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "sci", name: "Science & Technology", maxMarks: 5,
      questionRange: { start: 46, end: 50 },
      topics: [
        { id: "s1",  name: "Basics of Science & National Policy",            revisionCount: 0, lastRevisedDate: null },
        { id: "s2",  name: "Human Body, Public Health & Nutrition",          revisionCount: 0, lastRevisedDate: null },
        { id: "s3",  name: "Indian Scientists & S&T Institutions",           revisionCount: 0, lastRevisedDate: null },
        { id: "s4",  name: "Space Programme – ISRO & Satellites",            revisionCount: 0, lastRevisedDate: null },
        { id: "s5",  name: "Defence – DRDO",                                 revisionCount: 0, lastRevisedDate: null },
        { id: "s6",  name: "Energy – Renewable & Nuclear Policy",            revisionCount: 0, lastRevisedDate: null },
        { id: "s7",  name: "Environment – Laws, Biodiversity & Climate",     revisionCount: 0, lastRevisedDate: null },
        { id: "s8",  name: "Biotechnology, Green Tech & Nanotechnology",     revisionCount: 0, lastRevisedDate: null },
        { id: "s9",  name: "Current Affairs (Science & Technology)",          revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "arith", name: "Simple Arithmetic", maxMarks: 10,
      questionRange: { start: 51, end: 60 },
      topics: [
        { id: "m1",  name: "Numbers & Basic Operations",                     revisionCount: 0, lastRevisedDate: null },
        { id: "m2",  name: "Fractions, Decimals & Percentage",               revisionCount: 0, lastRevisedDate: null },
        { id: "m3",  name: "Profit, Loss & Ratio",                           revisionCount: 0, lastRevisedDate: null },
        { id: "m4",  name: "Simple & Compound Interest",                     revisionCount: 0, lastRevisedDate: null },
        { id: "m5",  name: "Time, Distance & Work",                          revisionCount: 0, lastRevisedDate: null },
        { id: "m6",  name: "Average",                                        revisionCount: 0, lastRevisedDate: null },
        { id: "m7",  name: "Laws of Exponents",                              revisionCount: 0, lastRevisedDate: null },
        { id: "m8",  name: "Mensuration (Perimeter, Area, Volume)",          revisionCount: 0, lastRevisedDate: null },
        { id: "m9",  name: "Progressions (AP & GP)",                         revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "mental", name: "Mental Ability & Reasoning", maxMarks: 10,
      questionRange: { start: 61, end: 70 },
      topics: [
        { id: "r1",  name: "Number & Letter Series",                         revisionCount: 0, lastRevisedDate: null },
        { id: "r2",  name: "Analogy (Word, Alphabet, Number)",               revisionCount: 0, lastRevisedDate: null },
        { id: "r3",  name: "Odd Man Out",                                    revisionCount: 0, lastRevisedDate: null },
        { id: "r4",  name: "Coding and Decoding",                            revisionCount: 0, lastRevisedDate: null },
        { id: "r5",  name: "Blood Relations & Family Tree",                  revisionCount: 0, lastRevisedDate: null },
        { id: "r6",  name: "Direction & Distance",                           revisionCount: 0, lastRevisedDate: null },
        { id: "r7",  name: "Clock – Time, Angles & Reflection",              revisionCount: 0, lastRevisedDate: null },
        { id: "r8",  name: "Calendar & Date Problems",                       revisionCount: 0, lastRevisedDate: null },
        { id: "r9",  name: "Venn Diagram & Set Theory",                      revisionCount: 0, lastRevisedDate: null },
        { id: "r10", name: "Mathematical Signs & Custom Operators",          revisionCount: 0, lastRevisedDate: null },
        { id: "r11", name: "Clerical Ability",                               revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "gram", name: "English Grammar", maxMarks: 10,
      questionRange: { start: 71, end: 80 },
      topics: [
        { id: "en1", name: "Tenses",                                         revisionCount: 0, lastRevisedDate: null },
        { id: "en2", name: "Active & Passive Voice",                         revisionCount: 0, lastRevisedDate: null },
        { id: "en3", name: "Direct & Indirect Speech",                       revisionCount: 0, lastRevisedDate: null },
        { id: "en4", name: "Subject-Verb Agreement",                         revisionCount: 0, lastRevisedDate: null },
        { id: "en5", name: "Articles & Prepositions",                        revisionCount: 0, lastRevisedDate: null },
        { id: "en6", name: "Conditionals",                                   revisionCount: 0, lastRevisedDate: null },
        { id: "en7", name: "Non-Finite Verbs (Gerund & Infinitive)",         revisionCount: 0, lastRevisedDate: null },
        { id: "en8", name: "Question Tags",                                  revisionCount: 0, lastRevisedDate: null },
        { id: "en9", name: "Error Identification & Correction",              revisionCount: 0, lastRevisedDate: null },
        { id: "en10",name: "Degrees of Comparison & Correlatives",           revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "vocab", name: "Vocabulary", maxMarks: 10,
      questionRange: { start: 81, end: 90 },
      topics: [
        { id: "v1",  name: "Synonyms & Antonyms",                            revisionCount: 0, lastRevisedDate: null },
        { id: "v2",  name: "Phrasal Verbs",                                  revisionCount: 0, lastRevisedDate: null },
        { id: "v3",  name: "Foreign Words & Phrases",                        revisionCount: 0, lastRevisedDate: null },
        { id: "v4",  name: "One Word Substitutes",                           revisionCount: 0, lastRevisedDate: null },
        { id: "v5",  name: "Spelling Test",                                  revisionCount: 0, lastRevisedDate: null },
        { id: "v6",  name: "Idioms & Their Meanings",                        revisionCount: 0, lastRevisedDate: null },
        { id: "v7",  name: "Words Often Confused & Collocations",            revisionCount: 0, lastRevisedDate: null },
        { id: "v8",  name: "Abbreviations & Word Formation",                 revisionCount: 0, lastRevisedDate: null },
      ],
    },
    {
      id: "mal", name: "Malayalam", maxMarks: 10,
      questionRange: { start: 91, end: 100 },
      topics: [
        { id: "ml1", name: "പദശുദ്ധി (Word Purity / Correct Word)",          revisionCount: 0, lastRevisedDate: null },
        { id: "ml2", name: "വാക്യശുദ്ധി (Correct Sentence)",                 revisionCount: 0, lastRevisedDate: null },
        { id: "ml3", name: "പരിഭാഷ (Translation)",                           revisionCount: 0, lastRevisedDate: null },
        { id: "ml4", name: "ഒറ്റപ്പദം (One Word Substitution)",               revisionCount: 0, lastRevisedDate: null },
        { id: "ml5", name: "പര്യായം / വിപരീതം (Synonyms & Antonyms)",        revisionCount: 0, lastRevisedDate: null },
        { id: "ml6", name: "ശൈലികൾ / പഴഞ്ചൊൽ (Idioms & Proverbs)",           revisionCount: 0, lastRevisedDate: null },
        { id: "ml7", name: "ചേർത്തെഴുതൽ / സന്ധി (Sandhi & Joining)",         revisionCount: 0, lastRevisedDate: null },
        { id: "ml8", name: "ലിംഗം / വചനം (Gender & Number)",                 revisionCount: 0, lastRevisedDate: null },
        { id: "ml9", name: "പിരിച്ചെഴുതൽ (Word Splitting)",                  revisionCount: 0, lastRevisedDate: null },
        { id: "ml10",name: "ഘടക പദം (Component Word / Phrase Joining)",      revisionCount: 0, lastRevisedDate: null },
      ],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Horizontal progress bar.
 * Colour is auto-determined from percentage (green/yellow/orange/red).
 */
export function Bar({ value, max, height = 6 }) {
  const p   = clamp(pct(value, max), 0, 100);
  const col = scoreColor(p);
  return (
    <div style={{ background: T.border, borderRadius: 99, height, overflow: "hidden" }}>
      <div style={{
        width: `${p}%`, height: "100%", background: col,
        borderRadius: 99, transition: "width 0.5s ease",
      }} />
    </div>
  );
}

/**
 * Small colour pill badge.
 * @param {string} label - text to display
 * @param {string} color - hex colour (uses 22% opacity background)
 */
export function Badge({ label, color = T.accent }) {
  return (
    <span style={{
      background: color + "22", color,
      fontSize: 10, padding: "2px 8px",
      borderRadius: 99, fontWeight: 600,
      letterSpacing: "0.04em", whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

/**
 * Labelled number input with optional small width.
 */
export function NumInput({ value, onChange, min = 0, max, label, small, disabled }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <span style={{ fontSize: 10, color: T.text3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {label}
        </span>
      )}
      <input
        type="number" min={min} max={max}
        value={value} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        style={{
          ...inputStyle,
          width: small ? 68 : "100%",
          textAlign: "center",
          fontFamily: "monospace",
          fontSize: 14,
        }}
      />
    </label>
  );
}

/**
 * Inline field error message.
 */
export function FieldError({ msg }) {
  if (!msg) return null;
  return (
    <span style={{ fontSize: 11, color: T.red, display: "block", marginTop: 3 }}>
      ⚠ {msg}
    </span>
  );
}

/**
 * Labelled card section with optional accent bar and action slot.
 */
export function Section({ title, children, accent = T.accent, action, style: extraStyle }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 16, ...extraStyle }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 14, borderBottom: `1px solid ${T.border}`, paddingBottom: 10,
      }}>
        <span style={{
          fontSize: 13, fontWeight: 700, color: T.text,
          letterSpacing: "0.03em",
          borderLeft: `3px solid ${accent}`, paddingLeft: 8,
        }}>
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * Full-screen modal overlay.
 * Clicking the backdrop calls onClose.
 * @param {boolean} wide - if true, max-width is 900px instead of 560px
 */
export function Modal({ title, onClose, children, wide, extraWide }) {
  const maxW = extraWide ? 1100 : wide ? 900 : 560;
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "#000b",
        zIndex: 1000, display: "flex", alignItems: "center",
        justifyContent: "center", padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: T.card, border: `1px solid ${T.border2}`,
        borderRadius: 12, padding: 24,
        width: "100%", maxWidth: maxW,
        maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 24px 64px #000a",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: 20,
        }}>
          <span style={{ fontWeight: 700, color: T.text, fontSize: 16 }}>{title}</span>
          <button onClick={onClose} style={{ ...btnGhost, padding: "4px 10px" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Toast notification (success / error / warning).
 * Shown at the bottom of the screen, auto-dismisses after 3s.
 * Use the useToast() hook to trigger it.
 */
export function ToastContainer({ toasts }) {
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%",
      transform: "translateX(-50%)",
      display: "flex", flexDirection: "column", gap: 8,
      zIndex: 2000, pointerEvents: "none",
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "error" ? T.red : t.type === "warn" ? T.yellow : T.green,
          color: "#000", borderRadius: 8, padding: "10px 18px",
          fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px #0008",
          animation: "fadeInUp 0.2s ease",
          whiteSpace: "nowrap",
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

/**
 * useToast hook — returns { toasts, showToast }
 * showToast(msg, type) where type = "success"|"error"|"warn"
 */
export function useToast() {
  const [toasts, setToasts] = useState([]);
  const showToast = useCallback((msg, type = "success") => {
    const id = uid();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
  }, []);
  return { toasts, showToast };
}

/**
 * Searchable select dropdown (used for topic picker in OMR, filters etc.)
 * On mobile, opens as a full-screen overlay for easy tapping.
 * @param {Array<{id,label,group}>} options
 * @param {string|null} value - selected id
 * @param {function} onChange
 * @param {string} placeholder
 */
export function SearchSelect({ options, value, onChange, placeholder = "Tag topic…" }) {
  const [query, setQuery] = useState("");
  const [open,  setOpen]  = useState(false);
  const ref               = useRef();

  const selected = options.find(o => o.id === value);

  const filtered = query
    ? options.filter(o =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        (o.group || "").toLowerCase().includes(query.toLowerCase()))
    : options;

  // Close on outside click (desktop only — mobile uses overlay)
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (id) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", background: T.surface,
          border: `1px solid ${value ? T.accent + "66" : T.border}`,
          borderRadius: 6, padding: "6px 10px",
          color: selected ? T.accent2 : T.text3,
          fontSize: 11, cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontFamily: "inherit", textAlign: "left",
          transition: "border-color 0.15s",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ color: T.text3, marginLeft: 4, flexShrink: 0 }}>{open ? "▴" : "▾"}</span>
      </button>

      {/* Full-screen overlay dropdown (mobile-friendly) */}
      {open && (
        <div style={{
          position: "fixed", inset: 0,
          background: "#000c", zIndex: 800,
          display: "flex", alignItems: "flex-end",
        }}
          onClick={e => { if (e.target === e.currentTarget) { setOpen(false); setQuery(""); } }}
        >
          <div style={{
            width: "100%", maxWidth: 600, margin: "0 auto",
            background: T.card, borderRadius: "16px 16px 0 0",
            border: `1px solid ${T.border2}`,
            maxHeight: "70vh", display: "flex", flexDirection: "column",
            boxShadow: "0 -8px 32px #000a",
          }}>
            {/* Header */}
            <div style={{
              padding: "14px 16px 10px",
              borderBottom: `1px solid ${T.border}`,
              display: "flex", gap: 10, alignItems: "center",
            }}>
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search topics..."
                style={{ ...inputStyle, flex: 1, fontSize: 14, padding: "9px 12px" }}
                onClick={e => e.stopPropagation()}
              />
              <button
                onClick={() => { setOpen(false); setQuery(""); }}
                style={{ ...inputStyle, width: "auto", padding: "9px 14px", cursor: "pointer", color: T.text2, fontSize: 13 }}
              >✕</button>
            </div>

            {/* Clear selection */}
            {value && (
              <div
                onClick={() => { onChange(null); setOpen(false); setQuery(""); }}
                style={{
                  padding: "12px 16px", fontSize: 13, color: T.red,
                  cursor: "pointer", borderBottom: `1px solid ${T.border}`,
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                <span>✕</span> Clear selection
              </div>
            )}

            {/* Options list — grouped */}
            <div style={{ overflowY: "auto", flex: 1 }}>
              {filtered.length === 0 && (
                <div style={{ padding: "20px 16px", fontSize: 13, color: T.text3, textAlign: "center" }}>
                  No topics match "{query}"
                </div>
              )}
              {/* Group by subject */}
              {(() => {
                const groups = {};
                filtered.forEach(o => {
                  const g = o.group || "Other";
                  if (!groups[g]) groups[g] = [];
                  groups[g].push(o);
                });
                return Object.entries(groups).map(([group, items]) => (
                  <div key={group}>
                    <div style={{
                      padding: "8px 16px 4px",
                      fontSize: 10, fontWeight: 700, color: T.accent2,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      background: T.surface,
                      borderBottom: `1px solid ${T.border}`,
                    }}>
                      {group}
                    </div>
                    {items.map(o => (
                      <div
                        key={o.id}
                        onClick={() => handleSelect(o.id)}
                        style={{
                          padding: "13px 16px",
                          fontSize: 13,
                          cursor: "pointer",
                          background: o.id === value ? T.accent + "22" : "transparent",
                          color: o.id === value ? T.accent2 : T.text,
                          borderBottom: `1px solid ${T.border}`,
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          minHeight: 48,
                        }}
                      >
                        <span>{o.label}</span>
                        {o.id === value && <span style={{ color: T.accent, fontSize: 16 }}>✓</span>}
                      </div>
                    ))}
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Confirmation dialog modal.
 * Used before destructive actions (delete, import overwrite, etc.)
 */
export function ConfirmDialog({ message, detail, confirmLabel = "Confirm", danger, onConfirm, onCancel }) {
  return (
    <Modal title={danger ? "⚠ Confirm Action" : "Confirm"} onClose={onCancel}>
      <p style={{ color: T.text2, fontSize: 14, marginBottom: 8 }}>{message}</p>
      {detail && <p style={{ color: T.text3, fontSize: 12, marginBottom: 20 }}>{detail}</p>}
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={btnGhost}>Cancel</button>
        <button
          onClick={onConfirm}
          style={btnPrimary(danger ? T.red : T.accent)}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Unsaved-changes warning — shown when navigating away from a dirty form.
 */
export function useUnsavedWarning(isDirty) {
  useEffect(() => {
    const handler = e => {
      if (isDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}

/** Simple text search filter — returns true if haystack includes needle (case-insensitive) */
export const matchSearch = (haystack, needle) =>
  !needle || String(haystack).toLowerCase().includes(needle.toLowerCase());
