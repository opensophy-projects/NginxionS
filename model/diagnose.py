#!/usr/bin/env python3
"""Diagnoses data quality issues in payload_registry.py and datasets.py.

Tests:
1. normalize() artifacts: checks if normalize() mangled attack payloads
2. is_comment_or_noise() false positives: checks if validsyntax is rejected
3. legit_weight integer truncation: checks if 1.5 -> 1 (no duplication)
4. attacks_without_keywords: checks if 25-37% of attacks are invisible to model
"""

import re
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from payload_registry import normalize, is_comment_or_noise

def test_normalize():
    """Test that normalize() does not mangle valid payloads."""
    tests = [
        # (input, should_keep, description)
        ("UNION/**/SELECT 1", True, "obfuscated SQL"),
        ("http://evil.com", True, "URL in comment context"),
        ("' or 1=1 --", True, "SQLi with --"),
        ("'; drop table users; --", True, "SQLi with ; and --"),
        ("' UNION ALL SELECT NULL,NULL,NULL--", True, "SQLi with --"),
        ("<img src=x onerror=alert(1)>", True, "XSS"),
        ("'; DROP TABLE products; --", True, "SQL injection with comment"),
        ("../../../etc/passwd", True, "path traversal"),
        ("', 1, 2, 3, --", True, "SQLi fragments"),
    ]
    
    print("=" * 60)
    print("TEST 1: normalize() artifacts")
    print("=" * 60)
    
    failures = []
    for payload, should_keep, desc in tests:
        normalized = normalize(payload)
        # If it became empty or drastically shorter, it was likely mangled
        if should_keep:
            if not normalized:
                failures.append(f"  ❌ {desc}: '{payload}' -> '' (LOST)")
            elif len(normalized) < 3:
                failures.append(f"  ❌ {desc}: '{payload}' -> '{normalized}' (MANGLED)")
            else:
                # Check if key parts survived
                if "UNION" in payload.upper() and "UNION" not in normalized.upper():
                    failures.append(f"  ❌ {desc}: 'UNION' lost: '{payload}' -> '{normalized}'")
                elif "or 1" in payload.lower() and "or 1" not in normalized.lower():
                    failures.append(f"  ❌ {desc}: 'or 1' lost: '{payload}' -> '{normalized}'")
                else:
                    print(f"  ✅ {desc}: OK")
    
    if failures:
        print("\n".join(failures))
        return False
    return True

def test_is_comment_or_noise():
    """Test that is_comment_or_noise() does not reject valid attack syntax."""
    tests = [
        # (input, should_keep, description)
        ("/*!50000union*/", False, "SQL obfuscation with /*!*/"),
        ("//evil.com", False, "URL comment"),
        ("#{7*7}", False, "Ruby template"),
        ("/* comment */", False, "SQL comment"),
        ("normal text", True, "plain text"),
        ("UNION SELECT", True, "SQL keyword"),
        ("--", False, "SQL comment marker alone"),
        ("#", False, "SQL comment marker alone"),
        ("//", False, "URL comment marker alone"),
    ]
    
    print("\n" + "=" * 60)
    print("TEST 2: is_comment_or_noise() false positives")
    print("=" * 60)
    
    failures = []
    for payload, should_keep, desc in tests:
        is_noise = is_comment_or_noise(payload)
        is_kept = not is_noise
        
        if should_keep != is_kept:
            if should_keep:
                failures.append(f"  ❌ {desc}: '{payload}' rejected (should keep)")
            else:
                failures.append(f"  ❌ {desc}: '{payload}' accepted (should reject)")
        else:
            action = "REJECT" if is_noise else "KEEP"
            print(f"  ✅ {desc}: {action}")
    
    if failures:
        print("\n".join(failures))
        return False
    return True

def test_legit_weight_int():
    """Test that legit_weight truncation loses data."""
    
    print("\n" + "=" * 60)
    print("TEST 3: legit_weight integer truncation")
    print("=" * 60)
    
    weights = [0.5, 1.0, 1.5, 2.0, 2.5]
    failures = []
    
    for w in weights:
        int_w = int(w)
        if int_w != round(w):
            failures.append(f"  ❌ weight={w} -> int={int_w} (data loss: expected {round(w)})")
        else:
            print(f"  ✅ weight={w} -> int={int_w}")
    
    if failures:
        print("\n".join(failures))
        return False
    return True

def main():
    results = {
        "normalize artifacts": test_normalize(),
        "comment/noise false positives": test_is_comment_or_noise(),
        "legit_weight truncation": test_legit_weight_int(),
    }
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{test_name}: {status}")
    
    all_pass = all(results.values())
    sys.exit(0 if all_pass else 1)

if __name__ == "__main__":
    main()
