# Reading frames from existing data sources

The Visual Timeline panel draws rows with **a time, an image and a host**, from
any data source that returns them. A host's state (paused, under maintenance)
can come from another query of rows with a time, a host and a `state` field.
README: "Frames from any data source" has the field names the panel looks for.

## Tested

These are exercised by the e2e tests, against the dev stack's fixture
(`docker compose up`, `tests/folder-fixture`), on every pull request.

| Data source                             | Recipe                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| **PostgreSQL** (and SQL in general)     | below                                                         |
| **Loki**                                | below                                                         |
| **TestData** (CSV content)              | the provisioned "Visual Timeline — any data source" dashboard |
| **Visual Timeline** (HTTP folder, demo) | [FOLDERS.md](FOLDERS.md)                                      |

### PostgreSQL, and SQL databases

A table of frames, one row each:

```sql
SELECT time, host, image, image_hi
FROM frames
WHERE $__timeFilter(time)
ORDER BY time
```

Set the query's **Format** to **Table**. `image` is a URL viewers' browsers
can load; `image_hi` (optional) is a larger one for the click-in preview;
`site` (optional) groups hosts. Name the columns as you like and set them
under the panel's **Frame fields** when they differ.

Video clips (M10c, experimental) are columns too: `video` (a clip starting at the row's
time), `video_hi` (a larger version), and `video_end` (a time) or
`video_duration` (ms). A row may have an image, a video or both:

```sql
SELECT time, host, image, video, video_end
FROM frames
WHERE $__timeFilter(time)
   OR (video IS NOT NULL AND video_end > $__timeFrom())   -- the clip in force at the start
ORDER BY time
```

A large table can return fewer rows over long ranges: one per host per
`$__interval` (with a `frame_count` column saying how many frames each row
stands for, if you like). The panel draws what it gets, and when its preview
player or hover flipbook needs one slot's frames, it runs the query again
for just that slot, so `$__timeFilter` and `$__interval` there narrow to
it.

To have missing frames drawn as offline, add a `cadence` column (ms): how
often the host promises a frame, such as `60000 AS cadence`. Without one, a
host promises nothing, and its silences are neutral "no data" (the panel's
**Expected cadence** sets a promise for every host instead).

A host's pauses, from a second query in the same panel:

```sql
SELECT time, host, state FROM states ORDER BY time
```

Then, in the panel's **Overrides**, add **Fields with name** `state` with
**Pauses frames** on and **Value mappings** for each state's label and colour.
An empty state (or one mapped to Transparent) ends a pause.

The same shape works from MySQL, Microsoft SQL Server and other SQL data
sources, with their own time macros. A pivot, one image column per host,
draws as a wide table.

### Loki

Log lines that are image URLs, one stream per host (a camera's upload log):

```logql
{job="cameras"}
```

Add the **Extract fields** transformation with source `labels`, which turns
the stream's labels into columns (`host` among them). The panel finds the
image in the `Line` field by its content: the one text field whose values are
plainly images. Name it under **Frame fields → Image** if the lines are
anything else.

## Checked by hand

**Infinity** (JSON, CSV and XML APIs), reading the reference worker on the
self-hosted stack, as [INFINITY.md](INFINITY.md) describes. Not in CI: the
test stack doesn't install it.

## Should work, not tested

These return the right shape, but no test covers them yet.

| Data source                                         | How                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **InfluxDB**                                        | the image URL as a string field and the host as a tag; tags become labels, which the panel reads |
| **Elasticsearch / OpenSearch**                      | raw-document queries as tables                                                                   |
| **Other SQL** (MySQL, MS SQL, ClickHouse, BigQuery) | as PostgreSQL above                                                                              |

## State only

Data sources with numbers but no text (**Prometheus**, metrics queries) can't
hold image URLs, but can say a host's state: a gauge such as `up` (1 or 0)
with value mappings, 1 to Transparent (the normal state) and 0 to a red
**Down**, and the host from a label. (The shape is unit-tested; no Prometheus
is in the test stack.)
