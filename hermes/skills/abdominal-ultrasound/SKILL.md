---
name: abdominal-ultrasound
description: 獸醫腹腔超聲波報告自動化 — 小波專用
category: personal-assistant
---

# 腹超（Abdominal Ultrasound）自動化技能

## 概述

小波嘅獸醫腹腔超聲波報告自動化流程。

## 架構

```
小波表單 (HTML submit)
    ↓ POST
Cloudflare Worker (/api/submit)
    ↓ write to Queue
Cloudflare Queue (abdominal-us-report-queue)
    ↑
Hermes Cron (每5分鐘, 檢查 /api/poll)
    ↓
MiniMax-M2.7 生成描述
    ↓
Email → 小波 (mdip22351@gmail.com)
```

## 環境變量

| 變量 | 說明 |
|------|------|
| `MQ_API_TOKEN` | Worker API Gateway Bearer Token |
| `CF_ACCOUNT_ID` | Cloudflare Account ID |
| `WORKER_POLL_URL` | Worker poll endpoint URL |
| `REPORT_EMAIL_TO` | 報告寄至 (default: mdip22351@gmail.com) |

## 檔案位置

| 檔案 | 路徑 |
|------|------|
| Webapp (HTML 表單) | `webapp/index.html` |
| Worker (Cloudflare) | `worker/src/index.ts` |
| Cron Job | `hermes/cron/abdominal_us_cron.py` |
| 架構文件 | `docs/wiki/architecture.md` |

## 部署順序

1. 建立 GitHub Repo (`westhong/abdominal-ultrasound`)
2. 部署 Cloudflare Worker + 建立 Queue
3. 配置 Worker API Token (`wrangler secret put MQ_API_TOKEN`)
4. 設定環境變量 (`~/.hermes/.env`)
5. 部署 Hermes Cron Job (`hermes cron create ...`)
6. End-to-end 測試

## Prompt Template (系統提示)

Default agent (MiniMax-M2.7) 收到以下資訊：
- 患者資料 (petName, species, breed, ownerName, vetName)
- 獸醫觀察笔记 (observations)
- 要求生成 60-120字中文描述 + 英文翻譯

## 語言約定

- 使用台灣調繁體中文
- 回應風格：gentle, concise
