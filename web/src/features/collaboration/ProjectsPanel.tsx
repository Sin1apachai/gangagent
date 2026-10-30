import React, { useState, useEffect } from "react";
import { api } from "../../shared/api";
import { FormTabs } from "../../shared/FormTabs";
import type { OfficeController } from "../../application/useOfficeController";
import "./projects.css";
import { ProjectFolderPicker, type ProjectFolder } from "./ProjectFolderPicker";
export type Project = {
  working_folder?: ProjectFolder | null;
  id: string;
  name: string;
  description: string;
  version: number;
  deleted_at: string | null;
};
type Draft = {
  working_folder: ProjectFolder | null;
  originalFolder: ProjectFolder | null;
  id?: string;
  name: string;
  description: string;
  version: number;
  originalName: string;
  originalDescription: string;
};
export function ProjectsPanel({
  ctx,
  projects,
  onRefresh,
}: {
  ctx: OfficeController;
  projects: Project[];
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState("active"),
    [draft, setDraft] = useState<Draft | null>(null),
    [confirm, setConfirm] = useState<Project | null>(null),
    [saving, setSaving] = useState(false),
    [pickingFolder, setPickingFolder] = useState(false),
    [editorTab, setEditorTab] = useState("details"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [created, setCreated] = useState("");
  const active = projects.filter((p) => !p.deleted_at),
    trash = projects.filter((p) => p.deleted_at),
    shown = tab === "active" ? active : trash;
  useEffect(() => {
    if (created && ctx.data?.tasks.some((t) => t.project_id === created)) {
      setCreated("");
      setNotice("");
    }
  }, [created, ctx.data?.tasks]);
  const disabled = saving || pickingFolder || ctx.busy;
  const changed =
    !!draft &&
    (draft.name !== draft.originalName ||
      draft.description !== draft.originalDescription ||
      draft.working_folder?.id !== draft.originalFolder?.id);
  function open(p?: Project) {
    setEditorTab("details");
    setError("");
    setNotice("");
    setDraft({
      working_folder: p?.working_folder ?? null,
      originalFolder: p?.working_folder ?? null,
      id: p?.id,
      name: p?.name ?? "",
      description: p?.description ?? "",
      version: p?.version ?? 0,
      originalName: p?.name ?? "",
      originalDescription: p?.description ?? "",
    });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || disabled) return;
    setError("");
    if (!draft.name.trim()) {
      setError("กรุณาตั้งชื่อโปรเจกต์");
      return;
    }
    if (new TextEncoder().encode(draft.name.trim()).length > 100) {
      setError("ชื่อโปรเจกต์ยาวเกินไป กรุณาย่อชื่อ");
      return;
    }
    if (new TextEncoder().encode(draft.description).length > 5000) {
      setError("รายละเอียดโปรเจกต์ยาวเกินไป กรุณาย่อข้อความ");
      return;
    }
    setSaving(true);
    try {
      const result = await api<{ id?: string }>(
        `/workspaces/${ctx.wid}/projects${draft.id ? "/" + draft.id : ""}`,
        {
          name: draft.name.trim(),
          description: draft.description,
          version: draft.version,
          working_folder: draft.working_folder ?? {},
        },
        draft.id ? "PUT" : "POST",
      );
      setCreated(draft.id ? "" : (result.id ?? ""));
      setTab("active");
      setNotice(
        draft.id
          ? "บันทึกการแก้ไขแล้ว"
          : "สร้างโปรเจกต์แล้ว ขั้นต่อไปสร้างงานและเลือก Agent ที่รับผิดชอบ",
      );
      setDraft(null);
      try {
        await onRefresh();
      } catch {
        setError("บันทึกโปรเจกต์แล้ว แต่โหลดรายการไม่สำเร็จ กรุณารีเฟรชหน้า");
      }
    } catch (e) {
      setError(
        (e as Error).message.includes("changed")
          ? "มีผู้อื่นแก้ไขโปรเจกต์นี้แล้ว กรุณายกเลิกแล้วเปิดแก้ไขใหม่"
          : (e as Error).message,
      );
    } finally {
      setSaving(false);
    }
  }
  async function archive(p: Project, restore = false) {
    if (disabled) return;
    setSaving(true);
    setError("");
    try {
      await api(
        `/workspaces/${ctx.wid}/projects/${p.id}${restore ? "/restore" : ""}`,
        restore ? {} : undefined,
        restore ? "POST" : "DELETE",
      );
      await onRefresh();
      setConfirm(null);
      setNotice(
        restore
          ? "กู้คืนโปรเจกต์แล้ว"
          : "ย้ายโปรเจกต์ไปถังขยะแล้ว กู้คืนได้จากแท็บถังขยะ",
      );
      if (restore) setTab("active");
      if (created === p.id) setCreated("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="projects-feature" aria-label="โปรเจกต์">
      <header className="projects-heading">
        <div>
          <h2>โปรเจกต์ของคุณ</h2>
          <p>
            รวมงานของเรื่องเดียวกันไว้ด้วยกัน
            สร้างโปรเจกต์แล้วเริ่มมอบหมายงานให้ Agent
          </p>
        </div>
        {ctx.canWrite && (
          <button
            className="primary"
            disabled={disabled}
            onClick={() => open()}
          >
            ＋ สร้างโปรเจกต์
          </button>
        )}
      </header>
      <FormTabs
        label="รายการโปรเจกต์"
        value={tab}
        onChange={(v) => {
          setTab(v);
          setError("");
          setNotice("");
        }}
        tabs={[
          { id: "active", label: `กำลังใช้งาน (${active.length})` },
          { id: "trash", label: `ถังขยะ (${trash.length})` },
        ]}
      />
      {notice && (
        <div className="projects-notice" role="status">
          ✓ {notice}
        </div>
      )}
      {error && !draft && !confirm && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="project-cards">
        {[...shown].reverse().map((p) => {
          const tasks =
            ctx.data?.tasks.filter((t) => t.project_id === p.id) ?? [];
          const done = tasks.filter((t) => t.status === "done").length;
          return (
            <article
              className={
                "project-card" + (created === p.id ? " newly-created" : "")
              }
              key={p.id}
            >
              <div className="project-card-heading">
                <div>
                  <span className="eyebrow">
                    {p.deleted_at ? "อยู่ในถังขยะ" : "PROJECT"}
                  </span>
                  <h3>{p.name}</h3>
                </div>
                {ctx.canWrite && !p.deleted_at && (
                  <details className="project-menu">
                    <summary aria-label={"เมนูเพิ่มเติม " + p.name}>
                      เพิ่มเติม
                    </summary>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setError("");
                        setConfirm(p);
                      }}
                    >
                      ย้ายไปถังขยะ
                    </button>
                  </details>
                )}
              </div>
              <p className="project-description">
                {p.description ||
                  "ยังไม่มีรายละเอียด เพิ่มได้ภายหลังจากปุ่มแก้ไข"}
              </p>
              {p.working_folder && (
                <p className="project-folder-path">{p.working_folder.path}</p>
              )}
              <div className="project-task-count">
                {tasks.length
                  ? `${tasks.length} งานทั้งหมด · เสร็จแล้ว ${done} งาน`
                  : "ยังไม่มีงานในโปรเจกต์นี้"}
              </div>
              {created === p.id && !tasks.length && (
                <p className="project-next-step">
                  พร้อมแล้ว เริ่มจากสร้างงานแรกให้ทีมของคุณ
                </p>
              )}
              <div className="project-actions">
                {p.deleted_at ? (
                  ctx.canWrite && (
                    <button
                      disabled={disabled}
                      onClick={() => archive(p, true)}
                    >
                      กู้คืนโปรเจกต์
                    </button>
                  )
                ) : (
                  <>
                    {ctx.canWrite && (
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() =>
                          ctx.setModal({
                            kind: "task",
                            value: { project_id: p.id },
                          })
                        }
                      >
                        ＋ สร้างงานในโปรเจกต์นี้
                      </button>
                    )}
                    {ctx.canWrite && (
                      <button disabled={disabled} onClick={() => open(p)}>
                        แก้ไขโปรเจกต์
                      </button>
                    )}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!shown.length && (
        <div className="projects-empty">
          <h3>{tab === "trash" ? "ถังขยะว่าง" : "เริ่มโปรเจกต์แรกของคุณ"}</h3>
          <p>
            {tab === "trash"
              ? "โปรเจกต์ที่ย้ายมาจะแสดงที่นี่ และกู้คืนได้"
              : "ตั้งชื่อและระบุเป้าหมายสั้น ๆ แล้วสร้างงานให้ Agent รับผิดชอบ"}
          </p>
          {ctx.canWrite && tab === "active" && (
            <button className="primary" onClick={() => open()}>
              สร้างโปรเจกต์แรก
            </button>
          )}
        </div>
      )}
      {draft && (
        <div className="overlay">
          <form
            className="modal project-editor"
            role="dialog"
            aria-modal="true"
            aria-label={draft.id ? "แก้ไขโปรเจกต์" : "สร้างโปรเจกต์"}
            onSubmit={save}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !saving && !pickingFolder) {
                e.preventDefault();
                setDraft(null);
                setError("");
              }
            }}
          >
            <button
              type="button"
              className="close"
              aria-label="ปิดฟอร์มโปรเจกต์"
              disabled={saving || pickingFolder}
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              ×
            </button>
            <span className="eyebrow">PROJECT DETAILS</span>
            <h2>{draft.id ? "แก้ไขโปรเจกต์" : "สร้างโปรเจกต์ใหม่"}</h2>
            <p className="form-section-help">
              {draft.id
                ? "แก้ข้อมูลที่ต้องการ แล้วกดบันทึกการแก้ไข"
                : "กรอกชื่อโปรเจกต์ก่อน รายละเอียดเพิ่มเติมใส่ภายหลังได้"}
            </p>
            <FormTabs
              label="Project settings"
              value={editorTab}
              onChange={(tab) => {
                if (!pickingFolder) setEditorTab(tab);
              }}
              tabs={[
                { id: "details", label: "รายละเอียด" },
                {
                  id: "folder",
                  label: "โฟลเดอร์ทำงาน" + (draft.working_folder ? " ✓" : ""),
                },
              ]}
            />
            <div className="project-form-fields" role="tabpanel">
              {editorTab === "details" && (
                <>
                  <label>
                    ชื่อโปรเจกต์
                    <input
                      autoFocus
                      required
                      name="name"
                      maxLength={100}
                      value={draft.name}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                      placeholder="เช่น เว็บไซต์บริษัท Tech"
                    />
                  </label>
                  <label>
                    เป้าหมายและรายละเอียด (ไม่บังคับ)
                    <textarea
                      name="description"
                      rows={5}
                      maxLength={5000}
                      value={draft.description}
                      onChange={(e) =>
                        setDraft({ ...draft, description: e.target.value })
                      }
                      placeholder="โปรเจกต์นี้ต้องการทำอะไร และถือว่าสำเร็จเมื่อใด"
                    />
                  </label>
                </>
              )}
              {editorTab === "folder" && (
                <ProjectFolderPicker
                  wid={ctx.wid!}
                  value={draft.working_folder}
                  onChange={(folder) =>
                    setDraft((current) =>
                      current
                        ? { ...current, working_folder: folder }
                        : current,
                    )
                  }
                  onBusy={setPickingFolder}
                  disabled={saving}
                />
              )}
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="project-editor-actions">
              <button
                type="button"
                disabled={saving || pickingFolder}
                onClick={() => {
                  setDraft(null);
                  setError("");
                }}
              >
                ยกเลิก
              </button>
              <button
                className="primary"
                disabled={disabled || !changed || !draft.name.trim()}
              >
                {saving
                  ? "กำลังบันทึก…"
                  : draft.id
                    ? "บันทึกการแก้ไข"
                    : "สร้างโปรเจกต์"}
              </button>
            </div>
          </form>
        </div>
      )}
      {confirm && (
        <div className="overlay">
          <section
            className="modal project-editor"
            role="alertdialog"
            aria-modal="true"
            aria-label="ยืนยันย้ายโปรเจกต์ไปถังขยะ"
          >
            <h2>ย้าย “{confirm.name}” ไปถังขยะ?</h2>
            <p className="form-section-help">
              โปรเจกต์จะถูกซ่อนจากรายการใช้งาน งานเดิมยังอยู่
              และกู้คืนโปรเจกต์ได้จากแท็บถังขยะ
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="project-editor-actions">
              <button
                disabled={saving || pickingFolder}
                onClick={() => {
                  setConfirm(null);
                  setError("");
                }}
              >
                ยกเลิก
              </button>
              <button disabled={disabled} onClick={() => archive(confirm)}>
                {saving ? "กำลังย้าย…" : "ยืนยันย้ายไปถังขยะ"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
