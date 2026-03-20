FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (cached layer — only rebuilds if requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . .

EXPOSE 8000

CMD ["gunicorn", "run:app", \
     "--bind", "0.0.0.0:8000", \
     "--worker-class", "gthread", \
     "--workers", "2", \
     "--threads", "4", \
     "--timeout", "3600", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
