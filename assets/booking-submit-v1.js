(() => {
  "use strict";

  const WEBHOOK_URL = "https://api.manus.im/api/webhook/triggers/c784aefc-9d5d-489b-a519-e19e99c0697a";
  const SOURCE = "ozdemiryulia-alt.github.io";
  const TEST_MODE = new URLSearchParams(window.location.search).get("booking_test") === "1";
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
  const pendingKey = "yulia-booking-pending-v1";
  const idKeyPrefix = "yulia-booking-id-v1:";
  const inFlight = new Set();

  function text(element) {
    return (element?.textContent || "").trim().replace(/\s+/g, " ");
  }

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const value = Math.floor(Math.random() * 16);
      return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
    });
  }

  function storageGet(key) {
    try {
      return JSON.parse(window.sessionStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The booking request still proceeds if browser storage is unavailable.
    }
  }

  function storageRemove(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // No action needed when browser storage is unavailable.
    }
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
    const time = getSummaryValue("Время");
    const match = dateLabel.match(/^(\d{1,2})\s+([а-яё]+)/i);
    const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match || !timeMatch) return null;

    const month = MONTHS[match[2].toLowerCase()];
    if (!month) return null;

    const now = new Date();
    const day = String(Number(match[1])).padStart(2, "0");
    const normalizedTime = `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}`;
    const scheduleYear = now.getFullYear() + (month.index < now.getMonth() ? 1 : 0);

    return {
      dateLabel,
      time: normalizedTime,
      scheduleYear,
      slotKey: `${month.code}-${day}|${normalizedTime}`
    };
  }

  function bookingIdFor(fingerprint) {
    const key = `${idKeyPrefix}${fingerprint}`;
    const saved = storageGet(key);
    if (saved?.bookingId && saved?.createdAt && Date.now() - Date.parse(saved.createdAt) < 60 * 60 * 1000) {
      return saved.bookingId;
    }

    const bookingId = createId();
    storageSet(key, { bookingId, createdAt: new Date().toISOString() });
    return bookingId;
  }

  function buildPayload(button) {
    const slot = getSlot();
    const service = text(document.querySelector("#booking .service-card.active b"));
    const format = getSummaryValue("Формат");
    const clientName = (document.querySelector("#booking .name-field input")?.value || "").trim();
    const channel = button.classList.contains("whatsapp") ? "whatsapp" : "telegram";

    if (!slot || !service || !format) return null;

    const fingerprint = [slot.slotKey, service, format, clientName].join("|");
    return {
      kind: "booking_request_v1",
      booking_id: bookingIdFor(fingerprint),
      source: SOURCE,
      slot_key: slot.slotKey,
      schedule_year: slot.scheduleYear,
      service,
      format,
      client_name: clientName.slice(0, 120),
      channel,
      submitted_at: new Date().toISOString(),
      dry_run: TEST_MODE
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
      status.style.cssText = "margin:14px 0 0;padding:11px 12px;border-radius:10px;font:13px/1.45 Arial,sans-serif;";
      const note = summary.querySelector(".summary-note");
      (note || summary.lastElementChild).insertAdjacentElement("afterend", status);
    }

    const colors = {
      neutral: "background:rgba(255,255,255,.12);color:#fff;",
      success: "background:rgba(183,230,201,.2);color:#fff;",
      error: "background:rgba(255,214,208,.2);color:#fff;"
    };
    status.style.cssText += colors[tone] || colors.neutral;
    status.textContent = message;
  }

  function refreshBookingCopy() {
    const summaryNote = document.querySelector("#booking .summary-note");
    const summaryCopy = "После нажатия заявка фиксируется в расписании как ожидающая подтверждения. Затем откроется сообщение в выбранном мессенджере.";
    if (summaryNote && text(summaryNote) !== summaryCopy) {
      summaryNote.dataset.bookingBridge = "true";
      summaryNote.textContent = summaryCopy;
    }

    const consent = document.querySelector("#booking .consent-row span:last-child");
    const consentCopy = "Я даю отдельное согласие на обработку персональных данных и фиксацию заявки в расписании.";
    if (consent && text(consent) !== consentCopy) {
      consent.dataset.bookingBridge = "true";
      consent.textContent = consentCopy;
    }
  }

  async function sendBooking(payload) {
    if (inFlight.has(payload.booking_id)) return;
    inFlight.add(payload.booking_id);
    storageSet(pendingKey, payload);
    setStatus(TEST_MODE ? "Проверяем маршрут записи без создания заявки…" : "Передаём заявку в расписание…");

    try {
      await window.fetch(WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        credentials: "omit",
        cache: "no-store",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload)
      });
      storageRemove(pendingKey);
      setStatus(
        TEST_MODE
          ? "Тестовый запрос отправлен. Реальная запись, календарь и таблица не изменялись."
          : "Заявка передана. Она появится в расписании как ожидающая подтверждения; затем откроется выбранный мессенджер.",
        "success"
      );
    } catch {
      setStatus("Не удалось передать заявку. Проверьте соединение и нажмите кнопку ещё раз — дубль не будет создан.", "error");
    } finally {
      inFlight.delete(payload.booking_id);
    }
  }

  function retryPendingBooking() {
    const pending = storageGet(pendingKey);
    if (!pending || pending.source !== SOURCE || pending.dry_run) return;
    if (Date.now() - Date.parse(pending.submitted_at) > 15 * 60 * 1000) {
      storageRemove(pendingKey);
      return;
    }
    sendBooking(pending);
  }

  function init() {
    const booking = document.getElementById("booking");
    if (!booking || booking.dataset.bookingBridge) return;
    booking.dataset.bookingBridge = "ready";
    refreshBookingCopy();

    const observer = new MutationObserver(refreshBookingCopy);
    observer.observe(booking, { childList: true, subtree: true, characterData: true });

    document.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest("#booking button.messenger");
        if (!button || button.disabled) return;

        const payload = buildPayload(button);
        if (!payload) return;

        if (TEST_MODE) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        sendBooking(payload);
      },
      true
    );

    window.addEventListener("online", retryPendingBooking);
    retryPendingBooking();
  }

  if (document.readyState === "complete") {
    init();
  } else {
    window.addEventListener("load", init, { once: true });
  }
})();
