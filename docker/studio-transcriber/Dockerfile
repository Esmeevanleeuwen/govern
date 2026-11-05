FROM python:3.12-slim-bookworm
WORKDIR /service
COPY --chmod=644 docker/studio-transcriber/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --chmod=644 docker/studio-transcriber/server.py ./server.py
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONDONTWRITEBYTECODE=1 STUDIO_MODEL_PATH=/models/whisper
USER 65532:65532
EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--limit-concurrency", "4", "--no-access-log"]
