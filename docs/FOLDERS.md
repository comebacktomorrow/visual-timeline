# Frames from a web folder or a public bucket

The Visual Timeline data source's **HTTP folder** connection reads timestamped
images where they already land: a web server's folder, or a public S3-compatible
bucket. Cameras that upload snapshots by FTP, motion and motionEye, Home
Assistant's `camera.snapshot`, timelapse scripts and anything that writes JPEGs
to S3 or MinIO all write files like this. No database or API of your own is
needed: the folder's listing is the index.

- **Listings** go through Grafana's server (the data source's proxy route), with
  an optional bearer token that never reaches the browser.
- **Images** load straight from the folder in viewers' browsers, so the folder
  must be reachable from them. When browsers reach it at another address than
  Grafana's server does, set **Image URL**.
- **Hosts** are whatever the listing holds: every `{host}` value it finds.

## Settings

| Setting                  | What it is                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Folder URL**           | The folder's base URL, as Grafana's server reaches it.                                                                                                                                                                |
| **Image URL**            | Only when browsers reach the folder elsewhere (an internal name for Grafana, a public one for browsers).                                                                                                              |
| **Listing**              | **HTML links** (Apache, nginx's default autoindex, lighttpd, Python's `http.server`, IIS), **JSON** (nginx `autoindex_format json`, Caddy `file_server browse`) or **S3 bucket** (a public bucket's `ListObjectsV2`). |
| **Path template**        | Where frames live below the folder (below).                                                                                                                                                                           |
| **Video path template**  | Experimental, optional: where video clips live below the folder, named like the frames (Video clips, below).                                                                                                          |
| **Expected every**       | Optional: how often each host takes a frame (`1m`, `30s`), as a promise. A frame missing past it is drawn red, as offline. Empty: no promise; a missing frame is never offline (below).                               |
| **Time zone**            | The zone the times in names are in. Empty: UTC.                                                                                                                                                                       |
| **Small / Large images** | With `{variant}`: its value for strips and grids, and for the click-in preview.                                                                                                                                       |
| **Bearer token**         | Optional; sent by Grafana's server with each listing.                                                                                                                                                                 |

## The path template

One template describes every frame's path below the folder:

- **Time:** `{YYYY}` `{MM}` `{DD}` `{DDD}` (day of the year) `{HH}` `{mm}` `{ss}`,
  or `{epoch}` (seconds) or `{epoch_ms}`.
- **Identity:** `{host}` (required), `{site}` and `{variant}` (an image size,
  any text: `lo`, `512`, `625x375`).
- **Anywhere:** placeholders can sit in folder names or in the file name, and
  one can repeat (a host's folder and its file name); every occurrence must
  agree. Other text matches literally, and files that don't match are ignored.

Times in a file name should run from the largest unit to the smallest
(`{YYYY}{MM}{DD}_{HH}{mm}{ss}`), so names sort by time. Each frame keeps its
own time, so seconds that drift don't matter.

Date folders (`{YYYY}/{MM}/{DD}/`) are never listed: the data source builds
the ones a time range needs. Folders named by a host, site or variant are
listed, unless the query already names them.

## Examples

| Source                                                                    | Listing   | Template                                                                                                                                                                          |
| ------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One folder per camera, a file per minute                                  | HTML      | `{host}/{YYYY}{MM}{DD}-{HH}{mm}{ss}.jpg`                                                                                                                                          |
| Daily folders with small and large sizes                                  | JSON      | `{site}/{host}/{YYYY}-{MM}-{DD}/{HH}{mm}{ss}_{variant}.jpg`                                                                                                                       |
| Epoch names                                                               | HTML      | `{host}/{epoch_ms}.jpg`                                                                                                                                                           |
| NASA SDO (the Sun), `https://sdo.gsfc.nasa.gov/assets/img`                | HTML      | `browse/{YYYY}/{MM}/{DD}/{YYYY}{MM}{DD}_{HH}{mm}{ss}_{variant}_{host}.jpg` (small `512`, large `2048`); video `dailymov/{YYYY}/{MM}/{DD}/{YYYY}{MM}{DD}_1024_{host}.mp4`          |
| NOAA GOES-19 Band 13, `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS` | HTML      | `{host}/{YYYY}{DDD}{HH}{mm}_GOES19-ABI-CONUS-13-{variant}.jpg` (host `13`: set the query's Hosts to `13`, so only that band's folder is read; small `625x375`, large `2500x1500`) |
| USGS river cameras, `https://usgs-nims-images.s3.amazonaws.com`           | S3 bucket | `{variant}/{host}/{host}___{YYYY}-{MM}-{DD}T{HH}-{mm}-{ss}Z.jpg` (small `thumbnail`, large `720`)                                                                                 |

The SDO and USGS rows run as the demo stack's **The Sun** and **Rivers**
dashboards (README: Demo), provisioned in
`grafana/provisioning/datasources/public-feeds.yaml`.

Credit public sources on any dashboard that shows them: "Courtesy of NASA/SDO
and the AIA, EVE, and HMI science teams"; "NOAA/NESDIS/STAR"; "USGS".

## Video clips (experimental)

A folder can hold video beside its frames. Set **Video path template** to
where the clips live, with the same placeholders. Each clip spans the finest
time its name gives, read in the folder's time zone:

- `{DD}` (or `{DDD}`): the whole day, as NASA SDO's daily movies are;
- `{HH}`: the hour; `{mm}`: the minute;
- down to `{ss}` or an epoch: the name says when the clip starts, not how
  long it runs, so it lasts a frame's time (one a minute: a minute of video).

With `{variant}`, the Small and Large values pick a clip's two versions,
as for images. The preview player plays a clip over the frames it covers
(README: Video clips). Frames are still what fill the strip, so keep them
coming beside the video.

NASA's movies are about 13 MB each, from a slow server, with their index at
the end of the file: the player shows the frame underneath, and says it's
loading, until the video can play. Your own clips will start sooner served
with their index first (`ffmpeg -movflags +faststart`).

## Serving a folder

- **nginx:** `location /frames/ { alias /srv/frames/; autoindex on; }`, with
  `autoindex_format json;` for the JSON listing.
- **Apache:** `Options +Indexes` on the folder.
- **Caddy:** `file_server browse`.
- **A bucket:** a public bucket answers `ListObjectsV2` without credentials.
  Private buckets aren't supported yet.

A listing is reused for a minute, so a dashboard's panels and variables share
it. A query lists at most 200 folders; past that, the panel shows a notice and
some hosts or times aren't read.

## Missing frames

A folder says nothing about how often its hosts take frames, so by default
they promise nothing: each frame is shown until the next one, and a long
silence is a neutral "no data", never offline (README: "How a time range is
drawn"). For heartbeat cameras whose missing frames matter, set **Expected
every**: a frame missing past it is then drawn red, as offline. A panel's
**Expected cadence** does the same for one panel.

## Small and large images

Both are optional: with one size, it's used for the strips and the preview. The
data source never resizes images. Producing a small size is your pipeline's
job: the uploader can post both (as `selfhost/snapshot-uploader.sh` does), a
bucket event can trigger a small resize job, or an on-the-fly resizer (imgproxy,
imagor, thumbor, nginx `image_filter`, Cloudflare Image Transformations) can sit
in front of the folder. Full-size images work, but cost bandwidth and browser
decoding with many hosts.
