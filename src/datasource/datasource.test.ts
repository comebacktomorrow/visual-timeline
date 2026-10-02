import type { DataSourceInstanceSettings } from '@grafana/data';

import { describeFailure, VisualTimelineDataSource } from './datasource';
import type { VisualTimelineOptions } from './types';

// keep Grafana's runtime out of the unit test: requests are injected
jest.mock('../shared/backendRequest', () => ({ backendRequest: jest.fn() }));

const settings = (apiUrl?: string) =>
  ({
    id: 1,
    uid: 'vt-ds',
    type: 'savvycocoa1919-visualtimeline-datasource',
    name: 'Visual Timeline API',
    access: 'proxy',
    readOnly: false,
    jsonData: { apiUrl },
    meta: { id: 'savvycocoa1919-visualtimeline-datasource' },
  }) as unknown as DataSourceInstanceSettings<VisualTimelineOptions>;

const ok = (data: unknown) => jest.fn(async () => ({ status: 200, data }));
const fail = (status: number, data: unknown = {}) =>
  jest.fn(async () => {
    throw { status, data };
  });

describe('testDatasource', () => {
  test('success: /sources answers with a list through the proxy', async () => {
    const request = ok([{ id: 'a' }, { id: 'b' }]);
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com/'), request);
    await expect(ds.testDatasource()).resolves.toEqual({
      status: 'success',
      message: 'Connected: the API lists 2 sources.',
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/datasources/proxy/uid/vt-ds/api/sources', method: 'GET' })
    );
  });

  test('success with one source reads naturally', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), ok([{ id: 'a' }]));
    await expect(ds.testDatasource()).resolves.toMatchObject({ message: 'Connected: the API lists 1 source.' });
  });

  test('a token the API rejects is reported as such (Grafana turns the 401 into a 400)', async () => {
    const ds = new VisualTimelineDataSource(
      settings('https://frames.example.com'),
      fail(400, 'Authentication to data source failed')
    );
    const r = await ds.testDatasource();
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/rejected the viewer token/);
  });

  test('any other 400 still points at the token', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), fail(400, { message: 'bad' }));
    const r = await ds.testDatasource();
    expect(r.message).toMatch(/\(400\).*viewer token/);
  });

  test('a 401 passed through as is is reported as a rejected token', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), fail(401));
    const r = await ds.testDatasource();
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/rejected the viewer token \(401\)/);
  });

  test('an unreachable API is reported as such', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), fail(502));
    const r = await ds.testDatasource();
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/could not reach https:\/\/frames\.example\.com \(502\)/);
  });

  test('a body that is not a list is not a frames API', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), ok({ status: 'ok' }));
    await expect(ds.testDatasource()).resolves.toMatchObject({ status: 'error' });
  });

  test('a missing API URL fails before any request', async () => {
    const request = ok([]);
    const ds = new VisualTimelineDataSource(settings(undefined), request);
    await expect(ds.testDatasource()).resolves.toMatchObject({
      status: 'error',
      message: expect.stringMatching(/API URL/),
    });
    expect(request).not.toHaveBeenCalled();
  });

  test('a URL without a scheme fails before any request', async () => {
    const request = ok([]);
    const ds = new VisualTimelineDataSource(settings('frames.example.com'), request);
    await expect(ds.testDatasource()).resolves.toMatchObject({
      status: 'error',
      message: expect.stringMatching(/http/),
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('query', () => {
  test('returns no data: the panel reads the API itself', async () => {
    const ds = new VisualTimelineDataSource(settings('https://frames.example.com'), ok([]));
    await expect(ds.query({ targets: [] } as any)).resolves.toEqual({ data: [] });
  });
});

describe('describeFailure', () => {
  test.each([403, 404, 0, 500])('%s has a message', (status) => {
    expect(describeFailure(status, 'https://x')).toMatch(/\S/);
  });
});
