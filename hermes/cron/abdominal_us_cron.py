#!/usr/bin/env python3
"""
abdominal_us_cron.py
Hermes Cron Job — 每5分鐘檢查 Cloudflare Queue，生成報告，Email 俾小波。

Environment variables (from ~/.hermes/.env):
  MQ_API_TOKEN      — Worker /api/poll bearer token
  CF_ACCOUNT_ID     — Cloudflare Account ID
  REPORT_EMAIL_TO   — 電郵目標 (default: mdip22351@gmail.com)
  REPORT_EMAIL_FROM — 發件人 (default: westhong@gmail.com)
"""

import os
import sys
import json
import logging
from datetime import datetime

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [abdominal_us_cron] %(levelname)s: %(message)s",
)
log = logging.getLogger("abdominal_us_cron")

# ── Env ───────────────────────────────────────────────────────────────────────
MQ_API_TOKEN     = os.getenv("MQ_API_TOKEN", "")
CF_ACCOUNT_ID    = os.getenv("CF_ACCOUNT_ID", "")
REPORT_EMAIL_TO  = os.getenv("REPORT_EMAIL_TO", "mdip22351@gmail.com")
REPORT_EMAIL_FROM = os.getenv("REPORT_EMAIL_FROM", "westhong@gmail.com")
WORKER_POLL_URL = os.getenv("WORKER_POLL_URL", "")  # e.g. https://abdominal-us-worker.xxx.workers.dev/api/poll

# ── Payload 模板 (system prompt) ─────────────────────────────────────────────
# 這段會傳俾 default agent (MiniMax-M2.7) 生成描述
SYSTEM_PROMPT_TEMPLATE = """你係一位專業獸醫超聲波報告AI助手，專門將獸醫嘅觀察笔记轉化為標準化超聲波描述。

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
[中文超聲波描述]

英文翻譯:
[English translation]

請确保描述：
- 專業、客觀
- 使用標準獸醫超聲波術語
- 描述各器官位置、大小、質地、異常發現（如有）
"""

EMAIL_BODY_TEMPLATE = """腹超報告已生成

寵物名稱: {petName}
品種: {species} {breed}
主人: {ownerName}
獸醫: {vetName}
提交時間: {submitTime}

==============================
中文描述（60-120字）:
{description_cn}

英文翻譯:
{description_en}
==============================

此報告由 AI 自動生成，如有疑問請聯繫獸醫。

--
Hermes Agent 自動化系統
"""


# ── Helpers ───────────────────────────────────────────────────────────────────
def get_bearer_headers():
    if not MQ_API_TOKEN:
        log.warning("MQ_API_TOKEN 未設定，跳過認證 headers")
    return {
        "Authorization": f"Bearer {MQ_API_TOKEN}",
        "Content-Type": "application/json",
    }


def poll_queue() -> list[dict]:
    """從 Worker API poll 消息，返回 list of queued jobs."""
    if not WORKER_POLL_URL:
        log.error("WORKER_POLL_URL 未設定，請設定 Worker API endpoint")
        return []

    import urllib.request

    req = urllib.request.Request(
        WORKER_POLL_URL,
        headers=get_bearer_headers(),
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            log.info(f"Poll 成功: {data}")
            return data.get("jobs", [])
    except urllib.error.HTTPError as e:
        log.error(f"HTTPError {e.code}: {e.reason}")
        return []
    except Exception as e:
        log.error(f"Poll 失敗: {e}")
        return []


def send_email(to: str, subject: str, body: str):
    """透過 gws gmail 發送郵件。"""
    import subprocess

    # 將郵件內容寫入 temp JSON，用 gws 發送
    # 實際實現取決於 gws gmail CLI 接口
    cmd = [
        "gws", "gmail", "users", "messages", "send",
        "--to", to,
        "--subject", subject,
        "--body", body,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        log.error(f"Email 發送失敗: {result.stderr}")
    else:
        log.info(f"Email 已發送俾 {to}")


def generate_report(job: dict) -> tuple[str, str]:
    """
    調用 default agent 生成報告描述。

    呢度係cron job，直接print俾Hermes，
    實際係Hermes問MiniMax-M2.7。

    返回 (description_cn, description_en)
    """
    # 組合 system prompt
    pet_name   = job.get("petName", "?")
    species    = job.get("species", "?")
    breed      = job.get("breed", "")
    owner      = job.get("ownerName", "?")
    vet        = job.get("vetName", "?")
    obs        = job.get("observations", "")
    submit_time = job.get("submitTime", datetime.now().isoformat())

    prompt = SYSTEM_PROMPT_TEMPLATE.format(
        petName=pet_name,
        species=species,
        breed=breed,
        ownerName=owner,
        vetName=vet,
        observations=obs,
    )

    # TODO: 實際調用 MiniMax-M2.7 的地方
    # 係 Hermes 環境入面，呢個 script 會俾 Hermes 解釋，
    # 佢會拎 description 嚟組裝 email。
    #
    # 暫時架構：呢個 script 輸出 prompt，等 Hermes 問 agent，
    # 然後 Hermes 用 gws gmail 發送。

    print(f"[SYSTEM_PROMPT_FOR_AGENT]\n{prompt}\n[END_SYSTEM_PROMPT_FOR_AGENT]")
    return "", ""


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    log.info("=== 開始 Abdominal US Cron Job ===")

    jobs = poll_queue()
    if not jobs:
        log.info("Queue 係空的，沒有待處理任務")
        return

    log.info(f"發現 {len(jobs)} 個任務")

    for job in jobs:
        pet_name = job.get("petName", "?")
        submit_time = job.get("submitTime", "")

        log.info(f"處理任務: {pet_name} @ {submit_time}")

        # Step 1: Generate report via agent
        description_cn, description_en = generate_report(job)

        if not description_cn:
            log.warning(f"Job {pet_name} 未生成 description，跳過email")
            continue

        # Step 2: Send email
        subject = f"腹超報告已生成 - {pet_name}"
        body = EMAIL_BODY_TEMPLATE.format(
            petName=pet_name,
            species=job.get("species", "?"),
            breed=job.get("breed", ""),
            ownerName=job.get("ownerName", "?"),
            vetName=job.get("vetName", "?"),
            submitTime=submit_time,
            description_cn=description_cn,
            description_en=description_en,
        )

        send_email(REPORT_EMAIL_TO, subject, body)
        log.info(f"任務完成: {pet_name}")

    log.info("=== Cron Job 結束 ===")


if __name__ == "__main__":
    main()
