#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import pika
import psycopg2
from minio import Minio
from minio.error import S3Error

# ---------- RabbitMQ config ----------
RABBITMQ_HOST = os.getenv('RABBITMQ_HOST', 'localhost')
RABBITMQ_PORT = int(os.getenv('RABBITMQ_PORT', 5672))
RABBITMQ_USER = os.getenv('RABBITMQ_USER', 'guest')
RABBITMQ_PASSWORD = os.getenv('RABBITMQ_PASSWORD', 'guest')

# Number of concurrent worker threads (pre-warmed pool size).
# Each thread maintains its own RabbitMQ connection so they can consume jobs in parallel.
WORKER_CONCURRENCY = int(os.getenv('WORKER_CONCURRENCY', '2'))

# ---------- PostgreSQL config ----------
POSTGRES_HOST = os.getenv('POSTGRES_HOST', 'localhost')
POSTGRES_PORT = int(os.getenv('POSTGRES_PORT', 5432))
POSTGRES_USER = os.getenv('POSTGRES_USER', 'underleaf')
POSTGRES_PASSWORD = os.getenv('POSTGRES_PASSWORD', 'underleaf')
POSTGRES_DB = os.getenv('POSTGRES_DB', 'underleaf')

# ---------- MinIO config ----------
MINIO_ENDPOINT = os.getenv('MINIO_ENDPOINT', 'localhost:9000')
MINIO_ACCESS_KEY = os.getenv('MINIO_ACCESS_KEY', 'minioadmin')
MINIO_SECRET_KEY = os.getenv('MINIO_SECRET_KEY', 'minioadmin')
MINIO_BUCKET = os.getenv('MINIO_BUCKET', 'underleaf-files')
MINIO_SECURE = os.getenv('MINIO_SECURE', 'false').lower() == 'true'

# ---------- Build paths ----------
COMPILE_TIMEOUT = int(os.getenv('COMPILE_TIMEOUT', 120))
SANDBOX_DIR = os.getenv('SANDBOX_DIR', '/sandbox')
OUTPUT_DIR = os.getenv('OUTPUT_DIR', '/output')
LOG_DIR = os.getenv('LOG_DIR', '/logs')

# ---------- Global clients ----------
minio_client: Minio | None = None
db_dsn: str = ""


def connect_postgres(max_retries: int = 10, retry_delay: float = 3.0):
    """Return a new psycopg2 connection, retrying on failure."""
    dsn = (
        f"host={POSTGRES_HOST} port={POSTGRES_PORT} "
        f"dbname={POSTGRES_DB} user={POSTGRES_USER} password={POSTGRES_PASSWORD}"
    )
    for attempt in range(1, max_retries + 1):
        try:
            conn = psycopg2.connect(dsn)
            conn.autocommit = True
            print(f"Connected to PostgreSQL (attempt {attempt})")
            return conn
        except psycopg2.OperationalError as exc:
            print(f"PostgreSQL connection attempt {attempt}/{max_retries} failed: {exc}")
            if attempt == max_retries:
                raise
            time.sleep(retry_delay)


def init_minio(max_retries: int = 10, retry_delay: float = 3.0) -> Minio:
    """Create the Minio client and ensure the bucket exists, with retries."""
    client = Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=MINIO_SECURE,
    )
    for attempt in range(1, max_retries + 1):
        try:
            if not client.bucket_exists(MINIO_BUCKET):
                client.make_bucket(MINIO_BUCKET)
                print(f"Created MinIO bucket: {MINIO_BUCKET}")
            else:
                print(f"MinIO bucket '{MINIO_BUCKET}' exists (attempt {attempt})")
            return client
        except Exception as exc:
            print(f"MinIO connection attempt {attempt}/{max_retries} failed: {exc}")
            if attempt == max_retries:
                raise
            time.sleep(retry_delay)


# ---------- Database helpers ----------
def update_job_status(
    job_id: str,
    status: str,
    artifact_ref: str | None = None,
    logs_ref: str | None = None,
    error_message: str | None = None,
) -> None:
    """Update the compile_jobs row in PostgreSQL."""
    conn = None
    try:
        conn = connect_postgres(max_retries=3, retry_delay=2.0)
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE compile_jobs
                SET status = %s,
                    artifact_ref = %s,
                    logs_ref = %s,
                    error_message = %s,
                    finished_at = %s
                WHERE id = %s
                """,
                (status, artifact_ref, logs_ref, error_message, datetime.now(timezone.utc), job_id),
            )
            print(f"Updated job {job_id} status to '{status}' in DB")
    except Exception as exc:
        print(f"Failed to update job {job_id} in DB: {exc}")
    finally:
        if conn:
            conn.close()


def set_job_running(job_id: str) -> None:
    """Mark the job as running (no finished_at)."""
    conn = None
    try:
        conn = connect_postgres(max_retries=3, retry_delay=2.0)
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE compile_jobs SET status = %s WHERE id = %s",
                ("RUNNING", job_id),
            )
            print(f"Marked job {job_id} as running")
    except Exception as exc:
        print(f"Failed to mark job {job_id} as running: {exc}")
    finally:
        if conn:
            conn.close()


# ---------- MinIO helpers ----------
def upload_to_minio(object_name: str, file_path: Path, content_type: str = "application/octet-stream") -> str:
    """Upload a local file to MinIO and return the object name."""
    global minio_client
    data = file_path.read_bytes()
    minio_client.put_object(
        MINIO_BUCKET,
        object_name,
        BytesIO(data),
        len(data),
        content_type=content_type,
    )
    print(f"Uploaded {object_name} ({len(data)} bytes) to MinIO")
    return object_name


def upload_bytes_to_minio(object_name: str, data: bytes, content_type: str = "text/plain") -> str:
    """Upload raw bytes to MinIO and return the object name."""
    global minio_client
    minio_client.put_object(
        MINIO_BUCKET,
        object_name,
        BytesIO(data),
        len(data),
        content_type=content_type,
    )
    print(f"Uploaded {object_name} ({len(data)} bytes) to MinIO")
    return object_name


# ---------- Build logic ----------
def download_files(job_data: dict) -> None:
    project_id = job_data['project_id']
    files = job_data.get('files', [])

    project_dir = Path(SANDBOX_DIR) / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    for file in files:
        file_path = project_dir / file['path']
        file_path.parent.mkdir(parents=True, exist_ok=True)
        content = file.get('content', '')
        file_path.write_text(content)


def run_compile(job_id: str, project_id: str, engine: str = 'pdflatex', draft: bool = False) -> tuple[bool, str, str]:
    """Run the LaTeX engine and return (success, error_msg, output_pdf_path).

    Output files are placed in a job-scoped directory (OUTPUT_DIR/{job_id}/)
    so concurrent workers never overwrite each other's artefacts.
    """
    import shutil as _shutil
    project_dir = Path(SANDBOX_DIR) / project_id
    # Per-job output directory prevents races between concurrent workers
    job_output_dir = Path(OUTPUT_DIR) / job_id
    job_output_dir.mkdir(parents=True, exist_ok=True)
    log_file = Path(LOG_DIR) / f"{job_id}.log"

    main_tex = None
    for tex_file in project_dir.glob('*.tex'):
        main_tex = tex_file
        break

    if not main_tex:
        return False, "No .tex file found", ""

    tex_stem = main_tex.stem
    output_pdf = job_output_dir / f"{tex_stem}.pdf"

    # Validate and default the engine
    valid_engines = {'pdflatex', 'xelatex', 'lualatex'}
    if engine not in valid_engines:
        print(f"Unknown engine '{engine}', defaulting to pdflatex")
        engine = 'pdflatex'

    # Use latexmk when available — handles multi-pass, BibTeX, and index generation
    use_latexmk = bool(_shutil.which('latexmk'))

    if use_latexmk:
        engine_flag = {'pdflatex': '-pdf', 'xelatex': '-xelatex', 'lualatex': '-lualatex'}[engine]
        cmd = [
            'latexmk',
            engine_flag,
            '-interaction=nonstopmode',
            '-halt-on-error',
            '-synctex=1',
            f'-output-directory={job_output_dir}',
        ]
        if draft:
            cmd.append('-draftmode')
        cmd.append(str(main_tex))
    else:
        cmd = [
            engine,
            '-interaction=nonstopmode',
            '-halt-on-error',
            '-synctex=1',
        ]
        if draft:
            cmd.append('-draftmode')
        cmd += [
            f'-output-directory={job_output_dir}',
            str(main_tex),
        ]

    try:
        result = subprocess.run(
            cmd,
            cwd=project_dir,
            timeout=COMPILE_TIMEOUT,
            capture_output=True,
            text=True
        )

        log_content = result.stdout + "\n" + result.stderr
        log_file.parent.mkdir(parents=True, exist_ok=True)
        log_file.write_text(log_content)

        if result.returncode == 0 and output_pdf.exists():
            return True, "", str(output_pdf)
        else:
            error_msg = result.stderr or "Compilation failed"
            return False, error_msg[:500], ""

    except subprocess.TimeoutExpired:
        try:
            log_file.parent.mkdir(parents=True, exist_ok=True)
            log_file.write_text(f"Compilation timed out after {COMPILE_TIMEOUT}s\n")
        except Exception:
            pass
        return False, f"Compilation timed out after {COMPILE_TIMEOUT}s", ""
    except Exception as e:
        return False, str(e), ""


# ---------- Cleanup ----------
def cleanup_job(job_id: str, project_id: str) -> None:
    """Remove sandbox, output, and log files for this job."""
    # Remove sandbox source files
    project_dir = Path(SANDBOX_DIR) / project_id
    if project_dir.exists():
        shutil.rmtree(project_dir, ignore_errors=True)

    # Remove the per-job output directory (scoped to job_id, safe for concurrency)
    job_output_dir = Path(OUTPUT_DIR) / job_id
    if job_output_dir.exists():
        shutil.rmtree(job_output_dir, ignore_errors=True)

    # Remove the per-job log file
    log_file = Path(LOG_DIR) / f"{job_id}.log"
    if log_file.exists():
        try:
            log_file.unlink()
        except Exception:
            pass


# ---------- RabbitMQ callback ----------
def callback(ch, method, properties, body):
    job = None
    try:
        job = json.loads(body)
        job_id = job['job_id']
        project_id = job['project_id']
        engine = job.get('engine', 'pdflatex')
        draft = bool(job.get('draft', False))
        print(f"Processing job: {job_id} (engine: {engine}, draft: {draft})")

        # Mark as running in the database
        set_job_running(job_id)

        # Download source files into sandbox
        download_files(job)

        # Run the compilation (output scoped to job_id for concurrency safety)
        success, error_msg, artifact_path = run_compile(job_id, project_id, engine, draft)

        # Path for the compile log (per-job, safe for concurrent workers)
        log_file = Path(LOG_DIR) / f"{job_id}.log"
        logs_ref = None

        # Upload logs to MinIO if the file exists
        if log_file.exists() and log_file.stat().st_size > 0:
            logs_object_name = f"artifacts/{job_id}/compile.log"
            try:
                logs_ref = upload_to_minio(logs_object_name, log_file, content_type="text/plain")
            except Exception as exc:
                print(f"Failed to upload logs for job {job_id}: {exc}")

        if success:
            # Upload PDF artifact to MinIO
            pdf_path = Path(artifact_path)
            artifact_object_name = f"artifacts/{job_id}/output.pdf"
            try:
                artifact_ref = upload_to_minio(
                    artifact_object_name, pdf_path, content_type="application/pdf"
                )
            except Exception as exc:
                print(f"Failed to upload PDF for job {job_id}: {exc}")
                # Treat upload failure as a job failure
                update_job_status(
                    job_id,
                    status="FAILED",
                    logs_ref=logs_ref,
                    error_message=f"PDF upload failed: {exc}",
                )
                ch.basic_ack(delivery_tag=method.delivery_tag)
                cleanup_job(project_id)
                return

            # Upload SyncTeX file if present (best-effort)
            tex_stem = Path(artifact_path).stem
            synctex_path = Path(OUTPUT_DIR) / f"{tex_stem}.synctex.gz"
            if synctex_path.exists():
                try:
                    upload_to_minio(
                        f"artifacts/{job_id}/output.synctex.gz",
                        synctex_path,
                        content_type="application/gzip",
                    )
                except Exception as exc:
                    print(f"Failed to upload synctex for job {job_id}: {exc}")

            # Update DB with success
            update_job_status(
                job_id,
                status="COMPLETED",
                artifact_ref=artifact_ref,
                logs_ref=logs_ref,
            )
            print(f"Job {job_id} completed successfully")
        else:
            # Update DB with failure
            update_job_status(
                job_id,
                status="FAILED",
                logs_ref=logs_ref,
                error_message=error_msg,
            )
            print(f"Job {job_id} failed: {error_msg}")

        ch.basic_ack(delivery_tag=method.delivery_tag)
        cleanup_job(job_id, project_id)

    except Exception as e:
        print(f"Error processing job: {e}")
        # Attempt to update DB if we have a job_id
        if job and 'job_id' in job:
            update_job_status(
                job['job_id'],
                status="FAILED",
                error_message=f"Unexpected worker error: {str(e)[:400]}",
            )
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        # Clean up if we know the IDs
        if job and 'job_id' in job and 'project_id' in job:
            cleanup_job(job['job_id'], job['project_id'])


# ---------- Per-thread consumer ----------
def run_consumer(worker_id: int) -> None:
    """A single pre-warmed consumer thread.  Each thread has its own RabbitMQ
    connection so it can block independently on channel.start_consuming()."""
    print(f"[worker-{worker_id}] Starting consumer thread")
    while True:
        try:
            credentials = pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASSWORD)
            connection = pika.BlockingConnection(
                pika.ConnectionParameters(
                    host=RABBITMQ_HOST,
                    port=RABBITMQ_PORT,
                    credentials=credentials,
                    heartbeat=600,
                    blocked_connection_timeout=300,
                    connection_attempts=3,
                    retry_delay=2,
                )
            )

            channel = connection.channel()
            channel.queue_declare(queue='compile_jobs', durable=True)
            # prefetch_count=1 ensures fair dispatch: this thread only gets
            # one unacked job at a time, allowing other threads to take new jobs.
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue='compile_jobs', on_message_callback=callback)

            print(f"[worker-{worker_id}] Waiting for jobs...")
            channel.start_consuming()
        except KeyboardInterrupt:
            print(f"[worker-{worker_id}] Stopped by user")
            break
        except Exception as e:
            print(f"[worker-{worker_id}] Connection error: {e}. Reconnecting in 5s...")
            time.sleep(5)


# ---------- Main entry point ----------
def main():
    global minio_client

    # Initialize MinIO client (retry on startup)
    print("Initializing MinIO client...")
    minio_client = init_minio()

    # Verify PostgreSQL connectivity on startup
    print("Verifying PostgreSQL connectivity...")
    conn = connect_postgres()
    conn.close()
    print("PostgreSQL connection verified")

    print(f"Starting pre-warmed worker pool with {WORKER_CONCURRENCY} thread(s)...")

    threads = []
    for i in range(WORKER_CONCURRENCY):
        t = threading.Thread(target=run_consumer, args=(i,), daemon=True, name=f"worker-{i}")
        t.start()
        threads.append(t)

    # Keep the main thread alive; daemon threads exit automatically when main exits
    try:
        for t in threads:
            t.join()
    except KeyboardInterrupt:
        print("Main thread interrupted — shutting down")


if __name__ == '__main__':
    main()
