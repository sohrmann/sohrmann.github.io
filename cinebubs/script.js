// Configuration
const CINEMAS = [
  {
    id: "blauer-stern",
    name: "Blauer Stern",
    url: "https://www.yorck.de/en/cinemas/blauer-stern",
    color: "#2563eb"
  },
  {
    id: "kino-international",
    name: "Kino International",
    url: "https://www.yorck.de/en/cinemas/kino-international",
    color: "#db2777"
  },
  {
    id: "filmtheater-am-friedrichshain",
    name: "Filmtheater am Friedrichshain",
    url: "https://www.yorck.de/en/cinemas/filmtheater-am-friedrichshain",
    color: "#059669"
  }
];

// App State
let state = {
  movies: [], // Compiled movie data
  filters: {
    cinema: "all",
    date: "all",
    search: "",
    formats: new Set(["OmU", "OV", "OmeU"])
  },
  errors: [] // Array of { cinemaId, message }
};

// --- Initializer & Event Listeners ---
document.addEventListener("DOMContentLoaded", () => {
  initApp();
  registerServiceWorker();
});

async function initApp() {
  setupFilterListeners();
  renderDateTabs();
  await loadCinemaData();
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then(reg => console.log("Service Worker registered successfully"))
        .catch(err => console.error("Service Worker registration failed", err));
    });
  }
}

function setupFilterListeners() {
  // Search Input (Debounced-ish on input)
  const searchInput = document.getElementById("search-input");
  searchInput.addEventListener("input", (e) => {
    state.filters.search = e.target.value;
    renderMovies();
  });

  // Format Chips
  ["omu", "ov", "omeu"].forEach(fmtId => {
    const chip = document.getElementById(`btn-fmt-${fmtId}`);
    if (chip) {
      chip.addEventListener("click", () => {
        const formatValue = chip.getAttribute("data-format");
        if (state.filters.formats.has(formatValue)) {
          // Keep at least one format selected to avoid blank state confusion
          if (state.filters.formats.size > 1) {
            state.filters.formats.delete(formatValue);
            chip.classList.remove("active");
          }
        } else {
          state.filters.formats.add(formatValue);
          chip.classList.add("active");
        }
        renderMovies();
      });
    }
  });

  // Cinema Tabs
  const cinemaTabs = document.querySelectorAll(".cinema-tab");
  cinemaTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      cinemaTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.filters.cinema = tab.getAttribute("data-cinema");
      renderMovies();
    });
  });

  // Reset / Status Action Button
  const statusActionBtn = document.getElementById("status-action-btn");
  if (statusActionBtn) {
    statusActionBtn.addEventListener("click", () => {
      const action = statusActionBtn.getAttribute("data-action");
      if (action === "retry") {
        loadCinemaData();
      } else if (action === "reset-cinema") {
        state.filters.cinema = "all";
        const cinemaTabs = document.querySelectorAll(".cinema-tab");
        cinemaTabs.forEach(tab => {
          if (tab.getAttribute("data-cinema") === "all") tab.classList.add("active");
          else tab.classList.remove("active");
        });
        renderMovies();
      } else {
        resetFilters();
      }
    });
  }
}

function resetFilters() {
  state.filters.cinema = "all";
  state.filters.date = "all";
  state.filters.search = "";
  state.filters.formats = new Set(["OmU", "OV", "OmeU"]);

  // Reset UI elements
  document.getElementById("search-input").value = "";
  
  const formatButtons = document.querySelectorAll(".chip-toggle");
  formatButtons.forEach(btn => btn.classList.add("active"));

  const cinemaTabs = document.querySelectorAll(".cinema-tab");
  cinemaTabs.forEach(tab => {
    if (tab.getAttribute("data-cinema") === "all") {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  const dateTabs = document.querySelectorAll(".date-tab");
  dateTabs.forEach(tab => {
    if (tab.getAttribute("data-date") === "all") {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });

  // Reset custom date picker
  const customLabel = document.getElementById("custom-date-label");
  const customInput = document.getElementById("custom-date-input");
  if (customLabel) customLabel.textContent = "📅 Other Date";
  if (customInput) customInput.value = "";

  renderMovies();
}

// --- Data Fetching & Processing ---

async function loadCinemaData() {
  showSkeletons(true);
  state.errors = [];
  document.getElementById("error-container").classList.add("hidden");
  document.getElementById("error-container").innerHTML = "";

  // Fetch all in parallel
  const fetchPromises = CINEMAS.map(async (cinema) => {
    try {
      const html = await fetchCinemaHtml(cinema.url);
      const jsonData = extractJsonData(html);
      if (!jsonData) throw new Error("Parsed HTML did not contain __NEXT_DATA__");
      
      const filmsSpecials = jsonData?.props?.pageProps?.filmsSpecials || [];
      return { cinemaId: cinema.id, filmsSpecials, success: true };
    } catch (err) {
      return { cinemaId: cinema.id, error: err.message, success: false };
    }
  });

  const results = await Promise.all(fetchPromises);
  
  // Process movie data
  const { movies, errors } = processCinemaData(results);
  state.movies = movies;
  state.errors = errors;

  // Show error alerts if any
  if (state.errors.length > 0) {
    renderErrors();
  }

  showSkeletons(false);
  


  renderMovies();
}

async function fetchCinemaHtml(url) {
  try {
    // Attempt direct fetch
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    console.warn(`Direct fetch failed for ${url}. Attempting CORS proxy fallback...`, err);
    // Fallback using AllOrigins raw proxy
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error(`CORS proxy fallback failed too (HTTP ${res.status})`);
    return await res.text();
  }
}

function extractJsonData(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const nextDataScript = doc.getElementById("__NEXT_DATA__");
  if (!nextDataScript) return null;
  try {
    return JSON.parse(nextDataScript.textContent);
  } catch (err) {
    console.error("JSON parse error:", err);
    return null;
  }
}

function isOmUSession(session) {
  const formats = session?.fields?.formats || [];
  return formats.some(f => ["OmU", "OV", "OmeU"].includes(f));
}

function parseCinemaDate(dateStr) {
  // Extract YYYY, MM, DD, HH, MM as wall-clock values to ignore timezone/DST shifts
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (match) {
    const [_, year, month, day, hour, minute] = match.map(Number);
    return new Date(year, month - 1, day, hour, minute);
  }
  return new Date(dateStr);
}

function findExistingMovie(movieMap, fields) {
  const slug = fields.slug || fields.title;
  if (movieMap.has(slug)) return movieMap.get(slug);

  const titleNorm = (fields.title || "").toLowerCase().trim();
  const rawSessionIds = (fields.sessions || []).map(s => s?.sys?.id).filter(Boolean);

  for (const existingMovie of movieMap.values()) {
    // 1. Match by VistaId
    if (fields.vistaId && existingMovie.vistaId && fields.vistaId === existingMovie.vistaId) {
      return existingMovie;
    }

    // 2. Match by shared raw session IDs
    const sharesSession = rawSessionIds.some(id => existingMovie.rawSessionIds.has(id));
    if (sharesSession) {
      return existingMovie;
    }

    // 3. Match by similar titles (e.g. "Special Screening: Same Sun" vs "Same Sun")
    const existingTitleNorm = existingMovie.title.toLowerCase().trim();
    if (existingTitleNorm && titleNorm) {
      if (existingTitleNorm.includes(titleNorm) || titleNorm.includes(existingTitleNorm)) {
        return existingMovie;
      }
    }
  }

  return null;
}

function processCinemaData(results) {
  const movieMap = new Map();
  const errors = [];

  results.forEach(result => {
    const cinema = CINEMAS.find(c => c.id === result.cinemaId);
    
    if (!result.success) {
      errors.push({
        cinemaId: result.cinemaId,
        cinemaName: cinema.name,
        message: result.error
      });
      return;
    }

    result.filmsSpecials.forEach(film => {
      if (!film || !film.fields) return;

      const fields = film.fields;
      const slug = fields.slug || fields.title;
      
      const existingMovie = findExistingMovie(movieMap, fields);
      let movie;

      if (existingMovie) {
        movie = existingMovie;
        // Merge metadata: prefer the one with VistaId
        if (!movie.vistaId && fields.vistaId) movie.vistaId = fields.vistaId;
        // Keep the cleaner/shorter title (e.g., "Same Sun" instead of "Special Screening: Same Sun")
        if (fields.title && fields.title.length < movie.title.length) {
          movie.title = fields.title;
          movie.slug = fields.slug || movie.slug;
        }
        if (!movie.heroImage && fields.heroImage) movie.heroImage = fields.heroImage;
        if (movie.fsk === null && fields.fsk !== undefined) movie.fsk = fields.fsk;
        if (!movie.mainLabel && fields.mainLabel) movie.mainLabel = fields.mainLabel;
        if (!movie.tagline && fields.tagline) movie.tagline = fields.tagline;
      } else {
        movie = {
          title: fields.title,
          slug: fields.slug,
          vistaId: fields.vistaId || null,
          runtime: fields.runtime,
          mainLabel: fields.mainLabel || "",
          tagline: fields.tagline || "",
          fsk: fields.fsk !== undefined ? fields.fsk : null,
          yorckPick: fields.yorckPick || false,
          heroImage: fields.heroImage || null,
          sessions: [],
          rawSessionIds: new Set()
        };
        movieMap.set(slug, movie);
      }

      // Track all raw session IDs for future deduplication matching
      if (fields.sessions && Array.isArray(fields.sessions)) {
        fields.sessions.forEach(session => {
          if (session?.sys?.id) {
            movie.rawSessionIds.add(session.sys.id);
          }
        });

        // Add sessions to the movie list
        fields.sessions.forEach(session => {
          if (!session || !session.fields) return;

          if (isOmUSession(session)) {
            const parsedStartTime = parseCinemaDate(session.fields.startTime);
            // Deduplicate by cinema and start time
            const sessionExists = movie.sessions.some(s => 
              s.cinemaId === cinema.id && 
              s.startTime.getTime() === parsedStartTime.getTime()
            );
            if (!sessionExists) {
              movie.sessions.push({
                id: session.sys.id,
                startTime: parsedStartTime,
                formats: session.fields.formats || [],
                cinemaId: cinema.id,
                cinemaName: cinema.name
              });
            }
          }
        });
      }
    });
  });

  // Format array, sort sessions chronologically for each movie
  const movies = Array.from(movieMap.values());
  movies.forEach(movie => {
    movie.sessions.sort((a, b) => a.startTime - b.startTime);
  });

  // Filter movies that have at least one valid showtime
  const validMovies = movies.filter(m => m.sessions.length > 0);

  // Sort movies overall by their absolute earliest screening
  validMovies.sort((a, b) => a.sessions[0].startTime - b.sessions[0].startTime);

  return { movies: validMovies, errors };
}

// --- Date Math Utilities ---

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function generateDateList() {
  const dates = [];
  const today = new Date();
  
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(today.getDate() + i);
    const value = getLocalDateString(d);
    
    let label = "";
    if (i === 0) label = "Today";
    else if (i === 1) label = "Tomorrow";
    else label = `${weekdays[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;

    dates.push({ value, label });
  }
  return dates;
}

// --- DOM Rendering ---

function showSkeletons(show) {
  const loader = document.getElementById("skeleton-loader");
  const movieList = document.getElementById("movie-list");
  if (show) {
    loader.classList.remove("hidden");
    movieList.classList.add("hidden");
  } else {
    loader.classList.add("hidden");
    movieList.classList.remove("hidden");
  }
}

function renderDateTabs() {
  const container = document.getElementById("date-scroll-container");
  container.innerHTML = "";

  const dates = generateDateList();

  // "All Dates" tab
  const allTab = document.createElement("button");
  allTab.className = "date-tab active";
  allTab.setAttribute("data-date", "all");
  allTab.textContent = "All Dates";
  allTab.addEventListener("click", () => handleDateTabClick(allTab, "all"));
  container.appendChild(allTab);

  // Dynamic tabs
  dates.forEach(d => {
    const tab = document.createElement("button");
    tab.className = "date-tab";
    tab.setAttribute("data-date", d.value);
    tab.textContent = d.label;
    tab.addEventListener("click", () => handleDateTabClick(tab, d.value));
    container.appendChild(tab);
  });

  // Custom Date Picker tab
  const pickerButton = document.createElement("button");
  pickerButton.className = "date-tab date-picker-tab";
  pickerButton.id = "custom-date-tab";
  pickerButton.type = "button";

  const pickerText = document.createElement("span");
  pickerText.id = "custom-date-label";
  pickerText.textContent = "📅 Other Date";
  pickerButton.appendChild(pickerText);

  const pickerInput = document.createElement("input");
  pickerInput.type = "date";
  pickerInput.id = "custom-date-input";
  pickerInput.min = getLocalDateString(new Date());
  
  pickerInput.addEventListener("change", (e) => {
    const selectedDate = e.target.value;
    if (selectedDate) {
      // Parse the selected date YYYY-MM-DD
      const dateParts = selectedDate.split("-");
      const year = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10) - 1;
      const day = parseInt(dateParts[2], 10);
      const dateObj = new Date(year, month, day);
      
      const formattedDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      pickerText.textContent = `📅 ${formattedDate}`;
      
      const tabs = document.querySelectorAll(".date-tab");
      tabs.forEach(t => t.classList.remove("active"));
      pickerButton.classList.add("active");
      
      state.filters.date = selectedDate;
      renderMovies();
    }
  });

  pickerButton.addEventListener("click", () => {
    if (typeof pickerInput.showPicker === "function") {
      pickerInput.showPicker();
    } else {
      pickerInput.click();
    }
  });

  pickerButton.appendChild(pickerInput);
  container.appendChild(pickerButton);
}

function handleDateTabClick(clickedTab, dateValue) {
  const tabs = document.querySelectorAll(".date-tab");
  tabs.forEach(t => t.classList.remove("active"));
  clickedTab.classList.add("active");

  // Reset custom date picker if a regular tab is clicked
  const customLabel = document.getElementById("custom-date-label");
  const customInput = document.getElementById("custom-date-input");
  if (clickedTab.id !== "custom-date-tab") {
    if (customLabel) customLabel.textContent = "📅 Other Date";
    if (customInput) customInput.value = "";
  }

  state.filters.date = dateValue;
  renderMovies();
}

function renderErrors() {
  const container = document.getElementById("error-container");
  container.innerHTML = "";
  container.classList.remove("hidden");

  state.errors.forEach(err => {
    const item = document.createElement("div");
    item.className = "error-item";
    
    const messageSpan = document.createElement("span");
    messageSpan.innerHTML = `⚠️ <strong>${err.cinemaName}</strong> failed to load: connection timed out.`;

    const retryBtn = document.createElement("button");
    retryBtn.className = "btn-retry";
    retryBtn.textContent = "Retry Connection";
    retryBtn.addEventListener("click", () => loadCinemaData());

    item.appendChild(messageSpan);
    item.appendChild(retryBtn);
    container.appendChild(item);
  });
}

function getFilteredMovies() {
  const { cinema, date, search, formats } = state.filters;

  return state.movies
    .map(movie => {
      // Filter sessions
      const filteredSessions = movie.sessions.filter(session => {
        if (cinema !== "all" && session.cinemaId !== cinema) return false;
        
        if (date !== "all") {
          const sessionDateStr = getLocalDateString(session.startTime);
          if (sessionDateStr !== date) return false;
        }

        const matchesFormat = session.formats.some(f => formats.has(f));
        if (!matchesFormat) return false;

        return true;
      });

      return { ...movie, sessions: filteredSessions };
    })
    .filter(movie => movie.sessions.length > 0)
    .filter(movie => {
      if (!search.trim()) return true;
      const query = search.toLowerCase();
      return movie.title.toLowerCase().includes(query) ||
             movie.mainLabel.toLowerCase().includes(query) ||
             movie.tagline.toLowerCase().includes(query);
    });
}

function renderStatusState(type) {
  const statusState = document.getElementById("status-state");
  const icon = document.getElementById("status-icon");
  const title = document.getElementById("status-title");
  const message = document.getElementById("status-message");
  const actionBtn = document.getElementById("status-action-btn");

  statusState.classList.remove("hidden");
  actionBtn.classList.remove("hidden");

  if (type === "error") {
    icon.textContent = "⚠️";
    title.textContent = "Unable to load showtimes";
    message.textContent = "We encountered a network error while retrieving data from yorck.de. Please check your connection and try again.";
    actionBtn.textContent = "Retry Connection";
    actionBtn.setAttribute("data-action", "retry");
  } else if (type === "no-omu-films") {
    icon.textContent = "🍿";
    title.textContent = "No OmU screenings scheduled";
    const cinemaName = state.filters.cinema === "all" 
      ? "these cinemas" 
      : CINEMAS.find(c => c.id === state.filters.cinema).name;
    message.textContent = `There are currently no original version (OmU, OV, OmeU) screenings scheduled at ${cinemaName} in the next week.`;
    if (state.filters.cinema !== "all") {
      actionBtn.textContent = "Check All Cinemas";
      actionBtn.setAttribute("data-action", "reset-cinema");
    } else {
      actionBtn.classList.add("hidden");
    }
  } else {
    // filter-empty
    icon.textContent = "🎬";
    title.textContent = "No screenings match filters";
    message.textContent = "No showtimes found matching your current filters. Try searching for another movie, adding formats, or checking a different date.";
    actionBtn.textContent = "Reset All Filters";
    actionBtn.setAttribute("data-action", "reset");
  }
}

function renderMovies() {
  const movieList = document.getElementById("movie-list");
  const statusState = document.getElementById("status-state");
  const movies = getFilteredMovies();

  movieList.innerHTML = "";



  if (movies.length === 0) {
    movieList.classList.add("hidden");
    
    // Determine the empty state category
    const activeCinemas = state.filters.cinema === "all" 
      ? CINEMAS 
      : CINEMAS.filter(c => c.id === state.filters.cinema);
    const failedActive = activeCinemas.filter(ac => state.errors.some(err => err.cinemaId === ac.id));
    const allActiveFailed = failedActive.length === activeCinemas.length;

    if (allActiveFailed) {
      renderStatusState("error");
    } else {
      const activeCinemaIds = activeCinemas.map(c => c.id);
      const totalMoviesForActive = state.movies.filter(movie => 
        movie.sessions.some(s => activeCinemaIds.includes(s.cinemaId))
      );
      
      if (totalMoviesForActive.length === 0) {
        renderStatusState("no-omu-films");
      } else {
        renderStatusState("filter-empty");
      }
    }
    return;
  }

  statusState.classList.add("hidden");
  movieList.classList.remove("hidden");

  movies.forEach(movie => {
    const card = createMovieCard(movie);
    movieList.appendChild(card);
  });
}

function createMovieCard(movie) {
  const card = document.createElement("article");
  card.className = "movie-card";

  // 1. Poster
  const posterWrapper = document.createElement("div");
  posterWrapper.className = "movie-poster-wrapper";

  if (movie.yorckPick) {
    const pickBadge = document.createElement("div");
    pickBadge.className = "yorck-pick-badge";
    pickBadge.textContent = "Yorck Pick";
    posterWrapper.appendChild(pickBadge);
  }

  if (movie.heroImage?.fields?.image?.fields?.file?.url) {
    const img = document.createElement("img");
    img.className = "movie-poster";
    img.src = `https:${movie.heroImage.fields.image.fields.file.url}`;
    img.alt = movie.title;
    img.loading = "lazy";
    posterWrapper.appendChild(img);
  } else {
    // SVG Placeholder
    const fallback = document.createElement("div");
    fallback.className = "movie-poster-fallback";
    fallback.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
        <line x1="7" y1="2" x2="7" y2="22"></line>
        <line x1="17" y1="2" x2="17" y2="22"></line>
        <line x1="2" y1="12" x2="22" y2="12"></line>
      </svg>
      <span style="font-size: 0.65rem; font-weight: 700; opacity: 0.6; letter-spacing: 0.05em;">NO POSTER</span>
    `;
    posterWrapper.appendChild(fallback);
  }
  card.appendChild(posterWrapper);

  // 2. Details
  const details = document.createElement("div");
  details.className = "movie-details";

  // Meta Row
  const metaRow = document.createElement("div");
  metaRow.className = "movie-meta-row";

  if (movie.mainLabel) {
    const genreBadge = document.createElement("span");
    genreBadge.className = "badge-meta";
    genreBadge.textContent = movie.mainLabel;
    metaRow.appendChild(genreBadge);
  }

  if (movie.runtime) {
    const runtimeBadge = document.createElement("span");
    runtimeBadge.className = "badge-meta";
    runtimeBadge.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 2px;">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg> ${movie.runtime}m`;
    metaRow.appendChild(runtimeBadge);
  }

  if (movie.fsk !== null) {
    const fskBadge = document.createElement("span");
    fskBadge.className = `fsk-badge fsk-${movie.fsk}`;
    fskBadge.textContent = `FSK ${movie.fsk}`;
    metaRow.appendChild(fskBadge);
  }
  details.appendChild(metaRow);

  // Title
  const title = document.createElement("h3");
  title.className = "movie-title";
  const titleLink = document.createElement("a");
  titleLink.textContent = movie.title;
  titleLink.href = movie.slug ? `https://www.yorck.de/en/films/${movie.slug}` : "#";
  titleLink.target = "_blank";
  titleLink.rel = "noopener";
  title.appendChild(titleLink);
  details.appendChild(title);

  // Tagline
  if (movie.tagline) {
    const tagline = document.createElement("p");
    tagline.className = "movie-tagline";
    tagline.textContent = movie.tagline;
    details.appendChild(tagline);
  }

  // Showtimes Grouped by Cinema
  const showtimesSection = document.createElement("div");
  showtimesSection.className = "movie-showtimes-section";

  // Grouping sessions
  const sessionsByCinema = {};
  movie.sessions.forEach(session => {
    if (!sessionsByCinema[session.cinemaId]) {
      sessionsByCinema[session.cinemaId] = [];
    }
    sessionsByCinema[session.cinemaId].push(session);
  });

  CINEMAS.forEach(cinema => {
    const cinemaSessions = sessionsByCinema[cinema.id];
    if (!cinemaSessions || cinemaSessions.length === 0) return;

    const group = document.createElement("div");
    group.className = "cinema-group";

    const groupTitle = document.createElement("h4");
    groupTitle.className = `cinema-title ${cinema.id}`;
    groupTitle.innerHTML = `<span class="cinema-dot ${cinema.id}"></span>${cinema.name}`;
    group.appendChild(groupTitle);

    const list = document.createElement("div");
    list.className = "showtimes-list";

    cinemaSessions.forEach(session => {
      const pill = document.createElement("a");
      pill.className = `showtime-pill ${cinema.id}-pill`;
      pill.href = `https://www.yorck.de/en/checkout/platzwahl?sessionid=${session.id}`;
      pill.target = "_blank";
      pill.rel = "noopener";

      const timeStr = session.startTime.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit"
      });
      
      const formatsStr = session.formats.join(", ");

      if (state.filters.date === "all") {
        const dayLabel = session.startTime.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
        pill.innerHTML = `
          <span class="pill-date-label">${dayLabel}</span>
          <span class="pill-time-value">${timeStr}</span>
          <span class="format-tag">${formatsStr}</span>
        `;
      } else {
        pill.innerHTML = `
          <span>${timeStr}</span>
          <span class="format-tag">${formatsStr}</span>
        `;
      }
      list.appendChild(pill);
    });

    group.appendChild(list);
    showtimesSection.appendChild(group);
  });

  details.appendChild(showtimesSection);
  card.appendChild(details);

  return card;
}

