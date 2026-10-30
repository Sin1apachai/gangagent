import { ResourcePanel } from "../monitoring/ResourcePanel";
import type { ResourceController } from "../monitoring/useResourceMonitor";
import { Backups } from "./Backups";
import React, { useState, useEffect } from "react";
import { FormTabs } from "../../shared/FormTabs";
import { PersonalWorkers } from "./PersonalWorkers";
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
export function SettingsPage({
  ctx,
  resources,
}: {
  ctx: OfficeController;
  resources?: ResourceController;
}) {
  const [settingsTab, setSettingsTab] = useState("connections");
  useEffect(() => {
    if (resources?.openRequest) setSettingsTab("resources");
  }, [resources?.openRequest]);
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
      {page === "settings" && (
        <div className="settings-grid">
          <div style={{ gridColumn: "1 / -1", order: -1 }}>
            <FormTabs
              label="ตั้งค่าระบบ"
              value={settingsTab}
              onChange={setSettingsTab}
              tabs={[
                { id: "connections", label: "เชื่อมต่อ AI" },
                { id: "account", label: "บัญชีของฉัน" },
                ...(canManage && active
                  ? [{ id: "workspace", label: "สมาชิก Workspace" }]
                  : []),
                ...(user.is_super_admin
                  ? [
                      { id: "resources", label: "ทรัพยากร" },
                      { id: "backups", label: "สำรองข้อมูล" },
                      { id: "users", label: "ผู้ใช้ระบบ" },
                    ]
                  : []),
              ]}
            />
          </div>

          {settingsTab === "account" && (
            <section className="panel account-panel">
              <h2>บัญชีของฉัน</h2>
              <p>
                {user.name} · {user.email}
              </p>
              <button
                onClick={() => setModal({ kind: "profile", value: user })}
              >
                แก้ไขโปรไฟล์ / รหัสผ่าน
              </button>
            </section>
          )}
          {settingsTab === "connections" && (
            <section className="panel connections-panel">
              <h2>การเชื่อมต่อ AI</h2>
              <p className="muted">
                Codex ใช้โหมดสร้าง/แก้ไฟล์ข้อความที่ระบบตรวจสอบก่อนบันทึก ไม่รัน
                shell ใน Docker รองรับไฟล์ UTF-8 สูงสุด 20 ไฟล์ต่อรอบ รวม 1 MiB
                ส่วน Claude ใช้เครื่องมืออ่านและแก้ไฟล์
              </p>
              <p>
                กดเชื่อมบัญชี แล้วลงชื่อเข้าใช้บนหน้าทางการของผู้ให้บริการ
                ไม่ต้องเปิด Terminal หรือพิมพ์คำสั่ง
              </p>
              <p className="muted">
                Worker: {online ? "ออนไลน์" : "ออฟไลน์"} · ไม่ตั้งค่า API-key
                fallback
              </p>
              {["codex", "claude"].map((provider) => {
                const cfg = connections?.settings.find(
                  (c) => c.provider === provider,
                );
                const ready = connections?.workers.some(
                  (w) => w.online && w.providers[provider]?.authenticated,
                );
                const login = connections?.logins?.find(
                  (l) => l.provider === provider,
                );
                const pending =
                  login &&
                  ["queued", "starting", "waiting"].includes(login.status);
                const workerPaired = connections?.workers.some((w) => w.online);
                return (
                  <form
                    key={provider}
                    className="provider-box"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const ack =
                        new FormData(e.currentTarget).get("ack") === "on";
                      run(async () => {
                        await api(
                          "/connections/" + provider,
                          {
                            enabled: !cfg?.enabled,
                            billing_acknowledged: ack,
                          },
                          "PUT",
                        );
                        await extras();
                      });
                    }}
                  >
                    <h3>
                      {provider === "codex" ? "Codex / ChatGPT" : "Claude Code"}{" "}
                      <span className="tag">
                        {fixture
                          ? "Worker ทดสอบ"
                          : ready
                            ? "Login พร้อม"
                            : "ยังไม่ได้ Login"}
                      </span>
                    </h3>
                    <div className="actions">
                      {ready && (
                        <button
                          type="button"
                          disabled={busy || !!pending}
                          onClick={() =>
                            run(async () => {
                              await api(`/connections/${provider}/login`, {
                                reconnect: true,
                              });
                              await extras();
                            })
                          }
                        >
                          เชื่อมบัญชีใหม่
                        </button>
                      )}
                      {ready ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => run(extras)}
                        >
                          ตรวจสถานะอีกครั้ง
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="primary"
                          disabled={busy || !!pending || !workerPaired}
                          onClick={() =>
                            run(async () => {
                              await api(`/connections/${provider}/login`, {});
                              await extras();
                            })
                          }
                        >
                          เชื่อมบัญชี{" "}
                          {provider === "codex" ? "ChatGPT" : "Claude"}
                        </button>
                      )}
                      {pending && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await api(
                                `/connections/login/${login.id}/cancel`,
                                {},
                              );
                              setLoginCodes((prev) => ({
                                ...prev,
                                [login.id]: "",
                              }));
                              await extras();
                            })
                          }
                        >
                          ยกเลิกการเชื่อมต่อครั้งนี้
                        </button>
                      )}
                    </div>
                    {!workerPaired && (
                      <p className="muted">
                        เครื่องที่รับงานยังไม่ออนไลน์
                        หรือบัญชีนี้ยังไม่ได้ผูกเครื่องส่วนตัว
                      </p>
                    )}
                    {pending && (
                      <div className="login-steps" role="status">
                        {login.status === "queued" && (
                          <p>
                            รอเครื่องรับคำขอ หากมีงานกำลังทำ กรุณารอให้งานจบก่อน
                          </p>
                        )}
                        {login.status === "starting" && (
                          <p>กำลังเตรียมหน้าลงชื่อเข้าใช้…</p>
                        )}
                        {login.status === "waiting" && (
                          <>
                            {fixture ? (
                              <p>โหมดทดสอบ — ไม่มีการ Login จริง</p>
                            ) : (
                              login.login_url && (
                                <a
                                  className="artifact-link"
                                  href={login.login_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  เปิดหน้ายืนยันบัญชีทางการ ↗
                                </a>
                              )
                            )}
                            {login.device_code && (
                              <p>
                                รหัสอุปกรณ์:{" "}
                                <strong>{login.device_code}</strong>
                              </p>
                            )}
                            {provider === "codex" && (
                              <p className="muted">
                                กรอกรหัสนี้บนหน้าทางการ หากระบบแจ้งให้เปิด
                                Device-code login ให้เปิดใน{" "}
                                <a
                                  href="https://chatgpt.com/#settings/Security"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  การตั้งค่าความปลอดภัย ChatGPT
                                </a>{" "}
                                แล้วลองใหม่
                              </p>
                            )}
                            {provider === "claude" && (
                              <>
                                <label>
                                  รหัสยืนยันครั้งเดียวจากหน้า Claude
                                  <input
                                    type="password"
                                    autoComplete="off"
                                    value={loginCodes[login.id] ?? ""}
                                    onChange={(e) =>
                                      setLoginCodes((prev) => ({
                                        ...prev,
                                        [login.id]: e.target.value,
                                      }))
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  disabled={
                                    busy || !loginCodes[login.id]?.trim()
                                  }
                                  onClick={() =>
                                    run(async () => {
                                      const code = loginCodes[login.id];
                                      setLoginCodes((prev) => ({
                                        ...prev,
                                        [login.id]: "",
                                      }));
                                      await api(
                                        `/connections/login/${login.id}/code`,
                                        { code },
                                      );
                                      setMessage(
                                        "ส่งรหัสแล้ว กำลังตรวจการเชื่อมต่อ",
                                      );
                                    })
                                  }
                                >
                                  ยืนยันรหัส
                                </button>
                                <p className="muted">
                                  ใส่เฉพาะรหัสยืนยันครั้งเดียว
                                  ไม่ใช่รหัสผ่านหรือ API key
                                </p>
                              </>
                            )}
                          </>
                        )}
                        <small>
                          คำขอนี้หมดอายุ{" "}
                          {new Date(login.expires_at).toLocaleTimeString(
                            "th-TH",
                          )}
                        </small>
                      </div>
                    )}
                    {login && !pending && !ready && (
                      <p className="muted">
                        {login.status === "cancelled"
                          ? "ยกเลิกคำขอแล้ว"
                          : login.status === "expired"
                            ? "คำขอหมดอายุ กดเชื่อมบัญชีเพื่อลองใหม่"
                            : login.status === "failed"
                              ? "เชื่อมบัญชีไม่สำเร็จ ตรวจสิทธิ์บัญชีและลองใหม่"
                              : "กำลังตรวจสถานะบัญชี"}
                      </p>
                    )}
                    <label className="check">
                      <input
                        type="checkbox"
                        name="ack"
                        defaultChecked={cfg?.billing_acknowledged}
                        key={String(cfg?.billing_acknowledged)}
                        required={!cfg?.enabled}
                      />
                      ฉันปิดเครดิตเพิ่มเติม /
                      เติมเงินอัตโนมัติในบัญชีผู้ให้บริการ
                      และยอมให้ใช้งานโควตาสมาชิกของฉัน
                    </label>
                    <button
                      disabled={busy}
                      className={cfg?.enabled ? "" : "primary"}
                    >
                      {cfg?.enabled ? "ปิดการใช้งาน" : "เปิดการใช้งาน"}
                    </button>
                  </form>
                );
              })}
              <p className="muted">
                ระบบตรวจชนิด Login และไม่ส่ง API key
                แต่ไม่สามารถเปลี่ยนการตั้งค่าคิดเงินที่บัญชีผู้ให้บริการแทนคุณได้
              </p>
              <h3>สถานะเครื่องที่รับงานของฉัน</h3>
              {!connections?.workers.length && (
                <p className="muted">ยังไม่มี Worker ผูกกับบัญชีนี้</p>
              )}
              {connections?.workers.map((w) => (
                <div className="list-row" key={w.id}>
                  <div>
                    <b>
                      {w.id} · {w.online ? "ออนไลน์" : "ขาดการเชื่อมต่อ"}
                    </b>
                    <small>
                      ตรวจพบล่าสุด{" "}
                      {new Date(w.heartbeat_at).toLocaleString("th-TH")}
                    </small>
                    <small>
                      {w.mode === "fixture"
                        ? "โหมดทดสอบ ไม่มีการเรียก AI"
                        : "โหมดบัญชีสมาชิก"}
                    </small>
                    {Object.entries(w.providers).map(([name, p]) => (
                      <small key={name}>
                        {name}:{" "}
                        {!w.online
                          ? "รอ Worker เชื่อมต่อเพื่อตรวจสถานะใหม่"
                          : w.mode === "fixture"
                            ? "สถานะจำลอง ไม่ได้ Login จริง"
                            : p.authenticated
                              ? "Login พร้อม"
                              : "ต้อง Login ด้วยบัญชีสมาชิก"}
                      </small>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
          {wid && canManage && settingsTab === "workspace" && (
            <section className="panel members-panel">
              <div className="panel-heading">
                <h2>สมาชิก Workspace</h2>
                <button onClick={() => setModal({ kind: "member" })}>
                  ＋ เพิ่มสมาชิก
                </button>
              </div>
              {members.map((m) => (
                <div className="list-row" key={m.id}>
                  <div>
                    <b>{m.name}</b>
                    <small>
                      {m.email} · {m.role}
                    </small>
                  </div>
                  {m.role !== "owner" && (
                    <div className="actions">
                      <button
                        onClick={() => setModal({ kind: "member", value: m })}
                      >
                        แก้ไขสิทธิ์
                      </button>
                      <button
                        onClick={() =>
                          setModal({ kind: "remove-member", value: m })
                        }
                      >
                        นำออก
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
          {user.is_super_admin && settingsTab === "users" && (
            <section className="panel users-panel">
              <div className="panel-heading">
                <h2>บัญชีผู้ใช้</h2>
                <button onClick={() => setModal({ kind: "user" })}>
                  ＋ เพิ่มผู้ใช้
                </button>
              </div>
              {users.map((u) => (
                <div className="list-row" key={u.id}>
                  <div>
                    <b>{u.name}</b>
                    <small>
                      {u.email} ·{" "}
                      {u.deleted_at
                        ? "ปิดใช้งาน"
                        : u.is_super_admin
                          ? "Super Admin"
                          : "Member"}
                    </small>
                  </div>
                  {u.id !== user.id && (
                    <div className="actions">
                      {u.deleted_at ? (
                        <button
                          onClick={() =>
                            run(async () => {
                              await api(`/admin/users/${u.id}/restore`, {});
                              await extras();
                            })
                          }
                        >
                          กู้คืน
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => setModal({ kind: "user", value: u })}
                          >
                            แก้ไข
                          </button>
                          {!u.is_super_admin && (
                            <button
                              onClick={() =>
                                run(async () => {
                                  await api(
                                    `/admin/intelligence/${u.id}`,
                                    { enabled: !u.intelligence_access },
                                    "PUT",
                                  );
                                  await extras();
                                })
                              }
                            >
                              {u.intelligence_access
                                ? "เพิกถอน Super Intelligence"
                                : "ให้สิทธิ์ Super Intelligence"}
                            </button>
                          )}
                          {!u.is_super_admin && (
                            <button
                              onClick={() =>
                                setModal({
                                  kind: "delete",
                                  value: { kind: "user", item: u },
                                })
                              }
                            >
                              ลบ
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
          {settingsTab === "connections" && <PersonalWorkers />}
          {user.is_super_admin && settingsTab === "resources" && resources && (
            <ResourcePanel monitor={resources} />
          )}
          {user.is_super_admin && settingsTab === "backups" && <Backups />}
        </div>
      )}
    </>
  );
}
