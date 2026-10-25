(async () => {
  const title = document.getElementById("site-title");
  try {
    const res = await fetch("/api/public/config", { credentials: "same-origin" });
    const data = await res.json();
    if (data.ok && data.data?.siteName) title.textContent = data.data.siteName;
    if (data.data?.publicCreate) {
      const section = document.getElementById("public-create");
      section.hidden = false;
      initPublic();
    }
  } catch {
    /* 忽略 */
  }

  function setMsg(node, message, kind = "") {
    node.textContent = message;
    node.className = `state ${kind}`.trim();
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

  function initPublic() {
    const form = document.getElementById("public-form");
    const msg = document.getElementById("public-msg");
    const url = document.getElementById("public-url");
    const code = document.getElementById("public-code");
    const ttl = document.getElementById("public-ttl");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      setMsg(msg, "生成中…");

      const body = { url: url.value.trim() };
      if (code.value.trim()) body.code = code.value.trim();
      if (ttl.value) body.ttlDays = Number(ttl.value);

      try {
        const res = await fetch("/api/public/links", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.message || "创建失败");

        const shortUrl = data.item.shortUrl;
        setMsg(msg, `创建成功：${shortUrl}`, "ok");
        const ok = await copyText(shortUrl);
        if (ok) setMsg(msg, `创建成功，已复制：${shortUrl}`, "ok");
        url.value = "";
        code.value = "";
        ttl.value = "";
      } catch (error) {
        setMsg(msg, error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  }
})();
