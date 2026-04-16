# 架構規劃（Architecture）

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cloudflare                                │
│                                                                  │
│   ┌──────────┐      ┌─────────────────┐    ┌───────────────┐   │
│   │   Port   │      │  Cloudflare      │    │  Cloudflare   │   │
│   │   80     │      │  Worker          │    │  Queue         │   │
│   │  HTML    │─────▶│  /api/submit     │───▶│  (FIFO)        │   │
│   │ (小波 form)     │                 │    │                │   │
│   └──────────┘      └─────────────────┘    └───────┬───────┘   │
│          ▲                   ▲                      │           │
│          │             wrangler deploy         built-in auth     │
│   (static files)                                        │           │
└─────────────────────────────────────────────────────────│──────────┘
                                                          │
                                               cron (每5分鐘 poll)
                                                          │
                                                          ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Hermes Agent Side                            │
│                                                                   │
│   hermes cron                                                   │
│       │                                                         │
│       ▼                                                         │
│   GET /api/poll (Bearer token) ──▶ Worker /api/poll             │
│       │                              │                          │
│       │                         reads from Queue                │
│       ▼                              │                          │
│   拎第一個 job (JSON)                 │                          │
│       │                              │                          │
│       ▼                              │                          │
│   組成 system prompt ──────────────────────────────────────────▶│
│   (獸醫超聲波 template)                                          │
│       │                                                         │
│       ▼                                                         │
│   問 default agent (MiniMax-M2.7)                                 │
│       │                                                         │
│       ▼                                                         │
│   生成 60-120字中文描述 + 英文翻譯                                │
│       │                                                         │
│       ▼                                                         │
│   Email ──▶ 小波 (mdip22351@gmail.com)                           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 資料夾結構

```
abdominal-ultrasound/
├── .gitignore
├── README.md
├── SKILL.md                          # 專案總 skill（skill tool 自動讀取）
├── wiki/
│   ├── index.md                      # Wiki 首頁
│   └── architecture.md               # 本頁 — 架構說明
├── webapp/                          # 前端 — 靜態 HTML 表單
│   ├── index.html                   # 表單主頁（TODO: 替換小波原始 HTML）
│   ├── css/style.css                # 樣式
│   └── js/main.js                   # submit 邏輯 → POST /api/submit
├── worker/                          # Cloudflare Worker
│   ├── wrangler.toml                # 部署配置 + Queue binding
│   ├── package.json
│   ├── tsconfig.json
│   └── src/index.ts                 # Worker 主體
│                                     #   GET  /api/poll  → Hermes cron 調用
│                                     #   POST /api/submit → 小波表單調用
└── hermes/                          # Hermes Agent 組件
    ├── cron/abdominal_us_cron.py    # Cron job 脚本（每5分鐘）
    └── skills/abdominal-ultrasound/ # Hermes skill
        └── SKILL.md
```

---

## 組件說明

### 1. GitHub (Public Repo)
- 版本控制，public project
- `wrangler.toml` 部署配置
- Frontend HTML + Worker code

### 2. Cloudflare Worker (`/api/submit`)
- **POST /api/submit** — 接收小波表單 POST，驗證 payload，寫入 Cloudflare Queue
  - 必填欄位：`petName`, `species`, `ownerName`, `vetName`, `observations`
  - 可選欄位：`breed`, `organs[]`, `submitTime`
- **GET /api/poll** — Hermes cron 調用，internally reads from Queue，返回 list of jobs
  - 受 `MQ_API_TOKEN` (Bearer) 保護
- CORS headers，Origin 限制
- 唔直接 expose Queue — 所有 access 經 Worker 過濾

### 3. Cloudflare Queue
- 輕量級 FIFO 佇列
- 佇列名：`abdominal-us-report-queue`
- **Worker binding**：`ABDOMINAL_US_QUEUE`（喺 `wrangler.toml` declare）

### 4. Hermes Cron Job
- Schedule：`*/5 * * * *`（每5分鐘）
- 流程：
  1. `GET /api/poll`（Bearer `MQ_API_TOKEN`）
  2. 拎第一個 job JSON
  3. 組成 system prompt
  4. 問 default agent (MiniMax-M2.7)
  5. 提取 description，組裝 email
  6. `gws gmail` 發送至小波

### 5. Default Agent Prompt Template

```
你係一位專業獸醫超聲波報告AI助手，專門將獸醫嘅觀察笔记轉化為標準化超聲波描述。

任務：根據以下觀察笔记，生成60-120字嘅中文超聲波描述，並附上英文翻譯。

【患者資料】
- 寵物名稱: {petName}
- 品種: {species} {breed}
- 主人: {ownerName}
- 獸醫: {vetName}

【超聲波觀察笔记】
{observations}

【輸出格式】（直接輸出，唔好加標題）
中文描述（60-120字）:
[中文描述]

英文翻譯:
[English translation]
```

### 6. Email
- **發送方**：Hermes gws Gmail (`westhong@gmail.com`)
- **收件方**：小波 (`mdip22351@gmail.com`)
- **Subject**：`腹超報告已生成 - {petName}`
- **Body**：格式化文字（中文描述 + 英文翻譯 + 患者資料）

---

## 安全性（Security）

### Token 管理

| Token | 存放位置 | 用途 | 狀態 |
|-------|---------|------|------|
| `GITHUB_TOKEN` | `~/.hermes/.env` | Git push | ✅ 已設定 |
| `CF_API_TOKEN` | `~/.hermes/.env` | Cloudflare Workers/Pages deploy | ✅ 已設定 |
| `CF_ACCOUNT_ID` | `~/.hermes/.env` | Cloudflare API | ✅ 已設定 (`7cb4af0fb54de98010374a8596b96bcd`) |
| `MQ_API_TOKEN` | `~/.hermes/.env` + `wrangler secret` | Worker API 認證 | ⏳ 待建立 |

**全部唔 commit**，`.gitignore` 已排除。

### Cloudflare API Token 權限（已設定）

Token name: `hermes-agent-token`

| Scope | Permission | Level |
|-------|-----------|-------|
| Account | Workers Scripts | **Edit** |
| Account | Cloudflare Pages | **Edit** |
| Account | Account Settings | Read |

> ⚠️ `MQ_API_TOKEN` 尚未建立 — 部署 Worker 時用 `wrangler secret put MQ_API_TOKEN` 設定。

### Worker API Gateway 設計

```
Hermes (cron)
    │
    │  GET /api/poll  (Authorization: Bearer MQ_API_TOKEN)
    ▼
Cloudflare Worker
    │  internally reads from Queue
    ▼
Cloudflare Queue (完全唔暴露俾 internet)
```

- Queue唔 expose 俾 internet
- Hermes 帶 Bearer token call HTTP endpoint
- Token 存喺 `wrangler secret put MQ_API_TOKEN`
- 將來加 webhook push 都係喺 Worker 層搞

### CORS
- Worker 只允許已授權的 origin（`ALLOWED_ORIGIN` env var）
- 生産環境要 set `ALLOWED_ORIGIN` 為 actual domain

---

## 環境變量

### Hermes 端（`~/.hermes/.env`）
```
GITHUB_TOKEN=github_pat_***
MQ_API_TOKEN=***
CF_ACCOUNT_ID=***
WORKER_POLL_URL=https://abdominal-us-worker.xxx.workers.dev/api/poll
REPORT_EMAIL_TO=mdip22351@gmail.com
REPORT_EMAIL_FROM=westhong@gmail.com
```

### Cloudflare Worker 端（`wrangler secret`）
```
wrangler secret put MQ_API_TOKEN
```

---

## 待決定

- [ ] Email format（純文字？JSON附件？格式化HTML？）
- [ ] 小波係咪唯一獸醫用戶？否則 email 目標係動態？
- [ ] Webhook push vs. cron polling（目前用 polling）
- [ ] 是否加 organ checkbox 清單（表單增強）

---

## 性價比（Cost Estimate）

| 服務 | 免費額度 | 實際用量 |
|------|---------|---------|
| Cloudflare Workers | 每天 100,000 請求 | ~288/天（每5分鐘 poll × 24h） |
| Cloudflare Queue | 每月 100 萬操作 | ~8,640/day |
| Hermes cron | 免費（本地） | — |
| Gmail | 免費 | — |

**基本上零成本。**

---

## 部署順序

1. [x] 建立資料夾結構
2. [ ] 建立 GitHub Repo (`westhong/abdominal-ultrasound`)
3. [ ] 上架代碼到 GitHub
4. [ ] 建立 Cloudflare Queue (`abdominal-us-report-queue`)
5. [ ] 部署 Cloudflare Worker + 配置 `MQ_API_TOKEN`
6. [x] 設定環境變量 (`~/.hermes/.env`) — GITHUB_TOKEN ✅ / CF_API_TOKEN ✅ / CF_ACCOUNT_ID ✅
7. [ ] 部署 Hermes Cron Job
8. [ ] End-to-end 測試
