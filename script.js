function displayMovies(jsonData) {
  const movieList = document.getElementById("movie-list");
  movieList.innerHTML = "";

  if (
    !jsonData ||
    !jsonData.props ||
    !jsonData.props.pageProps ||
    !jsonData.props.pageProps.filmsSpecials
  ) {
    console.error("Unexpected JSON structure:", jsonData);
    movieList.innerHTML = "<p>Could not load movie data.</p>";
    return;
  }

  const filmsSpecials = jsonData.props.pageProps.filmsSpecials;

  filmsSpecials.forEach((film) => {
    if (film && film.fields && film.fields.sessions) {
      film.fields.sessions.forEach((session) => {
        if (isOmUSession(session)) {
          const movieDiv = createMovieElement(film, session);
          movieList.appendChild(movieDiv);
        }
      });
    }
  });
}

function isOmUSession(session) {
  const formats = session.fields.formats;
  return (
    formats.includes("OmU") ||
    formats.includes("OV") ||
    formats.includes("OmeU")
  );
}

function createMovieElement(film, session) {
  const movieDiv = document.createElement("div");
  movieDiv.className = "movie-item";

  if (film.fields.heroImage) {
    const image = document.createElement("img");
    image.src = `https:${film.fields.heroImage.fields.image.fields.file.url}`;
    image.alt = film.fields.title;
    image.className = "movie-image";
    movieDiv.appendChild(image);
  }

  const movieInfoDiv = document.createElement("div");
  movieInfoDiv.className = "movie-info";

  const title = document.createElement("h3");
  const link = document.createElement("a");
  link.textContent = film.fields.title;
  link.href = `https://www.yorck.de/filme/${film.fields.slug}`;
  link.target = "_blank";
  link.className = "movie-link";
  title.appendChild(link);

  const button = document.createElement("a");
  button.href = `https://www.yorck.de/checkout/platzwahl?sessionid=${session.sys.id}`;
  button.textContent = "Buy Tickets";
  button.target = "_blank";
  button.className = "ticket-button";
  title.appendChild(button);

  movieInfoDiv.appendChild(title);

  const day = document.createElement("p");
  const startTime = new Date(session.fields.startTime);
  const dayOfWeek = getDayOfWeek(startTime.getDay());
  const startDate = startTime.toLocaleDateString("de-DE");

  day.innerHTML = `<span class="label">Date</span> <span class="value">${dayOfWeek}, ${startDate}</span>`;
  movieInfoDiv.appendChild(day);

  const time = document.createElement("p");
  const formattedTime = startTime.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const formattedRuntime = formatRuntime(film.fields.runtime);
  time.innerHTML = `<span class="label">Time</span> <span class="value">${formattedTime} (${formattedRuntime})</span>`;
  movieInfoDiv.appendChild(time);

  movieDiv.appendChild(movieInfoDiv);
  return movieDiv;
}

function getDayOfWeek(dayIndex) {
  const daysOfWeek = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return daysOfWeek[dayIndex];
}

function formatRuntime(runtime) {
  const runtimeHours = Math.floor(runtime / 60);
  const runtimeMinutes = runtime % 60;
  return `${runtimeHours}h ${runtimeMinutes}m`;
}

function extractJsonData(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const nextDataScript = doc.getElementById("__NEXT_DATA__");
  if (nextDataScript) {
    try {
      const jsonData = JSON.parse(nextDataScript.textContent);
      return jsonData;
    } catch (error) {
      console.error("Error parsing JSON:", error);
      return null;
    }
  } else {
    console.error("Could not find __NEXT_DATA__ script tag.");
    return null;
  }
}

fetch("https://www.yorck.de/kinos/blauer-stern")
  .then((response) => response.text())
  .then((html) => {
    const jsonData = extractJsonData(html);
    if (jsonData) {
      displayMovies(jsonData);
    } else {
      const movieList = document.getElementById("movie-list");
      movieList.innerHTML = "<p>Could not load movie data.</p>";
    }
  })
  .catch((error) => {
    console.error("Error fetching HTML:", error);
    const movieList = document.getElementById("movie-list");
    movieList.innerHTML = "<p>Error fetching page.</p>";
  });
