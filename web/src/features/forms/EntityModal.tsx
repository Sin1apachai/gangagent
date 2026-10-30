import { AgentRoomPicker } from "../office/AgentRoomPicker";
import { AgentPersonality } from "../personnel/AgentPersonality";
import React, { useState, useEffect } from "react";
import { FormTabs } from "../../shared/FormTabs";
import { CharacterPicker } from "../office/CharacterPicker";
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
export function EntityModal({ ctx }: { ctx: OfficeController }) {
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
  const [projects, setProjects] = React.useState<
    { id: string; name: string; deleted_at: string | null }[]
  >([]);
  React.useEffect(() => {
    if (wid)
      api<any[]>(`/workspaces/${wid}/projects`)
        .then(setProjects)
        .catch(() => {});
  }, [wid, modal?.kind]);
  const [agentTab, setAgentTab] = useState("profile"),
    [character, setCharacter] = useState(0),
    [birthDate, setBirthDate] = useState("");
  useEffect(() => {
    setAgentTab("profile");
    setCharacter(modal?.value?.character_id ?? 0);
    setBirthDate(modal?.value?.birth_date ?? "");
  }, [modal?.kind, modal?.value?.id]);
  if (!user) return null;
  return (
    <>
      {modal && (
        <div className="overlay">
          <form
            onInvalidCapture={(e) => {
              if (modal?.kind === "agent") {
                const target = e.target as HTMLInputElement;
                const name = target.name;
                setAgentTab(
                  name === "birth_date"
                    ? "personality"
                    : ["agent_room", "instructions"].includes(name)
                      ? "instructions"
                      : "profile",
                );
                requestAnimationFrame(() => target.focus());
              }
            }}
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget));
              const m = modal;
              const v = m.value;
              run(async () => {
                let endpoint = "",
                  body: any = { ...f },
                  method = "POST";
                if (m.kind === "delete") {
                  await remove(v.kind, v.item);
                  return;
                }
                if (m.kind === "remove-member") {
                  await api(
                    `/workspaces/${wid}/members/${v.id}`,
                    undefined,
                    "DELETE",
                  );
                  setModal(null);
                  await extras();
                  return;
                }
                if (m.kind === "workspace") {
                  endpoint = "/workspaces" + (v?.id ? "/" + v.id : "");
                  if (v?.id) {
                    method = "PUT";
                    body.version = v.version;
                  }
                }
                if (m.kind === "task") {
                  endpoint =
                    `/workspaces/${wid}/tasks` + (v?.id ? "/" + v.id : "");
                  body.agent_id = f.agent_id || null;
                  body.project_id = f.project_id || null;
                  if (v?.id) {
                    method = "PUT";
                    body.version = v.version;
                  }
                }
                if (m.kind === "knowledge") {
                  endpoint =
                    `/workspaces/${wid}/knowledge` + (v?.id ? "/" + v.id : "");
                  body.verified = f.verified === "on";
                  if (v?.id) {
                    method = "PUT";
                    body.version = v.version;
                  }
                }
                if (m.kind === "agent") {
                  endpoint =
                    `/workspaces/${wid}/agents` + (v?.id ? "/" + v.id : "");
                  const room = String(f.agent_room ?? "auto");
                  body.office_placement = room.startsWith("room:")
                    ? "room"
                    : room;
                  body.office_room_id = room.startsWith("room:")
                    ? room.slice(5)
                    : null;
                  delete body.agent_room;
                  body.enabled = f.enabled === "on";
                  body.character_id = character;
                  if (v?.id) {
                    method = "PUT";
                    body.version = v.version;
                  }
                }
                if (m.kind === "user") {
                  endpoint = "/admin/users" + (v?.id ? "/" + v.id : "");
                  if (v?.id) method = "PUT";
                }
                if (m.kind === "profile") {
                  endpoint = "/profile";
                  method = "PUT";
                }
                if (m.kind === "member")
                  endpoint = `/workspaces/${wid}/members`;
                const r: any = await api(endpoint, body, method);
                setModal(null);
                if (m.kind === "profile") {
                  if (body.password) {
                    setUser(null);
                    setWid("");
                    setMessage("เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่");
                    return;
                  }
                  setUser(await api<User>("/auth/me"));
                }
                await after();
                if (m.kind === "workspace" && !v?.id) setWid(r.id);
                setMessage("บันทึกแล้ว");
              });
            }}
          >
            <button
              type="button"
              className="close"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              ×
            </button>
            <span className="eyebrow">YOUR OFFICE, YOUR WAY</span>
            <h2>
              {
                (
                  {
                    workspace: modal.value?.id
                      ? "แก้ไข Workspace"
                      : "สร้าง Workspace",
                    task: modal.value?.id ? "แก้ไขงาน" : "สร้างงาน",
                    knowledge: modal.value?.id
                      ? "แก้ไขความรู้"
                      : "เพิ่มความรู้",
                    agent: modal.value?.id ? "แก้ไข Agent" : "เพิ่ม Agent",
                    user: modal.value?.id ? "แก้ไขผู้ใช้" : "เพิ่มผู้ใช้",
                    profile: "แก้ไขบัญชีของฉัน",
                    member: "เพิ่ม / แก้ไขสิทธิ์สมาชิก",
                    delete: "ย้ายไปถังขยะ",
                    "remove-member": "นำสมาชิกออก",
                  } as Record<string, string>
                )[modal.kind]
              }
            </h2>
            {modal.kind === "delete" ? (
              <p>
                ต้องการลบ{" "}
                <b>{modal.value.item.name ?? modal.value.item.title}</b> ใช่ไหม?
                รายการจะอยู่ในถังขยะและกู้คืนได้
              </p>
            ) : modal.kind === "remove-member" ? (
              <p>
                นำ {modal.value.name} ออกจาก Workspace นี้
                โดยไม่ลบบัญชีผู้ใช้ใช่ไหม?
              </p>
            ) : (
              <>
                {modal.kind === "workspace" && (
                  <Field
                    label="ชื่อ Workspace"
                    name="name"
                    value={modal.value?.name}
                    required
                    maxLength={100}
                  />
                )}
                {modal.kind === "task" && (
                  <>
                    <Field
                      label="ชื่องาน"
                      name="title"
                      value={modal.value?.title}
                      required
                      maxLength={200}
                    />
                    <label>
                      โปรเจกต์
                      <select
                        name="project_id"
                        defaultValue={modal.value?.project_id ?? ""}
                      >
                        <option value="">ไม่ระบุ</option>
                        {projects
                          .filter((p) => !p.deleted_at)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      ความสำคัญ
                      <select
                        name="priority"
                        defaultValue={modal.value?.priority ?? "normal"}
                      >
                        <option value="low">ต่ำ</option>
                        <option value="normal">ปกติ</option>
                        <option value="high">สูง</option>
                        <option value="urgent">ด่วน</option>
                      </select>
                    </label>
                    {!modal.value?.id && (
                      <label>
                        ข้อมูลประกอบงาน
                        <select name="context_format" defaultValue="compact">
                          <option value="compact">เต็มตามเดิม</option>
                          <option value="focused">
                            เลือก Knowledge ตามงาน (ทดลอง)
                          </option>
                        </select>
                        <small>
                          โหมดทดลองเก็บบทบาทและ Skill ครบ
                          เลือกเอกสารที่เกี่ยวข้อง
                          หากข้อมูลไม่พอให้ใช้งานใหม่แบบเต็ม
                          ระบุเอกสารบังคับด้วย [[knowledge:รหัสเอกสาร]]
                          ในรายละเอียดได้
                        </small>
                      </label>
                    )}
                    <Area
                      label="เกณฑ์ตรวจรับ"
                      name="acceptance_criteria"
                      value={modal.value?.acceptance_criteria}
                    />
                    <Area
                      label="รายละเอียดและเกณฑ์ตรวจรับ"
                      name="description"
                      value={modal.value?.description}
                    />
                    <label>
                      เครื่องมือ
                      <select
                        name="provider"
                        defaultValue={modal.value?.provider ?? "codex"}
                      >
                        <option value="codex">Codex</option>
                        <option value="claude">Claude</option>
                      </select>
                    </label>
                    <label>
                      Agent (ต้องใช้เครื่องมือเดียวกับงาน)
                      <select
                        name="agent_id"
                        defaultValue={modal.value?.agent_id ?? ""}
                      >
                        <option value="">ไม่ระบุ</option>
                        {data?.agents
                          .filter((a) => a.enabled)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} · {a.provider}
                            </option>
                          ))}
                      </select>
                    </label>
                    <small>
                      การบันทึกงานยังไม่เริ่มเรียก AI ต้องกดเริ่มงานอีกครั้ง
                    </small>
                  </>
                )}
                {modal.kind === "knowledge" && (
                  <>
                    <Field
                      label="ชื่อความรู้"
                      name="title"
                      value={modal.value?.title}
                      required
                      maxLength={200}
                    />
                    <Area
                      label="เนื้อหา"
                      name="content"
                      value={modal.value?.content}
                      required
                    />
                    <Field
                      label="แหล่งที่มา"
                      name="source"
                      value={modal.value?.source}
                    />
                    <label className="check">
                      <input
                        type="checkbox"
                        name="verified"
                        defaultChecked={modal.value?.verified ?? false}
                      />
                      ฉันตรวจสอบแล้ว อนุญาตให้แนบความรู้นี้กับงาน AI
                    </label>
                  </>
                )}
                {modal.kind === "agent" && (
                  <>
                    {modal.value?.id && canManage && (
                      <div className="actions" style={{ marginBottom: 16 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            const v = modal.value,
                              f = new FormData(e.currentTarget.form!);
                            const originalRoom =
                              v.office_placement === "room"
                                ? "room:" + v.office_room_id
                                : (v.office_placement ?? "auto");
                            const changed =
                              ["name", "role", "instructions", "provider"].some(
                                (k) =>
                                  String(f.get(k) ?? "") !== String(v[k] ?? ""),
                              ) ||
                              (f.get("enabled") === "on") !== v.enabled ||
                              birthDate !== (v.birth_date ?? "") ||
                              character !== (v.character_id ?? 0) ||
                              String(f.get("agent_room") ?? "auto") !==
                                originalRoom;
                            if (changed) {
                              setError(
                                "มีข้อมูล Agent ที่ยังไม่บันทึก กรุณาบันทึกก่อนเปิดฝ่าย หน้าที่ และขอบเขต",
                              );
                              return;
                            }
                            ctx.setOrgAgentId(v.id);
                            setModal(null);
                            setPage("organization");
                          }}
                        >
                          ฝ่าย หน้าที่ และขอบเขต →
                        </button>
                      </div>
                    )}
                    <FormTabs
                      label="ตั้งค่า Agent"
                      value={agentTab}
                      onChange={setAgentTab}
                      tabs={[
                        { id: "profile", label: "ข้อมูลทั่วไป" },
                        { id: "appearance", label: "ตัวละคร" },
                        { id: "personality", label: "วันเกิดและบุคลิก" },
                        { id: "instructions", label: "คำสั่งและห้อง" },
                      ]}
                    />
                    <div
                      role="tabpanel"
                      aria-label="ข้อมูลทั่วไป"
                      hidden={agentTab !== "profile"}
                    >
                      <Field
                        label="ชื่อ Agent"
                        name="name"
                        value={modal.value?.name}
                        required
                        maxLength={100}
                      />
                      <Field
                        label="บทบาท"
                        name="role"
                        value={modal.value?.role}
                        required
                        maxLength={200}
                      />
                      <label>
                        เครื่องมือ
                        <select
                          name="provider"
                          defaultValue={modal.value?.provider ?? "codex"}
                        >
                          <option value="codex">Codex</option>
                          <option value="claude">Claude</option>
                        </select>
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          name="enabled"
                          defaultChecked={modal.value?.enabled ?? true}
                        />
                        เปิดใช้งาน Agent
                      </label>
                    </div>
                    <div
                      role="tabpanel"
                      aria-label="วันเกิดและบุคลิก"
                      hidden={agentTab !== "personality"}
                    >
                      <label>
                        วันเกิด Agent
                        <input
                          name="birth_date"
                          type="date"
                          value={birthDate}
                          onChange={(e) => setBirthDate(e.target.value)}
                        />
                      </label>
                      <div
                        className="actions"
                        style={{ marginTop: 12, marginBottom: 16 }}
                      >
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            const today = new Date();
                            const first =
                              Date.UTC(today.getFullYear() - 60, 0, 1) /
                              86400000;
                            const last =
                              Date.UTC(
                                today.getFullYear() - 18,
                                today.getMonth(),
                                today.getDate(),
                              ) / 86400000;
                            const days = last - first + 1;
                            const limit = Math.floor(4294967296 / days) * days;
                            const value = new Uint32Array(1);
                            let next = "";
                            do {
                              do {
                                crypto.getRandomValues(value);
                              } while (value[0] >= limit);
                              next = new Date(
                                (first + (value[0] % days)) * 86400000,
                              )
                                .toISOString()
                                .slice(0, 10);
                            } while (next === birthDate);
                            setBirthDate(next);
                          }}
                        >
                          🎲 สุ่มวันเกิด
                        </button>
                      </div>
                      {birthDate !== (modal.value?.birth_date ?? "") && (
                        <p role="status" className="form-section-help">
                          เปลี่ยนวันเกิดแล้ว ระบบจะคำนวณบุคลิกใหม่เมื่อกดบันทึก
                        </p>
                      )}
                      <AgentPersonality
                        agent={
                          birthDate === (modal.value?.birth_date ?? "")
                            ? modal.value
                            : undefined
                        }
                      />
                    </div>
                    <div
                      role="tabpanel"
                      aria-label="ตัวละคร"
                      hidden={agentTab !== "appearance"}
                    >
                      <CharacterPicker
                        value={character}
                        onChange={setCharacter}
                      />
                    </div>
                    <div
                      role="tabpanel"
                      aria-label="คำสั่งและห้อง"
                      hidden={agentTab !== "instructions"}
                    >
                      {" "}
                      <Area
                        label="คำสั่งประจำตัว"
                        name="instructions"
                        value={modal.value?.instructions}
                      />
                      <AgentRoomPicker
                        key={modal.value?.id ?? "new"}
                        agent={modal.value}
                        rooms={data?.layout.rooms ?? []}
                        items={data?.layout.items ?? []}
                      />
                    </div>
                  </>
                )}
                {["profile", "user"].includes(modal.kind) && (
                  <>
                    <Field
                      label="ชื่อที่แสดง"
                      name="name"
                      value={modal.value?.name}
                      required
                      maxLength={100}
                    />
                    <Field
                      label="อีเมล"
                      name="email"
                      type="email"
                      value={modal.value?.email}
                      required
                    />
                    {modal.kind === "profile" && (
                      <Field
                        label="รหัสผ่านปัจจุบัน (จำเป็นเมื่อเปลี่ยนอีเมลหรือรหัสผ่าน)"
                        name="current_password"
                        type="password"
                      />
                    )}
                    <Field
                      label={
                        modal.value?.id
                          ? "รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)"
                          : "รหัสผ่านอย่างน้อย 12 ตัวอักษร"
                      }
                      name="password"
                      type="password"
                      required={!modal.value?.id}
                    />
                  </>
                )}
                {modal.kind === "member" && (
                  <>
                    <Field
                      label="อีเมลของบัญชีผู้ใช้ที่มีอยู่แล้ว"
                      name="email"
                      type="email"
                      value={modal.value?.email}
                      required
                    />
                    <label>
                      สิทธิ์
                      <select
                        name="role"
                        defaultValue={modal.value?.role ?? "member"}
                      >
                        <option value="member">
                          Member · เพิ่มและแก้ไขข้อมูล
                        </option>
                        <option value="viewer">Viewer · ดูข้อมูล</option>
                      </select>
                    </label>
                  </>
                )}
              </>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? "กำลังดำเนินการ…"
                : modal.kind === "delete"
                  ? "ยืนยันการลบ"
                  : modal.kind === "remove-member"
                    ? "ยืนยันนำออก"
                    : "บันทึก"}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
