(function () {
  async function includePartials() {
    var nodes = Array.from(document.querySelectorAll("[data-include]"));
    if (!nodes.length) {
      document.dispatchEvent(new Event("layout:ready"));
      return;
    }

    await Promise.all(
      nodes.map(async function (node) {
        var file = node.getAttribute("data-include");
        if (!file) return;

        try {
          var res = await fetch(file, { cache: "no-cache" });
          if (!res.ok) throw new Error("Include not found");
          node.outerHTML = await res.text();
        } catch (_err) {
          node.outerHTML = "";
        }
      })
    );

    markCurrentNav();
    document.dispatchEvent(new Event("layout:ready"));
  }

  function markCurrentNav() {
    var path = (window.location.pathname || "").split("/").pop() || "index.html";
    var targetHref = "";

    if (path === "novedades.html" || path === "novedad.html") {
      targetHref = "novedades.html";
    }

    if (!targetHref) return;

    document.querySelectorAll('.nav a[aria-current="page"]').forEach(function (a) {
      a.removeAttribute("aria-current");
    });

    var active = document.querySelector('.nav a[href="' + targetHref + '"]');
    if (active) active.setAttribute("aria-current", "page");
  }

  includePartials();
})();
