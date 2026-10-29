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
export function TeamPage({ ctx }: { ctx: OfficeController }) {
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
      {page === "team" && data && (
        <>
          <div className="section-toolbar">
            <input
              aria-label="ค้นหา Agent"
              placeholder="ค้นหา Agent…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {canWrite && (
              <button
                className="primary"
                onClick={() => setModal({ kind: "agent" })}
              >
                ＋ เพิ่ม Agent
              </button>
            )}
          </div>
          <div className="team-grid">
            {data.agents
              .filter((a) =>
                (a.name + a.role).toLowerCase().includes(query.toLowerCase()),
              )
              .map((a, i) => (
                <article key={a.id}>
                  <div className={"pixel-avatar a" + (i % 3)}>♟</div>
                  <span className="eyebrow">{a.provider.toUpperCase()}</span>
                  <h2>{a.name}</h2>
                  <p>{a.role}</p>
                  <span className="tag">
                    {!a.enabled
                      ? "ปิดใช้งาน"
                      : data.tasks.some(
                            (t) =>
                              t.agent_id === a.id && t.status === "running",
                          )
                        ? "กำลังทำงาน"
                        : "ว่าง"}
                  </span>
                  <p className="agent-instructions">
                    {a.instructions || "ยังไม่มีคำสั่งประจำตัว"}
                  </p>
                  <small>
                    ตำแหน่ง ({a.x}, {a.y})
                  </small>
                  {canWrite && (
                    <div className="actions">
                      <button
                        onClick={() => setModal({ kind: "agent", value: a })}
                      >
                        แก้ไข
                      </button>
                      <button
                        onClick={() =>
                          setModal({
                            kind: "delete",
                            value: { kind: "agents", item: a },
                          })
                        }
                      >
                        ลบ
                      </button>
                    </div>
                  )}
                </article>
              ))}
          </div>
          {!data.agents.length && (
            <div className="empty big">
              <h3>สร้างทีมในแบบของคุณ</h3>
              <p>
                ไม่มีตัวละครตัวอย่าง เพิ่ม Agent เพื่อกำหนดชื่อ บทบาท
                และคำสั่งเอง
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}
