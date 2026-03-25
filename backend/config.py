# backend/config.py
import os
from pathlib import Path
from dataclasses import dataclass, field

BASE_DIR = Path(__file__).parent.parent  # project root


def _default_redirect_uri() -> str:
    """Build the Google OAuth callback URI.
    Priority:
      1. GOOGLE_REDIRECT_URI env var (explicit override — always wins)
      2. PUBLIC_DOMAIN env var (e.g. api.yourdomain.com)
      3. Localhost fallback for local dev
    """
    public_domain = os.getenv("PUBLIC_DOMAIN")
    if public_domain:
        return f"https://{public_domain}/api/auth/google-callback"
    return "http://localhost:5000/api/auth/google-callback"


@dataclass
class Settings:
    BASE_DIR: Path = field(default_factory=lambda: BASE_DIR)
    DB_PATH: Path = field(default_factory=lambda: BASE_DIR / "stream_intel.db")
    UI_DIR: Path = field(default_factory=lambda: BASE_DIR / "frontend")
    TOKEN_TTL: int = 60 * 60 * 24 * 30  # 30 days
    SECRET_KEY: str = field(
        default_factory=lambda: os.getenv("SECRET_KEY", "dev-secret-key")
    )

    # Google OAuth
    GOOGLE_CLIENT_ID: str = field(
        default_factory=lambda: os.getenv("GOOGLE_CLIENT_ID", "")
    )
    GOOGLE_CLIENT_SECRET: str = field(
        default_factory=lambda: os.getenv("GOOGLE_CLIENT_SECRET", "")
    )
    GOOGLE_REDIRECT_URI: str = field(
        default_factory=lambda: (
            os.getenv("GOOGLE_REDIRECT_URI") or _default_redirect_uri()
        )
    )

    # Scraper
    MIN_DELAY: float = 0.8
    MAX_DELAY: float = 2.5
    MIN_IMDB_VOTES: int = 50_000

    # When True the scraper fetches with multiple sort strategies (POPULAR +
    # ALPHABETICAL) to maximise the number of titles captured per region.
    # Enable via env var: SCRAPER_MULTI_SORT=1
    SCRAPER_MULTI_SORT: bool = field(
        default_factory=lambda: (
            os.getenv("SCRAPER_MULTI_SORT", "").strip() in ("1", "true", "yes")
        )
    )

    # Optional HTTP/SOCKS5 proxy URL for the scraper to bypass Cloudflare IP
    # blocks.  Use a residential proxy service for best results.
    # Example: http://user:pass@host:port  or  socks5://user:pass@host:port
    SCRAPER_PROXY_URL: str = field(
        default_factory=lambda: os.getenv("SCRAPER_PROXY_URL", "")
    )

    # OMDB API (for ratings enrichment)
    OMDB_API_KEY: str = field(default_factory=lambda: os.getenv("OMDB_API_KEY", ""))

    # Firebase Admin SDK — paste the full service-account JSON string as an env var
    FIREBASE_SERVICE_ACCOUNT_JSON: str = field(
        default_factory=lambda: os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "")
    )

    # Web Push (VAPID)
    # Railway stores multiline env vars with literal \n — replace them so PEM
    # parsing works correctly with pywebpush / py_vapid.
    VAPID_PRIVATE_PEM: str = field(
        default_factory=lambda: os.getenv("VAPID_PRIVATE_PEM", "").replace("\\n", "\n")
    )
    VAPID_PUBLIC_KEY: str = field(
        default_factory=lambda: os.getenv("VAPID_PUBLIC_KEY", "")
    )
    VAPID_CLAIMS_EMAIL: str = field(
        default_factory=lambda: os.getenv("VAPID_CLAIMS_EMAIL", "admin@streamintel.app")
    )

    def __post_init__(self):
        # DATABASE_PATH is the Railway-standard env var we set on the volume.
        # STREAMINTE_DB_PATH is the legacy name kept for backward compat.
        db = os.getenv("DATABASE_PATH") or os.getenv("STREAMINTE_DB_PATH")
        if db:
            self.DB_PATH = Path(db)
            # Ensure the parent directory exists (Railway volume mount point)
            self.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        if ttl := os.getenv("STREAMINTE_TOKEN_TTL"):
            self.TOKEN_TTL = int(ttl)


settings = Settings()
