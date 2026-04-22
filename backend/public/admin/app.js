(function () {
  var authPanel = document.getElementById("authPanel");
  var dashboard = document.getElementById("dashboard");
  var authForm = document.getElementById("authForm");
  var newsForm = document.getElementById("newsForm");
  var newsList = document.getElementById("newsList");
  var cancelEditBtn = document.getElementById("cancelEditBtn");
  var logoutBtn = document.getElementById("logoutBtn");
  var refreshBtn = document.getElementById("refreshBtn");

  var tokenInput = document.getElementById("token");
  var idInput = document.getElementById("newsId");
  var titleInput = document.getElementById("title");
  var descriptionInput = document.getElementById("description");
  var statusInput = document.getElementById("status");
  var imageInput = document.getElementById("image");

  var sectionButtons = Array.from(document.querySelectorAll("[data-section-target]"));
  var sections = Array.from(document.querySelectorAll(".content-section"));

  var token = localStorage.getItem("news_admin_token") || "";
  var itemsCache = [];

  function setLoggedIn(isLogged) {
    authPanel.classList.toggle("hidden", isLogged);
    dashboard.classList.toggle("hidden", !isLogged);
  }

  function setActiveSection(sectionId) {
    sectionButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-section-target") === sectionId);
    });

    sections.forEach(function (section) {
      section.classList.toggle("hidden", section.id !== sectionId);
    });
  }

  function resetForm() {
    idInput.value = "";
    titleInput.value = "";
    descriptionInput.value = "";
    statusInput.value = "draft";
    imageInput.value = "";
    cancelEditBtn.classList.add("hidden");
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function api(path, options) {
    var res = await fetch(path, {
      ...(options || {}),
      headers: {
        ...(options && options.headers ? options.headers : {}),
        "x-admin-token": token
      }
    });

    if (!res.ok) {
      var txt = await res.text();
      throw new Error(txt || "Error de API");
    }

    if (res.status === 204) return null;
    return res.json();
  }

  function renderTable(items) {
    if (!items.length) {
      return '<p class="empty">No hay entradas aún.</p>';
    }

    return `
      <table class="news-table">
        <thead>
          <tr>
            <th>Título</th>
            <th>Estado</th>
            <th>Activar / Desactivar</th>
            <th>Fecha</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(function (item) {
            var checked = item.status === "published" ? "checked" : "";
            var stateLabel = item.status === "published" ? "Activo" : "Desactivado";
            return `
              <tr>
                <td>
                  <strong>${escapeHtml(item.title)}</strong>
                  <div class="desc">${escapeHtml(item.description)}</div>
                </td>
                <td><span class="badge ${item.status}">${stateLabel}</span></td>
                <td>
                  <label class="switch">
                    <input type="checkbox" data-toggle-status="${item.id}" ${checked} />
                    <span class="slider"></span>
                  </label>
                </td>
                <td>${new Date(item.createdAt).toLocaleString("es-AR")}</td>
                <td class="row-actions">
                  <button type="button" data-edit="${item.id}" class="ghost small">Editar</button>
                  <button type="button" data-delete="${item.id}" class="ghost small danger">Eliminar</button>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  async function loadNews() {
    var data = await api("/api/admin/news");
    itemsCache = data.items || [];
    newsList.innerHTML = renderTable(itemsCache);
  }

  async function updateStatus(itemId, newStatus) {
    var item = itemsCache.find(function (entry) {
      return String(entry.id) === String(itemId);
    });

    if (!item) return;

    var formData = new FormData();
    formData.append("title", item.title);
    formData.append("description", item.description);
    formData.append("status", newStatus);

    await api(`/api/admin/news/${item.id}`, {
      method: "PUT",
      body: formData
    });

    await loadNews();
  }

  function openEdit(itemId) {
    var row = itemsCache.find(function (item) {
      return String(item.id) === String(itemId);
    });

    if (!row) return;

    idInput.value = row.id;
    titleInput.value = row.title;
    descriptionInput.value = row.description;
    statusInput.value = row.status;
    cancelEditBtn.classList.remove("hidden");
    setActiveSection("createSection");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  authForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    token = tokenInput.value.trim();
    localStorage.setItem("news_admin_token", token);

    try {
      await loadNews();
      setLoggedIn(true);
      setActiveSection("listSection");
    } catch (_err) {
      alert("Token inválido.");
      localStorage.removeItem("news_admin_token");
      token = "";
    }
  });

  sectionButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setActiveSection(btn.getAttribute("data-section-target"));
    });
  });

  newsForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    var formData = new FormData();
    formData.append("title", titleInput.value);
    formData.append("description", descriptionInput.value);
    formData.append("status", statusInput.value);
    if (imageInput.files[0]) formData.append("image", imageInput.files[0]);

    try {
      if (idInput.value) {
        await api(`/api/admin/news/${idInput.value}`, {
          method: "PUT",
          body: formData
        });
      } else {
        await api("/api/admin/news", {
          method: "POST",
          body: formData
        });
      }

      resetForm();
      await loadNews();
      setActiveSection("listSection");
    } catch (err) {
      alert("No se pudo guardar: " + err.message);
    }
  });

  cancelEditBtn.addEventListener("click", function () {
    resetForm();
  });

  logoutBtn.addEventListener("click", function () {
    localStorage.removeItem("news_admin_token");
    token = "";
    tokenInput.value = "";
    setLoggedIn(false);
  });

  refreshBtn.addEventListener("click", async function () {
    try {
      await loadNews();
    } catch (err) {
      alert("No se pudo actualizar: " + err.message);
    }
  });

  newsList.addEventListener("click", async function (e) {
    var target = e.target;
    var editId = target.getAttribute("data-edit");
    var deleteId = target.getAttribute("data-delete");

    if (editId) {
      openEdit(editId);
      return;
    }

    if (deleteId) {
      if (!confirm("¿Eliminar esta entrada?")) return;
      try {
        await api(`/api/admin/news/${deleteId}`, { method: "DELETE" });
        await loadNews();
      } catch (err) {
        alert("No se pudo eliminar: " + err.message);
      }
    }
  });

  newsList.addEventListener("change", async function (e) {
    var toggleId = e.target.getAttribute("data-toggle-status");
    if (!toggleId) return;

    var nextStatus = e.target.checked ? "published" : "draft";

    try {
      await updateStatus(toggleId, nextStatus);
    } catch (err) {
      alert("No se pudo cambiar el estado: " + err.message);
      await loadNews();
    }
  });

  (async function bootstrap() {
    if (!token) {
      setLoggedIn(false);
      return;
    }

    try {
      await loadNews();
      setLoggedIn(true);
      setActiveSection("listSection");
    } catch (_err) {
      localStorage.removeItem("news_admin_token");
      token = "";
      setLoggedIn(false);
    }
  })();
})();

