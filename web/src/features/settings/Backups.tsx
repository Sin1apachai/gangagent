import "./backups.css";
import React, { useEffect, useState } from "react";
import { api } from "../../shared/api";
type Job = {
  id: string;
  status: string;
  cancel_requested?: boolean;
  message: string;
  bytes: number;
  sha256: string;
  created_at: string;
  finished_at: string | null;
};
type State = {
  jobs: Job[];
  online: boolean;
  paused: boolean;
  max_files: number;
};
const labels: Record<string, string> = {
  queued: "รอเริ่ม",
  waiting: "รอให้งาน AI ปัจจุบันจบ",
  snapshotting: "กำลังสำรองฐานข้อมูล",
  archiving: "กำลังรวมไฟล์และตรวจสอบ",
  ready: "พร้อมดาวน์โหลด",
  failed: "สำรองไม่สำเร็จ",
  cancelled: "ยกเลิกแล้ว",
  deleting: "กำลังลบไฟล์",
};
export function Backups() {
  const [data, setData] = useState<State | null>(null),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  async function load() {
    setData(await api<State>("/admin/backups"));
  }
  useEffect(() => {
    let live = true;
    const fetch = () =>
      api<State>("/admin/backups")
        .then((r) => {
          if (live) setData(r);
        })
        .catch(() => {
          if (live) setError("โหลดรายการสำรองข้อมูลไม่สำเร็จ");
        });
    fetch();
    const t = setInterval(fetch, 2500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  async function act(path: string, body: unknown = {}, method = "POST") {
    setBusy(true);
    setError("");
    try {
      await api(path, body, method);
      await load();
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  const active = data?.jobs.some((j) =>
    ["queued", "waiting", "snapshotting", "archiving"].includes(j.status),
  );
  const size = (n: number) =>
    n >= 1048576
      ? `${(n / 1048576).toFixed(1)} MB`
      : `${(n / 1024).toFixed(1)} KB`;
  return (
    <section className="panel backup-panel" style={{ gridColumn: "1 / -1" }}>
      <h2>สำรองข้อมูลและดาวน์โหลด</h2>
      <p>
        สำรองฐานข้อมูลทุก Workspace พร้อม Knowledge, Agent, Workflow
        และไฟล์ผลงาน ระบบจะพักการเริ่มงาน AI ใหม่ชั่วคราว
        และรอให้งานที่กำลังทำจบ
      </p>
      <p>
        ไม่รวมบัญชีเชื่อมต่อ Codex/Claude, session ที่ล็อกอินอยู่ และ cache
        หากย้ายเครื่องต้องเชื่อมบัญชี AI ใหม่
      </p>
      <p role="status">
        {data?.online
          ? "บริการสำรองข้อมูลพร้อมใช้งาน"
          : "กำลังตรวจบริการสำรองข้อมูล / ยังไม่พร้อม"}
        {data?.paused ? " · กำลังพักการเริ่มงานใหม่" : ""}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        ฉันรับทราบว่าไฟล์รวมข้อมูลทุก Workspace และข้อมูลบัญชีผู้ใช้
        ต้องเก็บเป็นความลับ
      </label>
      <div className="actions" style={{ gap: 12, margin: "16px 0" }}>
        <button
          className="primary"
          disabled={busy || !ack || !data?.online || !!active}
          onClick={() => act("/admin/backups", { acknowledged: true })}
        >
          สำรองข้อมูลตอนนี้
        </button>
        <button
          disabled={busy}
          onClick={() => load().catch(() => setError("โหลดรายการไม่ได้"))}
        >
          รีเฟรชรายการสำรอง
        </button>
        {!data?.online && data?.paused && (
          <button disabled={busy} onClick={() => act("/admin/backups/recover")}>
            กู้สถานะหลังบริการขัดข้อง
          </button>
        )}
      </div>
      <small>
        เก็บได้สูงสุด {data?.max_files || 20} ไฟล์ · ไม่เกิน 2 GB ต่อชุด ·
        การลบไฟล์สำรองไม่ลบข้อมูลที่ใช้งานอยู่
      </small>
      <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
        {data?.jobs.map((j) => (
          <article
            key={j.id}
            style={{
              padding: 20,
              border: "1px solid var(--border, #d9d1be)",
              borderRadius: 8,
            }}
          >
            <div className="panel-heading">
              <h3>{new Date(j.created_at).toLocaleString("th-TH")}</h3>
              <span className="tag">{j.cancel_requested && ["waiting","snapshotting","archiving"].includes(j.status) ? "กำลังยกเลิก" : labels[j.status] || j.status}</span>
            </div>
            {j.status === "waiting" && (
              <p>งานที่กำลังทำจะทำต่อจนจบ ไม่ถูกยกเลิก</p>
            )}
            {j.status === "failed" && (
              <p>
                ยังไม่มีไฟล์สมบูรณ์ให้ดาวน์โหลด ลองสำรองใหม่
                หรือตรวจพื้นที่จัดเก็บและไฟล์ผลงาน
              </p>
            )}
            {j.status === "ready" && (
              <>
                <p>ขนาด {size(j.bytes)} · พร้อมดาวน์โหลด</p>
                <details>
                  <summary>รหัสตรวจสอบความครบถ้วนของไฟล์</summary>
                  <code style={{ overflowWrap: "anywhere" }}>
                    SHA-256: {j.sha256}
                  </code>
                </details>
              </>
            )}
            <div className="actions" style={{ gap: 12, marginTop: 16 }}>
              {j.status === "ready" && (
                <a
                  className="primary backup-download"
                  download
                  href={`/api/admin/backups/${j.id}/download`}
                >
                  ดาวน์โหลดไฟล์สำรอง
                </a>
              )}
              {["queued", "waiting", "snapshotting", "archiving"].includes(
                j.status,
              ) && (
                <button
                  disabled={busy}
                  onClick={() => act(`/admin/backups/${j.id}/cancel`)}
                >
                  ยกเลิกการสำรอง
                </button>
              )}
              {["ready", "failed", "cancelled"].includes(j.status) &&
                (confirmDelete === j.id ? (
                  <>
                    <span>ลบไฟล์สำรองชุดนี้ถาวร?</span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(`/admin/backups/${j.id}`, undefined, "DELETE")
                      }
                    >
                      ยืนยันลบไฟล์สำรอง
                    </button>
                    <button onClick={() => setConfirmDelete(null)}>
                      เก็บไว้
                    </button>
                  </>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => setConfirmDelete(j.id)}
                  >
                    ลบไฟล์สำรองนี้
                  </button>
                ))}
            </div>
          </article>
        ))}
        {data && !data.jobs.length && (
          <p>ยังไม่มีชุดสำรองจากหน้าระบบ กดสำรองข้อมูลตอนนี้เพื่อสร้างชุดแรก</p>
        )}
      </div>
    </section>
  );
}
