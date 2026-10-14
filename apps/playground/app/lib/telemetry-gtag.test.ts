import { describe, it, expect } from 'bun:test';
import { telemetry } from '@/services/telemetry';
import { trackPageView } from './telemetry-gtag';

describe('telemetry-gtag', () => {
  it('pushes Arguments objects to dataLayer so gtag.js does not drop events', () => {
    expect(window.dataLayer).toBeDefined();
    expect(window.dataLayer!.length).toBeGreaterThanOrEqual(2);

    for (const item of window.dataLayer!) {
      expect(Object.prototype.toString.call(item)).toBe('[object Arguments]');
    }

    const first = window.dataLayer![0] as IArguments;
    expect(first[0]).toBe('js');

    const second = window.dataLayer![1] as IArguments;
    expect(second[0]).toBe('config');
    expect(second[2]).toEqual({ send_page_view: false });
  });

  it('forwards telemetry events into dataLayer as Arguments objects', () => {
    const initialLen = window.dataLayer!.length;
    telemetry.record('test:event', { foo: 'bar' });

    expect(window.dataLayer!.length).toBe(initialLen + 1);
    const last = window.dataLayer![window.dataLayer!.length - 1] as IArguments;
    expect(Object.prototype.toString.call(last)).toBe('[object Arguments]');
    expect(last[0]).toBe('event');
    expect(last[1]).toBe('test:event');
    expect(last[2]).toEqual({ foo: 'bar' });
  });

  it('emits page_view events via trackPageView', () => {
    const initialLen = window.dataLayer!.length;
    trackPageView('Wod.Wiki - Test Page', '/test-page');
    expect(window.dataLayer!.length).toBe(initialLen + 1);
    const last = window.dataLayer![window.dataLayer!.length - 1] as IArguments;
    expect(Object.prototype.toString.call(last)).toBe('[object Arguments]');
    expect(last[0]).toBe('event');
    expect(last[1]).toBe('page_view');
    expect(last[2]).toMatchObject({
      page_title: 'Wod.Wiki - Test Page',
      page_path: '/test-page',
    });
  });
});
