FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi==0.140.1 uvicorn==0.51.0 httpx==0.28.1

COPY app.py /app/app.py

EXPOSE 8091
CMD ["python", "app.py"]
