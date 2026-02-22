FROM texlive/texlive:latest

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY compile-worker.py /app/
RUN pip3 install --no-cache-dir --break-system-packages pika requests psycopg2-binary minio

RUN useradd -m -u 1001 worker && \
    mkdir -p /sandbox /output /logs && \
    chown -R worker:worker /app /sandbox /output /logs

USER worker

ENV PYTHONUNBUFFERED=1
ENV COMPILE_TIMEOUT=120
ENV SANDBOX_DIR=/sandbox
ENV OUTPUT_DIR=/output
ENV LOG_DIR=/logs

CMD ["python3", "-u", "/app/compile-worker.py"]
