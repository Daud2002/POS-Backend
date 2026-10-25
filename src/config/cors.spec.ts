import { isAllowedOrigin, isLocalNetworkHost } from './cors';
import { deploymentMode } from './deployment';

describe('isAllowedOrigin', () => {
  it('keeps the cloud on its fixed list', () => {
    expect(isAllowedOrigin('https://pos.tapntrade.store', 'cloud')).toBe(true);
    expect(isAllowedOrigin('http://localhost:8080', 'cloud')).toBe(true);
    expect(isAllowedOrigin('https://192.168.1.20', 'cloud')).toBe(false);
    expect(isAllowedOrigin('https://evil.example', 'cloud')).toBe(false);
  });

  it('lets a store server answer its own pages on any shop address', () => {
    expect(isAllowedOrigin('https://localhost', 'store')).toBe(true);
    expect(isAllowedOrigin('https://127.0.0.1:8443', 'store')).toBe(true);
    expect(isAllowedOrigin('https://192.168.1.20', 'store')).toBe(true);
    expect(isAllowedOrigin('https://10.0.0.5:443', 'store')).toBe(true);
    expect(isAllowedOrigin('https://172.20.3.4', 'store')).toBe(true);
    expect(isAllowedOrigin('https://tapntrade-snackfuel.local', 'store')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:3000', 'store')).toBe(true);
  });

  it('still refuses public websites on a store server', () => {
    expect(isAllowedOrigin('https://pos.tapntrade.store', 'store')).toBe(false);
    expect(isAllowedOrigin('https://evil.example', 'store')).toBe(false);
    expect(isAllowedOrigin('https://8.8.8.8', 'store')).toBe(false);
    expect(isAllowedOrigin('https://172.32.0.1', 'store')).toBe(false);
    expect(isAllowedOrigin('https://192.168.1.20.evil.example', 'store')).toBe(false);
    expect(isAllowedOrigin('file://192.168.1.20', 'store')).toBe(false);
    expect(isAllowedOrigin('not a url', 'store')).toBe(false);
  });
});

describe('isLocalNetworkHost', () => {
  it('rejects malformed addresses', () => {
    expect(isLocalNetworkHost('192.168.1.300')).toBe(false);
    expect(isLocalNetworkHost('192.168.1')).toBe(false);
  });
});

describe('deploymentMode', () => {
  it('defaults to cloud so the existing deploy needs no new variable', () => {
    expect(deploymentMode({})).toBe('cloud');
    expect(deploymentMode({ DEPLOYMENT_MODE: '' })).toBe('cloud');
    expect(deploymentMode({ DEPLOYMENT_MODE: 'store' })).toBe('store');
  });

  it('stops the boot on a typo rather than guessing', () => {
    expect(() => deploymentMode({ DEPLOYMENT_MODE: 'Store' })).toThrow(/DEPLOYMENT_MODE/);
  });
});
