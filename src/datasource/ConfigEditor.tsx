import React, { ChangeEvent } from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { Field, Input, SecretInput, Switch } from '@grafana/ui';

import type { VisualTimelineOptions, VisualTimelineSecureOptions } from './types';

type Props = DataSourcePluginOptionsEditorProps<VisualTimelineOptions, VisualTimelineSecureOptions>;

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData, secureJsonFields, secureJsonData } = options;

  const demo = jsonData.demo === true;
  const onDemoChange = (event: React.SyntheticEvent<HTMLInputElement>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, demo: event.currentTarget.checked } });
  };
  const onApiUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({ ...options, jsonData: { ...jsonData, apiUrl: event.target.value } });
  };
  const onTokenChange = (event: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({ ...options, secureJsonData: { ...secureJsonData, viewerToken: event.target.value } });
  };
  const onTokenReset = () => {
    onOptionsChange({
      ...options,
      secureJsonFields: { ...secureJsonFields, viewerToken: false },
      secureJsonData: { ...secureJsonData, viewerToken: '' },
    });
  };

  return (
    <div data-testid="vt-datasource-config">
      <Field
        label="Demo data"
        description="Show built-in demo sources instead of calling an API: five simulated sources with an outage, a cadence change, a declared pause and two time zones. Use it to try the plugin; turn it off and set the API URL for your own frames."
      >
        <Switch id="vt-demo" value={demo} onChange={onDemoChange} />
      </Field>
      {!demo && (
        <>
          <Field
            label="API URL"
            description="Base URL of the frames API, e.g. https://frames.example.com. Grafana's server calls /sources and /frames there; viewers' browsers load the image URLs it returns directly."
          >
            <Input
              id="vt-api-url"
              value={jsonData.apiUrl || ''}
              placeholder="https://frames.example.com"
              width={60}
              onChange={onApiUrlChange}
            />
          </Field>
          <Field
            label="Viewer token"
            description="Stored encrypted. Grafana's server sends it as Authorization: Bearer on API calls; it never reaches the browser or the dashboard JSON. Leave empty for an API with open reads. An API that requires it must sign its image URLs."
          >
            <SecretInput
              id="vt-viewer-token"
              isConfigured={Boolean(secureJsonFields?.viewerToken)}
              value={secureJsonData?.viewerToken || ''}
              placeholder="Viewer token"
              width={60}
              onChange={onTokenChange}
              onReset={onTokenReset}
            />
          </Field>
        </>
      )}
    </div>
  );
}
