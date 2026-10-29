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
export function TasksPage({ ctx }: { ctx: OfficeController }) {
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
      {page === "tasks" && data && (
        <>
          <div className="section-toolbar">
            <input
              aria-label="ค้นหางาน"
              placeholder="ค้นหางาน…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button disabled={busy} onClick={() => run(refresh)}>
              รีเฟรช
            </button>
          </div>
          <div className="board">
            {["queued", "running", "review", "done"].map((s) => (
              <section className="column" key={s}>
                <h3>
                  {statusLabel[s]}
                  <small>
                    {data.tasks.filter((t) => t.status === s).length}
                  </small>
                </h3>
                {data.tasks
                  .filter(
                    (t) =>
                      t.status === s &&
                      (t.title + t.description)
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                  )
                  .map((t) => (
                    <article className="task-card" key={t.id}>
                      <span className="tag">{t.provider.toUpperCase()}</span>
                      <h4>
                        <button
                          className="text-button task-title"
                          onClick={() => run(() => showTask(t))}
                        >
                          {t.title}
                        </button>
                      </h4>
                      <p>{t.description}</p>
                      <small>
                        {t.execution_requested
                          ? "ส่งคำขอแล้ว · รอ Worker"
                          : statusLabel[t.status]}
                      </small>
                      <div className="actions">
                        <button onClick={() => run(() => showTask(t))}>
                          รายละเอียด
                        </button>
                        {s !== "running" && canWrite && (
                          <button
                            onClick={() => setModal({ kind: "task", value: t })}
                          >
                            แก้ไข
                          </button>
                        )}
                        {s === "queued" &&
                          canWrite &&
                          t.created_by === user.id && (
                            <button
                              className="primary"
                              disabled={busy || t.execution_requested}
                              onClick={() => run(() => start(t))}
                            >
                              เริ่มงาน
                            </button>
                          )}
                      </div>
                    </article>
                  ))}
                {!data.tasks.some((t) => t.status === s) && (
                  <p className="empty">ยังไม่มีงาน</p>
                )}
              </section>
            ))}
          </div>
          <section className="panel secondary-tasks">
            <h3>งานที่ต้องติดตาม</h3>
            {data.tasks
              .filter(
                (t) =>
                  !["queued", "running", "review", "done"].includes(t.status),
              )
              .map((t) => (
                <div className="list-row" key={t.id}>
                  <div>
                    <b>{t.title}</b>
                    <small>
                      {statusLabel[t.status]} · {t.error}
                    </small>
                  </div>
                  <button onClick={() => run(() => showTask(t))}>
                    เปิดงาน
                  </button>
                </div>
              ))}
            {!data.tasks.some(
              (t) =>
                !["queued", "running", "review", "done"].includes(t.status),
            ) && <p className="muted">ยังไม่มีงานที่ต้องติดตาม</p>}
          </section>
        </>
      )}
    </>
  );
}
