FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir \
    fastapi==0.140.1 uvicorn==0.51.0 httpx==0.28.1 hl7==0.4.5

COPY services/reset-controller/app.py /app/app.py
COPY services/reset-controller/seed_lib.py /app/seed_lib.py
COPY seed/ /seed/

EXPOSE 8099
CMD ["python", "app.py"]
