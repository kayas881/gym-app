#!/usr/bin/env python3
"""Isolated smoke test for Meta Muse Voice Transcribe.

Records a short microphone clip and sends it to Meta Model API. This file is
deliberately outside the Expo app: it does not import Gymnos code, touch
Supabase, or read constants/config.ts.

Official docs:
  https://dev.meta.ai/docs/speech-to-text
  https://dev.meta.ai/docs/api-reference/voice/transcribe
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import traceback
import uuid
import wave
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

# Official file-upload endpoint and model id from the Meta Model API docs.
TRANSCRIBE_URL = "https://api.meta.ai/v1/asr/transcribe"
MODEL_ID = "muse-voice-transcribe-1.0"

# Docs: RIFF/WAVE, mono, 16-bit integer PCM at 16 kHz or 24 kHz.
SAMPLE_RATE_HZ = 16_000
SAMPLE_WIDTH_BYTES = 2
CHANNELS = 1
RECORD_SECONDS = 5

# PUSH_TO_TALK is the documented default: one delimited clip, as in a
# push-to-talk voice command. Matches this 5-second controlled recording.
REQUEST_MODE = "PUSH_TO_TALK"
AUDIO_ENCODING = "WAV"

# Official vocabulary biasing for POST /v1/asr/transcribe. languageBias is a
# list of language names, not free-form context. keywords are domain terms the
# model might otherwise mishear. Docs: set both in the request part.
# https://dev.meta.ai/docs/speech-to-text
LANGUAGE_BIAS = ["English"]
KEYWORDS = [
    "bench press",
    "kilos",
    "kilograms",
    "reps",
    "sets",
    "reps in reserve",
    "RIR",
    "dumbbell",
    "barbell",
    "lat pulldown",
    "squat",
    "deadlift",
]

# Give the service time to process a short clip without hanging forever.
HTTP_TIMEOUT_SECONDS = 60

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_MICROPHONE = 3
EXIT_HTTP = 4
EXIT_MALFORMED = 5
EXIT_EMPTY = 6
EXIT_UNEXPECTED = 1


class SmokeTestError(Exception):
    """Expected failure with an exit code. Message is safe to print."""

    def __init__(self, message: str, exit_code: int) -> None:
        super().__init__(message)
        self.exit_code = exit_code


def redact(text: str, secret: str) -> str:
    """Strip the API key from anything we print, including error bodies."""
    if not secret:
        return text
    return text.replace(secret, "[redacted]")


def require_api_key() -> str:
    key = os.environ.get("MODEL_API_KEY", "").strip()
    if not key:
        raise SmokeTestError(
            "MODEL_API_KEY is not set. In Windows PowerShell, for this session "
            "only:\n"
            "  $env:MODEL_API_KEY = '<your-key>'\n"
            "Then rerun:\n"
            "  python scripts/meta_voice_smoke_test.py",
            EXIT_USAGE,
        )
    return key


def record_wav(path: Path) -> dict[str, Any]:
    """Capture ~5s from the default microphone as mono 16-bit PCM 16 kHz."""
    try:
        import numpy as np
        import sounddevice as sd
    except ImportError as exc:
        raise SmokeTestError(
            "Python packages required for microphone capture are missing.\n"
            "Install them with:\n"
            "  python -m pip install sounddevice numpy\n"
            f"Import error: {exc}",
            EXIT_MICROPHONE,
        ) from exc

    frames = int(RECORD_SECONDS * SAMPLE_RATE_HZ)
    print(
        f"Recording {RECORD_SECONDS}s from the default microphone "
        f"({SAMPLE_RATE_HZ} Hz, mono, 16-bit PCM)..."
    )
    try:
        audio = sd.rec(
            frames,
            samplerate=SAMPLE_RATE_HZ,
            channels=CHANNELS,
            dtype="int16",
        )
        sd.wait()
    except Exception as exc:
        raise SmokeTestError(
            f"Microphone recording failed: {exc}",
            EXIT_MICROPHONE,
        ) from exc

    if audio is None or getattr(audio, "size", 0) == 0:
        raise SmokeTestError(
            "Microphone recording returned no samples.",
            EXIT_MICROPHONE,
        )

    pcm = np.asarray(audio, dtype=np.int16)
    if pcm.ndim > 1:
        pcm = pcm.reshape(-1, pcm.shape[-1])[:, 0]
    pcm_bytes = pcm.tobytes()

    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(SAMPLE_WIDTH_BYTES)
        wav_file.setframerate(SAMPLE_RATE_HZ)
        wav_file.writeframes(pcm_bytes)

    peak = int(np.max(np.abs(pcm))) if pcm.size else 0
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "samples": int(pcm.size),
        "duration_s": round(pcm.size / SAMPLE_RATE_HZ, 3),
        "peak_amplitude": peak,
    }


def build_multipart(
    request_payload: dict[str, Any],
    wav_bytes: bytes,
    filename: str,
) -> tuple[bytes, str]:
    """Build the two-part body the official curl example sends.

    curl -F 'request={...};type=application/json' \\
         -F 'audio=@recording.wav;type=audio/wav'
    """
    boundary = f"----gymnosMuseSmoke{uuid.uuid4().hex}"
    request_json = json.dumps(request_payload, separators=(",", ":")).encode(
        "utf-8"
    )
    chunks = [
        f"--{boundary}\r\n".encode("ascii"),
        (
            'Content-Disposition: form-data; name="request"\r\n'
            "Content-Type: application/json\r\n"
            "\r\n"
        ).encode("ascii"),
        request_json,
        b"\r\n",
        f"--{boundary}\r\n".encode("ascii"),
        (
            f'Content-Disposition: form-data; name="audio"; '
            f'filename="{filename}"\r\n'
            "Content-Type: audio/wav\r\n"
            "\r\n"
        ).encode("ascii"),
        wav_bytes,
        b"\r\n",
        f"--{boundary}--\r\n".encode("ascii"),
    ]
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def transcribe(wav_path: Path, api_key: str) -> dict[str, Any]:
    session_id = f"gymnos-smoke-{uuid.uuid4()}"
    request_payload = {
        "model": MODEL_ID,
        "audioEncoding": AUDIO_ENCODING,
        "mode": REQUEST_MODE,
        "languageBias": LANGUAGE_BIAS,
        "keywords": KEYWORDS,
    }
    wav_bytes = wav_path.read_bytes()
    body, content_type = build_multipart(
        request_payload, wav_bytes, wav_path.name
    )
    url = f"{TRANSCRIBE_URL}?sessionId={session_id}"

    # Authorization is set but never printed. Accept application/json so the
    # service returns the buffered TranscribeResponse, not an event stream.
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
        "Content-Type": content_type,
    }

    print("POST", url)
    print("model:", MODEL_ID)
    print("mode:", REQUEST_MODE)
    print("audioEncoding:", AUDIO_ENCODING)
    print("languageBias:", json.dumps(LANGUAGE_BIAS))
    print("keywords:", json.dumps(KEYWORDS))
    print("sessionId (client):", session_id)
    print("audio file bytes:", len(wav_bytes))
    print("multipart body bytes:", len(body))

    http_request = Request(url, data=body, headers=headers, method="POST")
    try:
        with urlopen(http_request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            status = getattr(response, "status", None) or response.getcode()
            raw = response.read()
            response_headers = dict(response.headers.items())
    except HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")
        raise SmokeTestError(
            redact(
                f"HTTP {exc.code} from transcribe endpoint: {err_body}",
                api_key,
            ),
            EXIT_HTTP,
        ) from exc
    except URLError as exc:
        raise SmokeTestError(
            f"Could not reach {TRANSCRIBE_URL}: {exc.reason}",
            EXIT_HTTP,
        ) from exc

    text = raw.decode("utf-8", errors="replace")
    try:
        parsed: Any = json.loads(text) if text.strip() else None
    except json.JSONDecodeError as exc:
        preview = redact(text[:500], api_key)
        raise SmokeTestError(
            f"Malformed JSON response (HTTP {status}): {exc}\nBody: {preview}",
            EXIT_MALFORMED,
        ) from exc

    if not isinstance(parsed, dict):
        raise SmokeTestError(
            redact(
                f"Malformed response: expected a JSON object, got "
                f"{type(parsed).__name__}. Body: {text[:500]}",
                api_key,
            ),
            EXIT_MALFORMED,
        )

    return {
        "status": status,
        "headers": response_headers,
        "body": parsed,
        "session_id_sent": session_id,
        "request_payload": request_payload,
    }


def extract_transcript(body: dict[str, Any]) -> str:
    """Read the complete transcript field documented for every mode."""
    value = body.get("transcript")
    if isinstance(value, str):
        return value.strip()

    # Some envelopes nest the same documented field. Accept that without
    # inventing other names.
    for key in ("result", "data", "output"):
        nested = body.get(key)
        if isinstance(nested, dict) and isinstance(nested.get("transcript"), str):
            return nested["transcript"].strip()

    raise SmokeTestError(
        "Malformed response: missing string field 'transcript'. "
        f"Keys: {sorted(body.keys())}",
        EXIT_MALFORMED,
    )


def print_result(result: dict[str, Any]) -> str:
    body = result["body"]
    transcript = extract_transcript(body)
    print("HTTP status:", result["status"])
    print("sessionId (response):", body.get("sessionId"))
    print("audioDurationMs:", body.get("audioDurationMs"))
    turns = body.get("turns")
    if isinstance(turns, list):
        print("turns:", len(turns))
        for turn in turns:
            if not isinstance(turn, dict):
                continue
            print(
                "  turn",
                turn.get("turnId"),
                "speaker=",
                turn.get("speaker"),
                "ms=",
                turn.get("startMs"),
                "-",
                turn.get("endMs"),
                "text=",
                turn.get("transcript"),
            )
    safe_headers = {
        key: value
        for key, value in result["headers"].items()
        if key.lower() not in {"authorization", "cookie", "set-cookie"}
    }
    print("response headers:", json.dumps(safe_headers, indent=2))
    print("transcript:")
    print(transcript if transcript else "[empty]")
    return transcript


def delete_recording(path: Path | None) -> None:
    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:
        print(f"Warning: could not delete temporary recording {path}: {exc}")


def main() -> int:
    wav_path: Path | None = None
    try:
        api_key = require_api_key()
        handle = tempfile.NamedTemporaryFile(
            prefix="muse-voice-smoke-",
            suffix=".wav",
            delete=False,
        )
        handle.close()
        wav_path = Path(handle.name)

        meta = record_wav(wav_path)
        print("saved recording:", json.dumps(meta))
        if meta["peak_amplitude"] == 0:
            print(
                "Warning: recorded silence (peak amplitude 0). "
                "The API may return an empty transcript."
            )

        result = transcribe(wav_path, api_key)
        transcript = print_result(result)
        if not transcript:
            raise SmokeTestError(
                "API returned an empty transcript.",
                EXIT_EMPTY,
            )
        print("OK: received a non-empty transcript from Meta Muse Voice Transcribe.")
        return EXIT_OK
    except SmokeTestError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return exc.exit_code
    except Exception as exc:
        print(f"FAIL: unexpected error: {exc}", file=sys.stderr)
        traceback.print_exc()
        return EXIT_UNEXPECTED
    finally:
        delete_recording(wav_path)


if __name__ == "__main__":
    sys.exit(main())
