import { panelOptions } from './options';

/* The options' paths, order, kinds and defaults are what saved dashboards
 * hold and what the editor shows: they must not move. A builder that
 * records each add*() call stands in for Grafana's, whose editors registry
 * isn't loaded under jest. */
function recorded() {
  const items: Array<[string, string, unknown]> = [];
  const builder: Record<string, unknown> = new Proxy({}, {
    get: (_t, method: string) => (item: { path: string; defaultValue?: unknown }) => {
      items.push([method, item.path, item.defaultValue]);
      return builder;
    },
  });
  panelOptions(builder as never, {} as never);
  return items;
}

describe('panel options', () => {
  test('paths, in order, with their kinds and defaults', () => {
    expect(recorded()).toEqual([
      ['addRadio', 'mode', 'timeline'], ['addBooleanSwitch', 'followCrosshair', true],
      ['addBooleanSwitch', 'showAnnotations', true], ['addRadio', 'annotationLanes', 'shared'],
      ['addTextInput', 'chips', ''], ['addRadio', 'chipClick', 'filter'], ['addTextInput', 'chipLink', ''],
      ['addTextInput', 'expectedCadence', ''], ['addRadio', 'holdFrames', 'auto'], ['addTextInput', 'holdFor', '10m'],
      ['addRadio', 'playerScrubber', 'ticks'], ['addBooleanSwitch', 'videoAutoSpeed', false],
      ['addBooleanSwitch', 'hideEmpty', false], ['addSliderInput', 'frameWidth', expect.any(Number)],
      ['addBooleanSwitch', 'showVideoLine', false], ['addBooleanSwitch', 'showDetails', false],
      ['addRadio', 'headerMode', 'bar'], ['addRadio', 'thumbTimes', 'panel'],
      ['addFieldNamePicker', 'imageField', undefined], ['addFieldNamePicker', 'timeField', undefined],
      ['addFieldNamePicker', 'hostField', undefined], ['addFieldNamePicker', 'stateField', undefined],
      ['addFieldNamePicker', 'siteField', undefined], ['addFieldNamePicker', 'previewField', undefined],
      ['addFieldNamePicker', 'videoField', undefined], ['addFieldNamePicker', 'cadenceField', undefined],
      ['addRadio', 'imageFit', 'fit'],
    ]);
  });
});
