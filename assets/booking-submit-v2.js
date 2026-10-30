(() => {
  "use strict";

  const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyurzm0hNw58V3CZI7QOz0nhDQtm-9dcJYYrVpO2NOpY08NUGTb4uNtXB6ABQEtB5sU3w/exec";
  const SOURCE = "https://ozdemiryulia-alt.github.io";
  const YEAR = 2026;
  const MONTHS = {
    "января": { code: "jan", index: 0 },
    "февраля": { code: "feb", index: 1 },
    "марта": { code: "mar", index: 2 },
    "апреля": { code: "apr", index: 3 },
    "мая": { code: "may", index: 4 },
    "июня": { code: "jun", index: 5 },
    "июля": { code: "jul", index: 6 },
    "августа": { code: "aug", index: 7 },
    "сентября": { code: "sep", index: 8 },
    "октября": { code: "oct", index: 9 },
    "ноября": { code: "nov", index: 10 },
    "декабря": { code: "dec", index: 11 }
  };
  const inFlight = new Set();

  function text(element) {
    return (element?.textContent || "").trim().replace(/\s+/g, " ");
  }

  function getSummaryValue(label) {
    const details = document.querySelector("#booking .booking-summary .summary-details");
    if (!details) return "";
    for (const row of details.querySelectorAll(":scope > div")) {
      if (text(row.querySelector("small")) === label) return text(row.querySelector("b"));
    }
    return "";
  }

  function getSlot() {
    const dateLabel = getSummaryValue("Дата");
    const timeLabel = getSummaryValue("Время");
    const dateMatch = dateLabel.match(/^(\d{1,2})\s+([а-яё]+)/i);
    const timeMatch = timeLabel.match(/^(\d{1,2}):(\d{2})$/);
    if (!dateMatch || !timeMatch) return null;

    const month = MONTHS[dateMatch[2].toLowerCase()];
    if (!month) return null;
    const dayNumber = Number(dateMatch[1]);
    const date = new Date(Date.UTC(YEAR, month.index, dayNumber));
    if (date.getUTCMonth() !== month.index || date.getUTCDate() !== dayNumber) return null;
    if (date < new Date(Date.UTC(YEAR, 10, 1)) || date > new Date(Date.UTC(YEAR, 11, 31))) return null;

    const hour = String(Number(timeMatch[1])).padStart(2, "0");
    const minute = timeMatch[2];
    return {
      slotKey: `${month.code}-${String(dayNumber).padStart(2, "0")}|${hour}:${minute}`
    };
  }

  function setStatus(message, tone = "neutral") {
    const summary = document.querySelector("#booking .booking-summary");
    if (!summary) return;
    let status = document.getElementById("booking-request-status");
    if (!status) {
      status = document.createElement("p");
      status.id = "booking-request-status";
      status.setAttribute("role", "status");
      const note = summary.querySelector(".summary-note");
      (note || summary.lastElementChild).insertAdjacentElement("afterend", status);
    }
    const color = tone === "success"
      ? "background:rgba(183,230,201,.2);color:#fff;"
      : tone === "error"
        ? "background:rgba(255,214,208,.2);color:#fff;"
        : "background:rgba(255,255,255,.12);color:#fff;";
    status.style.cssText = `margin:14px 0 0;padding:11px 12px;border-radius:10px;font:13px/1.45 Arial,sans-serif;${color}`;
    status.textContent = message;
  }

  function requestBooking(payload) {
    return new Promise((resolve, reject) => {
      const callback = `__yuliaBookingCallback_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const script = document.createElement("script");
      const url = new URL(SCRIPT_URL);
      const params = {
        action: "book",
        callback,
        slotKey: payload.slotKey,
        service: payload.service,
        format: payload.format,
        name: payload.name,
        channel: payload.channel,
        source: SOURCE
      };
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

      let finished = false;
      let timer;
      const finish = (fn, value) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        delete window[callback];
        script.remove();
        fn(value);
      };
      window[callback] = (result) => finish(resolve, result);
      script.onerror = () => finish(reject, new Error("Не удалось связаться с системой записи."));
      timer = window.setTimeout(() => finish(reject, new Error("Система записи не ответила вовремя.")), 20000);
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  function buildPayload(button) {
    const slot = getSlot();
    const service = text(document.querySelector("#booking .service-card.active b"));
    const format = getSummaryValue("Формат");
    const name = (document.querySelector("#booking .name-field input")?.value || "").trim().slice(0, 120);
    if (!slot || !service || !format) return null;
    return {
      slotKey: slot.slotKey,
      service,
      format,
      name,
      channel: button.classList.contains("whatsapp") ? "whatsapp" : "telegram"
    };
  }

  async function sendBooking(payload) {
    if (inFlight.has(payload.slotKey)) return;
    inFlight.add(payload.slotKey);
    setStatus("Проверяю время и передаю заявку в таблицу и календарь…");
    try {
      const result = await requestBooking(payload);
      if (result?.ok) {
        setStatus("Заявка записана в таблицу и календарь. В открытом мессенджере нажмите «Отправить», чтобы написать Юлии. Окончательное подтверждение записи придёт от Юлии.", "success");
      } else {
        setStatus(result?.message || "Заявку сохранить не удалось. Напишите Юлии в открывшемся мессенджере.", "error");
      }
    } catch (error) {
      setStatus(`${error.message} Напишите Юлии в открывшемся мессенджере; пока заявка не подтверждена, время не считается забронированным.`, "error");
    } finally {
      inFlight.delete(payload.slotKey);
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("#booking button.messenger");
    if (!button || button.disabled) return;
    const payload = buildPayload(button);
    if (!payload) {
      setStatus("Не удалось определить дату, время или формат. Проверьте выбранный слот и попробуйте ещё раз.", "error");
      return;
    }
    sendBooking(payload);
  }, true);
})();
