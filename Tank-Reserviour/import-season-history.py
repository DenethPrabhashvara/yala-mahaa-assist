#!/usr/bin/env python3
"""Load recent effective storage from the season CSVs into reservoir_levels.

The tank forecast needs at least 15 days of readings per reservoir, but reservious_daily.py
only gets today's reading. This backfills the gap from the same CSVs the model was trained
on ("Reservoir Water Level - Major Yala.csv", "... Medium_Maha.csv", and so on).

  py import-season-history.py "C:\\path\\Reservoir Water Level - Major Yala.csv" "...Medium_Yala.csv"
  py import-season-history.py --days 120 *.csv

Columns are read the way the training notebook reads them:
  'EFFECTIVE STORAGE (Acft) 2026'  Yala files: the number is the calendar year
  'ES_25_26_Acft'                  Maha files: the newest column matches the file's dates
Values go into usable_storage_acft (the source's "Effective Storage_Acft"). Rows that already
exist for a reservoir and date are left alone, so readings from reservious_daily.py win.
Database settings come from DB_* / APIDB* environment variables, or else API/config.env.
"""
import argparse
import csv
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

CONFIG_ENV = Path(__file__).resolve().parent.parent / "API" / "config.env"


def read_config_env():
    values = {}
    if CONFIG_ENV.exists():
        for line in CONFIG_ENV.read_text(encoding="utf-8").splitlines():
            m = re.match(r"\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$", line)
            if m:
                values[m.group(1)] = m.group(2).strip()
    return values


def db_config():
    cfg = read_config_env()

    def pick(*names, default=None):
        for name in names:
            if os.getenv(name):
                return os.getenv(name)
        for name in names:
            if cfg.get(name):
                return cfg[name]
        return default

    return {
        "host": pick("APIDBHOST", "DB_HOST", default="localhost"),
        "port": int(pick("APIDBPORT", "DB_PORT", default="5432")),
        "dbname": pick("APIDATABASE", "DB_NAME", default="yala-maha-api"),
        "user": pick("APIDBUSERN", "DB_USER", default="postgres"),
        "password": pick("APIDBPASSWORD", "DB_PASSWORD", default=""),
    }


def to_number(raw):
    text = (raw or "").strip().replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None  # '-' or blank


def with_year(d, year):
    try:
        return d.replace(year=year)
    except ValueError:  # 29 Feb in a non-leap year
        return d.replace(year=year, day=28)


def read_season_file(path):
    """Yield (reservoir name, date, effective storage) from one wide season CSV."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        columns = [c.strip() for c in reader.fieldnames]
        reader.fieldnames = columns
        lower = {c.lower(): c for c in columns}
        name_c = lower["reservoir"]
        date_c = next(c for c in columns if c.lower() in ("update date", "updated date"))

        yala = {}
        for c in columns:
            m = re.search(r"EFFECTIVE STORAGE.*?(\d{4})\s*$", c, re.I)
            if m:
                yala[c] = int(m.group(1))
        maha = {c: int(m.group(1)) for c in columns if (m := re.fullmatch(r"ES_(\d\d)_(\d\d)_Acft", c))}
        newest = max(maha.values()) if maha else None

        for row in reader:
            name = (row.get(name_c) or "").strip()
            raw_date = (row.get(date_c) or "").strip()
            if not name or not raw_date:
                continue
            day = datetime.strptime(raw_date, "%m/%d/%Y").date()
            for c, year in yala.items():
                yield name, with_year(day, year), to_number(row.get(c))
            for c, start in maha.items():
                yield name, with_year(day, day.year - (newest - start)), to_number(row.get(c))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("files", nargs="+", type=Path, help="Season CSV files")
    parser.add_argument("--days", type=int, default=90,
                        help="Only load readings from the last N days (default 90, what the forecast uses)")
    args = parser.parse_args()

    since = date.today() - timedelta(days=args.days)
    readings = {}
    for path in args.files:
        if not path.exists():
            sys.exit(f"File not found: {path}")
        count = 0
        for name, day, storage in read_season_file(path):
            if storage is not None and since <= day <= date.today():
                readings[(name, day)] = storage  # later files win, like the notebook's .last()
                count += 1
        print(f"{path.name}: {count} readings since {since}")

    if not readings:
        print("Nothing to load: no readings in that date range.")
        return 0

    conn = psycopg2.connect(**db_config())
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT id, name FROM reservoirs")
            ids = {}
            for rid, name in cur.fetchall():
                ids[name.strip().lower()] = rid

            rows, unknown = [], set()
            for (name, day), storage in sorted(readings.items()):
                rid = ids.get(name.lower())
                if rid is None:
                    unknown.add(name)
                else:
                    rows.append((rid, day, storage))

            inserted = execute_values(
                cur,
                """INSERT INTO reservoir_levels (reservoir_id, reading_date, usable_storage_acft)
                   VALUES %s
                   ON CONFLICT (reservoir_id, reading_date) DO NOTHING
                   RETURNING 1""",
                rows, page_size=1000, fetch=True,
            )
    finally:
        conn.close()

    days = sorted({day for (_, day) in readings})
    print(f"Loaded {len(inserted)} new readings for {len({r[0] for r in rows})} reservoirs "
          f"({days[0]} to {days[-1]}); {len(rows) - len(inserted)} already existed.")
    if unknown:
        print(f"Not in the reservoirs table (skipped): {', '.join(sorted(unknown))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
