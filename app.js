const API_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/all";
const REFRESH_INTERVAL = 60_000;
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
const themeButton = document.querySelector(".theme-button");
const detailElement = document.querySelector("#detail-content");
const detailEmptyElement = document.querySelector("#detail-empty");
const detailBackdrop = document.querySelector("#detail-backdrop");
const matchCache = new Map();
const detailCache = new Map();
const currentDate = new Date();
let selectedDate = toDateKey(currentDate);
let matches = [];
let selectedMatchId = null;
let activeStatus = "all";
let activeCompetition = "all";
let searchTerm = "";
let requestInProgress = false;
let scoreRequestController = null;
let selectedDetailTab = "overview";

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

function setFeedStatus(state, text) {
  const element = document.querySelector("#feed-status");
  element.className = `feed-status ${state}`;
  document.querySelector("#feed-status-text").textContent = text;
}

function setTheme(theme, persist = false) {
  const isLight = theme === "light";
  document.body.classList.toggle("light-theme", isLight);
  themeButton.setAttribute("aria-pressed", String(isLight));
  themeButton.title = isLight ? "Switch to dark theme" : "Switch to light theme";
  if (!persist) return;
  try {
    localStorage.setItem("touchline-theme", isLight ? "light" : "dark");
  } catch (error) {
    console.error("Could not save the color theme.", error);
  }
}

function timeLabel(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "Time TBC";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
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
    home: normalizeTeam(home, 0),
    away: normalizeTeam(away, 1),
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
  const options = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  competitionListElement.innerHTML = options.map(([name, info]) => `
    <button class="competition-option${activeCompetition === name ? " selected" : ""}" type="button" data-competition="${escapeHTML(name)}" aria-pressed="${activeCompetition === name}">
      <span class="competition-icon" aria-hidden="true">${escapeHTML(name.slice(0, 1))}</span>
      <span class="competition-option-label">${escapeHTML(name)}${info.live ? '<span class="competition-live-dot"></span>' : ""}</span>
      <span class="competition-count">${info.count}</span>
    </button>
  `).join("");
  const allOption = document.querySelector('[data-competition="all"]');
  allOption.classList.toggle("selected", activeCompetition === "all");
  allOption.setAttribute("aria-pressed", String(activeCompetition === "all"));
  document.querySelector("#all-count").textContent = matches.length;
}

function matchClock(match) {
  if (match.state === "in") {
    const clock = match.displayClock || match.status;
    return `<span class="match-clock live-clock"><span class="clock-dot"></span>${escapeHTML(clock)}</span>`;
  }
  if (match.state === "post") {
    return `<span class="match-clock finished-clock">${escapeHTML(match.status || "FT")}</span>`;
  }
  return `<span class="match-clock upcoming-clock">${escapeHTML(timeLabel(match.date))}</span>`;
}

function scoreMarkup(match) {
  if (match.state === "pre") {
    return '<span class="score upcoming-score">VS</span>';
  }
  return `<span class="score"><span class="${match.home.winner ? "winner" : ""}">${escapeHTML(match.home.score ?? "0")}</span><span class="score-separator">:</span><span class="${match.away.winner ? "winner" : ""}">${escapeHTML(match.away.score ?? "0")}</span></span>`;
}

function teamMarkup(team, side) {
  const badge = team.logo
    ? `<span class="team-badge"><img src="${escapeHTML(team.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"><span class="team-initials">${escapeHTML(team.abbreviation.slice(0, 3))}</span></span>`
    : `<span class="team-badge no-logo" style="--team-color:${escapeHTML(team.color)}"><span class="team-initials">${escapeHTML(team.abbreviation.slice(0, 3))}</span></span>`;
  return `<span class="team team-${side}${side === "away" ? " away-team" : ""}">
    ${side === "home" ? badge : ""}
    <span class="team-label"><span class="team-name">${escapeHTML(team.shortName)}</span><span class="team-record">${escapeHTML(team.record)}</span></span>
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

function renderMatch(match) {
  const selected = match.id === selectedMatchId;
  return `<article class="match-row${selected ? " selected" : ""}" data-match="${escapeHTML(match.id)}">
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

function renderMatches() {
  const filtered = visibleMatches().sort((a, b) => {
    const stateOrder = { in: 0, pre: 1, post: 2 };
    return (stateOrder[a.state] ?? 3) - (stateOrder[b.state] ?? 3)
      || new Date(a.date) - new Date(b.date);
  });
  const groups = new Map();
  for (const match of filtered) {
    if (!groups.has(match.league)) groups.set(match.league, []);
    groups.get(match.league).push(match);
  }
  listElement.innerHTML = [...groups.entries()].map(([league, leagueMatches]) => `
    <section class="league-group">
      <button class="league-heading" type="button" data-league="${escapeHTML(league)}" aria-label="Filter by ${escapeHTML(league)}">
        <span class="league-mark">${escapeHTML(league.slice(0, 1))}</span>
        <span class="league-title">${escapeHTML(league)}${leagueMatches[0].stage ? `<small>${escapeHTML(leagueMatches[0].stage)}</small>` : ""}</span>
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
  renderCompetitionFilters();
  renderDates();
}

function setActiveStatus(status) {
  activeStatus = status;
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
}

function setLoading(isLoading) {
  document.querySelector("#loading-state").hidden = !isLoading;
  if (isLoading && matches.length === 0) listElement.hidden = true;
}

function renderUpdatedTime() {
  document.querySelector("#updated-label").textContent = `Updated ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}`;
}

async function loadMatches({ force = false } = {}) {
  if (requestInProgress && !force) return;
  scoreRequestController?.abort();
  const controller = new AbortController();
  scoreRequestController = controller;
  const requestDate = selectedDate;
  requestInProgress = true;
  setLoading(matches.length === 0);
  setFeedStatus("loading", "UPDATING SCORES");
  document.querySelector("#error-banner").hidden = true;
  try {
    const url = `${API_BASE}/scoreboard?dates=${toApiDate(requestDate)}`;
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (requestDate !== selectedDate) return;
    if (!response.ok) throw new Error(`The scores feed returned HTTP ${response.status}.`);
    const data = await response.json();
    if (!Array.isArray(data.events)) throw new Error("The scores feed returned an unexpected response.");
    matches = data.events.map(normalizeMatch);
    for (const match of matches) matchCache.set(match.id, match);
    if (!selectedMatchId || !matchCache.has(selectedMatchId)) {
      selectedMatchId = null;
      showEmptyDetail();
    }
    setFeedStatus("connected", "SCORES CONNECTED");
    document.querySelector("#error-banner").hidden = true;
    renderMatches();
    renderUpdatedTime();
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
    document.querySelector("#error-message").textContent = `${error.message} Check your connection and retry.`;
    document.querySelector("#error-banner").hidden = false;
    if (!matches.length) {
      listElement.hidden = true;
      document.querySelector("#empty-state").hidden = true;
    }
  } finally {
    if (scoreRequestController === controller) {
      requestInProgress = false;
      setLoading(false);
    }
  }
}

function showEmptyDetail() {
  detailEmptyElement.hidden = false;
  detailElement.hidden = true;
  detailElement.innerHTML = "";
  document.querySelector("#match-panel").classList.remove("mobile-open");
  document.body.classList.remove("detail-open");
  detailBackdrop.hidden = true;
}

function closeDetail() {
  selectedMatchId = null;
  showEmptyDetail();
  renderMatches();
}

function detailTeamMarkup(team) {
  if (team.logo) {
    return `<span class="detail-team-badge"><img src="${escapeHTML(team.logo)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><span>${escapeHTML(team.abbreviation)}</span></span>`;
  }
  return `<span class="detail-team-badge no-logo" style="--team-color:${escapeHTML(team.color)}">${escapeHTML(team.abbreviation)}</span>`;
}

function detailOverview(match, detail) {
  const competition = detail?.header?.competitions?.[0] ?? {};
  const events = detail?.keyEvents ?? [];
  const recentGames = detail?.lastFiveGames ?? [];
  const timeline = events.length
    ? events.map((item) => `<div class="timeline-item"><span class="timeline-minute">${escapeHTML(item.clock?.displayValue || item.period?.number || "")}</span><span class="timeline-icon">${escapeHTML(eventIcon(item.type?.text))}</span><span class="timeline-text">${escapeHTML(item.text || item.shortText || item.type?.text || "Match event")}</span></div>`).join("")
    : '<div class="detail-placeholder">No match events have been reported yet.</div>';
  const gameInfo = [
    competition.venue?.fullName || match.venue,
    [competition.venue?.address?.city || match.city, competition.venue?.address?.country || match.country].filter(Boolean).join(", "),
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
  return `<div class="detail-section"><h3>Match timeline</h3><div class="timeline">${timeline}</div></div>
    <div class="detail-section"><h3>Match information</h3><div class="info-list">${info}</div></div>${form ? `<div class="detail-section"><h3>Recent form</h3>${form}</div>` : ""}${news}`;
}

function eventIcon(type) {
  if (/goal|score/i.test(type ?? "")) return "⚽";
  if (/card/i.test(type ?? "")) return "▰";
  if (/sub/i.test(type ?? "")) return "↔";
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

function lineupTeamMarkup(roster) {
  const rosteredPlayers = roster.roster ?? [];
  const starters = rosteredPlayers.filter((entry) => entry.starter);
  const players = starters.length ? starters : rosteredPlayers.filter((entry) => entry.active);
  const substitutes = rosteredPlayers.filter((entry) => !entry.starter && (entry.active || entry.subbedIn));
  const playerRows = (entries) => entries.map((entry) => `<div class="player-row"><span class="player-number">${escapeHTML(entry.jersey?.displayValue || entry.jersey || "—")}</span><span class="player-name">${escapeHTML(entry.athlete?.displayName || entry.athlete?.shortName || "Player")}</span><span class="player-position">${escapeHTML(entry.position?.abbreviation || "")}</span></div>`).join("");
  const playersMarkup = players.length
    ? `<div class="lineup-label">Starting line-up</div>${playerRows(players)}${substitutes.length ? `<div class="lineup-label substitutes-label">Substitutes</div>${playerRows(substitutes)}` : ""}`
    : '<div class="detail-placeholder">Starting line-up has not been published.</div>';
  return `<section class="lineup-team"><h4>${escapeHTML(roster.team?.displayName || "Team")}<span>${escapeHTML(roster.formation || "")}</span></h4>${playersMarkup}</section>`;
}

function detailLineups(detail) {
  const rosters = detail?.rosters ?? [];
  return rosters.length
    ? `<div class="lineups-list">${rosters.map(lineupTeamMarkup).join("")}</div>`
    : '<div class="detail-placeholder">Line-ups are not available for this match.</div>';
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

function renderDetail() {
  const match = matchCache.get(selectedMatchId);
  if (!match) return showEmptyDetail();
  const detail = detailCache.get(match.id);
  detailEmptyElement.hidden = true;
  detailElement.hidden = false;
  detailElement.innerHTML = `
    <div class="detail-header">
      <button class="detail-close" type="button" data-action="close-detail" aria-label="Close match details">×</button>
      <span class="detail-competition">${escapeHTML(match.league)}${match.stage ? ` · ${escapeHTML(match.stage)}` : ""}</span>
      <span class="detail-match-date">${escapeHTML(new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(match.date)))}</span>
    </div>
    <div class="detail-scoreboard">
      <div class="detail-team">${detailTeamMarkup(match.home)}<strong>${escapeHTML(match.home.name)}</strong><span class="detail-record">${escapeHTML(match.home.record)}</span></div>
      <div class="detail-score">${scoreMarkup(match)}<span class="detail-clock">${match.state === "in" ? '<span class="clock-dot"></span>' : ""}${escapeHTML(match.state === "pre" ? timeLabel(match.date) : match.status)}</span></div>
      <div class="detail-team">${detailTeamMarkup(match.away)}<strong>${escapeHTML(match.away.name)}</strong><span class="detail-record">${escapeHTML(match.away.record)}</span></div>
    </div>
    <div class="detail-tabs" role="tablist" aria-label="Match details">
      ${["overview", "statistics", "lineups", "standings", "h2h"].map((tab) => `<button class="detail-tab${selectedDetailTab === tab ? " active" : ""}" type="button" role="tab" aria-selected="${selectedDetailTab === tab}" data-detail-tab="${tab}">${tab === "overview" ? "Overview" : tab === "statistics" ? "Stats" : tab === "lineups" ? "Line-ups" : tab === "standings" ? "Table" : "H2H"}</button>`).join("")}
    </div>
    <div class="detail-tab-content">${detail ? detailTabMarkup(match, detail) : '<div class="detail-loading"><span class="loading-spinner" aria-hidden="true"></span>Loading match details…</div>'}</div>
    <button class="detail-follow${favorites.has(match.id) ? " selected" : ""}" type="button" data-action="detail-favorite" aria-pressed="${favorites.has(match.id)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91L12 3Z"></path></svg>
      ${favorites.has(match.id) ? "Following match" : "Follow match"}
    </button>`;
  document.querySelector("#match-panel").classList.add("mobile-open");
  document.body.classList.add("detail-open");
  detailBackdrop.hidden = false;
}

async function loadMatchDetails(match) {
  if (detailCache.has(match.id)) return;
  try {
    const response = await fetch(`${API_BASE}/summary?event=${encodeURIComponent(match.id)}`);
    if (!response.ok) throw new Error(`Match details returned HTTP ${response.status}.`);
    const detail = await response.json();
    detailCache.set(match.id, detail);
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
  selectedMatchId = matchId;
  selectedDetailTab = "overview";
  renderMatches();
  renderDetail();
  const match = matchCache.get(matchId);
  if (match) loadMatchDetails(match);
}

function toggleFavorite(matchId) {
  if (favorites.has(matchId)) favorites.delete(matchId);
  else favorites.add(matchId);
  try {
    localStorage.setItem("touchline-favorites", JSON.stringify([...favorites]));
  } catch (error) {
    console.error("Could not save match favorites.", error);
  }
  matches.forEach((match) => { match.favorite = favorites.has(match.id); });
  renderMatches();
  if (selectedMatchId === matchId) renderDetail();
}

document.querySelector("#date-strip").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-date]");
  if (!button || button.dataset.date === selectedDate) return;
  selectedDate = button.dataset.date;
  matches = [];
  selectedMatchId = null;
  showEmptyDetail();
  renderMatches();
  setLoading(true);
  loadMatches({ force: true });
});

document.querySelector(".date-strip-wrap").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-day-step]");
  if (!button) return;
  const date = fromDateKey(selectedDate);
  date.setDate(date.getDate() + Number(button.dataset.dayStep));
  selectedDate = toDateKey(date);
  matches = [];
  selectedMatchId = null;
  showEmptyDetail();
  renderMatches();
  setLoading(true);
  loadMatches({ force: true });
});

datePicker.addEventListener("change", () => {
  if (!datePicker.value || datePicker.value === selectedDate) return;
  selectedDate = datePicker.value;
  matches = [];
  selectedMatchId = null;
  showEmptyDetail();
  renderMatches();
  setLoading(true);
  loadMatches({ force: true });
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
});

document.querySelector("#clear-competition").addEventListener("click", () => {
  activeCompetition = "all";
  renderMatches();
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
    activeCompetition = activeCompetition === leagueButton.dataset.league ? "all" : leagueButton.dataset.league;
    renderMatches();
    return;
  }
  const matchButton = event.target.closest(".match-select");
  if (matchButton) {
    const match = matchButton.closest("[data-match]");
    if (match) selectMatch(match.dataset.match);
  }
});

detailElement.addEventListener("click", (event) => {
  const closeButton = event.target.closest('[data-action="close-detail"]');
  if (closeButton) {
    closeDetail();
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
  }
});

detailBackdrop.addEventListener("click", closeDetail);

searchInput.addEventListener("input", () => {
  searchTerm = searchInput.value.trim();
  renderMatches();
});

document.querySelector("#refresh-button").addEventListener("click", () => loadMatches({ force: true }));
document.querySelector("#retry-button").addEventListener("click", () => loadMatches({ force: true }));
let initialTheme = "dark";
try {
  initialTheme = localStorage.getItem("touchline-theme") === "light" ? "light" : "dark";
} catch (error) {
  console.error("Browser storage is unavailable; using the default color theme.", error);
}
setTheme(initialTheme);
themeButton.addEventListener("click", () => {
  setTheme(document.body.classList.contains("light-theme") ? "dark" : "light", true);
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
    renderMatches();
  } else if (event.key === "Escape" && selectedMatchId) {
    closeDetail();
  }
});

renderDates();
renderMatches();
loadMatches();
window.setInterval(() => {
  if (!document.hidden) loadMatches();
}, REFRESH_INTERVAL);
