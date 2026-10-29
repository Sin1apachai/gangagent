# Skill, Organization & Workflow verification

ทดสอบวันที่ 30 ตุลาคม 2026 (Asia/Bangkok) ด้วย Docker Compose แยกฐานข้อมูล `office_test` และ fixture workers สองตัวออกจากระบบจริง

## ผลตรวจอัตโนมัติ

- **52 HTTP integration tests ผ่าน**: 37 กรณีเดิม และ 15 กรณีใหม่ใน `tests/test_organization.py`
- **14 Rust unit tests ผ่าน**: รวมกฎกราฟแบบแยก/รวมงาน ขอบเขต Skill และเส้นทางไฟล์
- React + TypeScript production build และ 3 character rendering tests ผ่านใน Docker
- ตรวจตัวละครครบ 12 ค่า, การแก้ไข/เก็บค่าเดิมเมื่อ client เก่าไม่ส่ง character_id, version conflict และค่าที่อยู่นอกช่วง

| กรณี | ผลที่ยืนยัน |
| --- | --- |
| Skill revision | สร้าง แก้ไข ตรวจ conflict เก็บถาวร กู้คืน และอ่านประวัติที่ไม่ถูกทับ |
| Reporting hierarchy | สายรายงาน 12 Agent, self-cycle, indirect-cycle, ลิงก์ผ่าน Agent ที่ถูกลบ, หัวหน้าต่าง Workspace |
| Concurrent hierarchy update | คำขอ A→B และ B→A พร้อมกันยอมรับเพียงเส้นเดียว จึงไม่เกิดวงจร |
| Bindings and permissions | ปฏิเสธ Skill ซ้ำ เวอร์ชันที่ไม่มี สมาชิกทั่วไปแก้โครงสร้างไม่ได้ Viewer อ่านได้แต่เขียนไม่ได้ |
| Frozen execution context | เปลี่ยน Skill ระหว่างทำงานแล้วงานเดิม/รอบแก้ไขยังใช้เวอร์ชันเดิม งานใหม่ใช้ล่าสุด และตรึงเวอร์ชันได้ |
| Archived skills | งานใหม่เริ่มไม่ได้และไม่กิน attempt; กู้คืนแล้วเริ่มได้ |
| Workflow revision | แก้แม่แบบไม่เปลี่ยนสำเนาในร่างเก่า เรียกใช้เวอร์ชันเก่าได้ เก็บถาวร/กู้คืนและ conflict ถูกต้อง |
| Idempotent launch | ส่ง request เดิมซ้ำหรือพร้อมกันได้เพียงร่างเดียว ใช้ request เดิมกับเป้าหมายหรือ Workspace ต่างกันถูกปฏิเสธ |
| Branch and join | A → B/C → D; ส่ง B กลับแก้ แม้ C ผ่านแล้ว D ยังรอ จน B ผ่านตรวจรับ |
| Required files | ไม่มีไฟล์บังคับทำให้งาน failed, ไม่ retry เอง และงานปลายทางยังไม่มี attempt |
| Path validation | ปฏิเสธ path ย้อนออกนอกโฟลเดอร์, absolute, input/reference reserved paths, backslash และส่วน path ว่าง |
| Atomic approval | ถอด Skill ที่จำเป็นก่อนอนุมัติแล้วปฏิเสธทั้งแผน ไม่สร้างงานค้างบางส่วน |
| Reviewer assignment | บุคคลอื่นตรวจรับไม่ได้ สมาชิกที่ถูกถอนสิทธิ์ตรวจรับไม่ได้ เจ้าของเปลี่ยนผู้ตรวจรับได้ |
| Workspace isolation | คนภายนอกอ่าน Library, ประวัติ, Org Chart หรือใช้ Workflow ไม่ได้ |

การทดสอบพบและแก้กรณี `a//b` ซึ่งถูก normalize ก่อนตรวจ path เพิ่มการปฏิเสธส่วน path ว่างและ regression test แล้ว

## ทดสอบกับบัญชี AI จริง

รัน `tests/probe_live_skills.py` แบบ opt in กับ subscription workers ที่เชื่อมไว้ โดยไม่ใช้ API key หรือซื้อโควตาเพิ่ม:

1. สร้าง Skill ที่ระบุข้อความเฉพาะไว้ในคำสั่ง Skill โดยไม่ใส่ข้อความนั้นในคำอธิบายงาน
2. ให้ Codex ทำขั้นแรก ดาวน์โหลด `marker.txt` และตรวจข้อความตรงกับ Skill รวมถึง Skill version ที่ถูกบันทึกไว้
3. ยืนยันว่า Claude ยังไม่มี attempt ขณะ Codex รอตรวจรับ
4. ตรวจรับขั้นแรก แล้วให้ Claude รับไฟล์ `inputs/.../marker.txt` ดาวน์โหลดผลงานและตรวจข้อความอีกครั้ง
5. ตรวจรับขั้นสุดท้าย ทั้งสองงานสำเร็จครั้งละ 1 attempt รวม 2 model calls และย้าย Workspace ตรวจสอบไปถังขยะเพื่อกู้คืนหลักฐานได้

ผล: **Codex และ Claude ส่งไฟล์ตรงตาม Skill และส่งต่อผ่าน review gate สำเร็จ** เป็นการตรวจคำสั่ง/ไฟล์ตัวอย่างที่ควบคุมผลลัพธ์ ไม่ใช่การรับรองความถูกต้องของ AI สำหรับทุกโจทย์

## Worker ส่วนตัว

รันทดสอบ `tests/probe_personal_security.py` กับ Compose project แยก: PostgreSQL/Redis จำกัดข้อมูลตามผู้ใช้, อ่าน password/เพิ่มสิทธิ์ตัวเอง/แก้ membership ไม่ได้, ใช้ model UID แยก และอ่านตาราง Skill/Workflow โดยตรงไม่ได้ แต่ทำงานจาก frozen Skill ใน task ที่ได้รับมอบหมายได้ เว็บอ่านผลงานผ่าน ACL ได้ตามเดิม และเมื่อเพิกถอน PostgreSQL/Redis ปฏิเสธ credential เดิมทั้งหมด

## Persistence และ UI

- สำรอง PostgreSQL ของระบบทดสอบและกู้คืนเข้าฐานข้อมูลใหม่ เปรียบเทียบจำนวน Skill revisions, bindings, Workflow revisions และ frozen task contexts ตรงกัน
- ทดสอบ UPDATE ประวัติในฐานข้อมูลที่กู้คืนแล้ว ถูก immutable triggers ปฏิเสธทั้ง Skill และ Workflow
- สร้าง Skill ผ่านหน้าเว็บ มอบหมาย Skill แบบตรึงเวอร์ชัน และตรวจ Org Chart หัวหน้า/ลูกทีม
- สร้าง Workflow สองขั้นผ่านฟอร์ม ใช้สร้างแผน ตรวจว่าเป็นร่างก่อนอนุมัติ แล้วอนุมัติและเปิดดู Skill snapshot / reviewer ในงานได้
- ตรวจเดสก์ท็อปและจอแคบที่ DOM รายงานกว้าง 375 CSS px สำหรับ Org Chart และตรวจฟอร์มตัวละครรุ่นสุดท้ายที่ environment รายงาน 500 CSS px; กรอบฟอร์มและหน้าหลักไม่ล้นแนวนอน
- ภาพคู่มือมาจากระบบตัวอย่างที่แยกข้อมูล ไม่สร้างข้อมูลตัวอย่างเมื่อผู้ใช้ติดตั้งใหม่

## ขอบเขตปัจจุบัน

- สูงสุด 8 ขั้นต่อแม่แบบ, 8 Skills ต่อ Agent, 10 ไฟล์บังคับต่อขั้น, serialized context สูงสุด 80 KB
- กราฟงานต้องอ้างถึงขั้นก่อนหน้า จึงรองรับลำดับ งานคู่ขนาน และรวมผล แต่ยังไม่รองรับ conditional branches, loops หรือ cron schedules
- ผู้ตรวจรับในรุ่นนี้เป็นบัญชีผู้ใช้ การเพิ่ม Agent สำหรับ QA ทำได้เป็นอีกขั้นใน Workflow แต่ไม่แทนการอนุมัติของผู้ใช้
- Skill คือคำสั่งและข้อตกลงที่ส่งให้ AI ไม่ใช่การติดตั้ง plugin หรือขยายสิทธิ์ใช้งานเครื่องมือ
- Org Chart แสดงสายรายงาน ส่วน Workflow แสดงลำดับส่งงาน ทั้งสองความสัมพันธ์แยกกัน

## UX/UI และตัวละคร (เพิ่มตามการตรวจหน้าจอ)

- เพิ่มระยะห่าง label/control และแต่ละกลุ่มฟอร์ม
- Agent, Skill, Workflow และรายละเอียดงานใช้ tab bar พร้อม keyboard navigation
- Workflow และแผนร่างเลือกแก้ทีละขั้น แผนอนุมัติแล้วใช้สรุปแทนฟอร์ม disabled ที่ยาวต่อกัน
- ผู้ดูอ่านรายละเอียดแต่ละแท็บได้ โดยช่องแก้ไขและการบันทึกยังถูกจำกัดสิทธิ์
- ทดลองบันทึกจากแท็บตัวละคร เปิดแก้ไขใหม่พบค่าที่เลือก และเปลี่ยนเครื่องประดับแล้วแสดงใน Office
- ทดลองกรอกเกณฑ์ตรวจรับ สลับแท็บ/ขั้นตอน กลับมาข้อมูลยังอยู่ และบันทึก Workflow เป็นเวอร์ชันใหม่สำเร็จ
- ตัวละคร 3 ชุดสี × 4 เครื่องประดับ ใช้ pixel data เดียวกันใน SVG preview และ canvas Office; rendering tests ตรวจทั้ง 12 แบบแตกต่างกัน ภาพเดินอยู่ในกรอบ และสีผิว/เครื่องประดับถูกส่งไป renderer
- เปลี่ยน hover ปุ่มหลักเป็น `#315f49` และตัวอักษร `#fffaf0` พร้อม focus indicator

ตรวจคีย์บอร์ดยืนยัน ArrowRight เปลี่ยนจากแท็บตัวละครไปคำสั่งและตำแหน่งได้ หน้า main หลัง deploy ยังมีบัญชีและ Workspace เดิม การเปิดฟอร์มตรวจจอแคบไม่ได้บันทึก Agent เพิ่มในพื้นที่จริง
