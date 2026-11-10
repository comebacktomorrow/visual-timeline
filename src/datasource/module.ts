import { DataSourcePlugin } from '@grafana/data';

import { ConfigEditor } from './ConfigEditor';
import { VisualTimelineDataSource } from './datasource';
import { QueryEditor } from './QueryEditor';
import type { VisualTimelineOptions, VisualTimelineQuery } from './types';

export const plugin = new DataSourcePlugin<VisualTimelineDataSource, VisualTimelineQuery, VisualTimelineOptions>(
  VisualTimelineDataSource
)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
