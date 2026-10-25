(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const viewEl = $("#view");
  const state = {
    me: null,
    config: {},
    view: "overview",
    links: { page: 1, pageSize: 20, q: "", status: "", sort: "created_at", order: "desc", items: [], total: 0, pages: 1, seq: 0 },
    clicks: { limit: 100, offset: 0, code: "", items: [], total: 0 },
    audit: { limit: 100, offset: 0, items: [], total: 0 },
  };

  let viewToken = 0;
  let toastTimer = null;
  let searchTimer = null;

  const TITLES = {
    overview: "概览",
    links: "链接管理",
    clicks: "点击记录",
    admins: "管理员",
    settings: "设置",
    audit: "审计日志",
  };

  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (value) => String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
  const pad = (n) => String(n).padStart(2, "0");

  function fmtTime(ms) {
    if (!ms) return "—";
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtDate(ms) {
    if (!ms) return "—";
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dayLabel(ms) {
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function toast(message, kind = "ok") {
    const node = $("#toast");
    node.textContent = message;
    node.className = `toast ${kind}`;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      node.hidden = true;
    }, 2800);
  }

  async function api(path, options = {}) {
    const init = { method: options.method || "GET", credentials: "same-origin", headers: {} };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(path, init);
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (response.status === 401 && !path.startsWith("/api/auth/login")) {
      state.me = null;
      showLogin();
    }
    if (!response.ok || (data && data.ok === false)) {
      const error = new Error((data && (data.message || data.error)) || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data || {};
  }

  async function attempt(action, successMessage) {
    try {
      await action();
      if (successMessage) toast(successMessage);
      return true;
    } catch (error) {
      toast(error.message, "error");
      return false;
    }
  }

  function canWrite() {
    return state.me && state.me.role === "admin";
  }

  /* ---------------- 登录 / 布局 ---------------- */

  function applyConfig() {
    const name = state.config.siteName || "短链服务";
    document.title = `${TITLES[state.view] || "管理"} · ${name}`;
    $("#side-title").textContent = name;
    $("#login-title").textContent = `${name} · 管理台`;
  }

  function showLogin() {
    $("#shell").hidden = true;
    $("#login-view").hidden = false;
    $("#login-password").value = "";
    const name = state.config.siteName || "短链服务";
    $("#login-title").textContent = `${name} · 管理台`;
    const focusTarget = $("#login-username").value ? $("#login-password") : $("#login-username");
    focusTarget.focus();
  }

  function showApp() {
    $("#login-view").hidden = true;
    $("#shell").hidden = false;
    const role = state.me.role === "admin" ? "管理员" : "只读";
    $("#who").textContent = `${state.me.username} · ${role}`;
    applyConfig();
  }

  $("nav#nav").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    navigate(button.dataset.view);
  });

  function currentHashView() {
    const raw = location.hash.replace(/^#\/?/, "");
    return TITLES[raw] ? raw : "overview";
  }

  async function navigate(view) {
    const next = TITLES[view] ? view : "overview";
    state.view = next;
    const token = ++viewToken;
    $$("#nav .nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === next);
    });
    $("#page-title").textContent = TITLES[next];
    document.title = `${TITLES[next]} · ${state.config.siteName || "短链服务"}`;
    if (location.hash !== `#/${next}`) {
      history.replaceState(null, "", `#/${next}`);
    }
    viewEl.innerHTML = '<div class="loading">加载中…</div>';

    try {
      if (next === "overview") await renderOverview(token);
      else if (next === "links") await renderLinks(false);
      else if (next === "clicks") await renderClicks(token);
      else if (next === "admins") await renderAdmins(token);
      else if (next === "settings") await renderSettings(token);
      else if (next === "audit") await renderAudit(token);
    } catch (error) {
      if (token !== viewToken) return;
      viewEl.innerHTML = `<section class="card"><p class="empty">${esc(error.message)}</p></section>`;
    }
  }

  window.addEventListener("hashchange", () => {
    const next = currentHashView();
    if (next !== state.view) navigate(next);
  });

  /* ---------------- 概览 ---------------- */

  function statCard(label, value, hint) {
    return `<div class="stat">
      <span class="stat-label">${esc(label)}</span>
      <strong>${Number(value || 0).toLocaleString("zh-CN")}</strong>
      <span class="stat-hint">${esc(hint)}</span>
    </div>`;
  }

  async function renderOverview(token) {
    const data = await api("/api/admin/overview?days=14");
    if (token !== viewToken) return;

    const max = Math.max(1, ...data.trend.map((item) => item.count));
    const chart = data.trend
      .map((item) => {
        const height = item.count ? Math.max(4, Math.round((item.count / max) * 100)) : 2;
        return `<div class="bar-col" title="${esc(fmtDate(item.day))}：${item.count} 次">
          <div class="bar-track"><div class="bar" style="height:${height}%"></div></div>
          <span class="bar-label">${esc(dayLabel(item.day))}</span>
        </div>`;
      })
      .join("");

    const topRows = data.top.length
      ? data.top
          .map(
            (item) => `<tr>
              <td><span class="mono">/${esc(item.code)}</span></td>
              <td class="num">${Number(item.hits).toLocaleString("zh-CN")}</td>
              <td class="url" title="${esc(item.url)}">${esc(item.url)}</td>
            </tr>`,
          )
          .join("")
      : '<tr><td colspan="3" class="empty-row">暂无数据</td></tr>';

    const recentRows = data.recent.length
      ? data.recent
          .map(
            (item) => `<tr>
              <td class="nowrap">${esc(fmtTime(item.ts))}</td>
              <td><span class="mono">/${esc(item.code)}</span></td>
              <td>${esc(item.country || "—")}</td>
            </tr>`,
          )
          .join("")
      : '<tr><td colspan="3" class="empty-row">暂无点击</td></tr>';

    viewEl.innerHTML = `
      <div class="stats">
        ${statCard("短链总数", data.totals.links, `${data.totals.active} 条启用中`)}
        ${statCard("总点击", data.totals.clicks, "全部历史")}
        ${statCard("今日点击", data.today, "按 UTC 日期统计")}
        ${statCard("平均点击", data.totals.links ? Math.round(data.totals.clicks / data.totals.links) : 0, "每条短链")}
      </div>
      <section class="card">
        <div class="card-head"><h3>近 14 天点击</h3><span class="hint">UTC · 关闭 COUNT_HITS 后不再记录</span></div>
        <div class="chart">${chart}</div>
      </section>
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h3>热门短链</h3><span class="hint">按点击排序</span></div>
          <div class="table-wrap">
            <table class="table"><thead><tr><th>短码</th><th class="num">点击</th><th>目标</th></tr></thead>
            <tbody>${topRows}</tbody></table>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h3>最近点击</h3><span class="hint">最新 8 条</span></div>
          <div class="table-wrap">
            <table class="table"><thead><tr><th>时间</th><th>短码</th><th>地区</th></tr></thead>
            <tbody>${recentRows}</tbody></table>
          </div>
        </section>
      </div>`;
  }

  /* ---------------- 链接管理 ---------------- */

  function statusBadge(item) {
    if (item.expired) return '<span class="badge warn">已过期</span>';
    return item.status === "active" ? '<span class="badge ok">启用</span>' : '<span class="badge off">停用</span>';
  }

  function sortTh(key, label) {
    const s = state.links;
    const active = s.sort === key;
    const arrow = active ? (s.order === "asc" ? " ↑" : " ↓") : "";
    return `<th class="sortable${active ? " active" : ""}" data-sort="${key}">${label}${arrow}</th>`;
  }

  async function renderLinks(resetPage) {
    const s = state.links;
    if (resetPage) s.page = 1;
    const seq = ++s.seq;

    const params = new URLSearchParams({
      page: String(s.page),
      pageSize: String(s.pageSize),
      sort: s.sort,
      order: s.order,
    });
    if (s.q) params.set("q", s.q);
    if (s.status) params.set("status", s.status);

    let data;
    try {
      data = await api(`/api/admin/links?${params.toString()}`);
    } catch (error) {
      if (seq !== s.seq) return;
      toast(error.message, "error");
      return;
    }
    if (seq !== s.seq) return;

    s.items = data.items || [];
    s.total = data.total || 0;
    s.pages = data.pages || 1;
    if (s.page > s.pages) s.page = s.pages;

    const writable = canWrite();
    const rows = s.items.length
      ? s.items
          .map(
            (item) => `<tr>
              <td><a class="code" href="${esc(item.shortUrl)}" target="_blank" rel="noreferrer">/${esc(item.code)}</a></td>
              <td class="nowrap">${esc(fmtTime(item.createdAt))}</td>
              <td class="num">${Number(item.hits).toLocaleString("zh-CN")}</td>
              <td class="url" title="${esc(item.url)}">${esc(item.url)}</td>
              <td class="note" title="${esc(item.note || "")}">${esc(item.note || "—")}</td>
              <td>${statusBadge(item)}</td>
              <td class="nowrap">${item.expiresAt ? esc(fmtDate(item.expiresAt)) : '<span class="hint">永久</span>'}</td>
              <td>
                <div class="actions">
                  <button class="btn ghost sm" data-act="copy" data-id="${item.id}" type="button">复制</button>
                  ${
                    writable
                      ? `<button class="btn ghost sm" data-act="edit" data-id="${item.id}" type="button">编辑</button>
                         <button class="btn ghost sm" data-act="toggle" data-id="${item.id}" type="button">${item.status === "active" ? "停用" : "启用"}</button>
                         <button class="btn danger sm" data-act="delete" data-id="${item.id}" type="button">删除</button>`
                      : ""
                  }
                </div>
              </td>
            </tr>`,
          )
          .join("")
      : '<tr><td colspan="8" class="empty-row">没有符合条件的短链</td></tr>';

    viewEl.innerHTML = `
      <section class="card">
        <div class="toolbar">
          <input id="link-search" class="grow" type="search" placeholder="搜索短码 / 目标地址 / 备注" value="${esc(s.q)}" />
          <select id="link-status">
            <option value="">全部状态</option>
            <option value="active"${s.status === "active" ? " selected" : ""}>启用</option>
            <option value="disabled"${s.status === "disabled" ? " selected" : ""}>停用</option>
          </select>
          <button id="link-refresh" class="btn ghost" type="button">刷新</button>
          ${writable ? '<button id="link-create" class="btn primary" type="button">新建短链</button>' : '<span class="badge readonly">只读模式</span>'}
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                ${sortTh("code", "短码")}
                ${sortTh("created_at", "创建时间")}
                ${sortTh("hits", "点击")}
                <th>目标地址</th>
                <th>备注</th>
                <th>状态</th>
                <th>到期</th>
                <th class="right">操作</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="pager">
          <span>共 ${s.total} 条 · 第 ${s.page}/${s.pages} 页</span>
          <div class="pager-actions">
            <button class="btn ghost sm" data-page="prev" type="button"${s.page <= 1 ? " disabled" : ""}>上一页</button>
            <button class="btn ghost sm" data-page="next" type="button"${s.page >= s.pages ? " disabled" : ""}>下一页</button>
          </div>
        </div>
      </section>`;

    const search = $("#link-search");
    search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const value = search.value;
      searchTimer = setTimeout(async () => {
        s.q = value.trim();
        await renderLinks(true);
        const again = $("#link-search");
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      }, 320);
    });

    $("#link-status").addEventListener("change", (event) => {
      s.status = event.target.value;
      renderLinks(true);
    });

    $("#link-refresh").addEventListener("click", () => renderLinks(false));
    $("#link-create")?.addEventListener("click", createLinkFlow);

    viewEl.querySelectorAll("th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (s.sort === key) s.order = s.order === "asc" ? "desc" : "asc";
        else {
          s.sort = key;
          s.order = "desc";
        }
        renderLinks(false);
      });
    });

    viewEl.querySelectorAll("button[data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.page === "prev" && s.page > 1) s.page -= 1;
        if (button.dataset.page === "next" && s.page < s.pages) s.page += 1;
        renderLinks(false);
      });
    });

    viewEl.querySelectorAll("button[data-act]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = Number(button.dataset.id);
        const item = s.items.find((entry) => entry.id === id);
        if (!item) return;
        const action = button.dataset.act;

        if (action === "copy") {
          const ok = await copyText(item.shortUrl);
          toast(ok ? "已复制短链" : "复制失败，请手动选择", ok ? "ok" : "error");
          return;
        }
        if (action === "edit") return editLinkFlow(item);
        if (action === "toggle") {
          const status = item.status === "active" ? "disabled" : "active";
          if (await attempt(() => api(`/api/admin/links/${id}`, { method: "PATCH", body: { status } }), status === "active" ? "已启用" : "已停用")) {
            renderLinks(false);
          }
          return;
        }
        if (action === "delete") {
          if (!confirm(`确定删除 /${item.code} ？点击记录也会一并删除。`)) return;
          if (await attempt(() => api(`/api/admin/links/${id}`, { method: "DELETE" }), "已删除")) {
            renderLinks(false);
          }
        }
      });
    });
  }

  async function createLinkFlow() {
    const values = await openModal({
      title: "新建短链",
      submitText: "创建",
      fields: [
        { name: "url", label: "目标地址", placeholder: "example.com/path", required: true },
        { name: "code", label: "自定义短码（可选）", placeholder: "promo2026" },
        { name: "ttlDays", label: "有效期天数（可选）", type: "number", placeholder: "留空 = 永久" },
        { name: "note", label: "备注（可选）", placeholder: "投放渠道 / 用途" },
      ],
    });
    if (!values) return;

    const body = { url: values.url };
    if (values.code) body.code = values.code;
    if (values.ttlDays) body.ttlDays = Number(values.ttlDays);
    if (values.note) body.note = values.note;

    if (await attempt(() => api("/api/admin/links", { method: "POST", body }), "短链已创建")) {
      renderLinks(true);
    }
  }

  async function editLinkFlow(item) {
    const values = await openModal({
      title: `编辑 /${item.code}`,
      submitText: "保存",
      fields: [
        { name: "url", label: "目标地址", value: item.url, required: true },
        { name: "note", label: "备注", value: item.note || "", placeholder: "可选" },
        {
          name: "status",
          label: "状态",
          type: "select",
          value: item.status,
          options: [
            { value: "active", label: "启用" },
            { value: "disabled", label: "停用" },
          ],
        },
        { name: "ttlDays", label: "有效期天数", type: "number", placeholder: "留空不变，0 = 永久" },
      ],
    });
    if (!values) return;

    const body = { url: values.url, note: values.note, status: values.status };
    if (values.ttlDays !== "") body.ttlDays = Number(values.ttlDays);

    if (await attempt(() => api(`/api/admin/links/${item.id}`, { method: "PATCH", body }), "已保存")) {
      renderLinks(false);
    }
  }

  /* ---------------- 点击记录 ---------------- */

  async function renderClicks(token) {
    const c = state.clicks;
    const params = new URLSearchParams({ limit: String(c.limit), offset: String(c.offset) });
    if (c.code) params.set("code", c.code);
    const data = await api(`/api/admin/clicks?${params.toString()}`);
    if (token !== viewToken) return;

    c.items = data.items || [];
    c.total = data.total || 0;

    const rows = c.items.length
      ? c.items
          .map(
            (item) => `<tr>
              <td class="nowrap">${esc(fmtTime(item.ts))}</td>
              <td><span class="mono">/${esc(item.code)}</span></td>
              <td class="nowrap">${esc([item.country, item.city].filter(Boolean).join(" · ") || "—")}</td>
              <td class="url" title="${esc(item.url || "")}">${esc(item.url || "（已删除）")}</td>
              <td class="url" title="${esc(item.referer || "")}">${esc(item.referer || "—")}</td>
              <td class="url" title="${esc(item.ua || "")}">${esc(shortUa(item.ua))}</td>
            </tr>`,
          )
          .join("")
      : '<tr><td colspan="6" class="empty-row">暂无点击记录</td></tr>';

    viewEl.innerHTML = `
      <section class="card">
        <div class="toolbar">
          <input id="click-code" class="grow" type="search" placeholder="按短码筛选，例如 promo2026" value="${esc(c.code)}" />
          <button id="click-refresh" class="btn ghost" type="button">刷新</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>时间</th><th>短码</th><th>地区</th><th>目标地址</th><th>来源</th><th>UA</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="pager">
          <span>共 ${c.total} 条 · 当前 ${c.offset + 1}-${Math.min(c.offset + c.items.length, c.total)}</span>
          <div class="pager-actions">
            <button class="btn ghost sm" data-offset="prev" type="button"${c.offset <= 0 ? " disabled" : ""}>上一页</button>
            <button class="btn ghost sm" data-offset="next" type="button"${c.offset + c.limit >= c.total ? " disabled" : ""}>下一页</button>
          </div>
        </div>
      </section>`;

    const codeInput = $("#click-code");
    codeInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      c.code = codeInput.value.trim();
      c.offset = 0;
      renderClicks(viewToken);
    });
    codeInput.addEventListener("change", () => {
      c.code = codeInput.value.trim();
      c.offset = 0;
      renderClicks(viewToken);
    });
    $("#click-refresh").addEventListener("click", () => renderClicks(viewToken));
    viewEl.querySelectorAll("button[data-offset]").forEach((button) => {
      button.addEventListener("click", () => {
        c.offset = button.dataset.offset === "prev" ? Math.max(0, c.offset - c.limit) : c.offset + c.limit;
        renderClicks(viewToken);
      });
    });
  }

  function shortUa(ua) {
    if (!ua) return "—";
    if (ua.includes("iPhone")) return "iPhone";
    if (ua.includes("Android")) return "Android";
    if (ua.includes("Windows")) return "Windows";
    if (ua.includes("Macintosh")) return "macOS";
    if (ua.includes("bot")) return "Bot";
    return ua.slice(0, 40);
  }

  /* ---------------- 管理员 ---------------- */

  async function renderAdmins(token) {
    const data = await api("/api/admin/admins");
    if (token !== viewToken) return;

    const writable = canWrite();
    const rows = (data.items || [])
      .map(
        (item) => `<tr>
          <td><span class="mono">${esc(item.username)}</span>${item.id === state.me.id ? ' <span class="badge">当前</span>' : ""}</td>
          <td>${item.role === "admin" ? '<span class="badge ok">管理员</span>' : '<span class="badge readonly">只读</span>'}</td>
          <td>${item.disabled ? '<span class="badge off">已禁用</span>' : '<span class="badge ok">正常</span>'}</td>
          <td class="nowrap">${esc(fmtTime(item.last_login_at))}</td>
          <td class="nowrap">${esc(fmtTime(item.created_at))}</td>
          <td>
            <div class="actions">
              ${
                writable
                  ? `<button class="btn ghost sm" data-act="reset" data-id="${item.id}" type="button">重置密码</button>
                     <button class="btn ghost sm" data-act="role" data-id="${item.id}" type="button">${item.role === "admin" ? "设为只读" : "设为管理员"}</button>
                     <button class="btn ghost sm" data-act="toggle" data-id="${item.id}" type="button">${item.disabled ? "启用" : "禁用"}</button>
                     <button class="btn danger sm" data-act="delete" data-id="${item.id}" type="button">删除</button>`
                  : ""
              }
            </div>
          </td>
        </tr>`,
      )
      .join("");

    viewEl.innerHTML = `
      <section class="card">
        <div class="toolbar">
          <span class="hint grow">管理员可读写，只读账号只能查看数据。</span>
          ${writable ? '<button id="admin-create" class="btn primary" type="button">新增管理员</button>' : '<span class="badge readonly">只读模式</span>'}
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>最近登录</th><th>创建时间</th><th class="right">操作</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="empty-row">暂无管理员</td></tr>'}</tbody>
          </table>
        </div>
      </section>`;

    $("#admin-create")?.addEventListener("click", addAdminFlow);

    viewEl.querySelectorAll("button[data-act]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = Number(button.dataset.id);
        const item = (data.items || []).find((entry) => entry.id === id);
        if (!item) return;
        const action = button.dataset.act;

        if (action === "reset") {
          const values = await openModal({
            title: `重置 ${item.username} 的密码`,
            submitText: "重置",
            fields: [{ name: "password", label: "新密码（至少 8 位）", type: "password", required: true }],
          });
          if (!values) return;
          if (await attempt(() => api(`/api/admin/admins/${id}`, { method: "PATCH", body: { password: values.password } }), "密码已重置")) {
            renderAdmins(viewToken);
          }
          return;
        }

        if (action === "role") {
          const role = item.role === "admin" ? "viewer" : "admin";
          if (await attempt(() => api(`/api/admin/admins/${id}`, { method: "PATCH", body: { role } }), "角色已更新")) {
            renderAdmins(viewToken);
          }
          return;
        }

        if (action === "toggle") {
          const disabled = !item.disabled;
          if (await attempt(() => api(`/api/admin/admins/${id}`, { method: "PATCH", body: { disabled } }), disabled ? "已禁用" : "已启用")) {
            renderAdmins(viewToken);
          }
          return;
        }

        if (action === "delete") {
          if (!confirm(`确定删除管理员 ${item.username} ？`)) return;
          if (await attempt(() => api(`/api/admin/admins/${id}`, { method: "DELETE" }), "已删除")) {
            renderAdmins(viewToken);
          }
        }
      });
    });
  }

  async function addAdminFlow() {
    const values = await openModal({
      title: "新增管理员",
      submitText: "创建",
      fields: [
        { name: "username", label: "用户名", placeholder: "3-32 位字母、数字、_ . -", required: true },
        { name: "password", label: "密码（至少 8 位）", type: "password", required: true },
        {
          name: "role",
          label: "角色",
          type: "select",
          value: "admin",
          options: [
            { value: "admin", label: "管理员（可读写）" },
            { value: "viewer", label: "只读" },
          ],
        },
      ],
    });
    if (!values) return;

    if (
      await attempt(
        () =>
          api("/api/admin/admins", {
            method: "POST",
            body: { username: values.username, password: values.password, role: values.role },
          }),
        "管理员已创建",
      )
    ) {
      renderAdmins(viewToken);
    }
  }

  /* ---------------- 设置 ---------------- */

  async function renderSettings(token) {
    const data = await api("/api/admin/settings");
    if (token !== viewToken) return;

    const writable = canWrite();
    viewEl.innerHTML = `
      <section class="card narrow">
        <h3>站点设置</h3>
        <form id="settings-form">
          <label class="check">
            <input id="set-public" type="checkbox"${data.data.public_create ? " checked" : ""}${writable ? "" : " disabled"} />
            允许未登录访客在首页创建短链
          </label>
          <label class="field">
            <span>新短链默认有效期（天，0 = 永久）</span>
            <input id="set-days" type="number" min="0" max="3650" value="${Number(data.data.default_expire_days) || 0}"${writable ? "" : " disabled"} />
          </label>
          ${writable ? '<button class="btn primary" type="submit">保存设置</button>' : '<p class="hint">只读账号无法修改设置。</p>'}
        </form>
        <p class="hint" style="margin-top:14px">环境变量 <code>ALLOW_PUBLIC_CREATE=1</code> 也能开启公开创建；环境变量与后台设置任一为开即生效。</p>
      </section>`;

    $("#settings-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = {
        public_create: $("#set-public").checked,
        default_expire_days: Number($("#set-days").value || 0),
      };
      if (await attempt(() => api("/api/admin/settings", { method: "PUT", body }), "设置已保存")) {
        renderSettings(viewToken);
      }
    });
  }

  /* ---------------- 审计日志 ---------------- */

  async function renderAudit(token) {
    const a = state.audit;
    const params = new URLSearchParams({ limit: String(a.limit), offset: String(a.offset) });
    const data = await api(`/api/admin/audit?${params.toString()}`);
    if (token !== viewToken) return;

    a.items = data.items || [];
    a.total = data.total || 0;

    const rows = a.items.length
      ? a.items
          .map(
            (item) => `<tr>
              <td class="nowrap">${esc(fmtTime(item.ts))}</td>
              <td class="nowrap">${esc(item.username)}</td>
              <td class="nowrap"><span class="mono">${esc(item.action)}</span></td>
              <td class="nowrap">${esc(item.target || "—")}</td>
              <td class="url" title="${esc(item.detail || "")}">${esc(item.detail || "—")}</td>
            </tr>`,
          )
          .join("")
      : '<tr><td colspan="5" class="empty-row">暂无日志</td></tr>';

    viewEl.innerHTML = `
      <section class="card">
        <div class="toolbar">
          <span class="hint grow">登录、建链、改动、管理员操作都会记录，IP 仅保存哈希。</span>
          <button id="audit-refresh" class="btn ghost" type="button">刷新</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="pager">
          <span>共 ${a.total} 条 · 当前 ${a.offset + 1}-${Math.min(a.offset + a.items.length, a.total)}</span>
          <div class="pager-actions">
            <button class="btn ghost sm" data-offset="prev" type="button"${a.offset <= 0 ? " disabled" : ""}>上一页</button>
            <button class="btn ghost sm" data-offset="next" type="button"${a.offset + a.limit >= a.total ? " disabled" : ""}>下一页</button>
          </div>
        </div>
      </section>`;

    $("#audit-refresh").addEventListener("click", () => renderAudit(viewToken));
    viewEl.querySelectorAll("button[data-offset]").forEach((button) => {
      button.addEventListener("click", () => {
        a.offset = button.dataset.offset === "prev" ? Math.max(0, a.offset - a.limit) : a.offset + a.limit;
        renderAudit(viewToken);
      });
    });
  }

  /* ---------------- 通用弹窗 / 复制 ---------------- */

  function openModal({ title, fields, submitText = "保存" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      const form = document.createElement("form");
      form.className = "modal";

      const heading = document.createElement("h3");
      heading.textContent = title;
      form.append(heading);

      const body = document.createElement("div");
      body.className = "modal-body";
      const inputs = new Map();

      for (const field of fields) {
        const label = document.createElement("label");
        label.className = "field";

        const span = document.createElement("span");
        span.textContent = field.label;
        label.append(span);

        let input;
        if (field.type === "select") {
          input = document.createElement("select");
          for (const option of field.options || []) {
            const node = document.createElement("option");
            node.value = option.value;
            node.textContent = option.label;
            if (String(option.value) === String(field.value ?? "")) node.selected = true;
            input.append(node);
          }
        } else {
          input = document.createElement("input");
          input.type = field.type || "text";
          if (field.placeholder) input.placeholder = field.placeholder;
          if (field.value !== undefined && field.value !== null) input.value = String(field.value);
        }
        if (field.type === "number") {
          input.min = "0";
          input.max = "3650";
        }
        input.required = Boolean(field.required);
        input.name = field.name;
        label.append(input);
        body.append(label);
        inputs.set(field.name, input);
      }
      form.append(body);

      const foot = document.createElement("div");
      foot.className = "modal-foot";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn ghost";
      cancel.textContent = "取消";
      const submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "btn primary";
      submit.textContent = submitText;
      foot.append(cancel, submit);
      form.append(foot);

      const close = (result) => {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
        resolve(result);
      };
      const onKey = (event) => {
        if (event.key === "Escape") close(null);
      };

      cancel.addEventListener("click", () => close(null));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close(null);
      });
      document.addEventListener("keydown", onKey);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const values = {};
        for (const [name, input] of inputs) values[name] = input.value.trim();
        close(values);
      });

      $("#modal-root").append(overlay);
      const first = body.querySelector("input, select");
      if (first) first.focus();
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      const ok = document.execCommand("copy");
      helper.remove();
      return ok;
    }
  }

  /* ---------------- 登录 / 退出 ---------------- */

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("#login-submit");
    const message = $("#login-msg");
    button.disabled = true;
    message.className = "msg";
    message.textContent = "登录中…";

    try {
      await api("/api/auth/login", {
        method: "POST",
        body: {
          username: $("#login-username").value.trim(),
          password: $("#login-password").value,
        },
      });
      const me = await api("/api/auth/me");
      state.me = me.admin;
      state.config = me.config || {};
      showApp();
      message.textContent = "";
      await navigate(currentHashView());
    } catch (error) {
      message.className = "msg error";
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  $("#logout").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* 忽略 */
    }
    state.me = null;
    showLogin();
  });

  async function boot() {
    try {
      const me = await api("/api/auth/me");
      state.me = me.admin;
      state.config = me.config || {};
      showApp();
      await navigate(currentHashView());
    } catch {
      showLogin();
    }
  }

  boot();
})();
