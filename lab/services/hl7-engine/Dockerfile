FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn httpx hl7

COPY app.py /app/app.py
COPY mllp_server.py /app/mllp_server.py

EXPOSE 2575 8075
CMD ["python", "app.py"]
