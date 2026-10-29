# Agent Office — Phase 2

Rust (Axum + SQLx), React + TypeScript, PostgreSQL, Redis และ Worker ใน Docker Compose สำหรับใช้งานบนเครื่องของเจ้าของระบบ

**ไม่มีข้อมูลตัวอย่าง และไม่เชื่อมบัญชี AI ให้อัตโนมัติ** การติดตั้งใหม่สร้างเฉพาะบัญชี Super Admin จาก `.env` ส่วน Workspace, งาน, ความรู้ และ Agent ให้ผู้ใช้เพิ่มเอง

## เริ่มใช้งาน

```sh
./setup.sh
docker compose up --build -d
```

เปิด http://localhost:8088 และใช้ `OWNER_EMAIL` / `OWNER_PASSWORD` จาก `.env` เก็บไฟล์นี้เป็นความลับ การเปลี่ยนรหัสผ่านใน `.env` หลังติดตั้งแล้วจะไม่เปลี่ยนรหัสผ่านบัญชีเดิม ให้ใช้ Settings → โปรไฟล์แทน

## เพิ่ม / แก้ไข / ลบข้อมูล

| เมนู | ทำอะไรได้ |
| --- | --- |
| Office | สร้างและแก้ชื่อ Workspace, ย้ายไปถังขยะ, จัดวาง/ย้าย/หมุน/ลบเฟอร์นิเจอร์, ดู Agent และสถานะงานจริง |
| Task board | เพิ่มและแก้ไขงาน, เลือกเครื่องมือและ Agent, เริ่มงาน, ยกเลิก, ตรวจผลงาน, ดาวน์โหลดไฟล์, ตรวจรับหรือส่งแก้, ลบและกู้คืน |
| Knowledge | เพิ่ม/แก้/ลบ/กู้คืน/ค้นหา, ระบุแหล่งที่มา, ทำเครื่องหมายตรวจสอบก่อนแนบให้ AI |
| Team | เพิ่ม/แก้/ลบ/กู้คืน Agent, กำหนดบทบาท คำสั่งประจำตัว เครื่องมือ ตำแหน่ง และเปิด/ปิดใช้งาน |
| Settings | แก้โปรไฟล์และรหัสผ่าน, เปิด/ปิดการใช้ผู้ให้บริการ, ดู Worker และสถานะ Login, จัดการสมาชิกและสิทธิ์ Workspace |
| Settings สำหรับ Super Admin | เพิ่ม/แก้/ปิดบัญชีผู้ใช้ และกู้คืนบัญชีที่ปิดแล้ว โดยไม่สามารถลบบัญชีตนเองหรือ Super Admin ผ่านเมนูนี้ |
| Trash | กู้คืน Workspace, งาน, ความรู้ และ Agent โดยไม่มีปุ่มล้างข้อมูลถาวร |

การแก้ข้อมูลมี version checks เพื่อป้องกันการทับข้อมูลที่ผู้อื่นเพิ่งแก้ งานที่กำลังทำต้องยกเลิกให้เสร็จก่อนแก้หรือลบ ไม่สามารถลบ Workspace ที่ยังมีงานกำลังทำ สมาชิก Viewer ดูข้อมูลได้แต่แก้ไขไม่ได้ การแก้สิทธิ์สมาชิกทำได้เฉพาะเจ้าของ Workspace หรือ Super Admin

## เชื่อม Codex และ Claude Code

เปิด **Settings → การเชื่อมต่อ AI** แล้วกด **เชื่อมบัญชี ChatGPT** หรือ **เชื่อมบัญชี Claude** ได้เลย ไม่ต้องพิมพ์คำสั่ง Docker

- Codex: เปิดหน้ายืนยันทางการ แล้วใส่รหัสอุปกรณ์ที่แสดงในเว็บ หากบัญชียังปิด Device-code login ให้เปิดใน Security ของ ChatGPT ก่อน
- Claude: เปิดหน้ายืนยันทางการ แล้วนำรหัสยืนยันครั้งเดียวที่ได้กลับมาใส่ในเว็บ (ไม่ใช่รหัสผ่านหรือ API key)
- สถานะอัปเดตอัตโนมัติ ยกเลิกคำขอได้ และคำขอหมดอายุใน 10 นาที หาก Worker กำลังทำงาน คำขอจะรอจนงานจบ
- บัญชีที่เชื่อมแล้วจะแสดง Login พร้อม และไม่ถูกบังคับ Login ใหม่ การเปิดใช้โควตา AI ยังแยกจากการ Login
- สมาชิกต้องมี Worker ผูกกับบัญชีตนเอง จึงใช้ปุ่มเชื่อมบัญชีได้

รหัสยืนยันครั้งเดียวของ Claude ส่งผ่าน Redis แบบหน่วยความจำ มีอายุ 60 วินาทีและอ่านครั้งเดียว ไม่เก็บใน PostgreSQL หรือ log ส่วน token เก็บโดย CLI ใน credential volumes เดิม เว็บไม่ mount credential volumes หรือ Docker socket

วิธี Terminal สำรองสำหรับผู้ดูแล:

```sh
docker compose run --rm codex-login
docker compose run --rm claude-login
```

เลือกบัญชีสมาชิก ChatGPT/Claude ตามขั้นตอนทางการ ไม่เลือก API/Console billing และไม่ส่งรหัสผ่านหรือ token เข้าหน้าเว็บ Agent Office

ตรวจสถานะหรือออกจากระบบ:

```sh
docker compose run --rm codex-login login status
docker compose run --rm claude-login auth status
docker compose run --rm codex-login logout
docker compose run --rm claude-login auth logout
```

Codex device-code login อาจต้องเปิดสิทธิ์ในบัญชี ChatGPT ก่อน ตามข้อความที่ CLI แสดง Claude login อาจให้เปิด URL และทำขั้นตอนต่อใน browser

จากนั้นเปิด **Settings → การเชื่อมต่อ AI** ปิด Usage credits / การเติมเงินอัตโนมัติที่บัญชีผู้ให้บริการของคุณเองก่อน แล้วจึงติ๊กยืนยันและเปิดใช้งานการเชื่อมต่อที่ต้องการ

ระบบไม่ส่ง API keys ให้กระบวนการ AI ไม่ยอมใช้ API-key authentication และไม่มีการสลับไป API แบบจ่ายเพิ่ม แต่ **subscription authentication ไม่ได้ปิดการใช้เครดิตเพิ่มเติมที่ตั้งไว้กับผู้ให้บริการแทนคุณ** จึงไม่ใช่การรับประกันค่าใช้จ่ายเป็นศูนย์หากบัญชีของคุณเปิด paid overage อยู่

ข้อมูล Login เก็บใน Docker credential volumes ของ Worker แยกจากเว็บ ไม่มีการคัดลอก macOS keychain หรือบัญชีที่ล็อกอินบน host มาให้ Docker โดยอัตโนมัติ CLI ที่ติดตั้ง: Codex 0.165.0 และ Claude Code 2.1.312

## ทดลองวงจรงาน

1. สร้าง Workspace และเพิ่ม Knowledge ที่ตรวจสอบแล้ว (ถ้ามี)
2. เพิ่ม Agent พร้อมบทบาท คำสั่ง และเลือก Codex หรือ Claude
3. สร้างงานและเลือก Agent ที่ใช้เครื่องมือเดียวกัน
4. กด **เริ่มงาน** งานที่บันทึกเฉย ๆ จะไม่เรียก AI
5. เปิดรายละเอียดงานเพื่อดูสถานะ ประวัติ ผลลัพธ์ และไฟล์ผลงาน
6. ตรวจรับเป็นเสร็จ หรือส่งกลับพร้อมสิ่งที่ต้องแก้แล้วกดเริ่มใหม่

หากยังไม่ Login งานจะเป็น **รอ Login** โดยไม่เริ่มโมเดล หากพบข้อจำกัดโควตาที่ตรวจจับได้จะเป็น **รอโควตา** และไม่ลองใหม่เอง งานหนึ่งมีได้สูงสุดสามครั้งที่เริ่มทำจริง รอบที่ยังรอ Login ไม่นับเป็นการทำงานจริง

Worker รับเฉพาะงานของบัญชีที่ผูกไว้กับ Worker เท่านั้น สมาชิกคนอื่นไม่ได้ใช้ subscription ของเจ้าของโดยอัตโนมัติ การให้ผู้ใช้คนอื่นมี Worker และการเชื่อมต่อของตัวเองยังต้องจัดสรรแยก ไม่ใช่ระบบแชร์บัญชี Pro

## ทดสอบผ่าน Docker Compose

```sh
./test.sh
```

สคริปต์สร้าง Compose project แยก ใช้ฐานข้อมูล `office_test`, Worker ทดสอบสองตัว และไม่เปิดพอร์ตหรือใช้ credential volumes ของระบบจริง หลังจบจะล้างเฉพาะระบบทดสอบ มี integration tests 31 รายการ และ Rust unit tests 7 รายการ รวมการแยกสิทธิ์, CRUD/กู้คืน, งานซ้ำ, ยกเลิก, โควตา, feedback, artifact download และการหยุดงานเมื่อปิดการเชื่อมต่อ

Fixture worker มีตัวป้องกันสองชั้น: ต้องเปิด `ALLOW_TEST_WORKER=1` และใช้ชื่อฐานข้อมูล `office_test` ผลลัพธ์ระบุ `FIXTURE TEST ONLY — no AI was called.` เสมอ การผ่านชุดนี้ไม่ใช่หลักฐานว่าได้เรียกโมเดลจริงแล้ว

มี helper probes สำหรับทดสอบ restart/lease recovery และ unauthenticated CLI ใน disposable preview ที่ต้อง opt in ด้วย `OFFICE_TEST_TARGET=isolated_preview` เท่านั้น:

- `tests/probe_recovery.py`
- `tests/probe_real_auth.py`

จัดรูปแบบโค้ด:

```sh
docker compose --profile tools run --rm web-tools
docker compose --profile tools run --rm rust-tools
```

## หยุด สำรองข้อมูล และย้ายเครื่อง

`docker compose down` เก็บข้อมูลใน volumes ไว้ **อย่าใช้ `down -v` กับระบบจริง** หากไม่ต้องการลบข้อมูล

ควรหยุด Worker ชั่วคราวระหว่างสำรองไฟล์และฐานข้อมูล เพื่อไม่ให้มีการสร้างผลงานค้างระหว่าง snapshot:

```sh
mkdir -p backups
docker compose stop worker
docker compose exec -T postgres pg_dump -U office -d office -Fc > backups/office.dump
docker compose run --rm --no-deps -T --entrypoint sh worker -c 'mkdir -p /data/runs && tar -czf - -C /data runs' > backups/runs.tar.gz
docker compose start worker
```

ย้าย source, `.env` อย่างปลอดภัย, database dump และ runs archive ไปเครื่องใหม่ แล้วเริ่ม Postgres ให้ healthy ก่อน restore:

```sh
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U office -d office --clean --if-exists < backups/office.dump
docker compose build worker
docker compose run --rm --no-deps -T --entrypoint tar worker -xzf - -C /data < backups/runs.tar.gz
docker compose up --build -d
```

Login ผู้ให้บริการใหม่บนเครื่องใหม่ ไม่ต้องส่งออก credential volumes ความรู้เก็บใน Postgres; ผลงานอยู่ใน `runs-data` จึงต้องสำรองทั้งสองส่วน การมี Docker volume เพียงอย่างเดียวไม่ใช่ backup อัตโนมัติ

## ขอบเขตที่ยังต้องพัฒนาต่อ

- ทีมหลาย Agent ที่วางแผนและแจกงานกันอัตโนมัติ และ Super Intelligence ข้าม Workspace
- การเดินหลบเฟอร์นิเจอร์, undo/redo และการควบคุมแผนที่ด้วยคีย์บอร์ด
- สมาชิกแต่ละคนมี Worker ส่วนตัวผ่านหน้าจอ pairing
- MFA, password reset ทางอีเมล, HTTPS และการดูแล production
- กำหนดวิธีอนุมัติเครื่องมือเพิ่มเติมสำหรับงานที่เกินขอบเขต sandbox ปัจจุบัน

Claude ถูกจำกัดให้ใช้เครื่องมือไฟล์ ไม่มี shell หรือ MCP ภายนอก และปฏิเสธคำขอสิทธิ์ที่ไม่อนุญาต Codex ใช้ workspace-write sandbox และปิด network ของ shell งานบางประเภทจึงอาจต้องการสิทธิ์หรือเครื่องมือเพิ่ม ระบบไม่ข้าม sandbox หรือเปิด permission bypass ให้อัตโนมัติ

Local edition ผูกพอร์ตกับ `127.0.0.1` เท่านั้น ยังไม่ควรเปิดออก Internet โดยตรง

อ้างอิงทางการ: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [Codex authentication](https://learn.chatgpt.com/docs/auth), [Claude CLI](https://code.claude.com/docs/en/cli-reference), [Claude subscription/SDK](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

## Phase 2 revision continuity

Revision runs receive the latest reviewed result for that same task with the user feedback (up to 60,000 UTF-8 bytes). Prior registered source files are copied into the new run, with the original run preserved. Downloads remain available under each run in history; the latest-files section only shows the newest run. Settings now shows worker identity, last heartbeat, mode and authentication freshness.

Execution requests are cleared when a workspace/user is deleted, a member loses write access, or a provider connection is disabled. Restoring access requires an explicit start. Running cancellation remains effective even if a provider is re-enabled before the next heartbeat.

Revision file handoff is limited to registered artifacts from the latest reviewed run of the same task: up to 100 files, 10 MiB each and 50 MiB total. Symlinks, changed sizes and invalid paths fail before model invocation. Files in nested directories are supported; the worker gives the new copies writable ownership. Missing source files produce an explicit failure instead of asking the model to reconstruct them silently.


## แผนทีม โปรเจกต์ และความรู้

เมนูโปรเจกต์จัดกลุ่มงาน พร้อมลำดับความสำคัญและเกณฑ์ตรวจรับ เมนูแผนทีมรับเป้าหมาย เลือก Manager ให้เสนอแผน หรือจัดขั้นตอนเองได้ไม่เกิน 8 ขั้น แก้ไข/ตรวจแผนก่อนอนุมัติ งานถัดไปเริ่มได้เมื่อคุณตรวจรับงานก่อนหน้าแล้วเท่านั้น แนบไฟล์อ้างอิงได้ 5 ไฟล์ ไฟล์ละ 1 MiB ผลงานที่ตรวจรับถูกส่งต่อให้ขั้นตอนถัดไปโดยคงประวัติเดิม

ค้นหาความรู้ข้ามภาษาโดยเปิดบริการภายในเครื่อง:

```sh
docker compose --profile semantic up --build -d
```

ครั้งแรกดาวน์โหลดโมเดล open-source ในขั้น build หลังจากนั้นใช้ CPU ภายในเครื่อง ไม่มีค่าบริการ inference API หากบริการนี้ไม่พร้อม ระบบจะแจ้งว่าใช้ full-text search แทน Super Admin ให้/เพิกถอนสิทธิ์ Super Intelligence ของสมาชิกได้จาก Settings สิทธิ์นี้ใช้ค้นหาความรู้ที่ตรวจสอบแล้วข้าม Workspace พร้อมระบุแหล่งที่มา ไม่ใช่รหัสเข้าฐานข้อมูล

## Worker ส่วนตัว

Settings → Worker ส่วนตัว → ตั้งชื่อ → ดาวน์โหลดไฟล์ติดตั้ง เก็บไฟล์เป็นความลับ เพราะมี credential ส่วนตัว ให้ผู้ดูแล Docker host ที่คุณควบคุมเท่านั้นติดตั้ง:

```sh
docker compose -f office-worker-<id>.compose.json up -d
```

จากนั้นผู้ใช้ Login เว็บของตนแล้วกดเชื่อมบัญชี AI ได้ตามปกติ เพิกถอน Worker ได้จาก Settings ไม่ใช้บัญชี Pro ร่วมกับเจ้าของ ระบบนี้ออกแบบสำหรับ Docker host ที่ไว้ใจ ไม่ใช่ให้ผู้ใช้ที่ไม่ไว้ใจควบคุม container เอง หากเปลี่ยนชื่อ Compose project ให้ตั้ง `OFFICE_DOCKER_NETWORK` และ `OFFICE_RUNS_VOLUME` ใน app ตาม network/volume จริง

## สำรองและย้ายเครื่อง

```sh
./backup.sh
```

ไฟล์อยู่ใน `backups/office-<เวลา>/` รวมฐานข้อมูล ไฟล์ผลงานที่ลงทะเบียน และ checksum ไม่รวมบัญชี AI หรือ `.env` คัดลอกไปที่เก็บส่วนตัวอีกเครื่องด้วยตนเอง ทดสอบกู้คืนใน Compose project แยกก่อนสลับใช้งาน:

```sh
RESTORE_PROJECT=office-restore CONFIRM_RESTORE=office-restore ./restore.sh backups/office-<เวลา>
```

ต้องเตรียมฐานข้อมูล/volume ของ project ปลายทางก่อน ระบบไม่ยอมกู้ทับ project หลัก หลังย้ายให้เชื่อมบัญชี AI และสร้าง Worker ส่วนตัวใหม่ ดูข้อจำกัดและโครงสร้างโค้ดใน `docs/architecture.md`


**ข้อจำกัด Codex ใน Docker รุ่นนี้:** ใช้ผลลัพธ์แบบ JSON schema แล้วระบบตรวจสอบก่อนสร้าง/แก้ไฟล์ UTF-8 ไม่รัน shell หรือทดสอบโปรแกรมที่โมเดลสร้าง ไม่เพิ่ม `privileged`/`SYS_ADMIN` หรือปิด seccomp เพื่อข้ามข้อจำกัด Docker ส่วน Claude ใช้เครื่องมืออ่าน/แก้ไฟล์ได้ รายละเอียดและผลทดสอบจริงอยู่ใน `docs/phase2-test-report.md`
