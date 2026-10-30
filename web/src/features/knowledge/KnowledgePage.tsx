import { KnowledgeSearch } from "./KnowledgeSearch";
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
export function KnowledgePage({ ctx }: { ctx: OfficeController }) {
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
      {page === "knowledge" && data && (
        <>
          <KnowledgeSearch ctx={ctx} />
          <div className="section-toolbar">
            <input
              aria-label="ค้นหาความรู้"
              placeholder="กรองรายการใน Workspace นี้…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {canWrite && (
              <button
                className="primary"
                onClick={() => setModal({ kind: "knowledge" })}
              >
                ＋ เพิ่มความรู้
              </button>
            )}
          </div>
          <div className="notes">
            {data.knowledge
              .filter((k) =>
                (k.title + k.content + k.source)
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((k) => (
                <article key={k.id}>
                  <span className="tag">
                    {k.verified ? "ตรวจสอบแล้ว · แนบให้ AI ได้" : "รอตรวจสอบ"}
                  </span>
                  <h3>{k.title}</h3>
                  <p>{k.content}</p>
                  <small>แหล่งที่มา: {k.source || "ผู้ใช้บันทึก"}</small>
                  {k.verified && (
                    <details>
                      <summary>อ้างอิงเป็นเอกสารบังคับในงาน</summary>
                      <code
                        style={{ overflowWrap: "anywhere" }}
                      >{`[[knowledge:${k.id}]]`}</code>
                      <p>
                        คัดลอกข้อความนี้ลงรายละเอียดงานเพื่อเลือกเอกสารนี้ในโหมดทดลอง
                      </p>
                    </details>
                  )}
                  {canWrite && (
                    <div className="actions">
                      <button
                        onClick={() =>
                          setModal({ kind: "knowledge", value: k })
                        }
                      >
                        แก้ไข
                      </button>
                      <button
                        onClick={() =>
                          setModal({
                            kind: "delete",
                            value: { kind: "knowledge", item: k },
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
          {!data.knowledge.length && (
            <div className="empty big">
              <h3>ยังไม่มีความรู้</h3>
              <p>เพิ่มความรู้ของคุณเอง และตรวจสอบก่อนให้ AI นำไปใช้</p>
            </div>
          )}
        </>
      )}
    </>
  );
}
