FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn httpx

COPY app.py /app/app.py
COPY static /app/static

EXPOSE 8100
CMD ["python", "app.py"]
