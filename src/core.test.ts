import { imageUrlWithKey } from './core';

const API = 'https://frames.example.com';
const FRAME = `${API}/frame/lo/site-a/source-1/1783488360000.jpg`;

describe('imageUrlWithKey', () => {
  test('a bare image URL on the API origin carries the viewer key', () => {
    expect(imageUrlWithKey(FRAME, API, 'viewer-tok')).toBe(`${FRAME}?k=viewer-tok`);
  });

  test('a signed image URL is left alone, so the key stays out of it', () => {
    const signed = `${FRAME}?e=1783574760000&sig=abc123`;
    expect(imageUrlWithKey(signed, API, 'viewer-tok')).toBe(signed);
  });

  test('an image on another origin is never handed the key', () => {
    const publicBucket = 'https://img.example.net/lo/site-a/source-1/1783488360000.jpg';
    expect(imageUrlWithKey(publicBucket, API, 'viewer-tok')).toBe(publicBucket);
  });

  test('a presigned URL on another origin keeps its query intact', () => {
    const presigned = 'https://bucket.example.org/f.jpg?X-Amz-Signature=deadbeef';
    expect(imageUrlWithKey(presigned, API, 'viewer-tok')).toBe(presigned);
  });

  test('without a key nothing changes', () => {
    expect(imageUrlWithKey(FRAME, API, '')).toBe(FRAME);
  });

  test('an API base with a path prefix matches on origin', () => {
    expect(imageUrlWithKey(FRAME, `${API}/visual-timeline`, 'viewer-tok')).toBe(`${FRAME}?k=viewer-tok`);
  });

  test('the key is URL-encoded', () => {
    expect(imageUrlWithKey(FRAME, API, 'a b/c+d')).toBe(`${FRAME}?k=a+b%2Fc%2Bd`);
  });
});
