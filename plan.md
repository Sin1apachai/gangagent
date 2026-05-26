# 📋 แผนงาน: Multi-Provider Agent Orchestration System

## 🎯 วิสัยทัศน์

ระบบควบคุม AI agent หลายค่าย (Claude, GPT, Gemini, ...) แบบ dynamic ที่ผู้ใช้สามารถสร้าง ตั้งชื่อ สอน และมอบหมายงานให้ agent ที่มีบุคลิกเฉพาะตัว (ซึ่งสร้างจากชื่อที่ตั้ง) ได้

## ✅ ความต้องการพื้นฐาน (จากผู้ใช้)

1. **กำเนิด agent ได้** — รองรับหลายค่าย และเพิ่มค่ายใหม่แบบ dynamic ได้
2. **ตั้งชื่อให้ agent ได้** — โดยนิสัยจะถูกสร้างจากชื่อที่ตั้ง
3. **สอนและกำหนดบทบาทหน้าที่ให้ agent ได้**
4. **agent แสดงความคิดเห็นได้** แต่มีความถนัดในงานตามที่กำหนด

## 🔑 การตัดสินใจสำคัญ

- **Provider feature ไม่เท่ากัน** → เลือกใช้ **Capability Flag** (ไม่ใช่ lowest common denominator) เพื่อใช้ feature เต็มศักยภาพของแต่ละค่าย
- **Personality** → ชื่อที่ผู้ใช้ตั้ง เป็นตัวกำหนดนิสัย (ไม่ใช่สุ่มชื่อจากนิสัย)

---

## 🏗️ สถาปัตยกรรมระดับสูง

```
┌─────────────────────────────────────────────────────┐
│                  User Interface                      │
│         (CLI / Web / API — เลือกภายหลัง)             │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              Agent Orchestrator                      │
│  - Lifecycle (เกิด/พัก/ลบ)                          │
│  - Routing (เลือก agent ที่เหมาะกับ task)            │
│  - Inter-agent communication                         │
└────┬────────────┬─────────────┬─────────────┬───────┘
     │            │             │             │
┌────▼────┐  ┌────▼────┐  ┌─────▼────┐  ┌────▼────────┐
│ Agent   │  │Personal-│  │ Memory   │  │ Capability  │
│Registry │  │ity      │  │ Store    │  │ Router      │
│         │  │Engine   │  │(vector + │  │             │
│         │  │         │  │ kv)      │  │             │
└─────────┘  └─────────┘  └──────────┘  └────┬────────┘
                                              │
                              ┌───────────────┼───────────────┐
                              │               │               │
                       ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
                       │  Claude     │ │  GPT        │ │  Gemini     │
                       │  Provider   │ │  Provider   │ │  Provider   │
                       └─────────────┘ └─────────────┘ └─────────────┘
                       (Plug-in pattern — เพิ่มค่ายใหม่ได้)
```

---

## 🧩 ส่วนประกอบหลัก (Core Modules)

### 1. Provider Abstraction Layer

- **`IAgentProvider`** interface กลาง: `chat()`, `stream()`, `embed()`
- **`ProviderRegistry`** — ลงทะเบียน provider แบบ dynamic
- **`ProviderConfig`** — API key, model, base URL ผ่าน env/config file
- ทุก provider เป็น **plug-in** วางใน folder `providers/` แล้ว auto-discover

### 2. Capability System

- **`Capability` enum**:
  - `text_generation` (ทุกค่ายมี)
  - `streaming`
  - `tool_use` / function_calling
  - `vision` (image input)
  - `audio_input`
  - `thinking_mode` (Claude extended thinking, Gemini thinking)
  - `prompt_caching`
  - `structured_output` (JSON mode)
  - `web_search` (built-in)
  - `code_execution` (built-in)
  - `long_context_200k+`
- **`CapabilityRouter`** — รับ task requirement → จับคู่กับ provider ที่รองรับ
- **Capability config file** (YAML) — อัปเดต feature ใหม่ของแต่ละค่ายโดยไม่แก้โค้ด
- **Fallback policy**: strict mode / flexible mode / graceful degradation
- **Tool schema adapter** — แปลง tool definition ระหว่างค่าย (OpenAI ↔ Anthropic ↔ Google)

#### Graceful Degradation Policy

| กรณี | ตัวเลือก |
|------|----------|
| ขอ vision แต่ provider ไม่รองรับ | (a) เปลี่ยน provider อัตโนมัติ (b) error ชัดเจน (c) describe ภาพด้วย provider อื่นก่อน แล้วส่งข้อความต่อ |
| ขอ thinking mode | (a) fallback ใช้ "think step by step" prompt (b) error |
| ขอ tool use | adapter แปลง tool schema ระหว่างค่าย |

#### Capability-aware Routing

- **Strict mode**: ใช้ provider เดิมเท่านั้น ถ้าไม่ได้ก็ error
- **Flexible mode**: ยืม provider อื่นชั่วคราว แต่ยังคง "บุคลิก" ของ agent ผ่าน system prompt

### 3. Agent Lifecycle

| State | คำอธิบาย |
|-------|----------|
| `Spawning` | กำลังกำเนิด — assign ID, init memory |
| `Naming` | รอผู้ใช้ตั้งชื่อ |
| `Forming` | Personality Engine สร้างนิสัยจากชื่อ |
| `Profession?` *(optional)* | ผู้ใช้เลือก Profession Template หรือ skip → preset apply ลง role/skills/trait-bias (ดู §Profession Template) |
| `Training` | รับ role/skill จากผู้ใช้ (override preset ได้) |
| `Active` | พร้อมทำงาน |
| `Sleeping` | พักไว้ ไม่กิน resource แต่ memory ยังอยู่ |
| `Retired` | ลบทิ้ง (มี soft-delete + archive) |

### 4. Personality Engine (ชื่อ → นิสัย)

**Hybrid approach**:
1. Hash ชื่อ → seed (ล็อกผลให้ reproducible — ชื่อเดียวกันต้องได้นิสัยเดิมเสมอ)
2. LLM ตีความชื่อ → traits draft
3. ใช้ seed lock random choice → traits final

**Trait dimensions**:
- formality (เป็นทางการ ↔ กันเอง)
- playfulness (ขี้เล่น ↔ จริงจัง)
- conscientiousness (รอบคอบ ↔ ฉับไว)
- verbosity (พูดมาก ↔ พูดน้อย)
- tone (น้ำเสียง)
- preferred_language
- risk_tolerance

**Features เสริม**:
- **Provider affinity** — บางนิสัยเหมาะกับบางค่าย (เช่น นักวิเคราะห์ → Claude, สร้างสรรค์ → GPT)
- **Reveal UX** — แสดงการ์ดบุคลิกหลังตั้งชื่อ ให้ผู้ใช้เห็นว่าระบบตีความชื่ออย่างไร
- **Override mechanism** — แก้ trait เฉพาะตัวได้โดยไม่เปลี่ยนชื่อ
- **Cultural awareness** — ชื่อไทย/ญี่ปุ่น/ตะวันตก ควรให้นิสัยที่สมเหตุผลตามวัฒนธรรม

### 5. Skill / Role System

- **Role** = บทบาทหลัก (เช่น "ผู้ช่วยเขียนโปรแกรม", "นักวิเคราะห์ข้อมูล")
- **Skill** = ความสามารถเฉพาะ (เช่น Python, SQL, การตลาด)
- **Profession Template** *(optional preset)* — packaged bundle ที่ pre-fill role + default skills + trait bias + provider hint ตอนสร้าง agent — **ไม่ใช่ field ถาวร**, สลายตัวหลัง apply (ดู §Profession Template)
- **Tool binding** — แต่ละ skill ผูกกับ tool จริง (search, code exec, calculator)
- **Skill registry** — global pool ที่ agent หยิบมาใช้ได้
- **Versioning** — แก้ role/skill แล้วย้อนกลับได้ (เหมือน git)

### 6. Memory System

- **Short-term**: conversation buffer (in-memory)
- **Long-term**: vector DB (Chroma/Qdrant) สำหรับ semantic recall
- **Structured memory**: key-value store สำหรับ fact ที่สอน
- **Memory per agent** — แยกขาด ไม่ปนกัน
- **Shared memory pool** (optional) — สำหรับ agent ที่ทำงานเป็นทีม
- **State layout**: ทุก persistence อยู่ใน `./data/{sqlite,chroma,configs,logs}/` — backup tool เห็นจุดเดียว (ดู §Backup & Recovery)

### 7. Inter-Agent Communication

- **Message bus** — agent ส่งข้อความหากันได้
- **Delegation pattern** — agent A มอบหมายงานให้ agent B
- **Review pattern** — agent B ตรวจงาน agent A
- **Conversation transcript** — เก็บบทสนทนาระหว่าง agent ไว้ debug

### 8. Observability

- **Cost tracking** ต่อ agent / ต่อ provider / ต่อ task
- **Token usage** logging
- **Performance metrics** — latency, success rate
- **Audit log** — ใครสอนอะไรให้ agent ไหนเมื่อไหร่

### 9. Evaluation

- **Skill benchmark** — test set ต่อ skill เพื่อวัดความถนัด
- **Personality consistency check** — agent ตอบโดยรักษานิสัยหรือไม่
- **Regression test** — เปลี่ยน provider แล้วคุณภาพตกไหม

---

## 📅 แผนการพัฒนา (Phased Roadmap)

### Phase 0 — Foundation (สัปดาห์ 1-2)
- เลือก tech stack (Python? TypeScript?)
- ตั้ง project structure + dependency management
- เขียน `IAgentProvider` interface
- Implement **1 provider** ก่อน (แนะนำ Claude)
- ทดสอบ chat แบบง่ายๆ ได้

### Phase 1 — Multi-Provider + Capability + MCP + Migration (สัปดาห์ 3-4)
- เพิ่ม GPT และ Gemini provider
- สร้าง Capability system + config file
- Capability Router + fallback policy
- Tool schema adapter
- **MCP Integration** (ดู §MCP Integration):
  - MCP client (stdio + SSE) + tool registry
  - `mcp_servers.yaml` config + bridge เข้า tool schema adapter
  - CLI: `gang mcp {list,tools,test,reload}`
- **Schema Migration foundation** (ดู §Schema Migration):
  - linear versioned SQL migrations + `runner.py`
  - CLI: `gang db {status,migrate,rollback,new}`
  - Auto-backup before migrate (integration hook สำหรับ Phase 3)
- Integration test ครอบทุก provider × capability

### Phase 2 — Agent Lifecycle + Personality + Prompt Library (สัปดาห์ 5-6)
- Agent Registry + lifecycle states
- Personality Engine (hybrid: hash + LLM + seed)
- Naming flow + Reveal UX
- Trait override
- Persistence (เก็บ agent ไว้ใช้รอบหน้า)
- **Prompt Library + Versioning** (ดู §Prompt Library + Versioning):
  - `./data/prompts/` filesystem-backed, immutable versions, HEAD pointer
  - Jinja2 templates per block (personality / role / skill / memory)
  - Agent prompt bindings (pin version per block)
  - CLI: `gang prompts {list,show,diff,new,set-head,pin}`

### Phase 3 — Role/Skill + Memory + RAG + Backup + Profession (สัปดาห์ 7-8)
- Skill registry + tool binding (รวม MCP tools จาก Phase 1)
- Role/Skill assignment flow
- Memory system (short + long + structured) — เขียนลง `./data/`
- Versioning ของ role/skill
- **RAG Pipeline** (ดู §RAG Pipeline):
  - Loaders (markdown + PDF เริ่ม → web/git ภายหลัง), chunker, embedder, retriever, reranker
  - Collection model + per-agent attach ACL
  - Citation enforcement → ลด hallucination
  - CLI: `gang rag {collections,ingest,attach,search,stats,reindex}`
- **Profession Template** (ดู §Profession Template):
  - `Profession` model + `ProfessionRegistry` (plug-in YAML)
  - `apply()` factory — one-time, sliding-out reference
  - 5-6 builtin: software_engineer, data_analyst, writer, teacher, researcher, project_manager
  - CLI: `gang professions {list,show}`, `gang spawn --profession <name>`
  - Snapshot version pin (`<name>@v<ver>`)
- **Backup system** (restic integration):
  - `./data/` layout + `.backupignore`
  - CLI: `gang backup {snapshot,list,restore,verify,export,import,prune,status}`
  - WAL checkpoint + vector DB quiesce hooks
  - Backup metadata manifest
  - Scheduled snapshot (cron/launchd) + GFS retention
  - Weekly restore drill (automated verify)
  - `docs/RECOVERY.md` runbook

### Phase 4 — Notification + Scheduled Tasks (สัปดาห์ 9)
*(ดูรายละเอียดใน §Notification System และ §Scheduled Tasks)*
- `INotifier` Protocol + `NotifierRegistry` (plug-in)
- Implementations: Telegram, Discord, Line, Email (พร้อมกัน 4 ช่อง)
- Config YAML (`data/configs/notifications.yaml`) + `${ENV_VAR}` interpolation
- Routing engine — match by severity / event / tag
- Dispatcher — async fire-and-forget + retry (exp backoff) + per-channel rate limit + dedupe window
- Audit log → `./data/sqlite/audit.db`
- Hot reload (file watcher) + dry-run mode + healthcheck
- CLI: `gang notify {list,test,dry-run,send,history,reload,mute}`
- Event emitters ฝัง: backup events, watcher events (mediator events รอ Phase 5)
- **Scheduled Tasks**:
  - APScheduler + cron/interval/one-shot/event triggers
  - `scheduled_tasks.yaml` config — agent + prompt + output channels
  - Idempotent design + overlap skip + timezone-aware
  - CLI: `gang schedule {list,add,disable,run,history,next}`

### Phase 5 — Inter-Agent + Orchestration (สัปดาห์ 10-11)
- Message bus
- Delegation + Review pattern
- Multi-agent workflow engine
- **Mediator Agent** integrate กับ Phase 4 notifier (loop_detected → WARN, loop_unresolved → CRITICAL)

### Phase 6 — Observability + Eval + Guardrails (สัปดาห์ 12-13)
- Cost/token tracking dashboard
- Audit log expansion (รวม notification audit ที่มีอยู่)
- Skill benchmark suite
- Personality consistency test
- Watcher Agent (provider changelog) — emit via Phase 4 notifier
- **Guardrails / Safety Filter** (ดู §Guardrails):
  - 3-layer defense: input / output / tool call
  - Initial filters: prompt_injection, PII (Presidio), secret_leak
  - Per-agent policy binding (default + sensitive presets)
  - Violations log + notify CRITICAL on adversarial patterns
  - CLI: `gang guardrails {list,test,violations}`

### Phase 7 — UI + Polish (สัปดาห์ 14+)
- เลือก interface: CLI ก่อน → Web UI ภายหลัง
- Documentation
- Example agents (template)

---

## 🛠️ Tech Stack ที่แนะนำ

| ส่วน | ตัวเลือก |
|------|----------|
| **ภาษา** | Python (ecosystem AI ดีสุด) หรือ TypeScript (ถ้าอยากทำ web) |
| **Provider SDK** | `anthropic`, `openai`, `google-genai` |
| **Vector DB** | Chroma (เริ่มต้นง่าย), Qdrant (production) |
| **Structured storage** | SQLite (เริ่ม) → PostgreSQL (scale) |
| **Config** | Pydantic + YAML |
| **Plugin loading** | `importlib` (Python) / dynamic import (TS) |
| **Testing** | pytest + vcr.py (record API calls) |
| **Observability** | OpenTelemetry + simple dashboard |
| **Backup** | restic (encrypted, dedup, GFS retention) |
| **Notification** | `httpx` (Telegram/Discord/Line REST), `aiosmtplib` (email), `watchfiles` (hot reload) |
| **MCP** | `mcp` Python SDK (official) — stdio + SSE transports |
| **Prompt templating** | `jinja2` (versioned files ใน `./data/prompts/`) |
| **RAG** | Chroma (มีอยู่) + `pypdf`/`markitdown` (loader) + `tiktoken` (chunker) + optional `cohere`/cross-encoder (rerank) |
| **Scheduler** | `apscheduler` (local cron-like, async) |
| **Guardrails** | `presidio-analyzer` (PII), regex-based prompt injection patterns + optional `rebuff` |
| **DB Migration** | Light custom (linear SQL files) — ไม่ใช้ Alembic เต็ม |

---

## ⚠️ ความเสี่ยง & ข้อควรระวัง

1. **API cost บานปลาย / Agent คุยกันเองวน loop**
   - มี **Mediator Agent** (agent คนกลาง) อยู่เสมอในทุก multi-agent session
   - ตรวจจับ loop เมื่อบทสนทนาวน **3 ครั้ง** (เนื้อหาใกล้เคียง / ไม่มีความคืบหน้า)
   - Mediator เข้ามา **ยุติการวน + ชี้แนะทางออกใหม่** ให้ agent ที่กำลังคุยกัน
   - ถ้า Mediator แนะนำแล้วยังไม่สำเร็จ → **หยุดการทำงาน + ส่งแจ้งเตือน** ไปยังผู้ใช้
   - ยังคงมี budget cap เป็นด่านสุดท้ายเผื่อกรณีฉุกเฉิน

2. **Provider API เปลี่ยนบ่อย**
   - ใช้ **Version Config** ระบุชัดเจนว่า version ปัจจุบันรองรับอะไร (model, capability, schema)
   - มี **Backend Watcher Agent** ทำงาน **วันละครั้ง** เพื่อ:
     - ดึงข้อมูลล่าสุดของแต่ละ provider (release notes, changelog, API docs)
     - เปรียบเทียบกับ version config ปัจจุบัน
     - สรุปการเปลี่ยนแปลง + flag breaking change
     - เสนอ update ให้ผู้ใช้รีวิวก่อน merge
   - Pin version SDK + smoke test ทุก provider

3. **Personality drift**
   - **Reinforce ผ่าน system prompt ทุกครั้ง** ที่เรียก agent (ไม่ว่า context ยาวแค่ไหน)
   - System prompt ประกอบด้วย: ชื่อ, traits, role, skill, รวมไว้ที่ส่วนต้นเสมอ

4. **Security — Tool Execution Sandbox** (ดูรายละเอียดในหมวด Security ด้านล่าง)
5. **Privacy — Memory Management** (ดูรายละเอียดในหมวด Privacy ด้านล่าง)
6. **Vendor lock-in ของ feature เฉพาะ** (ดูรายละเอียดในหมวด Vendor Lock-in ด้านล่าง)
7. **Capability flag → if-else เยอะ** (ดูรายละเอียดในหมวด Design Patterns ด้านล่าง)
8. **Data loss / Disaster recovery** (ดูรายละเอียดในหมวด Backup & Recovery ด้านล่าง)
9. **Missed alerts / Alert fatigue** (ดูรายละเอียดในหมวด Notification System ด้านล่าง) — แจ้งเตือนพลาด CRITICAL หรือสแปมจนผู้ใช้ปิดทั้งหมด → ทั้งคู่ silent failure ที่อันตรายเท่ากัน
10. **Prompt drift / Personality erosion** (ดูรายละเอียดในหมวด Prompt Library) — system prompt เปลี่ยนแบบไม่ได้ตั้งใจ → USP "ชื่อ → นิสัย" พังเงียบๆ
11. **Prompt injection + Output leakage** (ดูรายละเอียดในหมวด Guardrails) — user/document หลอก agent + agent เผลอเปิดเผยข้อมูล sensitive
12. **Schema drift / Incompatible backup** (ดูรายละเอียดในหมวด Schema Migration) — DB เก่า restore ไม่ได้ใน code ใหม่
13. **MCP server availability** (ดูรายละเอียดในหมวด MCP Integration) — 3rd party MCP server หยุดดูแล → tool ที่ผูกอยู่หาย

---

## 🤖 System Agents (Agent หลังบ้าน)

นอกจาก agent ที่ผู้ใช้สร้าง ระบบจะมี agent ภายในที่ทำงานเสมอ:

| Agent | หน้าที่ | ทำงานเมื่อไหร่ |
|-------|---------|----------------|
| **Mediator Agent** | ตรวจจับ loop ใน multi-agent conversation, ยุติ + ชี้แนะทางออกใหม่, หยุด + แจ้งเตือนถ้าไม่สำเร็จ | ทุก multi-agent session (เริ่ม intervene เมื่อวน 3 ครั้ง) |
| **Watcher Agent** | ตรวจ provider API/changelog, อัปเดต version config, flag breaking change | วันละ 1 ครั้ง (scheduled) |
| **(เพิ่มภายหลัง)** Auditor / Cost Sentinel / etc. | — | — |

---

## 🔒 Security — Tool Execution Sandbox (รายละเอียด)

### ปัญหา
เมื่อ agent มี skill ผูกกับ tool จริง (รัน Python, query DB, shell command) — อาจถูก prompt injection หลอกให้ทำสิ่งอันตราย (`rm -rf /`, อ่าน secrets, ลบ database) หรือ agent เผลอรันคำสั่งผิดเอง

### Defense in Depth (หลายชั้น)

```
User Input → LLM → Tool Call Validator → Sandbox → Result
                         ↓
                  Audit Log + Policy Engine
```

### ระดับการ isolate

| ระดับ | วิธี | เครื่องมือ |
|------|------|-----------|
| **L1: Process** | subprocess + จำกัด resource | `subprocess` + `resource.setrlimit` |
| **L2: Container** | Docker/Podman ไม่มี network/volume mount | `docker run --rm --network=none --read-only` |
| **L3: MicroVM** | แยก kernel ปลอดภัยสุด | Firecracker, gVisor |
| **L4: Cloud sandbox** | service สำเร็จรูป | E2B, Modal, Daytona |

### Best Practices

- **Allowlist permissions** — agent แต่ละตัวระบุชัดเจนว่าใช้ tool ไหนได้ (ไม่ใช่ blacklist)
- **Schema validation** — ทุก tool call ผ่าน Pydantic validator ก่อนรัน
  - path → จำกัดใน working dir
  - URL → allowlist domain
  - SQL → parse หา DROP/DELETE
- **Human-in-the-loop** สำหรับ destructive action (`delete_file`, `send_email`, `git_push`) — pause + ถามผู้ใช้ก่อนรัน
- **Audit log** ทุก tool call: agent_id, tool, args, result, timestamp

### แนะนำสำหรับโปรเจกต์นี้
เริ่มจาก **L2 (Docker) + Allowlist + Schema validation + Human approval สำหรับ destructive tools** — ครอบคลุม 90% ของ risk

---

## 🔐 Privacy — Memory Management (รายละเอียด)

### ปัญหา
Memory เก็บข้อมูลส่วนตัวผู้ใช้ ถ้าจัดการไม่ดี:
- Leak ไปอยู่ใน prompt ที่ส่ง provider (อาจถูกใช้ train model)
- ผู้ใช้คนอื่นเข้าถึงได้
- "ลบแล้ว" แต่ยังอยู่ใน backup/vector DB
- ผิด GDPR / PDPA (Thailand)

### Memory Sensitivity Classification

```python
class MemorySensitivity(Enum):
    PUBLIC       # ความรู้ทั่วไป
    PERSONAL     # ข้อมูลส่วนตัวผู้ใช้
    SECRET       # password, API key, การเงิน
    EPHEMERAL    # ใช้ครั้งเดียว ห้ามเก็บ
```

### Best Practices

- **PII Detection ก่อน save** — regex/NER จับ email, phone, ID card, credit card → ถามผู้ใช้ก่อนเก็บ หรือ redact (เครื่องมือ: Microsoft Presidio)
- **Encryption strategy**:
  - At rest: SQLCipher / Postgres TDE
  - In transit: TLS ทุก connection
  - Application: encrypt field sensitive ก่อนเขียน (envelope encryption)
  - Vector: encrypt metadata, ไม่ encrypt vector
- **Right to be forgotten** (ลบได้จริง):
  - Hard delete: Primary store + Vector DB + Cache + Backup (crypto-shredding)
  - เก็บ deletion log เป็น proof
  - Cascade: ลบ agent → ลบ memory + conversation + audit
- **Provider data policy**:
  - ใช้ endpoint ที่ provider **ไม่ใช้ data train** (Anthropic default ไม่ train, OpenAI ต้อง opt-out)
  - ห้ามส่ง `SECRET` ไป provider โดยไม่ redact
  - ใช้ on-prem (Ollama, vLLM) สำหรับงาน sensitive
- **Memory scope isolation**:
  ```
  Agent A memory ⊥ Agent B memory   (ห้ามข้าม)
  User X agents  ⊥ User Y agents    (ห้ามข้าม)
  Shared pool                       (opt-in + ACL)
  ```
- **Retention policy** — auto-archive 90 วัน, conversation log auto-delete 30 วัน (config ได้)

### แนะนำสำหรับโปรเจกต์นี้
เริ่มจาก **PII detection + sensitivity tagging + cascade delete + provider data opt-out** → ขยายเป็น encryption + on-prem provider เมื่อ production

---

## 💾 Backup & Recovery (รายละเอียด)

### ปัญหา
ทุกอย่างเก็บใน local (SQLite + Chroma + configs + logs) — เครื่องพัง / drive ตาย / ลบผิด / ransomware → หายหมด ต้องเริ่มใหม่ตั้งแต่ศูนย์

### หลักการ
- **State ทั้งหมดอยู่ใน `./data/`** เท่านั้น — restore โฟลเดอร์นี้กลับมา = ระบบกลับมา
- Code/deps ไม่อยู่ใน backup (มี git + `uv.lock` อยู่แล้ว — clone ใหม่ + `uv sync` พอ)
- Backup tool ต้อง **open source** + **encrypted** + **portable**

### Tool: restic
- BSD-2 license, encrypted (AES-256), dedup (content-addressed), incremental, append-only mode รองรับ
- Repository ใช้ได้ทั้ง local disk / SFTP / S3-compatible → ปลายทางย้ายภายหลังได้

### Storage layout

```
./data/
├── sqlite/
│   ├── agents.db          # agent + skill + role registry
│   ├── memory.db          # structured facts ต่อ agent
│   └── audit.db           # tool calls + teaching events
├── chroma/                # vector DB (semantic memory)
├── configs/               # YAML — capability flags, agent overrides
└── logs/                  # JSONL — conversation transcripts
```

### Snapshot policy (GFS rotation)

| Tier | ความถี่ | Retention | Trigger |
|------|---------|-----------|---------|
| Hourly | ทุก 1 ชม. | 24 ชม. | scheduled (cron/launchd) |
| Daily | วันละครั้ง | 7 วัน | scheduled |
| Weekly | สัปดาห์ละครั้ง | 4 สัปดาห์ | scheduled |
| Monthly | เดือนละครั้ง | 12 เดือน | scheduled |
| Tagged | manual | ไม่ลบ | ก่อน schema migration / release |

`restic forget --keep-hourly 24 --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune`

### CLI commands (จะ implement)

```
gang backup snapshot [--tag <name>]    # สร้าง snapshot ใหม่
gang backup list                        # ดู snapshot ทั้งหมด
gang backup restore <id> [--to <path>]  # restore ทับ ./data/ หรือไปที่ใหม่
gang backup verify                      # restore ไป temp + integrity check
gang backup export --to <file.tar>      # tarball encrypted ที่พกพา/อัปโหลดเองได้
gang backup import <file.tar>           # restore จาก tarball
gang backup prune                       # ลบตาม retention policy
gang backup status                      # snapshot ล่าสุด + ขนาด repo
```

### Best practices ที่บังคับใช้

| Practice | วิธี |
|---|---|
| **3-2-1 rule** | Tier 1: local restic repo, Tier 2: `gang backup export` → ผู้ใช้พา tarball ไปไว้ที่อื่น (USB/NAS/cloud), Tier 3: tag สำคัญส่ง self-host หรือ user storage |
| **Encryption at rest** | restic encrypt ทุก snapshot ด้วย passphrase เก็บใน **macOS Keychain** (`security add-generic-password`) ห้ามอยู่ใน `.env` ที่ commit ได้ |
| **Exclude secrets + noise** | `.env`, `*.key`, `__pycache__/`, `.venv/`, `.ruff_cache/`, `models/cached/` → `restic --exclude-file=.backupignore` |
| **WAL checkpoint ก่อน snapshot** | รัน `PRAGMA wal_checkpoint(TRUNCATE)` กับ SQLite ทุกฐาน — กัน state ค้างใน WAL |
| **Vector DB quiesce** | Pause embedding worker → `chroma_client.persist()` → snapshot → resume — กัน index corrupt |
| **Backup metadata manifest** | เขียน `./data/.backup_manifest.json` ก่อน snapshot: `{git_sha, python_version, schema_version, chroma_version, timestamp}` → restore แล้วรู้ว่าใช้กับ code/lib version ไหน |
| **Restore drill (weekly auto-verify)** | scheduled: pick snapshot ล่าสุด → restore ไป `/tmp/gang-restore-test` → integrity check → diff schema → report → ลบ. **backup ที่ไม่เคย verify = ไม่มี backup** |
| **GFS retention** | ดูตารางข้างบน — ขนาดไม่บานปลาย แต่ยังย้อนได้ไกล |
| **Named tags** | `restic backup --tag "before-schema-v3"` ทุก migration / release |
| **Append-only mode** | `restic init --append-only` กัน accidental delete + ransomware ลบ backup ตาม |

### Recovery runbook (`docs/RECOVERY.md`)
ต้องมีเป็น checklist — RTO target **< 15 นาที** จากเครื่องเปล่าถึงใช้งานได้:

1. Install `uv` + Python 3.12
2. `git clone https://github.com/Sin1apachai/gangagent`
3. `uv sync`
4. Install `restic` (`brew install restic`)
5. `gang backup restore <latest-id>` หรือ `gang backup import <file.tar>`
6. สร้าง `.env` ใหม่ ใส่ API keys (ไม่อยู่ใน backup)
7. `uv run pytest -q` (smoke test)
8. `gang providers` (verify registry)

### Risk acceptance (local-only choice)
ผู้ใช้เลือก local disk เป็นปลายทางหลัก — ตระหนักว่า:
- 🔴 **ไฟไหม้/ขโมย/drive ตาย → หายหมด** ถ้าไม่ได้ `gang backup export` ออกไปก่อน
- ✅ บรรเทาด้วย workflow: `gang backup export` ส่ง tarball encrypted ไป USB/NAS/cloud เอง — อย่างน้อยสัปดาห์ละครั้ง
- ⏳ Phase 5+ อาจเพิ่ม restic ปลายทาง S3-compatible (R2/B2/MinIO) เป็น tier 3 อัตโนมัติ

### Deferred items (ทำภายหลัง)
- **Audit log + immutable repo** → Phase 5 พร้อม observability
- **Crypto-shredding** สำหรับ right-to-be-forgotten → Phase 3 พร้อม memory deletion
- **Cost / size monitoring** + alert → Phase 5

---

## 👔 Profession Template (รายละเอียด)

### ปัญหา
ทุกครั้งที่สร้าง agent ใหม่ ผู้ใช้ต้อง config role + skills + tone + provider เองตั้งแต่ศูนย์ → friction สูง + agent ออกมาคุณภาพไม่สม่ำเสมอ

อยากได้ "preset 1-คลิก" สำหรับอาชีพยอดนิยม (engineer, analyst, writer, teacher, ...) — แต่ **ห้าม**ทำให้ทับซ้อนกับ Role/Skill/Personality ที่มีอยู่

### หลักการ 1 ประโยค
> **Profession เป็น recipe, Agent คือเค้กที่อบเสร็จแล้ว** — recipe ทำงานครั้งเดียวตอนอบ จากนั้นแก้เค้กที่ตัวเค้ก ไม่ใช่ที่ recipe

แปลว่า: Profession Template เป็น **factory ที่สลายตัวหลัง apply** ไม่ใช่ **field ถาวรบน Agent**

### 6 กฎที่กัน overlap

| # | กฎ | ทำไม |
|---|---|---|
| 1 | **One-time application** — apply ครั้งเดียวตอน `create_agent()` ไม่มี API ให้ reapply | กัน profession overwrite สิ่งที่ user แก้แล้ว |
| 2 | **Source of truth ชัดเจน** — runtime อ่านจาก `Agent.role/skills/traits` เท่านั้น ห้าม import profession module ตอน chat | บังคับวินัยที่ระดับ architecture |
| 3 | **Trait deltas ไม่ใช่ replacements** — bias บนค่าจาก Personality Engine, clamp [0,1] | "ชื่อ → นิสัย" ยังเป็น USP, profession แค่ปรับน้ำหนัก |
| 4 | **`created_from_profession` เป็น label เท่านั้น** — read-only, ใช้สำหรับ analytics/grouping ห้าม drive behavior | ตอบ "show me all engineers" ได้ โดยไม่กระทบพฤติกรรม |
| 5 | **Suggestions, not enforcements** — `suggested_provider/model` แค่ hint, user ปฏิเสธได้ | ผู้ใช้ยัง autonomous |
| 6 | **Snapshot at apply time (version pin)** — เก็บเป็น `software_engineer@v1.2` | profession YAML เปลี่ยน → agents เก่าไม่กระทบ |

### Data model

```python
class Profession(BaseModel):
    name: str                              # "software_engineer"
    version: str                           # "1.2"
    display_name: str
    role_template: str                     # default ให้ Agent.role
    default_skills: list[str]              # reference Skill registry
    trait_deltas: dict[TraitName, float]   # bias, -1.0 to +1.0
    suggested_provider: str | None         # HINT only
    suggested_model: str | None            # HINT only
    tool_allowlist: list[str]              # union กับ Skill tools

# Agent: ของเดิมไม่เพิ่ม field พฤติกรรม ยกเว้น label เดียว
class Agent(BaseModel):
    # ... ของเดิมทั้งหมด ...
    created_from_profession: str | None = None   # "software_engineer@v1.2" — label
```

→ **0 field overlap** บน Agent. Profession เป็น registry/file อีกชั้นที่ Agent ไม่ depend ตอน runtime

### Apply flow (factory pattern)

```python
def create_agent(name: str, profession: str | None = None) -> Agent:
    base_traits = personality_engine.from_name(name)   # ชื่อ → traits (USP)

    if profession is None:
        return Agent(name=name, traits=base_traits, role="", skills=[])

    prof = ProfessionRegistry.get(profession)
    return Agent(
        name=name,
        traits=clamp(base_traits + prof.trait_deltas, 0, 1),  # bias เท่านั้น
        role=prof.role_template,                              # default — user แก้ได้
        skills=list(prof.default_skills),                     # default — เพิ่ม/ลบได้
        tool_allowlist=list(prof.tool_allowlist),
        preferred_provider=prof.suggested_provider,            # hint
        preferred_model=prof.suggested_model,                  # hint
        created_from_profession=f"{prof.name}@v{prof.version}", # label
    )
```

หลัง `create_agent()` profession reference หายไปจาก behavior — เหลือแค่ label

### Lifecycle integration

```
Spawning → Naming → Personality emerges (ชื่อ → traits)
        → [Profession?] OPTIONAL — reveal preset card, ผู้ใช้เลือก/skip
              ├─ เลือก: apply preset → role/skills/trait bias ถูก pre-fill
              └─ skip: blank slate (flow เดิม backward compatible)
        → Training (user override อะไรก็ได้ — preset แค่จุดเริ่ม)
        → Active
```

### Plug-in pattern (เหมือน providers)

```
src/gangagent/professions/
  base.py                    # Profession model + ProfessionRegistry
  apply.py                   # apply(name, profession_name) -> AgentInitArgs
  builtin/
    software_engineer.yaml
    data_analyst.yaml
    teacher.yaml
    writer.yaml
    researcher.yaml
    project_manager.yaml
  user/                      # user-created professions (gitignored)
```

→ เพิ่ม profession ใหม่ = drop YAML file (ไม่ต้องแก้โค้ด — เหมือนเพิ่ม provider)

### ตัวอย่าง YAML

```yaml
# professions/builtin/software_engineer.yaml
name: software_engineer
version: "1.0"
display_name: "วิศวกรซอฟต์แวร์"
role_template: |
  ช่วยออกแบบ/เขียน/รีวิวโค้ด อธิบายเป็นขั้นเป็นตอน
  ให้ตัวอย่างที่รันได้จริง ระบุ trade-off เมื่อมีหลายวิธี
default_skills: [python, git, debugging, system_design, testing]
trait_deltas:
  conscientiousness: +0.3
  verbosity: -0.1
  formality: 0.0
suggested_provider: claude
suggested_model: claude-sonnet-4-6
tool_allowlist: [code_exec, web_search, file_read, file_write]
```

### 3 anti-patterns ที่ห้ามทำเด็ดขาด

1. ❌ เพิ่ม `agent.profession` field ที่อ่านตอน runtime → **ทับ Role ทันที**
2. ❌ มี `profession.refresh(agent)` หรือ `profession.reapply()` API → **ทำลายการแก้ของ user**
3. ❌ ใช้ profession ใน system prompt builder โดยตรง → **ต้องอ่านจาก `agent.role` เท่านั้น**

### CLI commands (จะ implement)

```
gang professions list                    # ดู template ที่มี
gang professions show <name>             # ดูรายละเอียด preset
gang spawn --profession software_engineer --name "มานี"
gang spawn --name "มานี"                 # ไม่ใช้ profession (flow เดิม)
```

### แนะนำสำหรับโปรเจกต์นี้
Phase 3 — implement พร้อม Skill registry (เพราะ `default_skills` ต้อง reference registry ที่มีอยู่จริงก่อน) เริ่มด้วย builtin 5-6 professions ที่ครอบคลุม use case ทั่วไป → ขยายเป็น user-defined ภายหลัง

---

## 🔔 Notification System (รายละเอียด)

### ปัญหา
ระบบต้องแจ้งผู้ใช้เรื่องสำคัญ — Mediator ตัดวงสนทนาวน, Watcher เจอ provider API เปลี่ยน, Backup ล้มเหลว, Cost เกิน budget, restore drill fail — แต่ผู้ใช้ไม่นั่งดู terminal ทั้งวัน

ต้องการ: ส่งผ่าน **Telegram / Discord / Line / Email** + ขยายช่องทางใหม่ได้, ตั้งค่าผ่าน config (ไม่แตะโค้ด), routing ตาม severity/event/tag

### หลักการ
- **Plug-in pattern** เหมือน `providers/` — Strategy + Registry + Adapter (รักษาความสม่ำเสมอใน codebase)
- **Config-driven** — YAML เป็น source of truth, hot-reload ได้
- **Async fire-and-forget** — notification ห้าม block agent execution
- **Failover** — CRITICAL event ส่งหลายช่อง

### Data model

```python
class Severity(StrEnum):
    INFO = "info"
    WARN = "warn"
    ERROR = "error"
    CRITICAL = "critical"

class NotificationMessage(BaseModel):
    event: str                  # "backup.failed", "agent.loop_unresolved", ...
    title: str
    body: str
    severity: Severity
    tags: list[str] = []        # ["agent:มานี", "phase:training"]
    metadata: dict = {}
    timestamp: datetime

class SendResult(BaseModel):
    channel: str
    success: bool
    error: str | None = None
    latency_ms: int

class INotifier(Protocol):
    name: str
    config: NotifierConfig

    async def send(self, msg: NotificationMessage) -> SendResult: ...
    async def healthcheck(self) -> bool: ...
    def format(self, msg: NotificationMessage) -> str: ...  # ปรับ format ต่อช่อง
```

### File structure (plug-in)

```
src/gangagent/notifiers/
  base.py                    # INotifier + NotificationMessage + Severity
  registry.py                # @register_notifier + discover
  router.py                  # routing engine (event → channels)
  dispatch.py                # async fire-and-forget + retry + dedupe
  config.py                  # YAML loader + ${ENV_VAR} interpolation
  implementations/
    telegram.py              # @register_notifier("telegram")
    discord.py
    line.py
    email.py
    webhook.py               # generic — Slack/Teams/custom
    console.py               # dev fallback
```

→ เพิ่มช่องใหม่ = drop file + decorator (เหมือน providers)

### Config YAML

```yaml
# data/configs/notifications.yaml
channels:
  my_telegram:
    type: telegram
    bot_token: ${TELEGRAM_BOT_TOKEN}      # อ่านจาก .env
    chat_id: "123456789"
    parse_mode: HTML
    enabled: true

  team_discord:
    type: discord
    webhook_url: ${DISCORD_WEBHOOK_URL}
    username: "gangAgent"
    enabled: true

  line_personal:
    type: line
    channel_access_token: ${LINE_TOKEN}
    user_id: ${LINE_USER_ID}              # Messaging API
    # หรือ
    # notify_token: ${LINE_NOTIFY_TOKEN}  # Line Notify (deprecated 2025 แต่ยังใช้ได้)
    enabled: true

  ops_email:
    type: email
    smtp_host: smtp.gmail.com
    smtp_port: 587
    use_tls: true
    username: ${SMTP_USER}
    password: ${SMTP_PASS}
    from_addr: "gangagent@example.com"
    to: [ops@example.com]
    enabled: false                         # ปิดได้แบบไม่ลบ

routes:
  - match: { severity: CRITICAL }
    channels: [my_telegram, ops_email]     # ส่งหลายช่อง (failover)

  - match: { severity: ERROR }
    channels: [my_telegram]

  - match: { severity: WARN, tags: ["agent:*"] }
    channels: [team_discord]

  - match: { event: "backup.complete" }
    channels: [team_discord]
    rate_limit: { max: 1, per: 1h }        # กัน spam

  - match: { event: "agent.spawn" }
    channels: []                            # silenced

defaults:
  retry:
    attempts: 3
    backoff_seconds: [1, 5, 30]            # exponential
  rate_limit:
    max: 60
    per: 1h                                 # per-channel
  dedupe_window_seconds: 300                # 5 นาที — message ซ้ำ = ส่งครั้งเดียว
  timeout_seconds: 10
```

### Routing engine

```python
async def dispatch(msg: NotificationMessage) -> list[SendResult]:
    matched = router.match(msg)              # apply rules from YAML
    if not matched:
        return []

    if dedupe.seen_recently(msg):            # 5-min dedupe window
        return []

    results = await asyncio.gather(*[
        send_with_retry(notifier, msg)        # retry + backoff
        for notifier in matched
        if rate_limiter.allow(notifier)       # per-channel cap
    ])
    audit_log.write(msg, results)             # ./data/sqlite/audit.db
    return results
```

### Events ที่ระบบจะ emit

| Event | Severity | จาก | ใช้ช่องไหน (default) |
|---|---|---|---|
| `agent.spawned` | INFO | lifecycle | (silenced) |
| `agent.loop_detected` | WARN | Mediator | Discord |
| `agent.loop_unresolved` | CRITICAL | Mediator | Telegram + Email |
| `provider.breaking_change` | WARN | Watcher | Telegram |
| `provider.unavailable` | ERROR | provider call | Telegram |
| `backup.complete` | INFO | backup scheduler | Discord (rate-limited) |
| `backup.failed` | ERROR | backup scheduler | Telegram |
| `backup.restore_drill_failed` | CRITICAL | weekly verify | Telegram + Email |
| `cost.threshold_warning` | WARN | cost tracker | Telegram |
| `cost.budget_exceeded` | CRITICAL | cost tracker | Telegram + Email |
| `tool.destructive_pending` | INFO | tool sandbox | Telegram (HITL) |
| `auth.failure` | ERROR | provider | Telegram |

### Best practices ที่บังคับใช้

| Practice | วิธี |
|---|---|
| **Retry + exponential backoff** | 3 attempts, delays [1s, 5s, 30s] — กัน flaky network |
| **Per-channel rate limit** | Telegram global limit 30 msg/sec — กันโดน ban |
| **Dedupe window** | event เดียวกัน fire ซ้ำใน 5 นาที = ส่งครั้งเดียว — กัน alert storm |
| **Async fire-and-forget** | `asyncio.create_task()` ไม่ block core flow — agent ทำงานต่อได้แม้ notification ล้ม |
| **Failover (multi-channel)** | CRITICAL ส่งหลายช่อง parallel — ช่องหนึ่งตาย ยังได้ครบ |
| **Healthcheck command** | `gang notify test <channel>` — verify credential ก่อนใช้จริง |
| **Hot reload config** | file watcher บน `notifications.yaml` — แก้แล้ว effect ทันที |
| **Dry-run mode** | `gang notify dry-run --event backup.failed` — ดู match กับ rule ไหน ไม่ส่งจริง |
| **PII-aware redaction** | respect `MemorySensitivity` (§Privacy) — strip secrets/PII จาก message ก่อนส่ง |
| **Audit log** | ทุก notification log เข้า `./data/sqlite/audit.db` — debug + compliance |
| **Severity escalation** | INFO ที่ retry หมดแล้วยังล้ม → bump เป็น WARN → CRITICAL (กัน silent failure) |
| **Bootstrap-safe** | ถ้า YAML invalid → fallback เป็น `console` notifier (ไม่ crash) |
| **Template/format ต่อช่อง** | Telegram: HTML, Discord: markdown + embed, Line: plain, Email: HTML + plain alternative |

### CLI commands (จะ implement)

```
gang notify list                            # ดู channel ที่ config ไว้
gang notify test <channel>                  # ส่ง test message
gang notify dry-run --event <name>          # ดู match rule ไหน ไม่ส่งจริง
gang notify send --severity WARN --title "..." --body "..."   # manual trigger
gang notify history [--channel x]           # log ย้อนหลัง
gang notify reload                          # force reload YAML
gang notify mute --event <name> --duration 1h   # silence ชั่วคราว
```

### Lib choices (open source, lightweight)

| ช่อง | Lib | ทำไม |
|---|---|---|
| Telegram | `httpx` ตรง Bot API | ไม่ต้อง wrapper หนัก, official REST API ง่าย |
| Discord | `httpx` ตรง Webhook URL | webhook = single POST, ไม่ต้อง bot lib |
| Line | `httpx` ตรง Messaging API | official REST API |
| Email | `aiosmtplib` | async SMTP, รองรับ TLS/STARTTLS |
| Config | `pydantic` + `pyyaml` (มีอยู่แล้ว) | reuse — type-safe |
| File watcher | `watchfiles` | small, async-native, hot-reload |

→ ไม่เพิ่ม heavy dependency

### Anti-patterns ที่ห้ามทำ

1. ❌ Sync `requests.post()` ใน hot path → block agent → latency spike
2. ❌ Hard-code channel/token ในโค้ด → config-driven หาย
3. ❌ ไม่มี rate limit → โดน provider ban → notification ไม่ทำงานเงียบๆ
4. ❌ Notification logic ใน agent core → coupling — agent ต้อง emit event เท่านั้น dispatcher แยกอยู่
5. ❌ Crash agent เมื่อ notification ล้ม → notification เป็น peripheral concern

### แนะนำสำหรับโปรเจกต์นี้
Phase 4 (ใหม่) — implement 4 ช่องพร้อมกัน (Telegram, Discord, Line, Email) + routing engine + hot reload เพราะส่วนกลาง (registry/router/dispatcher) เป็นของ shared — ทำครั้งเดียวรองรับทุกช่อง

---

## 🔌 MCP (Model Context Protocol) Integration (รายละเอียด)

### ปัญหา
Tool ecosystem แตกเป็นเสี่ยง — Anthropic format, OpenAI format, Gemini format, custom tools — ต้องเขียน adapter ทุกครั้งที่เพิ่ม tool

**MCP** (Model Context Protocol) คือ open standard ที่ Anthropic + ชุมชนผลักดัน เพื่อให้ tool/resource/prompt เชื่อมกับ AI agent ได้แบบ universal — ถ้า support = ใช้ MCP server ที่คนอื่นเขียนได้ฟรี (filesystem, GitHub, Slack, database, ...)

### หลักการ
- **MCP server** = ผู้ให้ tool (เขียนใน MCP protocol)
- **MCP client** = agent ที่เรียกใช้ (gangAgent ทำหน้าที่นี้)
- การเชื่อมผ่าน stdio / SSE / WebSocket
- Tool schema มาตรฐาน → adapter เดียวพอ (แปลงเข้า provider-specific format ภายใน)

### Integration กับ architecture เดิม

```
Skill (gangAgent)  ──▶  Tool binding
                            ├─▶  built-in tool (Python function)
                            └─▶  MCP tool (proxy ผ่าน MCP client)
                                      ↓
                                 MCP Server (stdio/SSE)
                                      ↓
                            ┌─────────┼──────────┐
                            ↓         ↓          ↓
                       filesystem  GitHub    Slack   ...
                       (ของคนอื่น เขียน)
```

### Data model

```python
class MCPServer(BaseModel):
    name: str
    transport: Literal["stdio", "sse", "websocket"]
    command: str | None = None         # stdio: shell command to spawn
    args: list[str] = []
    url: str | None = None             # sse/ws: endpoint
    env: dict[str, str] = {}
    enabled: bool = True

class MCPTool(BaseModel):
    server: str                        # which MCPServer provides this
    name: str                          # tool name from MCP discovery
    description: str
    input_schema: dict                 # JSON schema
```

### File structure

```
src/gangagent/mcp/
  client.py                  # MCP client wrapper (stdio + SSE)
  registry.py                # discover tools from MCP servers
  bridge.py                  # MCPTool ↔ tools/schema.py adapter
src/gangagent/configs/
  mcp_servers.yaml           # user-configured servers
```

### Config YAML

```yaml
# data/configs/mcp_servers.yaml
servers:
  filesystem:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${ALLOWED_PATH}"]
    enabled: true

  github:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: ${GITHUB_TOKEN}
    enabled: true

  custom_sse:
    transport: sse
    url: https://my-mcp-server.example.com/sse
    enabled: false
```

### CLI

```
gang mcp list                     # ดู MCP servers ที่ config + status
gang mcp tools                    # ดู tool ทั้งหมดจาก servers ที่ enabled
gang mcp test <server>            # spawn server + list tools (validate)
gang mcp reload                   # reload config
```

### Best practices
- **Reuse tool sandbox** — MCP tools ผ่าน sandbox/allowlist เดียวกับ built-in tools (`§Security`)
- **Capability gate** — agent ที่ไม่มี `Capability.TOOL_USE` ไม่เห็น MCP tools (consistent กับ Capability Flag)
- **Schema validation** — MCP tool schema ผ่าน Pydantic ก่อนเชื่อมเข้า provider format
- **Lazy spawn** — stdio server spawn ตอนใช้จริง ไม่ใช่ตอน startup (ลด resource)
- **Health monitoring** — server ตาย → emit `mcp.server_down` event ผ่าน Notification (Phase 4)
- **Lock-in protection** — เก็บ list of tools used + อาจ migrate ไป built-in ถ้า MCP server หยุดดูแล

### แนะนำสำหรับโปรเจกต์นี้
Phase 1 — implement พร้อม tool schema adapter (เพราะ MCP เป็นรูปแบบ tool หนึ่ง — ใช้ adapter เดียวกัน) ทำให้ Phase 3 Skill registry รับ MCP tools เข้ามาได้ทันที

---

## 📝 Prompt Library + Versioning (รายละเอียด)

### ปัญหา
plan ระบุ "reinforce personality ผ่าน system prompt ทุก call" — แต่ system prompt นั้น:
- เก็บที่ไหน?
- ใครแก้ได้?
- เปลี่ยนแล้วย้อนกลับได้ไหม?
- เปลี่ยนแล้วกระทบ agent ที่ใช้อยู่ยังไง?

ถ้าไม่มี version control → **personality drift silently** = USP ของระบบพัง

### หลักการ
- **Prompts เป็น artifact** ไม่ใช่ string ที่ฝังในโค้ด
- **Versioned + immutable** — เก็บทุก version, ไม่ overwrite
- **Pinned per agent** — agent อ้าง prompt version ที่ตัวเองสร้างจาก (เหมือน `created_from_profession`)
- **Composable** — system prompt = personality block + role block + skill block + memory block (template assemble)

### Data model

```python
class PromptTemplate(BaseModel):
    name: str                          # "personality_reinforcement"
    version: str                       # "1.2"
    template: str                      # Jinja2 syntax
    variables: list[str]               # ["name", "traits", "role"]
    description: str
    created_at: datetime
    parent_version: str | None         # version ที่ fork มา

class AgentPromptBinding(BaseModel):
    agent_id: str
    block: Literal["personality", "role", "skill", "memory"]
    template_name: str
    template_version: str              # pin ไว้ — upgrade ต้อง explicit
```

### Storage layout

```
./data/prompts/
  personality_reinforcement/
    v1.0.j2
    v1.1.j2
    v1.2.j2
    HEAD                              # current default version
  role_block/
    v1.0.j2
  skill_block/
    v1.0.j2
  memory_block/
    v1.0.j2
```

(ใช้ filesystem-based versioning + git-friendly — ไม่ใช่ DB เพื่อให้ diff ได้ง่าย)

### Assembly flow

```python
def build_system_prompt(agent: Agent) -> str:
    return "\n\n".join([
        prompt_lib.render("personality_reinforcement", agent.prompt_bindings["personality"],
                          name=agent.name, traits=agent.traits),
        prompt_lib.render("role_block", agent.prompt_bindings["role"],
                          role=agent.role),
        prompt_lib.render("skill_block", agent.prompt_bindings["skill"],
                          skills=agent.skills),
        prompt_lib.render("memory_block", agent.prompt_bindings["memory"],
                          relevant_facts=agent.memory.retrieve(k=5)),
    ])
```

### CLI

```
gang prompts list                              # ดู template ทั้งหมด
gang prompts show <name> [--version <v>]       # ดูเนื้อหา
gang prompts diff <name> <v1> <v2>             # diff version
gang prompts new <name> --from <version>       # fork version
gang prompts set-head <name> <version>         # ตั้ง default
gang prompts pin <agent-id> <block> <name> <version>   # bind ให้ agent
```

### Best practices
- **Immutable** — เคย create version แล้วลบไม่ได้ (กัน agent ที่อ้างอยู่พัง)
- **Semantic versioning** — bump version เมื่อ semantic เปลี่ยน
- **Test-attached** — แต่ละ version มี evaluation test (consistency check ตาม §9 Evaluation)
- **Audit trail** — ใครเปลี่ยน HEAD เมื่อไหร่
- **Cap on history** — soft cap ที่ 50 versions per template (warn ถ้าเกิน — บ่งบอกว่าออกแบบไม่ดี)

### แนะนำสำหรับโปรเจกต์นี้
Phase 2 — ทำพร้อม Personality Engine เพราะ personality block เป็น prompt template หลัก. ถ้าไม่ทำตอนนี้ → ฝัง prompt ในโค้ด → ย้อนกลับยาก

---

## 📚 RAG (Retrieval-Augmented Generation) Pipeline (รายละเอียด)

### ปัญหา
Memory System (§6) เก็บ "สิ่งที่คุยกับ agent" — แต่ใน workflow จริงผู้ใช้อยาก feed **knowledge base** ภายนอกให้ agent อ้างอิง:
- PDF เอกสาร
- Web pages
- Code repository
- Markdown notes

ไม่มี ingest pipeline = agent ไม่รู้เรื่องนอกบทสนทนา

### หลักการ
- **แยก Memory กับ Knowledge** — Memory = ของ agent ตัวนั้น, Knowledge = collection ที่หลาย agents อ่านได้
- **Pipeline เป็น stages** — ingest → parse → chunk → embed → store → retrieve → rerank
- **Per-collection** — แต่ละ knowledge base เป็น collection แยก (agent เลือก attach ทีละ collection)

### Stages

```
File / URL ──▶ Loader ──▶ Parser ──▶ Chunker ──▶ Embedder ──▶ Vector Store
                                                                    │
                                                                    ↓
                                                              Retriever ──▶ Reranker ──▶ Context
                                                                                              │
                                                              build_system_prompt(..., context) 
```

### Data model

```python
class Collection(BaseModel):
    name: str
    description: str
    embedding_model: str               # "text-embedding-3-small" / sentence-transformers/...
    chunk_size: int = 512
    chunk_overlap: int = 64

class Document(BaseModel):
    id: str
    collection: str
    source: str                        # URI / path
    content_hash: str                  # ตรวจ duplicate
    metadata: dict                     # author, date, tags

class Chunk(BaseModel):
    document_id: str
    index: int
    text: str
    embedding: list[float]
    metadata: dict
```

### File structure

```
src/gangagent/rag/
  loaders/                   # PDF, URL, code repo, markdown — plug-in
    pdf.py
    web.py
    git_repo.py
    markdown.py
  chunkers/                  # sentence, paragraph, semantic
  embedders/                 # OpenAI, sentence-transformers, ...
  retrievers/                # similarity, MMR, hybrid (vector + BM25)
  rerankers/                 # cohere, cross-encoder, LLM-based
  pipeline.py                # orchestrate stages
```

### CLI

```
gang rag collections list
gang rag collections create <name> [--embed-model <m>]
gang rag ingest <collection> <path-or-url>          # ingest file/dir/URL
gang rag attach <agent-id> <collection>             # ให้ agent เข้าถึง
gang rag search <collection> "<query>" [-k 5]
gang rag stats <collection>                         # document/chunk count, size
gang rag reindex <collection>                       # re-embed ทั้ง collection
```

### Best practices
- **Content-hash dedup** — ingest ไฟล์ซ้ำ = skip
- **Incremental update** — เปลี่ยนแค่ chunk ที่ differ (ไม่ re-embed ทั้งไฟล์)
- **Hybrid retrieval** — vector + BM25 combined (vector แม่นกับ semantic, BM25 แม่นกับ keyword)
- **Citation** — chunk ส่งกลับพร้อม `source` → system prompt บังคับ agent ให้อ้างอิง → ลด hallucination
- **PII scrub before embed** — sensitive doc ผ่าน Presidio (§Privacy) ก่อน
- **Per-agent ACL** — collection มี allowlist agent (memory isolation)
- **Reembed alert** — ถ้า embedding model upgrade → flag collection ที่ต้อง reindex
- **Cost guard** — ingest ใหญ่ๆ pre-estimate cost (embedding API charge ตาม tokens)

### แนะนำสำหรับโปรเจกต์นี้
Phase 3 — extend Memory System (vector DB มีอยู่แล้ว) ด้วย ingest pipeline + retriever + reranker เริ่มด้วย 2 loaders (markdown + PDF) แล้วขยาย

---

## ⏰ Scheduled Tasks (รายละเอียด)

### ปัญหา
Agent reactive ตอบเมื่อ user ถาม — แต่ผู้ใช้อยาก "ทุกเช้าสรุปข่าว", "ทุก 1 ชม. เช็ค inbox", "ก่อน meeting 15 นาที ทบทวน agenda"

ไม่มี scheduler = ต้องเปิด terminal สั่งเอง ขาด proactive value

### หลักการ
- **Scheduler แยกจาก agent core** — agent ไม่รู้ตัวว่าถูก trigger จาก schedule หรือ user
- **Task = (trigger, agent, prompt, output_channel)** — declarative
- **ใช้ Notification system (Phase 4)** เป็น output channel — task เสร็จ → ส่ง Telegram/Discord/...
- **Local-first** — ใช้ APScheduler / cron / launchd (ไม่ต้องมี server)

### Data model

```python
class Trigger(BaseModel):
    type: Literal["cron", "interval", "one_shot", "event"]
    cron: str | None = None            # "0 7 * * *" = 7:00 ทุกวัน
    interval_seconds: int | None = None
    run_at: datetime | None = None
    event_pattern: str | None = None   # subscribe event เช่น "backup.complete"

class ScheduledTask(BaseModel):
    id: str
    name: str
    trigger: Trigger
    agent_id: str
    prompt_template: str               # อ้าง prompt library
    prompt_vars: dict = {}
    output_channels: list[str] = []    # ['my_telegram'] — notifier channel ids
    enabled: bool = True
    max_runtime_seconds: int = 300
    retry_on_failure: bool = True
    timezone: str = "Asia/Bangkok"
```

### Config YAML

```yaml
# data/configs/scheduled_tasks.yaml
tasks:
  morning_news_summary:
    trigger: { type: cron, cron: "0 7 * * *" }
    agent_id: "agent_news_analyst"
    prompt_template: "summarize_top_news"
    prompt_vars: { sources: ["bbc", "reuters"], top_n: 5 }
    output_channels: [my_telegram]
    timezone: Asia/Bangkok

  hourly_inbox_check:
    trigger: { type: interval, interval_seconds: 3600 }
    agent_id: "agent_email_assistant"
    prompt_template: "check_inbox"
    output_channels: [my_telegram]
    enabled: true

  on_backup_failure:
    trigger: { type: event, event_pattern: "backup.failed" }
    agent_id: "agent_ops"
    prompt_template: "diagnose_backup_failure"
    output_channels: [my_telegram, ops_email]
```

### File structure

```
src/gangagent/scheduler/
  base.py                    # Trigger + ScheduledTask models
  engine.py                  # APScheduler wrapper + event listener
  runner.py                  # execute task = chat + collect + dispatch to channels
```

### CLI

```
gang schedule list
gang schedule add <task.yaml> | --inline ...
gang schedule disable <id>
gang schedule run <id>                # manual trigger
gang schedule history [--id x]        # past runs + outcome
gang schedule next                    # next 10 runs
```

### Best practices
- **Idempotent task design** — task ที่ retry ต้อง safe (ไม่ส่ง email ซ้ำ)
- **Run budget per task** — max_runtime_seconds + max_cost_per_run
- **Skip on overlap** — ถ้า run ก่อนหน้ายังไม่จบ → skip ไม่ใช่ queue (กัน pile-up)
- **Timezone explicit** — กัน DST / cross-region bug
- **Missed-run policy** — เครื่องปิด 1 วัน → run ทันที ตอนเปิด หรือ skip? config ได้
- **Event-driven tasks** ใช้ pub/sub bus เดียวกับ Notification (เพิ่มความ consistency)
- **Audit log** — runs ทั้งหมดเข้า `./data/sqlite/audit.db` (เหมือน notification)

### แนะนำสำหรับโปรเจกต์นี้
Phase 4 — ทำต่อท้าย Notification system (ใช้ output_channels จากที่เพิ่งสร้าง) — เพิ่ม APScheduler + event bridge ครึ่งวันก็จบ

---

## 🛡️ Guardrails / Safety Filter (รายละเอียด)

### ปัญหา
ก่อน open source / multi-user — ต้องป้องกัน:
- **Prompt injection** — user/document หลอกให้ agent ทำสิ่งที่ผู้ออกแบบไม่ต้องการ ("ignore previous instructions...")
- **PII leak ในคำตอบ** — agent เผลอตอบข้อมูลส่วนตัวที่อยู่ใน memory
- **NSFW / Toxic output** — agent ถูกหลอกให้สร้าง content ไม่เหมาะสม
- **Sensitive topic** — บริษัทอาจห้าม agent ตอบเรื่อง legal/medical
- **Data exfiltration via tool** — prompt injection → agent ใช้ tool ส่งข้อมูลออก (covered บางส่วนใน Security)

### หลักการ
- **Defense in depth** — หลายชั้น (input → output → tool call)
- **Configurable per agent** — agent สำหรับงาน sensitive ใช้ stricter guardrails
- **Fail-safe defaults** — ถ้า guard service ล่ม → block (ไม่ใช่ allow)

### Layers

```
User input ──▶ Input Guard ──▶ Agent ──▶ Output Guard ──▶ Response
                  │                          │
                  ↓                          ↓
          - prompt injection            - PII detection (Presidio)
          - profanity detect            - NSFW classifier
          - jailbreak pattern           - toxicity score
          - topic gate                  - citation enforcement (RAG)
          - PII redact                  - secret leak detect
          - char/token limit            - format validator (JSON mode)
                                              │
                                              ↓
                                        Tool Call Guard
                                              │
                                              ↓
                                  - allowlist (§Security)
                                  - schema validation
                                  - HITL for destructive ops
                                  - rate limit per tool
```

### Data model

```python
class GuardrailPolicy(BaseModel):
    name: str
    input_filters: list[FilterConfig]
    output_filters: list[FilterConfig]
    tool_filters: list[FilterConfig]
    on_violation: Literal["block", "redact", "warn", "log_only"]
    notify_severity: Severity = Severity.WARN

class FilterConfig(BaseModel):
    type: str                          # "prompt_injection", "pii", "nsfw", "topic_gate"
    enabled: bool = True
    threshold: float | None = None     # ML-based filter
    allow_patterns: list[str] = []
    deny_patterns: list[str] = []
```

### Config YAML

```yaml
# data/configs/guardrails.yaml
policies:
  default:
    input_filters:
      - { type: prompt_injection, threshold: 0.7 }
      - { type: char_limit, max: 10000 }
    output_filters:
      - { type: pii, on_match: redact }
      - { type: secret_leak }
    tool_filters:
      - { type: allowlist, allowed: [search, calc, file_read] }
    on_violation: block
    notify_severity: WARN

  medical_agent:                       # stricter
    input_filters:
      - { type: prompt_injection, threshold: 0.5 }
      - { type: topic_gate, allowed_topics: [symptoms, prevention] }
    output_filters:
      - { type: pii, on_match: block }
      - { type: medical_disclaimer_required: true }
    on_violation: block

agent_bindings:
  agent_default: default
  agent_doc_dr: medical_agent
```

### Implementations
- **prompt_injection**: Rebuff / LakeraAI patterns / fine-tuned BERT classifier
- **PII**: Microsoft Presidio (open source) — regex + NER
- **NSFW/Toxic**: Perspective API / open source classifier
- **Secret leak**: regex + entropy-based (gitleaks patterns)
- **Topic gate**: zero-shot classifier (e.g., `facebook/bart-large-mnli`)

### CLI

```
gang guardrails list
gang guardrails test --policy default --input "ignore prev instructions..."
gang guardrails test --policy default --output "user's email is x@y.com..."
gang guardrails violations [--agent x] [--since 1d]    # ดู log
```

### Best practices
- **Layered, not single** — ไม่หวัง 1 filter ครอบทุก attack
- **Log all violations** even if allowed (`log_only` mode) — สำหรับ tuning threshold
- **A/B threshold** — ทดสอบ false positive vs false negative rate
- **Notify CRITICAL** — repeated violation จาก same source = potentially adversarial → emit event
- **Bypass for admin** — explicit override (audit log บันทึก)
- **Performance budget** — guard latency ≤ 100ms ต่อ call ไม่ให้ block UX

### แนะนำสำหรับโปรเจกต์นี้
Phase 6 (ก่อน UI public) — ตอนเตรียม "ทีม → product" — implement basic 3 layers (input/output/tool) + 2-3 filter types แรก (prompt_injection, PII, secret_leak) → ขยายตามเหตุการณ์จริงที่เจอ

---

## 🗂️ Schema Migration (รายละเอียด)

### ปัญหา
SQLite schema เปลี่ยนระหว่าง phases — เพิ่ม table, แก้ column type, rename — ถ้าไม่มี migration system:
- DB เก่า restore ไม่ได้ใน code ใหม่
- Backup กลับมาเปิดไม่ออก
- ไม่รู้ว่า schema version ตรงกับ code version ไหน

ต้องการ Alembic-like แต่ light — ไม่ over-engineer สำหรับ project ขนาดนี้

### หลักการ
- **Forward + backward migration** — `up()` + `down()` ทุกอัน
- **Versioned + linear** — เลข version monotonic (ไม่ใช้ hash chain ซับซ้อน)
- **Auto-detect drift** — startup ตรวจว่า DB schema ตรงกับ code expectation
- **Bundled with backup** — migration script aligned กับ `backup_manifest.json.schema_version`

### Data model

```python
class Migration(BaseModel):
    version: str                       # "0003"
    name: str                          # "add_profession_label_to_agent"
    up_sql: str
    down_sql: str
    created_at: datetime
    applied_at: datetime | None = None
```

### File structure

```
src/gangagent/migrations/
  __init__.py
  runner.py                  # apply/rollback migrations
  0001_initial.sql
  0002_add_memory_tables.sql
  0003_add_profession_label.sql
  ...
```

(ใช้ raw SQL ไฟล์ — Pydantic อ่าน metadata จาก comment header)

```sql
-- name: add_profession_label_to_agent
-- version: 0003

-- up
ALTER TABLE agents ADD COLUMN created_from_profession TEXT;

-- down
ALTER TABLE agents DROP COLUMN created_from_profession;
```

### CLI

```
gang db status                        # current schema version + pending migrations
gang db migrate                       # apply all pending up
gang db rollback [--to <version>]     # rollback
gang db migrate --dry-run             # preview SQL
gang db new <name>                    # scaffold migration file
```

### Best practices
- **Run migration in transaction** — atomic, partial failure = rollback
- **Test up + down** in CI — ทุก migration ต้อง round-trip ได้
- **Backup before migrate** — auto trigger `gang backup snapshot --tag pre-migration-<v>` (§Backup integration)
- **Schema version ใน manifest** — restore backup เก่า → detect schema_version → run missing migrations
- **No data migration in DDL files** — data transform เขียน Python migration แยก (อ่าน + แปลง + เขียน)
- **Lock during migrate** — กัน user สั่งงานระหว่าง migration

### แนะนำสำหรับโปรเจกต์นี้
Phase 1 — วาง foundation ตั้งแต่ก่อนเริ่มเก็บข้อมูลถาวร ทำง่ายๆ (linear version + raw SQL) ไม่ต้อง Alembic เต็มตัว ขยายภายหลังถ้าจำเป็น

---

## 🔮 Future Considerations (deferred)

Features ที่ออกแบบไว้ใน plan แต่ยังไม่ schedule — ตัดสินใจเพิ่มภายหลังเมื่อมีความต้องการชัด:

| Feature | กลุ่ม | ทำไมเลื่อน |
|---|---|---|
| **Hallucination / Grounding score** | Safety | RAG citation ครอบคลุมส่วนใหญ่แล้ว — explicit score detector ค่อยทำเมื่อใช้งานจริงเจอปัญหา |
| **Reasoning trace (CoT capture)** | Observability | thinking_mode capability พอใช้ — explicit trace store ทำเมื่อ debug multi-agent ยาก |
| **Conversation Replay (VCR)** | Dev tooling | vcr.py ใน stack แล้ว — formalize เป็น `gang replay <session>` หลัง Phase 5 |
| **A/B / Shadow Mode** | Quality | สำคัญตอนเปลี่ยน model จริง — Phase 7 หรือเมื่อ user base ใหญ่ |
| **Voice I/O (STT/TTS)** | UX | ขนาดงานใหญ่ ขึ้นกับ provider audio capability — รอ requirement ชัด |
| **File ingest UI (drag/drop)** | UX | RAG CLI ครอบคลุมแล้ว — UI ค่อยทำใน Phase 7 |
| **Session export (md/PDF)** | UX | ง่าย ทำตอน Phase 7 พร้อม UI |
| **Plugin SDK formal contract** | Community | pattern มี (providers/notifiers/professions) — formalize เมื่อมี 3rd party จริง |
| **Telemetry opt-in** | OSS | ต้องผ่าน privacy review — เก็บไว้ตอน open source |
| **Workspace / Multi-tenancy** | Product | ตอนเปลี่ยนจาก single-user → team |
| **Auth + RBAC** | Product | พร้อม Workspace |
| **Per-agent quota / budget cap** | Cost | budget cap global มีอยู่แล้ว — per-agent ตอนหลายคนใช้ |

→ เก็บไว้ใน plan เป็น "พิจารณา" — ไม่ใช่ "จะทำ" — กัน scope creep แต่ไม่ลืม

---

## 🔗 Vendor Lock-in ของ Feature เฉพาะ (รายละเอียด)

### ปัญหา
Capability Flag ช่วยกับ feature ที่ **หลายค่ายมี** (vision, tool use) — แต่ feature **ค่ายเดียว** จะติดล็อก:
- Claude Artifacts, Computer Use
- OpenAI Assistants API, Realtime API
- Gemini long context 2M tokens

ถ้า business logic ใช้ feature เหล่านี้ตรงๆ → ย้ายค่ายต้อง rewrite

### Best Practices

**A. Abstract เป็น "Concept" ไม่ใช่ "Feature"**

❌ `agent.use_claude_artifact(code)` — ผูกชื่อค่าย
✅ `agent.preview_code(code)` — concept กลาง (ข้างใต้: Claude → artifact, อื่นๆ → iframe+execute)

**B. Tiered Capability**

| Tier | คำอธิบาย | ตัวอย่าง |
|------|----------|---------|
| **Core** | ทุกค่ายมี | text, streaming |
| **Common** | ค่ายใหญ่ส่วนมากมี | tool_use, vision, JSON mode |
| **Exclusive** | เฉพาะค่าย | Claude artifacts, OpenAI Realtime |

- Core/Common → ใช้อิสระ
- Exclusive → declare dependency ชัดเจน + มี fallback

**C. Feature Flag + Fallback Chain**

```yaml
preview_code:
  primary: claude.artifacts
  fallback:
    - sandbox.docker_exec
    - text.code_block
```

**D. แยก code path vendor-specific เป็น optional module**

```
agents/
  core/                      # ทุกค่ายใช้ได้
  extensions/
    claude_artifacts/        # โหลดเมื่อใช้ Claude
    openai_realtime/         # โหลดเมื่อใช้ OpenAI
```

**E. Strangler Fig pattern** — เริ่ม vendor-specific ได้ถ้าเร่งด่วน แต่ wrap ใน abstraction layer ตั้งแต่ day 1 → swap ได้เมื่อค่ายอื่นมี feature เทียบเท่า

### แนะนำสำหรับโปรเจกต์นี้
รับว่ายังไงก็ lock-in บ้าง — เลือกค่ายหลัก (Claude) ใช้ exclusive feature เต็มที่ **แต่ห่อด้วย abstraction layer** (`preview_code()` ไม่ใช่ `claude.artifact()`)

---

## 🎭 Design Patterns สำหรับ Capability Flag (รายละเอียด)

### ปัญหา
ถ้าออกแบบไม่ดี โค้ดจะเต็มไปด้วย if-else:

```python
def chat(agent, message):
    if agent.provider == "claude":
        if agent.has_capability("vision"): ...
    elif agent.provider == "gpt": ...
    elif agent.provider == "gemini": ...
```

เพิ่ม provider ใหม่ = แก้ทุก function. ทดสอบยาก. Bug เยอะ.

### Patterns ที่ใช้

**A. Strategy Pattern** — ซ่อน provider ไว้หลัง interface

```python
class AgentProvider(Protocol):
    def chat(self, messages: list[Message], tools: list[Tool] = None) -> Response: ...
    def supports(self, capability: Capability) -> bool: ...

class ClaudeProvider:
    def chat(self, messages, tools=None):
        # แปลง messages → Anthropic format → เรียก SDK → แปลงกลับ
        ...

# Business logic ไม่รู้จัก provider เลย
def chat(agent, message):
    return agent.provider.chat([Message(role="user", content=message)])
```

**B. Adapter Pattern** — แปลง format ระหว่างค่าย

```python
class ClaudeAdapter:
    def to_provider(self, message: Message) -> dict: ...
    def from_provider(self, response: dict) -> Response: ...
```

**C. Capability-based Dispatch** (แทน provider-based)

❌ `if provider == "claude":`
✅ `if agent.provider.supports(Capability.VISION):`

**D. Tool Schema Adapter** — เขียน Tool ครั้งเดียวในรูปกลาง

```python
class ToolAdapter:
    def to_anthropic(tool: Tool) -> dict: ...
    def to_openai(tool: Tool) -> dict: ...
    def to_gemini(tool: Tool) -> dict: ...
```

**E. Registry + Factory** — เพิ่ม provider = สร้างไฟล์ใหม่ + decorator, ไม่ต้องแก้โค้ดอื่น

```python
@register_provider("claude")
class ClaudeProvider: ...
```

**F. Capability Composition** (แทน inheritance ลึก)

```python
class ClaudeProvider:
    capabilities = [TextGen(), Streaming(), Vision(), ToolUse(), Thinking()]
```

**G. Contract Testing** — test ที่ระดับ interface ครั้งเดียว → รันกับทุก implementation อัตโนมัติ

### โครงสร้างไฟล์ที่แนะนำ

```
providers/
  base.py                  # IAgentProvider interface
  registry.py              # auto-discovery
  adapters/
    claude_adapter.py
    openai_adapter.py
    gemini_adapter.py
  implementations/
    claude.py              # @register_provider("claude")
    openai.py
    gemini.py
capabilities/
  base.py                  # Capability enum + interface
  vision.py
  tool_use.py
  thinking.py
tools/
  schema.py                # format กลาง
  adapters/                # แปลง schema ระหว่างค่าย
```

### แนะนำสำหรับโปรเจกต์นี้
**Strategy (provider) + Adapter (format) + Registry (plug-in) + Capability composition** — ครบทุกอย่างที่ต้องการ ไม่ over-engineer

---

## 🎁 Quick Wins (ทำได้เร็ว เห็นผลไว)

ถ้าอยากเห็น demo เร็วๆ ภายใน 1 สัปดาห์ ให้ตัดเหลือ:
1. Provider interface + Claude provider เท่านั้น
2. Agent class แบบง่าย (name, personality, role)
3. Personality engine แบบ hash-only (ยังไม่ต้อง LLM ตีความ)
4. CLI สั่ง: `spawn`, `name`, `teach`, `ask`

แล้วค่อยขยายตามเฟส

---

## ✅ การตัดสินใจหลัก (Locked Decisions)

| # | หัวข้อ | เลือก | เหตุผลหลัก |
|---|-------|-------|-----------|
| 1 | ภาษา | **Python 3.12+** | AI ecosystem ดีสุด, SDK ทางการครบทุกค่าย, feature มา Python ก่อน |
| 2 | UI | **CLI → REST API → Web** | CLI build เร็วสุด, dogfood ทันที, บังคับ design API ดี |
| 3 | Provider แรก | **Claude (Anthropic)** | Tool spec ดีสุด, prompt caching, long context, SDK เสถียร |
| 4 | License | **Private → Open Source (Apache 2.0)** | ทดลองอิสระก่อน, เตรียม open ตั้งแต่ day 1 |
| 5 | เป้าหมาย | **คนเดียว → ทีม → Product** | Build for one, design for many |

### 1. ภาษา: Python 3.12+

**Stack แนะนำ**:
```
Python 3.12+
├── uv             # package manager (เร็วกว่า pip 10-100x)
├── ruff           # linter + formatter
├── mypy / pyright # type checking
├── pydantic v2    # data validation + config
├── pytest         # testing
└── pre-commit     # git hooks
```

### 2. UI: CLI → REST API → Web

**Layered Architecture**:
```
┌─────────────────────────────────────┐
│  CLI (Typer) / Web (FastAPI)        │  ← presentation (เปลี่ยนได้)
├─────────────────────────────────────┤
│  Application Service                 │  ← business logic
├─────────────────────────────────────┤
│  Domain (Agent, Provider, ...)       │  ← core models
└─────────────────────────────────────┘
```

**Roadmap UI**:

| Sprint | UI | ตัวอย่าง |
|--------|-----|---------|
| 1 | CLI | `gang spawn`, `gang name <id> "มานี"`, `gang teach <id> ...`, `gang ask <id> "..."` |
| 2 | CLI + REPL | `gang chat <id>` (interactive) |
| 3 | REST API | `POST /agents`, `POST /agents/:id/chat` (FastAPI) |
| 4+ | Web UI | Next.js dashboard, agent card, conversation view |

**เครื่องมือ**: `Typer` + `Rich` (CLI), `FastAPI` (API), Next.js หรือ Streamlit (Web)

### 3. Provider แรก: Claude

**ลำดับการเพิ่ม provider**:

| ลำดับ | Provider | เหตุผล |
|------|----------|--------|
| 1 | **Claude** | Tool spec ดีสุด, caching, SDK เสถียร — ใช้เป็น reference implementation |
| 2 | **OpenAI** | ตลาดใหญ่สุด, feature ต่าง — ทดสอบ vendor lock-in pattern |
| 3 | **Gemini** | Long context 2M, multimodal — ทดสอบ degradation policy |
| 4 | **Ollama / local** | on-prem สำหรับ sensitive data |
| 5+ | Mistral, Cohere, Together, OpenRouter | community-driven |

**กลยุทธ์**: Implement Claude ครบทุก capability ก่อน (text, stream, tool, vision, thinking, caching) → เพิ่ม OpenAI เป็นที่ 2 ทันที เพื่อพิสูจน์ abstraction layer ใช้งานได้จริง → Contract test ครอบทั้ง 2 provider

### 4. License: Private → Open Source (Apache 2.0)

**ตอน Private** — เขียนโค้ดเหมือนจะ open ตลอด:
- ✅ ไม่ hard-code API key / personal info
- ✅ ใช้ `.env` + `.env.example`
- ✅ ไม่ใส่ company-specific logic ใน core
- ✅ Commit message clean
- ✅ License header เตรียมไว้

**Open Source เมื่อ**:
- Core API stable
- Test coverage > 70%
- มี docs พอ
- ตัดสินใจ business model ได้

**License เลือกใช้**: **Apache 2.0** (เหมือน MIT + patent protection — เหมาะกับ AI infra)
- ทางเลือก: AGPL v3 ถ้ามี commercial plan, BSL ถ้าอยาก convert ภายหลัง

### 5. เป้าหมาย: คนเดียว → ทีม → Product

| Stage | ระยะเวลา | Signal ที่บอกให้ขยับ |
|-------|----------|---------------------|
| **1. คนเดียว** | 3-6 เดือน | ใช้เองทุกวัน ≥ 1 เดือน |
| **2. ทีมเล็ก (5-10 คน)** | 6-12 เดือน | มีคนถาม "จ่ายเงินได้ไหม?" / มีคน fork ไปใช้ |
| **3. Product** | 12+ เดือน | — |

**Build for one, design for many**:

| Build for one (เร็ว) | Design for many (เตรียมโครง) |
|---------------------|------------------------------|
| Hard-code path/config | Data model มี `user_id` field |
| ไม่มี user system | Memory scope isolation |
| SQLite local | API stateless |
| localhost ทุกอย่าง | Config อ่านจาก env |
| — | Structured logging (JSON) |

→ เมื่อพร้อมขยับ stage: เพิ่ม auth + Postgres + deploy = เปิดได้ ไม่ต้อง rewrite
