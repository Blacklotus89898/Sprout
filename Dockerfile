# Three stages, one image (ADR 0001 §1): build the React reader, embed it in a
# static Go binary (with CC-CEDICT, also embedded), and run on distroless :nonroot.
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /out/sprout .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/sprout /sprout
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/sprout"]
