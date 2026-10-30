import React from "react";
import type { Detail } from "../../shared/types";
export function TaskUsage({detail}:{detail:Detail}) {
 const count=(v:unknown)=>typeof v==="number"?v.toLocaleString():"ไม่มีข้อมูล";
 const saved=detail.runs.reduce((n,r)=>n+Number(r.usage_metrics?.saved_formatting_bytes||0),0);
 const baseline=detail.runs.reduce((n,r)=>n+Number(r.usage_metrics?.baseline_app_prompt_bytes||0),0);
 const measured=detail.runs.filter(r=>r.usage_metrics?.source==="provider");
 const total=(key:string)=>{const rows=measured.filter(r=>typeof r.usage_metrics?.[key]==="number");return rows.length?`${rows.reduce((n,r)=>n+Number(r.usage_metrics?.[key]),0).toLocaleString()} (${rows.length}/${detail.runs.length} รอบ)` : "ไม่มีข้อมูล";};
 return <section><h3>การใช้ต่อรอบ · {detail.task.provider}</h3>
 <p>ลดขนาดข้อความส่วนที่แอปจัดเตรียม {saved.toLocaleString()} bytes{baseline>0?` (${(100*saved/baseline).toFixed(1)}%)`:""} โดยเก็บข้อมูล JSON ครบเดิม ตัวเลขนี้ไม่ใช่เปอร์เซ็นต์ลด token หรือโควตา Pro</p>
 <p>Agent: {detail.task.execution_context?.agent?.name || "ไม่ได้มอบหมาย"} · Input รวมที่รายงาน: {total("input_tokens")} · Output รวมที่รายงาน: {total("output_tokens")}</p>
 <p>นับทุกรอบรวม retry · Token จากผู้ให้บริการเท่านั้น · ไม่มีข้อมูลหมายถึงเครื่องมือไม่ได้รายงาน</p>
 {detail.runs.map((r,i)=>{const m=r.usage_metrics||{};return <article key={r.id} style={{padding:"16px",marginBottom:"16px",border:"1px solid var(--border, #ddd)",borderRadius:"12px"}}><h4>รอบ {detail.runs.length-i} · {r.status}</h4>
 <dl><dt>แหล่งข้อมูล</dt><dd>{m.source==="provider"?"ผู้ให้บริการ":m.source==="fixture"?"ข้อมูลทดสอบจำลอง": "ยังไม่มีสถิติผู้ให้บริการ"}</dd>
 <dt>Input tokens</dt><dd>{count(m.input_tokens)}</dd><dt>Output tokens</dt><dd>{count(m.output_tokens)}</dd><dt>Cache read tokens</dt><dd>{count(m.cache_read_tokens)}</dd><dt>Cache write tokens</dt><dd>{count(m.cache_write_tokens)}</dd>
 <dt>ขนาดข้อความที่ส่งจากแอป (bytes)</dt><dd>{count(m.submitted_prompt_bytes??m.app_prompt_bytes)}</dd><dt>เวลารันผู้ให้บริการ (ms)</dt><dd>{count(m.provider_elapsed_ms)}</dd></dl>
 <small>{detail.task.provider==="codex"?"Codex: cache read เป็นส่วนหนึ่งของ input อย่าบวกซ้ำ":"Claude: input เป็นส่วน uncached; cache read/write แยกต่างหาก"}</small></article>})}
 {!detail.runs.length&&<p>เริ่มงานก่อนเพื่อเก็บสถิติ</p>}</section>;
}
