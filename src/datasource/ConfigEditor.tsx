import React from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { DataSourceDescription } from '@grafana/plugin-ui';
import { Alert, Divider, Field, Switch } from '@grafana/ui';

import type { VisualTimelineOptions } from './types';

type Props = DataSourcePluginOptionsEditorProps<VisualTimelineOptions>;

const DOCS_URL = 'https://github.com/comebacktomorrow/visual-timeline#readme';
const ANY_SOURCE_URL = 'https://github.com/comebacktomorrow/visual-timeline#frames-from-any-data-source';

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData } = options;

  const demo = jsonData.demo === true;
  const onDemoChange = (event: React.SyntheticEvent<HTMLInputElement>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, demo: event.currentTarget.checked } });
  };

  return (
    <div data-testid="vt-datasource-config">
      <DataSourceDescription dataSourceName="Visual Timeline" docsLink={DOCS_URL} hasRequiredFields={false} />

      <Divider />

      <Field label="Demo data" description="Five built-in demo hosts with frames, events and outages, to try the panels with nothing else set up.">
        <Switch id="vt-demo" value={demo} onChange={onDemoChange} />
      </Field>

      {!demo && (
        <Alert severity="info" title="Your own frames">
          Visual Timeline panels read frames from any data source whose rows have a time, an image and a host.{' '}
          <a href={ANY_SOURCE_URL} target="_blank" rel="noreferrer" className="external-link">
            How it works
          </a>
        </Alert>
      )}
    </div>
  );
}
