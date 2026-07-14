# PulseBoard — local build, run, Docker, and release helpers
#
# Usage: make help

.PHONY: help install install-frontend install-backend \
	dev-backend dev-frontend build build-frontend build-backend start \
	lint test tidy \
	docker-build docker-build-all docker-build-frontend docker-build-backend \
	docker-push docker-up docker-down docker-logs \
	next-patch next-minor next-major \
	release release-patch release-minor release-major \
	clean clean-frontend clean-backend

ROOT          := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
BACKEND_DIR   := $(ROOT)/backend
FRONTEND_DIR  := $(ROOT)/frontend
SERVER_BIN    := $(BACKEND_DIR)/bin/server

# Docker image (matches .github/workflows/*-release.yml)
IMAGE_NAME    ?= ntoric/pulserboard
VERSION       ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMPOSE_FILE  ?= docker-compose.prod.yml
ECR_IMAGE     ?= $(IMAGE_NAME)

export CGO_ENABLED ?= 1
export STATIC_DIR  ?= $(FRONTEND_DIR)/dist
export DATA_DIR    ?= $(BACKEND_DIR)/data
export PORT        ?= 8080

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nTargets:\n"} \
		/^[a-zA-Z0-9_.-]+:.*##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf "\nVariables: IMAGE_NAME=$(IMAGE_NAME) VERSION=$(VERSION) PORT=$(PORT)\n\n"

# ---- Install ----

install: install-frontend install-backend ## Install frontend + backend deps

install-frontend: ## npm ci in frontend/
	cd $(FRONTEND_DIR) && npm ci

install-backend: ## go mod download
	cd $(BACKEND_DIR) && go mod download

# ---- Dev ----

dev-backend: ## Run Go API (localhost:8080)
	cd $(BACKEND_DIR) && go run ./cmd/server

dev-frontend: ## Run Vite dev server (localhost:5173)
	cd $(FRONTEND_DIR) && npm run dev

# ---- Build / run ----

build: build-frontend build-backend ## Build frontend dist + backend binary

build-frontend: ## Build React app → frontend/dist
	cd $(FRONTEND_DIR) && npm run build

build-backend: ## Build Go server → backend/bin/server
	cd $(BACKEND_DIR) && go build -ldflags="-s -w" -o $(SERVER_BIN) ./cmd/server

start: build ## Serve built frontend from Go (production-style)
	cd $(BACKEND_DIR) && STATIC_DIR=$(STATIC_DIR) DATA_DIR=$(DATA_DIR) PORT=$(PORT) $(SERVER_BIN)

# ---- Quality ----

lint: ## Lint frontend (oxlint) + go vet
	cd $(FRONTEND_DIR) && npm run lint
	cd $(BACKEND_DIR) && go vet ./...

test: ## Run Go tests
	cd $(BACKEND_DIR) && go test ./...

tidy: ## go mod tidy
	cd $(BACKEND_DIR) && go mod tidy

# ---- Docker ----

docker-build: docker-build-frontend docker-build-backend ## Build split frontend + backend images

docker-build-all: ## Build monolithic image (Dockerfile)
	docker build -f Dockerfile -t $(IMAGE_NAME):$(VERSION) -t $(IMAGE_NAME):latest $(ROOT)

docker-build-frontend: ## Build frontend image
	docker build -f Dockerfile.frontend \
		-t $(IMAGE_NAME):frontend \
		-t $(IMAGE_NAME):$(VERSION)-frontend \
		$(ROOT)

docker-build-backend: ## Build backend image
	docker build -f Dockerfile.backend \
		-t $(IMAGE_NAME):backend \
		-t $(IMAGE_NAME):$(VERSION)-backend \
		$(ROOT)

docker-push: ## Push frontend + backend tags to registry
	docker push $(IMAGE_NAME):frontend
	docker push $(IMAGE_NAME):$(VERSION)-frontend
	docker push $(IMAGE_NAME):backend
	docker push $(IMAGE_NAME):$(VERSION)-backend

docker-up: ## Start prod compose stack (needs ECR_IMAGE or IMAGE_NAME)
	ECR_IMAGE=$(ECR_IMAGE) docker compose -f $(COMPOSE_FILE) up -d

docker-down: ## Stop prod compose stack
	ECR_IMAGE=$(ECR_IMAGE) docker compose -f $(COMPOSE_FILE) down

docker-logs: ## Tail compose logs
	ECR_IMAGE=$(ECR_IMAGE) docker compose -f $(COMPOSE_FILE) logs -f

# ---- Release ----
# Creates an annotated git tag and pushes it (triggers CI image build).
# Example: make release VERSION=v1.2.3
# Or bump helpers: make release-patch | release-minor | release-major

# next version from latest tag: make release VERSION=$$(make -s next-patch)
next-patch next-minor next-major:
	@latest=$$(git describe --tags --abbrev=0 2>/dev/null || echo v0.0.0); \
	latest=$${latest#v}; \
	major=$${latest%%.*}; rest=$${latest#*.}; \
	minor=$${rest%%.*}; patch=$${rest#*.}; \
	case "$@" in \
		next-major) major=$$((major+1)); minor=0; patch=0 ;; \
		next-minor) minor=$$((minor+1)); patch=0 ;; \
		next-patch) patch=$$((patch+1)) ;; \
	esac; \
	echo "v$${major}.$${minor}.$${patch}"

release: ## Tag VERSION and push (VERSION=vX.Y.Z required)
	@test -n "$(filter-out dev,$(VERSION))" || (echo "Set VERSION=vX.Y.Z" >&2; exit 1)
	@echo "$(VERSION)" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$$' \
		|| (echo "VERSION must look like v1.2.3 (got $(VERSION))" >&2; exit 1)
	@git diff --quiet && git diff --cached --quiet \
		|| (echo "Working tree dirty — commit or stash first" >&2; exit 1)
	git tag -a "$(VERSION)" -m "Release $(VERSION)"
	git push origin "$(VERSION)"
	@echo "Pushed tag $(VERSION) — CI will build $(IMAGE_NAME):{frontend,backend}"

release-patch: ## Bump patch (vX.Y.Z → vX.Y.Z+1) and release
	@$(MAKE) release VERSION=$$($(MAKE) -s next-patch)

release-minor: ## Bump minor and release
	@$(MAKE) release VERSION=$$($(MAKE) -s next-minor)

release-major: ## Bump major and release
	@$(MAKE) release VERSION=$$($(MAKE) -s next-major)

# ---- Clean ----

clean: clean-frontend clean-backend ## Remove build artifacts

clean-frontend: ## Remove frontend/dist
	rm -rf $(FRONTEND_DIR)/dist

clean-backend: ## Remove backend/bin
	rm -rf $(BACKEND_DIR)/bin
