FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn httpx

COPY app.py /app/app.py

EXPOSE 8091
CMD ["python", "app.py"]
