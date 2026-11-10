import { createDataFrame, createTheme, FieldType } from '@grafana/data';
import { readFileSync } from 'fs';
import { join } from 'path';

import { reasonDisplay, REASON_STYLES } from '../vt/backends/reasons';
import { stateDisplay } from './hostState';
import { pauseStateMappings } from './sources';

/* Our pause reasons are defined once (REASON_STYLES). These keep the three
 * places that show them from drifting apart: our data source's value
 * mappings in Grafana, the standalone viewer, and the self-hosted dashboard. */

const theme = createTheme();   // dark, the standalone viewer's colours

test('every reason looks the same in Grafana (value mappings) and in the standalone viewer', () => {
  const field = createDataFrame({ fields: [{ name: 'state', type: FieldType.string, values: [], config: { mappings: pauseStateMappings() } }] }).fields[0];
  const show = stateDisplay(field, theme);
  for (const reason of [...Object.keys(REASON_STYLES), 'maintenance', undefined]) {
    for (const intended of [true, false]) {
      // the state value our data source and the worker's /states send
      const value = (reason || 'paused') + (intended ? '' : ':unexpected');
      const grafana = show(value);
      const standalone = reasonDisplay(reason, intended);
      expect([value, grafana.label, grafana.color?.toUpperCase()]).toEqual([value, standalone.label, standalone.color?.toUpperCase()]);
    }
  }
});

test('the self-hosted dashboard carries exactly our default mappings', () => {
  const dash = JSON.parse(readFileSync(join(__dirname, '../../selfhost/grafana/dashboards/visual-timeline.json'), 'utf8'));
  const expected = JSON.parse(JSON.stringify(pauseStateMappings()));
  for (const panel of dash.panels) {
    const override = panel.fieldConfig.overrides.find((o: any) => o.matcher.options === 'state');
    expect(override.properties.find((p: any) => p.id === 'mappings').value).toEqual(expected);
  }
});
