# 獸醫腹腔超聲波報告自動化

## 概述

小波嘅獸醫腹腔超聲波 HTML 表單自動化流程：表單 submit → Cloudflare Worker → Queue → Hermes Cron → AI 生成報告 → Email 回傳。

## 架構

```
小波表單 (HTML submit)
    ↓ POST /api/submit
Cloudflare Worker
    ↓ v2: write to Queue
Cloudflare Queue (abdominal-us-report-queue)
    ↑
Hermes Cron (每5分鐘, GET /api/poll)
    ↓
MiniMax-M2.7 生成描述
    ↓
Email → 小波 (mdip22351@gmail.com)
```

## 版本狀態

| 版本 | 狀態 | 說明 |
|------|------|------|
| **v2.0** | ✅ 已部署 | `/api/submit` 寫入 Queue，`/api/poll` stub 返回 `{"jobs":[]}` |
| v2.1 | ⏳ 規劃中 | Hermes cron 串接 `/api/poll` + Queue consumption |

## 目錄結構

```
abdominal-ultrasound/
├── .gitignore
├── README.md
├── SKILL.md
├── wiki/
│   ├── index.md
│   └── architecture.md
├── webapp/              # 前端 — 靜態 HTML 表單（小波原始表單）
│   ├── index.html       # 已修改：runAiFill() → submitToWorker()
│   ├── css/style.css
│   └── js/main.js
├── worker/              # Cloudflare Worker
│   ├── wrangler.toml
│   ├── package.json
│   ├── tsconfig.json
│   └── src/index.ts     # v1: stub endpoints；v2: + Queue
└── hermes/              # Hermes Agent 組件
    ├── cron/abdominal_us_cron.py
    └── skills/abdominal-ultrasound/
```

## 環境變量

### Worker (.dev.vars 或 wrangler secret)
```
MQ_API_TOKEN=***  (v2 用於 /api/poll 認證)
```

### Hermes 端 (~/.hermes/.env)
```
CF_API_TOKEN=***
CF_ACCOUNT_ID=***
GITHUB_TOKEN=***
```

## Worker Endpoints (v2.0)

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/submit` | 接收表單，寫入 `abdominal-us-report-queue`，返回 202 |
| GET | `/api/poll` | 返回 `{"jobs":[]}`（v2.1: Hermes cron 串接 Queue consumption） |

**Worker URL:** `https://abdominal-us-worker.west-wong.workers.dev`

## 部署

```bash
cd worker
npm install
npx wrangler deploy
```

## 部署順序

1. [x] 建立資料夾結構
2. [x] 建立 GitHub Repo + commit 代碼
3. [x] 建立 Cloudflare Queue (`abdominal-us-report-queue`)
4. [x] 部署 Cloudflare Worker + 配置 `MQ_API_TOKEN`
5. [x] 設定環境變量 (`~/.hermes/.env`)
6. [ ] 部署 Hermes Cron Job
7. [ ] End-to-end 測試

## License

Private — 小波獸醫自動化項目
