/**
 * AppSync.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Data sync and backup module for PSC Tracker.
 * Contains:
 *   - GoogleSync    — optional Google Drive sync via OAuth 2.0
 *   - ExportImport  — local JSON export/import backup
 *   - shareOnWhatsApp — generate and open WhatsApp share for a paper
 *   - SyncPanel     — combined UI for all sync options
 *
 * SETUP NOTE (one-time):
 *   Replace GOOGLE_CLIENT_ID below with your OAuth 2.0 client ID from
 *   https://console.cloud.google.com → APIs → Credentials → Web application.
 *   Enable the "Google Drive API" and add your GitHub Pages URL as an
 *   authorised JavaScript origin.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from "react";
import {
  T, btnPrimary, btnGhost, cardStyle,
  fmtDate, pct, scoreColor,
  DB, KEYS,
  Section, Modal, Badge, ConfirmDialog,
} from "./AppCore";

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE DRIVE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Replace this with your Google OAuth 2.0 Client ID.
 * Instructions in README.md under "Google Drive Sync Setup".
 * Leave as empty string to hide the Google Sign-in option.
 */
const GOOGLE_CLIENT_ID = "";

/** Google Drive AppData folder — only this app can read/write it */
const DRIVE_FILE_NAME  = "psc-tracker-backup.json";
const DRIVE_SCOPE      = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FOLDER     = "appDataFolder";

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE DRIVE SYNC HOOK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * useGoogleSync — manages Google OAuth token and Drive read/write.
 * Returns { isSignedIn, user, signIn, signOut, syncNow, lastSynced, syncing, error }
 */
export function useGoogleSync(getAllData, restoreAllData) {
  const [token,      setToken]      = useState(null);
  const [user,       setUser]       = useState(null);
  const [syncing,    setSyncing]    = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [error,      setError]      = useState("");
  const isSignedIn = !!token;

  // Restore token from storage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem("psc-google-token");
    const storedUser = sessionStorage.getItem("psc-google-user");
    if (stored) { setToken(stored); }
    if (storedUser) { try { setUser(JSON.parse(storedUser)); } catch { /* ignore */ } }

    const syncMeta = JSON.parse(localStorage.getItem("psc-sync-meta") || "{}");
    if (syncMeta.lastSynced) setLastSynced(syncMeta.lastSynced);
  }, []);

  /**
   * Initiate Google OAuth sign-in using the implicit flow (tokenmodel).
   * Opens a popup window. Token is stored in sessionStorage (expires with session).
   */
  const signIn = useCallback(() => {
    if (!GOOGLE_CLIENT_ID) {
      setError("Google Client ID not configured. See README.md for setup instructions.");
      return;
    }
    const params = new URLSearchParams({
      client_id:    GOOGLE_CLIENT_ID,
      redirect_uri: window.location.origin + window.location.pathname,
      response_type:"token",
      scope:        DRIVE_SCOPE + " https://www.googleapis.com/auth/userinfo.profile",
      include_granted_scopes: "true",
    });
    const popup = window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "google-auth", "width=480,height=560"
    );

    // Listen for the token in the redirect URL
    const interval = setInterval(() => {
      try {
        if (!popup || popup.closed) { clearInterval(interval); return; }
        const hash = popup.location.hash;
        if (hash) {
          const params = new URLSearchParams(hash.slice(1));
          const access_token = params.get("access_token");
          if (access_token) {
            clearInterval(interval);
            popup.close();
            sessionStorage.setItem("psc-google-token", access_token);
            setToken(access_token);
            fetchUserInfo(access_token);
          }
        }
      } catch { /* cross-origin, keep polling */ }
    }, 500);
  }, []);

  const fetchUserInfo = async (accessToken) => {
    try {
      const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const info = await res.json();
      sessionStorage.setItem("psc-google-user", JSON.stringify(info));
      setUser(info);
    } catch { /* non-critical */ }
  };

  const signOut = useCallback(() => {
    sessionStorage.removeItem("psc-google-token");
    sessionStorage.removeItem("psc-google-user");
    setToken(null);
    setUser(null);
  }, []);

  /**
   * Sync all local data to Drive and download latest from Drive.
   * Conflict resolution: keep whichever version has the later timestamp.
   */
  const syncNow = useCallback(async () => {
    if (!token) return;
    setSyncing(true);
    setError("");
    try {
      // Get current local data
      const localData = await getAllData();
      localData._syncTimestamp = Date.now();

      // Find existing file in Drive AppData
      const listRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${DRIVE_FILE_NAME}'`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const listJson = await listRes.json();

      if (listJson.error?.code === 401) {
        // Token expired
        signOut();
        setError("Session expired. Please sign in again.");
        setSyncing(false);
        return;
      }

      const existingFile = listJson.files?.[0];
      let driveData = null;

      if (existingFile) {
        // Download existing Drive data
        const dlRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${existingFile.id}?alt=media`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        driveData = await dlRes.json();
      }

      // Conflict resolution: use whichever is newer
      let toUpload = localData;
      if (driveData && (driveData._syncTimestamp || 0) > (localData._syncTimestamp || 0)) {
        // Drive is newer — restore it locally
        await restoreAllData(driveData);
        toUpload = driveData;
      }

      // Upload to Drive (create or update)
      const blob    = new Blob([JSON.stringify(toUpload)], { type: "application/json" });
      const metadata = { name: DRIVE_FILE_NAME, parents: [DRIVE_FOLDER] };
      const form    = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("file", blob);

      const method = existingFile ? "PATCH" : "POST";
      const url    = existingFile
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`
        : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";

      await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, body: form });

      const now = Date.now();
      localStorage.setItem("psc-sync-meta", JSON.stringify({ lastSynced: now }));
      setLastSynced(now);
    } catch (e) {
      setError("Sync failed. Check your internet connection and try again.");
      console.error("[Sync]", e);
    }
    setSyncing(false);
  }, [token, getAllData, restoreAllData, signOut]);

  return { isSignedIn, user, signIn, signOut, syncNow, lastSynced, syncing, error };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT / IMPORT JSON BACKUP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Export all app data as a downloadable JSON file.
 * @param {object} data - { syllabi, papers, studyLogs, streaks }
 */
export function exportData(data) {
  const payload = { ...data, _exportedAt: new Date().toISOString(), _version: 1 };
  const blob    = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  a.href        = url;
  a.download    = `psc-tracker-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Read and validate an imported JSON backup file.
 * Returns { ok, data, error }.
 */
export async function readImportFile(file) {
  if (!file || !file.name.endsWith(".json")) {
    return { ok: false, error: "Only .json backup files are accepted." };
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.syllabi || !Array.isArray(data.syllabi)) {
      return { ok: false, error: "Invalid backup file. Expected a PSC Tracker backup JSON." };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "File could not be read. It may be corrupted." };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WHATSAPP SHARE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate a formatted WhatsApp-ready text summary for a paper.
 * Opens the wa.me link directly.
 *
 * @param {object} paper
 * @param {object} syllabus
 * @param {number} streak - current streak count
 */
export function shareOnWhatsApp(paper, syllabus, streak) {
  const c    = paper.computed;
  const neg  = syllabus.negMark || 1/3;

  let lines = [];
  lines.push(`📋 *${paper.name || "PSC Paper"}*`);
  if (paper.code) lines.push(`Code: ${paper.code}`);
  if (paper.date) lines.push(`Date: ${fmtDate(paper.date)}`);
  if (paper.bookletCode) lines.push(`Booklet: ${paper.bookletCode}`);
  lines.push("");

  if (c) {
    lines.push(`🎯 *Score: ${c.totalMarks.toFixed(2)}/100*`);
    lines.push(`✓ ${c.totalCorrect} correct  ✗ ${c.totalWrong} wrong  ⊘ ${c.totalDeleted} deleted`);
    lines.push(`Penalty: -${c.totalPenalty.toFixed(2)}`);
    lines.push("");
    lines.push("📊 *Subject Breakdown:*");
    for (const s of syllabus.subjects) {
      const sc = c.bySubject[s.id] || {};
      const p  = pct(sc.marks || 0, s.maxMarks);
      const bar = p >= 70 ? "🟢" : p >= 50 ? "🟡" : "🔴";
      lines.push(`${bar} ${s.name.padEnd(20)} ${(sc.marks||0).toFixed(1)}/${s.maxMarks} (${p}%)`);
    }
  }

  // Guess summary
  const g = paper.guesses || {};
  const ffC = parseInt(g.ff_correct) || 0;
  const ffW = parseInt(g.ff_wrong)   || 0;
  const wgC = parseInt(g.wg_correct) || 0;
  const wgW = parseInt(g.wg_wrong)   || 0;
  if (ffC + ffW + wgC + wgW > 0) {
    lines.push("");
    lines.push("🎲 *Guesswork:*");
    if (ffC + ffW > 0) {
      const acc = Math.round(ffC / (ffC + ffW) * 100);
      lines.push(`🎯 50:50 — ${ffC} right, ${ffW} wrong (${acc}% acc)`);
    }
    if (wgC + wgW > 0) {
      const acc = Math.round(wgC / (wgC + wgW) * 100);
      lines.push(`🎲 Wild — ${wgC} right, ${wgW} wrong (${acc}% acc)`);
    }
  }

  if (streak) lines.push(`\n🔥 Study streak: ${streak} days`);
  lines.push("\n_via PSC Tracker_");

  const text = lines.join("\n");
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC PANEL — combined UI
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SyncPanel — shows Google Drive sync status, export/import controls.
 * Embedded in the main app Settings or a dedicated Sync tab.
 */
export function SyncPanel({ getAllData, restoreAllData, onRestored }) {
  const { isSignedIn, user, signIn, signOut, syncNow, lastSynced, syncing, error: syncError }
    = useGoogleSync(getAllData, restoreAllData);

  const [importError,  setImportError]  = useState("");
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [pendingImport,setPendingImport] = useState(null);
  const [exportCount,  setExportCount]  = useState(null);

  const handleExport = async () => {
    const data = await getAllData();
    const totalPapers = data.papers?.length || 0;
    if (totalPapers === 0 && (!data.syllabi || data.syllabi.length === 0)) {
      alert("Nothing to export yet.");
      return;
    }
    exportData(data);
    setExportCount(totalPapers);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await readImportFile(file);
    if (!result.ok) { setImportError(result.error); return; }
    setImportError("");
    setPendingImport(result.data);
    setShowConfirm(true);
    e.target.value = ""; // reset file input
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    await restoreAllData(pendingImport);
    onRestored?.();
    setShowConfirm(false);
    setPendingImport(null);
  };

  // Base URL for template files served from GitHub Pages
  const TEMPLATES_BASE = "./templates/";
  const TEMPLATES = [
    { name: "Numbered Syllabus",       file: "sample-numbered-syllabus.docx",  desc: "Format for importing syllabus with topic numbers" },
    { name: "Answer Key (Multi)",       file: "sample-answer-key-multi.docx",   desc: "Multi-booklet A/B/C/D answer key format" },
    { name: "Answer Key (Single)",      file: "sample-answer-key-single.docx",  desc: "Single-booklet answer key format" },
    { name: "Topic Map / Frequency",    file: "sample-topic-map.docx",          desc: "Syllabus frequency table with topic numbers" },
    { name: "Data Backup (JSON)",       file: "sample-backup.json",             desc: "Example of the exported backup file format" },
  ];

  return (
    <div>
      {/* Reference Documents */}
      <Section title="📁 Reference Documents" accent={T.purple} style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: T.text2, marginBottom: 14, lineHeight: 1.7 }}>
          Download these template files to understand the correct format for each upload type.
          These are sample/reference files — replace the content with your actual data.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {TEMPLATES.map(t => (
            <div key={t.file} style={{ display: "flex", alignItems: "center", gap: 12,
              padding: "10px 14px", background: T.surface, borderRadius: 8,
              border: "1px solid " + T.border }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{t.name}</div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{t.desc}</div>
              </div>
              <a href={TEMPLATES_BASE + t.file} download={t.file}
                style={{ ...btnPrimary(T.purple), textDecoration: "none",
                  fontSize: 12, padding: "6px 14px" }}>
                ⬇ Download
              </a>
            </div>
          ))}
        </div>
      </Section>

      {/* Google Drive */}
      {GOOGLE_CLIENT_ID ? (
        <Section title="☁ Google Drive Sync" accent={T.cyan} style={{ marginBottom: 16 }}>
          {isSignedIn ? (
            <div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                {user?.picture && <img src={user.picture} alt="" style={{ width: 36, height: 36, borderRadius: "50%" }} />}
                <div>
                  <div style={{ fontSize: 13, color: T.text }}>{user?.name || "Signed in"}</div>
                  <div style={{ fontSize: 11, color: T.text3 }}>{user?.email || ""}</div>
                </div>
                <button onClick={signOut} style={{ ...btnGhost, marginLeft: "auto", color: T.red, borderColor: T.red + "44" }}>Sign Out</button>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button onClick={syncNow} disabled={syncing} style={btnPrimary(T.cyan, "#000")}>
                  {syncing ? "Syncing…" : "⟳ Sync Now"}
                </button>
                {lastSynced && (
                  <span style={{ fontSize: 11, color: T.text3 }}>
                    Last synced: {new Date(lastSynced).toLocaleTimeString("en-IN")}
                  </span>
                )}
              </div>
              {syncError && <div style={{ color: T.red, fontSize: 12, marginTop: 8 }}>⚠ {syncError}</div>}
              <div style={{ fontSize: 11, color: T.text3, marginTop: 10, lineHeight: 1.7 }}>
                Data is stored in your Google Drive's private AppData folder —
                not visible in Drive browser. Sync works offline-first:
                changes save locally and sync when internet is available.
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 12, color: T.text2, marginBottom: 14, lineHeight: 1.7 }}>
                Sign in with Google to back up your data to Drive and access it on any device.
                Your data is stored in a private app folder — not visible in your Drive browser.
              </p>
              <button onClick={signIn} style={btnPrimary(T.cyan, "#000")}>
                Sign in with Google
              </button>
              {syncError && <div style={{ color: T.red, fontSize: 12, marginTop: 8 }}>⚠ {syncError}</div>}
            </div>
          )}
        </Section>
      ) : (
        <Section title="☁ Google Drive Sync" accent={T.text3}>
          <p style={{ fontSize: 12, color: T.text3, lineHeight: 1.7 }}>
            Google Drive sync is not configured. To enable it, add your OAuth Client ID
            to <code style={{ color: T.accent2 }}>src/AppSync.jsx</code> and redeploy.
            See README.md for setup instructions.
          </p>
        </Section>
      )}

      {/* Export / Import */}
      <Section title="💾 Local Backup (Export / Import)" accent={T.yellow}>
        <p style={{ fontSize: 12, color: T.text2, marginBottom: 16, lineHeight: 1.7 }}>
          Export all your data as a JSON file to your Downloads folder.
          Import it on any device to restore everything.
          <strong style={{ color: T.yellow }}> Always export before importing</strong> — importing replaces all current data.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button onClick={handleExport} style={btnPrimary(T.yellow, "#000")}>
            ⬇ Export Backup
          </button>
          <label style={{ cursor: "pointer" }}>
            <span style={{ ...btnGhost, display: "inline-block" }}>⬆ Import Backup</span>
            <input type="file" accept=".json" style={{ display: "none" }} onChange={handleImportFile} />
          </label>
        </div>
        {exportCount !== null && (
          <div style={{ fontSize: 12, color: T.green, marginTop: 8 }}>
            ✓ Exported {exportCount} paper{exportCount !== 1 ? "s" : ""}
          </div>
        )}
        {importError && <div style={{ color: T.red, fontSize: 12, marginTop: 8 }}>⚠ {importError}</div>}
      </Section>

      {/* Confirm import overwrite */}
      {showConfirm && pendingImport && (
        <ConfirmDialog
          message="This will replace ALL current data with the imported backup."
          detail={`Backup contains: ${pendingImport.syllabi?.length || 0} syllab${(pendingImport.syllabi?.length || 0) === 1 ? "us" : "i"}, ${pendingImport.papers?.length || 0} papers. Export your current data first if you need it.`}
          confirmLabel="Import & Replace"
          danger
          onConfirm={confirmImport}
          onCancel={() => { setShowConfirm(false); setPendingImport(null); }}
        />
      )}
    </div>
  );
}
