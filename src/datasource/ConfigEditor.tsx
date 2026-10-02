import React, { ChangeEvent } from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { Field, Input, SecretInput } from '@grafana/ui';

import type { VisualTimelineOptions, VisualTimelineSecureOptions } from './types';

type Props = DataSourcePluginOptionsEditorProps<VisualTimelineOptions, VisualTimelineSecureOptions>;

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData, secureJsonFields, secureJsonData } = options;

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
    </div>
  );
}
