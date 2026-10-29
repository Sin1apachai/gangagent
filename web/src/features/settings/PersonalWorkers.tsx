import React, { useEffect, useState } from "react";
import { api } from "../../shared/api";
type Binding = {
  id: string;
  label: string;
  worker_id: string;
  revoked_at: string | null;
};
export function PersonalWorkers() {
  const [rows, setRows] = useState<Binding[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const load = async () => setRows(await api<Binding[]>("/personal-workers"));
  useEffect(() => {
    load().catch((e) => setError(String(e)));
  }, []);
  return (
    <section className="panel personal-workers-panel">
      <h2>Worker ส่วนตัว</h2>
      <p>
        แยกบัญชี AI และสิทธิ์ข้อมูลของแต่ละคน ติดตั้งได้เฉพาะ Docker host
        ที่คุณควบคุมและไว้ใจเท่านั้น
      </p>
      <p className="muted">
        ไฟล์ติดตั้งมีรหัสส่วนตัว ดาวน์โหลดได้ครั้งเดียว เก็บเป็นความลับ
        หลังติดตั้งให้เชื่อมบัญชี AI จากหน้านี้
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const label = String(
            new FormData(e.currentTarget).get("label") || "",
          );
          setBusy(true);
          setError("");
          try {
            const r = await api<{ id: string; compose: unknown }>(
              "/personal-workers",
              { label },
            );
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(r.compose, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "office-worker-" + r.id + ".compose.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage(
              "ดาวน์โหลดแล้ว ให้ผู้ดูแล Docker host เปิด Worker ด้วยไฟล์นี้ แล้วกลับมาเชื่อมบัญชี AI",
            );
            await load();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          ชื่อ Worker
          <input
            name="label"
            required
            maxLength={80}
            placeholder="เครื่องส่วนตัว"
          />
        </label>
        <button disabled={busy}>สร้างและดาวน์โหลดไฟล์ติดตั้ง</button>
      </form>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {rows.map((w) => (
        <div className="provider-box" key={w.id}>
          <strong>{w.label}</strong>
          <p>{w.revoked_at ? "เพิกถอนแล้ว" : "เปิดใช้งาน"}</p>
          {!w.revoked_at && (
            <button
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    "เพิกถอน Worker นี้? งานที่กำลังทำจะหยุดเชื่อมต่อ และต้องสร้างไฟล์ใหม่หากต้องการใช้อีกครั้ง",
                  )
                )
                  return;
                setBusy(true);
                try {
                  await api("/personal-workers/" + w.id, undefined, "DELETE");
                  await load();
                } catch (e) {
                  setError(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              เพิกถอนสิทธิ์
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
