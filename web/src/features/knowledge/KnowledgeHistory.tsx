import { useState } from "react";
import { api } from "../../shared/api";
type Revision = {
  version: number;
  title: string;
  content: string;
  source: string;
  verified: boolean;
  recorded_at: string;
};
export function KnowledgeHistory({
  wid,
  id,
  version,
}: {
  wid: string;
  id: string;
  version: number;
}) {
  const [rows, setRows] = useState<Revision[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <details
      onToggle={async (e) => {
        if (e.target !== e.currentTarget || !e.currentTarget.open || loading)
          return;
        setLoading(true);
        setError("");
        try {
          setRows(
            await api<Revision[]>(`/workspaces/${wid}/knowledge/${id}/history`),
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : "โหลดประวัติไม่สำเร็จ");
        } finally {
          setLoading(false);
        }
      }}
    >
      <summary>ประวัติ Knowledge · เวอร์ชัน {version + 1}</summary>
      {loading && <p role="status">กำลังโหลดประวัติ…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading &&
        rows.map((row) => (
          <details key={row.version}>
            <summary>
              เวอร์ชัน {row.version + 1} ·{" "}
              {new Date(row.recorded_at).toLocaleString("th-TH")} ·{" "}
              {row.verified ? "ตรวจสอบแล้ว" : "รอตรวจสอบ"}
            </summary>
            <h4>{row.title}</h4>
            <pre className="result">{row.content}</pre>
            <small>แหล่งที่มา: {row.source || "ผู้ใช้บันทึก"}</small>
          </details>
        ))}
      <small>แสดงประวัติล่าสุด 30 เวอร์ชัน รวมเวอร์ชันปัจจุบัน</small>
    </details>
  );
}
