import { useState } from "react";
import type { OfficeController } from "../../application/useOfficeController";
export function ReviewInbox({ ctx }: { ctx: OfficeController }) {
  const [open, setOpen] = useState(false);
  const tasks =
    ctx.data?.tasks.filter(
      (t) =>
        t.status === "review" &&
        !t.review_for_task_id &&
        (t.review_state === "needs_owner" || t.review_mode === "owner"),
    ) || [];
  if (!tasks.length) return null;
  return (
    <div className="review-inbox">
      <button aria-expanded={open} onClick={() => setOpen(!open)}>
        งานรอคุณตรวจ {tasks.length}
      </button>
      {open && (
        <div className="review-inbox-panel" aria-label="งานรอเจ้าของตรวจ">
          {tasks.map((t) => (
            <p key={t.id}>
              <button
                onClick={() => {
                  setOpen(false);
                  ctx.run(() => ctx.showTask(t));
                }}
              >
                {t.title}
              </button>
              <small>{t.review_note || "รอคุณตรวจรับขั้นนี้"}</small>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
