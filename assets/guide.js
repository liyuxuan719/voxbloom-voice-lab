if (window.lucide?.createIcons) {
  window.lucide.createIcons({
    attrs: {
      "aria-hidden": "true",
      "stroke-width": 1.8,
    },
  });
}

const year = document.querySelector("#year");
if (year) year.textContent = new Date().getFullYear();
