import { useState } from "react";
import type { Detail } from "../../shared/types";
import { TaskCodeFolder } from "./TaskCodeFolder";
import { ArtifactPreview } from "./ArtifactPreview";
export function TaskFiles({ detail, wid }: { detail: Detail; wid: string }) {
  const [selected, setSelected] = useState(""),
    [group, setGroup] = useState("deliverables"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const run = selected || detail.runs[0]?.id;
  const current = detail.artifacts.filter((f) => f.run_id === run);
  const reference = (name: string) =>
    name.startsWith("inputs/") ||
    name.startsWith("references/") ||
    name === "result.md";
  const files = current.filter(
    (f) =>
      (group === "references" ? reference(f.name) : !reference(f.name)) &&
      f.name.toLowerCase().includes(query.toLowerCase()),
  );
  const count = current.filter((f) => !reference(f.name)).length;
  return (
    <section className="task-files">
      <h3>ไฟล์ของงาน</h3>
      <p>
        เลือกไฟล์เพื่อเปิด Preview ไม่ต้องดาวน์โหลด
        ไฟล์อ้างอิงและบันทึกแยกจากผลงานที่สร้างใหม่
      </p>
      <TaskCodeFolder wid={wid} taskId={detail.task.id} runId={run} />
      <div className="org-fields">
        <label>
          รอบการทำงาน
          <select
            aria-label="รอบของไฟล์"
            value={run || ""}
            onChange={(e) => {
              setSelected(e.target.value);
              setPage(0);
            }}
          >
            {detail.runs.map((r, i) => (
              <option key={r.id} value={r.id}>
                {i === 0 ? "ล่าสุด · " : ""}
                {new Date(r.started_at).toLocaleString("th-TH")}
              </option>
            ))}
          </select>
        </label>
        <label>
          ค้นหาไฟล์
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="ชื่อไฟล์หรือโฟลเดอร์"
          />
        </label>
      </div>
      <div className="actions">
        <button
          aria-pressed={group === "deliverables"}
          onClick={() => {
            setGroup("deliverables");
            setPage(0);
          }}
        >
          ผลงานที่สร้างใหม่ ({count})
        </button>
        <button
          aria-pressed={group === "references"}
          onClick={() => {
            setGroup("references");
            setPage(0);
          }}
        >
          อ้างอิงและบันทึก ({current.length - count})
        </button>
      </div>
      {!files.length && <p className="empty">ไม่มีไฟล์ในหมวดนี้</p>}
      {files.slice(page * 12, page * 12 + 12).map((f) => (
        <div className="task-file-row" key={f.id}>
          <ArtifactPreview
            wid={wid}
            taskId={detail.task.id}
            file={{ ...f, name: f.name.split("/").pop() || f.name }}
          />
          <small title={f.name}>{f.name}</small>
        </div>
      ))}
      {files.length > 12 && (
        <div className="actions">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            ก่อนหน้า
          </button>
          <span>
            หน้า {page + 1} / {Math.ceil(files.length / 12)}
          </span>
          <button
            disabled={(page + 1) * 12 >= files.length}
            onClick={() => setPage(page + 1)}
          >
            ถัดไป
          </button>
        </div>
      )}
    </section>
  );
}
