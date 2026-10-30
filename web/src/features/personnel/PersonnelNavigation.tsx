import React from "react";
import { FormTabs } from "../../shared/FormTabs";
import type { OfficeController } from "../../application/useOfficeController";
export function PersonnelNavigation({ ctx }: { ctx: OfficeController }) {
  return (
    <FormTabs
      label="บุคลากร"
      value={ctx.page}
      onChange={ctx.setPage}
      tabs={[
        { id: "team", label: "ทีม Agent" },
        { id: "recruitment", label: "คัดเลือกบุคลากร" },
        { id: "master", label: "ข้อมูลพื้นฐาน" },
      ]}
    />
  );
}
