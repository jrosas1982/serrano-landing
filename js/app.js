(function () {
  function getConfigByEnv(map, env) {
    return (map && (map[env] || map.prod)) || {};
  }

  function applyDynamicLinks(config, env) {
    var links = getConfigByEnv(config.links, env);

    document.querySelectorAll("[data-dynamic-link]").forEach(function (el) {
      var key = el.getAttribute("data-dynamic-link");
      if (links[key]) {
        el.setAttribute("href", links[key]);
      }
    });
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderNewsCard(item, apiBaseUrl) {
    var img = item.imageUrl ? `${apiBaseUrl}${item.imageUrl}` : "";
    var date = item.createdAt ? new Date(item.createdAt).toLocaleDateString("es-AR") : "";

    return `
      <article class="newsletter-card">
        ${img ? `<img src="${img}" alt="${escapeHtml(item.title)}" loading="lazy" />` : ""}
        <div class="newsletter-card-body">
          <p class="newsletter-date">${escapeHtml(date)}</p>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.description)}</p>
        </div>
      </article>
    `;
  }

  async function loadNews(config, env) {
    var target = document.getElementById("newsletter-list");
    if (!target) return;

    var api = getConfigByEnv(config.api, env);
    var newsBaseUrl = (api.newsBaseUrl || "").replace(/\/$/, "");
    if (!newsBaseUrl) {
      target.innerHTML = '<p class="helper">Configurá APP_CONFIG.api para mostrar novedades.</p>';
      return;
    }

    try {
      var response = await fetch(`${newsBaseUrl}/api/news`);
      if (!response.ok) throw new Error("Error API");
      var data = await response.json();
      var items = (data && data.items) || [];

      if (!items.length) {
        target.innerHTML = '<p class="helper">Todavía no hay novedades publicadas.</p>';
        return;
      }

      target.innerHTML = items.map(function (item) {
        return renderNewsCard(item, newsBaseUrl);
      }).join("");
    } catch (_err) {
      target.innerHTML = '<p class="helper">No se pudieron cargar las novedades por el momento.</p>';
    }
  }

  window.addEventListener("DOMContentLoaded", function () {
    var config = window.APP_CONFIG || {};
    var env = config.env || "prod";

    applyDynamicLinks(config, env);
    loadNews(config, env);
  });
})();
