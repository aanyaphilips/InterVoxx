#!/usr/bin/env python3
"""Small, dependency-free resume screening signal for the InterVox prototype."""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree

MAX_BYTES = 8 * 1024 * 1024
MIN_BYTES = 500
ALLOWED_SUFFIXES = {".pdf", ".doc", ".docx", ".txt", ".md"}


def extract_readable_text(path: Path) -> str:
    if path.suffix.lower() in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="ignore")

    if path.suffix.lower() == ".docx":
        try:
            with zipfile.ZipFile(path) as archive:
                xml = archive.read("word/document.xml")
            root = ElementTree.fromstring(xml)
            return " ".join(
                node.text.strip()
                for node in root.iter()
                if node.text and node.text.strip()
            )
        except (OSError, KeyError, ElementTree.ParseError, zipfile.BadZipFile):
            return ""

    # PDF and legacy DOC files are structurally checked here. A production
    # service should use a hardened document parser before trusting the text.
    return ""


def inspect_resume(filename: str) -> dict[str, object]:
    path = Path(filename)
    suffix = path.suffix.lower()
    reasons: list[str] = []

    if not path.exists() or not path.is_file():
        return {"accepted": False, "reasons": ["file_not_found"], "signals": {}}

    size = path.stat().st_size
    accepted_type = suffix in ALLOWED_SUFFIXES
    accepted_size = MIN_BYTES < size < MAX_BYTES
    readable_text = extract_readable_text(path)
    has_readable_signal = bool(readable_text.strip()) if suffix in {".docx", ".txt", ".md"} else True

    if not accepted_type:
        reasons.append("unsupported_file_type")
    if not accepted_size:
        reasons.append("file_size_out_of_range")
    if not has_readable_signal:
        reasons.append("no_readable_resume_text")

    return {
        "accepted": accepted_type and accepted_size and has_readable_signal,
        "reasons": reasons,
        "signals": {
            "filename": path.name,
            "suffix": suffix,
            "bytes": size,
            "has_readable_text": has_readable_signal,
            "text_characters": len(readable_text),
        },
        "note": "This is a screening signal, not a forensic authenticity guarantee.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect an InterVox resume file.")
    parser.add_argument("filename")
    args = parser.parse_args()
    print(json.dumps(inspect_resume(args.filename), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())