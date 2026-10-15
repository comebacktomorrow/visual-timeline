import React, { ChangeEvent, useState } from 'react';
import { QueryEditorProps } from '@grafana/data';
import { InlineField, InlineFieldRow, Input } from '@grafana/ui';

import type { VisualTimelineDataSource } from './datasource';
import type { VisualTimelineOptions, VisualTimelineQuery } from './types';

type Props = QueryEditorProps<VisualTimelineDataSource, VisualTimelineQuery, VisualTimelineOptions>;
type Field = 'sites' | 'hosts' | 'tags';

const FIELDS: Array<{ key: Field; label: string; placeholder: string; tooltip: string }> = [
  {
    key: 'sites',
    label: 'Sites',
    placeholder: 'empty = all, or ${site:csv}',
    tooltip: 'Site ids, comma-separated, or a dashboard variable such as ${site:csv}. Empty: every site.',
  },
  {
    key: 'hosts',
    label: 'Hosts',
    placeholder: 'empty = all, or ${host:csv}',
    tooltip: 'Host ids, comma-separated, or a dashboard variable such as ${host:csv}. Empty: every host.',
  },
  {
    key: 'tags',
    label: 'Tags',
    placeholder: 'env=prod, room=lobby',
    tooltip: 'Tag pairs that must all match. Variables work here too. Empty: no tag filter.',
  },
];

/** Which sources this panel shows. Dashboard-wide filters (the Site and Host
 * variables, the ad hoc filter bar) apply on top of this. */
export function QueryEditor({ query, onChange, onRunQuery }: Props) {
  const [draft, setDraft] = useState<Record<Field, string>>({
    sites: query.sites ?? '',
    hosts: query.hosts ?? '',
    tags: query.tags ?? '',
  });
  const commit = (key: Field) => {
    if ((query[key] ?? '') === draft[key]) {return;}
    onChange({ ...query, [key]: draft[key] });
    onRunQuery();
  };

  return (
    <div data-testid="vt-query-editor">
      <InlineFieldRow>
        {FIELDS.map((f) => (
          <InlineField key={f.key} label={f.label} labelWidth={8} tooltip={f.tooltip}>
            <Input
              id={`vt-query-${f.key}`}
              width={f.key === 'tags' ? 30 : 22}
              value={draft[f.key]}
              placeholder={f.placeholder}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [f.key]: e.target.value })}
              onBlur={() => commit(f.key)}
            />
          </InlineField>
        ))}
      </InlineFieldRow>
    </div>
  );
}
