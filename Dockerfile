# Static Go binary on distroless :nonroot (the Tulip pattern). The deployment
# sets fsGroup 65532 so a data PVC stays writable once Sprout has state.
# The React/TS web app (web/, ADR 0001 §1) will build in its own stage and be
# embedded into the binary — still one image.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/sprout .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/sprout /sprout
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/sprout"]
