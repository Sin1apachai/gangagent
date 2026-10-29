import { TaskAttachments } from "./TaskAttachments";
import React from "react";
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
  if (!user) return null;
  return (
    <>
      {detail && (
        <div className="overlay">
          <section className="modal task-detail">
            <button
              className="close"
              disabled={busy}
              onClick={() => setDetail(null)}
            >
              ×
            </button>
            <span className="eyebrow">TASK DETAILS</span>
            <h2>{detail.task.title}</h2>
            <span className="tag">
              {statusLabel[detail.task.status]} · {detail.task.provider} ·
              ครั้งที่ {detail.task.attempts}/3
            </span>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <p className="preserve">{detail.task.description}</p>
            {detail.task.acceptance_criteria && (
              <p className="preserve">
                เกณฑ์ตรวจรับ: {detail.task.acceptance_criteria}
              </p>
            )}
            <TaskAttachments ctx={ctx} />
            {detail.task.error && <p className="error">{detail.task.error}</p>}
            <div className="actions">
              {canWrite && detail.task.status !== "running" && (
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
            {detail.task.result && (
              <>
                <h3>ผลงานล่าสุด</h3>
                <pre className="result">{detail.task.result}</pre>
                <button
                  disabled={!canWrite}
                  onClick={() => {
                    setModal({
                      kind: "knowledge",
                      value: {
                        title: "บทเรียน: " + detail.task.title,
                        content: detail.task.result,
                        source: "งาน " + detail.task.id,
                      },
                    });
                    setDetail(null);
                  }}
                >
                  บันทึกเป็นความรู้เพื่อตรวจสอบ
                </button>
              </>
            )}
            {detail.artifacts.some((f) => f.run_id === detail.runs[0]?.id) && (
              <>
                <h3>ไฟล์ผลงานล่าสุด</h3>
                {detail.artifacts
                  .filter((f) => f.run_id === detail.runs[0]?.id)
                  .map((f) => (
                    <a
                      className="artifact-link"
                      key={f.id}
                      href={`/api/workspaces/${wid}/tasks/${detail.task.id}/artifacts/${f.id}`}
                      download
                    >
                      {f.name} · {(f.size / 1024).toFixed(1)} KB ↓
                    </a>
                  ))}
              </>
            )}
            {detail.task.status === "review" && canWrite && (
              <form
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
                    await api(
                      `/workspaces/${wid}/tasks/${detail.task.id}/review`,
                      { accept, feedback },
                    );
                    await after();
                  });
                }}
              >
                <Area label="ความคิดเห็น / สิ่งที่ต้องแก้" name="feedback" />
                <div className="actions">
                  <button className="primary" value="accept" disabled={busy}>
                    ตรวจรับงาน
                  </button>
                  <button
                    value="revise"
                    disabled={busy || detail.task.attempts >= 3}
                  >
                    ส่งกลับแก้ไข
                  </button>
                </div>
                <small>งานที่ส่งแก้ต้องกดเริ่มใหม่ ไม่รันวนอัตโนมัติ</small>
              </form>
            )}
            <h3>ประวัติการทำงาน</h3>
            {detail.events.map((e) => (
              <p className="event" key={e.id}>
                <small>{new Date(e.created_at).toLocaleString("th-TH")}</small>{" "}
                {e.message}
              </p>
            ))}
            {detail.runs.map((r) => (
              <details key={r.id}>
                <summary>
                  {statusLabel[r.status] ?? r.status} ·{" "}
                  {new Date(r.started_at).toLocaleString("th-TH")}
                </summary>
                <pre className="result">
                  {r.result || r.error || "กำลังทำงาน"}
                </pre>
                {detail.artifacts
                  .filter((f) => f.run_id === r.id)
                  .map((f) => (
                    <a
                      className="artifact-link"
                      key={f.id}
                      href={`/api/workspaces/${wid}/tasks/${detail.task.id}/artifacts/${f.id}`}
                      download
                    >
                      {f.name} · {(f.size / 1024).toFixed(1)} KB ↓
                    </a>
                  ))}
              </details>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
