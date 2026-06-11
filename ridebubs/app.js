// State Management
let currentDate = new Date();
// Ensure currentDate starts at 00:00:00 of today in local time
currentDate.setHours(0, 0, 0, 0);

let allSessions = [];
let filteredSessions = [];


// API Configurations
const API_BASE_URL = 'https://readonly-api.momence.com/host-plugins/host/232291/host-schedule/sessions';
const LOCATION_ID = '199943';
const SESSION_TYPES = ['course-class', 'fitness', 'retreat', 'special-event', 'special-event-new'];

// DOM Elements
const dateRangeDisplay = document.getElementById('date-range-display');
const btnPrev = document.getElementById('btn-prev');
const btnToday = document.getElementById('btn-today');
const btnNext = document.getElementById('btn-next');
const loadingIndicator = document.getElementById('loading-indicator');
const errorState = document.getElementById('error-state');
const btnRetry = document.getElementById('btn-retry');
const scheduleColumnsView = document.getElementById('schedule-columns-view');
const brandLogo = document.getElementById('brand-logo');

// Helper: Format date in Europe/Berlin timezone
function getBerlinDateParts(date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  const parts = formatter.formatToParts(date);
  
  const getValue = (type) => parts.find(p => p.type === type).value;
  
  return {
    year: getValue('year'),
    month: getValue('month'), // MM
    day: getValue('day'), // DD
    weekday: getValue('weekday').toUpperCase() // MON, TUE etc
  };
}

// Helper: Get YYYY-MM-DD for Europe/Berlin
function getBerlinDateString(date) {
  const parts = getBerlinDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Helper: Get human-readable date display (e.g., "11 JUN")
function formatHumanDate(date) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const parts = getBerlinDateParts(date);
  const monthIndex = parseInt(parts.month, 10) - 1;
  return `${parts.day} ${months[monthIndex]}`;
}

// Helper: Format time in Europe/Berlin (HH:MM)
function formatBerlinTime(dateStr) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

// Helper: Extract cleaner teacher name (e.g. "Arturo // English" -> "Arturo")
function cleanTeacherName(teacherField) {
  if (!teacherField) return 'Unknown';
  return teacherField.split('//')[0].trim();
}

// Helper: Get booking link with skipPreview parameter appended
function getBookingLink(session) {
  if (!session || !session.link) return '#';
  try {
    const url = new URL(session.link);
    url.searchParams.set('skipPreview', 'true');
    return url.toString();
  } catch (e) {
    return session.link.includes('?') ? `${session.link}&skipPreview=true` : `${session.link}?skipPreview=true`;
  }
}



// Get the 4 dates of the active week starting from currentDate
function getActiveWeekDates() {
  const dates = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(currentDate);
    d.setDate(currentDate.getDate() + i);
    dates.push(d);
  }
  return dates;
}

// Update the Top Date Range Text
function updateDateRangeDisplay() {
  const dates = getActiveWeekDates();
  const start = formatHumanDate(dates[0]);
  const end = formatHumanDate(dates[dates.length - 1]);
  const year = getBerlinDateParts(dates[0]).year;
  dateRangeDisplay.textContent = `${start} — ${end} ${year}`;
}

// Fetch Schedule from Momence API
async function fetchSchedule() {
  showLoading();
  
  // Set start of the day in ISO
  const fromDateISO = currentDate.toISOString();
  
  const url = new URL(API_BASE_URL);
  url.searchParams.append('locationIds[]', LOCATION_ID);
  SESSION_TYPES.forEach(type => {
    url.searchParams.append('sessionTypes[]', type);
  });
  url.searchParams.append('fromDate', fromDateISO);
  url.searchParams.append('pageSize', '100'); // Fetch enough for the week
  url.searchParams.append('page', '0');
  url.searchParams.append('timeZone', 'Europe/Berlin');

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }
    const data = await response.json();
    allSessions = data.payload || [];
    
    // Sort chronologically
    allSessions.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    
    applyFiltersAndRender();
    hideError();
  } catch (error) {
    console.error('Failed to fetch schedule:', error);
    showError();
  } finally {
    hideLoading();
  }
}



// Determine if a session is "Special"
function isSpecialEvent(session) {
  const type = session.type || '';
  const name = (session.sessionName || '').toLowerCase();
  
  // Custom logic: non-fitness/non-course types or has "special" in name
  const isSpecialType = !['fitness', 'course-class'].includes(type);
  const hasSpecialInName = name.includes('special') || name.includes('theme') || name.includes(' x ');
  
  return isSpecialType || hasSpecialInName;
}

// Apply Active Filters & Render
function applyFiltersAndRender() {
  filteredSessions = allSessions.filter(session => {
    // 1. Filter by Date range (only show next 7 days starting from currentDate)
    const sessionDate = new Date(session.startsAt);
    const sessionBerlinStr = getBerlinDateString(sessionDate);
    
    const weekDates = getActiveWeekDates();
    const isInWeek = weekDates.some(d => getBerlinDateString(d) === sessionBerlinStr);
    if (!isInWeek) return false;

    // 1b. Hide rides that have already happened (only on the current actual day)
    const now = new Date();
    const isTodaySession = sessionBerlinStr === getBerlinDateString(now);
    const endsAtTime = session.endsAt ? new Date(session.endsAt) : new Date(session.startsAt);
    if (isTodaySession && endsAtTime < now) {
      return false;
    }
    
    return true;
  });

  renderColumnsView();
}

// Render 7-day Column Grid
function renderColumnsView() {
  scheduleColumnsView.classList.remove('hidden');
  scheduleColumnsView.innerHTML = '';
  const weekDates = getActiveWeekDates();
  const todayStr = getBerlinDateString(new Date());

  // 1. Get sorted list of unique start times across the whole week
  const startTimes = filteredSessions.map(s => formatBerlinTime(s.startsAt));
  const uniqueTimes = Array.from(new Set(startTimes)).sort((a, b) => a.localeCompare(b));

  // 2. Render all headers and classes flat inside the grid container
  weekDates.forEach((date, colIdx) => {
    const colIndex = colIdx + 1; // 1-indexed for CSS Grid column
    const dateStr = getBerlinDateString(date);
    const dateParts = getBerlinDateParts(date);
    const isToday = dateStr === todayStr;
    
    // Create Header Element
    const header = document.createElement('div');
    header.className = `day-header ${isToday ? 'is-today' : ''}`;
    header.style.setProperty('--col-idx', colIndex);
    
    const formattedHeaderDate = formatHumanDate(date);
    header.innerHTML = `
      <div class="day-name">${isToday ? `TODAY (${dateParts.weekday})` : dateParts.weekday}</div>
      <div class="day-date">${formattedHeaderDate}</div>
    `;
    scheduleColumnsView.appendChild(header);
    
    // Filter classes for this day
    const dayClasses = filteredSessions.filter(s => {
      const sDate = new Date(s.startsAt);
      return getBerlinDateString(sDate) === dateStr;
    });
    
    if (dayClasses.length === 0) {
      // Create empty day message block (visible only on mobile stack)
      const noClasses = document.createElement('div');
      noClasses.className = 'no-classes-msg';
      noClasses.style.setProperty('--col-idx', colIndex);
      noClasses.style.setProperty('--row-idx', 2);
      noClasses.textContent = 'No classes scheduled';
      scheduleColumnsView.appendChild(noClasses);
    }
    
    // Render either the class card or merged empty placeholders
    let currentPlaceholderStart = null;
    
    uniqueTimes.forEach((timeStr, timeIdx) => {
      const rowIndex = timeIdx + 2; // +2 offset for headers row
      const session = dayClasses.find(s => formatBerlinTime(s.startsAt) === timeStr);
      
      if (session) {
        // If we were tracking an empty range, render the merged placeholder first
        if (currentPlaceholderStart !== null) {
          const placeholder = document.createElement('div');
          placeholder.className = 'slot-placeholder';
          placeholder.style.setProperty('--col-idx', colIndex);
          placeholder.style.gridRow = `${currentPlaceholderStart} / ${rowIndex}`;
          scheduleColumnsView.appendChild(placeholder);
          currentPlaceholderStart = null;
        }

        const item = document.createElement('a');
        item.href = getBookingLink(session);
        item.target = '_blank';
        item.className = `class-item ${isSpecialEvent(session) ? 'is-special' : ''} ${session.isCancelled ? 'is-cancelled' : ''}`;
        item.style.setProperty('--col-idx', colIndex);
        item.style.setProperty('--row-idx', rowIndex);
        
        item.setAttribute('aria-label', `Book ${session.sessionName} with ${cleanTeacherName(session.teacher)} at ${timeStr}`);
        
        // Spot configuration
        const remaining = session.remainingSpots ? session.remainingSpots.remaining : 0;
        const total = (session.remainingSpots && session.remainingSpots.total) ? session.remainingSpots.total : 33;
        let spotsHtml = '';
        
        if (session.isCancelled) {
          spotsHtml = '<span class="spots-badge spots-full">CANCELLED</span>';
        } else if (remaining === 0) {
          if (session.allowWaitlist && !session.waitlistFull) {
            spotsHtml = '<span class="spots-badge spots-waitlist">WAITLIST</span>';
          } else {
            spotsHtml = '<span class="spots-badge spots-full">FULL</span>';
          }
        } else {
          const occupancy = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0;
          spotsHtml = `
            <div class="spots-progress-bar">
              <div class="spots-progress-fill" style="width: ${occupancy}%;"></div>
              <span class="spots-tooltip">${remaining} spots left</span>
            </div>
          `;
        }

        const isSpecial = isSpecialEvent(session);
        const titlePrefix = isSpecial ? '★ ' : '';
        const teacherNameOnly = cleanTeacherName(session.teacher);

        item.innerHTML = `
          <div class="class-time-row">
            <span class="class-time">${timeStr}</span>
            <span class="class-title" title="${session.sessionName}">${titlePrefix}${session.sessionName}</span>
          </div>
          <div class="class-instructor-row">
            <span class="class-instructor" title="${teacherNameOnly}">${teacherNameOnly}</span>
            ${spotsHtml}
          </div>
        `;

        scheduleColumnsView.appendChild(item);
      } else {
        // Track the start of the empty placeholder range
        if (currentPlaceholderStart === null) {
          currentPlaceholderStart = rowIndex;
        }
      }
    });

    // Commit any trailing empty placeholder range at the end of the day
    if (currentPlaceholderStart !== null) {
      const placeholder = document.createElement('div');
      placeholder.className = 'slot-placeholder';
      placeholder.style.setProperty('--col-idx', colIndex);
      placeholder.style.gridRow = `${currentPlaceholderStart} / ${uniqueTimes.length + 2}`;
      scheduleColumnsView.appendChild(placeholder);
    }
  });
}

// UI State Toggles
function showLoading() {
  loadingIndicator.classList.remove('hidden');
  scheduleColumnsView.classList.add('hidden');
  errorState.classList.add('hidden');
}

function hideLoading() {
  loadingIndicator.classList.add('hidden');
}

// Error handlers
function showError() {
  errorState.classList.remove('hidden');
  scheduleColumnsView.classList.add('hidden');
}

function hideError() {
  errorState.classList.add('hidden');
}

// Event Listeners Setup
function setupEventListeners() {
  // Navigation
  btnPrev.addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() - 4);
    updateDateRangeDisplay();
    fetchSchedule();
  });

  btnNext.addEventListener('click', () => {
    currentDate.setDate(currentDate.getDate() + 4);
    updateDateRangeDisplay();
    fetchSchedule();
  });

  btnToday.addEventListener('click', () => {
    currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    updateDateRangeDisplay();
    fetchSchedule();
  });



  // Retry
  btnRetry.addEventListener('click', fetchSchedule);

  // Logo returns to today
  brandLogo.addEventListener('click', () => {
    currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    updateDateRangeDisplay();
    fetchSchedule();
  });
}

// Initializer
function init() {
  setupEventListeners();
  updateDateRangeDisplay();
  fetchSchedule();
}

// Run app
document.addEventListener('DOMContentLoaded', init);
