#!/usr/bin/env python3
"""Embed the offline review layer and source-visible anchors in an HTML file."""
import argparse
import html
import re
from html.parser import HTMLParser
from pathlib import Path
from tempfile import NamedTemporaryFile
from uuid import uuid4

SKILL = Path(__file__).resolve().parent
# ponytail: Explicit end tags only; use an HTML5 parser for arbitrary imported markup.
BLOCKS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'pre', 'td', 'th', 'blockquote', 'figure'}
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}


class Document(HTMLParser):
    def __init__(self, source: str):
        super().__init__(convert_charrefs=True)
        self.offsets = [0]
        self.offsets.extend(match.end() for match in re.finditer('\n', source))
        self.stack = []
        self.root_depth = None
        self.roots = 0
        self.ids = set()
        self.blocks = []
        self.metadata = []
        self.body_start = self.body_end = self.head_end = None
        self.feed(source)

    def position(self) -> int:
        line, column = self.getpos()
        return self.offsets[line - 1] + column

    def handle_starttag(self, tag: str, attrs: list) -> None:
        attributes = dict(attrs)
        start = self.position()
        raw = self.get_starttag_text()
        if attributes.get('id'):
            if attributes['id'] in self.ids:
                raise ValueError(f"Duplicate HTML id: {attributes['id']}")
            self.ids.add(attributes['id'])
        if tag == 'body':
            self.body_start = start + len(raw)
        if tag == 'meta' and attributes.get('name') in {'whiteboard-source', 'whiteboard-skill'}:
            self.metadata.append((start, start + len(raw), ''))
        if 'data-whiteboard-document' in attributes:
            self.roots += 1
            self.root_depth = len(self.stack)
        if self.root_depth is not None and tag in BLOCKS and not any(parent in {'pre', 'script', 'style', 'textarea'} for parent in self.stack):
            self.blocks.append((start + len(raw) - (2 if raw.endswith('/>') else 1), tag, attributes))
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag == 'head':
            self.head_end = self.position()
        if tag == 'body':
            self.body_end = self.position()
        if tag in self.stack:
            index = len(self.stack) - 1 - self.stack[::-1].index(tag)
            del self.stack[index:]
            if self.root_depth is not None and len(self.stack) <= self.root_depth:
                self.root_depth = None


def annotate(path: Path, dynamic: bool = False) -> int:
    source = path.read_text(encoding='utf-8')
    for part in ('style', 'bar', 'tail'):
        start, end = f'<!-- whiteboard-html:{part} -->', f'<!-- whiteboard-html:end-{part} -->'
        if source.count(start) != source.count(end) or source.count(start) > 1:
            raise ValueError(f'Invalid annotation {part} markers; file left untouched')
        source = re.sub(re.escape(start) + r'.*?' + re.escape(end), '', source, flags=re.S)
    if dynamic and 'data-whiteboard-document' not in source:
        if re.search(r'<div\b[^>]*\bid=["\']root["\']', source):
            source = re.sub(r'(<div\b[^>]*\bid=["\']root["\'][^>]*)>', r'\1 data-whiteboard-document data-whiteboard-dynamic>', source, count=1)
        elif re.search(r'<body\b', source):
            source = re.sub(r'(<body\b[^>]*)>', r'\1 data-whiteboard-document data-whiteboard-dynamic>', source, count=1)
    elif dynamic and 'data-whiteboard-dynamic' not in source:
        source = source.replace('data-whiteboard-document', 'data-whiteboard-document data-whiteboard-dynamic', 1)
    document = Document(source)
    if document.roots != 1 or any(value is None for value in (document.head_end, document.body_start, document.body_end)):
        raise ValueError('Expected head, body, and exactly one data-whiteboard-document container')
    edits = document.metadata
    for offset, tag, attrs in document.blocks:
        addition = ''
        if not attrs.get('id'):
            anchor = f'wb-{tag}-{uuid4().hex}'
            while anchor in document.ids:
                anchor = f'wb-{tag}-{uuid4().hex}'
            document.ids.add(anchor)
            addition = f' id="{anchor}"'
        if 'data-whiteboard-anchor' not in attrs:
            addition += ' data-whiteboard-anchor'
        if addition:
            edits.append((offset, offset, addition))
    fragment = (SKILL / 'annotations.html').read_text(encoding='utf-8')
    style = fragment[fragment.index('<style'):fragment.index('</style>') + len('</style>')]
    bar = fragment[fragment.index('<header'):fragment.index('</header>') + len('</header>')]
    tail = fragment[fragment.index('</header>') + len('</header>'):fragment.index('<!-- whiteboard-html:end -->')].strip()
    metadata = f'<meta name="whiteboard-source" content="{html.escape(str(path), quote=True)}">\n<meta name="whiteboard-skill" content="{html.escape(str(SKILL / "SKILL.md"), quote=True)}">\n'
    for offset, part, content in ((document.head_end, 'style', metadata + style), (document.body_start, 'bar', bar), (document.body_end, 'tail', tail)):
        edits.append((offset, offset, f'<!-- whiteboard-html:{part} -->\n{content}\n<!-- whiteboard-html:end-{part} -->'))
    for start, end, content in sorted(edits, reverse=True):
        source = source[:start] + content + source[end:]
    with NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            output.write(source)
            output.close()
            temporary.chmod(path.stat().st_mode)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return len(document.blocks)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('document', type=Path)
    parser.add_argument('--dynamic', action='store_true', help='Enable MutationObserver anchor discovery for SPA / dynamic HTML reports')
    args = parser.parse_args()
    try:
        path = args.document.expanduser().resolve(strict=True)
        print(f'{path}: {annotate(path, dynamic=args.dynamic)} source-anchored blocks; offline annotations embedded')
    except (OSError, ValueError) as error:
        parser.exit(1, f'{error}\n')
