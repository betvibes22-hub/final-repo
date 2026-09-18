"use client";

import { JobState, TIMELINE_STEPS, SERVICE_META, ALL_SERVICES, currentTimelineKey } from "../lib/jobUiShared";

interface Props {
  job: JobState | null;
}

/** The "what the bot is doing" sidebar — timeline, service checklist, live log. Shared by the main generate page and the Remix page. */
export default function ActivitySidebar({ job }: Props) {
  return (
    <aside style={{ flex: "1 1 280px", minWidth: 260 }}>
      <h2 style={{ fontSize: 18, marginBottom: 4, fontFamily: "sans-serif", color: "#f2eee3" }}>
        What the bot is doing
      </h2>
      <p style={{ color: "#b8b2a0", fontSize: 13, marginBottom: 20, fontFamily: "sans-serif" }}>
        It works through every service in full — real searches, real downloads, real encodes — and takes however
        long that needs. Nothing here is simulated.
      </p>

      {!job && (
        <p style={{ color: "#8a8474", fontSize: 13, fontFamily: "sans-serif" }}>
          Nothing running right now — generate a video to watch it happen here.
        </p>
      )}

      {job && (
        <div style={{ fontFamily: "sans-serif" }}>
          {TIMELINE_STEPS.map((step) => {
            const currentKey = currentTimelineKey(job);
            const stepOrder = TIMELINE_STEPS.findIndex((s) => s.key === step.key);
            const currentOrder = TIMELINE_STEPS.findIndex((s) => s.key === currentKey);
            const isDone = job.status === "done" || (currentOrder >= 0 && stepOrder < currentOrder);
            const isCurrent = step.key === currentKey && job.status !== "done";

            return (
              <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: isDone ? "#d4af37" : isCurrent ? "#f2eee3" : "rgba(255,255,255,0.15)",
                    boxShadow: isCurrent ? "0 0 8px #f2eee3" : "none",
                  }}
                />
                <span style={{ fontSize: 13, color: isDone || isCurrent ? "#f2eee3" : "#6b6656", fontWeight: isCurrent ? 600 : 400 }}>
                  {step.label}
                </span>
              </div>
            );
          })}

          <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
            <p style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", color: "#8a8474", marginBottom: 12 }}>
              Service checklist
            </p>
            {ALL_SERVICES.map((svc) => {
              const entries = (job.activityLog ?? []).filter((e) => e.service === svc);
              const touched = entries.length > 0;
              const latest = entries[entries.length - 1];
              const meta = SERVICE_META[svc];
              return (
                <div key={svc} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      marginTop: 5,
                      background: touched ? meta.color : "rgba(255,255,255,0.12)",
                    }}
                  />
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: touched ? "#f2eee3" : "#6b6656" }}>
                      {meta.label}
                    </span>
                    {latest && (
                      <p style={{ fontSize: 11.5, color: "#9d9784", margin: "2px 0 0", lineHeight: 1.4 }}>
                        {latest.text}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {job.activityLog && job.activityLog.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
              <p style={{ fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", color: "#8a8474", marginBottom: 12 }}>
                Live log
              </p>
              <div style={{ maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                {[...job.activityLog].reverse().map((entry, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        flexShrink: 0,
                        marginTop: 5,
                        background: SERVICE_META[entry.service].color,
                      }}
                    />
                    <p style={{ fontSize: 12, color: "#cfc9ba", margin: 0, lineHeight: 1.45 }}>{entry.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
