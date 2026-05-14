"""Pure-function tests that don't need a DB."""
import os
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost:5432/x")  # never connected

from app.seed import _wc


def test_word_count_simple():
    assert _wc("hello world") == 2


def test_word_count_empty():
    assert _wc("") == 0
    assert _wc("   ") == 0


def test_word_count_whitespace_collapses():
    assert _wc("  hello\t\tworld\n\n") == 2


def test_word_count_with_punctuation():
    # Punctuation attached to words still counts as one word
    assert _wc("Hello, world! How are you?") == 5
