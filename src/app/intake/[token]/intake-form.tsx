"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { savePublicIntakeField, submitPublicIntake, createIntakeFileUploadUrl, finalizeIntakeFile, removeIntakeFile, type PublicIntakeData, type IntakeField, type IntakeFileRef } from "./actions";
import { createClient } from "@/lib/supabase/client";

interface Props { token: string; data: PublicIntakeData }

type SaveState = "idle" | "saving" | "saved" | "error";

export function PublicIntakeForm({ token, data }: Props) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(data.answers);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [submitted, setSubmitted] = useState<string | null>(data.submittedAt);
  const [submitting, startSubmit] = useTransition();

  const setField = (key: string, value: unknown) => {
    setAnswers((a) => ({ ...a, [key]: value }));
  };

  const filled = data.fields.filter((f) => {
    const v = answers[f.key];
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && String(v).trim() !== "";
  }).length;
  const total = data.fields.length;
  const pct = total ? Math.round((filled / total) * 100) : 0;

  const handleSubmit = () => {
    startSubmit(async () => {
      const res = await submitPublicIntake(token);
      if (!res.error) setSubmitted(new Date().toISOString());
    });
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f6f9", padding: "32px 18px 64px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <header style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: "#f97316", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Finanshels onboarding</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "#0f172a", margin: "6px 0 4px" }}>Welcome, {data.clientName}</h1>
          <div style={{ color: "#475569", fontSize: 14.5, lineHeight: 1.6 }}>
            Please fill in a few details so we can prepare your accounting setup. <strong>You don&apos;t need to log in — your answers save automatically as you go.</strong>
          </div>
        </header>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div style={{ flex: 1, height: 8, background: "#e3e6ec", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "#f97316", transition: "width 240ms" }} />
          </div>
          <div style={{ fontSize: 12.5, color: "#475569", fontWeight: 600, whiteSpace: "nowrap" }}>{filled}/{total} filled</div>
        </div>

        {submitted && (
          <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", color: "#065f46", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13.5 }}>
            Thank you — your form was submitted. You can still update any answer below; we&apos;ll pick up the changes.
          </div>
        )}

        <div style={{ background: "#fff", border: "1px solid #e3e6ec", borderRadius: 14, padding: "8px 6px" }}>
          {data.fields.map((field) => (
            <FieldRow
              key={field.key}
              token={token}
              field={field}
              value={answers[field.key]}
              saveState={saveState[field.key] ?? "idle"}
              onChange={(v) => setField(field.key, v)}
              onCommit={async (v) => {
                setSaveState((s) => ({ ...s, [field.key]: "saving" }));
                const res = await savePublicIntakeField(token, field.key, v);
                setSaveState((s) => ({ ...s, [field.key]: res.error ? "error" : "saved" }));
                setTimeout(() => setSaveState((s) => ({ ...s, [field.key]: "idle" })), 1800);
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              padding: "10px 20px",
              background: "#f97316",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Submitting…" : submitted ? "Re-submit" : "Submit"}
          </button>
        </div>

        <div style={{ marginTop: 24, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
          Powered by Finanshels · This page is private to you.
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  token,
  field,
  value,
  saveState,
  onChange,
  onCommit,
}: {
  token: string;
  field: IntakeField;
  value: unknown;
  saveState: SaveState;
  onChange: (v: unknown) => void;
  onCommit: (v: unknown) => void;
}) {
  // Debounced typing auto-save: 600ms after the last keystroke we commit.
  // onBlur still commits immediately so leaving the field never loses data.
  // Only debounces the text/longtext kinds — chips/select/file already commit
  // on every change.
  const typingKinds = field.kind === "text" || field.kind === "longtext";
  const initial = useRef(true);
  useEffect(() => {
    if (!typingKinds) return;
    if (initial.current) { initial.current = false; return; }
    const t = setTimeout(() => { onCommit(value); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div style={{ padding: "14px 14px", borderBottom: "1px solid #f0f2f6" }}>
      <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#0f172a", marginBottom: 6 }}>
        {field.label}
        <span style={{ float: "right", fontSize: 11, fontWeight: 500, color: saveState === "saved" ? "#10b981" : saveState === "error" ? "#ef4444" : "#94a3b8" }}>
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn't save — retry" : ""}
        </span>
      </label>
      {field.hint && <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>{field.hint}</div>}
      <FieldInput token={token} field={field} value={value} onChange={onChange} onCommit={onCommit} />
    </div>
  );
}

function FieldInput({ token, field, value, onChange, onCommit }: { token: string; field: IntakeField; value: unknown; onChange: (v: unknown) => void; onCommit: (v: unknown) => void }) {
  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid #d8dde6",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 14,
    background: "#fff",
    color: "#0f172a",
    fontFamily: "inherit",
  };
  if (field.kind === "longtext") {
    return (
      <textarea
        value={(value as string) ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        rows={3}
        style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
      />
    );
  }
  if (field.kind === "chips") {
    const arr = Array.isArray(value) ? (value as unknown[]).map((x) => String(x)) : [];
    return <ChipInput value={arr} options={field.options} onCommit={(v) => { onChange(v); onCommit(v); }} />;
  }
  if (field.kind === "select") {
    return (
      <select
        value={(value as string) ?? ""}
        onChange={(e) => { onChange(e.target.value); onCommit(e.target.value); }}
        style={inputStyle}
      >
        <option value="">— Choose —</option>
        {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.kind === "file") {
    return <FileUpload token={token} field={field} value={(value as IntakeFileRef[] | undefined) ?? []} onChange={(v) => { onChange(v); }} />;
  }
  return (
    <input
      type="text"
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      style={inputStyle}
    />
  );
}

function ChipInput({ value, options, onCommit }: { value: string[]; options?: string[]; onCommit: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const add = (s: string) => {
    const v = s.trim();
    if (!v) return;
    if (value.includes(v)) { setDraft(""); return; }
    const next = [...value, v];
    onCommit(next);
    setDraft("");
  };
  const remove = (s: string) => onCommit(value.filter((x) => x !== s));
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: value.length ? 6 : 0 }}>
        {value.map((v) => (
          <span key={v} style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", borderRadius: 999, padding: "3px 9px", fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
            {v}
            <button onClick={() => remove(v)} style={{ background: "transparent", border: "none", color: "#9a3412", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        ))}
      </div>
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(draft); } }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder="Type and press Enter…"
        style={{ width: "100%", border: "1px solid #d8dde6", borderRadius: 8, padding: "8px 10px", fontSize: 14, fontFamily: "inherit" }}
      />
      {options?.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {options.filter((o) => !value.includes(o)).map((o) => (
            <button key={o} onClick={() => add(o)} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569", borderRadius: 999, padding: "3px 9px", fontSize: 12, cursor: "pointer" }}>+ {o}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Silence the unused state setter (useState init value already covers the path).
void useEffect;

function FileUpload({ token, field, value, onChange }: { token: string; field: IntakeField; value: IntakeFileRef[]; onChange: (v: IntakeFileRef[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    setBusy(true);
    let next = value;
    try {
      for (const f of Array.from(files)) {
        const prep = await createIntakeFileUploadUrl(token, field.key, f.name);
        if (prep.error || !prep.uploadUrl || !prep.storagePath || !prep.token) { setErr(prep.error ?? "Couldn't prepare upload."); continue; }
        const { error: upErr } = await supabase.storage.from("client-docs").uploadToSignedUrl(prep.storagePath, prep.token, f);
        if (upErr) { setErr(upErr.message); continue; }
        const fin = await finalizeIntakeFile(token, field.key, { name: f.name, storagePath: prep.storagePath, size: f.size });
        if (fin.error) { setErr(fin.error); continue; }
        if (fin.files) { next = fin.files; onChange(next); }
      }
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (storagePath: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await removeIntakeFile(token, field.key, storagePath);
      if (res.error) { setErr(res.error); return; }
      if (res.files) onChange(res.files);
    } finally {
      setBusy(false);
    }
  };

  const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

  return (
    <div>
      <label
        style={{
          display: "block", border: "1px dashed #d8dde6", borderRadius: 10, padding: "16px 14px",
          background: busy ? "#f8fafc" : "#fff", textAlign: "center", cursor: busy ? "wait" : "pointer",
          color: "#475569", fontSize: 13.5,
        }}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
        {busy ? "Uploading…" : (
          <>
            <div style={{ fontWeight: 600, color: "#0f172a", marginBottom: 2 }}>Drop files here, or click to choose</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>PDF · JPG · PNG · Excel · Word — any size up to 25 MB each</div>
          </>
        )}
      </label>

      {err && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>{err}</div>}

      {value.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {value.map((f) => (
            <div key={f.storagePath} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 7 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#0f172a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{fmtSize(f.size)}</span>
              <button type="button" onClick={() => remove(f.storagePath)} disabled={busy} style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16, padding: "0 4px", lineHeight: 1 }} title="Remove" aria-label="Remove file">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
