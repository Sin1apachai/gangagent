import React, { useState } from "react";
import { api } from "../../shared/api";
import type { OfficeController } from "../../application/useOfficeController";
export function TaskQuota({ ctx }: { ctx: OfficeController }) {
  const t = ctx.detail?.task;
  const [editing, setEditing] = useState(false);
  if (!t || !["waiting_quota", "queued"].includes(t.status)) return null;
  const canEdit =
    ctx.canWrite && (t.created_by === ctx.user?.id || ctx.user?.is_super_admin);
  return (
    <section className="quota-policy">
      <h3>
        {t.status === "waiting_quota"
          ? "รอรีเซ็ตโควตา"
          : "การทำงานต่อหลังรีเซ็ต"}
      </h3>
      {t.status === "waiting_quota" && (
        <>
          <p>
            เวลารีเซ็ตจากผู้ให้บริการ:{" "}
            {t.quota_reset_at
              ? new Date(t.quota_reset_at).toLocaleString("th-TH")
              : "ยังไม่ทราบเวลา"}
          </p>
          <p>
            ตรวจครั้งถัดไป:{" "}
            {t.next_quota_check_at
              ? new Date(t.next_quota_check_at).toLocaleString("th-TH")
              : "ยังไม่ได้นัดหมาย / ถึงขีดจำกัดการลองแล้ว"}
          </p>
        </>
      )}
      <p>
        ทำงานต่ออัตโนมัติ: {t.quota_auto_resume ? "เปิด" : "ปิด"} · ตรวจตามช่วง{" "}
        {t.quota_check_minutes ?? 120} นาที · ลองอัตโนมัติ{" "}
        {t.quota_retries ?? 0}
        /3
      </p>
      <small>
        ถ้าไม่ทราบเวลารีเซ็ต
        ระบบจะลองงานเดิมตามช่วงเวลาและเพิ่มระยะห่างเมื่อติดโควตาซ้ำ
        ไม่ใช่การยืนยันว่าผู้ให้บริการรีเซ็ตแล้ว งานรวมไม่เกิน 3 attempts
        และไม่เริ่มงานที่ถูกยกเลิกหรือถอนสิทธิ์
      </small>
      {canEdit && (
        <button
          type="button"
          disabled={ctx.busy}
          onClick={() => setEditing(!editing)}
        >
          ตั้งค่ารอรีเซ็ต
        </button>
      )}
      {editing && canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            ctx.run(async () => {
              await api(
                `/workspaces/${ctx.wid}/tasks/${t.id}/quota`,
                {
                  version: t.version,
                  auto_resume: f.get("auto_resume") === "on",
                  check_minutes: Number(f.get("check_minutes")),
                  reset_at: f.get("reset_at")
                    ? new Date(String(f.get("reset_at"))).toISOString()
                    : null,
                },
                "PUT",
              );
              await ctx.after();
              setEditing(false);
            });
          }}
        >
          <label className="check">
            <input
              type="checkbox"
              name="auto_resume"
              defaultChecked={t.quota_auto_resume ?? true}
            />
            ทำงานต่ออัตโนมัติเมื่อถึงเวลาตรวจ
          </label>
          <label>
            ช่วงตรวจซ้ำ (นาที)
            <input
              name="check_minutes"
              type="number"
              min="5"
              max="1440"
              required
              defaultValue={t.quota_check_minutes ?? 120}
            />
          </label>
          <label>
            เวลารีเซ็ตที่ทราบ (ไม่ระบุก็ได้)
            <input name="reset_at" type="datetime-local" />
          </label>
          <button className="primary" disabled={ctx.busy}>
            บันทึกการรอรีเซ็ต
          </button>
        </form>
      )}
    </section>
  );
}
