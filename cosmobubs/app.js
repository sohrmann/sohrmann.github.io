/**
 * COSMOBUBS - Zeiss-Großplanetarium Berlin PWA
 * Live schedule, Jahreskarte filter & instant ticket bookings
 */

// API Config
const API_BASE = "https://www.planetarium.berlin";
const DATES_ENDPOINT = `${API_BASE}/rest_event_dates?_format=json`;
const PAGES_ENDPOINT = `${API_BASE}/rest_event_pages?_format=json`;
const TICKET_BASE = "https://tickets.planetarium.berlin/de/Event/Detail?Event=";
const LOCATION_ID = "1"; // Zeiss-Großplanetarium Prenzlauer Berg

// App State
let state = {
  allEvents: [],        // All normalized events for Zeiss-Großplanetarium
  filteredEvents: [],   // Currently filtered events
  filters: {
    annualPassOnly: true, // tickettype=1 by default as requested
    date: "all"
  },
  availableDates: [],   // List of unique upcoming dates
  isLoading: true
};

// DOM Elements
const elements = {
  eventsGrid: document.getElementById("events-grid"),
  loadingState: document.getElementById("loading-state"),
  errorState: document.getElementById("error-state"),
  errorMessage: document.getElementById("error-message"),
  emptyState: document.getElementById("empty-state"),
  btnRetry: document.getElementById("btn-retry"),
  btnRefresh: document.getElementById("btn-refresh"),
  btnResetFilters: document.getElementById("btn-reset-filters"),
  btnEmptyReset: document.getElementById("btn-empty-reset"),
  btnToggleAnnual: document.getElementById("btn-toggle-annual"),
  annualBadgeCount: document.getElementById("annual-badge-count"),
  dateScroller: document.getElementById("date-scroller"),
  btnDatePrev: document.getElementById("btn-date-prev"),
  btnDateNext: document.getElementById("btn-date-next"),
  resultsCount: document.getElementById("results-count"),
  resultsSubtext: document.getElementById("results-subtext"),
  modal: document.getElementById("detail-modal"),
  modalContent: document.getElementById("modal-content"),
  modalCloseBtn: document.getElementById("modal-close-btn")
};

// Lifecycle
document.addEventListener("DOMContentLoaded", () => {
  initApp();
  registerServiceWorker();
});

async function initApp() {
  setupEventListeners();
  await loadData();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((reg) => {
          reg.update();
          console.log("[CosmoBubs] Service Worker registered");
        })
        .catch((err) => console.warn("[CosmoBubs] SW registration error:", err));
    });
  }
}

// Event Listeners
function setupEventListeners() {
  // Annual Pass Toggle
  elements.btnToggleAnnual.addEventListener("click", () => {
    state.filters.annualPassOnly = !state.filters.annualPassOnly;
    elements.btnToggleAnnual.classList.toggle("active", state.filters.annualPassOnly);
    elements.btnToggleAnnual.setAttribute("aria-pressed", state.filters.annualPassOnly.toString());
    updateAnnualToggleLabel();
    renderDateTabs();
    applyFilters();
  });

  // Date scroller navigation buttons
  elements.btnDatePrev.addEventListener("click", () => {
    elements.dateScroller.scrollBy({ left: -240, behavior: "smooth" });
  });
  elements.btnDateNext.addEventListener("click", () => {
    elements.dateScroller.scrollBy({ left: 240, behavior: "smooth" });
  });

  // Reset filter buttons
  elements.btnResetFilters.addEventListener("click", resetFilters);
  elements.btnEmptyReset.addEventListener("click", resetFilters);

  // Refresh & Retry
  elements.btnRefresh.addEventListener("click", () => {
    elements.btnRefresh.classList.add("spinning");
    loadData().finally(() => {
      setTimeout(() => elements.btnRefresh.classList.remove("spinning"), 600);
    });
  });
  elements.btnRetry.addEventListener("click", loadData);

  // Modal close
  elements.modalCloseBtn.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (e) => {
    if (e.target === elements.modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !elements.modal.classList.contains("hidden")) {
      closeModal();
    }
  });
}

function resetFilters() {
  state.filters.date = "all";
  renderDateTabs();
  applyFilters();
}

// Data Fetching
async function loadData() {
  showLoading(true);
  hideError();

  try {
    // Fetch both datasets concurrently
    const [datesRes, pagesRes] = await Promise.all([
      fetch(DATES_ENDPOINT),
      fetch(PAGES_ENDPOINT)
    ]);

    if (!datesRes.ok) throw new Error(`Spielplan-Daten nicht erreichbar (HTTP ${datesRes.status})`);
    if (!pagesRes.ok) throw new Error(`Event-Details nicht erreichbar (HTTP ${pagesRes.status})`);

    const rawDates = await datesRes.json();
    const rawPages = await pagesRes.json();

    processData(rawDates, rawPages);
    showLoading(false);
  } catch (err) {
    console.error("[CosmoBubs] Data fetch failed:", err);
    showLoading(false);
    showError(err.message || "Netzwerkfehler beim Laden des Spielplans");
  }
}

// Process and Normalize Data
function processData(rawDates, rawPages) {
  // Build lookup map for event pages: (event_id, location_id) -> page object
  // Prefer German langcode
  const pageMap = new Map();
  for (const page of rawPages) {
    if (page.field_location_id !== LOCATION_ID) continue;
    if (page.langcode && page.langcode.toLowerCase() === "de") {
      const eventIds = (page.field_event || "").split(",").map((s) => s.trim());
      for (const eid of eventIds) {
        if (eid && !pageMap.has(eid)) {
          pageMap.set(eid, page);
        }
      }
    }
  }

  // Filter dates strictly to Zeiss-Großplanetarium (location_id === 1)
  const now = new Date();
  const zgpDates = rawDates.filter((d) => d.field_location_id === LOCATION_ID);

  const processed = [];

  for (const item of zgpDates) {
    if (!item.field_event_time) continue;

    const eventDate = new Date(item.field_event_time);
    // Ignore events that have already ended (more than 1 hour ago)
    if (eventDate.getTime() + 60 * 60 * 1000 < now.getTime()) {
      continue;
    }

    const eid = (item.field_event || "").trim();
    const page = pageMap.get(eid);

    // Clean title (strip trailing " | Zeiss-Grossplanetarium")
    let rawTitle = page?.title || item.title || "Vorstellung";
    rawTitle = rawTitle.replace(/\s*\|\s*Zeiss-Gro[ßs]+planetarium.*$/i, "").trim();

    // Clean subtitle
    let subtitle = page?.field_subtitle || "";
    if (!subtitle && page?.term_node_tid) {
      subtitle = decodeHtmlEntities(page.term_node_tid).split(",")[0].trim();
    }

    // Room normalization
    let room = page?.field_rooms || item.field_location_extended || "Planetariumssaal";
    let isDome = room.toLowerCase().includes("planetarium");
    let isCinema = room.toLowerCase().includes("kino") || room.toLowerCase().includes("cinema");
    let cleanRoom = isDome ? "Planetariumssaal" : isCinema ? "Kinosaal" : room;

    // Categories
    const categories = [];
    if (page?.term_node_tid) {
      const parts = decodeHtmlEntities(page.term_node_tid).split(",");
      parts.forEach((p) => {
        const c = p.trim();
        if (c && !categories.includes(c)) categories.push(c);
      });
    }

    // Duration
    const durationMins = parseInt(item.field_length_minutes, 10) || 60;
    const endDate = new Date(eventDate.getTime() + durationMins * 60 * 1000);

    // Seat numbers
    const freeSeats = parseInt(item.field_free_seats, 10) || 0;
    const totalSeats = parseInt(item.field_available_seats, 10) || 0;
    const isFreeEntrance = item.field_free_entrance === "1" || page?.field_free_admission === "1";

    // Jahreskarte
    const isAnnualPass = page?.field_annual_pass === "1";

    // Image
    let thumbnail = "";
    if (page?.field_thumbnail) {
      thumbnail = page.field_thumbnail.startsWith("http")
        ? page.field_thumbnail
        : `${API_BASE}${page.field_thumbnail}`;
    }

    // Direct ticket booking URL
    let ticketUrl = "";
    if (item.field_external_ticket_url && typeof item.field_external_ticket_url === "string") {
      ticketUrl = item.field_external_ticket_url;
    } else if (item.field_deeplink_id) {
      ticketUrl = `${TICKET_BASE}${item.field_deeplink_id}`;
    }

    // Event page detail URL on planetarium.berlin
    const detailUrl = page?.view_node ? `${API_BASE}${page.view_node}` : "";

    processed.push({
      id: item.field_deeplink_id || `${eid}-${item.field_event_time}`,
      eventId: eid,
      title: rawTitle,
      subtitle: subtitle,
      datetime: eventDate,
      dateStr: getBerlinDateString(eventDate),
      timeStr: formatTime(eventDate),
      endTimeStr: formatTime(endDate),
      durationMins: durationMins,
      room: cleanRoom,
      isDome: isDome,
      isCinema: isCinema,
      categories: categories,
      isAnnualPass: isAnnualPass,
      freeSeats: freeSeats,
      totalSeats: totalSeats,
      isFreeEntrance: isFreeEntrance,
      thumbnail: thumbnail,
      ageLimit: page?.field_age_limit ? `ab ${page.field_age_limit} J.` : "",
      ticketUrl: ticketUrl,
      detailUrl: detailUrl,
      rawItem: item,
      rawPage: page
    });
  }

  // Sort chronologically
  processed.sort((a, b) => a.datetime - b.datetime);

  state.allEvents = processed;

  updateAnnualToggleLabel();
  renderDateTabs();
  applyFilters();
}

// Date helpers
function getBerlinDateString(date) {
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
  return d; // YYYY-MM-DD
}

function formatTime(date) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDisplayDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(date);
}

function decodeHtmlEntities(str) {
  const txt = document.createElement("textarea");
  txt.innerHTML = str;
  return txt.value;
}

// Update Annual Pass Toggle Label
function updateAnnualToggleLabel() {
  const totalCount = state.allEvents.length;
  const annualCount = state.allEvents.filter((e) => e.isAnnualPass).length;

  if (state.filters.annualPassOnly) {
    elements.annualBadgeCount.textContent = `Aktiv (${annualCount} Shows)`;
  } else {
    elements.annualBadgeCount.textContent = `Alle (${totalCount} Shows)`;
  }
}

// Render Date Tabs
function renderDateTabs() {
  // Get pool of events matching current Annual Pass filter
  const candidateEvents = state.allEvents.filter((e) => {
    if (state.filters.annualPassOnly && !e.isAnnualPass) return false;
    return true;
  });

  // Group by dateStr and count
  const dateCounts = new Map();
  for (const ev of candidateEvents) {
    dateCounts.set(ev.dateStr, (dateCounts.get(ev.dateStr) || 0) + 1);
  }

  const sortedDates = Array.from(dateCounts.keys()).sort();
  state.availableDates = sortedDates;

  // Build HTML
  let html = `
    <button class="date-tab ${state.filters.date === "all" ? "active" : ""}" data-date="all">
      <span class="date-day-label">ALLE</span>
      <span class="date-number">Alle</span>
      <span class="date-count-badge">${candidateEvents.length} Shows</span>
    </button>
  `;

  const todayStr = getBerlinDateString(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = getBerlinDateString(tomorrow);

  for (const dateStr of sortedDates) {
    const count = dateCounts.get(dateStr);
    const isToday = dateStr === todayStr;
    const isTomorrow = dateStr === tomorrowStr;

    const [y, m, d] = dateStr.split("-").map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

    let dayLabel = new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(dateObj).toUpperCase();
    if (isToday) dayLabel = "HEUTE";
    else if (isTomorrow) dayLabel = "MORGEN";

    const dayNum = `${d}. ${new Intl.DateTimeFormat("de-DE", { month: "short" }).format(dateObj)}`;

    html += `
      <button class="date-tab ${state.filters.date === dateStr ? "active" : ""}" data-date="${dateStr}">
        <span class="date-day-label">${dayLabel}</span>
        <span class="date-number">${dayNum}</span>
        <span class="date-count-badge">${count} Shows</span>
      </button>
    `;
  }

  elements.dateScroller.innerHTML = html;

  // Add click listeners to date tabs
  elements.dateScroller.querySelectorAll(".date-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      elements.dateScroller.querySelectorAll(".date-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.filters.date = tab.getAttribute("data-date");
      applyFilters();
    });
  });
}

// Filter and Render
function applyFilters() {
  const { annualPassOnly, date } = state.filters;

  const results = state.allEvents.filter((ev) => {
    // Jahreskarte filter (tickettype=1)
    if (annualPassOnly && !ev.isAnnualPass) return false;

    // Date filter
    if (date !== "all" && ev.dateStr !== date) return false;

    return true;
  });

  state.filteredEvents = results;
  renderEvents();
}

function formatGroupHeader(dateStr) {
  const todayStr = getBerlinDateString(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = getBerlinDateString(tomorrow);

  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  const weekdayShort = new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(dateObj).toUpperCase();
  const fullDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long" }).format(dateObj);

  let prefix = weekdayShort;
  if (dateStr === todayStr) prefix = "HEUTE";
  else if (dateStr === tomorrowStr) prefix = "MORGEN";

  return {
    prefix,
    dateText: fullDate,
    isToday: dateStr === todayStr,
    isTomorrow: dateStr === tomorrowStr
  };
}

// Render Event Cards
function renderEvents() {
  const count = state.filteredEvents.length;
  const isFiltered = state.filters.date !== "all";

  elements.btnResetFilters.classList.toggle("hidden", !isFiltered);

  // Status Summary
  let countText = `${count} Vorstellung${count === 1 ? "" : "en"}`;
  if (state.filters.date !== "all") {
    countText += ` am ${formatDisplayDate(state.filters.date)}`;
  }
  elements.resultsCount.textContent = countText;

  let subText = "";
  if (state.filters.annualPassOnly) {
    subText = "⭐ Nur Vorstellungen mit Jahreskarte";
  } else {
    subText = "Alle Vorstellungen (inkl. Sonderveranstaltungen)";
  }
  elements.resultsSubtext.textContent = subText;

  if (count === 0) {
    elements.eventsGrid.innerHTML = "";
    elements.emptyState.classList.remove("hidden");
    return;
  }

  elements.emptyState.classList.add("hidden");

  let cardsHtml = "";

  if (state.filters.date === "all") {
    // Group events by dateStr for static day dividers (like ridebubs)
    const groups = new Map();
    state.filteredEvents.forEach((ev, index) => {
      if (!groups.has(ev.dateStr)) {
        groups.set(ev.dateStr, []);
      }
      groups.get(ev.dateStr).push({ ev, index });
    });

    for (const [dateStr, items] of groups.entries()) {
      const headerInfo = formatGroupHeader(dateStr);
      const modifierClass = headerInfo.isToday ? "is-today" : headerInfo.isTomorrow ? "is-tomorrow" : "";

      cardsHtml += `
        <div class="day-divider ${modifierClass}">
          <div class="day-divider-left">
            <span class="day-divider-prefix">${headerInfo.prefix}</span>
            <span class="day-divider-sep">•</span>
            <span class="day-divider-date">${headerInfo.dateText}</span>
          </div>
          <span class="day-divider-count">${items.length} ${items.length === 1 ? "Show" : "Shows"}</span>
        </div>
      `;

      cardsHtml += items.map(({ ev, index }) => renderEventCard(ev, index)).join("");
    }
  } else {
    cardsHtml = state.filteredEvents
      .map((ev, index) => renderEventCard(ev, index))
      .join("");
  }

  elements.eventsGrid.innerHTML = cardsHtml;

  // Attach modal trigger listeners
  elements.eventsGrid.querySelectorAll('[data-action="open-detail"]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute("data-index"), 10);
      openModal(state.filteredEvents[idx]);
    });
  });
}

// Single Event Card Generator
function renderEventCard(ev, index) {
  // Seat availability logic
  const isSoldOut = ev.totalSeats > 0 && ev.freeSeats === 0;
  const isLow = ev.totalSeats > 0 && (ev.freeSeats <= 20 || ev.freeSeats / ev.totalSeats < 0.15);

  let seatStatusClass = "available";
  let seatStatusLabel = `🟢 ${ev.freeSeats} frei`;

  if (ev.isFreeEntrance) {
    seatStatusClass = "free-entrance";
    seatStatusLabel = "🎟️ Freier Eintritt";
  } else if (isSoldOut) {
    seatStatusClass = "soldout";
    seatStatusLabel = "🔴 Ausverkauft";
  } else if (isLow) {
    seatStatusClass = "low";
    seatStatusLabel = `🟡 Noch ${ev.freeSeats} Plätze`;
  }

  const thumbUrl =
    ev.thumbnail ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'%3E%3Crect width='100%25' height='100%25' fill='%230f1429'/%3E%3Ctext x='50%25' y='55%25' dominant-baseline='middle' text-anchor='middle' font-size='36'%3E🪐%3C/text%3E%3C/svg%3E";

  return `
    <article class="event-card ${ev.isAnnualPass ? "card-annual-pass" : ""}" data-index="${index}">
      <!-- Compact Thumbnail -->
      <div class="card-thumb-col" data-action="open-detail" data-index="${index}">
        <img 
          src="${thumbUrl}" 
          alt="${escapeHtml(ev.title)}" 
          class="card-thumb" 
          loading="lazy" 
          onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\' viewBox=\\'0 0 100 100\\'%3E%3Crect width=\\'100%25\\' height=\\'100%25\\' fill=\\'%230f1429\\'/ %3E%3Ctext x=\\'50%25\\' y=\\'55%25\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\' font-size=\\'36\\'%3E🪐%3C/text%3E%3C/svg%3E'"
        />
        ${ev.isAnnualPass ? `<span class="badge-star-mini" title="Jahreskarte">⭐</span>` : ""}
      </div>

      <!-- Main Info Column (Clickable to open modal) -->
      <div class="card-main-col" data-action="open-detail" data-index="${index}">
        <div class="card-top-line">
          <span class="card-time">${ev.timeStr}</span>
          <span class="card-duration">${ev.durationMins}m</span>
        </div>

        <h3 class="card-title" title="${escapeHtml(ev.title)}">${escapeHtml(ev.title)}</h3>
        ${ev.subtitle ? `<p class="card-subtitle">${escapeHtml(ev.subtitle)}</p>` : ""}

        <div class="card-bottom-line">
          <span class="seats-status ${seatStatusClass}">${seatStatusLabel}</span>
        </div>
      </div>

      <!-- Compact Action Column -->
      <div class="card-action-col">
        ${
          isSoldOut
            ? `<span class="btn-book-compact sold-out" title="Ausverkauft">Voll</span>`
            : `<a href="${ev.ticketUrl}" target="_blank" rel="noopener" class="btn-book-compact" title="Tickets buchen">
                <span>Tickets</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                </svg>
              </a>`
        }
      </div>
    </article>
  `;
}

// Modal Detail View
function openModal(ev) {
  if (!ev) return;

  const isSoldOut = ev.totalSeats > 0 && ev.freeSeats === 0;
  const thumbUrl =
    ev.thumbnail ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='338' viewBox='0 0 600 338'%3E%3Crect width='100%25' height='100%25' fill='%230f1429'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='64'%3E🪐%3C/text%3E%3C/svg%3E";

  elements.modalContent.innerHTML = `
    <img src="${thumbUrl}" alt="${escapeHtml(ev.title)}" class="modal-poster" />
    <div class="modal-inner">
      <div class="modal-badges">
        ${ev.isAnnualPass ? `<span class="badge-annual">⭐ JAHRESKARTE INKLUSIVE</span>` : ""}
        <span class="badge-room ${ev.isDome ? "dome" : "cinema"}">${ev.isDome ? "🌌 Kuppelsaal" : "🎬 Kinosaal"}</span>
        ${ev.ageLimit ? `<span class="badge-pill">${escapeHtml(ev.ageLimit)}</span>` : ""}
        <span class="badge-pill">⏱️ ${ev.durationMins} Minuten</span>
      </div>

      <div>
        <h2 class="modal-title" id="modal-title">${escapeHtml(ev.title)}</h2>
        ${ev.subtitle ? `<p class="modal-subtitle">${escapeHtml(ev.subtitle)}</p>` : ""}
      </div>

      <div class="modal-grid-details">
        <div class="detail-item">
          <span class="detail-label">Datum</span>
          <span class="detail-val">${formatDisplayDate(ev.dateStr)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Uhrzeit</span>
          <span class="detail-val">${ev.timeStr} – ${ev.endTimeStr} Uhr</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Saal / Ort</span>
          <span class="detail-val">${escapeHtml(ev.room)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Freie Plätze</span>
          <span class="detail-val ${ev.freeSeats === 0 ? "text-danger" : ""}">
            ${ev.isFreeEntrance ? "Freier Eintritt" : `${ev.freeSeats} von ${ev.totalSeats}`}
          </span>
        </div>
      </div>

      ${
        ev.categories.length > 0
          ? `
        <div>
          <span class="detail-label">Kategorien</span>
          <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
            ${ev.categories.map((c) => `<span class="chip" style="pointer-events:none;">${escapeHtml(c)}</span>`).join("")}
          </div>
        </div>
      `
          : ""
      }

      <div class="modal-footer-actions">
        ${
          isSoldOut
            ? `<button class="btn-book sold-out" disabled style="width:100%;">Vorstellung ausverkauft</button>`
            : `<a href="${ev.ticketUrl}" target="_blank" rel="noopener" class="btn-book" style="width:100%;">
                <span>Tickets bei Beckerbillett buchen ↗</span>
              </a>`
        }
        ${
          ev.detailUrl
            ? `<a href="${ev.detailUrl}" target="_blank" rel="noopener" class="btn-info" title="Programmseite öffnen">
                Website ↗
              </a>`
            : ""
        }
      </div>
    </div>
  `;

  elements.modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  elements.modal.classList.add("hidden");
  document.body.style.overflow = "";
}

// UI State Toggles
function showLoading(show) {
  state.isLoading = show;
  elements.loadingState.classList.toggle("hidden", !show);
  if (show) {
    elements.eventsGrid.classList.add("hidden");
    elements.emptyState.classList.add("hidden");
    elements.errorState.classList.add("hidden");
  } else {
    elements.eventsGrid.classList.remove("hidden");
  }
}

function showError(msg) {
  elements.errorMessage.textContent = msg;
  elements.errorState.classList.remove("hidden");
  elements.eventsGrid.classList.add("hidden");
  elements.emptyState.classList.add("hidden");
}

function hideError() {
  elements.errorState.classList.add("hidden");
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
