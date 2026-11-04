#!/usr/bin/env python3
"""Standalone Muse Spark extraction smoke test for Gymnos Milestone 1.

Turns a fixed workout transcript into schema-constrained JSON via
POST https://api.meta.ai/v1/chat/completions (model muse-spark-1.3), then
validates the result locally. Independent of the microphone, Expo app,
Supabase, and scripts/meta_voice_smoke_test.py.

Official docs:
  https://dev.meta.ai/docs/structured-output
  https://dev.meta.ai/docs/api-reference/chat-completions/create-chat-completion
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import unittest
from dataclasses import dataclass, field
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CHAT_COMPLETIONS_URL = "https://api.meta.ai/v1/chat/completions"
MODEL_ID = "muse-spark-1.3"
HTTP_TIMEOUT_SECONDS = 60

# Deliberately broad supported ranges. These are safety rails for "do not
# write this to a database", not gym-science prescriptions. Adjust here.
WEIGHT_KG_MIN = 0.0
WEIGHT_KG_MAX = 500.0
REPS_MIN = 1
REPS_MAX = 100
RIR_MIN = 0
RIR_MAX = 10

ALLOWED_FIELDS = ("exercise", "weightKg", "reps", "rir")
UNCERTAIN_FIELD_VALUES = frozenset(ALLOWED_FIELDS)

EXIT_OK = 0
EXIT_UNIT = 1
EXIT_USAGE = 2
EXIT_HTTP = 4
EXIT_MALFORMED = 5
EXIT_VALIDATION = 7
EXIT_MISMATCH = 8
EXIT_UNEXPECTED = 1


def nullable(schema: dict[str, Any]) -> dict[str, Any]:
    """JSON Schema union with null. anyOf is documented below the root."""
    return {"anyOf": [schema, {"type": "null"}]}


# Strict-subset object: every property listed in required, additionalProperties
# false. See https://dev.meta.ai/docs/structured-output
WORKOUT_SET_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "exercise",
        "weightKg",
        "reps",
        "rir",
        "uncertainFields",
        "needsConfirmation",
    ],
    "properties": {
        "exercise": nullable({"type": "string"}),
        "weightKg": nullable({"type": "number"}),
        "reps": nullable({"type": "integer"}),
        "rir": nullable({"type": "integer"}),
        "uncertainFields": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": list(ALLOWED_FIELDS),
            },
        },
        "needsConfirmation": {"type": "boolean"},
    },
}

KNOWN_EXERCISE_DISPLAY = {
    "bench press": "Bench Press",
    "barbell squat": "Barbell Squat",
    "squat": "Squat",
    "deadlift": "Deadlift",
    "lat pulldown": "Lat Pulldown",
    "dumbbell": "Dumbbell",
    "barbell": "Barbell",
}

SYSTEM_PROMPT = """You extract one workout set from a speech-to-text transcript.

Return only the JSON object described by the provided schema. You cannot hear
the original audio. Use only the transcript text.

Rules:
- exercise: a known display name when the transcript clearly names it.
  Normalize: "bench press" -> "Bench Press"; "barbell squat" -> "Barbell Squat".
  If no exercise is named, return null. Never guess an exercise.
- weightKg: a number only when the transcript states kilograms
  (kilo, kilos, kilogram, kilograms, kg, KG). Convert spoken numbers
  ("forty" -> 40, "eighty" -> 80). Do not convert pounds or an unspecified
  unit into kilograms. Do not "correct" a stated number (43 stays 43, not 40).
- reps: the set's repetition count only. Do not use a reps-in-reserve number
  as the set reps.
- rir: reps in reserve only, when clearly stated (including "reps in reserve"
  or "RIR"). "razor" is not RIR.
- If a field is missing or ambiguous, set it to null and list it in
  uncertainFields. Never invent a missing exercise, weight, rep count, or RIR.
- Malformed wording such as "two reps two reps in razor" is ambiguous. Do not
  reconstruct omitted speech from context.
- uncertainFields may contain only: exercise, weightKg, reps, rir.
- needsConfirmation must always be true for this milestone, even when every
  field looks clear.
"""


class SmokeTestError(Exception):
    def __init__(self, message: str, exit_code: int) -> None:
        super().__init__(message)
        self.exit_code = exit_code


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    normalized: dict[str, Any] | None = None

    def as_report(self) -> str:
        if self.ok:
            return "PASS"
        return "FAIL: " + "; ".join(self.errors)


@dataclass
class ExpectedInterpretation:
    """Human-expected reading of a fixture. Not used to rewrite model output."""

    label: str
    transcript: str
    exercise: str | None
    weight_kg: float | None
    reps: int | None
    rir: int | None
    # Fields the model must not invent a confident value for.
    must_not_invent: tuple[str, ...] = ()


FIXTURES: list[ExpectedInterpretation] = [
    ExpectedInterpretation(
        label="case-1-spoken-numbers",
        transcript="bench press forty kilos ten reps and two reps in reserve.",
        exercise="Bench Press",
        weight_kg=40,
        reps=10,
        rir=2,
    ),
    ExpectedInterpretation(
        label="case-2-barbell-squat",
        transcript="barbell squat eighty KG ten reps two reps in reserve.",
        exercise="Barbell Squat",
        weight_kg=80,
        reps=10,
        rir=2,
    ),
    ExpectedInterpretation(
        label="case-3-preserve-43",
        transcript="bench press 43 kilos 10 reps and two reps in reserve.",
        exercise="Bench Press",
        weight_kg=43,
        reps=10,
        rir=2,
    ),
    ExpectedInterpretation(
        label="case-4-ambiguous-razor",
        transcript="bench press 40 kilos, two reps two reps, in razor.",
        exercise="Bench Press",
        weight_kg=40,
        reps=None,
        rir=None,
        must_not_invent=("reps", "rir"),
    ),
    ExpectedInterpretation(
        label="case-5-missing-exercise",
        transcript="40 kilos 10 reps and two reps in reserve.",
        exercise=None,
        weight_kg=40,
        reps=10,
        rir=2,
        must_not_invent=("exercise",),
    ),
]


def redact(text: str, secret: str) -> str:
    if not secret:
        return text
    return text.replace(secret, "[redacted]")


def require_api_key() -> str:
    key = os.environ.get("MODEL_API_KEY", "").strip()
    if not key:
        raise SmokeTestError(
            "MODEL_API_KEY is not set. Live extraction was requested.\n"
            "In Windows PowerShell, for this session only:\n"
            "  $env:MODEL_API_KEY = '<your-key>'\n"
            "Then rerun:\n"
            "  python scripts/meta_extraction_smoke_test.py --live",
            EXIT_USAGE,
        )
    return key


def _is_int_like(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    if isinstance(value, float):
        return value.is_integer()
    return False


def _as_int(value: Any) -> int:
    return int(value)


def _as_float(value: Any) -> float:
    return float(value)


def validate_workout_set(payload: Any) -> ValidationResult:
    """Deterministic local check. Never writes to a database.

    A failing result is an actionable error the caller must surface instead of
    inserting a workout set.
    """
    errors: list[str] = []

    if not isinstance(payload, dict):
        return ValidationResult(
            False, [f"payload is {type(payload).__name__}, expected object"]
        )

    extra = sorted(set(payload) - set(WORKOUT_SET_SCHEMA["required"]))
    if extra:
        errors.append(f"extra properties not allowed: {extra}")

    missing = [key for key in WORKOUT_SET_SCHEMA["required"] if key not in payload]
    if missing:
        errors.append(f"missing required fields: {missing}")
        return ValidationResult(False, errors)

    exercise = payload["exercise"]
    if exercise is not None and not isinstance(exercise, str):
        errors.append("exercise must be a string or null")
    elif isinstance(exercise, str) and not exercise.strip():
        errors.append("exercise must not be an empty string; use null")

    weight = payload["weightKg"]
    weight_norm: float | None = None
    if weight is None:
        weight_norm = None
    elif isinstance(weight, bool) or not isinstance(weight, (int, float)):
        errors.append("weightKg must be a number or null")
    else:
        weight_norm = _as_float(weight)
        if weight_norm < WEIGHT_KG_MIN or weight_norm > WEIGHT_KG_MAX:
            errors.append(
                f"weightKg {weight_norm} is outside the supported range "
                f"[{WEIGHT_KG_MIN}, {WEIGHT_KG_MAX}]"
            )

    reps = payload["reps"]
    reps_norm: int | None = None
    if reps is None:
        reps_norm = None
    elif not _is_int_like(reps):
        errors.append("reps must be an integer or null")
    else:
        reps_norm = _as_int(reps)
        if reps_norm < REPS_MIN or reps_norm > REPS_MAX:
            errors.append(
                f"reps {reps_norm} is outside the supported range "
                f"[{REPS_MIN}, {REPS_MAX}]"
            )

    rir = payload["rir"]
    rir_norm: int | None = None
    if rir is None:
        rir_norm = None
    elif not _is_int_like(rir):
        errors.append("rir must be an integer or null")
    else:
        rir_norm = _as_int(rir)
        if rir_norm < RIR_MIN or rir_norm > RIR_MAX:
            errors.append(
                f"rir {rir_norm} is outside the supported range "
                f"[{RIR_MIN}, {RIR_MAX}]"
            )

    uncertain = payload["uncertainFields"]
    if not isinstance(uncertain, list):
        errors.append("uncertainFields must be an array")
        uncertain_norm: list[str] = []
    else:
        uncertain_norm = []
        for item in uncertain:
            if item not in UNCERTAIN_FIELD_VALUES:
                errors.append(
                    f"uncertainFields contains {item!r}; allowed: "
                    f"{list(ALLOWED_FIELDS)}"
                )
            elif item not in uncertain_norm:
                uncertain_norm.append(item)

    needs = payload["needsConfirmation"]
    if not isinstance(needs, bool):
        errors.append("needsConfirmation must be a boolean")
    elif needs is False:
        # Milestone rule: every proposed set still needs a human look.
        # Uncertain fields especially must not be treated as confirmed.
        extra_reason = ""
        if uncertain_norm:
            extra_reason = f" (uncertainFields={uncertain_norm})"
        errors.append(
            "needsConfirmation is false; this milestone requires confirmation "
            f"for every proposed set{extra_reason}"
        )

    if uncertain_norm and needs is False:
        errors.append(
            "uncertain fields cannot be silently treated as confirmed"
        )

    normalized = {
        "exercise": exercise.strip() if isinstance(exercise, str) else None,
        "weightKg": weight_norm,
        "reps": reps_norm,
        "rir": rir_norm,
        "uncertainFields": uncertain_norm,
        "needsConfirmation": needs if isinstance(needs, bool) else True,
    }
    return ValidationResult(ok=not errors, errors=errors, normalized=normalized)


def compare_to_expected(
    expected: ExpectedInterpretation,
    extracted: dict[str, Any],
) -> list[str]:
    """Report interpretation mismatches. Does not change extracted."""
    mismatches: list[str] = []
    uncertain = set(extracted.get("uncertainFields") or [])

    actual_ex = extracted.get("exercise")
    if "exercise" in expected.must_not_invent:
        if actual_ex not in (None, ""):
            mismatches.append(
                f"exercise: expected no invented name, model returned {actual_ex!r}"
            )
    elif expected.exercise is not None:
        if not isinstance(actual_ex, str) or actual_ex.casefold() != expected.exercise.casefold():
            mismatches.append(
                f"exercise: expected {expected.exercise!r}, got {actual_ex!r}"
            )

    actual_w = extracted.get("weightKg")
    if expected.weight_kg is not None:
        if actual_w is None or abs(float(actual_w) - expected.weight_kg) > 1e-9:
            mismatches.append(
                f"weightKg: expected {expected.weight_kg}, got {actual_w}"
            )
            if expected.weight_kg == 43 and actual_w == 40:
                mismatches.append(
                    "weightKg: model corrected 43 to 40; preserve the spoken 43"
                )

    for field_name, expected_value, actual in (
        ("reps", expected.reps, extracted.get("reps")),
        ("rir", expected.rir, extracted.get("rir")),
    ):
        if field_name in expected.must_not_invent:
            invented = actual is not None and field_name not in uncertain
            if invented:
                mismatches.append(
                    f"{field_name}: expected null or uncertain, model returned "
                    f"{actual} without listing it in uncertainFields"
                )
        elif expected_value is not None and actual != expected_value:
            mismatches.append(
                f"{field_name}: expected {expected_value}, got {actual}"
            )

    if extracted.get("needsConfirmation") is not True:
        mismatches.append(
            "needsConfirmation: expected true for every set in this milestone"
        )

    return mismatches


def extract_message_content(body: Any, api_key: str) -> str:
    if not isinstance(body, dict):
        raise SmokeTestError(
            redact(
                f"Malformed chat response: expected object, got "
                f"{type(body).__name__}",
                api_key,
            ),
            EXIT_MALFORMED,
        )
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        raise SmokeTestError(
            redact(
                f"Malformed chat response: missing choices. Keys: "
                f"{sorted(body.keys())}",
                api_key,
            ),
            EXIT_MALFORMED,
        )
    first = choices[0]
    if not isinstance(first, dict):
        raise SmokeTestError("Malformed chat response: choices[0] is not an object", EXIT_MALFORMED)
    message = first.get("message")
    if not isinstance(message, dict):
        raise SmokeTestError("Malformed chat response: missing message", EXIT_MALFORMED)
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = [
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and part.get("type") in (None, "text", "output_text")
        ]
        joined = "".join(texts).strip()
        if joined:
            return joined
    raise SmokeTestError(
        redact(f"Malformed chat response: message.content is {type(content).__name__}", api_key),
        EXIT_MALFORMED,
    )


def parse_extracted_json(content: str, api_key: str) -> dict[str, Any]:
    text = content.strip()
    try:
        parsed: Any = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SmokeTestError(
            redact(f"Model content is not JSON: {exc}\nBody: {text[:500]}", api_key),
            EXIT_MALFORMED,
        ) from exc
    if not isinstance(parsed, dict):
        raise SmokeTestError(
            f"Model JSON is {type(parsed).__name__}, expected object",
            EXIT_MALFORMED,
        )
    return parsed


def extract_workout_set(transcript: str, api_key: str) -> dict[str, Any]:
    """Call Muse Spark. Live API usage happens only here."""
    payload = {
        "model": MODEL_ID,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Transcript:\n{transcript}",
            },
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "WorkoutSet",
                "schema": WORKOUT_SET_SCHEMA,
                "strict": True,
            },
        },
    }
    raw_body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    request = Request(
        CHAT_COMPLETIONS_URL,
        data=raw_body,
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            status = getattr(response, "status", None) or response.getcode()
            raw = response.read()
    except HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise SmokeTestError(
            redact(f"HTTP {exc.code} from chat completions: {err_body}", api_key),
            EXIT_HTTP,
        ) from exc
    except URLError as exc:
        raise SmokeTestError(
            f"Could not reach {CHAT_COMPLETIONS_URL}: {exc.reason}",
            EXIT_HTTP,
        ) from exc

    text = raw.decode("utf-8", errors="replace")
    try:
        body = json.loads(text) if text.strip() else None
    except json.JSONDecodeError as exc:
        raise SmokeTestError(
            redact(f"Malformed HTTP JSON (HTTP {status}): {exc}\nBody: {text[:500]}", api_key),
            EXIT_MALFORMED,
        ) from exc

    content = extract_message_content(body, api_key)
    extracted = parse_extracted_json(content, api_key)
    return {
        "http_status": status,
        "model": body.get("model") if isinstance(body, dict) else None,
        "id": body.get("id") if isinstance(body, dict) else None,
        "extracted": extracted,
        "raw_content": content,
    }


class ValidationUnitTests(unittest.TestCase):
    def _valid(self, **overrides: Any) -> dict[str, Any]:
        base = {
            "exercise": "Bench Press",
            "weightKg": 40,
            "reps": 10,
            "rir": 2,
            "uncertainFields": [],
            "needsConfirmation": True,
        }
        base.update(overrides)
        return base

    def test_accepts_clear_set_that_still_needs_confirmation(self) -> None:
        result = validate_workout_set(self._valid())
        self.assertTrue(result.ok, result.errors)
        assert result.normalized is not None
        self.assertEqual(result.normalized["weightKg"], 40.0)
        self.assertEqual(result.normalized["reps"], 10)

    def test_rejects_needs_confirmation_false(self) -> None:
        result = validate_workout_set(self._valid(needsConfirmation=False))
        self.assertFalse(result.ok)
        self.assertTrue(any("needsConfirmation" in err for err in result.errors))

    def test_rejects_uncertain_fields_marked_confirmed(self) -> None:
        result = validate_workout_set(
            self._valid(uncertainFields=["exercise"], needsConfirmation=False)
        )
        self.assertFalse(result.ok)
        self.assertTrue(
            any("cannot be silently treated as confirmed" in err for err in result.errors)
        )

    def test_rejects_extra_properties(self) -> None:
        payload = self._valid()
        payload["guessedFromContext"] = True
        result = validate_workout_set(payload)
        self.assertFalse(result.ok)
        self.assertTrue(any("extra properties" in err for err in result.errors))

    def test_rejects_missing_field(self) -> None:
        payload = self._valid()
        del payload["rir"]
        result = validate_workout_set(payload)
        self.assertFalse(result.ok)
        self.assertTrue(any("missing required" in err for err in result.errors))

    def test_rejects_negative_and_huge_weight(self) -> None:
        self.assertFalse(validate_workout_set(self._valid(weightKg=-1)).ok)
        self.assertFalse(validate_workout_set(self._valid(weightKg=501)).ok)

    def test_rejects_non_positive_or_huge_reps(self) -> None:
        self.assertFalse(validate_workout_set(self._valid(reps=0)).ok)
        self.assertFalse(validate_workout_set(self._valid(reps=101)).ok)

    def test_rejects_rir_outside_range(self) -> None:
        self.assertFalse(validate_workout_set(self._valid(rir=-1)).ok)
        self.assertFalse(validate_workout_set(self._valid(rir=11)).ok)

    def test_rejects_unknown_uncertain_field(self) -> None:
        result = validate_workout_set(self._valid(uncertainFields=["sets"]))
        self.assertFalse(result.ok)

    def test_accepts_null_fields_when_uncertain(self) -> None:
        result = validate_workout_set(
            self._valid(
                exercise=None,
                uncertainFields=["exercise"],
                needsConfirmation=True,
            )
        )
        self.assertTrue(result.ok, result.errors)

    def test_accepts_int_like_reps(self) -> None:
        result = validate_workout_set(self._valid(reps=10.0))
        self.assertTrue(result.ok, result.errors)

    def test_rejects_fractional_reps(self) -> None:
        self.assertFalse(validate_workout_set(self._valid(reps=10.5)).ok)

    def test_validation_does_not_claim_a_database_write(self) -> None:
        result = validate_workout_set("not-json")
        self.assertFalse(result.ok)
        self.assertIsNone(result.normalized)
        # The function only returns errors. A caller that sees ok=False must
        # not insert. There is no write side effect to observe here.

    def test_compare_flags_corrected_weight(self) -> None:
        expected = FIXTURES[2]
        mismatches = compare_to_expected(
            expected,
            {
                "exercise": "Bench Press",
                "weightKg": 40,
                "reps": 10,
                "rir": 2,
                "uncertainFields": [],
                "needsConfirmation": True,
            },
        )
        self.assertTrue(any("43" in item for item in mismatches))

    def test_compare_flags_invented_exercise(self) -> None:
        expected = FIXTURES[4]
        mismatches = compare_to_expected(
            expected,
            {
                "exercise": "Bench Press",
                "weightKg": 40,
                "reps": 10,
                "rir": 2,
                "uncertainFields": [],
                "needsConfirmation": True,
            },
        )
        self.assertTrue(any("invented" in item for item in mismatches))


def run_unit_tests() -> bool:
    print("=" * 72)
    print("UNIT: deterministic validation (no network)")
    print(
        "Bounds: "
        f"weightKg [{WEIGHT_KG_MIN}, {WEIGHT_KG_MAX}], "
        f"reps [{REPS_MIN}, {REPS_MAX}], "
        f"rir [{RIR_MIN}, {RIR_MAX}]"
    )
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ValidationUnitTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(
        f"UNIT RESULT: {result.testsRun} run, "
        f"{len(result.failures)} failed, {len(result.errors)} errors"
    )
    return result.wasSuccessful()


def print_case_report(
    expected: ExpectedInterpretation,
    extracted: dict[str, Any],
    validation: ValidationResult,
    mismatches: list[str],
    meta: dict[str, Any],
) -> None:
    print("-" * 72)
    print(f"CASE {expected.label}")
    print("transcript:", expected.transcript)
    print("expected interpretation:")
    print(
        json.dumps(
            {
                "exercise": expected.exercise,
                "weightKg": expected.weight_kg,
                "reps": expected.reps,
                "rir": expected.rir,
                "mustNotInvent": list(expected.must_not_invent),
                "needsConfirmation": True,
            },
            indent=2,
        )
    )
    print("model HTTP status:", meta.get("http_status"))
    print("model id:", meta.get("id"))
    print("extracted JSON:")
    print(json.dumps(extracted, indent=2))
    print("validation:", validation.as_report())
    if mismatches:
        print("interpretation mismatches:")
        for item in mismatches:
            print("  -", item)
    else:
        print("interpretation mismatches: none")


def run_live() -> int:
    api_key = require_api_key()
    print("=" * 72)
    print("LIVE: Muse Spark extraction")
    print("POST", CHAT_COMPLETIONS_URL)
    print("model:", MODEL_ID)
    print("response_format: json_schema / WorkoutSet / strict=true")
    print("cases:", len(FIXTURES))
    print("MODEL_API_KEY: set (value not shown)")

    validation_failures = 0
    mismatch_count = 0
    for expected in FIXTURES:
        try:
            meta = extract_workout_set(expected.transcript, api_key)
        except SmokeTestError as exc:
            print("-" * 72)
            print(f"CASE {expected.label}")
            print("transcript:", expected.transcript)
            print("LIVE REQUEST FAIL:", exc)
            return exc.exit_code

        extracted = meta["extracted"]
        validation = validate_workout_set(extracted)
        comparable = validation.normalized if validation.normalized is not None else extracted
        mismatches = compare_to_expected(expected, comparable)
        print_case_report(expected, extracted, validation, mismatches, meta)
        if not validation.ok:
            validation_failures += 1
        if mismatches:
            mismatch_count += 1

    print("=" * 72)
    print(
        f"LIVE SUMMARY: {len(FIXTURES)} cases, "
        f"{validation_failures} validation failures, "
        f"{mismatch_count} interpretation mismatches"
    )
    if validation_failures:
        print("LIVE RESULT: FAIL (extracted JSON failed local validation)")
        return EXIT_VALIDATION
    if mismatch_count:
        print(
            "LIVE RESULT: MISMATCH "
            "(valid JSON, but it disagrees with the expected interpretation)"
        )
        return EXIT_MISMATCH
    print("LIVE RESULT: PASS")
    return EXIT_OK


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Gymnos Milestone 1: workout transcript extraction smoke test"
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--unit",
        action="store_true",
        help="Run deterministic validation tests only. No network.",
    )
    group.add_argument(
        "--live",
        action="store_true",
        help="Call Muse Spark. Requires MODEL_API_KEY. Makes the live call explicit.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        if args.live:
            print("Mode: --live (network call is explicit)")
            if not run_unit_tests():
                print("Refusing to call the API because unit tests failed.")
                return EXIT_UNIT
            return run_live()

        units_ok = run_unit_tests()
        if args.unit:
            return EXIT_OK if units_ok else EXIT_UNIT
        if not units_ok:
            return EXIT_UNIT

        if os.environ.get("MODEL_API_KEY", "").strip():
            print(
                "MODEL_API_KEY is set. Running live extraction. "
                "Use --unit to skip the network."
            )
            return run_live()

        print("=" * 72)
        print("LIVE SKIPPED: MODEL_API_KEY is not set.")
        print("Unit tests ran. No chat-completions request was sent.")
        print("To run live extraction:")
        print("  $env:MODEL_API_KEY = '<your-key>'")
        print("  python scripts/meta_extraction_smoke_test.py --live")
        return EXIT_OK
    except SmokeTestError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return exc.exit_code
    except Exception as exc:
        print(f"FAIL: unexpected error: {exc}", file=sys.stderr)
        traceback.print_exc()
        return EXIT_UNEXPECTED


if __name__ == "__main__":
    sys.exit(main())
