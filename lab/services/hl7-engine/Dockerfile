FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir \
    fastapi==0.140.1 uvicorn==0.51.0 httpx==0.28.1 hl7==0.4.5

COPY app.py /app/app.py
COPY mllp_server.py /app/mllp_server.py

EXPOSE 2575 8075
CMD ["python", "app.py"]
