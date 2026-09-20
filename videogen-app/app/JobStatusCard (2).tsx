"use client";

import {
  JobState,
  VoiceGender,
  VoicePace,
  VOICES_BY_GENDER,
  STATUS_LABELS,
  inputStyle,
  approveBtnStyle,
  disapproveBtnStyle,
} from "../lib/jobUiShared";

interface Props {
  job: JobState;
  approving: boolean;
  onApprove: (stage: string, decision: "approve" | "regenerate") => void;
  voiceGender: VoiceGender;
  setVoiceGender: (g: VoiceGender) => void;
  voiceName: string;
  setVoiceName: (n: string) => void;
  voicePace: VoicePace;
  setVoicePace: (p: VoicePace) => void;
  previewingVoice: boolean;
  onPreviewVoice: () => void;
  voicePreviewError: string | null;
  regeneratingScene: number | null;
  onRegenerateScene: (sceneIndex: number) => void;
}

/**
 * The status/approval/results card — shared by the main generate page
 * and the Remix page so both show the SAME real-time state, including
 * the script/voice approval checkpoints. This used to exist only in the
 * main page's JSX, positioned above the Remix section; a job created
 * via Remix would genuinely pause waiting for approval, but the button
 * to approve it rendered somewhere the Remix user had already scrolled
 * past, so it looked like Remix "did nothing." Giving each page its own
 * copy of this component right next to its own submit button is the fix.
 */
export default function JobStatusCard({
  job,
  approving,
  onApprove,
  voiceGender,
  setVoiceGender,
  voiceName,
  setVoiceName,
  voicePace,
  setVoicePace,
  previewingVoice,
  onPreviewVoice,
  voicePreviewError,
  regeneratingScene,
  onRegenerateScene,
}: Props) {
  return (
    <div style={{ marginTop: 32, padding: 20, background: "rgba(255,255,255,0.06)", borderRadius: 8 }}>
      <p style={{ fontWeight: 600, marginBottom: 4, color: "#f2eee3" }}>
        Status: {STATUS_LABELS[job.status] ?? job.status}
      </p>
      {job.progressNote && <p style={{ color: "#b8b2a0" }}>{job.progressNote}</p>}
      {job.error && <p style={{ color: "#e08a8a" }}>Error: {job.error}</p>}

      {/* Script approval checkpoint */}
      {job.status === "awaiting_approval" && job.awaitingStage === "script" && job.script && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontWeight: 600, color: "#d4af37", marginBottom: 8 }}>{job.script.title}</p>
          <div style={{ maxHeight: 220, overflowY: "auto", fontSize: 14, lineHeight: 1.6, color: "#e8e4d8" }}>
            {job.script.scenes.map((s, i) => (
              <p key={i} style={{ marginBottom: 10 }}>{s.text}</p>
            ))}
          </div>
          <div>
            <button onClick={() => onApprove("script", "approve")} disabled={approving} style={approveBtnStyle}>
              {approving ? "..." : "Approve script & continue"}
            </button>
            {job.request?.scriptMode !== "custom" && (
              <button onClick={() => onApprove("script", "regenerate")} disabled={approving} style={disapproveBtnStyle}>
                {approving ? "..." : "Try a different script"}
              </button>
            )}
          </div>
          {job.request?.scriptMode === "custom" && (
            <p style={{ fontSize: 12, color: "#8b8574", marginTop: 6 }}>
              Custom mode uses your pasted text as-is — edit it above and resubmit to change it.
            </p>
          )}
        </div>
      )}

      {/* Voice approval checkpoint */}
      {job.status === "awaiting_approval" && job.awaitingStage === "voice" && job.voiceoverPreviewUrl && (
        <div style={{ marginTop: 16 }}>
          <audio controls style={{ width: "100%" }} src={job.voiceoverPreviewUrl} />

          <p style={{ fontSize: 12, color: "#8a8474", margin: "14px 0 6px" }}>
            Not the right voice? Change it and preview before trying again:
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <select
              value={voiceGender}
              onChange={(e) => {
                const g = e.target.value as VoiceGender;
                setVoiceGender(g);
                setVoiceName(VOICES_BY_GENDER[g][0].key);
              }}
              style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
            <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }}>
              {VOICES_BY_GENDER[voiceGender].map((v) => (
                <option key={v.key} value={v.key}>{v.name}</option>
              ))}
            </select>
            <select value={voicePace} onChange={(e) => setVoicePace(e.target.value as VoicePace)} style={{ ...inputStyle, marginBottom: 0, flex: 1 }}>
              <option value="slower">Slower</option>
              <option value="normal">Normal pace</option>
              <option value="faster">Faster</option>
            </select>
          </div>
          <button
            onClick={onPreviewVoice}
            disabled={previewingVoice}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              background: "transparent",
              color: "#d4af37",
              border: "1px solid #d4af37",
              borderRadius: 6,
              cursor: previewingVoice ? "default" : "pointer",
              marginBottom: 14,
            }}
          >
            {previewingVoice ? "Loading preview..." : "▶ Preview this voice & speed"}
          </button>
          {voicePreviewError && <p style={{ color: "#e08a8a", fontSize: 12, marginTop: -8, marginBottom: 14 }}>{voicePreviewError}</p>}

          <div>
            <button onClick={() => onApprove("voice", "approve")} disabled={approving} style={approveBtnStyle}>
              {approving ? "..." : "Approve voice & continue"}
            </button>
            <button onClick={() => onApprove("voice", "regenerate")} disabled={approving} style={disapproveBtnStyle}>
              {approving ? "..." : "Use this voice — try again"}
            </button>
          </div>
        </div>
      )}

      {job.status === "done" && job.outputVideoPath && (
        <>
          <video controls style={{ width: "100%", marginTop: 16, borderRadius: 8 }}>
            <source src={job.outputVideoPath} type="video/mp4" />
          </video>
          <a
            href={job.outputVideoPath}
            download
            style={{ display: "inline-block", marginTop: 12, padding: "8px 16px", background: "transparent", border: "1px solid #d4af37", borderRadius: 8, color: "#d4af37", textDecoration: "none", fontWeight: 600, fontSize: 14 }}
          >
            Download
          </a>

          {(job.metaTitle || job.thumbnailUrl) && (
            <div style={{ marginTop: 24, padding: 16, background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)" }}>
              <p style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", color: "#8a8474", marginBottom: 12 }}>
                Ready to publish
              </p>
              {job.thumbnailUrl && (
                <img
                  src={job.thumbnailUrl}
                  alt="Thumbnail"
                  style={{ width: "100%", maxWidth: 400, borderRadius: 6, marginBottom: 14, display: "block" }}
                />
              )}
              {job.metaTitle && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 11, color: "#8a8474", margin: "0 0 4px" }}>Title</p>
                  <p style={{ fontSize: 14, color: "#f2eee3", margin: 0, fontWeight: 600 }}>{job.metaTitle}</p>
                </div>
              )}
              {job.metaDescription && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 11, color: "#8a8474", margin: "0 0 4px" }}>Description</p>
                  <p style={{ fontSize: 13, color: "#cfc9ba", margin: 0, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{job.metaDescription}</p>
                </div>
              )}
              {job.metaTags && job.metaTags.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, color: "#8a8474", margin: "0 0 4px" }}>Tags</p>
                  <p style={{ fontSize: 12, color: "#9d9784", margin: 0 }}>{job.metaTags.join(", ")}</p>
                </div>
              )}
            </div>
          )}

          {job.script && job.script.scenes.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <p style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", color: "#8a8474", marginBottom: 10 }}>
                Not happy with a scene? Redo just that one
              </p>
              {job.script.scenes.map((scene, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 0",
                    borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <p style={{ fontSize: 13, color: "#cfc9ba", margin: 0, flex: 1 }}>
                    <span style={{ color: "#8a8474" }}>Scene {i + 1}:</span> {scene.text}
                  </p>
                  <button
                    onClick={() => onRegenerateScene(i)}
                    disabled={regeneratingScene !== null}
                    style={{
                      flexShrink: 0,
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 600,
                      background: "transparent",
                      color: "#d4af37",
                      border: "1px solid #d4af37",
                      borderRadius: 6,
                      cursor: regeneratingScene !== null ? "default" : "pointer",
                      opacity: regeneratingScene !== null ? 0.5 : 1,
                    }}
                  >
                    {regeneratingScene === i ? "Redoing..." : "Redo"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
