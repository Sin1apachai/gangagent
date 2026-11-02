import { DeliveryEvidence } from "./DeliveryEvidence";
import { ProjectsPanel, type Project } from "./ProjectsPanel";
import { FormTabs } from "../../shared/FormTabs";
import { planReadiness } from "./planReadiness";
import "./plans.css";
import { PlanUsage } from "./PlanUsage";
import { StepEditor } from "../organization/StepEditor";
import type { Skill, Organization, Reviewer } from "../organization/types";
import React, { useEffect, useState } from "react";
import { api } from "../../shared/api";
import type { OfficeController } from "../../application/useOfficeController";
import { statusLabel } from "../../shared/constants";
import type { Step } from "../organization/types";
type Plan = {
  id: string;
  goal: string;
  status: string;
  steps: Step[];
  version: number;
  planner_task_id: string | null;
  created_by: string;
  workflow_snapshot?: { title: string; version: number } | null;
};
export function CollaborationPage({ ctx }: { ctx: OfficeController }) {
  const { wid, data, page, user, canWrite, run, busy, after, showTask } = ctx;
  const [showCreate, setShowCreate] = useState(false),
    [planFilter, setPlanFilter] = useState("all"),
    [planTabs, setPlanTabs] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<Project[]>([]),
    [plans, setPlans] = useState<Plan[]>([]),
    [drafts, setDrafts] = useState<Record<string, Step[]>>({}),
    [approved, setApproved] = useState<Record<string, boolean>>({}),
    [focused, setFocused] = useState<Record<string, boolean>>({});
  const [skills, setSkills] = useState<Skill[]>([]),
    [organization, setOrganization] = useState<Organization>({
      agents: [],
      bindings: [],
    }),
    [reviewers, setReviewers] = useState<Reviewer[]>([]);
  async function load() {
    if (!wid) return;
    const [p, l] = await Promise.all([
      api<Project[]>(`/workspaces/${wid}/projects`),
      api<Plan[]>(`/workspaces/${wid}/plans`),
    ]);
    setProjects(p);
    setPlans(l);
  }
  useEffect(() => {
    if (!wid || !["projects", "plans"].includes(page)) return;
    let current = true;
    Promise.all([
      api<Skill[]>(`/workspaces/${wid}/skills`),
      api<Organization>(`/workspaces/${wid}/organization`),
      api<Reviewer[]>(`/workspaces/${wid}/reviewers`),
    ])
      .then(([s, o, r]) => {
        if (current) {
          setSkills(s);
          setOrganization(o);
          setReviewers(r);
        }
      })
      .catch((e) => ctx.setError(String(e)));
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 3000);
    return () => {
      current = false;
      clearInterval(t);
    };
  }, [wid, page]);
  if (!wid || !data || !user || !["projects", "plans"].includes(page))
    return null;
  const agents = data.agents.filter((a) => a.enabled);
  function edit(id: string, steps: Step[]) {
    setApproved((v) => ({ ...v, [id]: false }));
    setDrafts((d) => ({ ...d, [id]: steps }));
  }
  return (
    <>
      {page === "projects" && (
        <ProjectsPanel
          key={wid}
          ctx={ctx}
          projects={projects}
          onRefresh={load}
        />
      )}
      {page === "plans" && (
        <div className="team-plans">
          <header className="plans-heading">
            <div>
              <h2>แผนงานของทีม</h2>
              <p>กำหนดหัวหน้าตรวจงานภายใน แล้วตรวจรับผลงานปลายทาง</p>
            </div>
            {canWrite && (
              <div className="plans-toolbar">
                <button onClick={() => ctx.setPage("workflows")}>
                  ใช้ Workflow ที่เตรียมไว้
                </button>
                <button
                  className="primary"
                  aria-expanded={showCreate}
                  onClick={() => setShowCreate(!showCreate)}
                >
                  {showCreate ? "ปิดฟอร์มสร้างแผน" : "＋ สร้างร่างเอง"}
                </button>
              </div>
            )}
          </header>
          {showCreate && (
            <section className="panel plans-create">
              <h3>สร้างร่างแผนใหม่</h3>
              <p>
                สร้างร่าง → ตรวจแผน → อนุมัติเริ่มทีม
                งานถัดไปจะรอให้งานที่เกี่ยวข้องผ่านการตรวจรับก่อน
              </p>
              {canWrite && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      f = new FormData(form);
                    run(async () => {
                      await api(`/workspaces/${wid}/plans`, {
                        goal: f.get("goal"),
                        manager_agent_id: f.get("manager") || null,
                        steps: [],
                      });
                      form.reset();
                      setShowCreate(false);
                      setPlanFilter("draft");
                      await load();
                      await after();
                    });
                  }}
                >
                  <label>
                    เป้าหมาย
                    <textarea name="goal" required maxLength={20000} />
                  </label>
                  <label>
                    ผู้จัดการเสนอแผน
                    <select name="manager">
                      <option value="">จัดแผนเอง</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.provider}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary" disabled={busy}>
                    สร้างร่างแผน
                  </button>
                  <p className="muted">
                    การสร้างร่างยังไม่เรียก AI หากเลือกผู้จัดการ
                    ระบบจะสร้างงานเสนอแผนให้คุณกดเริ่มเอง
                  </p>
                </form>
              )}
            </section>
          )}
          <FormTabs
            label="สถานะแผนทีม"
            value={planFilter}
            onChange={setPlanFilter}
            tabs={[
              { id: "all", label: `ทั้งหมด (${plans.length})` },
              {
                id: "draft",
                label: `รอเริ่ม (${plans.filter((p) => p.status === "draft").length})`,
              },
              {
                id: "approved",
                label: `เริ่มแล้ว (${plans.filter((p) => p.status === "approved").length})`,
              },
              {
                id: "cancelled",
                label: `ยกเลิก (${plans.filter((p) => p.status === "cancelled").length})`,
              },
            ]}
          />
          {plans
            .filter((p) => planFilter === "all" || p.status === planFilter)
            .map((p) => {
              const steps = drafts[p.id] ?? p.steps,
                editable =
                  canWrite && p.created_by === user.id && p.status === "draft";
              const planTab = planTabs[p.id] ?? "overview";
              const readiness = planReadiness(
                steps,
                agents.map((a) => a.id),
                !!drafts[p.id],
              );
              const tasks = data.tasks.filter(
                  (t) => t.plan_id === p.id && !t.review_for_task_id,
                ),
                done = tasks.filter((t) => t.status === "done").length,
                review = tasks.filter((t) => t.status === "review").length;
              return (
                <section key={p.id} className="panel plan-card">
                  <div className="panel-heading">
                    <h3>
                      {p.workflow_snapshot?.title ||
                        p.goal.split("\n")[0].slice(0, 120)}
                    </h3>
                    <span className="tag">
                      {p.status === "draft"
                        ? "ร่างแผน"
                        : p.status === "approved"
                          ? "อนุมัติแล้ว"
                          : "ยกเลิกแล้ว"}
                    </span>
                  </div>
                  <div className="plan-summary">
                    <span>{steps.length} ขั้นตอน</span>
                    <span>
                      {tasks.length
                        ? `เสร็จ ${done}/${tasks.length} งาน`
                        : "ยังไม่เริ่มงาน AI"}
                    </span>
                    {review > 0 && (
                      <strong>
                        อยู่ระหว่างตรวจ {review} งาน · ดูผู้ตรวจในรายละเอียด
                      </strong>
                    )}
                    {drafts[p.id] && <strong>มีการแก้ไขที่ยังไม่บันทึก</strong>}
                  </div>
                  {p.status !== "draft" && (
                    <DeliveryEvidence wid={wid!} id={p.id} />
                  )}
                  <p className="plan-next" role="status">
                    {p.status === "draft"
                      ? drafts[p.id]
                        ? "ขั้นต่อไป: บันทึกการแก้ไขในแท็บขั้นตอนก่อนเริ่มทีม"
                        : !steps.length
                          ? "ขั้นต่อไป: เพิ่มขั้นตอน หรือเปิดงานเสนอแผนเพื่อให้ Agent จัดร่าง"
                          : "ขั้นต่อไป: ตรวจลำดับงาน แล้วไปที่ตรวจและเริ่ม"
                      : p.status === "cancelled"
                        ? "แผนนี้หยุดแล้ว ตรวจประวัติงานได้ในแท็บติดตามงาน"
                        : review
                          ? "ขั้นต่อไป: เปิดงานที่รอตรวจรับ เพื่ออ่านผลและรับงานหรือส่งแก้"
                          : done === tasks.length && tasks.length
                            ? "ตรวจรับครบแล้ว · เปิดหลักฐานส่งมอบเพื่อตรวจว่ามีโปรแกรมและผลทดสอบจริงหรือยัง"
                            : "แผนเริ่มแล้ว ดูสถานะและสิ่งที่ต้องทำต่อในแท็บติดตามงาน"}
                  </p>
                  <FormTabs
                    label={`รายละเอียดแผน ${p.id}`}
                    value={planTab}
                    onChange={(tab) =>
                      setPlanTabs((v) => ({ ...v, [p.id]: tab }))
                    }
                    tabs={[
                      { id: "overview", label: "สรุปแผน" },
                      { id: "steps", label: "ขั้นตอน" },
                      ...(editable
                        ? [{ id: "start", label: "ตรวจและเริ่ม" }]
                        : []),
                      { id: "tasks", label: `ติดตามงาน (${tasks.length})` },
                    ]}
                  />
                  {planTab === "overview" && (
                    <details className="plan-goal">
                      <summary>อ่านเป้าหมายทั้งหมด</summary>
                      <p>{p.goal}</p>
                    </details>
                  )}
                  {planTab === "overview" && p.status !== "draft" && (
                    <p className="muted">
                      ข้อมูลประกอบ:{" "}
                      {Array.from(
                        new Set(
                          (data?.tasks || [])
                            .filter((t) => t.plan_id === p.id)
                            .map((t) => t.context_format || "compact"),
                        ),
                      )
                        .map((m) =>
                          m === "focused"
                            ? "เลือกตามงาน (ทดลอง)"
                            : "เต็มตามเดิม",
                        )
                        .join(" / ") || "ยังไม่มีงาน"}
                    </p>
                  )}
                  {planTab === "overview" && <PlanUsage wid={wid} id={p.id} />}
                  {planTab === "overview" && p.planner_task_id && (
                    <div className="actions">
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const d = await api<any>(
                              `/workspaces/${wid}/tasks/${p.planner_task_id}`,
                            );
                            ctx.setDetail(d);
                          })
                        }
                      >
                        เปิดงานเสนอแผน
                      </button>
                      {editable && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await api(
                                `/workspaces/${wid}/plans/${p.id}/import`,
                                {},
                              );
                              setDrafts((d) => {
                                const n = { ...d };
                                delete n[p.id];
                                return n;
                              });
                              await load();
                            })
                          }
                        >
                          นำข้อเสนอ AI มาให้ตรวจ
                        </button>
                      )}
                    </div>
                  )}
                  {planTab === "overview" && p.workflow_snapshot && (
                    <p className="notice">
                      Workflow: {p.workflow_snapshot.title} · v
                      {p.workflow_snapshot.version + 1} ·
                      แผนนี้เก็บสำเนาแม่แบบไว้แล้ว
                    </p>
                  )}
                  {planTab === "steps" && editable ? (
                    <StepEditor
                      steps={steps}
                      onChange={(next) => edit(p.id, next)}
                      agents={agents}
                      skills={skills}
                      bindings={organization.bindings}
                      reviewers={reviewers}
                      disabled={busy}
                    />
                  ) : planTab === "overview" || planTab === "steps" ? (
                    <ol className="workflow-map" aria-label="ขั้นตอนในแผน">
                      {steps.map((step, i) => (
                        <li key={i}>
                          <b>
                            {i + 1}. {step.title}
                          </b>
                          <small>
                            {agents.find((a) => a.id === step.agent_id)?.name ||
                              "Agent ไม่พร้อม"}{" "}
                            ·{" "}
                            {step.depends_on.length
                              ? `รอขั้น ${step.depends_on.map((d) => d + 1).join(", ")}`
                              : "เริ่มต้น"}
                          </small>
                          <details>
                            <summary>ข้อตกลงส่งมอบ</summary>
                            <p>{step.description}</p>
                            <p>ผลงาน: {step.output_contract || "—"}</p>
                            <p>
                              เกณฑ์ตรวจรับ: {step.acceptance_criteria || "—"}
                            </p>
                            <p>
                              ไฟล์บังคับ:{" "}
                              {step.required_files?.join(", ") || "—"}
                            </p>
                          </details>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {editable && planTab === "steps" && (
                    <div className="plan-save-bar">
                      <span>
                        {drafts[p.id]
                          ? "แก้ไขแล้ว — ยังไม่บันทึก"
                          : "ร่างล่าสุดบันทึกแล้ว"}
                      </span>
                      <button
                        className="primary"
                        disabled={busy || !drafts[p.id] || !readiness.assigned}
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/workspaces/${wid}/plans/${p.id}`,
                              { goal: p.goal, steps, version: p.version },
                              "PUT",
                            );
                            setDrafts((d) => {
                              const next = { ...d };
                              delete next[p.id];
                              return next;
                            });
                            await load();
                            ctx.setMessage("บันทึกร่างแผนแล้ว");
                          })
                        }
                      >
                        บันทึกการแก้ไข
                      </button>
                    </div>
                  )}
                  {editable && planTab === "start" && (
                    <>
                      <div className="plan-start-checks">
                        <h4>ก่อนเริ่มทีม</h4>
                        <p>{readiness.hasSteps ? "✓" : "○"} มีขั้นตอนในแผน</p>
                        <p>
                          {readiness.assigned ? "✓" : "○"} ทุกขั้นมีชื่องานและ
                          Agent ที่พร้อมทำงาน
                        </p>
                        <p>
                          {readiness.saved ? "✓" : "○"} บันทึกการแก้ไขล่าสุดแล้ว
                        </p>
                        <p>
                          เมื่อเริ่ม ระบบใช้โควตา AI ของบัญชีที่เชื่อมไว้
                          งานถัดไปรอผู้ตรวจตาม Workflow
                          งานปลายทางให้เจ้าของตรวจรับ
                        </p>
                      </div>
                      <details className="plan-context-settings">
                        <summary>ตัวเลือกการใช้ Knowledge</summary>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={!!focused[p.id]}
                            onChange={(e) =>
                              setFocused((v) => ({
                                ...v,
                                [p.id]: e.target.checked,
                              }))
                            }
                          />
                          ทดลองเลือก Knowledge ตามงานและใช้ใบส่งต่อที่ผ่านตรวจ ·
                          เก็บ Skill ครบทุกขั้น
                        </label>
                      </details>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={!!approved[p.id]}
                          onChange={(e) =>
                            setApproved((v) => ({
                              ...v,
                              [p.id]: e.target.checked,
                            }))
                          }
                        />
                        ฉันตรวจแผนแล้ว และอนุญาตให้ใช้โควตาสมาชิกทั้งงานผลิต
                        งานตรวจโดย Agent และการส่งแก้ตามขีดจำกัด
                      </label>
                      <button
                        className="primary"
                        disabled={busy || !approved[p.id] || !readiness.ready}
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/workspaces/${wid}/plans/${p.id}/approve`,
                              {
                                version: p.version,
                                billing_acknowledged: true,
                                context_format: focused[p.id]
                                  ? "focused"
                                  : "compact",
                              },
                            );
                            await load();
                            await after();
                          })
                        }
                      >
                        อนุมัติและเริ่มทีม
                      </button>
                    </>
                  )}
                  {planTab === "overview" &&
                    canWrite &&
                    p.created_by === user.id &&
                    p.status !== "cancelled" && (
                      <details className="plan-management">
                        <summary>จัดการแผน</summary>
                        <p>
                          หยุดการเริ่มงานถัดไปและขอยกเลิกงานที่กำลังทำ
                          ผลงานเดิมยังคงอยู่
                        </p>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                "หยุดแผนนี้และงานที่ยังไม่เสร็จใช่ไหม?",
                              )
                            )
                              return;
                            run(async () => {
                              await api(
                                `/workspaces/${wid}/plans/${p.id}/cancel`,
                                {},
                              );
                              await load();
                              await after();
                            });
                          }}
                        >
                          หยุดแผนนี้
                        </button>
                      </details>
                    )}
                  {planTab === "tasks" && (
                    <div className="list plan-task-list">
                      {!tasks.length && (
                        <p className="muted">
                          ยังไม่มีงาน — งานจะปรากฏหลังอนุมัติเริ่มทีม
                        </p>
                      )}
                      {data.tasks
                        .filter((t) => (t as any).plan_id === p.id)
                        .map((t) => (
                          <div className="list-row" key={t.id}>
                            <span>
                              {t.review_for_task_id ? "งานตรวจ · " : ""}
                              {t.title} · {statusLabel[t.status]}
                              {t.review_state === "waiting_agent"
                                ? " · รอหัวหน้าตรวจ"
                                : t.review_state === "needs_owner"
                                  ? " · ต้องให้เจ้าของตัดสินใจ"
                                  : ""}
                              {t.status === "queued"
                                ? " · รอตรวจรับงานก่อนหน้าหรือรอเครื่อง"
                                : ""}
                            </span>
                            <button onClick={() => run(() => showTask(t))}>
                              เปิดงาน
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </section>
              );
            })}
          {!plans.length && (
            <section className="panel plans-empty">
              <h3>เริ่มจาก Workflow ที่เตรียมไว้ได้เลย</h3>
              <p>
                เลือกแม่แบบแล้วกรอกเป้าหมาย
                จากนั้นกลับมาตรวจและอนุมัติที่หน้านี้
              </p>
              <button
                className="primary"
                onClick={() => ctx.setPage("workflows")}
              >
                ไปเลือก Workflow
              </button>
            </section>
          )}
          {!!plans.length &&
            !plans.some(
              (p) => planFilter === "all" || p.status === planFilter,
            ) && <p className="muted">ไม่มีแผนในสถานะนี้</p>}
        </div>
      )}
    </>
  );
}
