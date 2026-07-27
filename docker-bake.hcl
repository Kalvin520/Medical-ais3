variable "IMAGE_REGISTRY" {
  default = "ghcr.io/kalvin520"
}

variable "IMAGE_PREFIX" {
  default = "medical-ais3"
}

variable "IMAGE_TAG" {
  default = "main"
}

group "default" {
  targets = [
    "medical-target",
    "vendor-entry",
    "biomed-ws",
    "fhir-gw",
    "hl7-engine",
    "ris-mwl",
    "pacs",
    "pacs-gw",
    "mri-sim",
    "bms",
    "chiller-sim",
    "protocol-runner",
    "lab-scene",
    "reset-controller",
  ]
}

target "_multiarch" {
  platforms = ["linux/amd64", "linux/arm64"]
}

target "medical-target" {
  inherits   = ["_multiarch"]
  context    = "."
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-medical-target:${IMAGE_TAG}"]
}

target "vendor-entry" {
  inherits   = ["_multiarch"]
  context    = "lab/hosts/vendor-entry"
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-vendor-entry:${IMAGE_TAG}"]
}

target "biomed-ws" {
  inherits   = ["_multiarch"]
  context    = "lab"
  dockerfile = "hosts/biomed-ws/Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-biomed-ws:${IMAGE_TAG}"]
}

target "fhir-gw" {
  inherits   = ["_multiarch"]
  context    = "lab/services/fhir-gw"
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-fhir-gw:${IMAGE_TAG}"]
}

target "hl7-engine" {
  inherits   = ["_multiarch"]
  context    = "lab/services/hl7-engine"
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-hl7-engine:${IMAGE_TAG}"]
}

target "ris-mwl" {
  inherits   = ["_multiarch"]
  context    = "lab/services/ris-mwl"
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-ris-mwl:${IMAGE_TAG}"]
}

target "pacs" {
  inherits   = ["_multiarch"]
  context    = "lab/services/pacs"
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-pacs:${IMAGE_TAG}"]
}

target "pacs-gw" {
  inherits   = ["_multiarch"]
  context    = "lab/services/pacs-gw"
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-pacs-gw:${IMAGE_TAG}"]
}

target "mri-sim" {
  inherits   = ["_multiarch"]
  context    = "lab/services/mri-sim"
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-mri-sim:${IMAGE_TAG}"]
}

target "bms" {
  inherits   = ["_multiarch"]
  context    = "lab/services/bms"
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-bms:${IMAGE_TAG}"]
}

target "chiller-sim" {
  inherits   = ["_multiarch"]
  context    = "lab/services/chiller-sim"
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-chiller-sim:${IMAGE_TAG}"]
}

target "protocol-runner" {
  inherits   = ["_multiarch"]
  context    = "lab"
  dockerfile = "services/protocol-runner/Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-protocol-runner:${IMAGE_TAG}"]
}

target "lab-scene" {
  inherits   = ["_multiarch"]
  context    = "lab/services/lab-scene"
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-lab-scene:${IMAGE_TAG}"]
}

target "reset-controller" {
  inherits   = ["_multiarch"]
  context    = "lab"
  dockerfile = "services/reset-controller/Dockerfile"
  tags       = ["${IMAGE_REGISTRY}/${IMAGE_PREFIX}-reset-controller:${IMAGE_TAG}"]
}
