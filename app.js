const matches = [
  {
    id: "arsenal-city",
    league: "Premier League",
    country: "England",
    flag: "🇬🇧",
    home: { name: "Arsenal", short: "ARS", color: "#d94b4b", border: "#ff8585", ink: "#fff" },
    away: { name: "Man City", short: "MCI", color: "#75bde7", border: "#a5daf5", ink: "#132f45" },
    homeScore: 1,
    awayScore: 0,
    status: "live",
    minute: 71,
    events: [{ team: "ARS", player: "Kai Havertz", type: "Goal", minute: 38, assist: "Bukayo Saka" }],
    nextGoal: { team: "ARS", player: "Bukayo Saka", assist: "Martin Ødegaard", at: 72 },
    favorite: true,
  },
  {
    id: "liverpool-chelsea",
    league: "Premier League",
    country: "England",
    flag: "🇬🇧",
    home: { name: "Liverpool", short: "LIV", color: "#c63a44", border: "#ef7277", ink: "#fff" },
    away: { name: "Chelsea", short: "CHE", color: "#3476c9", border: "#72a1e5", ink: "#fff" },
    homeScore: 2,
    awayScore: 1,
    status: "live",
    minute: 54,
    events: [
      { team: "LIV", player: "Mohamed Salah", type: "Goal", minute: 17, assist: "Luis Díaz" },
      { team: "CHE", player: "Cole Palmer", type: "Goal", minute: 41, assist: "Nicolas Jackson" },
      { team: "LIV", player: "Darwin Núñez", type: "Goal", minute: 49, assist: "Alexis Mac Allister" },
    ],
    nextGoal: { team: "CHE", player: "Cole Palmer", assist: "Enzo Fernández", at: 58 },
    favorite: false,
  },
  {
    id: "spurs-united",
    league: "Premier League",
    country: "England",
    flag: "🏴",
    home: { name: "Tottenham", short: "TOT", color: "#f0f0ec", border: "#c9cec6", ink: "#283b67" },
    away: { name: "Man United", short: "MUN", color: "#bb3439", border: "#e97373", ink: "#fff" },
    homeScore: 0,
    awayScore: 0,
    status: "live",
    minute: 29,
    events: [],
    favorite: false,
  },
  {
    id: "madrid-barca",
    league: "La Liga",
    country: "Spain",
    flag: "🇪🇸",
    home: { name: "Real Madrid", short: "RMA", color: "#f0eee7", border: "#d4d1c6", ink: "#716243" },
    away: { name: "Barcelona", short: "BAR", color: "#762f73", border: "#a95b91", ink: "#f2c644" },
    homeScore: 2,
    awayScore: 2,
    status: "finished",
    minute: 90,
    events: [
      { team: "RMA", player: "Jude Bellingham", type: "Goal", minute: 22 },
      { team: "BAR", player: "Lamine Yamal", type: "Goal", minute: 36 },
      { team: "BAR", player: "Raphinha", type: "Goal", minute: 61 },
      { team: "RMA", player: "Vinícius Júnior", type: "Goal", minute: 84 },
    ],
    favorite: true,
  },
  {
    id: "inter-milan",
    league: "Serie A",
    country: "Italy",
    flag: "🇮🇹",
    home: { name: "Inter", short: "INT", color: "#285eae", border: "#608cce", ink: "#fff" },
    away: { name: "AC Milan", short: "MIL", color: "#c74848", border: "#e77973", ink: "#fff" },
    status: "upcoming",
    kickoff: "20:45",
    events: [],
    favorite: false,
  },
  {
    id: "bayern-dortmund",
    league: "Bundesliga",
    country: "Germany",
    flag: "🇩🇪",
    home: { name: "Bayern", short: "BAY", color: "#c63d4a", border: "#ee7377", ink: "#fff" },
    away: { name: "Dortmund", short: "BVB", color: "#e8cf42", border: "#f5e784", ink: "#28251b" },
    status: "upcoming",
    kickoff: "21:30",
    events: [],
    favorite: false,
  },
];

const filterButtons = [...document.querySelectorAll(".tab")];
const leagueList = document.querySelector("#league-list");
const searchInput = document.querySelector("#match-search");
const emptyState = document.querySelector("#empty-state");
let activeFilter = "all";
let searchTerm = "";
let selectedDate = dateKey(new Date());
let activeCompetition = "all";

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function selectedDateIsToday() {
  return selectedDate === dateKey(new Date());
}

function badge(team) {
  return `<span class="team-badge" style="--badge-bg:${team.color};--badge-border:${team.border};--badge-fg:${team.ink}" aria-label="${team.name}">${team.short}</span>`;
}

function matchClock(match) {
  if (match.status === "upcoming") {
    return `<span class="match-clock upcoming">KICK-OFF ${match.kickoff}</span>`;
  }
  if (match.status === "finished") {
    return '<span class="match-clock finished"><span class="clock-dot"></span>FT</span>';
  }
  return `<span class="match-clock"><span class="clock-dot"></span>${match.minute}&prime;</span>`;
}

function matchScore(match) {
  if (match.status === "upcoming") return '<span class="score upcoming-score">—<span class="score-separator">:</span>—</span>';
  return `<span class="score">${match.homeScore}<span class="score-separator">:</span>${match.awayScore}</span>`;
}

function matchStatus(match) {
  if (match.status === "upcoming") {
    return `<div class="match-status"><span class="status-label">STARTS IN</span><span class="status-detail">${countdown(match.kickoff)}</span></div>`;
  }
  if (match.status === "finished") {
    return '<div class="match-status"><span class="status-label">FULL TIME</span><span class="status-detail">Match ended</span></div>';
  }
  const recentGoal = match.events.find((event) => event.recent);
  if (recentGoal) {
    return `<div class="match-status live"><span class="status-label">LATEST</span><span class="status-detail event-pop">⚽ ${recentGoal.team} · ${recentGoal.minute}&prime;</span></div>`;
  }
  return `<div class="match-status ${match.status}"><span class="status-label">${match.status === "live" ? "MATCH STATUS" : "MATCH STATUS"}</span><span class="status-detail">${match.status === "live" ? "In play" : "Full time"}</span></div>`;
}

function countdown(kickoff) {
  const [hours, minutes] = kickoff.split(":").map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target < now) target.setDate(target.getDate() + 1);
  const remaining = Math.max(0, Math.floor((target - now) / 60000));
  if (remaining < 60) return `in ${remaining} min`;
  return `in ${Math.floor(remaining / 60)}h ${String(remaining % 60).padStart(2, "0")}m`;
}

function eventMarkup(event) {
  const icon = event.type === "Goal" ? "⚽" : "↔";
  return `<div class="event-row"><span class="event-icon" aria-hidden="true">${icon}</span><span><strong>${event.type} · ${event.team}</strong><span class="event-assist">　${event.player}${event.assist ? ` · ${event.assist}` : ""}</span></span><span class="event-minute">${event.minute}&prime;</span></div>`;
}

function matchMarkup(match) {
  const isExpanded = match.expanded;
  const events = match.events.length
    ? match.events.map(eventMarkup).join("")
    : '<div class="event-row"><span class="event-icon" aria-hidden="true">◷</span><span>Kick-off is on the way</span><span class="event-minute">—</span></div>';
  return `<article class="match${isExpanded ? " expanded" : ""}" data-id="${match.id}">
    <div class="match-main">
      <div class="team home">${badge(match.home)}<div class="team-label"><span class="team-name">${match.home.name}</span><span class="team-meta">${match.home.short}</span></div></div>
      <div class="score-center">${matchScore(match)}${matchClock(match)}</div>
      <div class="team away"><div class="team-label"><span class="team-name">${match.away.name}</span><span class="team-meta">${match.away.short}</span></div>${badge(match.away)}</div>
      ${matchStatus(match)}
      <div class="match-actions">
        <button class="favorite${match.favorite ? " selected" : ""}" type="button" data-action="favorite" aria-label="${match.favorite ? "Remove from" : "Add to"} favorites" aria-pressed="${Boolean(match.favorite)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91L12 3Z"></path></svg>
        </button>
        <button class="expand-button" type="button" data-action="expand" aria-label="${isExpanded ? "Collapse" : "Expand"} ${match.home.name} versus ${match.away.name}" aria-expanded="${Boolean(isExpanded)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
        </button>
      </div>
    </div>
    ${isExpanded ? `<div class="event-list">${events}</div>` : ""}
  </article>`;
}

function isVisible(match) {
  const matchesFilter = activeFilter === "all"
    || (activeFilter === "favorites" ? match.favorite : match.status === activeFilter);
  const query = searchTerm.toLocaleLowerCase();
  const matchesSearch = !query || [match.home.name, match.away.name, match.league, match.home.short, match.away.short]
    .some((value) => value.toLocaleLowerCase().includes(query));
  return selectedDateIsToday()
    && matchesFilter
    && matchesSearch
    && (activeCompetition === "all" || match.league === activeCompetition);
}

function renderDateNavigation() {
  const [year, month, day] = selectedDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = dateKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const label = selectedDate === today
    ? "Today"
    : selectedDate === dateKey(yesterday)
      ? "Yesterday"
      : selectedDate === dateKey(tomorrow)
        ? "Tomorrow"
        : new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
  document.querySelector("#selected-date-label").textContent = label;
  document.querySelector("#selected-date-detail").textContent = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
  document.querySelector("#match-date").value = selectedDate;
}

function renderCompetitionFilters() {
  const competitions = [...new Set(matches.map(({ league }) => league))];
  const options = [["all", "All competitions"], ...competitions.map((league) => [league, league])];
  document.querySelector("#competition-filters").innerHTML = options.map(([id, name]) =>
    `<button class="competition-chip${activeCompetition === id ? " active" : ""}" type="button" data-competition="${id}" aria-pressed="${activeCompetition === id}">${name}</button>`
  ).join("");
}

function render() {
  renderDateNavigation();
  renderCompetitionFilters();
  const visible = matches.filter(isVisible);
  const groups = new Map();
  for (const match of visible) {
    if (!groups.has(match.league)) groups.set(match.league, []);
    groups.get(match.league).push(match);
  }
  leagueList.innerHTML = [...groups.entries()].map(([league, leagueMatches]) => {
    const first = leagueMatches[0];
    return `<section class="league" aria-label="${league}">
      <div class="league-heading"><span class="league-flag" aria-hidden="true">${first.flag}</span><h3>${league}</h3><span>${first.country}</span><span class="league-match-count">${leagueMatches.length} ${leagueMatches.length === 1 ? "MATCH" : "MATCHES"}</span></div>
      ${leagueMatches.map(matchMarkup).join("")}
    </section>`;
  }).join("");
  emptyState.hidden = visible.length > 0;
  document.querySelector("#empty-title").textContent = selectedDateIsToday() ? "No matches found" : "No demo fixtures for this date";
  document.querySelector("#empty-description").textContent = selectedDateIsToday()
    ? "Try another team name or switch match filters."
    : "The sample scoreboard only includes demo matches for today.";

  const dayMatches = selectedDateIsToday() ? matches : [];
  document.querySelector("#all-count").textContent = dayMatches.length;
  document.querySelector("#live-count").textContent = dayMatches.filter(({ status }) => status === "live").length;
  document.querySelector("#favorites-count").textContent = dayMatches.filter(({ favorite }) => favorite).length;
  document.querySelector("#upcoming-count").textContent = dayMatches.filter(({ status }) => status === "upcoming").length;
  document.querySelector("#finished-count").textContent = dayMatches.filter(({ status }) => status === "finished").length;
  document.querySelector("#match-summary").textContent = selectedDateIsToday()
    ? `${dayMatches.filter(({ status }) => status === "live").length} matches in play · scores update automatically`
    : "Browse match dates · sample fixtures are shown for today";
}

function updateDateTime() {
  const now = new Date();
  document.querySelector("#today-date").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(now);
  document.querySelector("#local-time").textContent = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

function advanceMatches() {
  for (const match of matches) {
    if (match.status !== "live") continue;
    match.minute += 1;
    if (match.nextGoal && match.minute >= match.nextGoal.at) {
      const goal = match.nextGoal;
      if (goal.team === match.home.short) match.homeScore += 1;
      else match.awayScore += 1;
      match.events.unshift({
        team: goal.team,
        player: goal.player,
        assist: goal.assist,
        type: "Goal",
        minute: match.minute,
        recent: true,
      });
      match.nextGoal = null;
      window.setTimeout(() => {
        const event = match.events.find((item) => item.recent);
        if (event) delete event.recent;
        render();
      }, 6500);
    }
    if (match.minute >= 90) {
      match.minute = 90;
      match.status = "finished";
    }
  }
  render();
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((tab) => {
      const selected = tab === button;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    render();
  });
});

document.querySelector(".date-navigation").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-day-offset]");
  if (!button) return;
  if (button.dataset.dayOffset === "today") {
    selectedDate = dateKey(new Date());
  } else {
    const [year, month, day] = selectedDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + Number(button.dataset.dayOffset));
    selectedDate = dateKey(date);
  }
  render();
});

document.querySelector("#match-date").addEventListener("change", (event) => {
  if (!event.target.value) return;
  selectedDate = event.target.value;
  render();
});

document.querySelector("#competition-filters").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-competition]");
  if (!button) return;
  activeCompetition = button.dataset.competition;
  render();
});

searchInput.addEventListener("input", () => {
  searchTerm = searchInput.value.trim();
  render();
});

leagueList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const matchElement = button.closest(".match");
  const match = matches.find(({ id }) => id === matchElement.dataset.id);
  if (!match) return;
  if (button.dataset.action === "expand") match.expanded = !match.expanded;
  if (button.dataset.action === "favorite") match.favorite = !match.favorite;
  render();
});

document.querySelector(".theme-button").addEventListener("click", () => {
  document.body.classList.toggle("light-theme");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape" && document.activeElement === searchInput) {
    searchInput.value = "";
    searchInput.blur();
    searchTerm = "";
    render();
  }
});

updateDateTime();
render();
window.setInterval(updateDateTime, 15000);
window.setInterval(advanceMatches, 12000);
