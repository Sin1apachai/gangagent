import { useRef, useState } from "react";
import { api } from "../../shared/api";
import type { Detail } from "../../shared/types";
import { statusLabel } from "../../shared/constants";
type Log = {
  content: string;
  start: number;
  end: number;
  total_bytes: number;
  next_before: number | null;
};
type Events = { events: Detail["events"]; next_before: number | null };
export function TaskHistory({ detail, wid }: { detail: Detail; wid: string }) {
  const [selected, setSelected] = useState(""),
    [log, setLog] = useState<Log | null>(null),
    [events, setEvents] = useState<Events | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  const generation = useRef(0);
  const run = selected || detail.runs[0]?.id;
  const base = `/workspaces/${wid}/tasks/${detail.task.id}`;
  async function loadLog(before?: number) {
    if (!run) return;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const data = await api<Log>(
        `${base}/runs/${run}/log${before === undefined ? "" : `?before=${before}`}`,
      );
      if (request === generation.current) setLog(data);
    } catch (e) {
      if (request === generation.current)
        setError(e instanceof Error ? e.message : "โหลดบันทึกไม่สำเร็จ");
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  async function loadEvents(before?: number) {
    setError("");
    try {
      setEvents(
        await api<Events>(
          `${base}/history-events${before === undefined ? "" : `?before=${before}`}`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดประวัติไม่สำเร็จ");
    }
  }
  return (
    <section className="task-history">
      <h3>ประวัติและบันทึก</h3>
      <p>โหลดเฉพาะรอบที่เลือก ครั้งละไม่เกิน 20 KB โดยเริ่มจากช่วงล่าสุด</p>
      <details
        onToggle={(e) => {
          if (e.target === e.currentTarget && e.currentTarget.open && !events)
            loadEvents();
        }}
      >
        <summary>เหตุการณ์ของงาน</summary>
        {events?.events.map((e) => (
          <p className="event" key={e.id}>
            <small>{new Date(e.created_at).toLocaleString("th-TH")}</small>{" "}
            {e.message}
          </p>
        ))}
        {events && (
          <div className="actions">
            <button onClick={() => loadEvents()}>ล่าสุด</button>
            {events.next_before !== null && (
              <button onClick={() => loadEvents(events.next_before!)}>
                เหตุการณ์ก่อนหน้า
              </button>
            )}
          </div>
        )}
      </details>
      <label>
        รอบที่ต้องการอ่าน
        <select
          aria-label="รอบของบันทึก"
          value={run || ""}
          onChange={(e) => {
            generation.current++;
            setSelected(e.target.value);
            setLog(null);
            setBusy(false);
            setError("");
            setQuery("");
          }}
        >
          {detail.runs.map((r, i) => (
            <option key={r.id} value={r.id}>
              {i === 0 ? "ล่าสุด · " : ""}
              {statusLabel[r.status] || r.status} ·{" "}
              {new Date(r.started_at).toLocaleString("th-TH")}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button disabled={busy || !run} onClick={() => loadLog()}>
          {busy ? "กำลังโหลด…" : "โหลดบันทึกรอบนี้"}
        </button>
        {log && (
          <button
            onClick={() => {
              generation.current++;
              setLog(null);
              setBusy(false);
            }}
          >
            ปิดบันทึก
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {log && (
        <>
          <label>
            ค้นหาในช่วงที่เปิด
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาข้อความในช่วงนี้"
            />
          </label>
          <small>
            แสดงไบต์ {log.start.toLocaleString()}–{log.end.toLocaleString()} จาก{" "}
            {log.total_bytes.toLocaleString()} · ค้นหาเฉพาะช่วงที่เปิดอยู่
          </small>
          <pre className="result">
            {query
              ? log.content
                  .split("\n")
                  .filter((l) => l.toLowerCase().includes(query.toLowerCase()))
                  .join("\n") || "ไม่พบข้อความในช่วงนี้"
              : log.content || "ยังไม่มีบันทึก"}
          </pre>
          <div className="actions">
            {log.next_before !== null && (
              <button disabled={busy} onClick={() => loadLog(log.next_before!)}>
                ช่วงก่อนหน้า
              </button>
            )}
            <button disabled={busy} onClick={() => loadLog()}>
              กลับช่วงล่าสุด
            </button>
          </div>
        </>
      )}
    </section>
  );
}
