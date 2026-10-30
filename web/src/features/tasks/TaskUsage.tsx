import type { OfficeController } from "../../application/useOfficeController";
import { api } from "../../shared/api";
import React from "react";
import type { Detail } from "../../shared/types";
function sources(
  raw: unknown,
): { id: string; title: string; version: number }[] {
  try {
    const rows = JSON.parse(String(raw));
    return Array.isArray(rows)
      ? rows.filter(
          (v) =>
            v &&
            typeof v.id === "string" &&
            typeof v.title === "string" &&
            typeof v.version === "number",
        )
      : [];
  } catch {
    return [];
  }
}
export function TaskUsage({
  detail,
  ctx,
}: {
  detail: Detail;
  ctx: OfficeController;
}) {
  const count = (v: unknown) =>
    typeof v === "number" ? v.toLocaleString() : "ไม่มีข้อมูล";
  const saved = detail.runs.reduce(
    (n, r) => n + Number(r.usage_metrics?.saved_formatting_bytes || 0),
    0,
  );
  const baseline = detail.runs.reduce(
    (n, r) => n + Number(r.usage_metrics?.baseline_app_prompt_bytes || 0),
    0,
  );
  const measured = detail.runs.filter(
    (r) => r.usage_metrics?.source === "provider",
  );
  const total = (key: string) => {
    const rows = measured.filter(
      (r) => typeof r.usage_metrics?.[key] === "number",
    );
    return rows.length
      ? `${rows.reduce((n, r) => n + Number(r.usage_metrics?.[key]), 0).toLocaleString()} (${rows.length}/${detail.runs.length} รอบ)`
      : "ไม่มีข้อมูล";
  };
  return (
    <section>
      {ctx.canWrite &&
        !detail.task.execution_requested &&
        !["running", "done", "cancelled"].includes(detail.task.status) && (
          <label>
            โหมดข้อมูลในการเริ่มครั้งถัดไป
            <select
              aria-label="โหมดข้อมูลในการเริ่มครั้งถัดไป"
              disabled={ctx.busy}
              value={detail.task.context_format || "compact"}
              onChange={(e) => {
                const context_format = e.target.value;
                ctx.run(async () => {
                  await api(
                    `/workspaces/${ctx.wid}/tasks/${detail.task.id}/context`,
                    { version: detail.task.version, context_format },
                    "PUT",
                  );
                  await ctx.after();
                });
              }}
            >
              <option value="compact">เต็มตามเดิม</option>
              <option value="focused">เลือกตามงาน (ทดลอง)</option>
              {detail.task.context_format === "pretty" && (
                <option value="pretty">แบบเทียบเดิม</option>
              )}
            </select>
            <small>
              เปลี่ยนได้เมื่องานหยุดรอเริ่ม หากกำลังรอตรวจ ให้ส่งกลับแก้ไขก่อน
              การเปลี่ยนโหมดไม่เริ่ม AI อัตโนมัติ
            </small>
          </label>
        )}
      <h3>การใช้ต่อรอบ · {detail.task.provider}</h3>
      <p>
        ลดเฉพาะรูปแบบ JSON ในข้อความที่แอปจัดเตรียม {saved.toLocaleString()}{" "}
        bytes
        {baseline > 0
          ? ` (${((100 * saved) / baseline).toFixed(1)}%)`
          : ""}{" "}
        โดยเก็บข้อมูล JSON ครบเดิม ตัวเลขนี้ไม่ใช่เปอร์เซ็นต์ลด token หรือโควตา
        Pro
      </p>
      <p>
        Agent: {detail.task.execution_context?.agent?.name || "ไม่ได้มอบหมาย"} ·
        {detail.task.provider === "claude"
          ? "Input ไม่รวม cache"
          : "Input รวมที่รายงาน"}
        : {total("input_tokens")} · Output รวมที่รายงาน:{" "}
        {total("output_tokens")}
      </p>
      <p>
        นับทุกรอบรวม retry · Token จากผู้ให้บริการเท่านั้น ·
        ไม่มีข้อมูลหมายถึงเครื่องมือไม่ได้รายงาน
      </p>
      {detail.runs.map((r, i) => {
        const m = r.usage_metrics || {};
        return (
          <article
            key={r.id}
            style={{
              padding: "16px",
              marginBottom: "16px",
              border: "1px solid var(--border, #ddd)",
              borderRadius: "12px",
            }}
          >
            <h4>
              รอบ {detail.runs.length - i} · {r.status}
            </h4>
            <dl>
              <dt>โมเดลที่ร้องขอ</dt>
              <dd>
                {typeof m.requested_model === "string"
                  ? m.requested_model === "provider_default"
                    ? "ค่าเริ่มต้นของผู้ให้บริการ"
                    : m.requested_model
                  : "ไม่ได้บันทึกตัวเลือกโมเดล"}
              </dd>
              <dt>แหล่งข้อมูล</dt>
              <dd>
                {m.source === "provider"
                  ? "ผู้ให้บริการ"
                  : m.source === "fixture"
                    ? "ข้อมูลทดสอบจำลอง"
                    : "ยังไม่มีสถิติผู้ให้บริการ"}
              </dd>
              {m.context_mode === "focused" && (
                <>
                  <dt>โหมดข้อมูล</dt>
                  <dd>เลือกตามงาน · ทดลอง</dd>
                  <dt>Knowledge ที่เลือก / ที่ค้น</dt>
                  <dd>
                    {count(m.knowledge_selected)} /{" "}
                    {count(m.knowledge_candidates)}
                  </dd>
                  <dt>วิธีเลือก</dt>
                  <dd>
                    {m.knowledge_selection === "lexical_rank_v1"
                      ? "เลือกจากคำที่เกี่ยวข้องกับงาน"
                      : m.knowledge_selection === "full"
                        ? "ข้อมูลตามเดิม"
                        : "กลับไปใช้ข้อมูลตามเดิม"}
                  </dd>
                  <dt>ลดข้อมูลประกอบจากแบบเต็ม (bytes)</dt>
                  <dd>
                    {count(m.context_saved_bytes)}{" "}
                    {typeof m.context_baseline_bytes === "number" &&
                    m.context_baseline_bytes > 0 &&
                    typeof m.context_saved_bytes === "number"
                      ? `(${((100 * m.context_saved_bytes) / m.context_baseline_bytes).toFixed(1)}%)`
                      : ""}
                  </dd>
                  <dt>ใบส่งต่อที่ใช้</dt>
                  <dd>{count(m.handoffs_used)}</dd>
                </>
              )}
              <dt>Input tokens</dt>
              <dd>{count(m.input_tokens)}</dd>
              <dt>Output tokens</dt>
              <dd>{count(m.output_tokens)}</dd>
              <dt>Cache read tokens</dt>
              <dd>{count(m.cache_read_tokens)}</dd>
              <dt>Cache write tokens</dt>
              <dd>{count(m.cache_write_tokens)}</dd>
              <dt>ขนาดข้อความที่ส่งจากแอป (bytes)</dt>
              <dd>{count(m.submitted_prompt_bytes ?? m.app_prompt_bytes)}</dd>
              <dt>เวลารันผู้ให้บริการ (ms)</dt>
              <dd>{count(m.provider_elapsed_ms)}</dd>
            </dl>
            {m.knowledge_sources && (
              <details>
                <summary>แหล่ง Knowledge และเวอร์ชันที่ใช้</summary>
                <ul>
                  {sources(m.knowledge_sources).map((s) => (
                    <li key={s.id}>
                      {s.title} · รุ่น {s.version + 1}
                      <br />
                      <small
                        style={{ overflowWrap: "anywhere" }}
                      >{`[[knowledge:${s.id}]]`}</small>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <small>
              {detail.task.provider === "codex"
                ? "Codex: cache read เป็นส่วนหนึ่งของ input อย่าบวกซ้ำ"
                : "Claude: input เป็นส่วน uncached; cache read/write แยกต่างหาก"}
            </small>
          </article>
        );
      })}
      {!detail.runs.length && <p>เริ่มงานก่อนเพื่อเก็บสถิติ</p>}
    </section>
  );
}
