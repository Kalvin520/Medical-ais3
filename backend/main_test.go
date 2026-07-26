package main

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func TestProxyHospitalRequest(t *testing.T) {
	handler := proxyHospitalRequest(
		&http.Client{
			Timeout: time.Second,
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if req.Method != http.MethodGet {
					t.Fatalf("unexpected upstream method: %s", req.Method)
				}
				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": []string{"application/json"}},
					Body:       io.NopCloser(strings.NewReader(`{"ok":true,"facilities":[]}`)),
				}, nil
			}),
		},
		"http://hospital-scene/api/snapshot",
		http.MethodGet,
	)
	req := httptest.NewRequest(http.MethodGet, "/api/hospital/snapshot", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"ok":true,"facilities":[]}` {
		t.Fatalf("unexpected proxy body: %s", got)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("expected no-store cache control, got %q", got)
	}
}

func TestProxyHospitalRequestRejectsWrongMethod(t *testing.T) {
	handler := proxyHospitalRequest(
		&http.Client{Timeout: time.Second},
		"http://127.0.0.1:1/reset",
		http.MethodPost,
	)
	req := httptest.NewRequest(http.MethodGet, "/api/hospital/reset", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

func TestProxyHospitalRequestUnavailable(t *testing.T) {
	handler := proxyHospitalRequest(
		&http.Client{
			Timeout: 50 * time.Millisecond,
			Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return nil, errors.New("upstream unavailable")
			}),
		},
		"http://hospital-scene/api/snapshot",
		http.MethodGet,
	)
	req := httptest.NewRequest(http.MethodGet, "/api/hospital/snapshot", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}
