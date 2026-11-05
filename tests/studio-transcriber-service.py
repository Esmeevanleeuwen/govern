#!/usr/bin/env python3
"""Local transcriber HTTP contracts with a fake model, never a model download.

Requires FastAPI and its TestClient dependencies. The real image's offline
model-startup guard is also checked separately during Docker validation.
"""
import asyncio
from contextlib import asynccontextmanager
import importlib.util
from io import BytesIO
import os
from pathlib import Path
from types import ModuleType, SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
import wave

from fastapi.testclient import TestClient


SOURCE = Path(__file__).resolve().parents[1] / "docker/studio-transcriber/server.py"
spec = importlib.util.spec_from_file_location("govern_local_transcriber_test", SOURCE)
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


def pcm(*, channels=1, width=2, rate=16000, frames=1600):
    stream = BytesIO()
    with wave.open(stream, "wb") as output:
        output.setnchannels(channels)
        output.setsampwidth(width)
        output.setframerate(rate)
        output.writeframes(b"\x00" * channels * width * frames)
    return stream.getvalue()


class FakeModel:
    """A deterministic contract fixture; it cannot recognize actual speech."""
    def __init__(self):
        self.calls = []
        self.words = ["  Een agenda ", "voor coaches.  "]
        self.failure = False

    def transcribe(self, source, **options):
        self.calls.append((source.read(), options))
        if self.failure:
            def broken_segments():
                raise RuntimeError("fixture inference failure with private internal details")
                yield
            return broken_segments(), SimpleNamespace()
        return [SimpleNamespace(text=word) for word in self.words], SimpleNamespace()


class LocalTranscriberContracts(unittest.TestCase):
    def setUp(self):
        self.model = FakeModel()
        self.original_lifespan = service.app.router.lifespan_context

        @asynccontextmanager
        async def fixture_lifespan(app):
            app.state.model = self.model
            yield
            app.state.model = None

        service.app.router.lifespan_context = fixture_lifespan
        self.client_context = TestClient(service.app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        service.app.router.lifespan_context = self.original_lifespan

    def upload(self, data=None, **options):
        return self.client.post("/v1/audio/transcriptions", data=options,
                                files={"file": ("chunk.wav", pcm() if data is None else data, "audio/wav")})

    def test_valid_pcm_uses_fixed_dutch_local_options(self):
        data = pcm()
        response = self.upload(data, language="nl", model="whisper-1", response_format="json", temperature="0")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"text": "Een agenda voor coaches."})
        self.assertEqual(self.model.calls, [(data, {"language": "nl", "beam_size": 1,
                                                   "vad_filter": True, "condition_on_previous_text": False})])

    def test_silence_has_no_invented_transcript(self):
        self.model.words = []
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"text": ""})

    def test_invalid_audio_never_reaches_inference(self):
        for data in [b"not audio even though its filename says WAV", b"RIFF", pcm()[:-2]]:
            with self.subTest(size=len(data)):
                self.assertEqual(self.upload(data).status_code, 422)
        self.assertEqual(self.model.calls, [])

    def test_oversized_audio_never_reaches_inference(self):
        response = self.upload(b"x" * (service.MAX_BYTES + 1))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.model.calls, [])

    def test_audio_shape_and_duration_are_bounded(self):
        cases = [pcm(channels=2), pcm(width=1), pcm(rate=7999), pcm(rate=48001),
                 pcm(frames=0), pcm(frames=12 * 16000 + 1)]
        for index, data in enumerate(cases):
            with self.subTest(case=index):
                self.assertEqual(self.upload(data).status_code, 422)
        self.assertEqual(self.model.calls, [])

    def test_other_model_language_format_or_temperature_is_rejected(self):
        for options in [{"language": "en"}, {"model": "different-model"},
                        {"response_format": "text"}, {"temperature": "1"}]:
            with self.subTest(options=options):
                self.assertEqual(self.upload(**options).status_code, 422)
        self.assertEqual(self.model.calls, [])

    def test_busy_model_rejects_without_losing_lock_ownership(self):
        self.assertTrue(service.inference_lock.acquire(blocking=False))
        try:
            response = self.upload()
            self.assertEqual(response.status_code, 429)
            self.assertEqual(self.model.calls, [])
            self.assertTrue(service.inference_lock.locked())
        finally:
            service.inference_lock.release()
        self.assertEqual(self.upload().status_code, 200)

    def test_lazy_model_failure_is_private_and_releases_lock(self):
        self.model.failure = True
        response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private internal details", response.text)
        self.assertFalse(service.inference_lock.locked())
        self.model.failure = False
        self.assertEqual(self.upload().status_code, 200)

    def test_overlong_transcript_is_rejected_and_releases_lock(self):
        self.model.words = ["é" * 4001]
        response = self.upload()
        self.assertEqual(response.status_code, 503)
        self.assertFalse(service.inference_lock.locked())

    def test_only_expected_routes_are_exposed(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ready", "language": "nl", "model": "local"})
        for route in ["/docs", "/redoc", "/openapi.json"]:
            with self.subTest(route=route):
                self.assertEqual(self.client.get(route).status_code, 404)
        self.assertEqual(self.client.get("/v1/audio/transcriptions").status_code, 405)

    def test_missing_model_refuses_startup_without_downloading(self):
        stub = ModuleType("faster_whisper")
        instantiated = []
        stub.WhisperModel = lambda *args, **kwargs: instantiated.append((args, kwargs))

        async def initialize():
            async with service.lifespan(service.app):
                self.fail("A missing model must prevent startup")

        with tempfile.TemporaryDirectory(prefix="govern-studio-model-test-") as missing:
            with patch.dict(os.environ, {"STUDIO_MODEL_PATH": missing}), patch.dict("sys.modules", {"faster_whisper": stub}):
                with self.assertRaisesRegex(RuntimeError, "automatic downloads are disabled"):
                    asyncio.run(initialize())
        self.assertEqual(instantiated, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
