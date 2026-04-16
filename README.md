# 獸醫腹腔超聲波報告自動化

## 概述

小波嘅獸醫腹腔超聲波 HTML 表單自動化流程：表單 submit → Cloudflare Worker → Queue → Hermes Cron → AI 生成報告 → Email 回傳。

## 架構

```
小波表單 (HTML)
    ↓ submit
Cloudflare Worker (/api/submit)
    ↓ write
Cloudflare Queue (FIFO)
    ↑
Hermes Cron (每5分鐘 poll)
    ↓
MiniMax-M2.7 生成報告
    ↓
Email → 小波 (mdip22351@gmail.com)
```

## 目錄結構

```
abdominal-ultrasound/
├── webapp/          # 前端表單 (static HTML)
├── worker/          # Cloudflare Worker (API + Queue writer)
├── hermes/          # Hermes Agent 組件
│   ├── cron/        # Cron Job 脚本
│   └── skills/      # Skill 定義
└── docs/            # 文件
    └── wiki/        # Wiki (架構、Prompt 設計、部署)
```

## 部署順序

1. [ ] 建立 GitHub Repo
2. [ ] 上架 Worker 代碼
3. [ ] 配置 Cloudflare (Workers, Queue)
4. [ ] 部署 Hermes Cron Job
5. [ ] 測試 end-to-end

## 環境變量

| 變量 | 描述 |
|------|------|
| `GITHUB_TOKEN` | GitHub PAT |
| `CF_ACCOUNT_ID` | Cloudflare Account ID |
| `CF_API_TOKEN` | Cloudflare API Token |
| `MQ_API_TOKEN` | Worker API Gateway Bearer Token |
| `WEBHOOK_URL` | (可選) 報告完成後的 webhook |

## License

Private - 小波獸醫自動化項目
