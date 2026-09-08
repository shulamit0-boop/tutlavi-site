"""הפעלה בלחיצה כפולה (בלי חלון שורת פקודה) — Windows."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kidtime.__main__ import main  # noqa: E402

raise SystemExit(main())
