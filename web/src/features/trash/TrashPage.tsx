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
export function TrashPage({ ctx }: { ctx: OfficeController }) {
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
      {page === "trash" && (
        <>
          <section className="panel">
            <h2>Workspace ที่ลบ</h2>
            {spaceTrash.map((w) => (
              <div className="list-row" key={w.id}>
                <b>{w.name}</b>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api(`/workspaces/${w.id}/restore`, {});
                      await after();
                    })
                  }
                >
                  กู้คืน Workspace
                </button>
              </div>
            ))}
            {!spaceTrash.length && (
              <p className="muted">ไม่มี Workspace ในถังขยะ</p>
            )}
          </section>
          {wid &&
            ["tasks", "knowledge", "agents"].map((kind) => (
              <section className="panel" key={kind}>
                <h3>
                  {
                    (
                      {
                        tasks: "งาน",
                        knowledge: "ความรู้",
                        agents: "Agent",
                      } as Record<string, string>
                    )[kind]
                  }
                  ที่ลบใน Workspace นี้
                </h3>
                {(trash[kind] ?? []).map((v) => (
                  <div className="list-row" key={v.id}>
                    <b>{v.title ?? v.name}</b>
                    {canWrite && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/workspaces/${wid}/${kind}/${v.id}/restore`,
                              {},
                            );
                            await after();
                          })
                        }
                      >
                        กู้คืน
                      </button>
                    )}
                  </div>
                ))}
                {!trash[kind]?.length && <p className="muted">ไม่มีรายการ</p>}
              </section>
            ))}
        </>
      )}
    </>
  );
}
