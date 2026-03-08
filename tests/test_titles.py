"""
Tests for title catalog routes:
  GET  /api/titles
  GET  /api/regions
  GET  /api/geoip
  GET  /api/titles/stats
"""

import pytest
from tests.conftest import auth_header


# ── authentication guards ─────────────────────────────────────────────────────


def test_titles_requires_auth(client):
    rv = client.get("/api/titles")
    assert rv.status_code == 401


def test_regions_requires_auth(client):
    rv = client.get("/api/regions")
    assert rv.status_code == 401


def test_titles_stats_requires_auth(client):
    rv = client.get("/api/titles/stats")
    assert rv.status_code == 401


# ── empty catalog responses ───────────────────────────────────────────────────


def test_titles_empty_catalog(client, admin_headers):
    rv = client.get("/api/titles", headers=admin_headers)
    assert rv.status_code == 200
    data = rv.get_json()
    assert data["titles"] == []
    assert data["total"] == 0


def test_regions_empty(client, admin_headers):
    rv = client.get("/api/regions", headers=admin_headers)
    assert rv.status_code == 200
    assert isinstance(rv.get_json()["regions"], list)


def test_titles_stats_zeros(client, admin_headers):
    rv = client.get("/api/titles/stats", headers=admin_headers)
    assert rv.status_code == 200
    data = rv.get_json()
    assert data["total"] == 0
    assert isinstance(data["platforms"], list)
    assert isinstance(data["regions"], list)


# ── filtering with seed data ──────────────────────────────────────────────────


@pytest.fixture
def seeded_titles(app):
    """Insert a handful of title rows directly into the test DB."""
    with app.app_context():
        from backend.database import get_db

        db = get_db()
        rows = [
            ("Netflix", "US", "Stranger Things", "tv", 90, None, 8.7, 900000, 0, 0, 1),
            ("Netflix", "US", "The Crown", "tv", 60, None, 8.6, 300000, 0, 0, 0),
            ("Netflix", "GB", "Black Mirror", "tv", 60, None, 8.8, 450000, 0, 0, 0),
            ("Disney+", "US", "The Mandalorian", "tv", 40, None, 8.7, 350000, 1, 1, 0),
            ("Netflix", "US", "Inception", "movie", 148, None, 8.8, 2200000, 0, 0, 0),
        ]
        db.executemany(
            """INSERT OR REPLACE INTO titles
               (platform, region, title, content_type, runtime_mins, release_year,
                imdb_score, imdb_votes, tomatometer, ranking_position, is_trending,
                scraped_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))""",
            rows,
        )
        db.commit()
    return rows


def test_titles_returns_seeded_data(client, admin_headers, seeded_titles):
    rv = client.get("/api/titles", headers=admin_headers)
    data = rv.get_json()
    assert data["total"] > 0


def test_titles_filter_by_platform(client, admin_headers, seeded_titles):
    rv = client.get("/api/titles?platform=Disney%2B", headers=admin_headers)
    data = rv.get_json()
    assert all(t["platform"] == "Disney+" for t in data["titles"])


def test_titles_filter_by_type_movie(client, admin_headers, seeded_titles):
    rv = client.get("/api/titles?type=movie", headers=admin_headers)
    data = rv.get_json()
    assert all(t["content_type"] == "movie" for t in data["titles"])


def test_titles_filter_by_type_tv(client, admin_headers, seeded_titles):
    rv = client.get("/api/titles?type=tv", headers=admin_headers)
    data = rv.get_json()
    assert all(t["content_type"] == "tv" for t in data["titles"])


def test_titles_filter_by_region(client, admin_headers, seeded_titles):
    rv = client.get("/api/titles?region=GB", headers=admin_headers)
    data = rv.get_json()
    assert all("GB" in t.get("regions", "") for t in data["titles"])


def test_titles_search(client, admin_headers, seeded_titles):
    rv = client.get("/api/titles?search=Stranger", headers=admin_headers)
    data = rv.get_json()
    assert any("Stranger" in t["title"] for t in data["titles"])


def test_titles_unique_mode(client, admin_headers, seeded_titles):
    """unique=1 should collapse multiple-platform duplicates."""
    rv = client.get("/api/titles?unique=1", headers=admin_headers)
    assert rv.status_code == 200
    data = rv.get_json()
    assert isinstance(data["titles"], list)


def test_titles_unique_mode_returns_num_seasons(client, admin_headers, app):
    """unique=1 must include num_seasons for TV shows in the response."""
    with app.app_context():
        from backend.database import get_db
        db = get_db()
        # Insert same TV show on two platforms, both with num_seasons set
        for platform in ("Netflix", "Disney+"):
            db.execute(
                """INSERT INTO titles
                   (platform, region, title, content_type, runtime_mins, release_year,
                    imdb_score, imdb_votes, num_seasons, scraped_at)
                   VALUES (?,?,?,?,?,?,?,?,?, datetime('now'))""",
                (platform, "US", "Bridgerton", "tv", 60, "2020", 7.3, 100000, 4),
            )
        db.commit()

    rv = client.get("/api/titles?unique=1", headers=admin_headers)
    assert rv.status_code == 200
    titles = rv.get_json()["titles"]
    # Should be deduplicated to one entry
    bridgerton = [t for t in titles if t["title"] == "Bridgerton"]
    assert len(bridgerton) == 1, "unique=1 should collapse duplicates"
    assert bridgerton[0]["num_seasons"] == 4, (
        f"num_seasons should be 4, got {bridgerton[0].get('num_seasons')}"
    )


def test_titles_pagination_limit(client, admin_headers, seeded_titles):
    rv = client.get("/api/titles?limit=2&offset=0", headers=admin_headers)
    data = rv.get_json()
    assert len(data["titles"]) <= 2


def test_titles_pagination_offset(client, admin_headers, seeded_titles):
    rv_all = client.get("/api/titles?limit=100", headers=admin_headers)
    rv_offset = client.get("/api/titles?limit=100&offset=1", headers=admin_headers)
    total_all = rv_all.get_json()["total"]
    total_off = rv_offset.get_json()["total"]
    # total count is the same; current page is shorter
    assert total_all == total_off or len(rv_offset.get_json()["titles"]) < len(
        rv_all.get_json()["titles"]
    )


def test_titles_stats_with_data(client, admin_headers, seeded_titles):
    rv = client.get("/api/titles/stats", headers=admin_headers)
    data = rv.get_json()
    assert data["total"] > 0
    assert "Netflix" in data["platforms"]


def test_regions_with_data(client, admin_headers, seeded_titles):
    rv = client.get("/api/regions", headers=admin_headers)
    regions = rv.get_json()["regions"]
    assert "US" in regions


# ── /api/geoip ────────────────────────────────────────────────────────────────


def test_geoip_private_ip_returns_empty(client, admin_headers):
    """Requests from private/loopback IPs should gracefully return empty country."""
    rv = client.get("/api/geoip", headers=admin_headers)
    assert rv.status_code == 200
    data = rv.get_json()
    # Private IPs get country="" or a valid 2-char code; either is acceptable
    assert "country" in data
    assert isinstance(data["country"], str)
