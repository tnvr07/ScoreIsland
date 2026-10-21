const API_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/all";
const REFRESH_INTERVAL = 60_000;
const LIVE_REFRESH_INTERVAL = 15_000;
const SEARCH_DEBOUNCE = 180;
const ESPN_LEAGUES = {
  "650": "Colombian Primera A",
  "700": "Premier League",
  "740": "LaLiga",
  "725": "Serie A",
  "720": "Bundesliga",
  "600": "Ligue 1",
  "775": "UEFA Champions League",
  "766": "UEFA Europa League",
  "768": "UEFA Conference League",
  "760": "Liga MX",
  "21231": "Saudi Pro League",
  "22947": "Concacaf Central American Cup",
  "23284": "Copa Bolivia",
  "23480": "English FA Cup Qualifying",
  "23541": "Liga MX Femenil",
  "18000": "CAF Confederation Cup",
  "20865": "FIFA U-17 Women's World Cup",
  "3914": "EFL Championship",
  "3915": "EFL League One",
  "3916": "EFL League Two",
  "3928": "Guatemalan Liga Nacional",
  "3940": "Scottish Championship",
  "4007": "Brazilian Serie B",
  "5454": "Copa Sudamericana",
  "5487": "NCAA Men's Soccer",
  "8312": "Copa Chile",
};
const TEAM_COLORS = ["#d94b4b", "#3678bd", "#d9b53c", "#457a62", "#7850a3", "#c46d39"];
const listElement = document.querySelector("#match-list");
const competitionListElement = document.querySelector("#competition-list");
const searchInput = document.querySelector("#match-search");
const datePicker = document.querySelector("#date-picker");
const detailElement = document.querySelector("#detail-content");
const detailEmptyElement = document.querySelector("#detail-empty");
const matchCache = new Map();
const detailCache = new Map();
const currentDate = new Date();
const competitionSearchInput = document.querySelector("#competition-search");
let selectedDate;
let matches = [];
let liveScoreMatches = [];
let selectedMatchId;
let activeStatus;
let activeCompetition;
let searchTerm = "";
let competitionSearchTerm = "";
let requestInProgress = false;
let scoreRequestController = null;
let selectedDetailTab = "overview";
let selectedEventFilter = "all";
let toastTimeout = 0;
let searchTimeout = 0;
let refreshTimeout = 0;
let hasAutoSelectedMatch = false;
let lastSuccessfulFetchAt = null;
let lastScoreSnapshot = new Map();
const flashedMatchIds = new Set();

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toApiDate(value) {
  return value.replaceAll("-", "");
}

function readRouteState() {
  const params = new URLSearchParams(window.location.search);
  const date = params.get("date");
  const status = params.get("status");
  const parsedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? fromDateKey(date) : null;
  const validDate = parsedDate && toDateKey(parsedDate) === date;
  return {
    date: validDate
      ? date
      : toDateKey(new Date()),
    status: ["all", "live", "pre", "post", "favorites", "broadcast"].includes(status) ? status : "all",
    competition: params.get("comp") || "all",
    match: params.get("match") || "",
  };
}

const initialRouteState = readRouteState();
selectedDate = initialRouteState.date;
selectedMatchId = initialRouteState.match || null;
activeStatus = initialRouteState.status;
activeCompetition = initialRouteState.competition;

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function savedFavorites() {
  let saved;
  try {
    saved = localStorage.getItem("touchline-favorites");
  } catch (error) {
    console.error("Browser storage is unavailable; match favorites will not persist.", error);
    return new Set();
  }
  if (!saved) return new Set();
  try {
    const ids = JSON.parse(saved);
    if (Array.isArray(ids)) return new Set(ids.filter((id) => typeof id === "string"));
    throw new Error("Saved favorites must be a list of match IDs.");
  } catch (error) {
    console.error("Could not read saved match favorites.", error);
    try {
      localStorage.removeItem("touchline-favorites");
    } catch (storageError) {
      console.error("Could not clear invalid saved favorites.", storageError);
    }
    return new Set();
  }
}

const favorites = savedFavorites();
const themeButton = document.querySelector("#theme-button");
const themeMenu = document.querySelector("#theme-menu");
const themeOptions = [...themeMenu.querySelectorAll("[data-theme-choice]")];
const THEME_NAMES = { aurora: "Aurora", neon: "Neon", light: "Daylight" };

function savedTheme() {
  try {
    const theme = localStorage.getItem("touchline-theme");
    return Object.hasOwn(THEME_NAMES, theme) ? theme : "aurora";
  } catch (error) {
    console.error("Browser storage is unavailable; the color theme will not persist.", error);
    return "aurora";
  }
}

function applyTheme(theme) {
  document.body.classList.toggle("light-theme", theme === "light");
  document.body.classList.toggle("neon-theme", theme === "neon");
  document.querySelector('meta[name="theme-color"]').content = theme === "light" ? "#f1f5f1" : theme === "neon" ? "#100f22" : "#071117";
  themeButton.querySelector(".theme-current").textContent = THEME_NAMES[theme];
  themeButton.setAttribute("aria-label", `Color theme: ${THEME_NAMES[theme]}`);
  themeButton.title = `Color theme: ${THEME_NAMES[theme]}`;
  themeOptions.forEach((option) => option.setAttribute("aria-checked", String(option.dataset.themeChoice === theme)));
  try {
    localStorage.setItem("touchline-theme", theme);
  } catch (error) {
    console.error("Could not save the selected color theme.", error);
  }
}

function setThemeMenuOpen(open, focusFirst = false) {
  themeMenu.hidden = !open;
  themeButton.setAttribute("aria-expanded", String(open));
  if (open && focusFirst) themeOptions.find((option) => option.getAttribute("aria-checked") === "true")?.focus();
}

applyTheme(savedTheme());

function setFeedStatus(state, text) {
  const element = document.querySelector("#feed-status");
  element.className = `feed-status ${state}`;
  document.querySelector("#feed-status-text").textContent = text;
  element.title = state === "connected"
    ? "Score feed connected"
    : state === "loading"
      ? "Updating match scores"
      : text;
}

function localTimeZoneLabel() {
  return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value || "local";
}

function timeLabel(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "Time TBC";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function syncUrlState({ push = false } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set("date", selectedDate);
  if (activeStatus === "all") url.searchParams.delete("status");
  else url.searchParams.set("status", activeStatus);
  if (activeCompetition === "all") url.searchParams.delete("comp");
  else url.searchParams.set("comp", activeCompetition);
  if (selectedMatchId) url.searchParams.set("match", selectedMatchId);
  else url.searchParams.delete("match");
  const method = push ? "pushState" : "replaceState";
  window.history[method]({ touchline: true, touchlineMatch: push && Boolean(selectedMatchId) }, "", url);
}

function scoreSnapshot(match) {
  return `${match.home.score ?? "—"}:${match.away.score ?? "—"}`;
}

function flashScoreUpdate(match) {
  flashedMatchIds.add(match.id);
  window.setTimeout(() => {
    flashedMatchIds.delete(match.id);
    document.querySelectorAll(`[data-score-match="${CSS.escape(match.id)}"]`).forEach((element) => {
      element.classList.remove("score-updated");
    });
  }, 1400);
}

function announceScoreChanges(nextMatches) {
  const announcements = [];
  for (const match of nextMatches) {
    const nextScore = scoreSnapshot(match);
    const previousScore = lastScoreSnapshot.get(match.id);
    if (previousScore && previousScore !== nextScore && match.state === "in") {
      flashScoreUpdate(match);
      announcements.push(`${match.home.name} ${match.home.score}, ${match.away.name} ${match.away.score}`);
    }
    lastScoreSnapshot.set(match.id, nextScore);
  }
  if (announcements.length) {
    document.querySelector("#score-announcer").textContent = `Score update: ${announcements.join("; ")}`;
  }
}

function getCompetitionInfo(event) {
  const competition = event.competitions?.[0] ?? {};
  const uid = event.uid ?? competition.uid ?? "";
  const leagueId = uid.match(/~l:(\d+)~/)?.[1] ?? "";
  const rawLabel = competition.altGameNote || ESPN_LEAGUES[leagueId] || "";
  const parts = rawLabel.split(",").map((part) => part.trim()).filter(Boolean);
  let name = parts.shift() || "Other competitions";
  if (name === "NCAAM Soccer") name = "NCAA Men's Soccer";
  if (/u-17 wwc/i.test(name)) name = "FIFA U-17 Women's World Cup";
  const stage = parts.join(" · ");
  return { id: leagueId || name, name, stage };
}

function normalizeTeam(competitor, side) {
  const team = competitor.team ?? {};
  const initials = team.abbreviation || team.shortDisplayName || team.displayName || "?";
  const fallbackColor = TEAM_COLORS[(Number(team.id) || side) % TEAM_COLORS.length];
  const teamColor = /^[\da-f]{6}$/i.test(team.color ?? "") ? `#${team.color}` : fallbackColor;
  return {
    id: team.id ?? "",
    name: team.displayName || team.name || "TBC",
    shortName: team.shortDisplayName || team.abbreviation || team.displayName || "TBC",
    abbreviation: team.abbreviation || initials.slice(0, 3).toUpperCase(),
    score: competitor.score ?? null,
    winner: Boolean(competitor.winner),
    loser: false,
    logo: team.logo || team.logos?.[0]?.href || "",
    color: teamColor,
    record: competitor.records?.find((record) => record.type === "total")?.summary || "",
  };
}

function normalizeMatch(event) {
  const competition = event.competitions?.[0] ?? {};
  const competitors = competition.competitors ?? [];
  const home = competitors.find((competitor) => competitor.homeAway === "home") ?? competitors[0] ?? {};
  const away = competitors.find((competitor) => competitor.homeAway === "away") ?? competitors[1] ?? {};
  const { id: competitionId, name: competitionName, stage } = getCompetitionInfo(event);
  const state = competition.status?.type?.state || event.status?.type?.state || "pre";
  const homeTeam = normalizeTeam(home, 0);
  const awayTeam = normalizeTeam(away, 1);
  if (homeTeam.winner) awayTeam.loser = true;
  if (awayTeam.winner) homeTeam.loser = true;
  return {
    id: String(event.id),
    uid: event.uid ?? "",
    name: event.name ?? "Football match",
    date: competition.date || event.date || "",
    state,
    status: competition.status?.type?.shortDetail
      || competition.status?.type?.detail
      || competition.status?.displayClock
      || "Scheduled",
    displayClock: competition.status?.displayClock || "",
    period: competition.status?.period || 0,
    leagueId: competitionId,
    league: competitionName,
    stage,
    home: homeTeam,
    away: awayTeam,
    venue: competition.venue?.fullName || event.venue?.fullName || "",
    city: competition.venue?.address?.city || "",
    country: competition.venue?.address?.country || "",
    attendance: competition.attendance || 0,
    broadcasts: (competition.broadcasts ?? []).flatMap((broadcast) => broadcast.names ?? []),
    hasBroadcast: (competition.broadcasts ?? []).some((broadcast) => (broadcast.names ?? []).length > 0)
      || (competition.geoBroadcasts ?? []).length > 0,
    favorite: favorites.has(String(event.id)),
  };
}

function dateButtonMarkup(date, offset) {
  const key = toDateKey(date);
  const todayKey = toDateKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isToday = key === todayKey;
  const isTomorrow = key === toDateKey(tomorrow);
  const weekday = isToday
    ? "Today"
    : isTomorrow
      ? "Tomorrow"
      : new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
  return `<button class="date-choice${key === selectedDate ? " selected" : ""}" type="button" data-date="${key}" aria-pressed="${key === selectedDate}"${offset === null ? "" : ` data-offset="${offset}"`}>
    <span>${weekday}</span><strong>${monthDay}</strong>
  </button>`;
}

function renderDates() {
  const baseDate = fromDateKey(selectedDate);
  const dates = [];
  for (let offset = -3; offset <= 3; offset += 1) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + offset);
    dates.push(dateButtonMarkup(date, offset));
  }
  document.querySelector("#date-strip").innerHTML = dates.join("");
  datePicker.value = selectedDate;
}

function renderCompetitionFilters() {
  const groups = new Map();
  for (const match of matches) {
    const existing = groups.get(match.league) ?? { count: 0, live: 0 };
    existing.count += 1;
    if (match.state === "in") existing.live += 1;
    groups.set(match.league, existing);
  }
  const options = [...groups.entries()]
    .filter(([name]) => !competitionSearchTerm || name.toLocaleLowerCase().includes(competitionSearchTerm))
    .sort((a, b) => compareCompetitionPriority(a[0], b[0]) || a[0].localeCompare(b[0]));
  const renderOption = ([name, info]) => `
    <button class="competition-option${activeCompetition === name ? " selected" : ""}" type="button" data-competition="${escapeHTML(name)}" aria-pressed="${activeCompetition === name}">
      <span class="competition-icon" aria-hidden="true">${competitionIcon(name)}</span>
      <span class="competition-option-label">${escapeHTML(name)}${info.live ? '<span class="competition-live-dot"></span>' : ""}</span>
      <span class="competition-count">${info.count}</span>
    </button>`;
  const topLeagues = options.filter(([name]) => TOP_COMPETITIONS.includes(name));
  const otherLeagues = options.filter(([name]) => !TOP_COMPETITIONS.includes(name));
  competitionListElement.innerHTML = `${topLeagues.length ? `<div class="competition-group-label">TOP LEAGUES</div>${topLeagues.map(renderOption).join("")}` : ""}
    ${otherLeagues.length ? `<div class="competition-group-label">MORE COMPETITIONS</div>${otherLeagues.map(renderOption).join("")}` : ""}
    ${options.length ? "" : '<p class="competition-search-empty">No competitions found.</p>'}`;
  const allOption = document.querySelector('[data-competition="all"]');
  allOption.classList.toggle("selected", activeCompetition === "all");
  allOption.setAttribute("aria-pressed", String(activeCompetition === "all"));
  document.querySelector("#all-count").textContent = matches.length;
  const activeCount = Number(activeStatus !== "all") + Number(activeCompetition !== "all") + Number(Boolean(searchTerm));
  document.querySelector("#active-filter-count").textContent = `${activeCount} ${activeCount === 1 ? "filter" : "filters"}`;
  document.querySelector("#clear-filters").disabled = activeCount === 0;
}

const TOP_COMPETITIONS = [
  "Premier League",
  "UEFA Champions League",
  "LaLiga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "UEFA Europa League",
  "UEFA Conference League",
];

function competitionIcon(name) {
  if (/^uefa (?:champions|europa|conference) league/i.test(name)) return "✦";
  if (/caf/i.test(name)) return "🌍";
  if (/premier league|english fa cup|efl|scottish|spfl/i.test(name)) return "🇬🇧";
  if (/laliga/i.test(name)) return "🇪🇸";
  if (/copa chile/i.test(name)) return "🇨🇱";
  if (/serie a/i.test(name)) return "🇮🇹";
  if (/bundesliga/i.test(name)) return "🇩🇪";
  if (/ligue 1/i.test(name)) return "🇫🇷";
  if (/liga mx/i.test(name)) return "🇲🇽";
  if (/saudi/i.test(name)) return "🇸🇦";
  if (/colombian/i.test(name)) return "🇨🇴";
  if (/copa bolivia/i.test(name)) return "🇧🇴";
  if (/brazilian/i.test(name)) return "🇧🇷";
  if (/sudamericana|concacaf|guatemalan/i.test(name)) return "🌎";
  if (/ncaa/i.test(name)) return "🇺🇸";
  if (/j league|japanese/i.test(name)) return "🇯🇵";
  if (/fifa/i.test(name)) return "🌐";
  return "⚽";
}

function highlightedText(value) {
  const text = String(value ?? "");
  if (!searchTerm) return escapeHTML(text);
  const escapedQuery = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(${escapedQuery})`, "ig");
  return text.split(pattern).map((part) =>
    part.toLocaleLowerCase() === searchTerm.toLocaleLowerCase()
      ? `<mark>${escapeHTML(part)}</mark>`
      : escapeHTML(part)
  ).join("");
}

function matchClock(match) {
  if (match.state === "in") {
    const clock = match.displayClock || match.status;
    return `<span class="match-clock live-clock"><span class="clock-dot"></span>${escapeHTML(clock)}</span>`;
  }
  if (match.state === "post") {
    return `<span class="match-clock finished-clock">${escapeHTML(match.status || "FT")}</span>`;
  }
  return `<span class="match-clock upcoming-clock" title="Kickoff time in your local time zone">
    <strong>${escapeHTML(timeLabel(match.date))}</strong><small>${escapeHTML(localTimeZoneLabel())}</small>
  </span>`;
}

function scoreMarkup(match) {
  if (match.state === "pre") {
    return '<span class="score upcoming-score">VS</span>';
  }
  return `<span class="score${flashedMatchIds.has(match.id) ? " score-updated" : ""}" data-score-match="${escapeHTML(match.id)}" aria-label="${escapeHTML(`${match.home.name} ${match.home.score ?? "0"}, ${match.away.name} ${match.away.score ?? "0"}`)}">
    <span class="${match.home.winner ? "winner" : match.away.winner ? "loser" : ""}">${escapeHTML(match.home.score ?? "0")}</span>
    <span class="score-separator">:</span>
    <span class="${match.away.winner ? "winner" : match.home.winner ? "loser" : ""}">${escapeHTML(match.away.score ?? "0")}</span>
  </span>`;
}

function detailGoalEvents(match, detail) {
  const goals = (detail?.keyEvents ?? []).filter((item) => {
    const type = item.type?.text || "";
    return /goal/i.test(type) && !/overturn|disallow|no goal/i.test(type);
  });
  if (!goals.length) return "";

  const teamGoals = (team) => goals.filter((item) =>
    String(item.team?.id ?? "") === String(team.id)
      || item.team?.displayName === team.name
  ).map((item) => {
    const shortText = item.shortText || "";
    const scorer = shortText.replace(/\s+(?:own\s+goal|goal|penalty)\b.*$/i, "").trim()
      || item.text?.match(/goal!?\s+[^.]*?\d+\s*,\s*[^.]*?\.\s*([^.(]+?)\s*\(/i)?.[1]?.trim()
      || "Goal";
    const minute = item.clock?.displayValue || item.period?.displayValue || "";
    return `<span class="detail-goal-event"><span>${escapeHTML(scorer)}</span>${minute ? `<span class="detail-goal-minute">${escapeHTML(minute)}</span>` : ""}</span>`;
  }).join("");
  const homeGoals = teamGoals(match.home);
  const awayGoals = teamGoals(match.away);
  if (!homeGoals && !awayGoals) return "";
  return `<div class="detail-goal-events" aria-label="Goal scorers">
    <div class="detail-goal-team home">${homeGoals}</div>
    <span class="detail-goal-ball" aria-hidden="true">⚽</span>
    <div class="detail-goal-team away">${awayGoals}</div>
  </div>`;
}

function teamBadgeMarkup(team) {
  const crest = team.logo
    ? `<img src="${escapeHTML(team.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : "";
  return `<span class="team-badge${team.logo ? "" : " no-logo"}" style="--team-color:${escapeHTML(team.color)}">
    <span class="flag-fabric" aria-hidden="true"></span>${crest}<span class="team-initials">${escapeHTML(team.abbreviation.slice(0, 3))}</span>
  </span>`;
}

function teamMarkup(team, side) {
  const badge = teamBadgeMarkup(team);
  const recordTitle = team.record ? "Season record (wins-draws-losses)" : "";
  return `<span class="team team-${side}${side === "away" ? " away-team" : ""}${team.winner ? " team-winner" : ""}${team.loser ? " team-loser" : ""}">
    ${side === "home" ? badge : ""}
    <span class="team-label"><span class="team-name">${highlightedText(team.shortName)}</span>${team.record ? `<span class="team-record" title="${recordTitle}" aria-label="${escapeHTML(`${team.record}, season record wins-draws-losses`)}">${escapeHTML(team.record)}</span>` : ""}</span>
    ${side === "away" ? badge : ""}
  </span>`;
}

function visibleMatches() {
  const query = searchTerm.toLocaleLowerCase();
  return matches.filter((match) => {
    if (activeStatus === "favorites" && !favorites.has(match.id)) return false;
    if (activeStatus === "broadcast" && !match.hasBroadcast) return false;
    const statusFilter = { live: "in", upcoming: "pre", finished: "post" }[activeStatus] || activeStatus;
    if (["in", "pre", "post"].includes(statusFilter) && match.state !== statusFilter) return false;
    if (activeCompetition !== "all" && match.league !== activeCompetition) return false;
    return !query || [
      match.home.name,
      match.away.name,
      match.league,
      match.stage,
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
}

function compareCompetitionPriority(first, second) {
  const nameOf = (value) => typeof value === "string" ? value : value.league;
  const priority = (value) => {
    const name = nameOf(value);
    const index = TOP_COMPETITIONS.findIndex((competition) => competition.toLocaleLowerCase() === name?.toLocaleLowerCase());
    return index < 0 ? TOP_COMPETITIONS.length : index;
  };
  return priority(first) - priority(second);
}

function renderMatch(match) {
  const selected = match.id === selectedMatchId;
  return `<article class="match-row${selected ? " selected" : ""}${match.state === "in" ? " live-match" : ""}" data-match="${escapeHTML(match.id)}">
    <button class="match-select" type="button" aria-label="${escapeHTML(`${match.home.name} ${match.home.score ?? ""} versus ${match.away.name} ${match.away.score ?? ""}, ${match.status}`)}" aria-pressed="${selected}">
      ${teamMarkup(match.home, "home")}
      <span class="score-block">${scoreMarkup(match)}${matchClock(match)}</span>
      ${teamMarkup(match.away, "away")}
    </button>
    <button class="favorite-button${favorites.has(match.id) ? " selected" : ""}" type="button" data-action="favorite" aria-label="${favorites.has(match.id) ? "Remove" : "Add"} ${escapeHTML(match.home.name)} versus ${escapeHTML(match.away.name)} ${favorites.has(match.id) ? "from" : "to"} following" aria-pressed="${favorites.has(match.id)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91L12 3Z"></path></svg>
    </button>
  </article>`;
}

function renderLiveBoard() {
  const liveMatches = matches.filter(({ state }) => state === "in")
    .sort((a, b) => compareCompetitionPriority(a, b) || new Date(a.date) - new Date(b.date));
  const grid = document.querySelector("#live-board-grid");
  const empty = document.querySelector("#live-board-empty");
  const board = document.querySelector("#live-board");
  if (!matches.length) {
    board.hidden = true;
    return;
  }
  board.hidden = false;
  empty.hidden = liveMatches.length > 0;
  grid.hidden = liveMatches.length === 0;
  if (!liveMatches.length) {
    board.classList.add("is-quiet");
    grid.innerHTML = "";
    const candidates = [...new Map([...matches, ...liveScoreMatches].map((match) => [match.id, match])).values()];
    const nextMatch = candidates
      .filter((match) => match.state === "pre" && new Date(match.date) > new Date())
      .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
    const latestResult = candidates
      .filter((match) => match.state === "post")
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    if (nextMatch) {
      const minutes = Math.max(1, Math.ceil((new Date(nextMatch.date) - Date.now()) / 60_000));
      const countdown = minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`
        : `${minutes}m`;
      document.querySelector("#live-board-empty-copy").textContent =
        `Quiet on the pitch · Next: ${nextMatch.home.shortName} vs ${nextMatch.away.shortName} in ${countdown}`;
      document.querySelector("#live-board-empty button").textContent = "Browse fixtures →";
      document.querySelector("#live-board-empty button").dataset.view = "upcoming";
    } else if (latestResult) {
      document.querySelector("#live-board-empty-copy").textContent =
        `No matches live · Latest: ${latestResult.home.shortName} ${latestResult.home.score ?? "0"}–${latestResult.away.score ?? "0"} ${latestResult.away.shortName}`;
      document.querySelector("#live-board-empty button").textContent = "View results →";
      document.querySelector("#live-board-empty button").dataset.view = "finished";
    } else {
      document.querySelector("#live-board-empty-copy").textContent = "Quiet on the pitch right now.";
      document.querySelector("#live-board-empty button").textContent = "Browse fixtures →";
      document.querySelector("#live-board-empty button").dataset.view = "upcoming";
    }
    return;
  }
  board.classList.remove("is-quiet");
  grid.innerHTML = liveMatches.slice(0, 3).map((match) => {
    const detail = detailCache.get(match.id);
    const latestEvent = detail?.keyEvents?.length ? detail.keyEvents[detail.keyEvents.length - 1] : null;
    const moment = latestEvent
      ? `<span class="live-card-event"><span>${escapeHTML(eventIcon(latestEvent.type?.text))}</span>${escapeHTML(latestEvent.shortText || latestEvent.text || "Match event")}</span>`
      : `<span class="live-card-event neutral"><span class="live-card-event-dot"></span>${escapeHTML(match.stage || match.league)}</span>`;
    return `<button class="live-card${match.id === selectedMatchId ? " selected" : ""}" type="button" data-live-match="${escapeHTML(match.id)}" aria-label="Open ${escapeHTML(match.home.name)} versus ${escapeHTML(match.away.name)}">
      <span class="live-card-meta"><span class="live-card-league">${escapeHTML(match.league)}</span><span class="live-card-minute"><span class="clock-dot"></span>${escapeHTML(match.displayClock || match.status)}</span></span>
      <span class="live-card-scoreline">
        <span class="live-card-team">${teamBadgeMarkup(match.home)}<span>${escapeHTML(match.home.shortName)}</span></span>
        <span class="live-card-score">${escapeHTML(match.home.score ?? "0")}<span>:</span>${escapeHTML(match.away.score ?? "0")}</span>
        <span class="live-card-team away"><span>${escapeHTML(match.away.shortName)}</span>${teamBadgeMarkup(match.away)}</span>
      </span>
      ${moment}
    </button>`;
  }).join("");
}

function renderLiveScoreStrip() {
  const strip = document.querySelector("#live-score-strip");
  const track = document.querySelector("#live-score-strip-track");
  const count = document.querySelector("#live-score-strip-count");
  const liveMatches = liveScoreMatches
    .filter(({ state }) => state === "in")
    .sort((a, b) => compareCompetitionPriority(a, b) || new Date(a.date) - new Date(b.date));
  document.body.classList.toggle("has-live-scores", liveMatches.length > 0);
  strip.hidden = liveMatches.length === 0;
  count.textContent = liveMatches.length;
  track.innerHTML = liveMatches.map((match) => {
    const home = match.home.shortName || match.home.name;
    const away = match.away.shortName || match.away.name;
    const homeCrest = match.home.logo
      ? `<img src="${escapeHTML(match.home.logo)}" alt="" loading="lazy">`
      : `<span class="live-score-item-initials">${escapeHTML(home.slice(0, 2))}</span>`;
    const awayCrest = match.away.logo
      ? `<img src="${escapeHTML(match.away.logo)}" alt="" loading="lazy">`
      : `<span class="live-score-item-initials">${escapeHTML(away.slice(0, 2))}</span>`;
    return `<button class="live-score-item" type="button" data-live-strip-match="${escapeHTML(match.id)}" aria-label="Open ${escapeHTML(match.home.name)} ${escapeHTML(match.home.score ?? "0")}–${escapeHTML(match.away.score ?? "0")} ${escapeHTML(match.away.name)}, ${escapeHTML(match.displayClock || match.status)}">
      <span class="live-score-item-league">${escapeHTML(match.league)}</span>
      <span class="live-score-item-match">
        <span class="live-score-item-team">${homeCrest}<span>${escapeHTML(home)}</span></span>
        <strong class="live-score-item-score">${escapeHTML(match.home.score ?? "0")}<span>–</span>${escapeHTML(match.away.score ?? "0")}</strong>
        <span class="live-score-item-team away">${awayCrest}<span>${escapeHTML(away)}</span></span>
      </span>
      <span class="live-score-item-clock"><span class="clock-dot"></span>${escapeHTML(match.displayClock || match.status)}</span>
    </button>`;
  }).join("");
  updateLiveScoreArrows();
}

function updateLiveScoreArrows() {
  const track = document.querySelector("#live-score-strip-track");
  const previous = document.querySelector('[data-live-scroll="-1"]');
  const next = document.querySelector('[data-live-scroll="1"]');
  previous.disabled = track.scrollLeft <= 0;
  next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
}

function renderMatches() {
  const filtered = visibleMatches().sort((a, b) => {
    const stateOrder = { in: 0, pre: 1, post: 2 };
    return (stateOrder[a.state] ?? 3) - (stateOrder[b.state] ?? 3)
      || new Date(a.date) - new Date(b.date);
  });
  const following = activeStatus === "favorites" ? [] : filtered.filter((match) => favorites.has(match.id));
  const pinnedIds = new Set(following.map((match) => match.id));
  const groups = new Map();
  for (const match of filtered.filter((item) => !pinnedIds.has(item.id))) {
    if (!groups.has(match.league)) groups.set(match.league, []);
    groups.get(match.league).push(match);
  }
  const followingMarkup = following.length ? `<section class="league-group following-group">
    <button class="league-heading following-heading" type="button" data-view="favorites" aria-label="Show followed matches">
      <span class="league-mark" aria-hidden="true">★</span>
      <span class="league-title">Following<small>Your followed matches</small></span>
      <span class="league-count">${following.length}</span>
    </button>
    <div class="league-matches">${following.map(renderMatch).join("")}</div>
  </section>` : "";
  listElement.innerHTML = followingMarkup + [...groups.entries()]
    .sort((a, b) => compareCompetitionPriority(a[0], b[0]) || a[0].localeCompare(b[0]))
    .map(([league, leagueMatches]) => `
    <section class="league-group">
      <button class="league-heading" type="button" data-league="${escapeHTML(league)}" aria-label="Filter by ${escapeHTML(league)}">
        <span class="league-mark">${competitionIcon(league)}</span>
        <span class="league-title">${highlightedText(league)}${leagueMatches[0].stage ? `<small>${highlightedText(leagueMatches[0].stage)}</small>` : ""}</span>
        <span class="league-count">${leagueMatches.length}</span>
        <span class="league-chevron" aria-hidden="true">⌄</span>
      </button>
      <div class="league-matches">${leagueMatches.map(renderMatch).join("")}</div>
    </section>
  `).join("");
  const empty = filtered.length === 0;
  document.querySelector("#empty-state").hidden = !empty;
  document.querySelector("#match-list").hidden = empty;
  const title = fromDateKey(selectedDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  document.querySelector("#day-heading").textContent = title;
  document.querySelector("#day-subtitle").textContent = `${matches.filter(({ state }) => state === "in").length} live · ${matches.length} matches across the ESPN football feed`;
  document.querySelector("#match-total").textContent = `${matches.length} ${matches.length === 1 ? "MATCH" : "MATCHES"}`;
  document.querySelector("#empty-title").textContent = matches.length ? "No matches match these filters" : "No fixtures for this date";
  document.querySelector("#empty-description").textContent = matches.length
    ? "Try a different status, competition or search."
    : "There are no fixtures in the data feed for the selected day.";
  document.querySelector("#all-status-count").textContent = matches.length;
  document.querySelector("#live-count").textContent = matches.filter(({ state }) => state === "in").length;
  document.querySelector("#upcoming-count").textContent = matches.filter(({ state }) => state === "pre").length;
  document.querySelector("#finished-count").textContent = matches.filter(({ state }) => state === "post").length;
  document.querySelector("#favorites-count").textContent = matches.filter(({ id }) => favorites.has(id)).length;
  document.querySelector("#broadcast-count").textContent = matches.filter(({ hasBroadcast }) => hasBroadcast).length;
  document.querySelectorAll(".status-tab[data-status]").forEach((button) => {
    const aliases = { upcoming: "pre", finished: "post" };
    const selected = (aliases[activeStatus] || activeStatus) === button.dataset.status;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === activeStatus);
  });
  document.querySelectorAll(".status-tab[data-status]").forEach((button) => {
    const count = button.dataset.status === "all" ? matches.length
      : button.dataset.status === "live" ? matches.filter(({ state }) => state === "in").length
        : button.dataset.status === "pre" ? matches.filter(({ state }) => state === "pre").length
          : button.dataset.status === "post" ? matches.filter(({ state }) => state === "post").length
            : button.dataset.status === "favorites" ? matches.filter(({ id }) => favorites.has(id)).length
              : matches.filter(({ hasBroadcast }) => hasBroadcast).length;
    button.disabled = count === 0 && button.dataset.status !== activeStatus;
  });
  announceScoreChanges([...new Map([...matches, ...liveScoreMatches].map((match) => [match.id, match])).values()]);
  renderCompetitionFilters();
  renderDates();
  renderLiveBoard();
  renderLiveScoreStrip();
}

function setActiveStatus(status) {
  activeStatus = ({ upcoming: "pre", finished: "post" })[status] || status;
  document.querySelectorAll("[data-status]").forEach((button) => {
    const statusAliases = { live: "live", upcoming: "pre", finished: "post" };
    const selected = button.dataset.status === (statusAliases[status] || status);
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => {
    const viewStatus = { finished: "post" }[button.dataset.view] || button.dataset.view;
    button.classList.toggle("active", viewStatus === status);
  });
  renderMatches();
  syncUrlState();
}

function setLoading(isLoading) {
  document.querySelector("#loading-state").hidden = !isLoading;
  if (isLoading && matches.length === 0) listElement.hidden = true;
}

function renderUpdatedTime() {
  document.querySelector("#updated-label").textContent = `Updated ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}`;
}

function scheduleRefresh() {
  window.clearTimeout(refreshTimeout);
  if (document.hidden) return;
  const hasLiveMatch = [...matches, ...liveScoreMatches].some((match) => match.state === "in");
  refreshTimeout = window.setTimeout(() => {
    refreshTimeout = 0;
    loadMatches();
  }, hasLiveMatch ? LIVE_REFRESH_INTERVAL : REFRESH_INTERVAL);
}

async function loadMatches({ force = false } = {}) {
  if (requestInProgress && !force) return;
  scoreRequestController?.abort();
  const controller = new AbortController();
  scoreRequestController = controller;
  const requestDate = selectedDate;
  requestInProgress = true;
  document.querySelector("#refresh-button").classList.add("is-refreshing");
  setLoading(matches.length === 0);
  setFeedStatus("loading", "UPDATING SCORES");
  document.querySelector("#error-banner").hidden = true;
  try {
    const feedDateKeys = new Set();
    for (const baseDateKey of new Set([requestDate, toDateKey(new Date())])) {
      for (let offset = -1; offset <= 1; offset += 1) {
        const date = fromDateKey(baseDateKey);
        date.setDate(date.getDate() + offset);
        feedDateKeys.add(toDateKey(date));
      }
    }
    const feedDates = [...feedDateKeys].map(toApiDate);
    const responses = await Promise.all(feedDates.map((date) => fetch(
      `${API_BASE}/scoreboard?dates=${date}&limit=1000`,
      { cache: "no-store", signal: controller.signal },
    )));
    if (requestDate !== selectedDate) return;
    const payloads = await Promise.all(responses.map(async (response, index) => {
      if (!response.ok) throw new Error(`The scores feed returned HTTP ${response.status} for ${feedDates[index]}.`);
      const data = await response.json();
      if (!Array.isArray(data.events)) throw new Error(`The scores feed returned an unexpected response for ${feedDates[index]}.`);
      return data.events;
    }));
    const selectedDayEvents = new Map();
    const currentDayEvents = new Map();
    const todayKey = toDateKey(new Date());
    for (const event of payloads.flat()) {
      if (event.id && event.date && toDateKey(new Date(event.date)) === requestDate) {
        selectedDayEvents.set(String(event.id), event);
      }
      if (event.id && event.date && toDateKey(new Date(event.date)) === todayKey) {
        currentDayEvents.set(String(event.id), event);
      }
    }
    matches = [...selectedDayEvents.values()]
      .sort((first, second) => new Date(first.date) - new Date(second.date))
      .map(normalizeMatch);
    liveScoreMatches = [...currentDayEvents.values()].map(normalizeMatch);
    for (const match of [...matches, ...liveScoreMatches]) matchCache.set(match.id, match);
    if (!selectedMatchId || !matches.some((match) => match.id === selectedMatchId)) {
      if (!selectedMatchId || !matchCache.has(selectedMatchId)) {
        selectedMatchId = null;
        showEmptyDetail();
      }
    }
    announceScoreChanges([...new Map([...matches, ...liveScoreMatches].map((match) => [match.id, match])).values()]);
    setFeedStatus("connected", "SCORES CONNECTED");
    document.querySelector("#error-banner").hidden = true;
    lastSuccessfulFetchAt = Date.now();
    renderMatches();
    renderUpdatedTime();
    if (!selectedMatchId && !hasAutoSelectedMatch && window.matchMedia("(min-width: 721px)").matches) {
      const defaultMatch = selectDefaultMatch();
      hasAutoSelectedMatch = true;
      if (defaultMatch) {
        selectedMatchId = defaultMatch.id;
        renderMatches();
      }
    } else if (selectedMatchId && !hasAutoSelectedMatch) {
      hasAutoSelectedMatch = true;
    }
    if (selectedMatchId) {
      renderDetail();
      if (matchCache.get(selectedMatchId)?.state === "in") {
        detailCache.delete(selectedMatchId);
        renderDetail();
        loadMatchDetails(matchCache.get(selectedMatchId));
      }
    }
  } catch (error) {
    if (error.name === "AbortError" || requestDate !== selectedDate) return;
    console.error("Unable to load football scores.", error);
    setFeedStatus("offline", "SCORES UNAVAILABLE");
    const staleMessage = lastSuccessfulFetchAt
      ? ` Showing scores last updated ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(lastSuccessfulFetchAt)}.`
      : "";
    document.querySelector("#error-message").textContent = `${error.message} Check your connection and retry.${staleMessage}`;
    if (lastSuccessfulFetchAt) {
      document.querySelector("#updated-label").textContent = `Data may be stale · last updated ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(lastSuccessfulFetchAt)}`;
    }
    document.querySelector("#error-banner").hidden = false;
    if (!matches.length) {
      listElement.hidden = true;
      document.querySelector("#empty-state").hidden = true;
    }
  } finally {
    if (scoreRequestController === controller) {
      requestInProgress = false;
      document.querySelector("#refresh-button").classList.remove("is-refreshing");
      setLoading(false);
      scheduleRefresh();
    }
  }
}

function showEmptyDetail() {
  detailEmptyElement.hidden = false;
  detailElement.hidden = true;
  detailElement.innerHTML = "";
  const panel = document.querySelector("#match-panel");
  panel.removeAttribute("role");
  panel.removeAttribute("aria-modal");
  document.body.classList.remove("detail-open");
  document.body.classList.remove("detail-modal-open");
}

function showToast(message) {
  const toast = document.querySelector("#action-toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2300);
}

function closeMatchDetail() {
  if (window.history.state?.touchlineMatch) {
    window.history.back();
    return;
  }
  const closedMatchId = selectedMatchId;
  selectedMatchId = null;
  showEmptyDetail();
  syncUrlState();
  renderMatches();
  const trigger = [...document.querySelectorAll(".match-select, [data-live-match]")]
    .find((element) => element.closest("[data-match]")?.dataset.match === closedMatchId
      || element.dataset.liveMatch === closedMatchId);
  trigger?.focus();
}

function detailTeamMarkup(team) {
  const crest = team.logo
    ? `<img src="${escapeHTML(team.logo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
    : "";
  return `<span class="detail-team-badge${team.logo ? "" : " no-logo"}" style="--team-color:${escapeHTML(team.color)}">
    <span class="flag-fabric" aria-hidden="true"></span>${crest}<span>${escapeHTML(team.abbreviation)}</span>
  </span>`;
}

function detailMomentum(match, detail) {
  const events = detail?.keyEvents ?? [];
  const timedEvents = events.filter((item) => item.clock?.value != null && Number.isFinite(Number(item.clock.value)));
  const momentumMarkers = timedEvents.map((item) => {
    const eventTeamId = String(item.team?.id ?? "");
    const eventTeamName = item.team?.displayName ?? "";
    const side = eventTeamId === String(match.home.id) || eventTeamName === match.home.name
      ? "home"
      : eventTeamId === String(match.away.id) || eventTeamName === match.away.name
        ? "away"
        : "neutral";
    const position = Math.min(99, Math.max(1, (Number(item.clock.value) / 5400) * 100));
    const eventLabel = item.text || item.shortText || item.type?.text || "Match event";
    return `<span class="momentum-marker ${side}" style="--event-position:${position}%" title="${escapeHTML(eventLabel)}" aria-label="${escapeHTML(eventLabel)}">${escapeHTML(eventIcon(item.type?.text, eventLabel))}</span>`;
  }).join("");
  return `<section class="momentum-card" aria-labelledby="momentum-title">
      <div class="momentum-heading"><div><span class="momentum-kicker">MATCH FLOW</span><h3 id="momentum-title">Match momentum</h3></div><span class="momentum-unavailable">Pressure data unavailable</span></div>
      <p class="momentum-note">ESPN does not provide attack-pressure data for this fixture. This clock shows reported key events only; no momentum curve is inferred.</p>
      <div class="momentum-chart" role="img" aria-label="Reported match events on the match clock. Attack-pressure data is not available.">
        <div class="momentum-plot">
          <div class="momentum-lane home"><span>${escapeHTML(match.home.shortName)}</span></div>
          <div class="momentum-lane away"><span>${escapeHTML(match.away.shortName)}</span></div>
          ${momentumMarkers || '<span class="momentum-empty">No timed key events have been reported.</span>'}
          <div class="momentum-axis" aria-hidden="true"><span>0′</span><span>15′</span><span>30′</span><span>45′</span><span>60′</span><span>75′</span><span>90′</span></div>
        </div>
      </div>
      <div class="momentum-legend"><span class="home"><i></i>${escapeHTML(match.home.name)}</span><span class="away"><i></i>${escapeHTML(match.away.name)}</span></div>
    </section>`;
}

function detailOverview(match, detail) {
  const events = detail?.keyEvents ?? [];
  const commentary = detail?.commentary ?? [];
  const recentGames = detail?.lastFiveGames ?? [];
  const timelineEvents = selectedEventFilter === "key" || !commentary.length ? events : commentary;
  const timeline = timelineEvents.length
    ? [...timelineEvents].reverse().map((item) => {
      const play = item.play ?? item;
      const eventType = play.type?.text || item.type?.text || "";
      const eventText = item.text || play.text || item.shortText || eventType || "Match event";
      const eventTeamId = String(play.team?.id ?? item.team?.id ?? "");
      const eventTeamName = play.team?.displayName || item.team?.displayName || "";
      const side = eventTeamId === String(match.home.id) || eventTeamName === match.home.name
        ? "home"
        : eventTeamId === String(match.away.id) || eventTeamName === match.away.name
          ? "away"
          : "neutral";
      return `<div class="timeline-item ${side}">
        <span class="timeline-minute">${escapeHTML(item.time?.displayValue || play.clock?.displayValue || item.clock?.displayValue || item.period?.number || "")}</span>
        <span class="timeline-icon">${escapeHTML(eventIcon(eventType, eventText))}</span>
        <span class="timeline-text">${escapeHTML(eventText)}</span>
      </div>`;
    }).join("")
    : `<div class="detail-placeholder">${selectedEventFilter === "key" ? "No key events have been reported yet." : "No match events have been reported yet."}</div>`;
  const commentaryCount = commentary.length || events.length;
  const shotEvents = commentary.filter((item) => {
    const play = item.play ?? item;
    return /shot|attempt/i.test(play.type?.text || item.type?.text || "")
      && play.fieldPositionX != null
      && play.fieldPositionY != null
      && Number.isFinite(Number(play.fieldPositionX))
      && Number.isFinite(Number(play.fieldPositionY));
  });
  const shotMap = shotEvents.length
    ? `<section class="shot-map-card" aria-labelledby="shot-map-title">
        <div class="shot-map-heading"><div><span class="momentum-kicker">REPORTED PLAY LOCATIONS</span><h3 id="shot-map-title">Shot map</h3></div><span class="shot-map-count">${shotEvents.length} attempts</span></div>
        <p class="shot-map-note">Locations are shown only for attempts with coordinates in the ESPN event feed.</p>
        <div class="shot-map-pitch" role="img" aria-label="${shotEvents.length} reported shot locations on the pitch">
          <span class="shot-map-halfway" aria-hidden="true"></span><span class="shot-map-circle" aria-hidden="true"></span>
          <span class="shot-map-box shot-map-box-left" aria-hidden="true"></span><span class="shot-map-box shot-map-box-right" aria-hidden="true"></span>
          ${shotEvents.map((item) => {
            const play = item.play ?? item;
            const x = Math.min(100, Math.max(0, Number(play.fieldPositionX)));
            const y = Math.min(100, Math.max(0, Number(play.fieldPositionY)));
            const teamId = String(play.team?.id ?? "");
            const teamName = play.team?.displayName || "";
            const side = teamId === String(match.home.id) || teamName === match.home.name
              ? "home"
              : teamId === String(match.away.id) || teamName === match.away.name
                ? "away"
                : "neutral";
            const label = item.text || play.text || play.type?.text || "Shot attempt";
            return `<span class="shot-map-marker ${side}" style="--shot-x:${x}%;--shot-y:${y}%" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}"></span>`;
          }).join("")}
        </div>
        <div class="shot-map-legend"><span class="home"><i></i>${escapeHTML(match.home.name)}</span><span class="away"><i></i>${escapeHTML(match.away.name)}</span></div>
      </section>`
    : "";
  const competition = detail?.header?.competitions?.[0] ?? {};
  const gameInfo = [
    detail?.gameInfo?.venue?.fullName || competition.venue?.fullName || match.venue,
    [detail?.gameInfo?.venue?.address?.city || competition.venue?.address?.city || match.city, detail?.gameInfo?.venue?.address?.country || competition.venue?.address?.country || match.country].filter(Boolean).join(", "),
    competition.attendance ? `Attendance ${Number(competition.attendance).toLocaleString()}` : "",
    competition.broadcasts?.flatMap((item) => item.names ?? []).join(", ") || match.broadcasts.join(", "),
  ].filter(Boolean);
  const info = gameInfo.length
    ? gameInfo.map((item) => `<div class="info-row"><span class="info-bullet"></span>${escapeHTML(item)}</div>`).join("")
    : '<div class="detail-placeholder">Venue and broadcast information are not available.</div>';
  const form = recentGames.length
    ? `<div class="form-list">${recentGames.slice(0, 2).map((item) => `<span class="form-item">${escapeHTML(typeof item === "string" ? item : item.displayName || item.name || "Recent match")}</span>`).join("")}</div>`
    : "";
  const articles = (detail?.news?.articles ?? []).filter((article) => article.headline).slice(0, 3);
  const news = articles.length
    ? `<div class="detail-section"><h3>Latest football news</h3><div class="news-list">${articles.map((article) => {
      const href = typeof article.links?.web?.href === "string" && article.links.web.href.startsWith("https://")
        ? article.links.web.href
        : "";
      return `<a class="news-item" href="${escapeHTML(href || "#")}"${href ? ' target="_blank" rel="noopener noreferrer"' : ""}><strong>${escapeHTML(article.headline)}</strong><span>${escapeHTML(article.description || "Read more")}</span></a>`;
    }).join("")}</div></div>`
    : "";
  return `${shotMap}<div class="detail-overview-grid">
    <div class="detail-section event-feed">
      <div class="event-feed-heading"><h3>Match timeline</h3><span>ESPN commentary</span></div>
      <div class="timeline-controls" role="group" aria-label="Filter match events">
        <button class="timeline-filter${selectedEventFilter === "all" ? " active" : ""}" type="button" data-event-filter="all" aria-pressed="${selectedEventFilter === "all"}">All <span>${commentaryCount}</span></button>
        <button class="timeline-filter${selectedEventFilter === "key" ? " active" : ""}" type="button" data-event-filter="key" aria-pressed="${selectedEventFilter === "key"}">Key events <span>${events.length}</span></button>
      </div>
      <div class="timeline">${timeline}</div>
    </div>
    <div><div class="detail-section"><h3>Match information</h3><div class="info-list">${info}</div></div>${form ? `<div class="detail-section"><h3>Recent form</h3>${form}</div>` : ""}${news}</div>
  </div>`;
}

function eventIcon(type, text = "") {
  const label = `${type ?? ""} ${text}`;
  if (/goal|score/i.test(label)) return "⚽";
  if (/red card/i.test(label)) return "🟥";
  if (/yellow card/i.test(label)) return "🟨";
  if (/card/i.test(label)) return "▰";
  if (/sub/i.test(label)) return "↔";
  if (/shot|attempt|save|woodwork/i.test(label)) return "◉";
  return "•";
}

function detailStatistics(detail) {
  const teams = detail?.boxscore?.teams ?? [];
  if (teams.length < 2) return '<div class="detail-placeholder">Match statistics are not available yet.</div>';
  const home = teams.find((team) => team.homeAway === "home") ?? teams[0];
  const away = teams.find((team) => team.homeAway === "away") ?? teams[1];
  const homeStats = new Map((home.statistics ?? []).map((stat) => [stat.name, stat]));
  const rows = (away.statistics ?? []).map((stat) => {
    const homeStat = homeStats.get(stat.name);
    return `<div class="stat-row"><span>${escapeHTML(homeStat?.displayValue ?? "—")}</span><div class="stat-label">${escapeHTML(homeStat?.label || stat.label || stat.name)}</div><span>${escapeHTML(stat.displayValue ?? "—")}</span></div>`;
  });
  return `<div class="stats-teams"><span>${escapeHTML(home.team?.displayName || "Home")}</span><span>${escapeHTML(away.team?.displayName || "Away")}</span></div><div class="stats-list">${rows.join("") || '<div class="detail-placeholder">No statistics have been reported.</div>'}</div>`;
}

function lineupPositionGroup(player) {
  const position = `${player.position?.abbreviation || ""} ${player.position?.displayName || ""}`.toUpperCase();
  if (/^(G|GK)\b|GOALKEEPER/.test(position)) return "goalkeeper";
  if (/\b(CB|CD|RB|LB|WB|DEF)\b|CENTRE.?BACK|CENTER.?BACK|FULL.?BACK|DEFENDER/.test(position)) return "defender";
  if (/\b(F|CF|ST|FW)\b|FORWARD|STRIKER/.test(position)) return "forward";
  return "midfielder";
}

function lineupPlayerOrder(first, second) {
  const firstPlace = Number(first.formationPlace);
  const secondPlace = Number(second.formationPlace);
  if (Number.isFinite(firstPlace) && Number.isFinite(secondPlace)) return firstPlace - secondPlace;
  return String(first.athlete?.displayName || "").localeCompare(String(second.athlete?.displayName || ""));
}

function lineupFormationRows(roster) {
  const starters = (roster.roster ?? []).filter((player) => player.starter).sort(lineupPlayerOrder);
  const goalkeeper = starters.find((player) => lineupPositionGroup(player) === "goalkeeper");
  const outfield = starters.filter((player) => player !== goalkeeper);
  const formation = String(roster.formation || "").split("-").map(Number);
  const validFormation = formation.length >= 3
    && formation.every((count) => Number.isInteger(count) && count > 0)
    && formation.reduce((total, count) => total + count, 0) === outfield.length;

  if (!goalkeeper || outfield.length === 0) return null;
  const defenders = outfield.filter((player) => lineupPositionGroup(player) === "defender");
  const forwards = outfield.filter((player) => lineupPositionGroup(player) === "forward");
  const midfielders = outfield.filter((player) => lineupPositionGroup(player) === "midfielder");
  const defenderCount = validFormation ? formation[0] : defenders.length;
  const forwardCount = validFormation ? formation.at(-1) : forwards.length;
  const midfieldCounts = validFormation ? formation.slice(1, -1) : [midfielders.length];
  const defensiveLine = defenders.splice(0, defenderCount);
  const attackingLine = forwards.splice(0, forwardCount);
  let centralPlayers = [...midfielders, ...defenders, ...forwards].sort(lineupPlayerOrder);
  const rows = midfieldCounts.map((count) => {
    const row = centralPlayers.splice(0, count);
    return row;
  });

  if (centralPlayers.length || defensiveLine.length !== defenderCount || attackingLine.length !== forwardCount) {
    const orderedOutfield = [...outfield].sort(lineupPlayerOrder);
    const rowSize = validFormation ? formation : [Math.max(1, Math.floor(outfield.length / 3)), Math.max(1, Math.floor(outfield.length / 3))];
    const sizes = rowSize.length > 2 ? rowSize : [...rowSize, Math.max(1, outfield.length - rowSize.reduce((sum, count) => sum + count, 0))];
    let offset = 0;
    return {
      goalkeeper,
      rows: sizes.map((count) => {
        const row = orderedOutfield.slice(offset, offset + count);
        offset += count;
        return row;
      }).filter((row) => row.length),
    };
  }

  return { goalkeeper, rows: [defensiveLine, ...rows, attackingLine].filter((row) => row.length) };
}

function lineupPlayerRating(player) {
  const ratingStat = Array.isArray(player.stats)
    ? player.stats.find((stat) => stat.name === "rating")
    : null;
  const rawRating = player.rating ?? ratingStat?.displayValue ?? ratingStat?.value;
  const value = Number(typeof rawRating === "object" && rawRating !== null
    ? rawRating.displayValue ?? rawRating.value
    : rawRating);
  if (!Number.isFinite(value) || value < 0 || value > 10) return null;
  const sourceDisplay = player.rating !== undefined && player.rating !== null
    ? (typeof rawRating === "object" && rawRating !== null ? rawRating.displayValue : null)
    : ratingStat?.displayValue;
  const display = sourceDisplay !== undefined && sourceDisplay !== null && sourceDisplay !== ""
    ? String(sourceDisplay)
    : String(Number(value.toFixed(2)));
  return { value, display };
}

function lineupPlayerMarkup(player, color) {
  const name = player.athlete?.displayName || player.athlete?.shortName || "Player";
  const number = player.jersey?.displayValue || player.jersey || "—";
  const position = player.position?.abbreviation || "";
  const rating = lineupPlayerRating(player);
  const ratingTier = rating ? (rating.value >= 7.5 ? "high" : rating.value >= 6.5 ? "medium" : "low") : "";
  return `<div class="pitch-player" title="${escapeHTML(`${number} ${name}${position ? ` · ${position}` : ""}`)}">
    <span class="pitch-shirt" style="--shirt-color:${color}" aria-hidden="true"><span>${escapeHTML(number)}</span></span>
    ${rating ? `<span class="pitch-rating pitch-rating-${ratingTier}" aria-label="Player rating: ${escapeHTML(rating.display)} out of 10" title="Rating ${escapeHTML(rating.display)}">${escapeHTML(rating.display)}</span>` : ""}
    <span class="pitch-player-name">${escapeHTML(name)}</span>
    ${position ? `<span class="pitch-player-position">${escapeHTML(position)}</span>` : ""}
  </div>`;
}

function lineupTeamPitch(roster, side) {
  const formation = lineupFormationRows(roster);
  if (!formation) return "";
  const homeColor = "#63d6b3";
  const awayColor = "#ff9a76";
  const color = side === "home" ? homeColor : awayColor;
  const rows = side === "home" ? [...formation.rows].reverse() : formation.rows;
  const lines = rows.map((row) => `<div class="pitch-line" style="--players-in-line:${row.length}">${row.map((player) => lineupPlayerMarkup(player, color)).join("")}</div>`);
  const keeper = `<div class="pitch-line pitch-goalkeeper">${lineupPlayerMarkup(formation.goalkeeper, color)}</div>`;
  const teamLines = side === "home" ? [...lines, keeper] : [keeper, ...lines];
  return `<div class="pitch-team pitch-team-${side}" aria-label="${escapeHTML(roster.team?.displayName || side)} line-up">
    <div class="pitch-players">${teamLines.join("")}</div>
  </div>`;
}

function lineupTeamSummary(roster, side) {
  const color = side === "home" ? "#63d6b3" : "#ff9a76";
  const teamName = roster.team?.displayName || (side === "home" ? "Home" : "Away");
  return `<div class="lineup-team-summary lineup-team-summary-${side}">
    <span class="lineup-summary-shirt" style="--shirt-color:${color}" aria-hidden="true"></span>
    <span class="lineup-summary-name"><strong>${escapeHTML(teamName)}</strong><small>${side === "home" ? "HOME" : "AWAY"}</small></span>
    <span class="lineup-summary-formation">${escapeHTML(roster.formation || "—")}</span>
  </div>`;
}

function lineupBench(roster, side) {
  const substitutes = (roster.roster ?? []).filter((player) => !player.starter);
  if (!substitutes.length) return "";
  const color = side === "home" ? "#63d6b3" : "#ff9a76";
  return `<section class="lineup-bench-team">
    <h4><span class="bench-indicator" style="--shirt-color:${color}"></span>${escapeHTML(roster.team?.displayName || "Team")}</h4>
    <div class="lineup-bench-list">${substitutes.map((player) => `<div class="bench-player">
      <span class="bench-number">${escapeHTML(player.jersey?.displayValue || player.jersey || "—")}</span>
      <span class="bench-player-name">${escapeHTML(player.athlete?.displayName || player.athlete?.shortName || "Player")}</span>
      ${player.subbedIn ? '<span class="bench-status">ON</span>' : ""}
    </div>`).join("")}</div>
  </section>`;
}

function detailLineups(detail) {
  const rosters = detail?.rosters ?? [];
  if (rosters.length < 2) return '<div class="detail-placeholder">Line-ups are not available for this match yet.</div>';
  const home = rosters.find((roster) => roster.homeAway === "home") || rosters[0];
  const away = rosters.find((roster) => roster.homeAway === "away") || rosters[1];
  const homePitch = lineupTeamPitch(home, "home");
  const awayPitch = lineupTeamPitch(away, "away");
  if (!homePitch || !awayPitch) {
    return '<div class="detail-placeholder">Confirmed starting line-ups are not available for this match yet.</div>';
  }
  const hasPlayerRatings = [home, away].some((roster) => (roster.roster ?? [])
    .some((player) => player.starter && lineupPlayerRating(player)));
  const ratingNote = hasPlayerRatings
    ? "Ratings shown only when provided in the match feed."
    : "Player ratings are not provided in the ESPN match feed for this match.";
  return `<div class="lineup-view">
    <div class="lineup-team-summaries">${lineupTeamSummary(away, "away")}${lineupTeamSummary(home, "home")}</div>
    <p class="lineup-rating-note">${escapeHTML(ratingNote)}</p>
    <div class="lineup-pitch-scroll" role="region" aria-label="Scrollable football pitch line-ups" tabindex="0">
      <div class="lineup-pitch" role="group" aria-label="Starting line-ups on a football pitch">
        <div class="pitch-markings" aria-hidden="true"><span class="pitch-box pitch-box-away"></span><span class="pitch-box pitch-box-home"></span><span class="pitch-goal-area pitch-goal-area-away"></span><span class="pitch-goal-area pitch-goal-area-home"></span></div>
        ${awayPitch}${homePitch}
      </div>
    </div>
    <div class="bench-heading"><span>SUBSTITUTES</span><span>Players not in the starting line-up</span></div>
    <div class="lineup-benches">${lineupBench(home, "home")}${lineupBench(away, "away")}</div>
  </div>`;
}

function flattenStandings(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.flatMap(flattenStandings);
  if (Array.isArray(data.entries)) return data.entries;
  if (Array.isArray(data.standings)) return flattenStandings(data.standings);
  if (Array.isArray(data.groups)) return flattenStandings(data.groups);
  return [];
}

function detailStandings(detail, match) {
  const entries = flattenStandings(detail?.standings);
  const teamEntries = entries.filter((entry) => {
    const name = entry.team?.displayName || entry.team?.name;
    return name === match.home.name || name === match.away.name;
  });
  if (!teamEntries.length) return '<div class="detail-placeholder">Standings are not available for this competition.</div>';
  return `<div class="standings-list">${teamEntries.map((entry) => `<div class="standing-row"><strong>${escapeHTML(entry.team?.displayName || entry.team?.name)}</strong><span>${escapeHTML(entry.stats?.find((stat) => stat.name === "rank")?.displayValue || "—")}</span></div>`).join("")}</div>`;
}

function detailHeadToHead(detail) {
  const series = (detail?.seasonseries ?? []).find((item) => item.type === "head-to-head")
    || (detail?.seasonseries ?? [])[0];
  if (!series) return '<div class="detail-placeholder">Head-to-head results are not available.</div>';
  const results = (series.events ?? []).slice(0, 5).map((event) => {
    const competitors = event.competitors ?? [];
    const home = competitors.find((competitor) => competitor.homeAway === "home") ?? competitors[0] ?? {};
    const away = competitors.find((competitor) => competitor.homeAway === "away") ?? competitors[1] ?? {};
    const teamName = (competitor) => typeof competitor.team === "string"
      ? competitor.team
      : competitor.team?.displayName || competitor.team?.name || "Team";
    return `<div class="h2h-row"><span>${escapeHTML(new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(event.date)))}</span><strong>${escapeHTML(teamName(home))} <b>${escapeHTML(home.score ?? "—")} : ${escapeHTML(away.score ?? "—")}</b> ${escapeHTML(teamName(away))}</strong><em>${escapeHTML(event.statusType?.shortDetail || "FT")}</em></div>`;
  }).join("");
  return `<div class="h2h-summary"><strong>${escapeHTML(series.summary || series.title || "Head-to-head")}</strong><span>${escapeHTML(series.shortSummary || "")}</span></div>${results ? `<div class="h2h-list">${results}</div>` : '<div class="detail-placeholder">No previous meetings are available.</div>'}`;
}

function detailTabMarkup(match, detail) {
  if (detail?.error) return `<div class="detail-error">Match details could not be loaded. ${escapeHTML(detail.error)}</div>`;
  if (selectedDetailTab === "statistics") return detailStatistics(detail);
  if (selectedDetailTab === "lineups") return detailLineups(detail);
  if (selectedDetailTab === "standings") return detailStandings(detail, match);
  if (selectedDetailTab === "h2h") return detailHeadToHead(detail);
  return detailOverview(match, detail);
}

function detailBroadcastNames(match, detail, competition) {
  const sources = [
    detail?.broadcasts,
    competition?.broadcasts,
    match.broadcasts,
  ];
  const names = sources.flatMap((source) => {
    const items = Array.isArray(source) ? source : source ? [source] : [];
    return items.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (Array.isArray(item.names)) return item.names;
      const name = item.media?.name || item.media?.shortName || item.media?.callLetters
        || item.name || item.shortName || item.callLetters;
      return name ? [name] : [];
    });
  });
  return [...new Set(names.map((name) => String(name).trim()).filter(Boolean))];
}

function detailMetaIcon(kind) {
  const paths = {
    calendar: '<path d="M7 2v2M17 2v2M3 8h18M5 4h14a2 2 0 0 1 2 2v13H3V6a2 2 0 0 1 2-2Z"/><path d="M7 12h3m4 0h3M7 16h3"/>',
    competition: '<path d="M8 21h8m-4-4v4m-6-18h12v5a6 6 0 0 1-12 0V3Zm0 2H3v2a5 5 0 0 0 5 5m8-7h5v2a5 5 0 0 1-5 5"/>',
    venue: '<path d="M3 21h18M5 21V5l7-3 7 3v16M9 8h.01M15 8h.01M9 12h.01M15 12h.01M10 21v-5h4v5"/>',
    broadcast: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m8 2 4 3 4-3M8 10h8m-8 4h5"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[kind]}</svg>`;
}

function detailMetadataMarkup(match, detail) {
  const competition = detail?.header?.competitions?.[0] ?? {};
  const gameInfoVenue = detail?.gameInfo?.venue ?? {};
  const venue = gameInfoVenue.fullName || competition.venue?.fullName || match.venue;
  const date = new Date(match.date);
  const validDate = Number.isFinite(date.getTime());
  const dateLabel = validDate
    ? new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(date)
    : "Date TBC";
  const timeLabel = validDate
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date)
    : "Time TBC";
  const leagueLogo = detail?.header?.league?.logos?.find((logo) =>
    logo.href?.startsWith("https://")
  )?.href;
  const broadcasts = detailBroadcastNames(match, detail, competition);
  const broadcastLabel = broadcasts.length
    ? `${broadcasts.slice(0, 2).join(", ")}${broadcasts.length > 2 ? ` +${broadcasts.length - 2}` : ""}`
    : "";
  const broadcastTitle = broadcasts.length ? `Broadcast: ${broadcasts.join(", ")}` : "";
  return `<div class="detail-meta" aria-label="Match information">
    <span class="detail-meta-item detail-meta-date" aria-label="Kickoff ${escapeHTML(dateLabel)} at ${escapeHTML(timeLabel)}">
      ${detailMetaIcon("calendar")}<span><strong>${escapeHTML(dateLabel)}</strong><small>${escapeHTML(timeLabel)}</small></span>
    </span>
    <span class="detail-meta-item detail-meta-competition">
      ${leagueLogo ? `<img src="${escapeHTML(leagueLogo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : detailMetaIcon("competition")}
      <span>${escapeHTML(match.league)}${match.stage ? `<small>${escapeHTML(match.stage)}</small>` : ""}</span>
    </span>
    ${venue ? `<span class="detail-meta-item detail-meta-venue" title="${escapeHTML(venue)}">${detailMetaIcon("venue")}<span>${escapeHTML(venue)}</span></span>` : ""}
    ${broadcastLabel ? `<span class="detail-meta-item detail-meta-broadcast" title="${escapeHTML(broadcastTitle)}">${detailMetaIcon("broadcast")}<span>${escapeHTML(broadcastLabel)}</span></span>` : ""}
  </div>`;
}

function renderDetail() {
  const match = matchCache.get(selectedMatchId);
  if (!match) return showEmptyDetail();
  const panel = document.querySelector("#match-panel");
  const wasOpen = document.body.classList.contains("detail-open");
  const modal = window.matchMedia("(max-width: 720px)").matches;
  const detail = detailCache.get(match.id);
  detailEmptyElement.hidden = true;
  detailElement.hidden = false;
  panel.setAttribute("role", "dialog");
  if (modal) panel.setAttribute("aria-modal", "true");
  else panel.removeAttribute("aria-modal");
  document.body.classList.toggle("detail-modal-open", modal);
  document.body.classList.add("detail-open");
  detailElement.innerHTML = `
    <div class="detail-header">
      <button class="detail-close" type="button" data-action="close-detail" aria-label="Back to matches">← <span>Back to matches</span></button>
      <span class="detail-competition">Match centre</span>
    </div>
    <div class="detail-scoreboard">
      <div class="detail-team home">
        ${detailTeamMarkup(match.home)}
        <span class="detail-team-copy"><strong>${escapeHTML(match.home.name)}</strong>${match.home.record ? `<span class="detail-record">${escapeHTML(match.home.record)}</span>` : ""}</span>
      </div>
      <div class="detail-score">
        ${scoreMarkup(match)}
        <span class="detail-clock">${match.state === "in" ? '<span class="clock-dot"></span>' : ""}${escapeHTML(match.state === "pre" ? timeLabel(match.date) : match.displayClock || match.status)}</span>
      </div>
      <div class="detail-team away">
        <span class="detail-team-copy"><strong>${escapeHTML(match.away.name)}</strong>${match.away.record ? `<span class="detail-record">${escapeHTML(match.away.record)}</span>` : ""}</span>
        ${detailTeamMarkup(match.away)}
      </div>
      ${detailGoalEvents(match, detail)}
    </div>
    ${detailMetadataMarkup(match, detail)}
    ${detail && !detail.error
      ? detailMomentum(match, detail)
      : !detail
        ? '<section class="momentum-card momentum-loading" aria-label="Loading match momentum"><div class="momentum-heading"><div><span class="momentum-kicker">MATCH FLOW</span><h3>Match momentum</h3></div></div><div class="momentum-loading-state"><span class="loading-spinner" aria-hidden="true"></span>Loading reported match events…</div></section>'
        : ""}
    <div class="detail-tabs" role="tablist" aria-label="Match details">
      ${["overview", "statistics", "lineups", "standings", "h2h"].map((tab) => `<button class="detail-tab${selectedDetailTab === tab ? " active" : ""}" type="button" role="tab" aria-selected="${selectedDetailTab === tab}" data-detail-tab="${tab}">${tab === "overview" ? "Overview" : tab === "statistics" ? "Stats" : tab === "lineups" ? "Line-ups" : tab === "standings" ? "Table" : "H2H"}</button>`).join("")}
    </div>
    <div class="detail-tab-content">${detail ? detailTabMarkup(match, detail) : '<div class="detail-loading"><span class="loading-spinner" aria-hidden="true"></span>Loading match details…</div>'}</div>
    <button class="detail-follow${favorites.has(match.id) ? " selected" : ""}" type="button" data-action="detail-favorite" aria-pressed="${favorites.has(match.id)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91L12 3Z"></path></svg>
      ${favorites.has(match.id) ? "Following match" : "Follow match"}
    </button>`;
  if (!wasOpen && modal) panel.querySelector(".detail-close").focus();
}

async function loadMatchDetails(match) {
  if (detailCache.has(match.id)) return;
  try {
    const response = await fetch(`${API_BASE}/summary?event=${encodeURIComponent(match.id)}`);
    if (!response.ok) throw new Error(`Match details returned HTTP ${response.status}.`);
    const detail = await response.json();
    detailCache.set(match.id, detail);
    renderLiveBoard();
    if (selectedMatchId === match.id) renderDetail();
  } catch (error) {
    console.error(`Unable to load match details for ${match.id}.`, error);
    detailCache.set(match.id, { error: error.message });
    if (selectedMatchId === match.id) {
      detailElement.querySelector(".detail-tab-content").innerHTML = `<div class="detail-error">Match details could not be loaded. ${escapeHTML(error.message)}</div>`;
    }
  }
}

function selectMatch(matchId) {
  if (selectedMatchId === matchId) {
    if (!window.history.state?.touchlineMatch) syncUrlState({ push: true });
    renderDetail();
    return;
  }
  selectedMatchId = matchId;
  selectedDetailTab = "overview";
  selectedEventFilter = "all";
  syncUrlState({ push: true });
  renderMatches();
  renderDetail();
  const match = matchCache.get(matchId);
  if (match) loadMatchDetails(match);
}

function toggleFavorite(matchId) {
  const following = !favorites.has(matchId);
  if (following) favorites.add(matchId);
  else favorites.delete(matchId);
  try {
    localStorage.setItem("touchline-favorites", JSON.stringify([...favorites]));
  } catch (error) {
    console.error("Could not save match favorites.", error);
  }
  matches.forEach((match) => { match.favorite = favorites.has(match.id); });
  renderMatches();
  if (selectedMatchId === matchId) renderDetail();
  const match = matchCache.get(matchId);
  showToast(`${following ? "Following" : "Unfollowed"} ${match ? `${match.home.shortName} vs ${match.away.shortName}` : "match"}`);
}

function changeDate(date) {
  if (!date || date === selectedDate) return;
  selectedDate = date;
  matches = [];
  selectedMatchId = null;
  hasAutoSelectedMatch = false;
  showEmptyDetail();
  syncUrlState({ push: true });
  renderMatches();
  setLoading(true);
  loadMatches({ force: true });
}

function selectDefaultMatch() {
  const now = Date.now();
  const live = matches.filter((match) => match.state === "in");
  const upcoming = matches.filter((match) => match.state === "pre" && new Date(match.date).getTime() >= now)
    .sort((a, b) => compareCompetitionPriority(a, b) || new Date(a.date) - new Date(b.date));
  const followed = matches.filter((match) => favorites.has(match.id))
    .sort((a, b) => compareCompetitionPriority(a, b) || new Date(a.date) - new Date(b.date));
  const latest = matches.filter((match) => match.state === "post")
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return live[0] || upcoming[0] || followed[0] || latest[0] || null;
}

document.querySelector("#date-strip").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-date]");
  if (button) changeDate(button.dataset.date);
});

document.querySelector(".date-strip-wrap").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-day-step]");
  if (!button) return;
  const date = fromDateKey(selectedDate);
  date.setDate(date.getDate() + Number(button.dataset.dayStep));
  changeDate(toDateKey(date));
});

datePicker.addEventListener("change", () => {
  changeDate(datePicker.value);
});

document.querySelectorAll("[data-status]").forEach((button) => {
  button.addEventListener("click", () => setActiveStatus(button.dataset.status));
});

document.querySelectorAll(".nav-link[data-view]").forEach((button) => {
  button.addEventListener("click", () => setActiveStatus(button.dataset.view));
});

document.querySelector(".competition-sidebar").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-competition]");
  if (!button) return;
  activeCompetition = button.dataset.competition;
  renderMatches();
  syncUrlState();
});

document.querySelector("#clear-filters").addEventListener("click", () => {
  window.clearTimeout(searchTimeout);
  activeStatus = "all";
  activeCompetition = "all";
  searchTerm = "";
  searchInput.value = "";
  competitionSearchTerm = "";
  competitionSearchInput.value = "";
  renderMatches();
  syncUrlState();
});

listElement.addEventListener("click", (event) => {
  const favoriteButton = event.target.closest('[data-action="favorite"]');
  if (favoriteButton) {
    event.stopPropagation();
    const match = favoriteButton.closest("[data-match]");
    if (match) toggleFavorite(match.dataset.match);
    return;
  }
  const leagueButton = event.target.closest(".league-heading");
  if (leagueButton) {
    if (leagueButton.dataset.view) {
      setActiveStatus(leagueButton.dataset.view);
      return;
    }
    activeCompetition = activeCompetition === leagueButton.dataset.league ? "all" : leagueButton.dataset.league;
    renderMatches();
    syncUrlState();
    return;
  }
  const matchButton = event.target.closest(".match-select");
  if (matchButton) {
    const match = matchButton.closest("[data-match]");
    if (match) selectMatch(match.dataset.match);
  }
});

document.querySelector("#live-board-grid").addEventListener("click", (event) => {
  const card = event.target.closest("[data-live-match]");
  if (card) selectMatch(card.dataset.liveMatch);
});

const liveScoreTrack = document.querySelector("#live-score-strip-track");
liveScoreTrack.addEventListener("click", (event) => {
  const item = event.target.closest("[data-live-strip-match]");
  if (item) selectMatch(item.dataset.liveStripMatch);
});
liveScoreTrack.addEventListener("scroll", updateLiveScoreArrows, { passive: true });
document.querySelector(".live-score-strip").addEventListener("click", (event) => {
  const arrow = event.target.closest("[data-live-scroll]");
  if (!arrow) return;
  liveScoreTrack.scrollBy({
    left: Number(arrow.dataset.liveScroll) * Math.max(220, liveScoreTrack.clientWidth * 0.75),
    behavior: "smooth",
  });
});
window.addEventListener("resize", updateLiveScoreArrows);

document.querySelector("#live-board").addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) setActiveStatus(viewButton.dataset.view);
});

detailElement.addEventListener("click", (event) => {
  const closeButton = event.target.closest('[data-action="close-detail"]');
  if (closeButton) {
    closeMatchDetail();
    return;
  }
  const favoriteButton = event.target.closest('[data-action="detail-favorite"]');
  if (favoriteButton && selectedMatchId) {
    toggleFavorite(selectedMatchId);
    return;
  }
  const tab = event.target.closest("[data-detail-tab]");
  if (tab) {
    selectedDetailTab = tab.dataset.detailTab;
    renderDetail();
    return;
  }
  const eventFilter = event.target.closest("[data-event-filter]");
  if (eventFilter) {
    selectedEventFilter = eventFilter.dataset.eventFilter;
    renderDetail();
    detailElement.querySelector(`[data-event-filter="${selectedEventFilter}"]`)?.focus();
  }
});

searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimeout);
  searchTimeout = window.setTimeout(() => {
    searchTerm = searchInput.value.trim();
    renderMatches();
  }, SEARCH_DEBOUNCE);
});

competitionSearchInput.addEventListener("input", () => {
  competitionSearchTerm = competitionSearchInput.value.trim().toLocaleLowerCase();
  renderCompetitionFilters();
});

document.querySelector("#refresh-button").addEventListener("click", () => loadMatches({ force: true }));
document.querySelector("#retry-button").addEventListener("click", () => loadMatches({ force: true }));
themeButton.addEventListener("click", () => setThemeMenuOpen(themeMenu.hidden));
themeOptions.forEach((option) => {
  option.addEventListener("click", () => {
    applyTheme(option.dataset.themeChoice);
    setThemeMenuOpen(false);
    themeButton.focus();
    showToast(`${THEME_NAMES[option.dataset.themeChoice]} theme applied`);
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".theme-picker")) setThemeMenuOpen(false);
});

window.addEventListener("popstate", () => {
  const route = readRouteState();
  const dateChanged = route.date !== selectedDate;
  selectedDate = route.date;
  activeStatus = route.status;
  activeCompetition = route.competition;
  selectedMatchId = route.match || null;
  if (dateChanged || !selectedMatchId) showEmptyDetail();
  renderMatches();
  if (dateChanged) {
    matches = [];
    hasAutoSelectedMatch = true;
    setLoading(true);
    loadMatches({ force: true });
  } else if (selectedMatchId && matchCache.has(selectedMatchId)) {
    renderDetail();
    loadMatchDetails(matchCache.get(selectedMatchId));
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    window.clearTimeout(refreshTimeout);
    refreshTimeout = 0;
    scoreRequestController?.abort();
  } else {
    loadMatches({ force: true });
  }
});

window.addEventListener("resize", () => {
  const modal = window.matchMedia("(max-width: 720px)").matches;
  document.body.classList.toggle("detail-modal-open", Boolean(selectedMatchId) && modal);
  const panel = document.querySelector("#match-panel");
  if (selectedMatchId && modal) panel.setAttribute("aria-modal", "true");
  else panel.removeAttribute("aria-modal");
  if (!hasAutoSelectedMatch && matches.length && window.matchMedia("(min-width: 721px)").matches) {
    const match = selectDefaultMatch();
    hasAutoSelectedMatch = true;
    if (match) {
      selectedMatchId = match.id;
      renderMatches();
      renderDetail();
      loadMatchDetails(match);
    }
  }
});

document.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLElement
    && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
  if (!typing && themeMenu.hidden && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (event.key === "?") {
      event.preventDefault();
      showToast("Shortcuts: / search · J/K browse matches · F follow · Esc close");
      return;
    }
    if (event.key.toLowerCase() === "f" && selectedMatchId) {
      event.preventDefault();
      toggleFavorite(selectedMatchId);
      return;
    }
    if (["j", "k"].includes(event.key.toLowerCase())) {
      const orderedMatches = visibleMatches().sort((first, second) =>
        new Date(first.date) - new Date(second.date));
      if (orderedMatches.length) {
        event.preventDefault();
        const currentIndex = orderedMatches.findIndex((match) => match.id === selectedMatchId);
        const step = event.key.toLowerCase() === "j" ? 1 : -1;
        const nextIndex = currentIndex < 0
          ? (step > 0 ? 0 : orderedMatches.length - 1)
          : (currentIndex + step + orderedMatches.length) % orderedMatches.length;
        selectMatch(orderedMatches[nextIndex].id);
      }
      return;
    }
  }
  if (!themeMenu.hidden) {
    if (event.key === "Escape") {
      setThemeMenuOpen(false);
      themeButton.focus();
      return;
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const currentIndex = themeOptions.indexOf(document.activeElement);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = currentIndex === -1
        ? (direction > 0 ? 0 : themeOptions.length - 1)
        : (currentIndex + direction + themeOptions.length) % themeOptions.length;
      themeOptions[nextIndex].focus();
    }
  }
  if (document.body.classList.contains("detail-open") && event.key === "Tab") {
    const panel = document.querySelector("#match-panel");
    const focusable = [...panel.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const currentIndex = focusable.indexOf(document.activeElement);
    if (currentIndex === -1 && first) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && currentIndex === 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
      event.preventDefault();
      first.focus();
    }
  }
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === "Escape" && document.activeElement === searchInput) {
    searchInput.value = "";
    searchInput.blur();
    searchTerm = "";
    renderMatches();
  } else if (event.key === "Escape" && selectedMatchId) {
    closeMatchDetail();
  }
});

document.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse") return;
  if (!(event.target instanceof Element)) return;
  const card = event.target.closest(".match-row, .live-card, .date-choice, .competition-option");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  card.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`);
  card.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`);
}, { passive: true });

window.addEventListener("scroll", () => {
  document.body.classList.toggle("scrolled", window.scrollY > 12);
}, { passive: true });

renderDates();
renderMatches();
loadMatches().finally(scheduleRefresh);
