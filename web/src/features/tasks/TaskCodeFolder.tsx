import { useEffect, useState } from "react";
import { api } from "../../shared/api";
type Export = { run_id: string; relative_path: string; status: string; error: string; files: number };
type Inventory = { root: string; directory: {status: string; error: string} | null; runs: Export[] };
export function TaskCodeFolder({wid, taskId, runId}: {wid: string; taskId: string; runId?: string}) {
  const [data,setData]=useState<Inventory|null>(null),[error,setError]=useState("");
  useEffect(()=>{
    let live=true; setData(null); setError("");
    const load=()=>api<Inventory>(`/workspaces/${wid}/tasks/${taskId}/code-folder`).then(d=>{if(live){setData(d);setError("");}}).catch(e=>{if(live)setError(String(e));});
    load();const timer=setInterval(load,3000);return()=>{live=false;clearInterval(timer);};
  },[wid,taskId]);
  const row=data?.runs.find(r=>r.run_id===runId);
  return <section className="panel" aria-label="โฟลเดอร์โค้ดบนเครื่อง">
    <h4>โฟลเดอร์โค้ดบนเครื่อง</h4>
    {data && <><p>อยู่ใต้โฟลเดอร์ Agent Office ของคุณ: <code>{data.root}</code></p>
      <p>{row?.status==='ready'?`ส่งออกแล้ว ${row.files} ไฟล์`:row?.status==='failed'?'ส่งออกไม่สำเร็จ':'ส่งออกอัตโนมัติเมื่อ Agent ส่งไฟล์เสร็จ'}</p>
      {row && <p style={{overflowWrap:'anywhere'}}><code>{row.relative_path}</code></p>}
      {(row?.error||data.directory?.error) && <p role="alert">{row?.error||data.directory?.error}</p>}
      <small>แยกแต่ละงานและรอบ ไม่เขียนทับไฟล์เดิม การแก้สำเนาบนเครื่องไม่เปลี่ยนผลตรวจรับหรือ Preview ของรอบเดิม</small>
    </>}{error&&<p role="alert">{error}</p>}
  </section>;
}
