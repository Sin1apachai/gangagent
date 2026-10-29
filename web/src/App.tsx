import { OrganizationPage } from "./features/organization/OrganizationPage";
import { CollaborationPage } from "./features/collaboration/CollaborationPage";
import { TaskDetail } from "./features/tasks/TaskDetail";
import { EntityModal } from "./features/forms/EntityModal";
import { TrashPage } from "./features/trash/TrashPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TeamPage } from "./features/team/TeamPage";
import { KnowledgePage } from "./features/knowledge/KnowledgePage";
import { TasksPage } from "./features/tasks/TasksPage";
import { OfficePage } from "./features/office/OfficePage";
import { useOfficeController } from "./application/useOfficeController";
import React, { useState, useEffect, useRef } from "react";
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
} from "./shared/types";
import { api } from "./shared/api";
import { Field, Area } from "./shared/Fields";
import { furniture, statusLabel } from "./shared/constants";
import { Office } from "./features/office/Office";
export default function App() {
  const controller = useOfficeController();
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
  } = controller;
  if (loading) return <div className="login">กำลังเปิดออฟฟิศ…</div>;
  if (!user)
    return (
      <div className="login">
        <div className="login-art">
          <div className="pixel-logo">AO</div>
          <span className="eyebrow">A LITTLE WORLD OF POSSIBILITIES</span>
          <h1>
            Your team.
            <br />
            Your little office.
          </h1>
          <p>พื้นที่ทำงานของคุณ ที่ทุกไอเดียมีที่เติบโต</p>
        </div>
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            run(async () => {
              await api("/auth/login", f);
              setUser(await api<User>("/auth/me"));
              await loadSpaces();
            });
          }}
        >
          <span className="eyebrow">WELCOME HOME</span>
          <h2>เปิดประตูออฟฟิศ</h2>
          <Field label="อีเมล" name="email" type="email" required />
          <Field label="รหัสผ่าน" name="password" type="password" required />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            เข้าสู่ระบบ →
          </button>
          <small>
            ใช้บัญชี Agent Office ของคุณ
            <br />
            เจ้าของระบบครั้งแรกดูบัญชีได้จากไฟล์ .env
          </small>
        </form>
      </div>
    );
  return (
    <div className={`shell page-${page}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("office");
          }}
        >
          <span className="mini-logo">ao</span>
          <b>
            agent
            <br />
            office<span className="dot">.</span>
          </b>
        </a>
        <span className="eyebrow nav-label">YOUR WORKSPACE</span>
        <select
          aria-label="Workspace"
          value={wid}
          disabled={edit}
          onChange={(e) => setWid(e.target.value)}
        >
          {!spaces.length && <option value="">ยังไม่มี Workspace</option>}
          {spaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <nav>
          {[
            ["office", "▦", "Office"],
            ["tasks", "☷", "กระดานงาน"],
            ["projects", "◇", "โปรเจกต์"],
            ["plans", "♜", "แผนทีม"],
            ["knowledge", "▤", "Knowledge"],
            ["team", "♧", "Team"],
            ["skills", "✦", "Skills"],
            ["organization", "♙", "โครงสร้างทีม"],
            ["workflows", "⇢", "Workflow"],
            ["settings", "⚙", "Settings"],
            ["trash", "♲", "Trash"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              disabled={edit && id !== "office"}
              aria-current={page === id ? "page" : undefined}
              title={label}
              className={page === id ? "active" : ""}
              onClick={() => {
                setPage(id);
                setQuery("");
              }}
            >
              <span>{icon}</span>
              {label}
              {id === "tasks" && (
                <em>
                  {data?.tasks.filter((t) => t.status === "queued").length ?? 0}
                </em>
              )}
            </button>
          ))}
        </nav>
        <button
          className="new-space"
          disabled={busy || edit}
          onClick={() => setModal({ kind: "workspace" })}
        >
          ＋ New workspace
        </button>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <i /> LOCAL EDITION
          </div>
          <div className="profile">
            <span className="avatar">{user.name[0]}</span>
            <div>
              <b>{user.name}</b>
              <small>{user.is_super_admin ? "Super Admin" : "Member"}</small>
            </div>
            <button
              aria-label="ออกจากระบบ"
              onClick={() =>
                run(async () => {
                  await api("/auth/logout", {});
                  setUser(null);
                  setData(null);
                  setWid("");
                  setDetail(null);
                  setModal(null);
                })
              }
            >
              ↗
            </button>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumb">
            WORKSPACE <span>/</span>{" "}
            {data?.name ?? (wid ? "กำลังโหลด…" : "ยังไม่มี Workspace")}
          </div>
          <div className="header-right">
            <span className="connection">
              <i />
              {online ? "Worker ออนไลน์" : "Worker ออฟไลน์"}
            </span>
            <button
              className="primary"
              disabled={!data || !canWrite || busy}
              onClick={() => setModal({ kind: "task" })}
            >
              ＋ สร้างงาน
            </button>
          </div>
        </header>
        <div className="content">
          <div className="title-row">
            <div>
              <span className="eyebrow">
                AGENT OFFICE / {page === "office" ? "YOUR SPACE" : "WORKSPACE"}
              </span>
              <h1>
                {
                  (
                    {
                      office: "สำนักงานของคุณ",
                      tasks: "กระดานงาน",
                      knowledge: "คลังความรู้",
                      team: "ทีม Agent",
                      skills: "คลัง Skill ของทีม",
                      organization: "โครงสร้างและบทบาทของทีม",
                      workflows: "กระบวนการทำงานของทีม",
                      settings: "ตั้งค่าสำนักงานของคุณ",
                      projects: "จัดโปรเจกต์ของทีม",
                      plans: "วางแผนก่อนลงมือทำ",
                      trash: "ถังขยะ",
                    } as Record<string, string>
                  )[page]
                }
              </h1>
              <p>
                {
                  (
                    {
                      office: "จัดพื้นที่ ดูทีม และติดตามงานของคุณในที่เดียว",
                      tasks: "มอบหมายงาน ติดตามผล และตรวจรับก่อนส่งต่อ",
                      knowledge:
                        "รวบรวมสิ่งที่ทีมรู้ พร้อมค้นหาและตรวจสอบแหล่งที่มา",
                      team: "กำหนดบทบาทและเครื่องมือให้สมาชิกแต่ละคน",
                      skills: "สร้างความเชี่ยวชาญที่ใช้ซ้ำและเก็บประวัติได้",
                      organization:
                        "เห็นสายรายงาน หน้าที่ และขอบเขตของแต่ละ Agent",
                      workflows: "กำหนดลำดับส่งงานและจุดตรวจรับอย่างชัดเจน",
                      settings: "จัดการบัญชี การเชื่อมต่อ และสิทธิ์ของทีม",
                      projects: "จัดกลุ่มงานให้เห็นเป้าหมายและความคืบหน้า",
                      plans: "ตรวจแผนและลำดับงานก่อนอนุมัติให้ทีมเริ่มทำ",
                      trash: "กู้คืนข้อมูลที่ต้องการกลับมาใช้งาน",
                    } as Record<string, string>
                  )[page]
                }
              </p>
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {message && (
            <div className="notice" role="status">
              {message}
              <button onClick={() => setMessage("")}>×</button>
            </div>
          )}
          <details className="notice neutral execution-notice">
            <summary>
              <span aria-hidden="true">◇</span>
              <span>
                สถานะการเชื่อมต่อ ·{" "}
                {online ? "Worker ออนไลน์" : "Worker ออฟไลน์"}
              </span>
              <small>งานเริ่มเมื่อคุณอนุมัติเท่านั้น</small>
            </summary>
            <div>
              <b>
                {fixture
                  ? "โหมดทดสอบ · ไม่เรียก AI จริง"
                  : connected
                    ? "มีการเชื่อมต่อพร้อมตรวจรับงาน"
                    : online
                      ? "Worker พร้อม · รอ Login ผู้ให้บริการ"
                      : "รอ Worker"}
              </b>{" "}
              งานจะเริ่มเมื่อกดเริ่มงานเท่านั้น ระบบไม่ใช้ API key หรือสลับไป
              API เสียเงิน ส่วนเครดิตเพิ่มเติมต้องปิดในบัญชีผู้ให้บริการ
            </div>
          </details>
          {!wid && !["settings", "trash"].includes(page) && (
            <section className="empty big">
              <h3>เริ่มจากพื้นที่ว่างของคุณ</h3>
              <p>สร้าง Workspace เพื่อเพิ่มงาน ความรู้ และ Agent ของคุณเอง</p>
              <button
                className="primary"
                onClick={() => setModal({ kind: "workspace" })}
              >
                สร้าง Workspace แรก
              </button>
            </section>
          )}
          <OfficePage ctx={controller} />
          <CollaborationPage ctx={controller} />
          <TasksPage ctx={controller} />
          <KnowledgePage ctx={controller} />
          <TeamPage ctx={controller} />
          <OrganizationPage ctx={controller} />
          <SettingsPage ctx={controller} />
          <TrashPage ctx={controller} />
        </div>
        <footer>
          AGENT OFFICE <span>Your ideas deserve a little room.</span>
          <small>YOUR LITTLE WORLD OF WORK</small>
        </footer>
      </main>
      <TaskDetail ctx={controller} />
      <EntityModal ctx={controller} />
    </div>
  );
}
