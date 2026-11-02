import { useState } from "react";
import { api } from "../../shared/api";
type Standard = {
  id: string;
  version: number;
  title: string;
  instructions: string;
};
export function SystemStandards() {
  const [rows, setRows] = useState<Standard[]>([]),
    [error, setError] = useState("");
  return (
    <details
      className="panel"
      onToggle={async (e) => {
        if (e.target !== e.currentTarget || !e.currentTarget.open) return;
        try {
          setRows(await api<Standard[]>("/standards"));
          setError("");
        } catch (e) {
          setError(String(e));
        }
      }}
    >
      <summary>มาตรฐานกลางสำหรับ Agent ทุก Workspace</summary>
      <p>
        ข้อมูลนี้มากับระบบและแนบในบริบทงานอัตโนมัติ แยกจาก Knowledge ของแต่ละ
        Workspace
      </p>
      {rows.map((s) => (
        <section key={s.id + ":" + s.version}>
          <h3>
            {s.title} · v{s.version}
          </h3>
          <pre className="result">{s.instructions}</pre>
        </section>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
