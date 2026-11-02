import { TaskFiles } from "./TaskFiles";
import { TaskHistory } from "./TaskHistory";
import { TaskUsage } from "./TaskUsage";
import { TaskQuota } from "../personnel/TaskQuota";
import { TaskExecutionContext } from "./TaskExecutionContext";
import { TaskAttachments } from "./TaskAttachments";
import React, { useEffect, useRef, useState } from "react";
import { FormTabs } from "../../shared/FormTabs";
import type {
  Furniture,
  Agent,
  Task,
  Note,
  Workspace,
  Snapshot,
  User,
  Detail,
  ProviderLogin,
  Connections,
  Modal,
} from "../../shared/types";
import { api } from "../../shared/api";
import { Field, Area } from "../../shared/Fields";
import { furniture, statusLabel } from "../../shared/constants";
import { Office } from "../office/Office";
import type { OfficeController } from "../../application/useOfficeController";
export function TaskDetail({ ctx }: { ctx: OfficeController }) {
  const {
    user,
    setUser,
    loading,
    setLoading,
    error,
    setError,
    busy,
    setBusy,
    message,
    setMessage,
    spaces,
    setSpaces,
    wid,
    setWid,
    data,
    setData,
    page,
    setPage,
    edit,
    setEdit,
    items,
    setItems,
    tool,
    setTool,
    query,
    setQuery,
    modal,
    setModal,
    detail,
    setDetail,
    connections,
    setConnections,
    users,
    setUsers,
    members,
    setMembers,
    trash,
    setTrash,
    spaceTrash,
    setSpaceTrash,
    loginCodes,
    setLoginCodes,
    active,
    role,
    canWrite,
    canManage,
    dirty,
    fixture,
    online,
    connected,
    run,
    loadSpaces,
    refresh,
    extras,
    after,
    remove,
    start,
    showTask,
  } = ctx;
  const [taskTab, setTaskTab] = useState("brief");
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [taskTab, detail?.task.id]);
  useEffect(() => {
    setTaskTab(detail?.task.status === "review" ? "result" : "brief");
  }, [detail?.task.id]);
  const resultPreview = Array.from(
    (detail?.task.result || "")
      .split(/\n\s*\n/)
      .slice(0, 2)
      .join("\n\n"),
  )
    .slice(0, 600)
    .join("");
  if (!user) return null;
  const canReview =
    !!detail &&
    detail.task.status === "review" &&
    !detail.task.review_for_task_id &&
    canWrite &&
    (!detail.task.reviewer_id ||
      detail.task.reviewer_id === user.id ||
      canManage);
  return (
    <>
      {detail && (
        <div className="overlay">
          <section
            className="modal task-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-modal-title"
          >
            <header className="task-modal-header">
              <button
                className="close"
                aria-label="ปิดรายละเอียดงาน"
                disabled={busy}
                onClick={() => setDetail(null)}
              >
                ×
              </button>
              <span className="eyebrow">TASK DETAILS</span>
              <h2 id="task-modal-title">{detail.task.title}</h2>
              <span className="tag">
                {statusLabel[detail.task.status]} · {detail.task.provider} ·
                ครั้งที่ {detail.task.attempts}/3
              </span>
              <FormTabs
                label="รายละเอียดงาน"
                value={taskTab}
                onChange={setTaskTab}
                tabs={[
                  { id: "brief", label: "โจทย์และ Skill" },
                  { id: "result", label: "ผลงานและตรวจรับ" },
                  { id: "files", label: "ไฟล์ผลงาน" },
                  { id: "history", label: "ประวัติและบันทึก" },
                  { id: "usage", label: "การใช้ Token" },
                ]}
              />
            </header>
            <div
              className="task-modal-body"
              ref={bodyRef}
              role="region"
              aria-label="เนื้อหางาน"
              tabIndex={0}
            >
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div
                hidden={taskTab !== "usage"}
                role="tabpanel"
                aria-label="การใช้ Token"
              >
                <TaskUsage detail={detail} ctx={ctx} />
              </div>
              <div
                role="tabpanel"
                aria-label="โจทย์และ Skill"
                hidden={taskTab !== "brief"}
              >
                <p className="preserve">{detail.task.description}</p>
                {detail.task.acceptance_criteria && (
                  <p className="preserve">
                    เกณฑ์ตรวจรับ: {detail.task.acceptance_criteria}
                  </p>
                )}
                <TaskQuota ctx={ctx} />
                <TaskExecutionContext ctx={ctx} />
                <TaskAttachments ctx={ctx} />
                {detail.task.error && (
                  <p className="error">{detail.task.error}</p>
                )}
              </div>
              <div
                role="tabpanel"
                aria-label="ผลงานและตรวจรับ"
                hidden={taskTab !== "result"}
              >
                {detail.task.result && (
                  <>
                    <h3>ข้อความช่วงต้นจาก Agent · รอบล่าสุด</h3>
                    <pre className="result task-result-preview">
                      {resultPreview}
                    </pre>
                    {(detail.task.result_truncated ||
                      resultPreview !== detail.task.result) && (
                      <button onClick={() => setTaskTab("history")}>
                        อ่านข้อความทั้งหมดในบันทึก
                      </button>
                    )}
                    <button onClick={() => setTaskTab("files")}>
                      เปิดรายการไฟล์ผลงาน
                    </button>
                    <p className="hint">
                      เมื่อตรวจรับ ระบบจะบันทึก Knowledge
                      ที่ตรวจสอบแล้วให้โดยอัตโนมัติ และเก็บประวัติก่อนอัปเดต
                    </p>
                  </>
                )}
                {detail.task.review_mode !== "owner" &&
                  detail.task.review_mode && (
                    <div className="review-box">
                      <b>
                        {detail.task.review_state === "needs_owner"
                          ? "ต้องให้เจ้าของตัดสินใจ"
                          : detail.task.review_state === "passed"
                            ? "หัวหน้าตรวจผ่านแล้ว"
                            : "ส่งให้ Agent ตรวจตาม Workflow"}
                      </b>
                      <p>
                        ผู้ตรวจ:{" "}
                        {data?.agents.find(
                          (a) => a.id === detail.task.review_agent_id,
                        )?.name || "เจ้าของรับช่วง"}
                      </p>
                      <p>{detail.task.review_note}</p>
                      {data?.tasks
                        .filter((t) => t.review_for_task_id === detail.task.id)
                        .map((t) => (
                          <button
                            key={t.id}
                            onClick={() => run(() => showTask(t))}
                          >
                            เปิดงานตรวจ · {statusLabel[t.status]}
                          </button>
                        ))}
                      {detail.task.review_state !== "needs_owner" &&
                        detail.task.status === "review" && (
                          <small>
                            ระบบจะส่งต่อเมื่อหัวหน้าตรวจผ่าน
                            คุณยังตรวจแทนได้หากจำเป็น
                          </small>
                        )}
                    </div>
                  )}
                {canReview && (
                  <form
                    id="task-review-form"
                    className="review-box"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const submitter = (e.nativeEvent as SubmitEvent)
                        .submitter as HTMLButtonElement;
                      const accept = submitter.value === "accept";
                      const feedback = String(
                        new FormData(e.currentTarget).get("feedback") ?? "",
                      );
                      run(async () => {
                        const result = await api<{
                          knowledge?: { action: string };
                        }>(
                          `/workspaces/${wid}/tasks/${detail.task.id}/review`,
                          { accept, feedback },
                        );
                        await after();
                        if (accept)
                          setMessage(
                            result.knowledge?.action === "updated"
                              ? "ตรวจรับแล้ว · อัปเดต Knowledge และเก็บประวัติเดิมแล้ว"
                              : result.knowledge?.action === "unchanged"
                                ? "ตรวจรับแล้ว · Knowledge เป็นข้อมูลล่าสุดแล้ว"
                                : "ตรวจรับแล้ว · สร้าง Knowledge ให้เรียบร้อยแล้ว",
                          );
                      });
                    }}
                  >
                    <Area
                      label="ความคิดเห็น / สิ่งที่ต้องแก้"
                      name="feedback"
                    />
                    <small>งานที่ส่งแก้ต้องกดเริ่มใหม่ ไม่รันวนอัตโนมัติ</small>
                  </form>
                )}
              </div>
              <div
                role="tabpanel"
                aria-label="ไฟล์ผลงาน"
                hidden={taskTab !== "files"}
              >
                {taskTab === "files" && (
                  <TaskFiles key={detail.task.id} detail={detail} wid={wid!} />
                )}
              </div>
              <div
                role="tabpanel"
                aria-label="ประวัติและบันทึก"
                hidden={taskTab !== "history"}
              >
                {taskTab === "history" && (
                  <TaskHistory
                    key={detail.task.id}
                    detail={detail}
                    wid={wid!}
                  />
                )}
              </div>
            </div>
            <footer
              className="task-modal-footer"
              aria-label="การดำเนินการของงาน"
            >
              <div className="actions">
                {canWrite &&
                  !detail.task.workflow_step &&
                  !detail.task.review_for_task_id &&
                  detail.task.status !== "running" && (
                    <button
                      onClick={() => {
                        setModal({ kind: "task", value: detail.task });
                        setDetail(null);
                      }}
                    >
                      แก้ไข
                    </button>
                  )}
                {canWrite &&
                  detail.task.created_by === user.id &&
                  [
                    "queued",
                    "failed",
                    "cancelled",
                    "waiting_auth",
                    "waiting_quota",
                    "interrupted",
                  ].includes(detail.task.status) && (
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        detail.task.execution_requested ||
                        detail.task.attempts >= 3
                      }
                      onClick={() => run(() => start(detail.task))}
                    >
                      เริ่ม / ลองใหม่
                    </button>
                  )}
                {canWrite &&
                  [
                    "queued",
                    "running",
                    "waiting_auth",
                    "waiting_quota",
                    "interrupted",
                  ].includes(detail.task.status) && (
                    <button
                      disabled={busy || detail.task.cancel_requested}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/workspaces/${wid}/tasks/${detail.task.id}/cancel`,
                            {},
                          );
                          await after();
                        })
                      }
                    >
                      {detail.task.cancel_requested
                        ? "กำลังยกเลิก…"
                        : "ยกเลิกงาน"}
                    </button>
                  )}
                {canWrite && detail.task.status !== "running" && (
                  <button
                    onClick={() =>
                      setModal({
                        kind: "delete",
                        value: { kind: "tasks", item: detail.task },
                      })
                    }
                  >
                    ลบงาน
                  </button>
                )}
              </div>
              <div className="task-footer-primary">
                {detail.task.status === "done" &&
                  !detail.task.review_for_task_id &&
                  canWrite && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const saved = await api<{ action: string }>(
                            `/workspaces/${wid}/tasks/${detail.task.id}/knowledge`,
                            {},
                          );
                          await after();
                          setMessage(
                            saved.action === "unchanged"
                              ? "Knowledge เป็นข้อมูลล่าสุดแล้ว"
                              : "บันทึก Knowledge จากงานที่ตรวจรับแล้ว",
                          );
                        })
                      }
                    >
                      ซิงก์ Knowledge จากงานนี้
                    </button>
                  )}
                {canReview && (
                  <div className="actions">
                    <button
                      type="submit"
                      form="task-review-form"
                      className="primary"
                      value="accept"
                      disabled={busy}
                    >
                      ตรวจรับและบันทึก Knowledge
                    </button>
                    <button
                      type="submit"
                      form="task-review-form"
                      value="revise"
                      disabled={busy || detail.task.attempts >= 3}
                    >
                      ส่งกลับแก้ไข
                    </button>
                  </div>
                )}
                <button disabled={busy} onClick={() => setDetail(null)}>
                  ปิด
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
