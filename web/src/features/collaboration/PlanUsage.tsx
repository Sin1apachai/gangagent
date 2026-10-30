import React, { useEffect, useState } from "react";
import { api } from "../../shared/api";
type Totals = Record<string, number | string>;
export function PlanUsage({ wid, id }: { wid: string; id: string }) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Totals[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    if (open) {
      setRows(null);
      setError("");
      api<{ providers: Totals[] }>(`/workspaces/${wid}/plans/${id}/usage`)
        .then((r) => {
          if (live) setRows(r.providers);
        })
        .catch(() => {
          if (live) setError("ยังโหลดตัววัดไม่ได้ ลองเปิดใหม่อีกครั้ง");
        });
    }
    return () => {
      live = false;
    };
  }, [open, wid, id]);
  const count = (v: unknown) =>
    typeof v === "number" ? v.toLocaleString() : "ไม่มีข้อมูล";
  const inputTotal = (r: Totals) => {
    const keys = r.provider === "claude" ? ["input_tokens", "cache_read_tokens", "cache_write_tokens"] : ["input_tokens"];
    if (!Number(r.reported_runs) || !keys.every(k => typeof r[k] === "number" && r[`${k}_runs`] === r.reported_runs)) return undefined;
    return keys.reduce((n,k) => n + Number(r[k]),0);
  };
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>การใช้ Token ทั้งแผน · รวมทุกรอบแก้ไข</summary>
      <p>
        แยกผู้ให้บริการเพื่อไม่บวก cache ของ Codex ซ้ำ ·
        รวมรอบที่ไม่ผ่านและงานวางแผนด้วย ตัวเลขนี้ไม่ใช่โควตา Pro
      </p>
      {error && <p role="alert">{error}</p>}
      {!rows && !error && <p>กำลังโหลด…</p>}
      {rows?.map((r) => (
        <article key={String(r.provider)}>
          <h4>
            {r.provider} · มีสถิติ {count(r.reported_runs)}/{count(r.runs)} รอบ
          </h4>
          <p><strong>หมวด Input รวม cache ที่รายงาน: {count(inputTotal(r))}</strong></p>
          <p>
            Input {count(r.input_tokens)} · Output {count(r.output_tokens)} ·
            Cache read {count(r.cache_read_tokens)} · Cache write{" "}
            {count(r.cache_write_tokens)}
          </p>
          <small>
            {r.provider === "codex"
              ? "Input รวม cache read อยู่แล้ว"
              : "Input ไม่รวม cache read/write ที่แสดงแยก"}
          </small>
        </article>
      ))}
      {rows?.length === 0 && <p>ยังไม่มีรอบการรัน</p>}
    </details>
  );
}
