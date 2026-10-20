# Touchline

Touchline is a browser-based football scoreboard for daily fixtures, live scores, results, and match details.

## Run locally

Serve this folder over HTTP so the browser can request the score feed:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Match data

The page reads football fixtures from ESPN's public scoreboard endpoint and requests ESPN match summaries when a fixture is selected. It refreshes the selected day's scores once per minute. There are no simulated score changes or API keys in the project.

The feed covers many competitions around the world, but it does not guarantee every match or every competition. Match events, statistics, line-ups, standings, venue and broadcast information are shown when ESPN supplies them. An internet connection is required.

## Features

- Browse dates, search fixtures, and filter by match status or competition.
- Find fixtures with broadcast information listed in the feed; broadcast availability is region-dependent.
- Follow matches; favorites persist in the browser.
- Open a match for its timeline, statistics, line-ups, standings, venue and broadcast details when available.
- Refresh scores automatically or on demand; unavailable feed data is shown as an error rather than replaced with sample scores.
