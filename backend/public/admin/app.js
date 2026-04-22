(function () {
  var authPanel = document.getElementById("authPanel");
  var editorPanel = document.getElementById("editorPanel");
  var authForm = document.getElementById("authForm");
  var newsForm = document.getElementById("newsForm");
  var newsList = document.getElementById("newsList");
  var cancelEditBtn = document.getElementById("cancelEditBtn");
  var logoutBtn = document.getElementById("logoutBtn");

  var tokenInput = document.getElementById("token");
  var idInput = document.getElementById("newsId");
  var titleInput = document.getElementById("title");
  var descriptionInput = document.getElementById("description");
  var statusInput = document.getElementById("status");
  var imageInput = document.getElementById("image");

  var token = localStorage.getItem("news_admin_token") || "";

  function setLoggedIn(isLogged) {
    authPanel.classList.toggle("hidden", isLogged);
    editorPanel.classList.toggle("hidden", !isLogged);
  }

  function resetForm() {
    idInput.value = "";
    titleInput.value = "";
    descriptionInput.value = "";
    statusInput.value = "draft";
    imageInput.value = "";
    cancelEditBtn.classList.add("hidden");
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

  function renderCard(item) {
    var image = item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.title}" />` : "";
    return `
      <article class="news-card">
        ${image}
        <h4>${item.title}</h4>
        <p>${item.description}</p>
        <p class="meta">Estado: ${item.status} · ${new Date(item.createdAt).toLocaleString()}</p>
        <div class="row-actions">
          <button data-edit="${item.id}" class="ghost">Editar</button>
          <button data-delete="${item.id}" class="ghost">Eliminar</button>
        </div>
      </article>
    `;
  }

  async function loadNews() {
    var data = await api("/api/admin/news");
    newsList.innerHTML = data.items.map(renderCard).join("") || "<p>No hay entradas aún.</p>";
  }

  authForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    token = tokenInput.value.trim();
    localStorage.setItem("news_admin_token", token);

    try {
      await loadNews();
      setLoggedIn(true);
    } catch (_err) {
      alert("Token inválido.");
      localStorage.removeItem("news_admin_token");
      token = "";
    }
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

  newsList.addEventListener("click", async function (e) {
    var editId = e.target.getAttribute("data-edit");
    var deleteId = e.target.getAttribute("data-delete");

    if (editId) {
      var data = await api("/api/admin/news");
      var row = data.items.find(function (it) { return String(it.id) === String(editId); });
      if (!row) return;
      idInput.value = row.id;
      titleInput.value = row.title;
      descriptionInput.value = row.description;
      statusInput.value = row.status;
      cancelEditBtn.classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
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

  (async function bootstrap() {
    if (!token) {
      setLoggedIn(false);
      return;
    }
    try {
      await loadNews();
      setLoggedIn(true);
    } catch (_err) {
      localStorage.removeItem("news_admin_token");
      token = "";
      setLoggedIn(false);
    }
  })();
})();
