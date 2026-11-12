import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  affiliateTagFacet,
  applyAmazonAffiliateTag,
  linkPreview,
  sectionField,
} from '../src/extensions';

describe('applyAmazonAffiliateTag', () => {
  it('returns the URL unchanged when associateTag is absent or blank', () => {
    const url = 'https://www.amazon.com/dp/B08N5WRWNW';
    expect(applyAmazonAffiliateTag(url)).toBe(url);
    expect(applyAmazonAffiliateTag(url, null)).toBe(url);
    expect(applyAmazonAffiliateTag(url, '')).toBe(url);
    expect(applyAmazonAffiliateTag(url, '   ')).toBe(url);
  });

  it('adds ?tag= to Amazon retail URLs across regional domains', () => {
    expect(applyAmazonAffiliateTag('https://www.amazon.com/dp/B08N5WRWNW', 'wodwiki-20'))
      .toBe('https://www.amazon.com/dp/B08N5WRWNW?tag=wodwiki-20');
    expect(applyAmazonAffiliateTag('https://amazon.com/dp/B08N5WRWNW', 'wodwiki-20'))
      .toBe('https://amazon.com/dp/B08N5WRWNW?tag=wodwiki-20');
    expect(applyAmazonAffiliateTag('https://smile.amazon.co.uk/dp/B08N5WRWNW', 'wodwiki-21'))
      .toBe('https://smile.amazon.co.uk/dp/B08N5WRWNW?tag=wodwiki-21');
    expect(applyAmazonAffiliateTag('https://www.amazon.de/dp/B08N5WRWNW', 'wodwiki-21'))
      .toBe('https://www.amazon.de/dp/B08N5WRWNW?tag=wodwiki-21');
  });

  it('preserves existing query params and hash, and replaces any existing tag', () => {
    expect(
      applyAmazonAffiliateTag(
        'https://www.amazon.com/dp/B08N5WRWNW?psc=1&tag=other-20#reviews',
        'wodwiki-20',
      ),
    ).toBe('https://www.amazon.com/dp/B08N5WRWNW?psc=1&tag=wodwiki-20#reviews');
  });

  it('leaves shortlinks, non-retail subdomains, non-Amazon URLs, and internal paths untouched', () => {
    expect(applyAmazonAffiliateTag('https://amzn.to/3abc123', 'wodwiki-20'))
      .toBe('https://amzn.to/3abc123');
    expect(applyAmazonAffiliateTag('https://a.co/d/abc123', 'wodwiki-20'))
      .toBe('https://a.co/d/abc123');
    expect(applyAmazonAffiliateTag('https://aws.amazon.com/ec2/', 'wodwiki-20'))
      .toBe('https://aws.amazon.com/ec2/');
    expect(applyAmazonAffiliateTag('https://evil-amazon.com/dp/B08N5WRWNW', 'wodwiki-20'))
      .toBe('https://evil-amazon.com/dp/B08N5WRWNW');
    expect(applyAmazonAffiliateTag('/notes/gear', 'wodwiki-20'))
      .toBe('/notes/gear');
  });
});

describe('linkPreview with affiliateTagFacet', () => {
  function mount(doc: string, tag?: string | null) {
    const extensions = [sectionField, linkPreview];
    if (tag !== undefined) {
      extensions.push(affiliateTagFacet.of(tag));
    }
    const state = EditorState.create({ doc, extensions });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = new EditorView({ state, parent: container });
    view.dispatch({ selection: { anchor: doc.length } });
    return { view, container };
  }

  it('injects and replaces the tag on rendered Amazon link pills without mutating markdown', () => {
    const doc =
      'Buy [Kettlebell](https://www.amazon.com/dp/B08N5WRWNW?tag=old-20) or https://amzn.to/3abc123.\nDone.\n';
    const { view, container } = mount(doc, 'wodwiki-20');

    const opens = container.querySelectorAll('a.cm-link-pill-open');
    expect(opens.length).toBe(2);
    expect((opens[0] as HTMLAnchorElement).href).toBe(
      'https://www.amazon.com/dp/B08N5WRWNW?tag=wodwiki-20',
    );
    expect((opens[1] as HTMLAnchorElement).href).toBe('https://amzn.to/3abc123');
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
    container.remove();
  });

  it('does not modify Amazon link pills when affiliateTagFacet is unset', () => {
    const doc = 'Buy [Kettlebell](https://www.amazon.com/dp/B08N5WRWNW?tag=old-20).\nDone.\n';
    const { view, container } = mount(doc);

    const open = container.querySelector('a.cm-link-pill-open') as HTMLAnchorElement;
    expect(open.href).toBe('https://www.amazon.com/dp/B08N5WRWNW?tag=old-20');

    view.destroy();
    container.remove();
  });
});
