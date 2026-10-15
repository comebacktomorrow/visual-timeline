import React, { ChangeEvent, useState } from 'react';
import { CustomVariableSupport, DataQueryRequest, DataQueryResponse, QueryEditorProps } from '@grafana/data';
import { InlineField, InlineFieldRow, Input, RadioButtonGroup } from '@grafana/ui';
import { from, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import type { VisualTimelineDataSource } from './datasource';
import type { VisualTimelineOptions, VisualTimelineQuery, VisualTimelineVariableQuery } from './types';

type EditorProps = QueryEditorProps<
  VisualTimelineDataSource,
  VisualTimelineQuery,
  VisualTimelineOptions,
  VisualTimelineVariableQuery
>;

const TYPES = [
  { label: 'Sites', value: 'sites' as const, description: 'Every site the API lists' },
  { label: 'Hosts', value: 'hosts' as const, description: 'Source ids, optionally only those in some sites' },
];

/** The variable editor: Sites or Hosts, and for Hosts an optional site list
 * (usually ${site:csv}, so a Host variable follows the Site variable). */
export function VariableQueryEditor({ query, onChange }: EditorProps) {
  const type = query?.type === 'hosts' ? 'hosts' : 'sites';
  const [sites, setSites] = useState(query?.sites ?? '');
  const save = (next: Partial<VisualTimelineVariableQuery>) =>
    onChange({ refId: query?.refId ?? 'A', type, sites, ...next });

  return (
    <div data-testid="vt-variable-editor">
      <InlineFieldRow>
        <InlineField label="Values" labelWidth={14}>
          <RadioButtonGroup options={TYPES} value={type} onChange={(v) => save({ type: v === 'hosts' ? 'hosts' : 'sites' })} />
        </InlineField>
      </InlineFieldRow>
      {type === 'hosts' && (
        <InlineFieldRow>
          <InlineField
            label="Only in sites"
            labelWidth={14}
            tooltip="Site ids, comma-separated, or a variable such as ${site:csv}. Empty: hosts in every site."
          >
            <Input
              id="vt-variable-sites"
              width={40}
              value={sites}
              placeholder="${site:csv}"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSites(e.target.value)}
              onBlur={() => save({ sites })}
            />
          </InlineField>
        </InlineFieldRow>
      )}
    </div>
  );
}

/** Grafana's hook for query variables backed by this data source. */
export class VisualTimelineVariableSupport extends CustomVariableSupport<
  VisualTimelineDataSource,
  VisualTimelineVariableQuery,
  VisualTimelineQuery,
  VisualTimelineOptions
> {
  editor = VariableQueryEditor;

  constructor(private readonly datasource: VisualTimelineDataSource) {
    super();
  }

  query(request: DataQueryRequest<VisualTimelineVariableQuery>): Observable<DataQueryResponse> {
    const [target] = request.targets;
    return from(this.datasource.metricFindQuery(target, { scopedVars: request.scopedVars })).pipe(
      map((values) => ({ data: values }))
    );
  }
}
