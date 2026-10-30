import React, { useState } from "react";
import { RoomPanel } from "./RoomPanel";
import { RoomEngine } from "./domain/RoomEngine";
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
export function OfficePage({ ctx }: { ctx: OfficeController }) {
  const [editTab, setEditTab] = useState("furniture");
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
    rooms,
    setRooms,
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
      {page === "office" && data && (
        <>
          <div className="office-bar">
            <div>
              <span className="live-dot" />
              <b>{data.name}</b>
              <span className="muted">20 × 12 tiles</span>
            </div>
            <div>
              {!edit && canManage && (
                <details className="workspace-menu">
                  <summary>จัดการพื้นที่</summary>
                  <div className="workspace-menu-items">
                    <button
                      disabled={busy}
                      onClick={() =>
                        setModal({ kind: "workspace", value: data })
                      }
                    >
                      แก้ไขชื่อ
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        setModal({
                          kind: "delete",
                          value: { kind: "workspace", item: data },
                        })
                      }
                    >
                      ลบ Workspace
                    </button>
                  </div>
                </details>
              )}
              {edit ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setItems(data.layout.items);
                      setRooms(data.layout.rooms ?? []);
                      setEdit(false);
                    }}
                  >
                    ยกเลิก
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const err = new RoomEngine(rooms).validate(items);
                        if (err) throw new Error(err);
                        await api(
                          `/workspaces/${wid}/layout`,
                          {
                            version: data.layout_version,
                            layout: { items, rooms },
                          },
                          "PUT",
                        );
                        setEdit(false);
                        const d = await api<Snapshot>("/workspaces/" + wid);
                        setData(d);
                        setItems(d.layout.items);
                        setRooms(d.layout.rooms ?? []);
                        setMessage("บันทึกออฟฟิศแล้ว");
                      })
                    }
                  >
                    บันทึกออฟฟิศ
                  </button>
                </>
              ) : (
                canWrite && (
                  <button className="primary" onClick={() => setEdit(true)}>
                    ✎ จัดห้อง
                  </button>
                )
              )}
            </div>
          </div>
          {edit && (
            <div
              role="tablist"
              aria-label="เครื่องมือจัดออฟฟิศ"
              className="office-edit-tabs"
            >
              <button
                role="tab"
                aria-selected={editTab === "furniture"}
                onClick={() => setEditTab("furniture")}
              >
                เฟอร์นิเจอร์
              </button>
              <button
                role="tab"
                aria-selected={editTab === "rooms"}
                onClick={() => setEditTab("rooms")}
              >
                ห้องและฝ่าย
              </button>
            </div>
          )}
          {edit && editTab === "rooms" && (
            <RoomPanel
              key={wid}
              rooms={rooms}
              items={items}
              agents={data.agents}
              edit={true}
              onChange={setRooms}
            />
          )}
          <div className="office-stage">
            <div className="scene-label">
              YOUR OFFICE · {edit ? "EDIT MODE" : "LIVE DATA"}
            </div>
            <Office
              key={wid}
              rooms={rooms}
              items={items}
              edit={edit && editTab === "furniture"}
              tool={tool}
              onChange={setItems}
              agents={data.agents}
              tasks={data.tasks}
              onAgentMove={
                canWrite && !edit && !busy
                  ? (agent, room) => {
                      run(async () => {
                        await api(
                          `/workspaces/${wid}/agents/${agent.id}`,
                          {
                            ...agent,
                            office_placement: room ? "room" : "common",
                            office_room_id: room?.id ?? null,
                          },
                          "PUT",
                        );
                        await refresh();
                        setMessage(
                          `ย้าย ${agent.name} ไป${room?.name ?? "พื้นที่ส่วนกลาง"}แล้ว`,
                        );
                      });
                    }
                  : undefined
              }
              onAgent={(a) => {
                if (edit) return;
                setPage("team");
                setQuery(a.name);
              }}
              onOpen={(kind) =>
                !edit &&
                setPage(
                  kind === "bookshelf"
                    ? "knowledge"
                    : kind === "board"
                      ? "tasks"
                      : "team",
                )
              }
            />
          </div>
          {edit && editTab === "furniture" && (
            <div className="catalog">
              <b>FURNITURE</b>
              {furniture.map(([k, n]) => (
                <button
                  key={k}
                  className={tool === k ? "chosen" : ""}
                  onClick={() => setTool(k)}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {!edit && (
            <RoomPanel
              rooms={rooms}
              items={items}
              agents={data.agents}
              edit={false}
              onChange={setRooms}
            />
          )}
          <div className="office-footer">
            <span>☀ Your space, your pace.</span>
            <span>
              {data.agents.filter((a) => a.enabled).length} Agents ·{" "}
              {data.tasks.filter((t) => t.status === "running").length}{" "}
              กำลังทำงาน
            </span>
          </div>
          <div className="summary-grid">
            <section>
              <span className="eyebrow">ON YOUR DESK</span>
              <h3>
                {data.tasks.length} <small>งานทั้งหมด</small>
              </h3>
              <button className="text-button" onClick={() => setPage("tasks")}>
                เปิดกระดานงาน ↗
              </button>
            </section>
            <section>
              <span className="eyebrow">OFFICE LIBRARY</span>
              <h3>
                {data.knowledge.filter((k) => k.verified).length}{" "}
                <small>ความรู้ที่ตรวจแล้ว</small>
              </h3>
              <button
                className="text-button"
                onClick={() => setPage("knowledge")}
              >
                เปิดคลังความรู้ ↗
              </button>
            </section>
            <section>
              <span className="eyebrow">YOUR TEAM</span>
              <h3>
                {data.agents.filter((a) => a.enabled).length}{" "}
                <small>Agent พร้อมทำงาน</small>
              </h3>
              <button className="text-button" onClick={() => setPage("team")}>
                จัดการทีม ↗
              </button>
            </section>
          </div>
        </>
      )}
    </>
  );
}
