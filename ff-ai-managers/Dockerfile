FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN chmod +x run_week.sh migration/*.sh \
 && useradd --create-home app && chown -R app:app /app
USER app
EXPOSE 8000
# Render injects PORT; fall back to 8000 for local docker runs
CMD ["sh","-c","exec uvicorn webapp:app --host 0.0.0.0 --port ${PORT:-8000}"]
