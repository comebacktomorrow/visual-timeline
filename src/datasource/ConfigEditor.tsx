import React, { ChangeEvent } from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { ConfigSection, DataSourceDescription } from '@grafana/plugin-ui';
import { Divider, Field, Input, SecretInput, Switch } from '@grafana/ui';

import type { VisualTimelineOptions, VisualTimelineSecureOptions } from './types';

type Props = DataSourcePluginOptionsEditorProps<VisualTimelineOptions, VisualTimelineSecureOptions>;

const DOCS_URL = 'https://github.com/comebacktomorrow/visual-timeline#readme';

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
      {/* The API URL is the only required field, and only when demo data is off. */}
      <DataSourceDescription dataSourceName="Visual Timeline API" docsLink={DOCS_URL} hasRequiredFields={!demo} />

      <Divider />

      <Field label="Demo data" description="Use five built-in demo hosts instead of an API. Turn off to connect your own.">
        <Switch id="vt-demo" value={demo} onChange={onDemoChange} />
      </Field>

      {!demo && (
        <>
          <Divider />

          <ConfigSection title="Connection">
            <Field
              label="API URL"
              required
              description="Base URL of your frames API, e.g. https://frames.example.com. Grafana's server must reach it; viewers' browsers must reach the image URLs it returns."
            >
              <Input
                id="vt-api-url"
                value={jsonData.apiUrl || ''}
                placeholder="https://frames.example.com"
                width={60}
                onChange={onApiUrlChange}
              />
            </Field>
          </ConfigSection>

          <Divider />

          <ConfigSection title="Authentication">
            <Field
              label="Viewer token"
              description="Sent by Grafana's server as a Bearer token, never to browsers. Leave empty if the API allows open reads."
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
          </ConfigSection>
        </>
      )}
    </div>
  );
}
