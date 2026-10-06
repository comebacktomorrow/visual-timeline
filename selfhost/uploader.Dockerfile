# The camera uploader: snapshot-uploader.sh with curl, ffmpeg and jq. It
# reads /config/cameras.json; selfhost/docker-compose.yml runs it.
FROM alpine:3.22
RUN apk add --no-cache curl ffmpeg jq
COPY snapshot-uploader.sh /usr/local/bin/snapshot-uploader.sh
CMD ["sh", "/usr/local/bin/snapshot-uploader.sh", "/config/cameras.json"]
