FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn pynetdicom pydicom

COPY app.py /app/app.py

EXPOSE 11114 8080
CMD ["python", "app.py"]
