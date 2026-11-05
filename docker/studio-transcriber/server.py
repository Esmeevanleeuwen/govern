"""Optional local-only Dutch transcription. A model must be installed explicitly."""
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
import os
import threading
import wave

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

MAX_BYTES = 2 * 1024 * 1024
inference_lock = threading.Lock()


def validate_audio(data: bytes) -> None:
    if not 46 <= len(data) <= MAX_BYTES:
        raise ValueError("Audio size is outside the live chunk limit")
    try:
        with wave.open(BytesIO(data), "rb") as audio:
            rate = audio.getframerate()
            frames = audio.getnframes()
            if (audio.getnchannels() != 1 or audio.getsampwidth() != 2
                    or not 8000 <= rate <= 48000 or not 0 < frames <= 12 * rate
                    or len(audio.readframes(frames)) != frames * 2):
                raise ValueError("Expected a complete PCM16 mono WAV chunk")
    except (wave.Error, EOFError) as error:
        raise ValueError("Expected a PCM16 mono WAV chunk") from error


@asynccontextmanager
async def lifespan(app: FastAPI):
    from faster_whisper import WhisperModel
    model_path = Path(os.environ.get("STUDIO_MODEL_PATH", "/models/whisper"))
    if not model_path.is_dir() or not (model_path / "model.bin").is_file():
        raise RuntimeError("Install a multilingual faster-whisper model in STUDIO_MODEL_PATH first; automatic downloads are disabled")
    app.state.model = WhisperModel(str(model_path), device="cpu", compute_type="int8",
                                  cpu_threads=4, num_workers=1, local_files_only=True)
    yield
    app.state.model = None


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health():
    return {"status": "ready", "language": "nl", "model": "local"}


@app.post("/v1/audio/transcriptions")
async def transcribe(file: UploadFile = File(...), language: str = Form("nl"),
                     model: str = Form("whisper-1"), response_format: str = Form("json"),
                     temperature: str = Form("0")):
    if language != "nl" or model != "whisper-1" or response_format != "json" or temperature != "0":
        raise HTTPException(422, "Unsupported transcription options")
    try:
        data = await file.read(MAX_BYTES + 1)
    finally:
        await file.close()
    try:
        validate_audio(data)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(429, "The local model is busy; retry the retained chunk")
    try:
        def process():
            segments, _ = app.state.model.transcribe(BytesIO(data), language="nl", beam_size=1,
                                                      vad_filter=True, condition_on_previous_text=False)
            text = " ".join(segment.text.strip() for segment in segments).strip()
            if len(text.encode("utf-8")) > 8000:
                raise ValueError("Transcript exceeds the live chunk limit")
            return {"text": text}
        return await run_in_threadpool(process)
    except Exception:
        raise HTTPException(503, "The local model could not process this chunk") from None
    finally:
        inference_lock.release()
