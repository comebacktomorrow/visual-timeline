/* What a panel that can't draw says instead. Errors from the data source
 * aren't repeated here: Grafana shows them in the panel's error indicator. */
export function emptyStateText(hasSources: boolean, dataSourceCount: number, canCreate: boolean, hasData = false) {
  if (hasData && !hasSources) {
    return { lines: ["No frames in this panel's query.", 'It needs a time, an image URL and a host per row. Set Frame fields in the panel options if they have other names.'] };
  }
  if (hasSources) {
    return { lines: ['No hosts match.', "Check this panel's query (Sites, Hosts, Tags) and the dashboard's filters."] };
  }
  const needs = 'It draws rows with a time, an image and a host, from any data source.';
  if (dataSourceCount > 0) {
    return { lines: ["This panel's query returned nothing.", needs, 'A Visual Timeline data source with Demo data on has some to try.'] };
  }
  return canCreate
    ? {
        lines: ["This panel's query returned nothing.", needs],
        link: { text: 'Add a Visual Timeline data source', after: ' and choose Demo data as its connection to try the panel.' },
      }
    : { lines: ["This panel's query returned nothing.", needs, 'A Grafana admin can add a Visual Timeline data source with Demo data to try it.'] };
}
