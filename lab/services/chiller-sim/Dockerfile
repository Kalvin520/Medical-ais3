FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir fastapi==0.140.1 uvicorn==0.51.0 bacpypes3==0.0.106

COPY app.py /app/app.py

EXPOSE 8092 47808/udp
CMD ["python", "app.py"]
