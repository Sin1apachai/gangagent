import { AgentPersonality } from "../personnel/AgentPersonality";
import React, { useEffect, useState } from "react";
import type { OfficeController } from "../../application/useOfficeController";
import type { Reviewer } from "../organization/types";
import { api } from "../../shared/api";
export function TaskExecutionContext({ ctx }: { ctx: OfficeController }) {
  const task = ctx.detail?.task;
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  useEffect(() => {
    let live = true;
    if (ctx.wid && task)
      api<Reviewer[]>(`/workspaces/${ctx.wid}/reviewers`)
        .then((rows) => {
          if (live) setReviewers(rows);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [ctx.wid, task?.id]);
  if (!task) return null;
  const frozen = task.execution_context;
  return (
    <section className="execution-context">
      <h3>บทบาทและข้อตกลงของงาน</h3>
      {frozen ? (
        <>
          <p>
            Agent: <b>{frozen.agent?.name || "ไม่ได้มอบหมาย"}</b> ·{" "}
            {frozen.agent?.role || "งานอิสระ"}
          </p>
          {frozen.agent?.responsibilities && (
            <p>รับผิดชอบ: {frozen.agent.responsibilities}</p>
          )}
          {frozen.agent?.decision_scope && (
            <p>ขอบเขตตัดสินใจ: {frozen.agent.decision_scope}</p>
          )}
          {frozen.agent?.personality && (
            <AgentPersonality agent={frozen.agent} />
          )}
          <div>
            {frozen.skills.map((s, i) => (
              <details key={i}>
                <summary>
                  ✦ {s.title} · v{s.version + 1}
                </summary>
                <pre>{s.instructions}</pre>
                <p>รับเข้า: {s.input_contract || "—"}</p>
                <p>ส่งมอบ: {s.output_contract || "—"}</p>
                <p>ตรวจรับ: {s.acceptance_criteria || "—"}</p>
              </details>
            ))}
          </div>
          <small>สำเนาที่ใช้ตอนเริ่มงาน · คงเดิมเมื่อส่งกลับแก้ไข</small>
        </>
      ) : (
        <p>ระบบจะเก็บบทบาทและ Skill ตอนกดเริ่มงานครั้งแรก</p>
      )}
      {task.workflow_step && (
        <>
          <p>รับเข้า: {task.workflow_step.input_contract || "—"}</p>
          <p>ส่งมอบ: {task.workflow_step.output_contract || "—"}</p>
          <p>
            ไฟล์บังคับ: {task.workflow_step.required_files?.join(", ") || "—"}
          </p>
          <small>งานจากแผนเก็บข้อตกลงตอนอนุมัติไว้แล้ว</small>
        </>
      )}
      <p>
        ผู้ตรวจรับ:{" "}
        <b>
          {task.reviewer_id
            ? reviewers.find((r) => r.id === task.reviewer_id)?.name ||
              "บัญชีที่ได้รับมอบหมาย / ไม่อยู่ในทีมแล้ว"
            : "สมาชิกที่มีสิทธิ์เขียน"}
        </b>
      </p>
      {ctx.canManage && task.status !== "done" && (
        <label>
          เปลี่ยนผู้ตรวจรับ
          <select
            aria-label="เปลี่ยนผู้ตรวจรับ"
            disabled={ctx.busy}
            value={task.reviewer_id || ""}
            onChange={(e) => {
              const reviewer_id = e.target.value || null;
              ctx.run(async () => {
                await api(
                  `/workspaces/${ctx.wid}/tasks/${task.id}/reviewer`,
                  { version: task.version, reviewer_id },
                  "PUT",
                );
                await ctx.after();
              });
            }}
          >
            <option value="">สมาชิกที่มีสิทธิ์เขียน</option>
            {task.reviewer_id &&
              !reviewers.some((r) => r.id === task.reviewer_id) && (
                <option value={task.reviewer_id}>บัญชีเดิมไม่อยู่ในทีม</option>
              )}
            {reviewers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <small>
        เจ้าของ Workspace และ Super Admin ตรวจรับแทนได้ โดยมีบันทึกประวัติ
      </small>
    </section>
  );
}
