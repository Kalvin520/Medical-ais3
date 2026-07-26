FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi uvicorn bacpypes3

COPY app.py /app/app.py

EXPOSE 8092 47808/udp
CMD ["python", "app.py"]
