"""Celery application configuration (optional — only if celery is installed)."""

try:
    from celery import Celery

    celery_app = Celery(
        "pdfreader",
        broker="redis://localhost:6379/0",
        backend="redis://localhost:6379/0",
        include=[
            "app.tasks.pdf_tasks",
        ],
    )

    celery_app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        timezone="Asia/Shanghai",
        enable_utc=True,
        task_track_started=True,
        task_acks_late=True,
        worker_prefetch_multiplier=1,
        task_soft_time_limit=300,
        task_time_limit=600,
    )
except ImportError:
    celery_app = None
