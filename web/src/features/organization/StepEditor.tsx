import React, { useState } from "react";
import { FormTabs } from "../../shared/FormTabs";
import type { Agent } from "../../shared/types";
import type { Step, Skill, Binding, Reviewer } from "./types";
import { nextStep, removeStep, suggestedTitle } from "./stepDraft";
export function StepEditor({
  steps,
  onChange,
  agents,
  skills,
  bindings,
  reviewers,
  disabled = false,
}: {
  steps: Step[];
  onChange: (s: Step[]) => void;
  agents: Agent[];
  skills: Skill[];
  bindings: Binding[];
  reviewers: Reviewer[];
  disabled?: boolean;
}) {
  const [activeStep, setActiveStep] = useState(0),
    [section, setSection] = useState("delivery");
  const [customOrder, setCustomOrder] = useState<number | null>(null);
  const current = Math.min(activeStep, Math.max(0, steps.length - 1));
  const change = (i: number, patch: Partial<Step>) =>
    onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div
      className="workflow-steps"
      onInvalidCapture={(e) => {
        const input = e.target as HTMLInputElement;
        const parent = input.closest("[data-step]") as HTMLElement | null;
        setActiveStep(Number(parent?.dataset.step || 0));
        setSection("delivery");
        requestAnimationFrame(() => input.focus());
      }}
    >
      <p className="workflow-easy-help">
        เลือก Agent แล้วตั้งชื่องาน แต่ละขั้นจะรอขั้นก่อนหน้าผ่านตรวจรับให้เอง
        ปรับงานคู่ขนานหรือรายละเอียดเพิ่มเติมได้ภายหลัง
      </p>
      <div className="workflow-step-nav" aria-label="เลือกขั้นตอนที่ต้องการแก้">
        {steps.map((s, i) => (
          <button
            type="button"
            key={i}
            aria-pressed={current === i}
            className={current === i ? "active" : ""}
            onClick={() => {
              setActiveStep(i);
              setSection("delivery");
            }}
          >
            <b>
              {i + 1}. {s.title || "เลือกผู้รับผิดชอบ"}
            </b>
            <small>
              {agents.find((a) => a.id === s.agent_id)?.name ||
                "ยังไม่ได้เลือก Agent"}
            </small>
            <small>
              {s.depends_on.length
                ? `รอ ${s.depends_on.map((d) => d + 1).join(", ")}`
                : "เริ่มพร้อมงานแรก"}
            </small>
          </button>
        ))}
      </div>
      {steps.map((s, i) => (
        <fieldset
          data-step={i}
          hidden={i !== current}
          key={i}
          className="workflow-step"
        >
          <legend>ขั้นตอน {i + 1}</legend>
          <div role="tabpanel" aria-label="งานและผู้รับผิดชอบ">
            <div className="org-fields">
              <label>
                ชื่องาน
                <input
                  disabled={disabled}
                  required
                  maxLength={200}
                  value={s.title}
                  onChange={(e) => change(i, { title: e.target.value })}
                />
              </label>
              <label>
                Agent ผู้รับผิดชอบ
                <select
                  disabled={disabled}
                  required
                  value={s.agent_id}
                  onChange={(e) =>
                    change(i, {
                      agent_id: e.target.value,
                      skill_ids: [],
                      title: s.title.trim()
                        ? s.title
                        : suggestedTitle(
                            agents.find((a) => a.id === e.target.value)?.role ||
                              "",
                          ),
                    })
                  }
                >
                  <option value="">เลือก Agent</option>
                  {agents
                    .filter((a) => a.enabled)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.role}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              บอกให้ทำอะไรเพิ่มเติม (ไม่บังคับ)
              <textarea
                disabled={disabled}
                rows={3}
                placeholder="ใช้คำสั่งประจำบทบาทและ Skill ได้เลย หรือระบุโจทย์เฉพาะของขั้นนี้"
                value={s.description}
                maxLength={20000}
                onChange={(e) => change(i, { description: e.target.value })}
              />
            </label>
          </div>
          <label className="workflow-order-label">
            เริ่มงานเมื่อใด
            <select
              disabled={disabled}
              value={
                customOrder === i ||
                (s.depends_on.length &&
                  !(
                    i > 0 &&
                    s.depends_on.length === 1 &&
                    s.depends_on[0] === i - 1
                  ))
                  ? "custom"
                  : s.depends_on.length
                    ? "previous"
                    : "start"
              }
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setCustomOrder(i);
                  return;
                }
                setCustomOrder(null);
                change(i, {
                  depends_on: e.target.value === "previous" ? [i - 1] : [],
                });
              }}
            >
              {i > 0 && (
                <option value="previous">หลังขั้นก่อนหน้าผ่านตรวจรับ</option>
              )}
              <option value="start">เริ่มพร้อมงานแรกหลังอนุมัติแผน</option>
              {i > 1 && <option value="custom">เลือกขั้นที่ต้องรอเอง</option>}
            </select>
          </label>
          {(customOrder === i ||
            (s.depends_on.length > 0 &&
              !(s.depends_on.length === 1 && s.depends_on[0] === i - 1))) &&
            i > 0 && (
              <div className="org-choice" aria-label="เลือกงานที่ต้องรอ">
                {steps.slice(0, i).map((prev, j) => (
                  <label key={j}>
                    <input
                      disabled={disabled}
                      type="checkbox"
                      checked={s.depends_on.includes(j)}
                      onChange={(e) =>
                        change(i, {
                          depends_on: e.target.checked
                            ? [...s.depends_on, j]
                            : s.depends_on.filter((d) => d !== j),
                        })
                      }
                    />
                    {j + 1}. {prev.title || "ยังไม่มีชื่อ"}
                  </label>
                ))}
              </div>
            )}
          <p className="workflow-skill-hint">
            ใช้คำสั่งประจำบทบาทและ Skill ที่ผูกกับ Agent โดยอัตโนมัติ ·
            ผู้อนุมัติแผนตรวจรับเป็นค่าเริ่มต้น
          </p>
          <details className="workflow-advanced" key={`advanced-${i}`}>
            <summary>
              รายละเอียดเพิ่มเติม · ผลงาน เกณฑ์ตรวจรับ และ Skill
            </summary>
            <p className="workflow-easy-help">
              ส่วนนี้ไม่จำเป็นต้องกรอกทุกช่อง ข้อมูลที่เคยตั้งไว้ยังคงอยู่
            </p>
            <FormTabs
              label={`ตั้งค่าเพิ่มเติมขั้น ${i + 1}`}
              value={section}
              onChange={setSection}
              tabs={[
                { id: "delivery", label: "ผลงานและตรวจรับ" },
                { id: "dependencies", label: "Skill ที่ต้องใช้" },
              ]}
            />
            <div
              role="tabpanel"
              aria-label="การส่งมอบ"
              hidden={section !== "delivery"}
            >
              <div className="org-fields">
                <label>
                  ข้อมูลที่ต้องได้รับ
                  <textarea
                    disabled={disabled}
                    value={s.input_contract || ""}
                    maxLength={4000}
                    onChange={(e) =>
                      change(i, { input_contract: e.target.value })
                    }
                  />
                </label>
                <label>
                  ผลงานที่ต้องส่ง
                  <textarea
                    disabled={disabled}
                    value={s.output_contract || ""}
                    maxLength={4000}
                    onChange={(e) =>
                      change(i, { output_contract: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                เกณฑ์ตรวจรับ
                <textarea
                  disabled={disabled}
                  value={s.acceptance_criteria || ""}
                  maxLength={10000}
                  onChange={(e) =>
                    change(i, { acceptance_criteria: e.target.value })
                  }
                />
              </label>
              <div className="org-fields">
                <label>
                  ไฟล์ที่ต้องมี (หนึ่งชื่อ/บรรทัด)
                  <textarea
                    disabled={disabled}
                    placeholder="report.md"
                    value={(s.required_files || []).join("\n")}
                    onChange={(e) =>
                      change(i, {
                        required_files: e.target.value
                          .split("\n")
                          .filter(Boolean),
                      })
                    }
                  />
                  <small>
                    ใช้เส้นทางภายในผลงาน เช่น docs/report.md · สูงสุด 10 ไฟล์
                  </small>
                </label>
                <label>
                  ผู้ตรวจรับ
                  <select
                    disabled={disabled}
                    value={s.reviewer_id || ""}
                    onChange={(e) =>
                      change(i, { reviewer_id: e.target.value || null })
                    }
                  >
                    <option value="">ผู้อนุมัติแผน</option>
                    {reviewers.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <small>เจ้าของ Workspace และ Super Admin ตรวจรับแทนได้</small>
                </label>
              </div>
            </div>
            <div
              role="tabpanel"
              aria-label="Skill และลำดับงาน"
              hidden={section !== "dependencies"}
            >
              <div className="org-choice">
                <b>Skill ที่จำเป็น</b>
                {skills
                  .filter(
                    (k) =>
                      !k.deleted_at &&
                      bindings.some(
                        (b) => b.agent_id === s.agent_id && b.skill_id === k.id,
                      ),
                  )
                  .map((k) => (
                    <label key={k.id}>
                      <input
                        disabled={disabled}
                        type="checkbox"
                        checked={(s.skill_ids || []).includes(k.id)}
                        onChange={(e) =>
                          change(i, {
                            skill_ids: e.target.checked
                              ? [...(s.skill_ids || []), k.id]
                              : (s.skill_ids || []).filter((id) => id !== k.id),
                          })
                        }
                      />
                      {k.title}
                    </label>
                  ))}
                {!bindings.some((b) => b.agent_id === s.agent_id) && (
                  <small>กำหนด Skill ให้ Agent ในโครงสร้างทีมก่อน</small>
                )}
              </div>
            </div>
          </details>
          <button
            type="button"
            className="danger"
            disabled={disabled}
            onClick={() => {
              onChange(removeStep(steps, i));
              setActiveStep(Math.max(0, i - 1));
              setCustomOrder(null);
            }}
          >
            ลบขั้นตอน {i + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={disabled || steps.length >= 8}
        onClick={() => {
          setActiveStep(steps.length);
          setSection("delivery");
          setCustomOrder(null);
          onChange([...steps, nextStep(steps)]);
        }}
      >
        ＋ เพิ่มขั้นตอนถัดไป ({steps.length}/8)
      </button>
    </div>
  );
}
