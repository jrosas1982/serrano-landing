(function () {
  function applyDynamicLinks() {
    var config = window.APP_CONFIG || {};
    var env = config.env || "prod";
    var linksByEnv = config.links || {};
    var links = linksByEnv[env] || linksByEnv.prod || {};

    document.querySelectorAll("[data-dynamic-link]").forEach(function (el) {
      var key = el.getAttribute("data-dynamic-link");
      if (links[key]) {
        el.setAttribute("href", links[key]);
      }
    });
  }

  window.addEventListener("DOMContentLoaded", applyDynamicLinks);
})();
