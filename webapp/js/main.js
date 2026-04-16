/**
 * webapp/js/main.js
 * 替換小波原本的 runAiFill() — 改為 submit 去 Worker API
 *
 * 原本: form submit → Anthropic API 直接生成 → 顯示結果
 * 現在: form submit → POST /api/submit → Queue → Hermes Cron
 *
 * TODO: 等 Worker URL 確認後設定 WORKER_BASE_URL
 */

const WORKER_BASE_URL = ""; // TODO: 部署後填入 e.g. https://abdominal-us-worker.xxx.workers.dev

/**
 * 驗證必填欄位
 */
function validateForm(data) {
  const required = ["petName", "species", "ownerName", "vetName", "observations"];
  for (const field of required) {
    if (!data[field] || !data[field].trim()) {
      alert(`請填寫: ${field}`);
      return false;
    }
  }
  return true;
}

/**
 * 取得表單資料
 */
function getFormData() {
  return {
    petName:     document.getElementById("petName").value.trim(),
    species:     document.getElementById("species").value.trim(),
    breed:       document.getElementById("breed")?.value.trim() || "",
    ownerName:   document.getElementById("ownerName").value.trim(),
    vetName:     document.getElementById("vetName").value.trim(),
    observations: document.getElementById("observations").value.trim(),
    organs:      getSelectedOrgans(),
    submitTime:  new Date().toISOString(),
  };
}

/**
 * 取得已選取的器官列表
 */
function getSelectedOrgans() {
  const checkboxes = document.querySelectorAll('input[name="organs"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

/**
 * 提交表單到 Worker
 */
async function submitToWorker(data) {
  const statusEl = document.getElementById("status");
  statusEl.className = "loading";
  statusEl.textContent = "正在提交...";

  const response = await fetch(`${WORKER_BASE_URL}/api/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // 可選: Authorization: Bearer xxx
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * 主流程
 */
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("report-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = getFormData();
    if (!validateForm(data)) return;

    try {
      const result = await submitToWorker(data);
      const statusEl = document.getElementById("status");
      statusEl.className = "success";
      statusEl.textContent = `已提交！報告將在 5-10 分鐘內生成並發送到小波嘅郵箱。`;
    } catch (err) {
      const statusEl = document.getElementById("status");
      statusEl.className = "error";
      statusEl.textContent = `提交失敗: ${err.message}`;
    }
  });
});
