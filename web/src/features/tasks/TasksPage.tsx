import React, { useEffect, useState } from "react";
import type { Task } from "../../shared/types";
import { statusLabel } from "../../shared/constants";
import type { OfficeController } from "../../application/useOfficeController";
import "./task-board.css";

const stages = ["queued", "running", "review", "done"] as const;
const stageHelp: Record<string, string> = {
  queued: "พร้อมเริ่มเมื่อคุณสั่ง",
  running: "Worker กำลังดำเนินการ",
  review: "ตรวจผลงานก่อนรับงาน",
  done: "ตรวจรับเรียบร้อยแล้ว",
};
const priorityLabel: Record<string, string> = {
  urgent: "ด่วน",
  high: "สำคัญ",
  normal: "ปกติ",
  low: "ไม่เร่งด่วน",
};
const priorityOrder: Record<string, number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
};
const needsAttention = (task: Task) =>
  !stages.includes(task.status as (typeof stages)[number]);

function TaskCard({ task, ctx }: { task: Task; ctx: OfficeController }) {
  const agent = ctx.data?.agents.find((a) => a.id === task.agent_id);
  const action =
    task.status === "review"
      ? "ตรวจผลงาน"
      : task.status === "done"
        ? "ดูผลงาน"
        : task.status === "running"
          ? "ติดตามงาน"
          : "เปิดงาน";
  const open = () => ctx.run(() => ctx.showTask(task));
  const editable =
    ctx.canWrite &&
    !task.workflow_step &&
    task.status !== "running" &&
    !task.execution_requested;
  return (
    <article className={`task-card board-card state-${task.status}`}>
      <div className="board-card-labels">
        <span className={`provider-label provider-${task.provider}`}>
          {task.provider === "codex" ? "Codex" : "Claude"}
        </span>
        {!needsAttention(task) && (
          <span className={`board-card-status card-status-${task.status}`}>
            {statusLabel[task.status]}
          </span>
        )}
        {task.priority && task.priority !== "normal" && (
          <span className={`priority-label priority-${task.priority}`}>
            {priorityLabel[task.priority] ?? task.priority}
          </span>
        )}
        {needsAttention(task) && (
          <span className="attention-label">{statusLabel[task.status]}</span>
        )}
      </div>
      <h4>
        <button
          className="board-card-title"
          title={task.title}
          disabled={ctx.busy}
          onClick={open}
        >
          {task.title}
        </button>
      </h4>
      <p className="board-card-description">
        {task.description || "ยังไม่มีรายละเอียดงาน"}
      </p>
      {task.error && <p className="board-card-error">{task.error}</p>}
      <div className="board-card-meta">
        <span className="assignee-avatar" aria-hidden="true">
          {agent?.name.slice(0, 1) ?? "◇"}
        </span>
        <span>
          {agent?.name ??
            (task.agent_id ? "Agent ไม่พร้อมใช้งาน" : "ยังไม่ระบุ Agent")}
        </span>
        <time dateTime={task.created_at}>
          {new Date(task.created_at).toLocaleDateString("th-TH", {
            day: "numeric",
            month: "short",
          })}
        </time>
      </div>
      {task.execution_requested && (
        <p className="board-card-queue" role="status">
          {task.status === "running"
            ? "กำลังทำงาน"
            : "ส่งคำขอแล้ว · รอ Worker / งานก่อนหน้า"}
        </p>
      )}
      <div className="board-card-actions">
        <button
          className={task.status === "review" ? "primary" : ""}
          disabled={ctx.busy}
          onClick={open}
        >
          {action} <span aria-hidden="true">↗</span>
        </button>
        {editable && (
          <button
            className="board-edit"
            disabled={ctx.busy}
            onClick={() => ctx.setModal({ kind: "task", value: task })}
          >
            แก้ไข
          </button>
        )}
        {task.status === "queued" &&
          ctx.canWrite &&
          task.created_by === ctx.user?.id && (
            <button
              className="primary board-start"
              disabled={ctx.busy || task.execution_requested}
              onClick={() => ctx.run(() => ctx.start(task))}
            >
              เริ่มงาน
            </button>
          )}
      </div>
    </article>
  );
}

export function TasksPage({ ctx }: { ctx: OfficeController }) {
  const [provider, setProvider] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [stage, setStage] = useState("all");
  const [sort, setSort] = useState("newest");
  const [view, setView] = useState("board");
  useEffect(() => {
    setProvider("all");
    setAssignee("all");
    setStage("all");
  }, [ctx.wid]);
  if (!ctx.user || ctx.page !== "tasks" || !ctx.data) return null;
  const { data, query, setQuery, busy, run, refresh } = ctx;
  const filtered = data.tasks
    .filter(
      (t) =>
        (provider === "all" || t.provider === provider) &&
        (assignee === "all" ||
          (assignee === "none" ? !t.agent_id : t.agent_id === assignee)) &&
        `${t.title} ${t.description} ${t.error}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => {
      const difference = Date.parse(b.created_at) - Date.parse(a.created_at);
      return sort === "priority"
        ? (priorityOrder[b.priority ?? "normal"] ?? 1) -
            (priorityOrder[a.priority ?? "normal"] ?? 1) || difference
        : sort === "oldest"
          ? -difference
          : difference;
    });
  const visible = filtered.filter(
    (t) =>
      stage === "all" ||
      (stage === "attention" ? needsAttention(t) : t.status === stage),
  );
  const attention = visible.filter(needsAttention);
  const hasFilters = Boolean(
    query.trim() || provider !== "all" || assignee !== "all" || stage !== "all",
  );
  function clear() {
    setQuery("");
    setProvider("all");
    setAssignee("all");
    setStage("all");
  }
  return (
    <div className="task-workbench">
      <div className="board-toolbar">
        <label className="board-search">
          <span>ค้นหางาน</span>
          <input
            aria-label="ค้นหางาน"
            placeholder="ค้นหาชื่องาน รายละเอียด หรือปัญหา…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          <span>เครื่องมือ</span>
          <select
            aria-label="กรองเครื่องมือ"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="all">ทั้งหมด</option>
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <label>
          <span>ผู้รับผิดชอบ</span>
          <select
            aria-label="กรอง Agent"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="all">ทุก Agent</option>
            <option value="none">ยังไม่ระบุ Agent</option>
            {data.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>เรียงตาม</span>
          <select
            aria-label="เรียงงาน"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">ใหม่สุดก่อน</option>
            <option value="oldest">เก่าสุดก่อน</option>
            <option value="priority">ความสำคัญ</option>
          </select>
        </label>
        <button
          className="board-refresh"
          disabled={busy}
          onClick={() => run(refresh)}
        >
          ↻ รีเฟรช
        </button>
      </div>
      <div className="board-statusbar" role="group" aria-label="กรองสถานะงาน">
        {["all", ...stages, "attention"].map((s) => (
          <button
            key={s}
            aria-pressed={stage === s}
            className={`board-status status-${s} ${stage === s ? "selected" : ""}`}
            onClick={() => setStage(s)}
          >
            <span className="status-dot" aria-hidden="true" />
            {s === "all"
              ? "ทั้งหมด"
              : s === "attention"
                ? "ต้องติดตาม"
                : statusLabel[s]}
            <b>
              {
                filtered.filter(
                  (t) =>
                    s === "all" ||
                    (s === "attention" ? needsAttention(t) : t.status === s),
                ).length
              }
            </b>
          </button>
        ))}
      </div>
      <div className="board-viewbar">
        <p role="status">
          แสดง <strong>{visible.length}</strong> จาก {data.tasks.length} งาน{" "}
          {hasFilters && (
            <button className="clear-board-filters" onClick={clear}>
              ล้างตัวกรอง
            </button>
          )}
        </p>
        <div className="board-view-toggle" role="group" aria-label="มุมมองงาน">
          <button
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            ▥ กระดาน
          </button>
          <button
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            ☷ รายการ
          </button>
        </div>
      </div>
      {!visible.length && (
        <section className="board-zero">
          <span aria-hidden="true">◇</span>
          <h3>
            {hasFilters ? "ไม่พบงานที่ตรงกับตัวกรอง" : "เริ่มงานแรกของทีม"}
          </h3>
          <p>
            {hasFilters
              ? "ลองเปลี่ยนคำค้น เครื่องมือ หรือผู้รับผิดชอบ"
              : "สร้างงาน เลือก Agent แล้วกดเริ่มเมื่อพร้อม งานที่บันทึกไว้จะยังไม่เรียก AI"}
          </p>
          {hasFilters ? (
            <button onClick={clear}>ล้างตัวกรอง</button>
          ) : (
            ctx.canWrite && (
              <button
                className="primary"
                onClick={() => ctx.setModal({ kind: "task" })}
              >
                ＋ สร้างงานแรก
              </button>
            )
          )}
        </section>
      )}
      {visible.length > 0 && view === "list" && (
        <div className="board-list">
          {visible.map((t) => (
            <TaskCard task={t} ctx={ctx} key={t.id} />
          ))}
        </div>
      )}
      {visible.length > 0 && view === "board" && (
        <>
          {stage !== "attention" && (
            <>
              <p className="board-swipe-hint">
                เลื่อนกระดานด้านข้างเพื่อดูแต่ละสถานะ หรือเลือกสถานะด้านบน
              </p>
              <div
                className={`board task-board ${stage !== "all" ? "board-filtered" : ""}`}
                tabIndex={0}
                aria-label="กระดานงานแยกตามสถานะ"
              >
                {stages
                  .filter((s) => stage === "all" || stage === s)
                  .map((s) => {
                    const tasks = visible.filter((t) => t.status === s);
                    return (
                      <section
                        className={`column board-column status-${s}`}
                        key={s}
                      >
                        <header className="board-column-heading">
                          <div>
                            <h3>
                              <span className="status-dot" aria-hidden="true" />
                              {statusLabel[s]}
                              <b>{tasks.length}</b>
                            </h3>
                            <p>{stageHelp[s]}</p>
                          </div>
                        </header>
                        <div className="board-column-body">
                          {tasks.map((t) => (
                            <TaskCard task={t} ctx={ctx} key={t.id} />
                          ))}
                          {!tasks.length && (
                            <div className="board-column-empty">
                              <span aria-hidden="true">—</span>
                              <p>ยังไม่มีงานในสถานะนี้</p>
                            </div>
                          )}
                        </div>
                      </section>
                    );
                  })}
              </div>
            </>
          )}
          {attention.length > 0 && (
            <section className="board-attention">
              <div className="board-attention-heading">
                <h3>
                  งานที่ต้องติดตาม <span>{attention.length}</span>
                </h3>
                <p>ตรวจสาเหตุและดำเนินการต่อจากรายละเอียดงาน</p>
              </div>
              <div className="board-attention-cards">
                {attention.map((t) => (
                  <TaskCard task={t} ctx={ctx} key={t.id} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
