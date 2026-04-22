(function () {
  function resolveEnv(config) {
    var requested = (config && config.env) || "prod";
    if (requested !== "auto") return requested;

    var host = (window.location && window.location.hostname) || "";
    var isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local");

    return isLocal ? "dev" : "prod";
  }

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

  function ensureTurnoModal() {
    var existing = document.getElementById("turnoChoiceModal");
    if (existing) return existing;

    var wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <dialog id="turnoChoiceModal" class="turno-modal">
        <form method="dialog" class="turno-modal-card">
          <button type="submit" class="turno-modal-x" aria-label="Cerrar">×</button>
          <h3>Te recomendamos usar el portal de autogestión para reservar tu turno de una manera más ágil</h3>
          <div class="turno-modal-actions">
            <a id="turnoWhatsappBtn" class="btn btn-primary" href="#" target="_blank" rel="noopener noreferrer">Usar WhatsApp de todas formas</a>
            <a id="turnoPortalBtn" class="btn btn-success" href="#" target="_blank" rel="noopener noreferrer">Portal de autogestión</a>
          </div>
        </form>
      </dialog>
    `;

    document.body.appendChild(wrapper.firstElementChild);
    return document.getElementById("turnoChoiceModal");
  }

  function setupTurnoModal(config, env) {
    var links = getConfigByEnv(config.links, env);
    var portalUrl = links.turno || "#";
    var whatsappUrl = links.whatsapp || "#";
    var modal = ensureTurnoModal();

    var waBtn = document.getElementById("turnoWhatsappBtn");
    var portalBtn = document.getElementById("turnoPortalBtn");
    if (waBtn) waBtn.setAttribute("href", whatsappUrl);
    if (portalBtn) portalBtn.setAttribute("href", portalUrl);

    document.querySelectorAll('[data-dynamic-link="turno"]').forEach(function (el) {
      if (el.hasAttribute("data-turno-direct")) return;
      if (el.dataset.turnoModalBound === "1") return;
      el.dataset.turnoModalBound = "1";

      el.addEventListener("click", function (event) {
        event.preventDefault();
        if (typeof modal.showModal === "function") {
          modal.showModal();
        } else {
          window.open(portalUrl, "_blank", "noopener,noreferrer");
        }
      });
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

  function getNewsBaseUrl(config, env) {
    var api = getConfigByEnv(config.api, env);
    return (api.newsBaseUrl || "").replace(/\/$/, "");
  }

  function excerpt(text, maxLen) {
    var raw = String(text || "").trim();
    if (raw.length <= maxLen) return raw;
    return raw.slice(0, maxLen).trimEnd() + "...";
  }

  function stripHtml(html) {
    return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function renderNewsListItem(item, apiBaseUrl) {
    var img = item.imageUrl ? `${apiBaseUrl}${item.imageUrl}` : "";
    var date = item.createdAt ? new Date(item.createdAt).toLocaleDateString("es-AR") : "";

    return `
      <article class="news-row-card">
        <a class="news-row-media" href="novedad.html?id=${item.id}" aria-label="Abrir nota ${escapeHtml(item.title)}">
          ${img ? `<img src="${img}" alt="${escapeHtml(item.title)}" loading="lazy" />` : '<div class="news-row-media-placeholder">Sin imagen</div>'}
        </a>
        <div class="news-row-content">
          <p class="newsletter-date">${escapeHtml(date)}</p>
          <h3><a href="novedad.html?id=${item.id}">${escapeHtml(item.title)}</a></h3>
          <p>${escapeHtml(excerpt(stripHtml(item.description), 180))}</p>
          <a class="news-read-more" href="novedad.html?id=${item.id}">Leer nota completa</a>
        </div>
      </article>
    `;
  }

  async function fetchJson(url) {
    var response = await fetch(url);
    if (!response.ok) throw new Error("Error API");
    return response.json();
  }

  async function loadNewsList(config, env) {
    var target = document.getElementById("newsletter-list");
    if (!target) return;

    var newsBaseUrl = getNewsBaseUrl(config, env);
    if (!newsBaseUrl) {
      target.innerHTML = '<p class="helper">Configurá APP_CONFIG.api para mostrar novedades.</p>';
      return;
    }

    try {
      var data = await fetchJson(`${newsBaseUrl}/api/news`);
      var items = (data && data.items) || [];

      if (!items.length) {
        target.innerHTML = '<p class="helper">Todavía no hay novedades publicadas.</p>';
        return;
      }

      target.innerHTML = items.map(function (item) {
        return renderNewsListItem(item, newsBaseUrl);
      }).join("");
    } catch (_err) {
      target.innerHTML = '<p class="helper">No se pudieron cargar las novedades por el momento.</p>';
    }
  }

  async function loadNewsDetail(config, env) {
    var target = document.getElementById("newsletter-detail");
    if (!target) return;

    var newsBaseUrl = getNewsBaseUrl(config, env);
    if (!newsBaseUrl) {
      target.innerHTML = '<p class="helper">Configurá APP_CONFIG.api para mostrar la nota.</p>';
      return;
    }

    var params = new URLSearchParams(window.location.search || "");
    var id = params.get("id");
    if (!id) {
      target.innerHTML = '<p class="helper">No se indicó una nota válida.</p>';
      return;
    }

    try {
      var item = null;

      try {
        var data = await fetchJson(`${newsBaseUrl}/api/news/${encodeURIComponent(id)}`);
        item = data && data.item;
      } catch (_detailErr) {
        // Compatibilidad: si el backend todavía no tiene /api/news/:id,
        // buscamos dentro del listado público.
        var listData = await fetchJson(`${newsBaseUrl}/api/news`);
        var listItems = (listData && listData.items) || [];
        item = listItems.find(function (entry) {
          return String(entry.id) === String(id);
        }) || null;
      }

      if (!item) throw new Error("Not found");

      var img = item.imageUrl ? `${newsBaseUrl}${item.imageUrl}` : "";
      var date = item.createdAt ? new Date(item.createdAt).toLocaleDateString("es-AR") : "";

      target.innerHTML = `
        <article class="news-detail-card">
          <p class="newsletter-date">${escapeHtml(date)}</p>
          <h2>${escapeHtml(item.title)}</h2>
          ${img ? `<img src="${img}" alt="${escapeHtml(item.title)}" loading="lazy" />` : ""}
          <div class="news-detail-body">
            ${item.description || ""}
          </div>
          <a class="btn btn-ghost" href="novedades.html">Volver a Novedades</a>
        </article>
      `;
    } catch (_err) {
      target.innerHTML = '<p class="helper">No se pudo cargar la nota solicitada.</p>';
    }
  }

  function init() {
    var config = window.APP_CONFIG || {};
    var env = resolveEnv(config);

    applyDynamicLinks(config, env);
    setupTurnoModal(config, env);
    loadNewsList(config, env);
    loadNewsDetail(config, env);
  }

  window.addEventListener("DOMContentLoaded", init);
  document.addEventListener("layout:ready", init);
})();
