import { ProjectsPanel, type Project } from "./ProjectsPanel";
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
        <>
          <section className="panel">
            <h2>ให้ทีมช่วยกันทำเป้าหมาย</h2>
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
          {plans.map((p) => {
            const steps = drafts[p.id] ?? p.steps,
              editable =
                canWrite && p.created_by === user.id && p.status === "draft";
            return (
              <section key={p.id} className="panel">
                <div className="panel-heading">
                  <h3>{p.goal}</h3>
                  <span className="tag">
                    {p.status === "draft"
                      ? "ร่างแผน"
                      : p.status === "approved"
                        ? "อนุมัติแล้ว"
                        : "ยกเลิกแล้ว"}
                  </span>
                </div>
                {p.status !== "draft" && (
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
                        m === "focused" ? "เลือกตามงาน (ทดลอง)" : "เต็มตามเดิม",
                      )
                      .join(" / ") || "ยังไม่มีงาน"}
                  </p>
                )}
                <PlanUsage wid={wid} id={p.id} />
                {p.planner_task_id && (
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
                {p.workflow_snapshot && (
                  <p className="notice">
                    Workflow: {p.workflow_snapshot.title} · v
                    {p.workflow_snapshot.version + 1} ·
                    แผนนี้เก็บสำเนาแม่แบบไว้แล้ว
                  </p>
                )}
                {editable ? (
                  <StepEditor
                    steps={steps}
                    onChange={(next) => edit(p.id, next)}
                    agents={agents}
                    skills={skills}
                    bindings={organization.bindings}
                    reviewers={reviewers}
                    disabled={busy}
                  />
                ) : (
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
                          <p>เกณฑ์ตรวจรับ: {step.acceptance_criteria || "—"}</p>
                          <p>
                            ไฟล์บังคับ: {step.required_files?.join(", ") || "—"}
                          </p>
                        </details>
                      </li>
                    ))}
                  </ol>
                )}
                {editable && (
                  <>
                    <div className="actions">
                      <button
                        disabled={busy || !steps.length}
                        onClick={() =>
                          run(async () => {
                            await api(
                              `/workspaces/${wid}/plans/${p.id}`,
                              { goal: p.goal, steps, version: p.version },
                              "PUT",
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
                        บันทึกร่าง
                      </button>
                    </div>
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
                      ฉันตรวจแผนแล้ว และอนุญาตให้ใช้โควตาสมาชิกตามงานในแผน
                    </label>
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        !approved[p.id] ||
                        !p.steps.length ||
                        !!drafts[p.id]
                      }
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
                {canWrite &&
                  p.created_by === user.id &&
                  p.status !== "cancelled" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api(
                            `/workspaces/${wid}/plans/${p.id}/cancel`,
                            {},
                          );
                          await load();
                          await after();
                        })
                      }
                    >
                      หยุดแผนนี้
                    </button>
                  )}
                <div className="list">
                  {data.tasks
                    .filter((t) => (t as any).plan_id === p.id)
                    .map((t) => (
                      <div className="list-row" key={t.id}>
                        <span>
                          {t.title} · {statusLabel[t.status]}
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
              </section>
            );
          })}
          {!plans.length && <p className="muted">ยังไม่มีแผนทีม</p>}
        </>
      )}
    </>
  );
}
