import { useState } from "react";
import { api } from "../../shared/api";
type Evidence = {
  code_files: number;
  deliverable_files: number;
  empty_compose_files: number;
  message: string;
};
export function DeliveryEvidence({ wid, id }: { wid: string; id: string }) {
  const [data, setData] = useState<Evidence | null>(null),
    [error, setError] = useState("");
  return (
    <details
      className="review-box"
      onToggle={async (e) => {
        if (e.target !== e.currentTarget || !e.currentTarget.open) return;
        try {
          setData(
            await api<Evidence>(
              `/workspaces/${wid}/plans/${id}/delivery-evidence`,
            ),
          );
          setError("");
        } catch (e) {
          setError(e instanceof Error ? e.message : "ตรวจหลักฐานไม่สำเร็จ");
        }
      }}
    >
      <summary>
        ตรวจหลักฐานส่งมอบ · งานเสร็จไม่ได้ยืนยันว่าโปรแกรมรันได้
      </summary>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p>
            <b>{data.message}</b>
          </p>
          <p>
            ไฟล์ส่งมอบ {data.deliverable_files} · ไฟล์โค้ด {data.code_files} ·
            Compose ที่ไม่มีบริการ {data.empty_compose_files}
          </p>
          <small>
            ตรวจเฉพาะรายการไฟล์ ไม่ได้รันโปรแกรมหรือ Docker ของผลงานนี้
            แผนที่เป็นงานเอกสารอาจไม่มีโค้ดตามปกติ
          </small>
        </>
      )}
    </details>
  );
}
