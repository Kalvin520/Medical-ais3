FROM node:22-alpine AS frontend-build

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.25.5-alpine AS backend-build

WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/med-target .

FROM alpine:3.21

RUN addgroup -S medrange && adduser -S -G medrange medrange
WORKDIR /app
COPY --from=backend-build /out/med-target /app/med-target
COPY --from=frontend-build /src/frontend/dist /app/web

ENV STATIC_DIR=/app/web \
    HTTP_PORT=8090 \
    MODBUS_PORT=1502 \
    HL7_PORT=2576 \
    DICOM_PORT=11113

EXPOSE 8090 1502 2576 11113
USER medrange
ENTRYPOINT ["/app/med-target"]
