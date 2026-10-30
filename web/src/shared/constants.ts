import { catalog } from "../features/office/domain/LayoutEngine";
export const furniture = Object.entries(catalog).map(([key, value]) => [
  key,
  value.name,
]);
export const statusLabel: Record<string, string> = {
  queued: "รอทำ",
  running: "กำลังทำ",
  review: "รอตรวจ",
  done: "เสร็จ",
  failed: "ล้มเหลว",
  cancelled: "ยกเลิก",
  waiting_auth: "รอ Login",
  waiting_quota: "รอรีเซ็ต",
  interrupted: "งานสะดุด",
};
