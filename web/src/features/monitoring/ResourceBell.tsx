import React, { useEffect, useRef, useState } from "react";
import type { ResourceController } from "./useResourceMonitor";
import { noticeText } from "./useResourceMonitor";
import "./monitoring.css";
export function ResourceBell({
  monitor: m,
  onOpenSettings,
}: {
  monitor: ResourceController;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [confirmClear, setConfirmClear] = useState(false),
    [clearing, setClearing] = useState(false),
    [message, setMessage] = useState("");
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const unread = m.data?.unread_count || 0;
  return (
    <div
      className="resource-bell"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        className="resource-bell-button"
        aria-label={`การแจ้งเตือนทรัพยากร${unread ? ` · ยังไม่อ่าน ${unread} รายการ` : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((v) => !v);
          setConfirmClear(false);
          setError("");
          setMessage("");
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {(unread > 0 || m.stale || !!m.data?.active_count) && (
          <span className="resource-badge">
            {m.stale ? "!" : unread > 99 ? "99+" : unread || "•"}
          </span>
        )}
      </button>
      {open && (
        <div
          className="resource-popover"
          role="dialog"
          aria-label="การแจ้งเตือนทรัพยากร"
        >
          <div className="panel-heading">
            <h3>การแจ้งเตือนทรัพยากร</h3>
            <button
              aria-label="ปิดรายการแจ้งเตือน"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          {m.stale && (
            <p role="status" className="resource-stale">
              ข้อมูลทรัพยากรยังไม่พร้อมหรือหยุดอัปเดต ค่าล่าสุดอาจเก่า
            </p>
          )}
          <p>
            การเตือนที่ยังไม่สิ้นสุด {m.data?.active_count ?? "—"} รายการ ·
            ยังไม่อ่าน {unread} รายการ
          </p>
          <div className="actions">
            <button
              disabled={!unread}
              onClick={() =>
                m.markRead().catch(() => setError("บันทึกการอ่านไม่สำเร็จ"))
              }
            >
              อ่านทั้งหมด
            </button>
            <button
              disabled={clearing || !m.data?.clearable_count}
              onClick={() => {
                setConfirmClear(true);
                setError("");
                setMessage("");
              }}
            >
              ล้างประวัติ
            </button>
            <button
              onClick={() => {
                m.openSettings();
                onOpenSettings();
                setOpen(false);
              }}
            >
              เปิดหน้าทรัพยากร
            </button>
          </div>
          {confirmClear && (
            <div className="resource-clear-confirm">
              <p>
                ล้างประวัติที่สิ้นสุดแล้วจากบัญชีของคุณ?
                คำเตือนที่ยังมีปัญหาจะคงอยู่ และไม่กระทบผู้ดูแลคนอื่น
              </p>
              <div className="actions">
                <button
                  disabled={clearing}
                  onClick={async () => {
                    setClearing(true);
                    setError("");
                    try {
                      await m.clearHistory();
                      setConfirmClear(false);
                      setMessage("ล้างประวัติแล้ว");
                    } catch {
                      setError("ล้างประวัติไม่สำเร็จ กรุณาลองอีกครั้ง");
                    } finally {
                      setClearing(false);
                    }
                  }}
                >
                  {clearing ? "กำลังล้าง…" : "ยืนยันล้างประวัติ"}
                </button>
                <button
                  disabled={clearing}
                  onClick={() => setConfirmClear(false)}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
          <div className="resource-notices">
            {m.data?.notifications.map((n) => (
              <button
                className={`resource-notice ${n.read ? "read" : ""} ${n.kind}`}
                key={n.id}
                onClick={() =>
                  m
                    .markRead([n.id])
                    .catch(() => setError("บันทึกการอ่านไม่สำเร็จ"))
                }
              >
                <span>
                  {n.kind === "warning"
                    ? n.resolved_at
                      ? "คำเตือนที่สิ้นสุดแล้ว"
                      : "คำเตือน"
                    : "สถานะเปลี่ยนแปลง"}
                  {!n.read ? " · ใหม่" : ""}
                </span>
                <strong>{noticeText(n)}</strong>
                <time>{new Date(n.created_at).toLocaleString("th-TH")}</time>
              </button>
            ))}
            {m.data && !m.data.notifications.length && (
              <p>ยังไม่มีการแจ้งเตือน</p>
            )}
          </div>
        </div>
      )}
      {m.toast && (
        <div className={`resource-toast ${m.toast.kind}`} role="status">
          <strong>{noticeText(m.toast)}</strong>
          <button aria-label="ปิดข้อความแจ้งเตือน" onClick={m.dismissToast}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
