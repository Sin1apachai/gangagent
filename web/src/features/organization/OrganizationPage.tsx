import { FormTabs } from "../../shared/FormTabs";
import { OrgTree } from "./OrgTree";
import { AgentOrganization } from "./AgentOrganization";
import React, { useEffect, useState, useRef } from "react";
import { api } from "../../shared/api";
import type { OfficeController } from "../../application/useOfficeController";
import type { Agent } from "../../shared/types";
import type { Skill, Workflow, Organization, Reviewer, Binding } from "./types";
import { emptyStep } from "./types";
import { StepEditor } from "./StepEditor";
import "./organization.css";
const blankSkill: Skill = {
  id: "",
  version: 0,
  title: "",
  description: "",
  instructions: "",
  input_contract: "",
  output_contract: "",
  acceptance_criteria: "",
};
const blankWorkflow = (): Workflow => ({
  id: "",
  version: 0,
  title: "",
  description: "",
  steps: [emptyStep()],
});
export function OrganizationPage({ ctx }: { ctx: OfficeController }) {
  const { wid, page, canWrite, canManage, busy, run } = ctx;
  const active = ["skills", "organization", "workflows"].includes(page);
  const [skills, setSkills] = useState<Skill[]>([]),
    [org, setOrg] = useState<Organization>({ agents: [], bindings: [] }),
    [workflows, setWorkflows] = useState<Workflow[]>([]),
    [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [skill, setSkill] = useState<Skill | null>(null),
    [workflow, setWorkflow] = useState<Workflow | null>(null),
    [selected, setSelected] = useState<Agent | null>(null),
    [history, setHistory] = useState<{ kind: string; rows: any[] } | null>(
      null,
    ),
    [launch, setLaunch] = useState<{
      workflow: Workflow;
      goal: string;
      request_id: string;
    } | null>(null),
    [archived, setArchived] = useState(false);
  const [skillTab, setSkillTab] = useState("general"),
    [workflowTab, setWorkflowTab] = useState("general");
  useEffect(() => setSkillTab("general"), [skill?.id]);
  useEffect(() => setWorkflowTab("general"), [workflow?.id]);
  const generation = useRef(0);
  async function load() {
    const g = ++generation.current;
    const [s, o, w, r] = await Promise.all([
      api<Skill[]>(`/workspaces/${wid}/skills`),
      api<Organization>(`/workspaces/${wid}/organization`),
      api<Workflow[]>(`/workspaces/${wid}/workflows`),
      api<Reviewer[]>(`/workspaces/${wid}/reviewers`),
    ]);
    if (g !== generation.current) return;
    setSkills(s);
    setOrg(o);
    setWorkflows(w);
    setReviewers(r);
  }
  useEffect(() => {
    setSkill(null);
    setWorkflow(null);
    setSelected(null);
    setHistory(null);
    setLaunch(null);
    setSkills([]);
    setOrg({ agents: [], bindings: [] });
    setWorkflows([]);
    if (active && wid) run(load);
    return () => {
      generation.current++;
    };
  }, [wid, active]);
  const agentRevision =
    ctx.data?.agents.map((a) => `${a.id}:${a.version}`).join("|") ?? "";
  useEffect(() => {
    if (active && wid) load().catch((e) => ctx.setError(String(e)));
  }, [agentRevision]);
  useEffect(() => {
    if (!active || !ctx.orgAgentId) return;
    const agent = org.agents.find((a) => a.id === ctx.orgAgentId);
    if (agent) {
      setSelected(agent);
      ctx.setOrgAgentId(null);
    }
  }, [active, ctx.orgAgentId, org.agents]);
  if (!active || !wid) return null;
  const base = `/workspaces/${wid}`;
  const archive = async (kind: string, id: string, restore: boolean) => {
    await api(
      `${base}/${kind}/${id}${restore ? "/restore" : ""}`,
      restore ? {} : undefined,
      restore ? "POST" : "DELETE",
    );
    await load();
  };
  const showHistory = (kind: string, id: string) =>
    run(async () =>
      setHistory({ kind, rows: await api<any[]>(`${base}/${kind}/${id}`) }),
    );
  return (
    <div className="organization-feature">
      <div className="org-toolbar">
        <div className="org-tabs">
          {[
            ["skills", "✦ Skills"],
            ["organization", "♧ โครงสร้างทีม"],
            ["workflows", "⇢ Workflow"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => ctx.setPage(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button disabled={busy} onClick={() => run(load)}>
          รีเฟรช
        </button>
      </div>
      {page === "skills" && (
        <>
          <section className="panel org-intro">
            <div>
              <span className="eyebrow">TEAM PLAYBOOK</span>
              <h2>ความเชี่ยวชาญที่ทีมใช้ร่วมกัน</h2>
              <p>
                เขียนวิธีทำงานและเกณฑ์ส่งมอบ แล้วมอบหมายให้แต่ละ Agent
                ทุกการแก้ไขเก็บเป็นเวอร์ชันใหม่
              </p>
            </div>
            {canWrite && (
              <button
                className="primary"
                onClick={() => setSkill({ ...blankSkill })}
              >
                ＋ สร้าง Skill
              </button>
            )}
          </section>
          <label className="org-check">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            แสดงรายการที่เก็บถาวร
          </label>
          <div className="org-grid">
            {skills
              .filter((s) => !!s.deleted_at === archived)
              .map((s) => (
                <article className="panel skill-card" key={s.id}>
                  <span className="skill-icon">✦</span>
                  <div className="org-card-title">
                    <h3>{s.title}</h3>
                    <span className="tag">v{s.version + 1}</span>
                  </div>
                  <p>{s.description || "ยังไม่มีคำอธิบาย"}</p>
                  <small>
                    มอบหมายให้{" "}
                    {org.bindings.filter((b) => b.skill_id === s.id).length}{" "}
                    Agent
                  </small>
                  <div className="actions">
                    <button onClick={() => setSkill({ ...s })}>
                      {canWrite && !s.deleted_at ? "แก้ไข" : "ดูรายละเอียด"}
                    </button>
                    <button onClick={() => showHistory("skills", s.id)}>
                      ประวัติเวอร์ชัน
                    </button>
                    {canWrite && (
                      <button
                        onClick={() =>
                          run(() => archive("skills", s.id, !!s.deleted_at))
                        }
                      >
                        {s.deleted_at ? "กู้คืน" : "เก็บถาวร"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
          </div>
          {!skills.some((s) => !!s.deleted_at === archived) && (
            <section className="empty">
              <h3>
                {archived
                  ? "ไม่มี Skill ที่เก็บถาวร"
                  : "เริ่มเขียน Skill ของทีม"}
              </h3>
              <p>ระบุวิธีทำงาน ข้อมูลที่ต้องใช้ ผลลัพธ์ และเกณฑ์ตรวจรับ</p>
            </section>
          )}
        </>
      )}
      {page === "organization" && (
        <>
          <section className="panel org-intro">
            <div>
              <span className="eyebrow">WHO DOES WHAT</span>
              <h2>บทบาทชัดเจน ส่งต่องานได้ถูกคน</h2>
              <p>
                คลิกการ์ด Agent เพื่อกรอกฝ่าย หน้าที่รับผิดชอบ ขอบเขตการตัดสินใจ
                หัวหน้าทีม และ Skill · เส้นในแผนผังแสดงสายรายงาน
                ส่วนลำดับงานกำหนดใน Workflow
              </p>
            </div>
            <button
              disabled={!canWrite}
              onClick={() => ctx.setModal({ kind: "agent" })}
            >
              ＋ เพิ่ม Agent
            </button>
          </section>
          <OrgTree
            agents={org.agents}
            bindings={org.bindings}
            onSelect={setSelected}
          />
          {!org.agents.length && (
            <section className="empty">
              <h3>ยังไม่มี Agent ในทีม</h3>
              <p>เพิ่ม Agent แล้วจัดสายรายงานและความเชี่ยวชาญ</p>
            </section>
          )}
        </>
      )}
      {page === "workflows" && (
        <>
          <section className="panel org-intro">
            <div>
              <span className="eyebrow">HOW WORK FLOWS</span>
              <h2>ออกแบบกระบวนการ แล้วใช้ซ้ำได้</h2>
              <p>
                กำหนดผู้รับผิดชอบ ข้อมูลรับเข้า ผลงาน และจุดตรวจรับ
                งานถัดไปเริ่มเมื่อทุกขั้นที่ต้องรอผ่านตรวจรับแล้ว
              </p>
            </div>
            {canWrite && (
              <button
                className="primary"
                onClick={() => setWorkflow(blankWorkflow())}
              >
                ＋ สร้าง Workflow
              </button>
            )}
          </section>
          <label className="org-check">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => setArchived(e.target.checked)}
            />
            แสดงรายการที่เก็บถาวร
          </label>
          <div className="org-grid">
            {workflows
              .filter((w) => !!w.deleted_at === archived)
              .map((w) => (
                <article className="panel workflow-card" key={w.id}>
                  <div className="org-card-title">
                    <h3>{w.title}</h3>
                    <span className="tag">v{w.version + 1}</span>
                  </div>
                  <p>{w.description || "ยังไม่มีคำอธิบาย"}</p>
                  <ol className="workflow-map">
                    {w.steps.map((s, i) => (
                      <li key={i}>
                        <b>
                          {i + 1}. {s.title}
                        </b>
                        <small>
                          {org.agents.find((a) => a.id === s.agent_id)?.name ||
                            "Agent ไม่พร้อม"}{" "}
                          ·{" "}
                          {s.depends_on.length
                            ? `รอ ${s.depends_on.map((d) => d + 1).join(", ")}`
                            : "เริ่มต้น"}
                        </small>
                      </li>
                    ))}
                  </ol>
                  <div className="actions">
                    {canWrite && !w.deleted_at && (
                      <button
                        className="primary"
                        onClick={() =>
                          setLaunch({
                            workflow: w,
                            goal: "",
                            request_id: crypto.randomUUID(),
                          })
                        }
                      >
                        ใช้สร้างแผน
                      </button>
                    )}
                    <button onClick={() => setWorkflow(structuredClone(w))}>
                      {canWrite && !w.deleted_at ? "แก้ไข" : "ดูรายละเอียด"}
                    </button>
                    <button onClick={() => showHistory("workflows", w.id)}>
                      ประวัติเวอร์ชัน
                    </button>
                    {canWrite && (
                      <button
                        onClick={() =>
                          run(() => archive("workflows", w.id, !!w.deleted_at))
                        }
                      >
                        {w.deleted_at ? "กู้คืน" : "เก็บถาวร"}
                      </button>
                    )}
                  </div>
                </article>
              ))}
          </div>
          {!workflows.some((w) => !!w.deleted_at === archived) && (
            <section className="empty">
              <h3>
                {archived ? "ไม่มี Workflow ที่เก็บถาวร" : "ยังไม่มี Workflow"}
              </h3>
              <p>
                เริ่มจากหนึ่งขั้นตอน
                แล้วเพิ่มงานที่ต้องส่งต่อหรืองานที่ทำคู่ขนานกัน
              </p>
            </section>
          )}
        </>
      )}
      {skill && (
        <div className="overlay">
          <section
            className="modal org-modal"
            role="dialog"
            aria-modal="true"
            aria-label="รายละเอียด Skill"
          >
            <button
              className="close"
              onClick={() => setSkill(null)}
              aria-label="ปิด"
            >
              ×
            </button>
            {ctx.error && (
              <p className="error" role="alert">
                {ctx.error}
              </p>
            )}
            <span className="eyebrow">SKILL LIBRARY</span>
            <h2>
              {skill.id
                ? `${skill.title} · v${skill.version + 1}`
                : "สร้าง Skill"}
            </h2>
            <p>งานที่เริ่มแล้วคงคำสั่งเวอร์ชันเดิม การแก้ไขมีผลกับงานใหม่</p>
            <FormTabs
              label="รายละเอียด Skill"
              value={skillTab}
              onChange={setSkillTab}
              tabs={[
                { id: "general", label: "ข้อมูลทั่วไป" },
                { id: "instructions", label: "วิธีทำงาน" },
                { id: "delivery", label: "การส่งมอบ" },
              ]}
            />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!skill.title.trim()) {
                  setSkillTab("general");
                  ctx.setError("กรุณาระบุชื่อ Skill");
                  return;
                }
                if (!skill.instructions.trim()) {
                  setSkillTab("instructions");
                  ctx.setError("กรุณาระบุวิธีทำงานของ Skill");
                  return;
                }
                run(async () => {
                  await api(
                    `${base}/skills${skill.id ? `/${skill.id}` : ""}`,
                    skill,
                    skill.id ? "PUT" : "POST",
                  );
                  await load();
                  setSkill(null);
                  ctx.setMessage("บันทึก Skill แล้ว");
                });
              }}
            >
              <fieldset disabled={!canWrite || !!skill.deleted_at || busy}>
                {(
                  [
                    ["title", "ชื่อ Skill", 120],
                    ["description", "คำอธิบาย", 2000],
                    ["instructions", "วิธีทำงาน / คำสั่ง", 10000],
                    ["input_contract", "ข้อมูลรับเข้า", 3000],
                    ["output_contract", "ผลลัพธ์ที่ต้องส่ง", 3000],
                    ["acceptance_criteria", "เกณฑ์ตรวจรับ", 3000],
                  ] as const
                )
                  .filter(([key]) =>
                    skillTab === "general"
                      ? ["title", "description"].includes(key)
                      : skillTab === "instructions"
                        ? key === "instructions"
                        : [
                            "input_contract",
                            "output_contract",
                            "acceptance_criteria",
                          ].includes(key),
                  )
                  .map(([key, label, max]) => (
                    <label key={key}>
                      {label}
                      {key === "title" ? (
                        <input
                          required
                          maxLength={max}
                          value={skill[key]}
                          onChange={(e) =>
                            setSkill({ ...skill, [key]: e.target.value })
                          }
                        />
                      ) : (
                        <textarea
                          required={key === "instructions"}
                          maxLength={max}
                          rows={key === "instructions" ? 6 : 3}
                          value={skill[key]}
                          onChange={(e) =>
                            setSkill({ ...skill, [key]: e.target.value })
                          }
                        />
                      )}
                    </label>
                  ))}
                {canWrite && !skill.deleted_at && (
                  <button className="primary">
                    {skill.id ? "บันทึกเป็นเวอร์ชันใหม่" : "สร้าง Skill"}
                  </button>
                )}
              </fieldset>
            </form>
          </section>
        </div>
      )}
      {selected && (
        <AgentOrganization
          key={selected.id}
          agent={selected}
          ctx={ctx}
          org={org}
          skills={skills}
          onClose={() => setSelected(null)}
          onSaved={async () => {
            await load();
            await ctx.refresh();
            setSelected(null);
          }}
        />
      )}
      {workflow && (
        <div className="overlay">
          <section
            className="modal org-modal wide"
            role="dialog"
            aria-modal="true"
            aria-label="ออกแบบ Workflow"
          >
            <button
              className="close"
              aria-label="ปิด"
              onClick={() => setWorkflow(null)}
            >
              ×
            </button>
            {ctx.error && (
              <p className="error" role="alert">
                {ctx.error}
              </p>
            )}
            <span className="eyebrow">WORKFLOW DESIGNER</span>
            <h2>
              {workflow.id
                ? `${workflow.title} · v${workflow.version + 1}`
                : "สร้าง Workflow"}
            </h2>
            <p>
              บันทึกแม่แบบก่อน จากนั้นใช้สร้างแผนเพื่อตรวจและอนุมัติ
              งานไม่เริ่มทันที
            </p>
            <FormTabs
              label="ออกแบบ Workflow"
              value={workflowTab}
              onChange={setWorkflowTab}
              tabs={[
                { id: "general", label: "ข้อมูลทั่วไป" },
                { id: "steps", label: `ขั้นตอน (${workflow.steps.length})` },
              ]}
            />
            <form
              onInvalidCapture={(e) => {
                const input = e.target as HTMLInputElement;
                setWorkflowTab(
                  input.closest(".workflow-steps") ? "steps" : "general",
                );
                requestAnimationFrame(() => input.focus());
              }}
              onSubmit={(e) => {
                e.preventDefault();
                if (!workflow.title.trim()) {
                  setWorkflowTab("general");
                  ctx.setError("กรุณาระบุชื่อ Workflow");
                  return;
                }
                if (
                  !workflow.steps.length ||
                  workflow.steps.some((s) => !s.title.trim() || !s.agent_id)
                ) {
                  setWorkflowTab("steps");
                  ctx.setError("กรุณากำหนดชื่อและ Agent ให้ครบทุกขั้นตอน");
                  return;
                }
                run(async () => {
                  await api(
                    `${base}/workflows${workflow.id ? `/${workflow.id}` : ""}`,
                    workflow,
                    workflow.id ? "PUT" : "POST",
                  );
                  await load();
                  setWorkflow(null);
                  ctx.setMessage("บันทึก Workflow แล้ว");
                });
              }}
            >
              <fieldset disabled={busy}>
                <div
                  role="tabpanel"
                  aria-label="ข้อมูลทั่วไป"
                  hidden={workflowTab !== "general"}
                >
                  <label>
                    ชื่อ Workflow
                    <input
                      disabled={!canWrite || !!workflow.deleted_at}
                      required
                      maxLength={160}
                      value={workflow.title}
                      onChange={(e) =>
                        setWorkflow({ ...workflow, title: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    คำอธิบาย
                    <textarea
                      disabled={!canWrite || !!workflow.deleted_at}
                      maxLength={10000}
                      value={workflow.description}
                      onChange={(e) =>
                        setWorkflow({
                          ...workflow,
                          description: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div
                  role="tabpanel"
                  aria-label="ขั้นตอน"
                  hidden={workflowTab !== "steps"}
                >
                  <StepEditor
                    disabled={!canWrite || !!workflow.deleted_at || busy}
                    steps={workflow.steps}
                    onChange={(steps) => setWorkflow({ ...workflow, steps })}
                    agents={org.agents}
                    skills={skills}
                    bindings={org.bindings}
                    reviewers={reviewers}
                  />
                </div>
                {canWrite && !workflow.deleted_at && (
                  <button className="primary" disabled={!workflow.steps.length}>
                    {workflow.id ? "บันทึกเป็นเวอร์ชันใหม่" : "สร้าง Workflow"}
                  </button>
                )}
              </fieldset>
            </form>
          </section>
        </div>
      )}
      {launch && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="ใช้ Workflow สร้างแผน"
          >
            <button
              className="close"
              aria-label="ปิด"
              onClick={() => setLaunch(null)}
            >
              ×
            </button>
            {ctx.error && (
              <p className="error" role="alert">
                {ctx.error}
              </p>
            )}
            <h2>ใช้ {launch.workflow.title}</h2>
            <p>
              เวอร์ชัน {launch.workflow.version + 1} · สร้างเป็นแผนฉบับร่าง
              คุณต้องอนุมัติแผนก่อนเริ่มงาน
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api(
                    `${base}/workflows/${launch.workflow.id}/instantiate`,
                    {
                      version: launch.workflow.version,
                      goal: launch.goal,
                      request_id: launch.request_id,
                    },
                  );
                  setLaunch(null);
                  ctx.setPage("plans");
                  ctx.setMessage(
                    "สร้างแผนแล้ว ตรวจขั้นตอนและอนุมัติในหน้าแผนทีม",
                  );
                });
              }}
            >
              <label>
                เป้าหมายงานครั้งนี้
                <textarea
                  required
                  value={launch.goal}
                  maxLength={20000}
                  onChange={(e) =>
                    setLaunch({ ...launch, goal: e.target.value })
                  }
                />
              </label>
              <button className="primary" disabled={busy}>
                สร้างแผนฉบับร่าง
              </button>
            </form>
          </section>
        </div>
      )}
      {history && (
        <div className="overlay">
          <section
            className="modal org-modal"
            role="dialog"
            aria-modal="true"
            aria-label="ประวัติเวอร์ชัน"
          >
            <button
              className="close"
              aria-label="ปิด"
              onClick={() => setHistory(null)}
            >
              ×
            </button>
            <h2>ประวัติเวอร์ชัน</h2>
            <p>ประวัติที่บันทึกแล้วไม่ถูกแก้ทับ</p>
            {history.rows.map((row) => (
              <details className="org-history" key={row.version}>
                <summary>
                  {row.title} · v{row.version + 1}
                </summary>
                <p>{row.description}</p>
                {history.kind === "skills" ? (
                  <>
                    <h4>วิธีทำงาน</h4>
                    <pre>{row.instructions}</pre>
                    <h4>ข้อมูลรับเข้า</h4>
                    <pre>{row.input_contract}</pre>
                    <h4>ผลลัพธ์</h4>
                    <pre>{row.output_contract}</pre>
                    <h4>เกณฑ์ตรวจรับ</h4>
                    <pre>{row.acceptance_criteria}</pre>
                  </>
                ) : (
                  <>
                    <ol>
                      {row.steps.map((s: any, i: number) => (
                        <li key={i}>
                          <b>{s.title}</b>
                          <p>{s.description}</p>
                          <small>
                            รอขั้น{" "}
                            {(s.depends_on || [])
                              .map((d: number) => d + 1)
                              .join(", ") || "—"}
                          </small>
                        </li>
                      ))}
                    </ol>
                    {canWrite && (
                      <button
                        onClick={() => {
                          setLaunch({
                            workflow: { ...row, id: row.workflow_id },
                            goal: "",
                            request_id: crypto.randomUUID(),
                          });
                          setHistory(null);
                        }}
                      >
                        ใช้เวอร์ชันนี้สร้างแผน
                      </button>
                    )}
                  </>
                )}
              </details>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
