FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir \
    fastapi==0.140.1 uvicorn==0.51.0 pynetdicom==3.0.4 pydicom==3.0.2

COPY app.py /app/app.py

EXPOSE 11114 8080
CMD ["python", "app.py"]
