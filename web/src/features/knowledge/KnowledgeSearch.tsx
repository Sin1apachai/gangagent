import React, { useState } from "react";
import { api } from "../../shared/api";
import type { OfficeController } from "../../application/useOfficeController";
type Hit = {
  id: string;
  title: string;
  content: string;
  source: string;
  workspace_name: string;
  workspace_id: string;
};
export function KnowledgeSearch({ ctx }: { ctx: OfficeController }) {
  const [query, setQuery] = useState(""),
    [global, setGlobal] = useState(false),
    [hits, setHits] = useState<Hit[]>([]),
    [searched, setSearched] = useState(false),
    [method, setMethod] = useState("");
  return (
    <section className="panel knowledge-search">
      <h3>ค้นหาความรู้พร้อมแหล่งอ้างอิง</h3>
      <form
        className="knowledge-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          ctx.run(async () => {
            const result = await api<{ results: Hit[]; method: string }>(
              `/knowledge/search?q=${encodeURIComponent(query)}&global=${global}&workspace_id=${ctx.wid}`,
            );
            setHits(result.results);
            setMethod(result.method);
            setSearched(true);
          });
        }}
      >
        <label>
          คำค้น
          <input
            placeholder="ถามหรือค้นจากความรู้ที่ตรวจสอบแล้ว…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            required
            maxLength={500}
          />
        </label>
        {(ctx.user?.is_super_admin ||
          (ctx.connections as any)?.global_intelligence) && (
          <label className="check">
            <input
              type="checkbox"
              checked={global}
              onChange={(e) => setGlobal(e.target.checked)}
            />
            Super Intelligence: ค้นทุก Workspace (บันทึกประวัติการเข้าถึง)
          </label>
        )}
        <button disabled={ctx.busy}>ค้นหา</button>
      </form>
      <p className="muted">
        {method.startsWith("local_")
          ? "ค้นตามความหมายด้วยโมเดล multilingual ที่รันในเครื่อง + Full-text Search"
          : "ค้นจากความรู้ที่ตรวจสอบแล้ว · Full-text Search พร้อมใช้งานแม้โมเดลค้นหายังไม่พร้อม"}
      </p>
      {hits.map((h) => (
        <article className="provider-box" key={h.id}>
          <span className="tag">{h.workspace_name} · ตรวจสอบแล้ว</span>
          <h4>{h.title}</h4>
          <p className="preserve">{h.content}</p>
          <small>
            ที่มา: {h.source || "ผู้ใช้บันทึก"} · Workspace {h.workspace_id}
          </small>
        </article>
      ))}
      {searched && !hits.length && <p>ไม่พบความรู้ที่ตรงกับคำค้น</p>}
    </section>
  );
}
