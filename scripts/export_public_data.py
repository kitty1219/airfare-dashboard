"""Export privacy-safe aggregate airfare data for the public dashboard.

The SQLite database is read-only and is never copied into the public project.
Only grouped price statistics and batch counts are written to JSON.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path


METRICS = ("min", "max", "mean", "median", "q25", "q75")


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * pct
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def rounded(value: float | None) -> int | None:
    return int(round(value)) if value is not None else None


def stats(values: list[float]) -> dict[str, int | None]:
    return {
        "count": len(values),
        "min": rounded(min(values)) if values else None,
        "max": rounded(max(values)) if values else None,
        "mean": rounded(sum(values) / len(values)) if values else None,
        "median": rounded(percentile(values, 0.5)),
        "q25": rounded(percentile(values, 0.25)),
        "q75": rounded(percentile(values, 0.75)),
    }


def export(db_path: Path, output_path: Path) -> None:
    uri = f"{db_path.resolve().as_uri()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row

    rows = conn.execute(
        """
        SELECT scrape_date, scrape_time, flight_date, route, days_to_depart,
               airline, flight_no, dep_time, price, batch_no
        FROM flights_raw
        WHERE price IS NOT NULL
        ORDER BY scrape_date, flight_date, route
        """
    ).fetchall()

    daily_groups: dict[tuple[str, str, int], list[float]] = defaultdict(list)
    tracker_groups: dict[tuple[str, str, str], dict] = {}
    flight_groups: dict[tuple[str, str, str, str, str], list[float]] = defaultdict(list)
    coverage_groups: dict[tuple[str, str], set[int]] = defaultdict(set)

    for row in rows:
        route = row["route"]
        flight_date = row["flight_date"]
        scrape_date = row["scrape_date"]
        days = int(row["days_to_depart"])
        price = float(row["price"])
        daily_groups[(route, flight_date, days)].append(price)
        tracker = tracker_groups.setdefault(
            (route, flight_date, scrape_date),
            {"values": [], "days": []},
        )
        tracker["values"].append(price)
        tracker["days"].append(days)
        flight_groups[(
            route,
            flight_date,
            row["flight_no"] or "未标注航班",
            row["airline"] or "—",
            row["dep_time"] or "—",
        )].append(price)
        batch = int(row["batch_no"] or 0)
        if 1 <= batch <= 7:
            coverage_groups[(scrape_date, route)].add(batch)

    daily = [
        {"route": route, "flightDate": flight_date, "days": days, **stats(values)}
        for (route, flight_date, days), values in sorted(daily_groups.items())
    ]
    tracker = [
        {
            "route": route,
            "flightDate": flight_date,
            "scrapeDate": scrape_date,
            "daysToDepart": min(group["days"]),
            **stats(group["values"]),
        }
        for (route, flight_date, scrape_date), group in sorted(tracker_groups.items())
    ]
    flights = [
        {
            "route": route,
            "flightDate": flight_date,
            "flightNo": flight_no,
            "airline": airline,
            "depTime": dep_time,
            **stats(values),
        }
        for (route, flight_date, flight_no, airline, dep_time), values in sorted(flight_groups.items())
    ]
    coverage = [
        {"date": date, "route": route, "batches": len(batches)}
        for (date, route), batches in sorted(coverage_groups.items())
    ]

    dates = [row["scrape_date"] for row in rows]
    scrape_times = [row["scrape_time"] for row in rows]
    routes = sorted({row["route"] for row in rows})
    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "priceBasis": "监测票面价（不含机建、燃油等附加费）",
        "sourceSummary": {
            "scrapeDateRange": [min(dates), max(dates)],
            "latestScrapeTime": max(scrape_times),
            "aggregateSourceRows": len(rows),
            "routeCount": len(routes),
        },
        "routes": routes,
        "daily": daily,
        "tracker": tracker,
        "flights": flights,
        "coverage": coverage,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Exported {output_path}")
    print(f"Routes: {len(routes)}; daily aggregates: {len(daily)}; tracker aggregates: {len(tracker)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, required=True, help="Path to the private SQLite database")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public" / "data" / "dashboard_data.json",
    )
    args = parser.parse_args()
    if not args.db.exists():
        parser.error(f"Database not found: {args.db}")
    export(args.db, args.output)


if __name__ == "__main__":
    main()

