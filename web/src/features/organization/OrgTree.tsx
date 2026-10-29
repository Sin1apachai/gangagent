import { CharacterSprite } from "../office/CharacterPicker";
import React, { useEffect, useRef } from "react";
import type { Agent } from "../../shared/types";
import type { Binding } from "./types";
export function OrgTree({
  agents,
  bindings,
  onSelect,
}: {
  agents: Agent[];
  bindings: Binding[];
  onSelect: (a: Agent) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const center = () => {
      el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(el);
    return () => observer.disconnect();
  }, [agents]);
  const ids = new Set(agents.map((a) => a.id));
  function node(a: Agent, seen: Set<string>): React.ReactNode {
    if (seen.has(a.id)) return null;
    const next = new Set([...seen, a.id]);
    const children = agents.filter((x) => x.manager_id === a.id);
    return (
      <li key={a.id}>
        <button className="org-node" onClick={() => onSelect(a)}>
          <span className={`org-avatar ${a.provider}`}>
            <CharacterSprite id={a.character_id ?? 0} />
          </span>
          <b>{a.name}</b>
          <span>{a.role}</span>
          <small>
            {a.department || "ยังไม่ระบุฝ่าย"} ·{" "}
            {a.enabled ? "พร้อมทำงาน" : "พักการทำงาน"}
          </small>
          <em>✦ {bindings.filter((b) => b.agent_id === a.id).length} Skills</em>
          {a.manager_id && !ids.has(a.manager_id) && (
            <small className="error">หัวหน้าไม่อยู่ในทีมปัจจุบัน</small>
          )}
        </button>
        {children.length > 0 && <ul>{children.map((c) => node(c, next))}</ul>}
      </li>
    );
  }
  return (
    <div
      ref={viewport}
      className="org-tree-scroll"
      role="region"
      aria-label="แผนผังโครงสร้างทีม"
      tabIndex={0}
    >
      <ul className="org-tree">
        {agents
          .filter((a) => !a.manager_id || !ids.has(a.manager_id))
          .map((a) => node(a, new Set()))}
      </ul>
    </div>
  );
}
