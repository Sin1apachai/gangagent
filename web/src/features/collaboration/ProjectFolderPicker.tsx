import React, { useState } from "react";
import { api } from "../../shared/api";
export type ProjectFolder = { id: string; path: string; bridge_id: string };
export function ProjectFolderPicker({
  wid,
  value,
  onChange,
  onBusy,
  disabled,
}: {
  wid: string;
  value: ProjectFolder | null;
  onChange: (value: ProjectFolder | null) => void;
  onBusy: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function pick() {
    if (busy || disabled) return;
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      onChange(
        await api<ProjectFolder>(`/workspaces/${wid}/project-folders/pick`, {}),
      );
    } catch (e) {
      setError(
        (e as Error).message.includes("offline") ||
          (e as Error).message.includes("Connect")
          ? "ตัวเลือกโฟลเดอร์บนเครื่องยังไม่พร้อม กรุณาเปิดตัวเชื่อมโฟลเดอร์บนเครื่องที่รัน Worker"
          : "ยังไม่ได้เลือกโฟลเดอร์ กรุณาลองอีกครั้ง หากหน้าต่างเปิดอยู่ให้เลือกหรือกดยกเลิกที่หน้าต่างนั้น",
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="project-folder-picker" aria-label="โฟลเดอร์ทำงาน">
      <strong>โฟลเดอร์ทำงาน (ไม่บังคับ)</strong>
      <p className="project-folder-path">
        {value?.path ?? "ยังไม่ได้เลือก — เก็บผลงานในระบบตามปกติ"}
      </p>
      <div className="project-folder-actions">
        <button type="button" disabled={disabled || busy} onClick={pick}>
          {busy
            ? "กำลังรอเลือกโฟลเดอร์…"
            : value
              ? "เปลี่ยนโฟลเดอร์"
              : "เลือกโฟลเดอร์บนเครื่อง"}
        </button>
        {value && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              setError("");
              onChange(null);
            }}
          >
            ยกเลิกการเชื่อมโฟลเดอร์
          </button>
        )}
      </div>
      <p className="form-section-help">
        เลือกจากหน้าต่างของเครื่องที่รัน Worker ได้โดยไม่ต้องย้ายไฟล์ Agent
        จะอ่านไฟล์ข้อความและบันทึกไฟล์ที่แก้กลับเมื่อทำงานสำเร็จ
        งานที่เริ่มแล้วจะใช้โฟลเดอร์เดิม
      </p>
      {busy && (
        <p role="status">
          เปิดหน้าต่างเลือกโฟลเดอร์บนเครื่องแล้ว
          กรุณาเลือกโฟลเดอร์โปรเจกต์แล้วกด Choose
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
