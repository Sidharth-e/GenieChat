# The published `dxflrs/garage` image is built FROM scratch: it contains the
# /garage binary and nothing else -- no shell, no config file -- so on its own
# it cannot run scripts/garage-bootstrap.sh, which the one-shot `garage-bootstrap`
# compose service needs. This image pairs the same pinned binary with a shell.
#
# Keep the tag here in step with the `garage` service in docker-compose.yml.
FROM dxflrs/garage:v2.4.1 AS garage

FROM alpine:3.24
RUN apk add --no-cache bash
COPY --from=garage /garage /garage
