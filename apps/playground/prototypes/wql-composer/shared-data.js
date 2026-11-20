/* WOD Wiki — Shared WQL Data Model, Categorized Vocabulary, Token Serializer & Corpus */
(function (global) {
  'use strict';

  function svg(paths, size) {
    var s = size || 14;
    return (
      '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      paths +
      '</svg>'
    );
  }

  var icons = {
    search: function (s) { return svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', s); },
    filter: function (s) { return svg('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>', s); },
    plus: function (s) { return svg('<path d="M5 12h14"/><path d="M12 5v14"/>', s); },
    x: function (s) { return svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', s); },
    chevronLeft: function (s) { return svg('<path d="m15 18-6-6 6-6"/>', s); },
    chevronRight: function (s) { return svg('<path d="m9 18 6-6-6-6"/>', s); },
    chevronDown: function (s) { return svg('<path d="m6 9 6 6 6-6"/>', s); },
    chevronUp: function (s) { return svg('<path d="m18 15-6-6-6 6"/>', s); },
    code: function (s) { return svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>', s); },
    check: function (s) { return svg('<polyline points="20 6 9 17 4 12"/>', s); },
    alert: function (s) { return svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', s); },
    command: function (s) { return svg('<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>', s); },
    calendar: function (s) { return svg('<rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>', s); },
    layers: function (s) { return svg('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>', s); },
    sliders: function (s) { return svg('<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/>', s); },
    arrowUpRight: function (s) { return svg('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', s); }
  };

  var CLAUSE_META = {
    target: {
      label: 'Find',
      zone: 'WHAT',
      description: 'Which record entity this query searches or returns.',
      removable: false,
      excludable: false,
      multi: false
    },
    agg: {
      label: 'Aggregate',
      zone: 'WHAT',
      description: 'How matching workout facts are rolled up per group.',
      removable: false,
      excludable: false,
      multi: false
    },
    metric: {
      label: 'Metric',
      zone: 'WHAT',
      description: 'The numeric measurement aggregated across matching workouts.',
      removable: false,
      excludable: false,
      multi: false
    },
    notebook: {
      label: 'Notebook',
      zone: 'WHERE',
      description: 'Restrict results to a training notebook or include all notebooks.',
      removable: true,
      excludable: true,
      multi: false
    },
    effort: {
      label: 'Movement',
      zone: 'WHERE',
      description: 'Filter to workouts or metrics containing a specific exercise.',
      removable: true,
      excludable: true,
      multi: false
    },
    tags: {
      label: 'Tag',
      zone: 'WHERE',
      description: 'Match notes or workouts tagged with a category label.',
      removable: true,
      excludable: true,
      multi: false
    },
    equipment: {
      label: 'Equipment',
      zone: 'WHERE',
      description: 'Filter by gear used (supported on :note / :block queries).',
      removable: true,
      excludable: true,
      multi: false
    },
    quality: {
      label: 'Quality',
      zone: 'WHERE',
      description: 'Filter by training focus (supported on :note queries).',
      removable: true,
      excludable: true,
      multi: false
    },
    text: {
      label: 'Text',
      zone: 'WHERE',
      description: 'Free-text phrase search inside workout notes or titles.',
      removable: true,
      excludable: false,
      multi: false,
      freeText: true
    },
    time: {
      label: 'Window',
      zone: 'WHEN',
      description: 'Relative or custom civil date range.',
      removable: true,
      excludable: false,
      multi: false,
      hasCustomDates: true
    },
    groupBy: {
      label: 'Group by',
      zone: 'GROUP',
      description: 'Bucket matching records by time period or training dimension.',
      removable: true,
      excludable: false,
      multi: false
    }
  };

  var CLAUSE_VOCAB = {
    target: [
      {
        group: 'Content',
        items: [
          { value: 'note', label: 'Notes', desc: 'Full workout logs and journal entries', code: ':note' },
          { value: 'block', label: 'Workout blocks', desc: 'Fenced wod / time blocks inside notes', code: ':block' },
          { value: 'page', label: 'Guide pages', desc: 'Reference docs and seeded guides', code: ':page' }
        ]
      },
      {
        group: 'Training',
        items: [
          { value: 'effort', label: 'Efforts', desc: 'Individual logged movements and sets', code: ':effort' },
          { value: 'session', label: 'Sessions', desc: 'Completed timer runs and splits', code: ':session' }
        ]
      },
      {
        group: 'Catalog',
        items: [
          { value: 'notebook', label: 'Notebooks', desc: 'Top-level collections', code: ':notebook' },
          { value: 'tag', label: 'Tags', desc: 'Topic and benchmark labels', code: ':tag' },
          { value: 'equipment', label: 'Equipment', desc: 'Apparatus and implements', code: ':equipment' }
        ]
      }
    ],
    agg: [
      {
        group: 'Aggregation',
        items: [
          { value: 'sum', label: 'Sum (total)', desc: 'Add all values in each bucket', code: 'sum:' },
          { value: 'avg', label: 'Average', desc: 'Mean value per bucket', code: 'avg:' },
          { value: 'max', label: 'Max (peak)', desc: 'Highest single value / PR', code: 'max:' },
          { value: 'count', label: 'Count', desc: 'Number of matching records', code: 'count:' }
        ]
      }
    ],
    metric: [
      {
        group: 'Volume',
        items: [
          { value: 'totalVolume', label: 'Total volume', desc: 'Load multiplied by completed reps', code: 'totalVolume' },
          { value: 'reps', label: 'Total reps', desc: 'Sum of completed repetitions', code: 'reps' }
        ]
      },
      {
        group: 'Time & Pace',
        items: [
          { value: 'tis', label: 'Time in session', desc: 'Active working time inside blocks', code: 'tis' },
          { value: 'duration', label: 'Elapsed duration', desc: 'Total clock time including rest', code: 'duration' }
        ]
      },
      {
        group: 'Calculated',
        items: [
          { value: 'calc.e1rm', label: 'Estimated 1RM', desc: 'Epley 1-rep max estimate from top set', code: 'calc.e1rm' },
          { value: 'sessionLoad', label: 'Session load', desc: 'RPE × working minutes training load', code: 'sessionLoad' }
        ]
      }
    ],
    notebook: [
      {
        group: 'Collections',
        items: [
          { value: 'journal', label: 'Journal', desc: 'Daily training log entries', code: 'notebook:journal' },
          { value: 'benchmarks', label: 'Benchmarks', desc: 'Named Girl & Hero WODs', code: 'notebook:benchmarks' },
          { value: 'strength', label: 'Strength', desc: 'Linear & percentage progressions', code: 'notebook:strength' },
          { value: '*', label: 'All notebooks', desc: 'Include every notebook without scoping', code: 'notebook:*' }
        ]
      }
    ],
    effort: [
      {
        group: 'Barbell & Gymnastics',
        items: [
          { value: 'deadlift', label: 'Deadlift', desc: 'Conventional or trap-bar hinge', code: 'effort:deadlift' },
          { value: 'thruster', label: 'Thruster', desc: 'Front squat into overhead press', code: 'effort:thruster' },
          { value: 'pull-up', label: 'Pull-up', desc: 'Strict, kipping, or chest-to-bar', code: 'effort:pull-up' },
          { value: 'back-squat', label: 'Back Squat', desc: 'Barbell back squat', code: 'effort:back-squat' }
        ]
      },
      {
        group: 'Erg & Kettlebell',
        items: [
          { value: 'kettlebell-swing', label: 'Kettlebell Swing', desc: 'Russian or American KB swing', code: 'effort:kettlebell-swing' },
          { value: 'row', label: 'Row Erg', desc: 'Concept2 meters or calories', code: 'effort:row' }
        ]
      }
    ],
    tags: [
      {
        group: 'Tags',
        items: [
          { value: 'benchmark', label: 'Benchmark', desc: 'Repeatable test workouts', code: 'tags:benchmark' },
          { value: 'conditioning', label: 'Conditioning', desc: 'Metcons, EMOMs, and intervals', code: 'tags:conditioning' },
          { value: 'strength', label: 'Strength', desc: 'Heavy multi-set work', code: 'tags:strength' },
          { value: 'pr', label: 'PR', desc: 'Personal record sessions', code: 'tags:pr' }
        ]
      }
    ],
    equipment: [
      {
        group: 'Apparatus',
        items: [
          { value: 'kettlebell', label: 'Kettlebell', desc: 'Single or double KB sessions', code: 'equipment:kettlebell' },
          { value: 'barbell', label: 'Barbell', desc: 'Olympic bar & plates', code: 'equipment:barbell' },
          { value: 'pull-up-bar', label: 'Pull-up bar', desc: 'Rig or doorway bar', code: 'equipment:pull-up-bar' },
          { value: 'rower', label: 'Rower', desc: 'Concept2 rower', code: 'equipment:rower' }
        ]
      }
    ],
    quality: [
      {
        group: 'Training Quality',
        items: [
          { value: 'strength', label: 'Strength', desc: 'Force and heavy load', code: 'quality:strength' },
          { value: 'metcon', label: 'Metcon', desc: 'Metabolic conditioning', code: 'quality:metcon' },
          { value: 'recovery', label: 'Recovery', desc: 'Zone 2 & mobility', code: 'quality:recovery' }
        ]
      }
    ],
    time: [
      {
        group: 'Recent',
        items: [
          { value: 'last 1w', label: 'Past week', desc: 'Last 7 days', code: 'last 1w' },
          { value: 'last 4w', label: 'Past month', desc: 'Last 4 weeks', code: 'last 4w' },
          { value: 'last 12w', label: 'Past quarter', desc: 'Last 12 weeks', code: 'last 12w' }
        ]
      },
      {
        group: 'Longer',
        items: [
          { value: 'last 1y', label: 'Past year', desc: 'Last 12 months', code: 'last 1y' },
          { value: 'all', label: 'Any time', desc: 'No date boundary', code: 'all' }
        ]
      }
    ],
    groupBy: [
      {
        group: 'Time buckets',
        items: [
          { value: 'date', label: 'Day', desc: 'One group per calendar date', code: 'by {date}' },
          { value: 'week', label: 'Week', desc: 'ISO weekly rollup', code: 'by {week}' },
          { value: 'month', label: 'Month', desc: 'Calendar month buckets', code: 'by {month}' }
        ]
      },
      {
        group: 'Dimensions',
        items: [
          { value: 'effort', label: 'Movement', desc: 'Break out by logged exercise', code: 'by {effort}' },
          { value: 'notebook', label: 'Notebook', desc: 'Group by source collection', code: 'by {notebook}' },
          { value: 'tags', label: 'Tag', desc: 'Group by assigned workout tag', code: 'by {tags}' }
        ]
      }
    ]
  };

  var ADDABLE_FILTERS = [
    {
      group: 'Scope',
      items: [
        { type: 'notebook', label: 'Notebook', desc: 'Filter to a collection (journal, benchmarks…)', defaultVal: 'journal', code: 'notebook:…' },
        { type: 'tags', label: 'Tag', desc: 'Filter by workout label (benchmark, pr…)', defaultVal: 'benchmark', code: 'tags:…' }
      ]
    },
    {
      group: 'Training',
      items: [
        { type: 'effort', label: 'Movement', desc: 'Match a specific exercise (deadlift, thruster…)', defaultVal: 'deadlift', code: 'effort:…' },
        { type: 'text', label: 'Text phrase', desc: 'Match free text inside notes', defaultVal: 'Fran', code: 'text:…' }
      ]
    },
    {
      group: 'Shape',
      items: [
        { type: 'time', label: 'Date window', desc: 'Restrict by relative or custom dates', defaultVal: 'last 4w', code: 'last …' },
        { type: 'groupBy', label: 'Group by', desc: 'Bucket results by day, week, or movement', defaultVal: 'date', code: 'by {…}' }
      ]
    }
  ];

  var SAMPLE_ITEMS = [
    { id: 'n1', title: 'Fran — 21-15-9 Thrusters & Pull-ups', target: 'note', notebook: 'benchmarks', effort: 'thruster', tags: ['benchmark', 'conditioning'], equipment: 'barbell', quality: 'metcon', daysAgo: 3, date: '2026-11-16', metrics: { totalVolume: 2150, reps: 90, tis: 4.2, 'calc.e1rm': 68 }, summary: 'Unbroken round of 21, split pull-ups 8/7 in round of 15. Time 4:12.' },
    { id: 'n2', title: 'Deadlift 5×5 @ 140 kg', target: 'note', notebook: 'strength', effort: 'deadlift', tags: ['strength', 'pr'], equipment: 'barbell', quality: 'strength', daysAgo: 5, date: '2026-11-14', metrics: { totalVolume: 3500, reps: 25, tis: 18, 'calc.e1rm': 168 }, summary: 'Controlled eccentric, beltless top sets at RPE 8.5.' },
    { id: 'n3', title: 'Morning Journal — KB Swing EMOM 16', target: 'note', notebook: 'journal', effort: 'kettlebell-swing', tags: ['conditioning'], equipment: 'kettlebell', quality: 'metcon', daysAgo: 2, date: '2026-11-17', metrics: { totalVolume: 4800, reps: 200, tis: 16, 'calc.e1rm': 32 }, summary: '20 swings EMOM @ 24 kg with nasal recovery between minutes.' },
    { id: 'n4', title: 'Cindy 20m AMRAP', target: 'note', notebook: 'journal', effort: 'pull-up', tags: ['benchmark', 'conditioning'], equipment: 'pull-up-bar', quality: 'metcon', daysAgo: 9, date: '2026-11-10', metrics: { totalVolume: 1850, reps: 540, tis: 20, 'calc.e1rm': 18 }, summary: '18 rounds + 5 pull-ups. Steady 1:05/round pacing.' },
    { id: 'n5', title: 'Heavy Deadlift Doubles + Row Finisher', target: 'note', notebook: 'journal', effort: 'deadlift', tags: ['strength'], equipment: 'barbell', quality: 'strength', daysAgo: 12, date: '2026-11-07', metrics: { totalVolume: 2920, reps: 16, tis: 22, 'calc.e1rm': 172 }, summary: '8×2 @ 155 kg followed by 4×500m row @ 1:46/500m.' },
    { id: 'n6', title: 'Back Squat Linear Progression W4', target: 'note', notebook: 'strength', effort: 'back-squat', tags: ['strength'], equipment: 'barbell', quality: 'strength', daysAgo: 18, date: '2026-11-01', metrics: { totalVolume: 3960, reps: 30, tis: 24, 'calc.e1rm': 152 }, summary: '3×5 @ 132 kg, bar speed crisp on final set.' },
    { id: 'n7', title: '5k Row Erg Threshold Test', target: 'note', notebook: 'journal', effort: 'row', tags: ['benchmark', 'pr'], equipment: 'rower', quality: 'metcon', daysAgo: 21, date: '2026-10-29', metrics: { totalVolume: 1950, reps: 480, tis: 18.8, 'calc.e1rm': 0 }, summary: '18:47 total (1:52.7/500m average split, negative split last 1k).' },
    { id: 'n8', title: 'Kettlebell Complex + Thruster Density', target: 'note', notebook: 'journal', effort: 'thruster', tags: ['conditioning'], equipment: 'kettlebell', quality: 'metcon', daysAgo: 26, date: '2026-10-24', metrics: { totalVolume: 2400, reps: 80, tis: 14, 'calc.e1rm': 58 }, summary: 'Double 20 kg KB clean & thruster ladders.' },
    { id: 'n9', title: 'Deadlift Speed Pulls 10×2 @ 115 kg', target: 'note', notebook: 'journal', effort: 'deadlift', tags: ['strength'], equipment: 'barbell', quality: 'strength', daysAgo: 42, date: '2026-10-08', metrics: { totalVolume: 2300, reps: 20, tis: 15, 'calc.e1rm': 164 }, summary: 'EMOM doubles focusing on floor speed and brace.' },
    { id: 'n10', title: 'Strict Pull-up Volume + Core', target: 'note', notebook: 'journal', effort: 'pull-up', tags: ['strength'], equipment: 'pull-up-bar', quality: 'strength', daysAgo: 58, date: '2026-09-22', metrics: { totalVolume: 1420, reps: 65, tis: 14, 'calc.e1rm': 20 }, summary: '5×10 strict + hollow holds between sets.' }
  ];

  var PRESETS = {
    journal: {
      id: 'journal',
      routeLabel: '/journal',
      title: 'Journal',
      defaultScopeLabel: 'in Journal',
      kind: 'find',
      clauses: [
        { id: 'c-target', type: 'target', value: 'note', excluded: false },
        { id: 'c-nb', type: 'notebook', value: 'journal', excluded: false },
        { id: 'c-time', type: 'time', value: 'last 4w', excluded: false },
        { id: 'c-group', type: 'groupBy', value: 'date', excluded: false }
      ]
    },
    efforts: {
      id: 'efforts',
      routeLabel: '/efforts',
      title: 'Efforts',
      defaultScopeLabel: 'in Efforts',
      kind: 'find',
      clauses: [
        { id: 'c-target', type: 'target', value: 'effort', excluded: false },
        { id: 'c-eq', type: 'equipment', value: 'kettlebell', excluded: false, ignored: true, reason: 'Filter "equipment" is not supported on :effort queries' },
        { id: 'c-qual', type: 'quality', value: 'strength', excluded: false, ignored: true, reason: 'Filter "quality" is not supported on :effort queries' },
        { id: 'c-time', type: 'time', value: 'last 12w', excluded: false }
      ]
    },
    notes: {
      id: 'notes',
      routeLabel: '/notes',
      title: 'Notes',
      defaultScopeLabel: 'in Notes',
      kind: 'find',
      clauses: [
        { id: 'c-target', type: 'target', value: 'note', excluded: false },
        { id: 'c-nb', type: 'notebook', value: '*', excluded: false }
      ]
    },
    dashboards: {
      id: 'dashboards',
      routeLabel: '/dashboards',
      title: 'Metric Explorer',
      defaultScopeLabel: 'in Metric Explorer',
      kind: 'aggregate',
      clauses: [
        { id: 'c-agg', type: 'agg', value: 'sum', excluded: false },
        { id: 'c-metric', type: 'metric', value: 'totalVolume', excluded: false },
        { id: 'c-effort', type: 'effort', value: 'deadlift', excluded: false },
        { id: 'c-group', type: 'groupBy', value: 'week', excluded: false },
        { id: 'c-time', type: 'time', value: 'last 12w', excluded: false }
      ]
    }
  };

  function cloneQuery(presetOrQuery) {
    return {
      presetId: presetOrQuery.presetId || presetOrQuery.id || 'journal',
      kind: presetOrQuery.kind,
      clauses: presetOrQuery.clauses.map(function (c) {
        return {
          id: c.id,
          type: c.type,
          value: c.value,
          excluded: !!c.excluded,
          ignored: !!c.ignored,
          reason: c.reason || '',
          startDate: c.startDate || '',
          endDate: c.endDate || ''
        };
      })
    };
  }

  function isFilterType(type) {
    return type !== 'target' && type !== 'agg' && type !== 'metric' && type !== 'time' && type !== 'groupBy';
  }

  function serializeTokens(query) {
    var tokens = [];
    var cursor = 0;

    function push(text, clauseId, tokenClass, warn) {
      var start = cursor;
      cursor += text.length;
      tokens.push({
        text: text,
        clauseId: clauseId || null,
        tokenClass: tokenClass || 'tok-punct',
        warn: !!warn,
        start: start,
        end: cursor
      });
    }

    var target = query.clauses.find(function (c) { return c.type === 'target'; });
    var agg = query.clauses.find(function (c) { return c.type === 'agg'; });
    var metric = query.clauses.find(function (c) { return c.type === 'metric'; });
    var filters = query.clauses.filter(function (c) { return isFilterType(c.type); });
    var group = query.clauses.find(function (c) { return c.type === 'groupBy'; });
    var time = query.clauses.find(function (c) { return c.type === 'time'; });

    if (query.kind === 'aggregate') {
      if (agg) push(agg.value, agg.id, 'tok-agg');
      push(':', null, 'tok-punct');
      if (metric) push(metric.value, metric.id, 'tok-metric');
    } else {
      push(':', null, 'tok-punct');
      if (target) push(target.value, target.id, 'tok-head');
    }

    if (filters.length > 0) {
      push('{', null, 'tok-punct');
      filters.forEach(function (f, idx) {
        if (idx > 0) push(',', null, 'tok-punct');
        var prefix = f.excluded ? '-' : '';
        var valText = /\s/.test(f.value) ? '"' + f.value + '"' : f.value;
        push(prefix + f.type + ':' + valText, f.id, 'tok-filter', f.ignored);
      });
      push('}', null, 'tok-punct');
    }

    if (group) {
      push(' ', null, 'tok-punct');
      push('by {' + group.value + '}', group.id, 'tok-dim');
    }

    if (time && time.value !== 'all') {
      push(' ', null, 'tok-punct');
      push(time.value, time.id, 'tok-time');
    } else if (time && time.value === 'all') {
      push(' ', null, 'tok-punct');
      push('all', time.id, 'tok-time');
    }

    return tokens;
  }

  function serializeWql(query) {
    return serializeTokens(query).map(function (t) { return t.text; }).join('');
  }

  function clauseAtOffset(tokens, offset) {
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!t.clauseId) continue;
      if (offset >= t.start && offset <= t.end) return t.clauseId;
    }
    return null;
  }

  function formatClauseDisplay(clause) {
    var meta = CLAUSE_META[clause.type] || { label: clause.type };
    var val = clause.value;
    if (clause.type === 'notebook' && val === '*') val = 'All (*)';
    if (clause.type === 'time') {
      if (val === 'last 1w') val = '1w';
      else if (val === 'last 4w') val = '4w';
      else if (val === 'last 12w') val = '12w';
      else if (val === 'last 1y') val = '1y';
      else if (val === 'all') val = 'Any time';
    }
    if (clause.excluded) val = 'not ' + val;
    return { key: meta.label, val: val };
  }

  function humanSummary(query, routeTitle) {
    var parts = [];
    var agg = query.clauses.find(function (c) { return c.type === 'agg'; });
    var metric = query.clauses.find(function (c) { return c.type === 'metric'; });
    var target = query.clauses.find(function (c) { return c.type === 'target'; });
    var nb = query.clauses.find(function (c) { return c.type === 'notebook'; });
    var effort = query.clauses.find(function (c) { return c.type === 'effort'; });
    var tags = query.clauses.find(function (c) { return c.type === 'tags'; });
    var time = query.clauses.find(function (c) { return c.type === 'time'; });
    var group = query.clauses.find(function (c) { return c.type === 'groupBy'; });

    if (query.kind === 'aggregate' && agg && metric) {
      parts.push(agg.value.toUpperCase() + ' ' + metric.value);
    } else if (nb) {
      parts.push(nb.value === '*' ? 'All notebooks' : (nb.excluded ? 'Not ' + nb.value : nb.value.charAt(0).toUpperCase() + nb.value.slice(1)));
    } else if (target) {
      parts.push(routeTitle || target.value);
    }

    if (effort) parts.push((effort.excluded ? 'excl. ' : '') + effort.value);
    if (tags) parts.push((tags.excluded ? 'excl. #' : '#') + tags.value);
    if (time) {
      var timeLabel = time.value === 'last 4w' ? 'Last 4w' : time.value === 'last 12w' ? 'Last 12w' : time.value === 'last 1w' ? 'Last 1w' : time.value === 'all' ? 'Any time' : time.value;
      parts.push(timeLabel);
    }
    if (group) parts.push('By ' + group.value);

    return parts.join(' · ');
  }

  function maxDaysForWindow(val) {
    if (val === 'last 1w') return 7;
    if (val === 'last 4w') return 28;
    if (val === 'last 12w') return 84;
    if (val === 'last 1y') return 365;
    return 99999;
  }

  function filterItems(query, freeText) {
    var search = (freeText || '').trim().toLowerCase();
    var nb = query.clauses.find(function (c) { return c.type === 'notebook'; });
    var eff = query.clauses.find(function (c) { return c.type === 'effort'; });
    var tag = query.clauses.find(function (c) { return c.type === 'tags'; });
    var textClause = query.clauses.find(function (c) { return c.type === 'text'; });
    var time = query.clauses.find(function (c) { return c.type === 'time'; });
    var maxDays = time ? maxDaysForWindow(time.value) : 99999;

    return SAMPLE_ITEMS.filter(function (item) {
      if (item.daysAgo > maxDays) return false;
      if (nb && nb.value !== '*') {
        var matchNb = item.notebook === nb.value;
        if (nb.excluded ? matchNb : !matchNb) return false;
      }
      if (eff) {
        var matchEff = item.effort === eff.value;
        if (eff.excluded ? matchEff : !matchEff) return false;
      }
      if (tag) {
        var matchTag = item.tags.indexOf(tag.value) !== -1;
        if (tag.excluded ? matchTag : !matchTag) return false;
      }
      if (textClause && textClause.value) {
        var needle = textClause.value.toLowerCase();
        var blob = (item.title + ' ' + item.summary + ' ' + item.effort).toLowerCase();
        if (blob.indexOf(needle) === -1) return false;
      }
      if (search) {
        var searchBlob = (item.title + ' ' + item.summary + ' ' + item.effort + ' ' + item.notebook + ' ' + item.tags.join(' ')).toLowerCase();
        if (searchBlob.indexOf(search) === -1) return false;
      }
      return true;
    });
  }

  function getIgnoredClauses(query) {
    return query.clauses.filter(function (c) {
      if (c.ignored) return true;
      var target = query.clauses.find(function (x) { return x.type === 'target'; });
      if (query.kind === 'find' && target && target.value === 'effort' && (c.type === 'equipment' || c.type === 'quality')) {
        return true;
      }
      return false;
    });
  }

  function updateIgnoredFlags(query) {
    var target = query.clauses.find(function (x) { return x.type === 'target'; });
    var isEffortTarget = query.kind === 'find' && target && target.value === 'effort';
    query.clauses.forEach(function (c) {
      if (isEffortTarget && (c.type === 'equipment' || c.type === 'quality')) {
        c.ignored = true;
        c.reason = 'Filter "' + c.type + '" is not supported on :effort queries';
      } else {
        c.ignored = false;
        c.reason = '';
      }
    });
  }

  function parseWqlLoose(text, fallbackQuery) {
    var raw = (text || '').trim();
    if (!raw) return null;
    var next = cloneQuery(fallbackQuery);
    var aggMatch = raw.match(/^(sum|avg|max|count):([a-zA-Z0-9_.]+)/);
    var headMatch = raw.match(/^:([a-zA-Z0-9_]+)/);
    var newClauses = [];

    if (aggMatch) {
      next.kind = 'aggregate';
      newClauses.push({ id: 'c-agg', type: 'agg', value: aggMatch[1], excluded: false });
      newClauses.push({ id: 'c-metric', type: 'metric', value: aggMatch[2], excluded: false });
    } else if (headMatch) {
      next.kind = 'find';
      newClauses.push({ id: 'c-target', type: 'target', value: headMatch[1], excluded: false });
    } else {
      return null;
    }

    var braceMatch = raw.match(/\{([^}]*)\}/);
    if (braceMatch && raw.indexOf('{') < (raw.indexOf('by ') === -1 ? 9999 : raw.indexOf('by '))) {
      var parts = braceMatch[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      parts.forEach(function (part, i) {
        var excluded = part.charAt(0) === '-';
        var clean = excluded ? part.slice(1) : part;
        var colon = clean.indexOf(':');
        if (colon > 0) {
          var key = clean.slice(0, colon).trim();
          var val = clean.slice(colon + 1).trim().replace(/^"|"$/g, '');
          if (key && val) {
            newClauses.push({ id: 'c-f-' + i + '-' + key, type: key, value: val, excluded: excluded });
          }
        }
      });
    }

    var groupMatch = raw.match(/\bby\s*\{([^}]+)\}/);
    if (groupMatch) {
      newClauses.push({ id: 'c-group', type: 'groupBy', value: groupMatch[1].trim(), excluded: false });
    }

    var timeMatch = raw.match(/\b(last\s+\d+[wdmy]|all|from\s+\d{4}-\d{2}-\d{2}\s+to\s+\d{4}-\d{2}-\d{2})\b/);
    if (timeMatch) {
      newClauses.push({ id: 'c-time', type: 'time', value: timeMatch[1].replace(/\s+/g, ' '), excluded: false });
    }

    next.clauses = newClauses;
    updateIgnoredFlags(next);
    return next;
  }

  function renderSampleResultsHtml(query, items) {
    if (query.kind === 'aggregate') {
      var metricClause = query.clauses.find(function (c) { return c.type === 'metric'; });
      var metricKey = metricClause ? metricClause.value : 'totalVolume';
      var aggClause = query.clauses.find(function (c) { return c.type === 'agg'; });
      var aggName = aggClause ? aggClause.value.toUpperCase() : 'SUM';
      var weeks = ['Oct 12', 'Oct 19', 'Oct 26', 'Nov 02', 'Nov 09', 'Nov 16'];
      var baseVals = items.length === 0 ? [0, 0, 0, 0, 0, 0] : [2300, 2400, 3100, 2920, 3500, 4120];
      var maxVal = Math.max.apply(null, baseVals.concat([1]));
      var barsHtml = weeks.map(function (w, i) {
        var val = items.length ? Math.round(baseVals[i] * (metricKey === 'reps' ? 0.03 : metricKey === 'tis' ? 0.006 : metricKey === 'calc.e1rm' ? 0.045 : 1)) : 0;
        var pct = Math.max(8, Math.round((baseVals[i] / maxVal) * 100));
        return (
          '<div class="chart-col">' +
            '<span class="chart-bar-val tabular">' + val + '</span>' +
            '<div class="chart-bar-fill" style="height:' + (items.length ? pct : 6) + '%"></div>' +
            '<span class="chart-bar-lbl">' + w + '</span>' +
          '</div>'
        );
      }).join('');
      return (
        '<div class="chart-panel">' +
          '<div class="results-summary-bar">' +
            '<strong style="color:var(--fg)">' + aggName + ' ' + escapeHtml(metricKey) + ' across ' + items.length + ' matching sessions</strong>' +
            '<span class="mono tabular">' + escapeHtml(serializeWql(query)) + '</span>' +
          '</div>' +
          '<div class="chart-bars">' + barsHtml + '</div>' +
        '</div>'
      );
    }

    if (items.length === 0) {
      return (
        '<div class="entry-card">' +
          '<div class="entry-title">No matching records</div>' +
          '<p class="entry-note">Remove a filter or expand the time window to view workouts from your training log.</p>' +
        '</div>'
      );
    }

    return (
      '<div class="stream-grid">' +
      items.map(function (item) {
        var tagsHtml = item.tags.map(function (t) {
          return '<span class="meta-tag">#' + escapeHtml(t) + '</span>';
        }).join('');
        return (
          '<article class="entry-card">' +
            '<div class="entry-card-top">' +
              '<h3 class="entry-title">' + escapeHtml(item.title) + '</h3>' +
              '<span class="entry-date tabular">' + escapeHtml(item.date) + '</span>' +
            '</div>' +
            '<div class="entry-meta">' +
              '<span class="meta-tag">' + escapeHtml(item.notebook) + '</span>' +
              '<span class="meta-tag">' + escapeHtml(item.effort) + '</span>' +
              tagsHtml +
            '</div>' +
            '<p class="entry-note">' + escapeHtml(item.summary) + '</p>' +
          '</article>'
        );
      }).join('') +
      '</div>'
    );
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPickerBodyHtml(opts) {
    var clause = opts.clause; // null means Add Filter catalog
    var searchVal = opts.search || '';
    var needle = searchVal.trim().toLowerCase();
    var clauseIdx = opts.clauseIdx;
    var totalClauses = opts.totalClauses;

    if (!clause) {
      var addGroupsHtml = ADDABLE_FILTERS.map(function (grp) {
        var rows = grp.items.filter(function (it) {
          return !needle || it.label.toLowerCase().indexOf(needle) !== -1 || it.type.toLowerCase().indexOf(needle) !== -1 || it.desc.toLowerCase().indexOf(needle) !== -1;
        });
        if (!rows.length) return '';
        return (
          '<div>' +
            '<div class="option-group-title">' + escapeHtml(grp.group) + '</div>' +
            '<div class="option-list">' +
              rows.map(function (it) {
                return (
                  '<button type="button" class="option-row" data-action="pick-add-filter" data-filter-type="' + escapeHtml(it.type) + '" data-default-val="' + escapeHtml(it.defaultVal) + '">' +
                    '<span class="option-row-text">' +
                      '<span class="option-row-label">' + escapeHtml(it.label) + '</span>' +
                      '<span class="option-row-desc">' + escapeHtml(it.desc) + '</span>' +
                    '</span>' +
                    '<span class="option-row-code">' + escapeHtml(it.code) + '</span>' +
                  '</button>'
                );
              }).join('') +
            '</div>' +
          '</div>'
        );
      }).join('');

      return (
        '<div class="picker-header">' +
          '<div class="picker-header-top">' +
            '<div class="picker-title-group">' +
              '<div class="picker-step-label"><span>Add filter clause</span><span class="picker-step-badge">Catalog</span></div>' +
              '<div class="picker-desc">Pick a clause type before choosing a value (live query stays untouched while searching).</div>' +
            '</div>' +
            '<div class="picker-step-actions">' +
              '<button type="button" class="icon-btn" data-action="close-picker" aria-label="Close picker">' + icons.x(15) + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="picker-search-row">' +
            '<input type="text" class="picker-search-input" data-role="picker-search" value="' + escapeHtml(searchVal) + '" placeholder="Search filter types (tag, movement, date…)" aria-label="Search filter catalog" />' +
          '</div>' +
        '</div>' +
        '<div class="picker-options-scroll">' +
          (addGroupsHtml || '<div class="picker-desc" style="padding:10px">No matching filter types.</div>') +
        '</div>' +
        '<div class="picker-footer">' +
          '<span>Choose a filter to append</span>' +
          '<span>Esc closes</span>' +
        '</div>'
      );
    }

    var meta = CLAUSE_META[clause.type] || { label: clause.type, description: 'Edit clause value.', excludable: false };
    var groups = CLAUSE_VOCAB[clause.type] || [];

    var modifiersHtml = '';
    if (meta.excludable) {
      modifiersHtml +=
        '<div class="picker-modifiers">' +
          '<label class="check-pill">' +
            '<input type="checkbox" data-action="toggle-exclude"' + (clause.excluded ? ' checked' : '') + ' />' +
            '<span>Exclude matches (-' + escapeHtml(clause.type) + ':)</span>' +
          '</label>' +
        '</div>';
    }

    var warnBanner = '';
    if (clause.ignored) {
      warnBanner =
        '<div class="advisory-strip" style="border-radius:6px;border:1px solid var(--warn-border);padding:8px 10px;margin-bottom:4px">' +
          '<div class="advisory-strip-msg">' + icons.alert(15) + '<span>' + escapeHtml(clause.reason || 'Ignored on this query target.') + '</span></div>' +
          '<button type="button" class="btn btn-warn" data-action="remove-clause" data-clause-id="' + escapeHtml(clause.id) + '">Remove filter</button>' +
        '</div>';
    }

    var optionsHtml = '';
    if (meta.freeText) {
      optionsHtml =
        '<div style="display:flex;flex-direction:column;gap:8px;padding:4px 2px">' +
          '<label style="font-size:12px;font-weight:600;color:var(--fg-2)">Phrase to match</label>' +
          '<div style="display:flex;gap:8px">' +
            '<input type="text" class="picker-search-input" data-role="free-text-val" value="' + escapeHtml(clause.value) + '" placeholder="e.g. Fran, unbroken, nasal…" />' +
            '<button type="button" class="btn btn-primary" data-action="apply-free-text">Set</button>' +
          '</div>' +
        '</div>';
    } else {
      optionsHtml = groups.map(function (grp) {
        var rows = grp.items.filter(function (it) {
          return !needle || it.label.toLowerCase().indexOf(needle) !== -1 || it.value.toLowerCase().indexOf(needle) !== -1 || it.desc.toLowerCase().indexOf(needle) !== -1;
        });
        if (!rows.length) return '';
        return (
          '<div>' +
            '<div class="option-group-title">' + escapeHtml(grp.group) + '</div>' +
            '<div class="option-list">' +
              rows.map(function (it) {
                var sel = it.value === clause.value;
                return (
                  '<button type="button" class="option-row' + (sel ? ' is-selected' : '') + '" data-action="pick-option" data-value="' + escapeHtml(it.value) + '">' +
                    '<span class="option-row-text">' +
                      '<span class="option-row-label">' + escapeHtml(it.label) + '</span>' +
                      '<span class="option-row-desc">' + escapeHtml(it.desc) + '</span>' +
                    '</span>' +
                    '<span class="option-row-code">' + escapeHtml(it.code) + '</span>' +
                  '</button>'
                );
              }).join('') +
            '</div>' +
          '</div>'
        );
      }).join('');

      if (meta.hasCustomDates) {
        optionsHtml +=
          '<div>' +
            '<div class="option-group-title">Custom date range</div>' +
            '<div class="date-range-grid">' +
              '<div class="date-field">' +
                '<label for="custom-start-date">Start date</label>' +
                '<input id="custom-start-date" type="date" data-role="date-start" value="' + escapeHtml(clause.startDate || '2026-10-15') + '" />' +
              '</div>' +
              '<div class="date-field">' +
                '<label for="custom-end-date">End date</label>' +
                '<input id="custom-end-date" type="date" data-role="date-end" value="' + escapeHtml(clause.endDate || '2026-11-19') + '" />' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;justify-content:flex-end;margin-top:6px">' +
              '<button type="button" class="btn btn-secondary" data-action="apply-custom-dates">Apply custom dates</button>' +
            '</div>' +
          '</div>';
      }
    }

    return (
      '<div class="picker-header">' +
        '<div class="picker-header-top">' +
          '<div class="picker-title-group">' +
            '<div class="picker-step-label">' +
              '<span>' + escapeHtml(meta.label) + '</span>' +
              '<span class="picker-step-badge tabular">' + (clauseIdx + 1) + ' of ' + totalClauses + '</span>' +
            '</div>' +
            '<div class="picker-desc">' + escapeHtml(meta.description) + '</div>' +
          '</div>' +
          '<div class="picker-step-actions">' +
            '<button type="button" class="icon-btn" data-action="step-prev" aria-label="Previous clause" title="Previous clause (Shift+Tab)">' + icons.chevronLeft(15) + '</button>' +
            '<button type="button" class="icon-btn" data-action="step-next" aria-label="Next clause" title="Next clause (Tab)">' + icons.chevronRight(15) + '</button>' +
            '<button type="button" class="icon-btn" data-action="close-picker" aria-label="Close picker" title="Close (Esc returns to pill)">' + icons.x(15) + '</button>' +
          '</div>' +
        '</div>' +
        (!meta.freeText ? (
          '<div class="picker-search-row">' +
            '<input type="text" class="picker-search-input" data-role="picker-search" value="' + escapeHtml(searchVal) + '" placeholder="Filter ' + escapeHtml(meta.label.toLowerCase()) + ' options (current: ' + escapeHtml(clause.value) + ')" aria-label="Filter ' + escapeHtml(meta.label) + ' options" />' +
          '</div>'
        ) : '') +
        modifiersHtml +
      '</div>' +
      '<div class="picker-options-scroll">' +
        warnBanner +
        (optionsHtml || '<div class="picker-desc" style="padding:10px">No matching options.</div>') +
      '</div>' +
      '<div class="picker-footer">' +
        '<span>Tab / Shift+Tab step clauses</span>' +
        '<span>Esc returns to pill</span>' +
      '</div>'
    );
  }

  function renderPaletteResultsHtml(items, freeText) {
    var needle = (freeText || '').trim().toLowerCase();
    var matches = items.filter(function (it) {
      if (!needle) return true;
      return (it.title + ' ' + it.summary + ' ' + it.effort + ' ' + it.notebook).toLowerCase().indexOf(needle) !== -1;
    });
    if (!matches.length) {
      return '<div class="picker-desc" style="padding:14px">No matching workouts in scope. Try removing the scope badge or changing filters.</div>';
    }
    return matches.slice(0, 6).map(function (it) {
      return (
        '<button type="button" class="palette-result-item" data-action="open-result" data-title="' + escapeHtml(it.title) + '">' +
          '<span style="min-width:0;display:flex;flex-direction:column;gap:2px">' +
            '<span class="palette-result-title">' + escapeHtml(it.title) + '</span>' +
            '<span class="palette-result-sub">' + escapeHtml(it.notebook) + ' · ' + escapeHtml(it.effort) + ' · ' + escapeHtml(it.date) + '</span>' +
          '</span>' +
          '<span style="color:var(--muted-fg);flex-shrink:0">' + icons.arrowUpRight(15) + '</span>' +
        '</button>'
      );
    }).join('');
  }

  global.WqlProto = {
    icons: icons,
    CLAUSE_META: CLAUSE_META,
    CLAUSE_VOCAB: CLAUSE_VOCAB,
    ADDABLE_FILTERS: ADDABLE_FILTERS,
    SAMPLE_ITEMS: SAMPLE_ITEMS,
    PRESETS: PRESETS,
    cloneQuery: cloneQuery,
    isFilterType: isFilterType,
    serializeTokens: serializeTokens,
    serializeWql: serializeWql,
    clauseAtOffset: clauseAtOffset,
    formatClauseDisplay: formatClauseDisplay,
    humanSummary: humanSummary,
    filterItems: filterItems,
    getIgnoredClauses: getIgnoredClauses,
    updateIgnoredFlags: updateIgnoredFlags,
    parseWqlLoose: parseWqlLoose,
    renderSampleResultsHtml: renderSampleResultsHtml,
    renderPickerBodyHtml: renderPickerBodyHtml,
    renderPaletteResultsHtml: renderPaletteResultsHtml,
    escapeHtml: escapeHtml
  };
})(window);
