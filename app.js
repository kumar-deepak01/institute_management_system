(() => {
  const menuButton = document.querySelector(".menu-toggle");
  const nav = document.querySelector(".main-nav");

  if (menuButton && nav) {
    menuButton.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(isOpen));
      menuButton.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
    });
    nav.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        nav.classList.remove("open");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Open navigation");
      }
    });
  }

  document.querySelectorAll("[data-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = document.getElementById(button.dataset.dialog);
      if (dialog && !dialog.open) dialog.showModal();
    });
  });

  document.querySelectorAll(".dialog-close").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  document.querySelectorAll(".lead-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const status = form.querySelector(".form-status");
      if (status) {
        status.textContent = form.closest("#login-dialog")
          ? "This is a front-end preview. Sign-in is not connected yet."
          : "Thanks — the form is ready for a secure trial-request service to be connected.";
        status.classList.add("success");
      }
    });
  });

  const cookieBanner = document.querySelector(".cookie-banner");
  if (cookieBanner) {
    const cookieChoice = window.localStorage.getItem("coach-sutra-cookie-choice");
    if (cookieChoice) cookieBanner.classList.add("hidden");
    cookieBanner.querySelectorAll(".cookie-accept, .cookie-decline").forEach((button) => {
      button.addEventListener("click", () => {
        window.localStorage.setItem("coach-sutra-cookie-choice", button.classList.contains("cookie-accept") ? "accepted" : "declined");
        cookieBanner.classList.add("hidden");
      });
    });
  }

  document.querySelectorAll("[data-billing]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-billing]").forEach((item) => item.classList.toggle("selected", item === button));
      const period = button.dataset.billing === "yearly" ? "year" : "month";
      document.querySelectorAll(".price strong[data-month]").forEach((price) => {
        price.textContent = price.dataset[period];
      });
      document.querySelectorAll(".price-note").forEach((note) => {
        note.textContent = note.textContent.replace(/Billed (monthly|yearly)/i, `Billed ${period === "year" ? "yearly" : "monthly"}`);
      });
    });
  });

  document.querySelectorAll(".newsletter-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const message = form.parentElement.querySelector(".newsletter-message");
      if (message) message.textContent = "Thanks for your interest. Newsletter signup isn't connected in this preview.";
      form.reset();
    });
  });

  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
