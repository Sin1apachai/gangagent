import { useEffect, useState } from "react";
import { api } from "../../shared/api";
type Inventory = { path: string; session: { state: string; error: string } | null };
export function TaskCodeFolder({ wid, taskId }: { wid: string; taskId: string; runId?: string }) {
  const [data, setData] = useState<Inventory | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const load = () => api<Inventory>(`/workspaces/${wid}/tasks/${taskId}/code-folder`).then(d => { if (live) { setData(d); setError(""); } }).catch(e => { if (live) setError(String(e)); });
    load(); const timer = setInterval(load, 2000);
    return () => { live = false; clearInterval(timer); };
  }, [wid, taskId]);
  return <section className="panel" aria-label="ชุดโค้ดโปรเจกต์">
    <h4>ชุดโค้ดโปรเจกต์บนเครื่อง</h4>
    {data && <>
      <p style={{ overflowWrap: "anywhere" }}><code>{data.path}</code></p>
      <p>{data.session?.state === "synced" ? "โค้ดซิงก์กับโปรเจกต์แล้ว" : data.session?.state === "active" ? "กำลังแก้และซิงก์โค้ดโปรเจกต์" : data.session?.state === "ready" ? "พร้อมแก้โค้ดชุดเดิม" : data.session?.error ? "ซิงก์โค้ดไม่สำเร็จ" : "ใช้โค้ดชุดเดียวกันทุกงานในโปรเจกต์"}</p>
      {data.session?.error && <p role="alert">{data.session.error}</p>}
      <small>เก็บเฉพาะไฟล์โปรแกรมในโฟลเดอร์นี้ ข้อมูล Task สถานะ และ Log อยู่ใน PostgreSQL การแก้โค้ดบนเครื่องจะถูกอ่านเข้ามาในงานครั้งถัดไป</small>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
