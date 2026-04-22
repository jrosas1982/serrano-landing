window.APP_CONFIG = {
  env: "auto",
  links: {
    dev: {
      turno: "https://testingserrano.itsos.ar/paciente.php",
      whatsapp: "https://wa.me/5491170605111"
    },
    prod: {
      turno: "https://serrano.itsos.ar/paciente.php",
      whatsapp: "https://wa.me/5491158156679"
    }
  },
  api: {
    dev: {
      newsBaseUrl: "http://localhost:4000"
    },
    prod: {
      newsBaseUrl: "https://api.jrosas.com.ar"
    }
  }
};
