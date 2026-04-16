---
name: abdominal-ultrasound
description: 獸醫腹腔超聲波報告自動化 — 小波獸醫專用
category: personal-assistant
---

# 腹超（Abdominal Ultrasound）專案

## 起源

小波整咗一份獸醫腹腔超聲波 HTML 表單，用戶輸入簡短觀察笔记後可以直接用 Claude 生成完整報告。
West 想研究自動化流程：表單 submit → Cloudflare Worker 排隊 → Hermes cron 消費佇列 → default agent 生成描述 → email 回傳俾小波。

## 目前狀態

規劃階段，已建立 folder structure，wiki 已完成。

## 重要約定

- 使用台灣調的繁體中文
- 預設語言：Taiwan Mandarin
- 對答風格：gentle, concise

## 技術約定

- Worker: Cloudflare Workers (TypeScript)
- Queue: Cloudflare Queue (FIFO)
- Cron: Hermes cron `*/5 * * * *`
- Agent: MiniMax-M2.7 (default)
- Email: gws Gmail

## Wiki

架構文件：`wiki/architecture.md`
