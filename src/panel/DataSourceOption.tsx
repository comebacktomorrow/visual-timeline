import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { DataSourcePicker } from '@grafana/runtime';

import { DATASOURCE_ID } from '../shared/proxy';

/* Panel option editor: pick a Visual Timeline API data source. Only its uid
 * is stored in the panel JSON; the URL and token stay in the data source. */
export function DataSourceOption({ value, onChange }: StandardEditorProps<string | undefined>) {
  return (
    <DataSourcePicker
      pluginId={DATASOURCE_ID}
      current={value || null}
      noDefault
      placeholder="None"
      onChange={(ds) => onChange(ds.uid)}
      onClear={() => onChange(undefined)}
    />
  );
}
