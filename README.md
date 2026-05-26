# gangAgent

> Multi-provider AI agent orchestration — ระบบควบคุม AI agent หลายค่าย (Claude / GPT / Gemini / ...) แบบ dynamic ที่ผู้ใช้สร้าง ตั้งชื่อ สอน และมอบหมายงานให้ agent ที่มีบุคลิกเฉพาะตัวได้

**Status**: 🚧 Phase 0 — Foundation scaffold เสร็จ (Python project, `IAgentProvider`, Claude provider, CLI ทดสอบ chat)

📖 รายละเอียดการออกแบบทั้งหมดอยู่ใน [`plan.md`](./plan.md) — เป็น source of truth

---

## วิสัยทัศน์

1. **กำเนิด agent ได้** — รองรับหลายค่าย และเพิ่มค่ายใหม่แบบ dynamic
2. **ตั้งชื่อให้ agent ได้** — ชื่อกำหนดนิสัย (hash seed + LLM interpretation)
3. **สอนและกำหนดบทบาท** ให้ agent ได้
4. **agent แสดงความคิดเห็นได้** แต่มีความถนัดตามที่กำหนด

## Tech stack

| ส่วน | เลือกใช้ |
|------|---------|
| ภาษา | Python 3.12+ |
| Package manager | `uv` |
| Validation / config | Pydantic v2, pydantic-settings |
| CLI | Typer + Rich |
| Testing / Lint / Types | pytest, ruff, mypy (strict) |
| Provider แรก | Anthropic Claude (SDK ทางการ) |

## เริ่มต้นใช้งาน

```bash
# 1) ติดตั้ง deps
uv sync

# 2) ตั้งค่า API key
cp .env.example .env
# แล้วใส่ ANTHROPIC_API_KEY ใน .env

# 3) ทดสอบ
uv run gang providers           # ดู provider ที่ลงทะเบียน
uv run gang ask "สวัสดี"        # one-shot chat ผ่าน Claude
```

## โครงสถาปัตยกรรม

```
cli/  ──▶  ProviderRegistry  ──▶  IAgentProvider (Protocol)
                                        │
                          @register_provider("claude")
                              implementations/claude.py
```

หลักการที่ยึด:

- **Capability Flag** — branch ตาม `provider.supports(Capability.X)` ไม่ใช่ตามชื่อค่าย
- **Plug-in pattern** — เพิ่มค่ายใหม่ = สร้างไฟล์ใหม่ใน `providers/implementations/` + `@register_provider("...")` ไม่ต้องแก้โค้ดอื่น
- **Provider-neutral domain** — `Message`/`Response`/`Role` ไม่ผูกกับ SDK ใด ค่ายต่างๆ แปลงเข้า/ออกเอง
- **Patterns**: Strategy (provider) + Adapter (format) + Registry (plug-in) + Capability composition

## Roadmap

| Phase | งาน | สถานะ |
|-------|-----|------|
| 0 | Project scaffold + Claude provider + CLI | ✅ |
| 1 | OpenAI/Gemini + CapabilityRouter + Tool schema adapter | ⏳ |
| 2 | Agent lifecycle + Personality Engine (ชื่อ → นิสัย) | ⏳ |
| 3 | Skill/Role + Memory (short/long/structured) + **Backup (restic)** | ⏳ |
| 4 | Inter-agent comm + Mediator system agent | ⏳ |
| 5 | Observability + Eval + Watcher system agent | ⏳ |
| 6 | UI polish (REST → Web) | ⏳ |

รายละเอียดแต่ละเฟส + risk/security/privacy → ดู `plan.md`

## คำสั่งสำหรับ dev

```bash
uv run pytest -q              # all tests
uv run pytest -k registry     # subset
uv run ruff check .           # lint
uv run ruff format .          # format
uv run mypy src               # type-check (strict)
```

## License

ตอนนี้ **private / unlicensed** — เตรียม open source เป็น **Apache 2.0** เมื่อ core API นิ่ง (ดูเหตุผลใน `plan.md` §License)
