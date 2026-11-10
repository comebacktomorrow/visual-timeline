import React, { ChangeEvent } from 'react';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { ConfigSection, DataSourceDescription } from '@grafana/plugin-ui';
import { Alert, Divider, Field, Input, RadioButtonGroup, SecretInput } from '@grafana/ui';

import { compileTemplate } from './folder/template';
import type { VisualTimelineOptions, VisualTimelineSecureOptions } from './types';

type Props = DataSourcePluginOptionsEditorProps<VisualTimelineOptions, VisualTimelineSecureOptions>;

const DOCS_URL = 'https://github.com/comebacktomorrow/visual-timeline#readme';
const ANY_SOURCE_URL = 'https://github.com/comebacktomorrow/visual-timeline#frames-from-any-data-source';
const FOLDER_DOCS_URL = 'https://github.com/comebacktomorrow/visual-timeline/blob/main/docs/FOLDERS.md';

type Connection = 'demo' | 'folder' | 'none';
const CONNECTIONS: Array<{ value: Connection; label: string }> = [
  { value: 'demo', label: 'Demo data' },
  { value: 'folder', label: 'HTTP folder' },
  { value: 'none', label: 'None' },
];
const LISTINGS = [
  { value: 'html' as const, label: 'HTML links', description: 'Apache, nginx, lighttpd, Python and IIS directory listings' },
  { value: 'json' as const, label: 'JSON', description: 'nginx autoindex_format json, Caddy browse' },
  { value: 's3' as const, label: 'S3 bucket', description: 'A public S3, R2, MinIO, B2 or Wasabi bucket (ListObjectsV2)' },
];

/* the template's own complaint, or none */
function templateError(t: string | undefined): string | undefined {
  if (!t) {return undefined;}
  try { compileTemplate(t); return undefined; } catch (e) { return (e as Error).message; }
}

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData, secureJsonFields, secureJsonData } = options;
  const connection: Connection = jsonData.connection ?? (jsonData.demo === true ? 'demo' : 'none');
  const set = (patch: Partial<VisualTimelineOptions>) => onOptionsChange({ ...options, jsonData: { ...jsonData, ...patch } });
  const text = (key: keyof VisualTimelineOptions) => (e: ChangeEvent<HTMLInputElement>) => set({ [key]: e.target.value });
  const tplError = templateError(jsonData.template);

  return (
    <div data-testid="vt-datasource-config">
      <DataSourceDescription dataSourceName="Visual Timeline" docsLink={DOCS_URL} hasRequiredFields={connection === 'folder'} />

      <Divider />

      <Field label="Connection" description="Demo data: five built-in demo hosts, to try the panels. HTTP folder: timestamped images in a web folder or a public bucket.">
        <RadioButtonGroup<Connection>
          id="vt-connection"
          options={CONNECTIONS}
          value={connection}
          // demo stays in step for dashboards provisioned with it
          onChange={(v) => set({ connection: v === 'none' ? undefined : v, demo: v === 'demo' })}
        />
      </Field>

      {connection === 'none' && (
        <Alert severity="info" title="Your own frames">
          Visual Timeline panels read frames from any data source whose rows have a time, an image and a host.{' '}
          <a href={ANY_SOURCE_URL} target="_blank" rel="noreferrer" className="external-link">
            How it works
          </a>
        </Alert>
      )}

      {connection === 'folder' && (
        <>
          <Divider />
          <ConfigSection title="Folder" description={<>Where the images are and how they are named. <a href={FOLDER_DOCS_URL} target="_blank" rel="noreferrer" className="external-link">Examples</a></>}>
            <Field label="Folder URL" required description="The folder's base URL, as Grafana's server reaches it. Listings go through Grafana; images load in viewers' browsers.">
              <Input id="vt-folder-url" width={60} value={jsonData.folderUrl || ''} placeholder="https://images.example.com/cameras" onChange={text('folderUrl')} />
            </Field>
            <Field label="Image URL" description="Only when browsers reach the folder at another address than Grafana's server does (an internal name for Grafana, a public one for browsers).">
              <Input id="vt-image-url" width={60} value={jsonData.imageUrl || ''} placeholder="Same as the folder URL" onChange={text('imageUrl')} />
            </Field>
            <Field label="Listing" description="How the folder lists its files.">
              <RadioButtonGroup id="vt-listing" options={LISTINGS} value={jsonData.listing || 'html'} onChange={(v) => set({ listing: v })} />
            </Field>
            <Field
              label="Path template"
              required
              invalid={!!tplError}
              error={tplError}
              description="Where frames live below the folder: {host} and a time ({YYYY} {MM} {DD} {DDD} {HH} {mm} {ss}, {epoch} or {epoch_ms}), optionally {site} and {variant}, anywhere in the path."
            >
              <Input id="vt-template" width={60} value={jsonData.template || ''} placeholder="{host}/{YYYY}-{MM}-{DD}/{HH}{mm}{ss}.jpg" onChange={text('template')} />
            </Field>
            <Field label="Time zone" description="The zone the times in names are in: an IANA name such as Australia/Brisbane. Empty: UTC.">
              <Input id="vt-timezone" width={30} value={jsonData.timezone || ''} placeholder="UTC" onChange={text('timezone')} />
            </Field>
            <Field label="Expected every" description="How often each host takes a frame, as a promise: 1m, 30s. A frame missing past it is drawn red, as offline. Empty: no promise; a missing frame is never offline.">
              <Input id="vt-expected" width={30} value={jsonData.expectedEvery || ''} placeholder="1m" onChange={text('expectedEvery')} />
            </Field>
            <Field label="Small images" description="With {variant}: the value for the strips and grids. Empty: every variant.">
              <Input id="vt-small" width={30} value={jsonData.smallVariant || ''} placeholder="lo" onChange={text('smallVariant')} />
            </Field>
            <Field label="Large images" description="With {variant}: the value for the click-in preview. Empty: the small image.">
              <Input id="vt-large" width={30} value={jsonData.largeVariant || ''} placeholder="hi" onChange={text('largeVariant')} />
            </Field>
          </ConfigSection>
          <Divider />
          <ConfigSection title="Authentication" description="Sent by Grafana's server with each listing, never to browsers. Images load in browsers without it, so a protected folder must let viewers' browsers load them some other way.">
            <Field label="Bearer token">
              <SecretInput
                id="vt-bearer"
                width={60}
                isConfigured={Boolean(secureJsonFields?.bearerToken)}
                value={secureJsonData?.bearerToken || ''}
                placeholder="Optional"
                onChange={(e) => onOptionsChange({ ...options, secureJsonData: { ...secureJsonData, bearerToken: e.currentTarget.value } })}
                onReset={() => onOptionsChange({ ...options, secureJsonFields: { ...secureJsonFields, bearerToken: false }, secureJsonData: { ...secureJsonData, bearerToken: '' } })}
              />
            </Field>
          </ConfigSection>
        </>
      )}
    </div>
  );
}
