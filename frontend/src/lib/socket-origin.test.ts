import { describe, expect, it } from 'vitest';
import { socketOrigin } from './socket-origin';

describe('socketOrigin', () => {
  it('stays same-origin when the API URL is not configured', () => {
    expect(socketOrigin(undefined)).toBe('');
    expect(socketOrigin('')).toBe('');
  });

  it('stays same-origin for a relative API path', () => {
    expect(socketOrigin('/api')).toBe('');
    expect(socketOrigin('/api/')).toBe('');
  });

  it('follows an API hosted on another origin', () => {
    expect(socketOrigin('https://api.example.com/api')).toBe('https://api.example.com');
    expect(socketOrigin('http://localhost:3000/api')).toBe('http://localhost:3000');
  });
});
