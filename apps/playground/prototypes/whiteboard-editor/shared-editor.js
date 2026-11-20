/* WOD Wiki — Shared Whiteboard Syntax Editor Engine, Catalogs, Parser & Renderers */
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
    timer: function (s) { return svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M9 2h6"/>', s); },
    rest: function (s) { return svg('<path d="M10 2h4"/><path d="M12 14v-4"/><path d="M4 13a8 8 0 0 1 16 0c0 4.4-3.6 8-8 8s-8-3.6-8-8Z"/>', s); },
    rounds: function (s) { return svg('<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>', s); },
    rep: function (s) { return svg('<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>', s); },
    effort: function (s) { return svg('<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/>', s); },
    equipment: function (s) { return svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/>', s); },
    resistance: function (s) { return svg('<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>', s); },
    distance: function (s) { return svg('<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>', s); },
    action: function (s) { return svg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', s); },
    tag: function (s) { return svg('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>', s); },
    wiki: function (s) { return svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', s); },
    warning: function (s) { return svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', s); },
    error: function (s) { return svg('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>', s); },
    plus: function (s) { return svg('<path d="M5 12h14"/><path d="M12 5v14"/>', s); },
    trash: function (s) { return svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>', s); },
    undo: function (s) { return svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>', s); },
    redo: function (s) { return svg('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>', s); },
    keyboard: function (s) { return svg('<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><path d="M7 16h10"/>', s); },
    sliders: function (s) { return svg('<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/>', s); },
    play: function (s) { return svg('<polygon points="6 3 20 12 6 21 6 3"/>', s); },
    more: function (s) { return svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>', s); },
    check: function (s) { return svg('<polyline points="20 6 9 17 4 12"/>', s); },
    search: function (s) { return svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', s); },
    indent: function (s) { return svg('<polyline points="3 8 7 12 3 16"/><line x1="21" x2="11" y1="12" y2="12"/><line x1="21" x2="11" y1="6" y2="6"/><line x1="21" x2="11" y1="18" y2="18"/>', s); },
    outdent: function (s) { return svg('<polyline points="7 8 3 12 7 16"/><line x1="21" x2="11" y1="12" y2="12"/><line x1="21" x2="11" y1="6" y2="6"/><line x1="21" x2="11" y1="18" y2="18"/>', s); },
    newline: function (s) { return svg('<polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>', s); },
    x: function (s) { return svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', s); },
    chevronLeft: function (s) { return svg('<path d="m15 18-6-6 6-6"/>', s); },
    chevronRight: function (s) { return svg('<path d="m9 18 6-6-6-6"/>', s); },
    chevronDown: function (s) { return svg('<path d="m6 9 6 6 6-6"/>', s); },
    sparkles: function (s) { return svg('<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>', s); },
    code: function (s) { return svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>', s); },
    bold: function (s) { return svg('<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>', s); },
    italic: function (s) { return svg('<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>', s); },
    strike: function (s) { return svg('<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" x2="20" y1="12" y2="12"/>', s); },
    blocks: function (s) { return svg('<rect width="7" height="7" x="14" y="3" rx="1"/><path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"/>', s); },
    layers: function (s) { return svg('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>', s); },
    arrowUpRight: function (s) { return svg('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', s); }
  };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function slugify(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
  }

  /* ── Domain Catalogs ─────────────────────────────────────────────────── */
  var BASE_EFFORTS = [
    { id: 'kettlebell-swing', name: 'Kettlebell Swing', aliases: ['kb swing', 'russian swing', 'swing'], defaultEquipment: 'Kettlebell', notebooks: ['kettlebell', 'conditioning'], recent: true, category: 'Ballistic' },
    { id: 'back-squat', name: 'Back Squat', aliases: ['squat', 'bs'], defaultEquipment: 'Barbell', notebooks: ['strength', 'kettlebell'], recent: true, category: 'Squat' },
    { id: 'pull-up', name: 'Pull-up', aliases: ['pullup', 'strict pull-up', 'kipping pull-up'], defaultEquipment: 'Pull-Up Bar', notebooks: ['gymnastics', 'conditioning'], recent: true, category: 'Gymnastics' },
    { id: 'thruster', name: 'Thruster', aliases: ['bb thruster', 'barbell thruster'], defaultEquipment: 'Barbell', notebooks: ['conditioning', 'benchmarks'], recent: true, category: 'Barbell' },
    { id: 'run', name: 'Run', aliases: ['jog', 'sprint', 'shuttle'], defaultEquipment: null, notebooks: ['conditioning', 'endurance'], recent: true, category: 'Monostructural' },
    { id: 'plank', name: 'Plank', aliases: ['forearm plank', 'hollow plank'], defaultEquipment: null, notebooks: ['core', 'conditioning'], recent: true, category: 'Core' },
    { id: 'row', name: 'Row', aliases: ['erg', 'rower', 'concept2'], defaultEquipment: 'Rower', notebooks: ['conditioning', 'endurance'], recent: false, category: 'Monostructural' },
    { id: 'air-bike', name: 'Air Bike', aliases: ['assault bike', 'echo bike', 'bike'], defaultEquipment: 'Assault Bike', notebooks: ['conditioning'], recent: false, category: 'Monostructural' },
    { id: 'box-jump', name: 'Box Jump', aliases: ['bj', 'step up'], defaultEquipment: 'Box', notebooks: ['conditioning'], recent: false, category: 'Plyometric' },
    { id: 'deadlift', name: 'Deadlift', aliases: ['dl', 'conventional deadlift'], defaultEquipment: 'Barbell', notebooks: ['strength'], recent: false, category: 'Hinge' },
    { id: 'clean-and-jerk', name: 'Clean & Jerk', aliases: ['c&j', 'clean jerk'], defaultEquipment: 'Barbell', notebooks: ['strength', 'olympic'], recent: false, category: 'Olympic' },
    { id: 'snatch', name: 'Snatch', aliases: ['power snatch', 'squat snatch'], defaultEquipment: 'Barbell', notebooks: ['olympic'], recent: false, category: 'Olympic' },
    { id: 'burpee', name: 'Burpee', aliases: ['chest to deck'], defaultEquipment: null, notebooks: ['conditioning'], recent: true, category: 'Conditioning' },
    { id: 'double-under', name: 'Double-Under', aliases: ['du', 'dubs', 'jump rope'], defaultEquipment: 'Jump Rope', notebooks: ['conditioning'], recent: false, category: 'Monostructural' },
    { id: 'wall-ball', name: 'Wall Ball', aliases: ['wb', 'wall ball shot'], defaultEquipment: 'Medicine Ball', notebooks: ['conditioning'], recent: false, category: 'Squat' },
    { id: 'turkish-get-up', name: 'Turkish Get-Up', aliases: ['tgu', 'get up'], defaultEquipment: 'Kettlebell', notebooks: ['kettlebell'], recent: true, category: 'Core' },
    { id: 'goblet-squat', name: 'Goblet Squat', aliases: ['kb goblet'], defaultEquipment: 'Kettlebell', notebooks: ['kettlebell', 'strength'], recent: false, category: 'Squat' },
    { id: 'push-up', name: 'Push-up', aliases: ['pushup'], defaultEquipment: null, notebooks: ['gymnastics'], recent: false, category: 'Gymnastics' },
    { id: 'ring-dip', name: 'Ring Dip', aliases: ['dips'], defaultEquipment: 'Rings', notebooks: ['gymnastics'], recent: false, category: 'Gymnastics' },
    { id: 'toes-to-bar', name: 'Toes-to-Bar', aliases: ['t2b', 'ttb'], defaultEquipment: 'Pull-Up Bar', notebooks: ['gymnastics'], recent: false, category: 'Gymnastics' },
    { id: 'handstand-push-up', name: 'Handstand Push-up', aliases: ['hspu'], defaultEquipment: null, notebooks: ['gymnastics'], recent: false, category: 'Gymnastics' },
    { id: 'walking-lunge', name: 'Walking Lunge', aliases: ['lunges', 'lunge'], defaultEquipment: 'Dumbbells', notebooks: ['strength'], recent: false, category: 'Squat' },
    { id: 'sled-push', name: 'Sled Push', aliases: ['prowler'], defaultEquipment: 'Sled', notebooks: ['conditioning'], recent: false, category: 'Conditioning' },
    { id: 'farmer-carry', name: 'Farmer Carry', aliases: ['carry', 'farmers walk'], defaultEquipment: 'Kettlebell', notebooks: ['kettlebell', 'strength'], recent: false, category: 'Carry' }
  ];

  var BASE_EQUIPMENT = [
    { id: 'kettlebell', name: 'Kettlebell', desc: 'Cast-iron or competition bell' },
    { id: 'barbell', name: 'Barbell', desc: '20kg / 45lb Olympic bar' },
    { id: 'pull-up-bar', name: 'Pull-Up Bar', desc: 'Rig or doorway bar' },
    { id: 'dumbbells', name: 'Dumbbells', desc: 'Matched pair' },
    { id: 'rower', name: 'Rower', desc: 'Concept2 / indoor erg' },
    { id: 'assault-bike', name: 'Assault Bike', desc: 'Fan air bike' },
    { id: 'box', name: 'Box', desc: '20 / 24 / 30 in plyo box' },
    { id: 'rings', name: 'Rings', desc: 'Gymnastic wooden rings' },
    { id: 'jump-rope', name: 'Jump Rope', desc: 'Speed cable rope' },
    { id: 'sled', name: 'Sled', desc: 'Turf push/pull sled' },
    { id: 'medicine-ball', name: 'Medicine Ball', desc: 'Wall ball / slam ball' }
  ];

  var BASE_TAGS = [
    { slug: 'emom', group: 'Format', desc: 'Every Minute On the Minute pacing' },
    { slug: 'amrap', group: 'Format', desc: 'As Many Rounds As Possible' },
    { slug: 'tabata', group: 'Format', desc: '20s work / 10s rest intervals' },
    { slug: 'for-time', group: 'Format', desc: 'Timed completion benchmark' },
    { slug: 'chipper', group: 'Format', desc: 'Single-pass high-rep sequence' },
    { slug: 'strength', group: 'Focus', desc: 'Heavy primary lift progression' },
    { slug: 'conditioning', group: 'Focus', desc: 'Metabolic / aerobic work capacity' },
    { slug: 'heavy', group: 'Focus', desc: 'High intensity >= 80% 1RM' },
    { slug: 'mobility', group: 'Focus', desc: 'Joint prep & cooldown flow' },
    { slug: 'recovery', group: 'Focus', desc: 'Zone 2 or restorative pacing' },
    { slug: 'core', group: 'Focus', desc: 'Midline stability & bracing' },
    { slug: 'kettlebell', group: 'Modality', desc: 'Single or double bell work' },
    { slug: 'barbell', group: 'Modality', desc: 'Olympic or powerlifting bar' },
    { slug: 'gymnastics', group: 'Modality', desc: 'Bodyweight rig & floor skills' },
    { slug: 'monostructural', group: 'Modality', desc: 'Run, row, bike, ski, jump rope' },
    { slug: 'sound-classic', group: 'Audio', desc: 'Classic 3-2-1 interval tone' }
  ];

  var WIKI_NOTES = [
    { slug: 'benchmark-fran', title: 'Benchmark Fran', tags: ['#for-time', '#barbell'], summary: '21-15-9 Thruster @43kg & Pull-up' },
    { slug: 'kettlebell-foundations', title: 'Kettlebell Foundations', tags: ['#kettlebell', '#conditioning'], summary: 'Hinge mechanics, swing & TGU progressions' },
    { slug: 'squat-cycle-w4', title: 'Squat Cycle W4', tags: ['#strength', '#heavy'], summary: '5x5 Back Squat linear progression' },
    { slug: 'emom-conditioning-guide', title: 'EMOM Conditioning Guide', tags: ['#emom', '#conditioning'], summary: 'Pacing caps and work-to-rest ratios' },
    { slug: 'zone-2-running-notes', title: 'Zone 2 Running Notes', tags: ['#recovery', '#monostructural'], summary: 'Aerobic base intervals & nasal cadence' },
    { slug: 'mobility-warmup', title: 'Mobility Warmup', tags: ['#mobility'], summary: '10-minute hip & thoracic prep flow' },
    { slug: 'hero-murph', title: 'Hero Murph', tags: ['#for-time', '#gymnastics'], summary: '1 mile Run, 100 Pull-up, 200 Push-up, 300 Squat' },
    { slug: 'olympic-lifting-cues', title: 'Olympic Lifting Cues', tags: ['#barbell', '#strength'], summary: 'Snatch & Clean pull checkpoints' }
  ];

  var TEMPLATES = [
    { id: 'emom', name: 'EMOM', desc: 'Minute-by-minute work cap', lines: ['10:00 EMOM', '  15 Kettlebell Swing @24kg #emom'] },
    { id: 'amrap', name: 'AMRAP', desc: 'Continuous rounds in time window', lines: ['12:00 AMRAP', '  10 Pull-up', '  15 Push-up', '  200m Run #amrap'] },
    { id: 'tabata', name: 'Tabata', desc: '8 rounds of 20s work / 10s rest', lines: ['(8) Tabata', '  :20 Air Bike', '  *0:10 [:rest] #tabata'] },
    { id: '5x5', name: '5x5 Strength', desc: 'Sets × reps barbell progression', lines: ['5x5 Back Squat @100kg *2:00 #strength'] },
    { id: 'circuit', name: 'Circuit', desc: 'Multi-station timed rounds', lines: ['(3) Rounds', '  400m Run', '  15 Wall Ball 9kg', '  *1:00 [:rest]'] },
    { id: 'ladder', name: 'Ladder (21-15-9)', desc: 'Descending rep scheme', lines: ['(21-15-9)', '  Thruster @43kg', '  Pull-up #for-time'] },
    { id: 'choice', name: 'Choice (A | B)', desc: 'Scaled or equipment alternative', lines: ['(5) Rounds', '  15 Kettlebell Swing 24 | 16 kg', '  Run | Row 400m'] },
    { id: 'superset', name: 'Superset (+)', desc: 'Paired A/B lap block', lines: ['+ 5x5 Back Squat @100kg', '+ 10 Box Jump *1:30'] },
    { id: 'collectible', name: 'Collectible (:?)', desc: 'Open clock measure-until-done', lines: [':? 2000m Row #for-time'] }
  ];

  var SPORT_DIALECTS = [
    { id: '', label: 'General', desc: 'Standard WhiteboardScript rules' },
    { id: 'cardio', label: ':cardio', desc: 'Pace, split & distance defaults' },
    { id: 'strength', label: ':strength', desc: 'Load, %1RM & rest timers' },
    { id: 'climb', label: ':climb', desc: 'Hangboard & route grades' },
    { id: 'yoga', label: ':yoga', desc: 'Breath & hold cues' }
  ];

  var ACTIONS = [
    { code: '[:rest]', label: 'Rest Cue', desc: 'Mark an active rest transition' },
    { code: '[:next]', label: 'Advance Segment', desc: 'Skip forward on completion' },
    { code: '[:done]', label: 'Complete Block', desc: 'Finish timer when reached' },
    { code: '[:mark]', label: 'Split / Lap', desc: 'Record a split timestamp' }
  ];

  var PROPERTIES = [
    { code: 'sound: #sound-classic', label: 'Sound Cue', desc: 'Play #sound-classic at interval boundaries' },
    { code: 'rpe: 8', label: 'Target RPE', desc: 'Rate of perceived exertion (1-10)' },
    { code: 'tempo: 3010', label: 'Lift Tempo', desc: 'Eccentric-pause-concentric cadence' }
  ];

  function cloneData(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function createCatalogs() {
    return {
      efforts: cloneData(BASE_EFFORTS),
      equipment: cloneData(BASE_EQUIPMENT),
      tags: cloneData(BASE_TAGS),
      wikiNotes: cloneData(WIKI_NOTES)
    };
  }

  /* ── Scenario Presets ────────────────────────────────────────────────── */
  var SCENARIOS = {
    emom: {
      id: 'emom',
      label: 'EMOM + Strength',
      title: 'Tuesday Conditioning & Strength',
      frontmatter: { notebook: 'kettlebell', tags: ['#conditioning', '#strength'] },
      prose: [
        'Compare pacing with [[Benchmark Fran]] and keep nasal breathing during #recovery intervals.'
      ],
      blocks: [
        {
          dialect: 'time',
          sport: '',
          lines: [
            '10:00 EMOM',
            '  15 Kettlebell Swing @24kg #emom',
            '5x5 Back Squat @100kg #heavy',
            '400m Run *1:00',
            ':30 Plank [:rest]',
            '12 MysteryMovement 20kg #newtag'
          ]
        }
      ],
      initialCursor: { kind: 'wod', blockIdx: 0, lineIdx: 1 }
    },
    empty: {
      id: 'empty',
      label: 'Empty Starter',
      title: 'My Workout',
      frontmatter: { notebook: 'kettlebell', tags: ['#conditioning'] },
      prose: [
        'Drafting a new session — pick a template below or type directly.'
      ],
      blocks: [
        {
          dialect: 'time',
          sport: '',
          lines: ['']
        }
      ],
      initialCursor: { kind: 'wod', blockIdx: 0, lineIdx: 0 }
    },
    lint: {
      id: 'lint',
      label: 'Lint & Repair',
      title: 'Interval Draft (Diagnostics)',
      frontmatter: { notebook: 'conditioning', tags: ['#for-time'] },
      prose: [
        'Reviewing syntax errors and unresolved movements before starting the timer.'
      ],
      blocks: [
        {
          dialect: 'time',
          sport: 'cardio',
          lines: [
            '400m Run :rest',
            '21-15-9 Thruster @43kg',
            '10 MysteryMove #unlinked'
          ]
        }
      ],
      initialCursor: { kind: 'wod', blockIdx: 0, lineIdx: 0 }
    },
    prose: {
      id: 'prose',
      label: 'Prose & Wiki',
      title: 'Training Block Notes',
      frontmatter: { notebook: 'strength', tags: ['#strength', '#mobility'] },
      prose: [
        'Start with [[Mobility Warmup]] before loading [[Squat Cycle W4]] today.',
        'Focus on **bar path** and smooth transitions on #heavy sets.'
      ],
      blocks: [
        {
          dialect: 'log',
          sport: 'strength',
          lines: [
            '5x5 Back Squat @100kg #heavy',
            '3x8 Walking Lunge 24kg'
          ]
        }
      ],
      initialCursor: { kind: 'prose', lineIdx: 1 }
    }
  };

  /* ── Parser & Linter (AST-accurate multi-statement line parsing) ─────── */
  function findEffortMatchAt(text, idx, catalogs) {
    var sub = text.slice(idx);
    var best = null;
    for (var i = 0; i < catalogs.efforts.length; i++) {
      var eff = catalogs.efforts[i];
      var candidates = [eff.name].concat(eff.aliases || []);
      for (var c = 0; c < candidates.length; c++) {
        var name = candidates[c];
        if (!name) continue;
        var re = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[\\s,|#\\[\\]{}])', 'i');
        var m = re.exec(sub);
        if (m && (!best || m[0].length > best.raw.length)) {
          best = {
            kind: 'effort',
            raw: m[0],
            start: idx,
            end: idx + m[0].length,
            meta: { effortId: eff.id, effortName: eff.name, equipment: eff.defaultEquipment || null }
          };
        }
      }
    }
    return best;
  }

  function findEquipmentMatchAt(text, idx, catalogs) {
    var sub = text.slice(idx);
    var best = null;
    for (var i = 0; i < catalogs.equipment.length; i++) {
      var eq = catalogs.equipment[i];
      var re = new RegExp('^' + eq.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[\\s,|#\\[\\]{}])', 'i');
      var m = re.exec(sub);
      if (m && (!best || m[0].length > best.raw.length)) {
        best = {
          kind: 'equipment',
          raw: m[0],
          start: idx,
          end: idx + m[0].length,
          meta: { equipmentId: eq.id, equipmentName: eq.name }
        };
      }
    }
    return best;
  }

  function parseWodLine(text, catalogs) {
    var tokens = [];
    var errors = [];
    var str = String(text || '');
    var n = str.length;
    var i = 0;

    function pushTok(kind, raw, start, end, meta) {
      tokens.push({
        id: 't' + tokens.length + '_' + start,
        kind: kind,
        raw: raw,
        start: start,
        end: end,
        meta: meta || {}
      });
    }

    while (i < n) {
      if (/\s/.test(str[i])) {
        i++;
        continue;
      }

      var rest = str.slice(i);

      // 1. Comment //
      if (rest.indexOf('//') === 0) {
        var cEnd = rest.indexOf('#');
        var cRaw = cEnd > 0 ? rest.slice(0, cEnd).trimEnd() : rest;
        pushTok('comment', cRaw, i, i + cRaw.length, {});
        i += cRaw.length;
        continue;
      }

      // 2. Block heading `# Heading` (requires space after # so `#` at line start can be tag)
      if (i === 0 && /^#\s+/.test(str)) {
        pushTok('comment', str, 0, n, { isHeading: true });
        i = n;
        continue;
      }

      // 3. Property line (`sound: #sound-classic`, `rpe: 8`, `tempo: 3010`)
      if (tokens.length === 0) {
        var propM = /^([a-zA-Z][a-zA-Z0-9]*):\s+(#[a-zA-Z0-9-]+|"[^"]*"|[a-zA-Z0-9]+)/.exec(rest);
        if (propM) {
          pushTok('property', propM[0], i, i + propM[0].length, { key: propM[1], val: propM[2] });
          i += propM[0].length;
          continue;
        }
      }

      // 4. Lap prefix (+ or - at start)
      if (tokens.length === 0 && /^[+-](?=\s)/.test(rest)) {
        pushTok('action', rest[0], i, i + 1, { lap: true });
        i += 1;
        continue;
      }

      // 5. Action [:rest], [:next], [:done], [:mark]
      var actM = /^\[:[a-zA-Z0-9-]+\]/.exec(rest);
      if (actM) {
        pushTok('action', actM[0], i, i + actM[0].length, {});
        i += actM[0].length;
        continue;
      }

      // 6. Invalid bare :word like `:rest` (must catch before timer!)
      var badColonM = /^:[a-zA-Z][a-zA-Z0-9-]*/.exec(rest);
      if (badColonM) {
        var msg = 'Unexpected "' + badColonM[0] + '" — use *1:00 for a timed rest interval or [:' + badColonM[0].slice(1) + '] for an action cue.';
        var tokObj = {
          id: 't' + tokens.length + '_' + i,
          kind: 'lintError',
          raw: badColonM[0],
          start: i,
          end: i + badColonM[0].length,
          meta: { message: msg, fixes: ['*1:00', '[:' + badColonM[0].slice(1) + ']'] }
        };
        tokens.push(tokObj);
        errors.push({ token: tokObj, message: msg, fixes: tokObj.meta.fixes });
        i += badColonM[0].length;
        continue;
      }

      // 7. Duration (`:?`, `^5:00`, `*1:00`, `10:00`, `:30`)
      var durM = /^([*^]?)(:\?|\d*:\d{2}(?::\d{2})?)/.exec(rest);
      if (durM) {
        var prefix = durM[1];
        var body = durM[2];
        var mode = body === ':?' ? 'collectible' : prefix === '*' ? 'rest' : prefix === '^' ? 'countup' : 'countdown';
        var mins = 0;
        var secs = 0;
        if (body !== ':?') {
          var parts = body.split(':');
          if (parts.length === 2) {
            mins = parseInt(parts[0] || '0', 10) || 0;
            secs = parseInt(parts[1] || '0', 10) || 0;
          } else if (parts.length === 3) {
            mins = (parseInt(parts[0] || '0', 10) || 0) * 60 + (parseInt(parts[1] || '0', 10) || 0);
            secs = parseInt(parts[2] || '0', 10) || 0;
          }
        }
        pushTok('duration', durM[0], i, i + durM[0].length, { mode: mode, mins: mins, secs: secs });
        i += durM[0].length;
        continue;
      }

      // 8. Tag `#slug` (or bare `#`)
      var tagM = /^#[a-zA-Z0-9-]*/.exec(rest);
      if (tagM) {
        var slug = tagM[0].slice(1);
        var resolvedTag = null;
        for (var ti = 0; ti < catalogs.tags.length; ti++) {
          if (catalogs.tags[ti].slug.toLowerCase() === slug.toLowerCase()) {
            resolvedTag = catalogs.tags[ti];
            break;
          }
        }
        pushTok(resolvedTag ? 'tag' : 'unresolved', tagM[0], i, i + tagM[0].length, {
          slug: slug,
          isTag: true,
          tagInfo: resolvedTag
        });
        i += tagM[0].length;
        continue;
      }

      // 9. RoundScheme (`5x5`, `3 x 8`)
      var schemeM = /^(\d+)\s*[xX]\s*(\d+)\b/.exec(rest);
      if (schemeM) {
        pushTok('scheme', schemeM[0], i, i + schemeM[0].length, {
          sets: parseInt(schemeM[1], 10),
          reps: parseInt(schemeM[2], 10)
        });
        i += schemeM[0].length;
        continue;
      }

      // 10. Parenthesized Rounds `(3)` or `(21-15-9)`
      var grpM = /^\(([^)\n]+)\)/.exec(rest);
      if (grpM) {
        pushTok('rounds', grpM[0], i, i + grpM[0].length, { inner: grpM[1] });
        i += grpM[0].length;
        continue;
      }

      // 11. Bare ladder sequence missing parentheses (`21-15-9`)
      var bareLadderM = /^\d+(?:-\d+){2,}\b/.exec(rest);
      if (bareLadderM) {
        var lmsg = 'Rep ladders need parentheses so rounds parse cleanly — use (' + bareLadderM[0] + ').';
        var ltok = {
          id: 't' + tokens.length + '_' + i,
          kind: 'lintError',
          raw: bareLadderM[0],
          start: i,
          end: i + bareLadderM[0].length,
          meta: { message: lmsg, fixes: ['(' + bareLadderM[0] + ')'] }
        };
        tokens.push(ltok);
        errors.push({ token: ltok, message: lmsg, fixes: ltok.meta.fixes });
        i += bareLadderM[0].length;
        continue;
      }

      // 12. Keywords EMOM / AMRAP / Tabata / Rounds
      var kwM = /^(EMOM|AMRAP|Tabata|Rounds)\b/i.exec(rest);
      if (kwM) {
        pushTok('rounds', kwM[0], i, i + kwM[0].length, { keyword: kwM[0].toUpperCase() });
        i += kwM[0].length;
        continue;
      }

      // 13. Resistance (`@100kg`, `24kg`, `135 | 95 lb`, `1/2 pood`)
      var resAltM = /^(@?)(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*(kg|lbs?|pood|%)\b/i.exec(rest);
      if (resAltM) {
        pushTok('resistance', resAltM[0], i, i + resAltM[0].length, {
          hasAt: resAltM[1] === '@',
          amount: parseFloat(resAltM[2]),
          altAmount: parseFloat(resAltM[3]),
          unit: resAltM[4].toLowerCase()
        });
        i += resAltM[0].length;
        continue;
      }
      var resM = /^(@?)(\d+(?:\.\d+)?|1\/2|1\/4)\s*(kg|lbs?|pood|%)\b/i.exec(rest);
      if (resM) {
        pushTok('resistance', resM[0], i, i + resM[0].length, {
          hasAt: resM[1] === '@',
          amount: resM[2],
          altAmount: null,
          unit: resM[3].toLowerCase()
        });
        i += resM[0].length;
        continue;
      }

      // 14. Distance (`400m`, `1/4 mile`, `20 cal`)
      var distM = /^(1\/4|1\/2|3\/4|\d+(?:\.\d+)?)\s*(m|km|cal|ft|mi|mile|yd)\b/i.exec(rest);
      if (distM) {
        pushTok('distance', distM[0], i, i + distM[0].length, {
          amount: distM[1],
          unit: distM[2].toLowerCase()
        });
        i += distM[0].length;
        continue;
      }

      // 15. Bare integer Reps (`15`, `12`, `10`)
      var repM = /^@?\d+(?:\.\d+)?\b/.exec(rest);
      if (repM) {
        var hasAtRep = repM[0][0] === '@';
        var valRep = parseFloat(hasAtRep ? repM[0].slice(1) : repM[0]);
        pushTok('rep', repM[0], i, i + repM[0].length, { reps: valRep, hasAt: hasAtRep });
        i += repM[0].length;
        continue;
      }

      // 16. Pipe or Slash separators (`|` or `/`)
      if (rest[0] === '|' || rest[0] === '/') {
        pushTok('action', rest[0], i, i + 1, { separator: true });
        i += 1;
        continue;
      }

      // 17. Catalog Effort (multi-word & aliases stay unified!)
      var effMatch = findEffortMatchAt(str, i, catalogs);
      if (effMatch) {
        tokens.push({
          id: 't' + tokens.length + '_' + i,
          kind: effMatch.kind,
          raw: effMatch.raw,
          start: effMatch.start,
          end: effMatch.end,
          meta: effMatch.meta
        });
        i = effMatch.end;
        continue;
      }

      // 18. Catalog Equipment
      var eqMatch = findEquipmentMatchAt(str, i, catalogs);
      if (eqMatch) {
        tokens.push({
          id: 't' + tokens.length + '_' + i,
          kind: eqMatch.kind,
          raw: eqMatch.raw,
          start: eqMatch.start,
          end: eqMatch.end,
          meta: eqMatch.meta
        });
        i = eqMatch.end;
        continue;
      }

      // 19. Unresolved word / movement token (`MysteryMovement`, `MysteryMove`)
      var wordM = /^[^\s|/#\[\]{}]+/.exec(rest);
      if (wordM) {
        pushTok('unresolved', wordM[0], i, i + wordM[0].length, { isTag: false, rawName: wordM[0] });
        i += wordM[0].length;
        continue;
      }

      i++;
    }

    return { tokens: tokens, errors: errors };
  }

  function compileBlockSummary(block, catalogs) {
    var parsedLines = block.lines.map(function (ln) { return parseWodLine(ln, catalogs); });
    var totalSeconds = 0;
    var roundsCount = 0;
    var errCount = 0;
    var unresolvedCount = 0;
    var nonEmptyLines = 0;
    var timeline = [];

    parsedLines.forEach(function (pl, idx) {
      var rawLine = block.lines[idx] || '';
      if (rawLine.trim()) nonEmptyLines++;
      errCount += pl.errors.length;
      var lineDur = 0;
      var lineLabelParts = [];
      var isRestLine = false;

      pl.tokens.forEach(function (tok) {
        if (tok.kind === 'unresolved') unresolvedCount++;
        if (tok.kind === 'duration') {
          var secs = (tok.meta.mins || 0) * 60 + (tok.meta.secs || 0);
          totalSeconds += secs;
          lineDur += secs;
          if (tok.meta.mode === 'rest') isRestLine = true;
        }
        if (tok.kind === 'rounds') {
          var num = parseInt(tok.meta.inner || '0', 10);
          if (num > 0) roundsCount = Math.max(roundsCount, num);
        }
        if (tok.kind === 'effort' || tok.kind === 'unresolved' || tok.kind === 'action' || tok.kind === 'distance') {
          lineLabelParts.push(tok.raw);
        }
      });

      if (rawLine.trim()) {
        timeline.push({
          lineIdx: idx,
          raw: rawLine.trim(),
          seconds: lineDur,
          isRest: isRestLine,
          hasError: pl.errors.length > 0,
          label: lineLabelParts.join(' ') || rawLine.trim()
        });
      }
    });

    var mins = Math.floor(totalSeconds / 60);
    var remSecs = totalSeconds % 60;
    var durLabel = totalSeconds > 0 ? (mins + ':' + (remSecs < 10 ? '0' : '') + remSecs) : 'Open';
    return {
      parsedLines: parsedLines,
      nonEmptyLines: nonEmptyLines,
      totalSeconds: totalSeconds,
      durLabel: durLabel,
      roundsCount: roundsCount,
      errCount: errCount,
      unresolvedCount: unresolvedCount,
      timeline: timeline
    };
  }

  function collectNoteEntities(doc, catalogs) {
    var tagsMap = {};
    var effortsMap = {};
    var equipmentMap = {};
    var unresolvedMap = {};
    var errorList = [];

    (doc.frontmatter.tags || []).forEach(function (t) {
      tagsMap[t.toLowerCase()] = t;
    });

    (doc.prose || []).forEach(function (p) {
      var m;
      var tagRe = /(^|\s)(#[a-zA-Z0-9-]+)/g;
      while ((m = tagRe.exec(p)) !== null) {
        tagsMap[m[2].toLowerCase()] = m[2];
      }
    });

    doc.blocks.forEach(function (blk, bIdx) {
      blk.lines.forEach(function (ln, lIdx) {
        var parsed = parseWodLine(ln, catalogs);
        parsed.tokens.forEach(function (tok) {
          if (tok.kind === 'tag') {
            tagsMap[tok.raw.toLowerCase()] = tok.raw;
          } else if (tok.kind === 'effort') {
            effortsMap[tok.meta.effortId] = tok.meta.effortName;
            if (tok.meta.equipment) equipmentMap[slugify(tok.meta.equipment)] = tok.meta.equipment;
          } else if (tok.kind === 'equipment') {
            equipmentMap[tok.meta.equipmentId] = tok.meta.equipmentName;
          } else if (tok.kind === 'unresolved') {
            unresolvedMap[tok.raw] = {
              raw: tok.raw,
              isTag: !!tok.meta.isTag,
              blockIdx: bIdx,
              lineIdx: lIdx,
              token: tok
            };
          } else if (tok.kind === 'lintError') {
            errorList.push({
              raw: tok.raw,
              message: tok.meta.message,
              fixes: tok.meta.fixes,
              blockIdx: bIdx,
              lineIdx: lIdx,
              token: tok
            });
          }
        });
      });
    });

    return {
      tags: Object.keys(tagsMap).map(function (k) { return tagsMap[k]; }),
      efforts: Object.keys(effortsMap).map(function (k) { return { id: k, name: effortsMap[k] }; }),
      equipment: Object.keys(equipmentMap).map(function (k) { return { id: k, name: equipmentMap[k] }; }),
      unresolved: Object.keys(unresolvedMap).map(function (k) { return unresolvedMap[k]; }),
      errors: errorList
    };
  }

  /* ── Fuzzy Search Helpers ────────────────────────────────────────────── */
  function fuzzyMatches(query, fields) {
    var q = (query || '').trim().toLowerCase();
    if (!q) return true;
    var hay = fields.join(' ').toLowerCase();
    if (hay.indexOf(q) !== -1) return true;
    // Token prefix / subsequence fallback
    var parts = q.split(/\s+/);
    return parts.every(function (p) { return hay.indexOf(p) !== -1; });
  }

  function searchEfforts(query, activeNotebook, catalogs) {
    var nb = (activeNotebook || '').toLowerCase();
    var scoped = [];
    var other = [];
    catalogs.efforts.forEach(function (eff) {
      var fields = [eff.name, eff.category, eff.defaultEquipment || ''].concat(eff.aliases || []);
      if (!fuzzyMatches(query, fields)) return;
      var inScope = eff.recent || (nb && (eff.notebooks || []).indexOf(nb) !== -1);
      if (inScope) scoped.push(eff);
      else other.push(eff);
    });
    return { scoped: scoped, other: other };
  }

  function searchTags(query, catalogs) {
    var groups = {};
    catalogs.tags.forEach(function (t) {
      if (!fuzzyMatches(query, ['#' + t.slug, t.group, t.desc])) return;
      if (!groups[t.group]) groups[t.group] = [];
      groups[t.group].push(t);
    });
    return groups;
  }

  function searchWikiNotes(query, catalogs) {
    return catalogs.wikiNotes.filter(function (n) {
      return fuzzyMatches(query, [n.title, n.slug, n.summary].concat(n.tags || []));
    });
  }

  /* ── Safe Span Mutation & Undo/Redo Controller ───────────────────────── */
  function createEditorController(initialScenarioId) {
    var catalogs = createCatalogs();
    var scen = cloneData(SCENARIOS[initialScenarioId || 'emom'] || SCENARIOS.emom);
    var doc = {
      title: scen.title,
      frontmatter: scen.frontmatter,
      prose: scen.prose,
      blocks: scen.blocks
    };
    var cursor = cloneData(scen.initialCursor);
    var undoStack = [];
    var redoStack = [];

    function snapshot() {
      return {
        doc: cloneData(doc),
        cursor: cloneData(cursor),
        catalogs: cloneData(catalogs)
      };
    }

    function pushUndo() {
      undoStack.push(snapshot());
      if (undoStack.length > 40) undoStack.shift();
      redoStack = [];
    }

    function undo() {
      if (!undoStack.length) return false;
      redoStack.push(snapshot());
      var prev = undoStack.pop();
      doc = prev.doc;
      cursor = prev.cursor;
      catalogs = prev.catalogs;
      return true;
    }

    function redo() {
      if (!redoStack.length) return false;
      undoStack.push(snapshot());
      var next = redoStack.pop();
      doc = next.doc;
      cursor = next.cursor;
      catalogs = next.catalogs;
      return true;
    }

    function resolveFreshToken(line, tokenRef) {
      var parsed = parseWodLine(line, catalogs);
      if (tokenRef && typeof tokenRef.start === 'number') {
        for (var i = 0; i < parsed.tokens.length; i++) {
          var t = parsed.tokens[i];
          if (t.id === tokenRef.id || (t.raw === tokenRef.raw && t.start === tokenRef.start)) {
            return t;
          }
        }
        for (var j = 0; j < parsed.tokens.length; j++) {
          if (parsed.tokens[j].raw === tokenRef.raw) return parsed.tokens[j];
        }
      }
      return null;
    }

    function replaceToken(blockIdx, lineIdx, tokenRef, newText) {
      var blk = doc.blocks[blockIdx];
      if (!blk) return false;
      var line = blk.lines[lineIdx];
      if (typeof line !== 'string') return false;
      var fresh = resolveFreshToken(line, tokenRef);
      if (!fresh) return false;

      // Strict single-line bounds clamping (prevents newline-eating corruption)
      var start = Math.max(0, Math.min(fresh.start, line.length));
      var end = Math.max(start, Math.min(fresh.end, line.length));
      var sanitizedInsert = String(newText || '').replace(/[\r\n]+/g, ' ').trim();
      var nextLine = line.slice(0, start) + sanitizedInsert + line.slice(end);

      if (nextLine === line) return false;
      pushUndo();
      blk.lines[lineIdx] = nextLine;
      return true;
    }

    function deleteToken(blockIdx, lineIdx, tokenRef) {
      var blk = doc.blocks[blockIdx];
      if (!blk) return false;
      var line = blk.lines[lineIdx];
      if (typeof line !== 'string') return false;
      var fresh = resolveFreshToken(line, tokenRef);
      if (!fresh) return false;

      var indentMatch = /^(\s*)/.exec(line);
      var indent = indentMatch ? indentMatch[1] : '';
      var before = line.slice(0, fresh.start);
      var after = line.slice(fresh.end);
      var combined = (before + ' ' + after).trim().replace(/\s{2,}/g, ' ');
      pushUndo();
      blk.lines[lineIdx] = combined ? (indent + combined.replace(/^\s+/, '')) : '';
      return true;
    }

    function insertToken(blockIdx, lineIdx, textToInsert) {
      var blk = doc.blocks[blockIdx];
      if (!blk) return false;
      var line = blk.lines[lineIdx];
      if (typeof line !== 'string') return false;
      var clean = String(textToInsert || '').replace(/[\r\n]+/g, ' ').trim();
      if (!clean) return false;

      pushUndo();
      if (!line.trim()) {
        blk.lines[lineIdx] = line + clean;
      } else {
        blk.lines[lineIdx] = line.replace(/\s+$/, '') + ' ' + clean;
      }
      return true;
    }

    function setRawLineText(blockIdx, lineIdx, newLineText) {
      var blk = doc.blocks[blockIdx];
      if (!blk || typeof blk.lines[lineIdx] !== 'string') return false;
      var clean = String(newLineText || '').replace(/[\r\n]+/g, ' ');
      if (clean === blk.lines[lineIdx]) return false;
      pushUndo();
      blk.lines[lineIdx] = clean;
      return true;
    }

    function indentLine(blockIdx, lineIdx, delta) {
      var blk = doc.blocks[blockIdx];
      if (!blk || typeof blk.lines[lineIdx] !== 'string') return false;
      var line = blk.lines[lineIdx];
      pushUndo();
      if (delta > 0) {
        blk.lines[lineIdx] = '  ' + line;
      } else {
        blk.lines[lineIdx] = line.replace(/^ {1,2}/, '');
      }
      return true;
    }

    function insertLineBelow(blockIdx, lineIdx) {
      var blk = doc.blocks[blockIdx];
      if (!blk) return false;
      var curLine = blk.lines[lineIdx] || '';
      var indentMatch = /^(\s*)/.exec(curLine);
      var indent = indentMatch ? indentMatch[1] : '';
      pushUndo();
      blk.lines.splice(lineIdx + 1, 0, indent);
      cursor = { kind: 'wod', blockIdx: blockIdx, lineIdx: lineIdx + 1 };
      return true;
    }

    function updateFence(blockIdx, patch) {
      var blk = doc.blocks[blockIdx];
      if (!blk) return false;
      pushUndo();
      if (typeof patch.dialect === 'string') blk.dialect = patch.dialect;
      if (typeof patch.sport === 'string') blk.sport = patch.sport;
      return true;
    }

    function insertTemplate(blockIdx, templateId) {
      var blk = doc.blocks[blockIdx];
      var tpl = null;
      for (var i = 0; i < TEMPLATES.length; i++) {
        if (TEMPLATES[i].id === templateId) { tpl = TEMPLATES[i]; break; }
      }
      if (!blk || !tpl) return false;
      pushUndo();
      var hasOnlyEmpty = blk.lines.length === 1 && !blk.lines[0].trim();
      if (hasOnlyEmpty) {
        blk.lines = tpl.lines.slice();
        cursor = { kind: 'wod', blockIdx: blockIdx, lineIdx: 0 };
      } else {
        var insertAt = (cursor.kind === 'wod' && cursor.blockIdx === blockIdx) ? cursor.lineIdx + 1 : blk.lines.length;
        Array.prototype.splice.apply(blk.lines, [insertAt, 0].concat(tpl.lines));
        cursor = { kind: 'wod', blockIdx: blockIdx, lineIdx: insertAt };
      }
      return true;
    }

    function defineUnresolved(rawToken, action, targetEffortId) {
      pushUndo();
      if (rawToken[0] === '#' || action === 'tag') {
        var slug = slugify(rawToken.replace(/^#/, ''));
        var exists = catalogs.tags.some(function (t) { return t.slug === slug; });
        if (!exists) {
          catalogs.tags.unshift({ slug: slug, group: 'Custom', desc: 'Created inline in editor' });
        }
        return 'Created tag #' + slug;
      }
      if (action === 'equipment') {
        var eqName = rawToken.trim();
        catalogs.equipment.unshift({ id: slugify(eqName), name: eqName, desc: 'Custom equipment' });
        return 'Added equipment ' + eqName;
      }
      if (action === 'alias' && targetEffortId) {
        for (var i = 0; i < catalogs.efforts.length; i++) {
          if (catalogs.efforts[i].id === targetEffortId) {
            catalogs.efforts[i].aliases.push(rawToken.toLowerCase());
            return 'Aliased "' + rawToken + '" → ' + catalogs.efforts[i].name;
          }
        }
      }
      var effName = rawToken.trim();
      catalogs.efforts.unshift({
        id: slugify(effName),
        name: effName,
        aliases: [],
        defaultEquipment: null,
        notebooks: [doc.frontmatter.notebook || 'kettlebell'],
        recent: true,
        category: 'Custom'
      });
      return 'Defined effort "' + effName + '"';
    }

    function toggleMarkdownFormat(proseIdx, kind, payload) {
      var line = doc.prose[proseIdx];
      if (typeof line !== 'string') return false;
      pushUndo();

      if (kind === 'wrapTimeBlock') {
        var cleaned = line.replace(/\*\*/g, '').replace(/\*/g, '').trim() || '10:00 AMRAP';
        doc.prose.splice(proseIdx, 1);
        doc.blocks.unshift({ dialect: 'time', sport: '', lines: [cleaned] });
        cursor = { kind: 'wod', blockIdx: 0, lineIdx: 0 };
        return true;
      }

      if (kind === 'wikiLink' && payload) {
        var linkText = '[[' + payload + ']]';
        if (line.indexOf(linkText) === -1) {
          doc.prose[proseIdx] = line.replace(/\s+$/, '') + ' ' + linkText;
        }
        return true;
      }

      if (kind === 'proseTag' && payload) {
        var tagStr = payload[0] === '#' ? payload : '#' + payload;
        if (line.indexOf(tagStr) === -1) {
          doc.prose[proseIdx] = line.replace(/\s+$/, '') + ' ' + tagStr;
        }
        return true;
      }

      // True wrap/unwrap toggle on the prominent phrase or target token
      var markers = { bold: '**', italic: '*', strike: '~~', code: '`' };
      var m = markers[kind];
      if (!m) return false;
      var esc = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var unwrapRe = new RegExp(esc + '([^\\n]+?)' + esc);
      if (unwrapRe.test(line)) {
        doc.prose[proseIdx] = line.replace(unwrapRe, '$1');
        return true;
      }
      // Wrap last meaningful phrase (not [[link]] or #tag) or wrap selected sample words
      if (/bar path/.test(line)) {
        doc.prose[proseIdx] = line.replace(/bar path/, m + 'bar path' + m);
      } else {
        var words = line.trim().split(' ');
        if (words.length >= 2) {
          var tail = words.slice(-2).join(' ');
          var head = words.slice(0, -2).join(' ');
          doc.prose[proseIdx] = (head ? head + ' ' : '') + m + tail + m;
        } else {
          doc.prose[proseIdx] = m + line.trim() + m;
        }
      }
      return true;
    }

    function toggleFrontmatterTag(tagSlug) {
      var tag = tagSlug[0] === '#' ? tagSlug : '#' + tagSlug;
      pushUndo();
      var idx = doc.frontmatter.tags.indexOf(tag);
      if (idx >= 0) doc.frontmatter.tags.splice(idx, 1);
      else doc.frontmatter.tags.push(tag);
      return true;
    }

    function loadScenario(id) {
      var next = cloneData(SCENARIOS[id] || SCENARIOS.emom);
      doc = { title: next.title, frontmatter: next.frontmatter, prose: next.prose, blocks: next.blocks };
      cursor = cloneData(next.initialCursor);
      catalogs = createCatalogs();
      undoStack = [];
      redoStack = [];
    }

    return {
      getDoc: function () { return doc; },
      getCatalogs: function () { return catalogs; },
      getCursor: function () { return cursor; },
      setCursor: function (next) { cursor = cloneData(next); },
      canUndo: function () { return undoStack.length > 0; },
      canRedo: function () { return redoStack.length > 0; },
      undo: undo,
      redo: redo,
      replaceToken: replaceToken,
      deleteToken: deleteToken,
      insertToken: insertToken,
      setRawLineText: setRawLineText,
      indentLine: indentLine,
      insertLineBelow: insertLineBelow,
      updateFence: updateFence,
      insertTemplate: insertTemplate,
      defineUnresolved: defineUnresolved,
      toggleMarkdownFormat: toggleMarkdownFormat,
      toggleFrontmatterTag: toggleFrontmatterTag,
      loadScenario: loadScenario,
      getActiveParsed: function () {
        if (cursor.kind !== 'wod') return null;
        var blk = doc.blocks[cursor.blockIdx];
        if (!blk) return null;
        var line = blk.lines[cursor.lineIdx] || '';
        return { block: blk, line: line, parsed: parseWodLine(line, catalogs) };
      }
    };
  }

  /* ── Shared Typed Token Editor Renderer ──────────────────────────────── */
  function formatMmSs(mode, mins, secs) {
    var m = Math.max(0, parseInt(mins, 10) || 0);
    var s = Math.max(0, Math.min(59, parseInt(secs, 10) || 0));
    var prefix = mode === 'rest' ? '*' : mode === 'countup' ? '^' : '';
    if (mode === 'collectible') return ':?';
    var base = m > 0 ? (m + ':' + (s < 10 ? '0' : '') + s) : (':' + (s < 10 ? '0' : '') + s);
    return prefix + base;
  }

  function tokenChipLabel(tok) {
    if (tok.kind === 'duration') {
      var modeTag = tok.meta.mode === 'rest' ? 'Rest' : tok.meta.mode === 'countup' ? 'Up' : tok.meta.mode === 'collectible' ? 'Measure' : 'Timer';
      return { icon: tok.meta.mode === 'rest' ? 'rest' : 'timer', text: tok.raw, sub: modeTag };
    }
    if (tok.kind === 'scheme' || tok.kind === 'rounds') return { icon: 'rounds', text: tok.raw, sub: 'Rounds' };
    if (tok.kind === 'rep') return { icon: 'rep', text: tok.raw + ' reps', sub: 'Reps' };
    if (tok.kind === 'effort') return { icon: 'effort', text: tok.raw, sub: 'Effort' };
    if (tok.kind === 'equipment') return { icon: 'equipment', text: tok.raw, sub: 'Gear' };
    if (tok.kind === 'resistance') return { icon: 'resistance', text: tok.raw, sub: 'Load' };
    if (tok.kind === 'distance') return { icon: 'distance', text: tok.raw, sub: 'Dist' };
    if (tok.kind === 'action' || tok.kind === 'property') return { icon: 'action', text: tok.raw, sub: 'Action' };
    if (tok.kind === 'tag') return { icon: 'tag', text: tok.raw, sub: 'Tag' };
    if (tok.kind === 'unresolved') return { icon: 'warning', text: '? ' + tok.raw, sub: 'Define' };
    if (tok.kind === 'lintError') return { icon: 'error', text: '! ' + tok.raw, sub: 'Fix' };
    return { icon: 'code', text: tok.raw, sub: '' };
  }

  function renderTokenEditorHtml(opts) {
    var mode = opts.mode; // 'token' | 'add' | 'block' | 'wiki' | 'prose-tag' | 'fm-tag'
    var tok = opts.token;
    var block = opts.block;
    var catalogs = opts.catalogs;
    var activeNotebook = opts.activeNotebook || '';
    var searchQuery = opts.searchQuery || '';
    var showAliasList = !!opts.showAliasList;
    var useScrubber = !!opts.useScrubber; // true in Concept B numeric scrubber
    var hideHeader = !!opts.hideHeader;
    var hideFooter = !!opts.hideFooter;

    var title = 'Edit Token';
    var badge = tok ? tok.raw : '';
    var desc = '';
    var bodyHtml = '';
    var canDelete = !!tok && mode === 'token';

    if (mode === 'block' && block) {
      title = 'Timer Block Settings';
      badge = '```' + block.dialect + (block.sport ? ':' + block.sport : '');
      desc = 'Configure block dialect, sport defaults, or insert a grammar-verified template.';
      var compiled = compileBlockSummary(block, catalogs);
      bodyHtml =
        '<div class="control-section">' +
          '<div class="control-label">Block Dialect</div>' +
          '<div class="seg-pills">' +
            ['time', 'log', 'query'].map(function (d) {
              var lbl = d === 'time' ? 'TIMER (```time)' : d === 'log' ? 'LOG (```log)' : 'QUERY (```query)';
              return '<button type="button" class="choice-pill' + (block.dialect === d ? ' is-selected' : '') + '" data-ed="set-dialect" data-val="' + d + '">' + lbl + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="control-section">' +
          '<div class="control-label">Sport Vocabulary (:sport)</div>' +
          '<div class="seg-pills">' +
            SPORT_DIALECTS.map(function (sp) {
              var sel = (block.sport || '') === sp.id;
              return '<button type="button" class="choice-pill' + (sel ? ' is-selected' : '') + '" data-ed="set-sport" data-val="' + sp.id + '">' + escapeHtml(sp.label) + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="control-section">' +
          '<div class="control-label">Block Summary</div>' +
          '<div class="option-row" style="cursor:default;background:var(--popover);border-color:var(--border)">' +
            '<span class="option-row-main"><span class="option-row-title">' + compiled.nonEmptyLines + ' statements · ' + escapeHtml(compiled.durLabel) + ' clocked</span>' +
            '<span class="option-row-sub">' + compiled.errCount + ' syntax errors · ' + compiled.unresolvedCount + ' unresolved entities</span></span>' +
          '</div>' +
        '</div>' +
        '<div class="control-section">' +
          '<div class="control-label">Insert Workout Template</div>' +
          '<div class="catalog-list">' +
            TEMPLATES.map(function (tpl) {
              return (
                '<button type="button" class="option-row" data-ed="insert-template" data-val="' + tpl.id + '">' +
                  '<span class="option-row-main"><span class="option-row-title">' + escapeHtml(tpl.name) + '</span>' +
                  '<span class="option-row-sub">' + escapeHtml(tpl.desc) + '</span></span>' +
                  '<span class="option-row-code">' + escapeHtml(tpl.lines[0]) + '</span>' +
                '</button>'
              );
            }).join('') +
          '</div>' +
        '</div>';
    } else if (mode === 'wiki') {
      title = 'Insert [[Wiki Link]]';
      badge = 'Note Graph';
      desc = 'Link directly to another workout, benchmark, or guide in your library.';
      var notes = searchWikiNotes(searchQuery, catalogs);
      bodyHtml =
        '<div><label class="visually-hidden" for="proto-wiki-search">Search wiki notes</label>' +
        '<input id="proto-wiki-search" type="text" class="search-input" data-ed="search-input" value="' + escapeHtml(searchQuery) + '" placeholder="Search notes & benchmarks (e.g. Fran, Squat)…" /></div>' +
        '<div class="catalog-list">' +
          (notes.length ? notes.map(function (n) {
            return (
              '<button type="button" class="option-row" data-ed="pick-wiki" data-val="' + escapeHtml(n.title) + '">' +
                '<span class="option-row-main"><span class="option-row-title">' + escapeHtml(n.title) + '</span>' +
                '<span class="option-row-sub">' + escapeHtml(n.summary) + '</span></span>' +
                '<span class="option-row-code">[[' + escapeHtml(n.title) + ']]</span>' +
              '</button>'
            );
          }).join('') : '<div class="editor-head-desc">No matching wiki notes.</div>') +
        '</div>';
    } else if (mode === 'prose-tag' || mode === 'fm-tag') {
      title = mode === 'fm-tag' ? 'Toggle Note Tags' : 'Insert #Tag';
      badge = '#taxonomy';
      desc = 'Choose from grouped WOD Wiki tags or create a new tag inline.';
      var tagGroups = searchTags(searchQuery, catalogs);
      var cleanQ = slugify(searchQuery.replace(/^#/, ''));
      var hasExactTag = cleanQ && catalogs.tags.some(function (t) { return t.slug === cleanQ; });
      bodyHtml =
        '<div><label class="visually-hidden" for="proto-ptag-search">Search tags</label>' +
        '<input id="proto-ptag-search" type="text" class="search-input" data-ed="search-input" value="' + escapeHtml(searchQuery) + '" placeholder="Search #tags (e.g. emom, heavy, kettlebell)…" /></div>' +
        (searchQuery.trim() && !hasExactTag ? (
          '<button type="button" class="btn btn-primary" data-ed="create-and-pick-tag" data-val="' + escapeHtml(cleanQ) + '">+ Create #' + escapeHtml(cleanQ) + '</button>'
        ) : '') +
        Object.keys(tagGroups).map(function (grp) {
          return (
            '<div class="catalog-group"><div class="catalog-group-title">' + escapeHtml(grp) + '</div><div class="catalog-list">' +
              tagGroups[grp].map(function (t) {
                return (
                  '<button type="button" class="option-row" data-ed="pick-generic-tag" data-val="#' + escapeHtml(t.slug) + '">' +
                    '<span class="option-row-main"><span class="option-row-title">#' + escapeHtml(t.slug) + '</span>' +
                    '<span class="option-row-sub">' + escapeHtml(t.desc) + '</span></span>' +
                    '<span class="option-row-code">#' + escapeHtml(t.slug) + '</span>' +
                  '</button>'
                );
              }).join('') +
            '</div></div>'
          );
        }).join('');
    } else if (mode === 'add') {
      title = 'Add Syntax Element';
      badge = '+ Token';
      desc = 'Insert a valid WhiteboardScript construct onto the current line.';
      bodyHtml =
        '<div class="control-section"><div class="control-label">Timers &amp; Rest</div><div class="seg-pills">' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="1:00">1:00 Timer</button>' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="*1:00">*1:00 Rest</button>' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="^5:00">^5:00 Count-up</button>' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val=":?">:? Measure</button>' +
        '</div></div>' +
        '<div class="control-section"><div class="control-label">Reps, Load &amp; Distance</div><div class="seg-pills">' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="10">10 Reps</button>' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="5x5">5x5 Scheme</button>' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="@20kg">@20kg Load</button>' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="400m">400m Dist</button>' +
        '</div></div>' +
        '<div class="control-section"><div class="control-label">Catalog &amp; Wiki</div><div class="seg-pills">' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="Kettlebell Swing">Effort…</button>' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="Kettlebell">Equipment…</button>' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="#conditioning">#Tag…</button>' +
          '<button type="button" class="choice-pill" data-ed="insert-token" data-val="(3)">(3) Rounds</button>' +
        '</div></div>' +
        '<div class="control-section"><div class="control-label">Actions &amp; Properties</div><div class="seg-pills">' +
          ACTIONS.map(function (a) {
            return '<button type="button" class="choice-pill" data-ed="insert-token" data-val="' + escapeHtml(a.code) + '">' + escapeHtml(a.code) + '</button>';
          }).join('') +
        '</div></div>';
    } else if (tok && tok.kind === 'duration') {
      title = 'Timer & Duration';
      desc = 'Switch interval mode without losing your minutes/seconds or newlines.';
      var dMode = tok.meta.mode || 'countdown';
      var mins = tok.meta.mins || 0;
      var secs = tok.meta.secs || 0;
      var minOpts = [];
      for (var m = 0; m <= 30; m++) minOpts.push(m);
      var secOpts = [0, 5, 10, 15, 20, 30, 40, 45, 50];
      if (secOpts.indexOf(secs) === -1) secOpts.push(secs);
      secOpts.sort(function (a, b) { return a - b; });

      bodyHtml =
        '<div class="control-section"><div class="control-label">Timer Mode</div><div class="seg-pills">' +
          [
            { id: 'countdown', lbl: 'Countdown (1:00)' },
            { id: 'rest', lbl: 'Rest (*1:00)' },
            { id: 'countup', lbl: 'Count-up (^5:00)' },
            { id: 'collectible', lbl: 'Measure (:?)' }
          ].map(function (opt) {
            return '<button type="button" class="choice-pill' + (dMode === opt.id ? ' is-selected' : '') + '" data-ed="dur-mode" data-val="' + opt.id + '">' + opt.lbl + '</button>';
          }).join('') +
        '</div></div>' +
        '<div class="control-section"><div class="control-label">Quick Presets</div><div class="seg-pills">' +
          [
            { m: 0, s: 20, lbl: ':20' },
            { m: 0, s: 30, lbl: ':30' },
            { m: 1, s: 0, lbl: '1:00' },
            { m: 2, s: 0, lbl: '2:00' },
            { m: 5, s: 0, lbl: '5:00' },
            { m: 10, s: 0, lbl: '10:00' }
          ].map(function (p) {
            var valStr = formatMmSs(dMode === 'collectible' ? 'countdown' : dMode, p.m, p.s);
            var isCur = dMode !== 'collectible' && mins === p.m && secs === p.s;
            return '<button type="button" class="choice-pill' + (isCur ? ' is-selected' : '') + '" data-ed="replace-val" data-val="' + valStr + '">' + valStr + '</button>';
          }).join('') +
        '</div></div>' +
        (dMode !== 'collectible' ? (
          useScrubber ? (
            '<div class="scrubber-grid">' +
              '<div class="scrubber-col"><div class="control-label">Minutes</div>' +
                '<div class="scrubber-drum" data-scrubber="mins"><div class="scrubber-reticle"></div><div class="scrubber-scroll" role="listbox" aria-label="Minutes">' +
                  minOpts.map(function (mv) {
                    var sel = mv === mins;
                    return '<button type="button" role="option" aria-selected="' + sel + '" class="scrubber-row' + (sel ? ' is-selected' : '') + '" data-ed="dur-set-min" data-val="' + mv + '">' + mv + 'm</button>';
                  }).join('') +
                '</div></div>' +
              '</div>' +
              '<div class="scrubber-col"><div class="control-label">Seconds</div>' +
                '<div class="scrubber-drum" data-scrubber="secs"><div class="scrubber-reticle"></div><div class="scrubber-scroll" role="listbox" aria-label="Seconds">' +
                  secOpts.map(function (sv) {
                    var sel = sv === secs;
                    return '<button type="button" role="option" aria-selected="' + sel + '" class="scrubber-row' + (sel ? ' is-selected' : '') + '" data-ed="dur-set-sec" data-val="' + sv + '">:' + (sv < 10 ? '0' : '') + sv + '</button>';
                  }).join('') +
                '</div></div>' +
              '</div>' +
            '</div>'
          ) : (
            '<div class="stepper-grid">' +
              '<div class="stepper-card">' +
                '<button type="button" class="stepper-btn" data-ed="dur-delta-min" data-val="-1" aria-label="Decrease minutes">−</button>' +
                '<div class="stepper-readout"><span class="stepper-val tabular">' + mins + '</span><span class="stepper-unit">min</span></div>' +
                '<button type="button" class="stepper-btn" data-ed="dur-delta-min" data-val="1" aria-label="Increase minutes">+</button>' +
              '</div>' +
              '<div class="stepper-card">' +
                '<button type="button" class="stepper-btn" data-ed="dur-delta-sec" data-val="-5" aria-label="Decrease seconds">−</button>' +
                '<div class="stepper-readout"><span class="stepper-val tabular">' + (secs < 10 ? '0' : '') + secs + '</span><span class="stepper-unit">sec</span></div>' +
                '<button type="button" class="stepper-btn" data-ed="dur-delta-sec" data-val="5" aria-label="Increase seconds">+</button>' +
              '</div>' +
            '</div>'
          )
        ) : '');
    } else if (tok && (tok.kind === 'scheme' || tok.kind === 'rounds')) {
      title = tok.kind === 'scheme' ? 'Sets × Reps Scheme' : 'Rounds & Structure';
      desc = 'Switch between NxM sets, round counts, ladders, or interval keywords.';
      var sets = tok.meta.sets || 5;
      var reps = tok.meta.reps || 5;
      bodyHtml =
        (tok.kind === 'scheme' ? (
          '<div class="stepper-grid">' +
            '<div class="stepper-card">' +
              '<button type="button" class="stepper-btn" data-ed="scheme-delta-sets" data-val="-1" aria-label="Decrease sets">−</button>' +
              '<div class="stepper-readout"><span class="stepper-val tabular">' + sets + '</span><span class="stepper-unit">sets</span></div>' +
              '<button type="button" class="stepper-btn" data-ed="scheme-delta-sets" data-val="1" aria-label="Increase sets">+</button>' +
            '</div>' +
            '<div class="stepper-card">' +
              '<button type="button" class="stepper-btn" data-ed="scheme-delta-reps" data-val="-1" aria-label="Decrease reps">−</button>' +
              '<div class="stepper-readout"><span class="stepper-val tabular">' + reps + '</span><span class="stepper-unit">reps</span></div>' +
              '<button type="button" class="stepper-btn" data-ed="scheme-delta-reps" data-val="1" aria-label="Increase reps">+</button>' +
            '</div>' +
          '</div>'
        ) : '') +
        '<div class="control-section"><div class="control-label">Common Structures</div><div class="seg-pills">' +
          ['(3)', '(5)', '(21-15-9)', '5x5', '3x8', 'EMOM', 'AMRAP', 'Tabata'].map(function (v) {
            return '<button type="button" class="choice-pill' + (tok.raw.toUpperCase() === v.toUpperCase() ? ' is-selected' : '') + '" data-ed="replace-val" data-val="' + v + '">' + v + '</button>';
          }).join('') +
        '</div></div>';
    } else if (tok && tok.kind === 'rep') {
      title = 'Repetitions';
      desc = 'Adjust target rep count with fast steppers or presets.';
      var curReps = parseInt(tok.meta.reps, 10) || 10;
      bodyHtml =
        '<div class="stepper-grid">' +
          '<div class="stepper-card">' +
            '<button type="button" class="stepper-btn" data-ed="rep-delta" data-val="-5" aria-label="Subtract 5 reps">-5</button>' +
            '<button type="button" class="stepper-btn" data-ed="rep-delta" data-val="-1" aria-label="Subtract 1 rep">−</button>' +
            '<div class="stepper-readout"><span class="stepper-val tabular">' + curReps + '</span><span class="stepper-unit">reps</span></div>' +
            '<button type="button" class="stepper-btn" data-ed="rep-delta" data-val="1" aria-label="Add 1 rep">+</button>' +
            '<button type="button" class="stepper-btn" data-ed="rep-delta" data-val="5" aria-label="Add 5 reps">+5</button>' +
          '</div>' +
        '</div>' +
        '<div class="control-section"><div class="control-label">Presets</div><div class="seg-pills">' +
          ['5', '8', '10', '12', '15', '20', '30'].map(function (v) {
            return '<button type="button" class="choice-pill' + (String(curReps) === v ? ' is-selected' : '') + '" data-ed="replace-val" data-val="' + v + '">' + v + '</button>';
          }).join('') +
        '</div></div>';
    } else if (tok && tok.kind === 'resistance') {
      title = 'Resistance & Load';
      desc = 'Preserves @ prefix, alternatives (|), and preferred unit.';
      var hasAt = !!tok.meta.hasAt;
      var amt = tok.meta.amount;
      var numAmt = parseFloat(amt);
      var unit = tok.meta.unit || 'kg';
      var loads = unit === 'kg' ? [16, 20, 24, 32, 43, 60, 80, 100, 105, 120] : [35, 53, 70, 95, 115, 135, 155, 185, 225];
      if (!isNaN(numAmt) && loads.indexOf(numAmt) === -1) { loads.push(numAmt); loads.sort(function (a, b) { return a - b; }); }

      bodyHtml =
        '<div class="control-section"><div class="control-label">Prefix &amp; Alternatives</div><div class="seg-pills">' +
          '<button type="button" class="choice-pill' + (hasAt ? ' is-selected' : '') + '" data-ed="res-toggle-at">@ Load Prefix (' + (hasAt ? 'On' : 'Off') + ')</button>' +
          '<button type="button" class="choice-pill" data-ed="res-toggle-alt">' + (tok.meta.altAmount ? 'Single Value' : 'Rx | Scaled (|)') + '</button>' +
        '</div></div>' +
        '<div class="control-section"><div class="control-label">Unit</div><div class="seg-pills">' +
          ['kg', 'lb', 'pood', '%'].map(function (u) {
            return '<button type="button" class="choice-pill' + (unit === u ? ' is-selected' : '') + '" data-ed="res-unit" data-val="' + u + '">' + u + '</button>';
          }).join('') +
        '</div></div>' +
        (!isNaN(numAmt) ? (
          useScrubber ? (
            '<div class="scrubber-col"><div class="control-label">Amount (' + (hasAt ? '@' : '') + unit + ')</div>' +
              '<div class="scrubber-drum" data-scrubber="load"><div class="scrubber-reticle"></div><div class="scrubber-scroll" role="listbox" aria-label="Load amount">' +
                loads.map(function (lv) {
                  var sel = lv === numAmt;
                  return '<button type="button" role="option" aria-selected="' + sel + '" class="scrubber-row' + (sel ? ' is-selected' : '') + '" data-ed="res-set-amt" data-val="' + lv + '">' + (hasAt ? '@' : '') + lv + unit + '</button>';
                }).join('') +
              '</div></div>' +
            '</div>'
          ) : (
            '<div class="stepper-grid">' +
              '<div class="stepper-card">' +
                '<button type="button" class="stepper-btn" data-ed="res-delta" data-val="-5" aria-label="Decrease load by 5">-5</button>' +
                '<div class="stepper-readout"><span class="stepper-val tabular">' + (hasAt ? '@' : '') + numAmt + '</span><span class="stepper-unit">' + unit + '</span></div>' +
                '<button type="button" class="stepper-btn" data-ed="res-delta" data-val="5" aria-label="Increase load by 5">+5</button>' +
              '</div>' +
            '</div>'
          )
        ) : '') +
        '<div class="control-section"><div class="control-label">Quick Loads</div><div class="seg-pills">' +
          loads.slice(0, 6).map(function (lv) {
            var txt = (hasAt ? '@' : '') + lv + unit;
            return '<button type="button" class="choice-pill' + (lv === numAmt ? ' is-selected' : '') + '" data-ed="replace-val" data-val="' + txt + '">' + txt + '</button>';
          }).join('') +
        '</div></div>';
    } else if (tok && tok.kind === 'distance') {
      title = 'Distance & Calories';
      desc = 'Select standard distances or switch units.';
      var dUnit = tok.meta.unit || 'm';
      var distPresets = dUnit === 'cal' ? ['10', '15', '20', '30', '50'] : dUnit === 'mile' ? ['1/4', '1/2', '1', '3'] : ['100', '200', '400', '800', '1000', '2000'];
      bodyHtml =
        '<div class="control-section"><div class="control-label">Unit</div><div class="seg-pills">' +
          ['m', 'km', 'cal', 'ft', 'mile'].map(function (u) {
            return '<button type="button" class="choice-pill' + (dUnit === u ? ' is-selected' : '') + '" data-ed="dist-unit" data-val="' + u + '">' + u + '</button>';
          }).join('') +
        '</div></div>' +
        '<div class="control-section"><div class="control-label">Presets</div><div class="seg-pills">' +
          distPresets.map(function (amtStr) {
            var valStr = amtStr + (dUnit === 'mile' || dUnit === 'cal' || dUnit === 'ft' ? ' ' + dUnit : dUnit);
            return '<button type="button" class="choice-pill' + (tok.raw === valStr ? ' is-selected' : '') + '" data-ed="replace-val" data-val="' + valStr + '">' + valStr + '</button>';
          }).join('') +
        '</div></div>';
    } else if (tok && (tok.kind === 'effort' || tok.kind === 'equipment')) {
      title = tok.kind === 'effort' ? 'Effort / Movement' : 'Equipment';
      desc = 'Fuzzy alias search — rewrites clean WhiteboardScript text (never raw JSON).';
      if (tok.kind === 'effort') {
        var effRes = searchEfforts(searchQuery, activeNotebook, catalogs);
        var cleanEff = searchQuery.trim();
        var exactEff = cleanEff && catalogs.efforts.some(function (e) { return e.name.toLowerCase() === cleanEff.toLowerCase(); });
        bodyHtml =
          '<div><label class="visually-hidden" for="proto-eff-search">Search efforts</label>' +
          '<input id="proto-eff-search" type="text" class="search-input" data-ed="search-input" value="' + escapeHtml(searchQuery) + '" placeholder="Search efforts or aliases (e.g. swing, kb, squat)…" /></div>' +
          (cleanEff && !exactEff ? (
            '<button type="button" class="btn btn-primary" data-ed="create-effort" data-val="' + escapeHtml(cleanEff) + '">+ Create Effort "' + escapeHtml(cleanEff) + '"</button>'
          ) : '') +
          (effRes.scoped.length ? (
            '<div class="catalog-group"><div class="catalog-group-title">Notebook &amp; Recent (' + escapeHtml(activeNotebook || 'general') + ')</div><div class="catalog-list">' +
              effRes.scoped.map(function (e) {
                var sel = tok.meta.effortId === e.id;
                return (
                  '<button type="button" class="option-row' + (sel ? ' is-selected' : '') + '" data-ed="replace-val" data-val="' + escapeHtml(e.name) + '">' +
                    '<span class="option-row-main"><span class="option-row-title">' + escapeHtml(e.name) + '</span>' +
                    '<span class="option-row-sub">' + escapeHtml(e.category + (e.defaultEquipment ? ' · ' + e.defaultEquipment : '') + (e.aliases.length ? ' · ' + e.aliases.slice(0, 2).join(', ') : '')) + '</span></span>' +
                    '<span class="option-row-code">' + (sel ? 'Active' : 'Select') + '</span>' +
                  '</button>'
                );
              }).join('') +
            '</div></div>'
          ) : '') +
          (effRes.other.length ? (
            '<div class="catalog-group"><div class="catalog-group-title">All Movements</div><div class="catalog-list">' +
              effRes.other.map(function (e) {
                var sel = tok.meta.effortId === e.id;
                return (
                  '<button type="button" class="option-row' + (sel ? ' is-selected' : '') + '" data-ed="replace-val" data-val="' + escapeHtml(e.name) + '">' +
                    '<span class="option-row-main"><span class="option-row-title">' + escapeHtml(e.name) + '</span>' +
                    '<span class="option-row-sub">' + escapeHtml(e.category + (e.aliases.length ? ' · ' + e.aliases.slice(0, 2).join(', ') : '')) + '</span></span>' +
                    '<span class="option-row-code">' + (sel ? 'Active' : 'Select') + '</span>' +
                  '</button>'
                );
              }).join('') +
            '</div></div>'
          ) : '') +
          (!effRes.scoped.length && !effRes.other.length ? '<div class="editor-head-desc">No catalog match — create "' + escapeHtml(cleanEff) + '" above.</div>' : '');
      } else {
        var eqFiltered = catalogs.equipment.filter(function (eq) {
          return fuzzyMatches(searchQuery, [eq.name, eq.desc]);
        });
        bodyHtml =
          '<div><label class="visually-hidden" for="proto-eq-search">Search equipment</label>' +
          '<input id="proto-eq-search" type="text" class="search-input" data-ed="search-input" value="' + escapeHtml(searchQuery) + '" placeholder="Filter equipment…" /></div>' +
          '<div class="catalog-list">' +
            eqFiltered.map(function (eq) {
              var sel = tok.meta.equipmentId === eq.id;
              return (
                '<button type="button" class="option-row' + (sel ? ' is-selected' : '') + '" data-ed="replace-val" data-val="' + escapeHtml(eq.name) + '">' +
                  '<span class="option-row-main"><span class="option-row-title">' + escapeHtml(eq.name) + '</span>' +
                  '<span class="option-row-sub">' + escapeHtml(eq.desc) + '</span></span>' +
                  '<span class="option-row-code">' + (sel ? 'Active' : 'Select') + '</span>' +
                '</button>'
              );
            }).join('') +
          '</div>';
      }
    } else if (tok && tok.kind === 'tag') {
      title = 'Wiki Tag (#tag)';
      desc = 'Select an existing taxonomy tag or create a new tag inline.';
      var tGroups = searchTags(searchQuery, catalogs);
      var cleanSlug = slugify(searchQuery.replace(/^#/, ''));
      var exactT = cleanSlug && catalogs.tags.some(function (t) { return t.slug === cleanSlug; });
      bodyHtml =
        '<div><label class="visually-hidden" for="proto-wtag-search">Search tags</label>' +
        '<input id="proto-wtag-search" type="text" class="search-input" data-ed="search-input" value="' + escapeHtml(searchQuery) + '" placeholder="Search #tags…" /></div>' +
        (searchQuery.trim() && !exactT ? (
          '<button type="button" class="btn btn-primary" data-ed="create-and-replace-tag" data-val="' + escapeHtml(cleanSlug) + '">+ Create &amp; Use #' + escapeHtml(cleanSlug) + '</button>'
        ) : '') +
        Object.keys(tGroups).map(function (grp) {
          return (
            '<div class="catalog-group"><div class="catalog-group-title">' + escapeHtml(grp) + '</div><div class="catalog-list">' +
              tGroups[grp].map(function (t) {
                var sel = tok.raw.toLowerCase() === ('#' + t.slug).toLowerCase();
                return (
                  '<button type="button" class="option-row' + (sel ? ' is-selected' : '') + '" data-ed="replace-val" data-val="#' + escapeHtml(t.slug) + '">' +
                    '<span class="option-row-main"><span class="option-row-title">#' + escapeHtml(t.slug) + '</span>' +
                    '<span class="option-row-sub">' + escapeHtml(t.desc) + '</span></span>' +
                    '<span class="option-row-code">' + (sel ? 'Active' : 'Select') + '</span>' +
                  '</button>'
                );
              }).join('') +
            '</div></div>'
          );
        }).join('');
    } else if (tok && tok.kind === 'unresolved') {
      title = tok.meta.isTag ? 'Unrecognized Tag' : 'Unrecognized Movement / Term';
      desc = tok.meta.isTag
        ? 'This #tag is not in your note taxonomy yet. Add it now in one tap.'
        : 'Define "' + tok.raw + '" in your WOD Wiki catalog or link it as an alias.';
      if (tok.meta.isTag) {
        bodyHtml =
          (tok.raw.length > 1 ? (
            '<div class="seg-pills">' +
              '<button type="button" class="btn btn-primary" data-ed="define-unresolved" data-action-type="tag" data-raw="' + escapeHtml(tok.raw) + '">+ Create Tag ' + escapeHtml(tok.raw) + '</button>' +
            '</div>'
          ) : '') +
          '<div class="control-section"><div class="control-label">' + (tok.raw.length > 1 ? 'Or Replace With Existing Tag' : 'Choose a Tag') + '</div><div class="seg-pills">' +
            catalogs.tags.slice(0, 6).map(function (t) {
              return '<button type="button" class="choice-pill" data-ed="replace-val" data-val="#' + escapeHtml(t.slug) + '">#' + escapeHtml(t.slug) + '</button>';
            }).join('') +
          '</div></div>';
      } else {
        bodyHtml =
          '<div class="seg-pills">' +
            '<button type="button" class="btn btn-primary" data-ed="define-unresolved" data-action-type="effort" data-raw="' + escapeHtml(tok.raw) + '">+ Define Effort</button>' +
            '<button type="button" class="btn btn-secondary" data-ed="toggle-alias-list">+ Alias to Existing</button>' +
            '<button type="button" class="btn btn-secondary" data-ed="define-unresolved" data-action-type="equipment" data-raw="' + escapeHtml(tok.raw) + '">+ Equipment</button>' +
          '</div>' +
          (showAliasList ? (
            '<div class="control-section"><div class="control-label">Pick Target Effort for Alias</div><div class="catalog-list">' +
              catalogs.efforts.slice(0, 8).map(function (e) {
                return (
                  '<button type="button" class="option-row" data-ed="define-alias-target" data-raw="' + escapeHtml(tok.raw) + '" data-target="' + escapeHtml(e.id) + '">' +
                    '<span class="option-row-main"><span class="option-row-title">' + escapeHtml(e.name) + '</span>' +
                    '<span class="option-row-sub">' + escapeHtml(e.category) + '</span></span>' +
                    '<span class="option-row-code">Link Alias</span>' +
                  '</button>'
                );
              }).join('') +
            '</div></div>'
          ) : '');
      }
    } else if (tok && tok.kind === 'lintError') {
      title = 'Syntax Repair';
      desc = tok.meta.message;
      bodyHtml =
        '<div class="control-section"><div class="control-label">1-Click Fixes</div><div class="seg-pills">' +
          (tok.meta.fixes || []).map(function (fx) {
            return '<button type="button" class="btn btn-primary" data-ed="replace-val" data-val="' + escapeHtml(fx) + '">Use ' + escapeHtml(fx) + '</button>';
          }).join('') +
        '</div></div>';
    } else if (tok && (tok.kind === 'action' || tok.kind === 'property')) {
      title = 'Actions & Block Properties';
      desc = 'Replace with a timer action cue or line property.';
      bodyHtml =
        '<div class="control-section"><div class="control-label">Actions</div><div class="catalog-list">' +
          ACTIONS.map(function (a) {
            return (
              '<button type="button" class="option-row' + (tok.raw === a.code ? ' is-selected' : '') + '" data-ed="replace-val" data-val="' + escapeHtml(a.code) + '">' +
                '<span class="option-row-main"><span class="option-row-title">' + escapeHtml(a.label) + '</span>' +
                '<span class="option-row-sub">' + escapeHtml(a.desc) + '</span></span>' +
                '<span class="option-row-code">' + escapeHtml(a.code) + '</span>' +
              '</button>'
            );
          }).join('') +
        '</div></div>' +
        '<div class="control-section"><div class="control-label">Properties</div><div class="catalog-list">' +
          PROPERTIES.map(function (p) {
            return (
              '<button type="button" class="option-row' + (tok.raw === p.code ? ' is-selected' : '') + '" data-ed="replace-val" data-val="' + escapeHtml(p.code) + '">' +
                '<span class="option-row-main"><span class="option-row-title">' + escapeHtml(p.label) + '</span>' +
                '<span class="option-row-sub">' + escapeHtml(p.desc) + '</span></span>' +
                '<span class="option-row-code">' + escapeHtml(p.code) + '</span>' +
              '</button>'
            );
          }).join('') +
        '</div></div>';
    } else {
      bodyHtml = '<div class="editor-head-desc">Tap any parsed token chip above or + Add to edit this line.</div>';
    }

    var headHtml = hideHeader ? '' : (
      '<div class="editor-head">' +
        '<div class="editor-head-meta">' +
          '<div class="editor-head-title"><span>' + escapeHtml(title) + '</span>' +
            (badge ? '<span class="kbd-chip">' + escapeHtml(badge) + '</span>' : '') +
          '</div>' +
          '<div class="editor-head-desc">' + escapeHtml(desc) + '</div>' +
        '</div>' +
        '<div class="editor-head-actions">' +
          (canDelete ? '<button type="button" class="icon-btn" data-ed="delete-token" aria-label="Delete token" title="Delete token">' + icons.trash(15) + '</button>' : '') +
          (opts.showStepButtons ? (
            '<button type="button" class="icon-btn" data-ed="step-prev" aria-label="Previous token" title="Previous token">' + icons.chevronLeft(15) + '</button>' +
            '<button type="button" class="icon-btn" data-ed="step-next" aria-label="Next token" title="Next token">' + icons.chevronRight(15) + '</button>'
          ) : '') +
          (opts.showClose ? '<button type="button" class="icon-btn" data-ed="close-editor" aria-label="Close inspector" title="Close (Esc)">' + icons.x(15) + '</button>' : '') +
        '</div>' +
      '</div>'
    );

    var footerHtml = hideFooter ? '' : (
      '<div class="editor-footer">' +
        '<span>Line-safe AST mutation</span>' +
        '<span>Esc returns to chip</span>' +
      '</div>'
    );

    return headHtml + '<div class="editor-body">' + bodyHtml + '</div>' + footerHtml;
  }

  /* ── Shared Mutation Dispatcher for Token Editor Events ──────────────── */
  function handleTokenEditorAction(ctrl, targetEl, ctx) {
    var act = targetEl.getAttribute('data-ed');
    if (!act) return { handled: false };
    var val = targetEl.getAttribute('data-val');
    var blockIdx = ctx.blockIdx;
    var lineIdx = ctx.lineIdx;
    var tok = ctx.token;

    if (act === 'replace-val' && tok) {
      ctrl.replaceToken(blockIdx, lineIdx, tok, val);
      return { handled: true, reselectRaw: val, toast: 'Updated → ' + val };
    }
    if (act === 'delete-token' && tok) {
      ctrl.deleteToken(blockIdx, lineIdx, tok);
      return { handled: true, closeOnEmpty: true, toast: 'Removed ' + tok.raw };
    }
    if (act === 'insert-token') {
      ctrl.insertToken(blockIdx, lineIdx, val);
      return { handled: true, reselectRaw: val, toast: 'Inserted ' + val };
    }
    if (act === 'dur-mode' && tok) {
      var nextStr = formatMmSs(val, tok.meta.mins || 1, tok.meta.secs || 0);
      ctrl.replaceToken(blockIdx, lineIdx, tok, nextStr);
      return { handled: true, reselectRaw: nextStr, toast: 'Timer → ' + nextStr };
    }
    if ((act === 'dur-delta-min' || act === 'dur-delta-sec' || act === 'dur-set-min' || act === 'dur-set-sec') && tok) {
      var m = tok.meta.mins || 0;
      var s = tok.meta.secs || 0;
      if (act === 'dur-delta-min') m = Math.max(0, m + parseInt(val, 10));
      if (act === 'dur-delta-sec') {
        s = s + parseInt(val, 10);
        if (s >= 60) { m += 1; s -= 60; }
        if (s < 0) { if (m > 0) { m -= 1; s += 60; } else { s = 0; } }
      }
      if (act === 'dur-set-min') m = parseInt(val, 10);
      if (act === 'dur-set-sec') s = parseInt(val, 10);
      if (m === 0 && s === 0) s = 30;
      var mode = tok.meta.mode === 'collectible' ? 'countdown' : (tok.meta.mode || 'countdown');
      var out = formatMmSs(mode, m, s);
      ctrl.replaceToken(blockIdx, lineIdx, tok, out);
      return { handled: true, reselectRaw: out, toast: 'Duration → ' + out };
    }
    if ((act === 'scheme-delta-sets' || act === 'scheme-delta-reps') && tok) {
      var sets = tok.meta.sets || 5;
      var reps = tok.meta.reps || 5;
      if (act === 'scheme-delta-sets') sets = Math.max(1, sets + parseInt(val, 10));
      if (act === 'scheme-delta-reps') reps = Math.max(1, reps + parseInt(val, 10));
      var sch = sets + 'x' + reps;
      ctrl.replaceToken(blockIdx, lineIdx, tok, sch);
      return { handled: true, reselectRaw: sch, toast: 'Scheme → ' + sch };
    }
    if (act === 'rep-delta' && tok) {
      var nextRep = Math.max(1, (parseInt(tok.meta.reps, 10) || 10) + parseInt(val, 10));
      ctrl.replaceToken(blockIdx, lineIdx, tok, String(nextRep));
      return { handled: true, reselectRaw: String(nextRep), toast: 'Reps → ' + nextRep };
    }
    if ((act === 'res-toggle-at' || act === 'res-toggle-alt' || act === 'res-unit' || act === 'res-delta' || act === 'res-set-amt') && tok) {
      var hasAt = !!tok.meta.hasAt;
      var amt = tok.meta.amount;
      var alt = tok.meta.altAmount;
      var unit = tok.meta.unit || 'kg';
      if (act === 'res-toggle-at') hasAt = !hasAt;
      if (act === 'res-toggle-alt') alt = alt ? null : Math.max(5, Math.round((parseFloat(amt) || 20) * 0.7));
      if (act === 'res-unit') unit = val;
      if (act === 'res-delta') amt = Math.max(1, (parseFloat(amt) || 20) + parseFloat(val));
      if (act === 'res-set-amt') amt = parseFloat(val);
      var resOut = (hasAt ? '@' : '') + amt + (alt ? ' | ' + alt + ' ' : '') + unit;
      ctrl.replaceToken(blockIdx, lineIdx, tok, resOut);
      return { handled: true, reselectRaw: resOut, toast: 'Load → ' + resOut };
    }
    if (act === 'dist-unit' && tok) {
      var dAmt = tok.meta.amount || '400';
      var dOut = dAmt + (val === 'mile' || val === 'cal' || val === 'ft' ? ' ' + val : val);
      ctrl.replaceToken(blockIdx, lineIdx, tok, dOut);
      return { handled: true, reselectRaw: dOut, toast: 'Distance → ' + dOut };
    }
    if (act === 'create-effort' && tok) {
      var msg = ctrl.defineUnresolved(val, 'effort');
      ctrl.replaceToken(blockIdx, lineIdx, tok, val);
      return { handled: true, reselectRaw: val, toast: msg };
    }
    if (act === 'create-and-replace-tag' && tok) {
      ctrl.defineUnresolved('#' + val, 'tag');
      ctrl.replaceToken(blockIdx, lineIdx, tok, '#' + val);
      return { handled: true, reselectRaw: '#' + val, toast: 'Created #' + val };
    }
    if (act === 'define-unresolved') {
      var raw = targetEl.getAttribute('data-raw');
      var aType = targetEl.getAttribute('data-action-type');
      var defMsg = ctrl.defineUnresolved(raw, aType);
      return { handled: true, reselectRaw: raw, toast: defMsg };
    }
    if (act === 'define-alias-target') {
      var aRaw = targetEl.getAttribute('data-raw');
      var tgt = targetEl.getAttribute('data-target');
      var aMsg = ctrl.defineUnresolved(aRaw, 'alias', tgt);
      return { handled: true, reselectRaw: aRaw, toast: aMsg };
    }
    if (act === 'set-dialect') {
      ctrl.updateFence(blockIdx, { dialect: val });
      return { handled: true, toast: 'Block dialect → ```' + val };
    }
    if (act === 'set-sport') {
      ctrl.updateFence(blockIdx, { sport: val });
      return { handled: true, toast: val ? 'Sport → :' + val : 'Sport → General' };
    }
    if (act === 'insert-template') {
      ctrl.insertTemplate(blockIdx, val);
      return { handled: true, close: true, toast: 'Inserted ' + val + ' template' };
    }
    if (act === 'pick-wiki') {
      ctrl.toggleMarkdownFormat(ctx.proseIdx, 'wikiLink', val);
      return { handled: true, close: true, toast: 'Inserted [[' + val + ']]' };
    }
    if (act === 'pick-generic-tag') {
      if (ctx.mode === 'fm-tag') {
        ctrl.toggleFrontmatterTag(val);
        return { handled: true, toast: 'Toggled ' + val };
      }
      ctrl.toggleMarkdownFormat(ctx.proseIdx, 'proseTag', val);
      return { handled: true, close: true, toast: 'Inserted ' + val };
    }
    if (act === 'create-and-pick-tag') {
      ctrl.defineUnresolved('#' + val, 'tag');
      if (ctx.mode === 'fm-tag') {
        ctrl.toggleFrontmatterTag('#' + val);
      } else {
        ctrl.toggleMarkdownFormat(ctx.proseIdx, 'proseTag', '#' + val);
      }
      return { handled: true, close: ctx.mode !== 'fm-tag', toast: 'Created #' + val };
    }

    return { handled: false };
  }

  /* ── Shared Line Formatting Helpers ──────────────────────────────────── */
  function renderProseRunsHtml(text) {
    var html = escapeHtml(text);
    html = html.replace(/\[\[([^\]]+)\]\]/g, function (_, title) {
      return '<span class="prose-wiki-chip">' + icons.wiki(12) + '<span>' + title + '</span></span>';
    });
    html = html.replace(/(^|\s)(#[a-zA-Z0-9-]+)/g, function (_, lead, tag) {
      return lead + '<span class="prose-tag-chip">' + tag + '</span>';
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="prose-bold">$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em class="prose-italic">$1</em>');
    html = html.replace(/~~([^~]+)~~/g, '<span class="prose-strike">$1</span>');
    html = html.replace(/`([^`]+)`/g, '<code class="prose-code">$1</code>');
    return html;
  }

  function renderWodCodeRunsHtml(lineText, parsed, focusedTokenId) {
    if (!lineText.trim()) {
      return '<span style="color:var(--muted-fg);font-style:italic">Empty workout line — tap a starter or + Add</span>';
    }
    var indentMatch = /^(\s+)/.exec(lineText);
    var out = indentMatch ? '<span style="white-space:pre">' + escapeHtml(indentMatch[1]) + '</span>' : '';
    var toks = parsed.tokens;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      var cls = 'syn-tok syn-' + t.kind;
      if (t.kind === 'duration' && t.meta.mode === 'rest') cls += ' is-rest';
      if (t.id === focusedTokenId) cls += ' is-focused-tok';
      out += '<span class="' + cls + '">' + escapeHtml(t.raw) + '</span>';
    }
    return out;
  }

  function renderSidebarSectionsHtml(entities) {
    var html = '';
    html +=
      '<div class="sidebar-section">' +
        '<div class="sidebar-heading"><span>Unrecognized</span><span class="sidebar-badge is-count">' + entities.unresolved.length + '</span></div>' +
        '<div class="sidebar-list">' +
          (entities.unresolved.length ? entities.unresolved.map(function (u) {
            return (
              '<button type="button" class="sidebar-item" data-nav-define="' + escapeHtml(u.raw) + '" data-b="' + u.blockIdx + '" data-l="' + u.lineIdx + '" data-tid="' + escapeHtml(u.token.id) + '">' +
                '<span class="sidebar-item-label">' + icons.warning(13) + '<span>' + escapeHtml(u.raw) + '</span></span>' +
                '<span class="sidebar-badge is-define">Define</span>' +
              '</button>'
            );
          }).join('') : '<div style="padding:4px 6px;font-size:12px;color:var(--muted-fg)">All entities resolved</div>') +
        '</div>' +
      '</div>';

    html +=
      '<div class="sidebar-section">' +
        '<div class="sidebar-heading"><span>Tags</span><span class="sidebar-badge is-count">' + entities.tags.length + '</span></div>' +
        '<div class="sidebar-list">' +
          (entities.tags.length ? entities.tags.map(function (t) {
            return (
              '<button type="button" class="sidebar-item" data-nav-toast="Opened tag ' + escapeHtml(t) + '">' +
                '<span class="sidebar-item-label">' + icons.tag(13) + '<span>' + escapeHtml(t) + '</span></span>' +
                '<span class="sidebar-badge is-count">Tag</span>' +
              '</button>'
            );
          }).join('') : '<div style="padding:4px 6px;font-size:12px;color:var(--muted-fg)">No tags yet</div>') +
        '</div>' +
      '</div>';

    html +=
      '<div class="sidebar-section">' +
        '<div class="sidebar-heading"><span>Efforts</span><span class="sidebar-badge is-count">' + entities.efforts.length + '</span></div>' +
        '<div class="sidebar-list">' +
          (entities.efforts.length ? entities.efforts.map(function (e) {
            return (
              '<button type="button" class="sidebar-item" data-nav-toast="Opened effort ' + escapeHtml(e.name) + '">' +
                '<span class="sidebar-item-label">' + icons.effort(13) + '<span>' + escapeHtml(e.name) + '</span></span>' +
              '</button>'
            );
          }).join('') : '<div style="padding:4px 6px;font-size:12px;color:var(--muted-fg)">No efforts yet</div>') +
        '</div>' +
      '</div>';

    html +=
      '<div class="sidebar-section">' +
        '<div class="sidebar-heading"><span>Equipment</span><span class="sidebar-badge is-count">' + entities.equipment.length + '</span></div>' +
        '<div class="sidebar-list">' +
          (entities.equipment.length ? entities.equipment.map(function (eq) {
            return (
              '<button type="button" class="sidebar-item" data-nav-toast="Opened equipment ' + escapeHtml(eq.name) + '">' +
                '<span class="sidebar-item-label">' + icons.equipment(13) + '<span>' + escapeHtml(eq.name) + '</span></span>' +
              '</button>'
            );
          }).join('') : '<div style="padding:4px 6px;font-size:12px;color:var(--muted-fg)">No equipment inferred</div>') +
        '</div>' +
      '</div>';

    return html;
  }

  global.WhiteboardProto = {
    icons: icons,
    escapeHtml: escapeHtml,
    SCENARIOS: SCENARIOS,
    TEMPLATES: TEMPLATES,
    SPORT_DIALECTS: SPORT_DIALECTS,
    ACTIONS: ACTIONS,
    PROPERTIES: PROPERTIES,
    parseWodLine: parseWodLine,
    compileBlockSummary: compileBlockSummary,
    collectNoteEntities: collectNoteEntities,
    searchEfforts: searchEfforts,
    searchTags: searchTags,
    searchWikiNotes: searchWikiNotes,
    createEditorController: createEditorController,
    tokenChipLabel: tokenChipLabel,
    renderTokenEditorHtml: renderTokenEditorHtml,
    handleTokenEditorAction: handleTokenEditorAction,
    renderProseRunsHtml: renderProseRunsHtml,
    renderWodCodeRunsHtml: renderWodCodeRunsHtml,
    renderSidebarSectionsHtml: renderSidebarSectionsHtml
  };
})(window);
