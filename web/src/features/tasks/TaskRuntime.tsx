import { useEffect, useState } from "react";
import { api } from "../../shared/api";
import type { OfficeController } from "../../application/useOfficeController";
type RuntimeJob = {
  id: string;
  source_run_id: string;
  status: string;
  port: number;
  error: string;
  evidence: Record<string, unknown>;
  expires_at: string;
};
type Inventory = { online: boolean; jobs: RuntimeJob[] };
export function useTaskRuntime(ctx: OfficeController, active: boolean) {
  const [data, setData] = useState<Inventory>({ online: false, jobs: [] }),
    [ack, setAck] = useState(false),
    [selected, setSelected] = useState(""),
    [log, setLog] = useState<{
      content: string;
      next_before: number | null;
    } | null>(null),
    [error, setError] = useState("");
  const task = ctx.detail?.task,
    wid = ctx.wid;
  async function refresh() {
    if (!task || !wid) return;
    setData(
      await api<Inventory>(`/workspaces/${wid}/tasks/${task.id}/runtime`),
    );
  }
  useEffect(() => {
    setData({ online: false, jobs: [] });
    setAck(false);
    setSelected("");
    setLog(null);
    setError("");
  }, [wid, task?.id]);
  useEffect(() => {
    if (!active || !task || !wid) return;
    let live = true;
    const load = () =>
      api<Inventory>(`/workspaces/${wid}/tasks/${task.id}/runtime`)
        .then((d) => {
          if (live) setData(d);
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    load();
    const timer = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, wid, task?.id]);
  const job = data.jobs.find((j) => j.id === selected) || data.jobs[0];
  return {
    data,
    ack,
    setAck,
    job,
    log,
    error,
    select: (id: string) => {
      setSelected(id);
      setLog(null);
    },
    launch: () =>
      ctx.run(async () => {
        if (!task || !ack) return;
        await api(`/workspaces/${wid}/tasks/${task.id}/runtime`, {
          acknowledged: true,
        });
        await refresh();
        await ctx.after();
      }),
    stop: () =>
      ctx.run(async () => {
        if (!job) return;
        await api(`/workspaces/${wid}/runtime/${job.id}/stop`, {});
        await refresh();
      }),
    loadLog: async (before?: number) => {
      if (!job) return;
      try {
        setLog(
          await api(
            `/workspaces/${wid}/runtime/${job.id}/logs${before === undefined ? "" : `?before=${before}`}`,
          ),
        );
        setError("");
      } catch (e) {
        setError(String(e));
      }
    },
  };
}
export function TaskRuntime({
  ctx,
  runtime,
}: {
  ctx: OfficeController;
  runtime: ReturnType<typeof useTaskRuntime>;
}) {
  const { data, job, ack, setAck, log, error } = runtime;
  const task = ctx.detail!.task;
  const labels: Record<string, string> = {
    queued: "รอ Runner",
    building: "กำลัง Build",
    testing: "กำลังทดสอบ",
    starting: "กำลังเปิดเว็บ",
    ready: "พร้อมเปิดเว็บ",
    stopping: "กำลังหยุด",
    stopped: "หยุดแล้ว",
    failed: "ไม่ผ่าน",
  };
  const href =
    job &&
    /^[-a-f0-9]{36}$/.test(job.id) &&
    job.port >= 19000 &&
    job.port <= 19099
      ? `http://preview-${job.id.replaceAll("-", "")}.localhost:${job.port}`
      : null;
  return (
    <section className="runtime-panel">
      <h3>ทดสอบและเปิดโปรแกรม</h3>
      <p>
        <b>{data.online ? "Runner ออนไลน์" : "Runner ยังไม่พร้อม / ออฟไลน์"}</b>
      </p>
      <p>
        รองรับเว็บ Node.js และ React ที่ใช้ Node build ตามมาตรฐานกลาง
        เปิดเฉพาะเครื่องนี้ผ่านโดเมนย่อย .localhost แยก cookie จาก Office
        และหยุดอัตโนมัติหลัง 2 ชั่วโมง
      </p>
      <p>
        งานนี้{task.runtime_enabled ? "เปิด" : "ไม่ได้เปิด"}การรันอัตโนมัติหลัง
        Agent ส่งไฟล์
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        ฉันอนุญาตให้รันโค้ดของงานนี้ใน Docker ที่ Runner จัดการ
      </label>
      <small>
        ใช้ปุ่ม Build / Test / เปิดเว็บ ใน Footer ต้องมี office-run.json,
        package.json, package-lock.json และชุดทดสอบก่อน
      </small>
      {data.jobs.length > 0 && (
        <label>
          ประวัติการรัน
          <select
            value={job?.id || ""}
            onChange={(e) => runtime.select(e.target.value)}
          >
            {data.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {labels[j.status] || j.status} · พอร์ต {j.port} · รอบ{" "}
                {j.source_run_id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      )}
      {job && (
        <>
          <p className="tag">{labels[job.status] || job.status}</p>
          {job.error && (
            <p role="alert" className="error">
              {job.error}
            </p>
          )}
          {job.status === "ready" && href && (
            <p>
              <a
                className="runtime-open"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                เปิดเว็บบนเครื่องนี้ ↗
              </a>
            </p>
          )}
          <p>หมดอายุ: {new Date(job.expires_at).toLocaleString("th-TH")}</p>
          <details>
            <summary>หลักฐาน Build / Test / HTTP</summary>
            <pre className="result">
              {JSON.stringify(job.evidence, null, 2)}
            </pre>
            <small>
              ผลเหล่านี้ไม่ยืนยันว่าฟังก์ชันธุรกิจทั้งหมดถูกต้อง
              ต้องตรวจผลงานก่อนรับงาน
            </small>
          </details>
          <button onClick={() => runtime.loadLog()}>ดู Log ของ Runner</button>
          {log && (
            <>
              <pre className="result">{log.content || "ยังไม่มี Log"}</pre>
              {log.next_before !== null && (
                <button onClick={() => runtime.loadLog(log.next_before!)}>
                  ช่วงก่อนหน้า
                </button>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
