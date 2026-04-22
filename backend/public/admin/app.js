(function () {
  var authPanel = document.getElementById("authPanel");
  var forceChangePanel = document.getElementById("forceChangePanel");
  var dashboard = document.getElementById("dashboard");

  var authForm = document.getElementById("authForm");
  var forceChangeForm = document.getElementById("forceChangeForm");
  var newsForm = document.getElementById("newsForm");
  var userForm = document.getElementById("userForm");

  var logoutBtn = document.getElementById("logoutBtn");
  var refreshBtn = document.getElementById("refreshBtn");
  var refreshUsersBtn = document.getElementById("refreshUsersBtn");
  var cancelEditBtn = document.getElementById("cancelEditBtn");

  var usersMenuBtn = document.getElementById("usersMenuBtn");
  var sessionText = document.getElementById("sessionText");
  var toastStack = document.getElementById("toastStack");
  var confirmDialog = document.getElementById("confirmDialog");
  var confirmTitle = document.getElementById("confirmTitle");
  var confirmMessage = document.getElementById("confirmMessage");
  var confirmOkBtn = document.getElementById("confirmOkBtn");

  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var newPasswordInput = document.getElementById("newPassword");

  var idInput = document.getElementById("newsId");
  var titleInput = document.getElementById("title");
  var descriptionEditor = document.getElementById("descriptionEditor");
  var statusInput = document.getElementById("status");
  var imageInput = document.getElementById("image");

  var userEmailInput = document.getElementById("userEmail");
  var userRoleInput = document.getElementById("userRole");

  var tempPasswordHint = document.getElementById("tempPasswordHint");
  var newsList = document.getElementById("newsList");
  var usersList = document.getElementById("usersList");

  var sectionButtons = Array.from(document.querySelectorAll("[data-section-target]"));
  var sections = Array.from(document.querySelectorAll(".content-section"));

  var authToken = localStorage.getItem("news_access_token") || "";
  var firstUseToken = "";
  var currentUser = null;
  var newsCache = [];
  var quill = null;

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function stripHtml(html) {
    return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  function initRichEditor() {
    if (!descriptionEditor || typeof window.Quill === "undefined") return;
    quill = new window.Quill("#descriptionEditor", {
      theme: "snow",
      placeholder: "Escribí la nota...",
      modules: {
        toolbar: [
          [{ header: [3, 4, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          ["blockquote", "link"],
          ["clean"]
        ]
      }
    });
  }

  function getDescriptionHtml() {
    if (quill) {
      return (quill.root.innerHTML || "").trim();
    }
    return "";
  }

  function setDescriptionHtml(html) {
    if (!quill) return;
    quill.clipboard.dangerouslyPasteHTML(html || "");
  }

  function showToast(kind, message) {
    var el = document.createElement("div");
    el.className = `toast ${kind || "success"}`;
    el.textContent = message;
    toastStack.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 3200);
  }

  function showError(err, fallbackMessage) {
    var message = fallbackMessage;
    if (err && err.message) {
      try {
        var parsed = JSON.parse(err.message);
        message = parsed.error || fallbackMessage;
      } catch (_e) {
        message = err.message;
      }
    }
    showToast("error", message);
  }

  function confirmAction(title, message, confirmText) {
    return new Promise(function (resolve) {
      confirmTitle.textContent = title || "Confirmar acción";
      confirmMessage.textContent = message || "";
      confirmOkBtn.textContent = confirmText || "Confirmar";
      confirmDialog.showModal();
      confirmDialog.addEventListener("close", function handler() {
        confirmDialog.removeEventListener("close", handler);
        resolve(confirmDialog.returnValue === "ok");
      });
    });
  }

  function setScreen(name) {
    authPanel.classList.toggle("hidden", name !== "login");
    forceChangePanel.classList.toggle("hidden", name !== "firstUse");
    dashboard.classList.toggle("hidden", name !== "dashboard");
  }

  function setActiveSection(sectionId) {
    sectionButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-section-target") === sectionId);
    });

    sections.forEach(function (section) {
      section.classList.toggle("hidden", section.id !== sectionId);
    });
  }

  function resetNewsForm() {
    idInput.value = "";
    titleInput.value = "";
    setDescriptionHtml("");
    statusInput.value = "draft";
    imageInput.value = "";
    cancelEditBtn.classList.add("hidden");
  }

  function updateSessionUI() {
    if (!currentUser) {
      sessionText.textContent = "";
      usersMenuBtn.classList.add("hidden");
      return;
    }

    sessionText.textContent = `${currentUser.email} · rol ${currentUser.role}`;
    usersMenuBtn.classList.toggle("hidden", currentUser.role !== "superadmin");
  }

  async function api(path, options) {
    var headers = {
      ...(options && options.headers ? options.headers : {})
    };

    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    var res = await fetch(path, {
      ...(options || {}),
      headers
    });

    if (!res.ok) {
      var txt = await res.text();
      throw new Error(txt || "Error de API");
    }

    if (res.status === 204) return null;
    return res.json();
  }

  async function login(email, password) {
    var res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    });

    var data = await res.json();
    if (!res.ok) throw new Error(data.error || "Credenciales inválidas");

    return data;
  }

  function renderNewsTable(items) {
    if (!items.length) return '<p class="empty">No hay entradas aún.</p>';

    return `
      <div class="news-accordion">
        ${items.map(function (item) {
          var date = new Date(item.createdAt).toLocaleString("es-AR");
          var statusLabel = item.status === "published" ? "Activo" : "Desactivado";
          return `
            <details class="news-accordion-item">
              <summary class="news-accordion-head">
                <div class="news-accordion-title">
                  <strong>${escapeHtml(item.title)}</strong>
                  <span class="news-accordion-date">${date}</span>
                </div>
                <div class="news-accordion-meta">
                  <span class="badge ${item.status}">${statusLabel}</span>
                  <label class="switch" title="Activar / Desactivar">
                    <input type="checkbox" data-toggle-status="${item.id}" ${item.status === "published" ? "checked" : ""} />
                    <span class="slider"></span>
                  </label>
                </div>
              </summary>
              <div class="news-accordion-body">
                <p>${escapeHtml(stripHtml(item.description)).replace(/\n/g, "<br>")}</p>
                <div class="row-actions">
                  <button type="button" data-edit="${item.id}" class="ghost small">Editar</button>
                  <button type="button" data-delete="${item.id}" class="ghost small danger">Eliminar</button>
                </div>
              </div>
            </details>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderUsersTable(items) {
    if (!items.length) return '<p class="empty">No hay usuarios.</p>';

    return `
      <table class="data-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Rol</th>
            <th>Activo</th>
            <th>Primer cambio</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(function (user) {
            return `
              <tr>
                <td>${escapeHtml(user.email)}</td>
                <td><span class="badge ${user.role === "superadmin" ? "published" : "draft"}">${user.role}</span></td>
                <td>
                  <label class="switch">
                    <input type="checkbox" data-user-toggle="${user.id}" ${user.isActive ? "checked" : ""} ${currentUser && currentUser.id === user.id ? "disabled" : ""} />
                    <span class="slider"></span>
                  </label>
                </td>
                <td>${user.mustChangePassword ? "Pendiente" : "OK"}</td>
                <td class="row-actions">
                  <button type="button" data-reset-user="${user.id}" class="ghost small">Reset pass</button>
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
    newsCache = data.items || [];
    newsList.innerHTML = renderNewsTable(newsCache);
  }

  async function loadUsers() {
    if (!currentUser || currentUser.role !== "superadmin") return;
    var data = await api("/api/admin/users");
    usersList.innerHTML = renderUsersTable(data.items || []);
  }

  function clearSession() {
    authToken = "";
    currentUser = null;
    firstUseToken = "";
    localStorage.removeItem("news_access_token");
    updateSessionUI();
  }

  async function refreshSession() {
    if (!authToken) {
      setScreen("login");
      return;
    }

    try {
      var me = await api("/api/auth/me");
      currentUser = me.user;
      updateSessionUI();
      setScreen("dashboard");
      setActiveSection("listSection");
      await loadNews();
      await loadUsers();
    } catch (_err) {
      clearSession();
      setScreen("login");
    }
  }

  authForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    try {
      var data = await login(emailInput.value.trim(), passwordInput.value);
      if (data.mustChangePassword) {
        firstUseToken = data.changeToken;
        setScreen("firstUse");
        return;
      }

      authToken = data.token;
      localStorage.setItem("news_access_token", authToken);
      currentUser = data.user;
      updateSessionUI();
      setScreen("dashboard");
      setActiveSection("listSection");
      await loadNews();
      await loadUsers();
      showToast("success", "Sesión iniciada");
    } catch (err) {
      showError(err, "No se pudo iniciar sesión");
    }
  });

  forceChangeForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    try {
      var res = await fetch("/api/auth/change-password-first-use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeToken: firstUseToken,
          newPassword: newPasswordInput.value
        })
      });
      var data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo cambiar contraseña");

      authToken = data.token;
      localStorage.setItem("news_access_token", authToken);
      currentUser = data.user;
      firstUseToken = "";
      newPasswordInput.value = "";

      updateSessionUI();
      setScreen("dashboard");
      setActiveSection("listSection");
      await loadNews();
      await loadUsers();
      showToast("success", "Contraseña actualizada");
    } catch (err) {
      showError(err, "No se pudo cambiar contraseña");
    }
  });

  sectionButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = btn.getAttribute("data-section-target");
      if (target === "usersSection" && (!currentUser || currentUser.role !== "superadmin")) return;
      setActiveSection(target);
    });
  });

  newsForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    var formData = new FormData();
    formData.append("title", titleInput.value);
    formData.append("description", getDescriptionHtml());
    formData.append("status", statusInput.value);
    if (imageInput.files[0]) formData.append("image", imageInput.files[0]);

    try {
      if (idInput.value) {
        await api(`/api/admin/news/${idInput.value}`, { method: "PUT", body: formData });
      } else {
        await api("/api/admin/news", { method: "POST", body: formData });
      }
      resetNewsForm();
      await loadNews();
      setActiveSection("listSection");
      showToast("success", "Entrada guardada");
    } catch (err) {
      showError(err, "No se pudo guardar");
    }
  });

  cancelEditBtn.addEventListener("click", function () {
    resetNewsForm();
  });

  logoutBtn.addEventListener("click", function () {
    clearSession();
    setScreen("login");
  });

  refreshBtn.addEventListener("click", async function () {
    try {
      await loadNews();
      showToast("success", "Listado actualizado");
    } catch (err) {
      showError(err, "No se pudo actualizar");
    }
  });

  refreshUsersBtn.addEventListener("click", async function () {
    try {
      await loadUsers();
      showToast("success", "Usuarios actualizados");
    } catch (err) {
      showError(err, "No se pudo actualizar usuarios");
    }
  });

  userForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    tempPasswordHint.textContent = "";

    try {
      var res = await api("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: userEmailInput.value.trim(),
          role: userRoleInput.value
        })
      });

      userEmailInput.value = "";
      userRoleInput.value = "admin";
      tempPasswordHint.textContent = `Usuario creado. Contraseña temporal: ${res.tempPassword}`;
      await loadUsers();
      showToast("success", "Usuario creado");
    } catch (err) {
      showError(err, "No se pudo crear usuario");
    }
  });

  newsList.addEventListener("click", async function (e) {
    var editId = e.target.getAttribute("data-edit");
    var deleteId = e.target.getAttribute("data-delete");

    if (editId) {
      var row = newsCache.find(function (item) { return String(item.id) === String(editId); });
      if (!row) return;
      idInput.value = row.id;
      titleInput.value = row.title;
      setDescriptionHtml(row.description || "");
      statusInput.value = row.status;
      cancelEditBtn.classList.remove("hidden");
      setActiveSection("createSection");
      return;
    }

    if (deleteId) {
      var confirmed = await confirmAction("Eliminar entrada", "Esta acción no se puede deshacer.", "Eliminar");
      if (!confirmed) return;
      try {
        await api(`/api/admin/news/${deleteId}`, { method: "DELETE" });
        await loadNews();
        showToast("success", "Entrada eliminada");
      } catch (err) {
        showError(err, "No se pudo eliminar");
      }
    }
  });

  newsList.addEventListener("change", async function (e) {
    var toggleId = e.target.getAttribute("data-toggle-status");
    if (!toggleId) return;

    var row = newsCache.find(function (item) { return String(item.id) === String(toggleId); });
    if (!row) return;

    var formData = new FormData();
    formData.append("title", row.title);
    formData.append("description", row.description);
    formData.append("status", e.target.checked ? "published" : "draft");

    try {
      await api(`/api/admin/news/${row.id}`, { method: "PUT", body: formData });
      await loadNews();
      showToast("success", "Estado de entrada actualizado");
    } catch (err) {
      showError(err, "No se pudo cambiar estado");
      await loadNews();
    }
  });

  usersList.addEventListener("change", async function (e) {
    var userId = e.target.getAttribute("data-user-toggle");
    if (!userId) return;

    try {
      await api(`/api/admin/users/${userId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: e.target.checked })
      });
      await loadUsers();
      showToast("success", "Estado de usuario actualizado");
    } catch (err) {
      showError(err, "No se pudo actualizar usuario");
      await loadUsers();
    }
  });

  usersList.addEventListener("click", async function (e) {
    var resetId = e.target.getAttribute("data-reset-user");
    if (!resetId) return;

    try {
      var res = await api(`/api/admin/users/${resetId}/reset-password`, { method: "POST" });
      tempPasswordHint.textContent = `Contraseña temporal regenerada: ${res.tempPassword}`;
      await loadUsers();
      showToast("success", "Contraseña temporal regenerada");
    } catch (err) {
      showError(err, "No se pudo resetear password");
    }
  });

  initRichEditor();
  refreshSession();
})();
